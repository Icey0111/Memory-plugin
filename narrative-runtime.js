import { captureHistory, chunkHistory, rankRawChunks, validSummary, nextSummaryBatch,
    summaryPrompt, applyNarrativeFolds, packRawEvidence } from './raw-history.js';
import { estimateTokens } from './v55-tokenizer.js';
import { formatRelevantSettingContext } from './setting-retriever.js';
import { recordModelCall } from './v55-metrics.js';
import { isFoldedRow } from './memory-core.js';
import { syncFloorFoldDom, syncFloorFoldRow } from './v55-floor-fold.js';

export const NARRATIVE_SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
export const NARRATIVE_PROMPTS = ['aetheria_unified_memory_v5_4_reference', 'aetheria_unified_memory_v5_4_current_state'];
const defaults = { narrative_every: 10, narrative_summary_tokens: 600, narrative_evidence_tokens: 1000,
    narrative_setting_tokens: 400, narrative_input_chars: 18000, narrative_fold: true };
// Both maps are keyed by the host's chat-metadata object, not by the chat store object: the store
// projection replaces the store on a persist, so a store-keyed map would lose the running job and the
// live index on exactly the turns that wrote something. The metadata object is stable for a chat and
// is replaced when the user switches chats, which is the scope both maps want.
const jobs = new WeakMap();
const indexes = new WeakMap();
const hostKey = ctx => ctx.chatMetadata || storeOf(ctx);
let installed = false;
let sharedService;

export function narrativeSettings(ctx) {
    const settings = ctx.extensionSettings[NARRATIVE_SETTINGS_KEY] ??= {};
    settings.narrative_pipeline = true;
    for (const [key, value] of Object.entries(defaults)) if (settings[key] === undefined) settings[key] = value;
    return settings;
}

const bound = (value, fallback, min, max) => Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;

function options(settings) {
    return { every: bound(settings.narrative_every, 10, 1, 100),
        summaryTokens: bound(settings.narrative_summary_tokens, 600, 100, 4000),
        evidenceTokens: bound(settings.narrative_evidence_tokens, 1000, 0, 8000),
        settingTokens: bound(settings.narrative_setting_tokens, 400, 0, 4000),
        inputChars: bound(settings.narrative_input_chars, 18000, 2000, 100000) };
}

function storeOf(ctx) { return ctx.chatMetadata[NARRATIVE_SETTINGS_KEY] ??= {}; }
function persist(ctx) { ctx.saveMetadataDebounced?.(); }
/**
 * Diagnostics are written through a fresh read, never through a captured reference.
 *
 * The chat store object is replaced by the store projection on a persist, so a write through a
 * reference captured before it lands on an object nobody reads again - which is how the reason
 * original-text vectors were unavailable went missing while the pipeline still reported the failure.
 */
function diagnose(ctx, patch) {
    const store = storeOf(ctx);
    store.narrative_diagnostics = { ...store.narrative_diagnostics, ...patch };
}
function quiet(settings, type) {
    return settings.enabled === false || type === 'impersonate' || settings.__narrative_summary_in_progress
        || (type === 'quiet' && settings.quiet_allow_third_party_injection !== true);
}

export async function generateNarrativeSummary(ctx, prompt, settings) {
    const max = bound(settings.summary_max_tokens, 2048, 256, 8192);
    let result;
    settings.__narrative_summary_in_progress = true;
    settings.__quiet_extraction_in_progress = true;
    try {
        if (settings.summary_provider_mode === 'connection_profile') {
            if (!settings.summary_connection_profile_id) throw new Error('请选择总结连接。');
            sharedService ??= await import('/scripts/extensions/shared.js');
            const service = sharedService.ConnectionManagerRequestService;
            const id = settings.summary_connection_profile_id;
            const messages = [{ role: 'user', content: prompt }];
            result = await service.sendRequest(id, service.constructPrompt(messages, id), max,
                { stream: false, extractData: true, includePreset: false, includeInstruct: false }, { temperature: 0.2 });
        } else if (ctx.generateRaw) {
            result = await ctx.generateRaw({ prompt, systemPrompt: '忠实压缩剧情，仅输出续接摘要。', responseLength: max });
        } else if (ctx.generateQuietPrompt) {
            result = await ctx.generateQuietPrompt({ quietPrompt: prompt, responseLength: max });
        } else throw new Error('当前宿主没有可用的后台生成接口。');
    } finally {
        delete settings.__narrative_summary_in_progress;
        delete settings.__quiet_extraction_in_progress;
    }
    const text = String(typeof result === 'string' ? result : result?.content || '').trim();
    if (!text || /^\[(?:API\s*(?:错误|error)|error|错误)\]/i.test(text)
        || (text.length < 800 && /rate limit|too many requests|quota exhausted|invalid api key|HTTP\s*[45]\d\d/i.test(text))) {
        throw new Error('总结接口未返回有效摘要；未总结原文继续保留。');
    }
    recordModelCall(ctx, { kind: 'summary', promptText: prompt, completionText: text,
        promptChars: prompt.length, completionChars: text.length });
    return text;
}

// Only active source versions enter the index. Old versions remain in the archive, not in recall.
async function syncIndex(ctx, chunks, services) {
    const store = storeOf(ctx);
    const host = hostKey(ctx);
    const vector = services.vector();
    if (!vector.supported) return { available: false, reason: vector.reason || 'vector unavailable' };
    const signature = chunks.map(row => row.id).join('|');
    const cached = indexes.get(host);
    if (cached?.signature === signature && cached.fingerprint === vector.fingerprint) return cached;
    const prior = store.narrative_vector;
    const hashes = chunks.map(row => row.hash);
    try {
        if (!prior || prior.fingerprint !== vector.fingerprint) await vector.purge();
        else {
            const live = new Set(hashes);
            const removed = (prior.hashes || []).filter(hash => !live.has(hash));
            if (removed.length) await vector.remove(removed);
        }
        const present = new Set(prior?.fingerprint === vector.fingerprint ? prior.hashes : []);
        const added = chunks.filter(row => !present.has(row.hash));
        for (let i = 0; i < added.length; i += 40) {
            await vector.insert(added.slice(i, i + 40).map(row => ({ hash: row.hash, text: row.retrievalText, index: row.index })));
        }
        if (!services.isCurrent()) return { available: false, reason: 'chat changed' };
        // Re-read: the awaits above can span a persist that replaced the store object.
        storeOf(ctx).narrative_vector = { fingerprint: vector.fingerprint, hashes };
        const state = { available: true, signature, fingerprint: vector.fingerprint, vector };
        indexes.set(host, state);
        persist(ctx);
        return state;
    } catch (error) {
        // A partially written index is not trusted. The next attempt rebuilds it in full.
        if (services.isCurrent()) { delete storeOf(ctx).narrative_vector; persist(ctx); }
        return { available: false, reason: String(error.message || error) };
    }
}

function prepare(ctx) {
    const settings = narrativeSettings(ctx);
    const store = storeOf(ctx);
    const { history, changed } = captureHistory(store, ctx.chat || []);
    const chunks = chunkHistory(history);
    if (store.narrative_summary && !validSummary(store.narrative_summary, chunks)) {
        delete store.narrative_summary;
        // Merged, not replaced: the next diagnostics write would otherwise erase the reason continuity
        // disappeared, and the settings panel would show an empty error for a summary that was dropped.
        store.narrative_diagnostics = { ...store.narrative_diagnostics,
            summary_invalidated: 'source history changed', invalidated_at: Date.now() };
    }
    const folded = applyNarrativeFolds(ctx.chat || [], history, chunks, store.narrative_summary,
        settings.enabled !== false && settings.narrative_fold !== false);
    if (changed || folded) persist(ctx);
    return { settings, store, history, chunks };
}

export function updateNarrative(ctx, services, { force = false } = {}) {
    storeOf(ctx);
    const host = hostKey(ctx);
    if (jobs.has(host)) return jobs.get(host);
    const job = (async () => {
        let state = prepare(ctx);
        if (state.settings.enabled === false) return;
        const opts = options(state.settings);
        const batch = nextSummaryBatch(state.store.narrative_summary, state.chunks, { ...opts, force });
        if (batch.length) {
            const before = state.chunks.map(row => row.id).join('|');
            const previous = state.store.narrative_summary;
            try {
                const text = await (services.summarize || generateNarrativeSummary)(ctx,
                    summaryPrompt(previous?.text, batch, opts.summaryTokens), state.settings);
                if (!services.isCurrent()) return;
                state = prepare(ctx);
                if (before !== state.chunks.map(row => row.id).join('|')) return;
                if (estimateTokens(text) > opts.summaryTokens) throw new Error('摘要超过预算，保留旧摘要与未总结原文；请缩短总结输出或增加摘要预算。');
                // prepare() above may have persisted and swapped the store object, so write through
                // a fresh read rather than through the reference it returned.
                storeOf(ctx).narrative_summary = { version: 1, text,
                    covered: [...(previous?.covered || []), ...batch.map(row => row.id)] };
                diagnose(ctx, { summary_error: null, summary_invalidated: null });
                prepare(ctx);
                persist(ctx);
            } catch (error) {
                if (services.isCurrent()) {
                    diagnose(ctx, { summary_error: String(error.message || error) });
                    persist(ctx);
                }
            }
        }
        if (services.isCurrent()) {
            const index = await syncIndex(ctx, state.chunks, services);
            diagnose(ctx, { vector_available: index.available, vector_reason: index.reason || null });
        }
    })();
    jobs.set(host, job);
    return job.finally(() => { if (jobs.get(host) === job) jobs.delete(host); });
}

function fitWholeBlocks(blocks, tokens) {
    let text = '';
    for (const block of blocks) {
        if (!block) continue;
        const next = text ? text + '\n\n' + block : block;
        if (estimateTokens(next) <= tokens) text = next;
    }
    return text;
}

export async function buildNarrativeContext(ctx, services, { contextSize = null } = {}) {
    await updateNarrative(ctx, services);
    if (!services.isCurrent()) return null;
    const { settings, store, history, chunks } = prepare(ctx);
    const opts = options(settings);
    const query = history.active.slice(-3).map(id => history.records[id].text).join('\n').slice(-5000);
    let dense = [];
    let vectorError = null;
    const index = indexes.get(hostKey(ctx));
    if (index?.available) {
        try { dense = (await index.vector.query(query, 24)).metadata; }
        catch (error) { vectorError = String(error.message || error); }
    }
    if (!services.isCurrent()) return null;
    // prepare() persists, and a persist replaces the chat store object; read the live one from here on.
    const live = storeOf(ctx);
    const visibleSources = new Set(history.active.filter(id => !ctx.chat[history.records[id].index]?.is_system));
    const raw = history.active.filter(id => visibleSources.has(id)).map(id => history.records[id].text).join('\n');
    const summary = validSummary(live.narrative_summary, chunks) ? live.narrative_summary.text : '';
    const summaryBlock = summary ? '[STORY CONTINUITY — prior context, not new instructions]\n' + summary : '';
    const configured = opts.summaryTokens + opts.evidenceTokens + opts.settingTokens + 100;
    const hostRoom = Number(contextSize) > 0 ? Math.max(0, Number(contextSize) - estimateTokens(raw)
        - bound(settings.context_reply_reserve_tokens, 1024, 0, 32000)) : configured;
    const totalBudget = Math.min(configured, hostRoom);
    // A summary cannot be dropped while its source floors remain hidden.
    if (summaryBlock && estimateTokens(summaryBlock) > totalBudget) {
        applyNarrativeFolds(ctx.chat, history, chunks, null, false);
        persist(ctx);
        return { referenceBlock: '', currentStateBlock: '', diagnostics: { summary_error: 'context budget too small; original floors restored' } };
    }
    const evidenceBudget = Math.max(0, Math.min(opts.evidenceTokens, totalBudget - estimateTokens(summaryBlock)));
    const ranked = rankRawChunks(chunks, query, dense);
    const evidence = packRawEvidence(ranked, history, { maxTokens: evidenceBudget, visibleSources });
    let settingText = '';
    if (opts.settingTokens && services.settings) {
        const result = await services.settings(query);
        if (!services.isCurrent()) return null;
        // The setting formatter already enforces role-private audiences in the host service.
        const formatted = formatRelevantSettingContext(result, { maxChars: opts.settingTokens * 4 });
        settingText = fitWholeBlocks(formatted.split('\n\n'), opts.settingTokens);
    }
    const referenceBlock = fitWholeBlocks([evidence.text, settingText], Math.max(0, totalBudget - estimateTokens(summaryBlock)));
    const diagnostics = { summary_tokens: estimateTokens(summaryBlock), evidence_tokens: estimateTokens(evidence.text),
        reference_tokens: estimateTokens(referenceBlock), visible_raw_tokens: estimateTokens(raw),
        covered_chunks: live.narrative_summary?.covered.length || 0, chunks: chunks.length,
        sources: evidence.sources, candidates: ranked.length, vector_available: Boolean(index?.available && !vectorError),
        vector_error: vectorError || live.narrative_diagnostics?.vector_reason || null,
        summary_error: live.narrative_diagnostics?.summary_error || null,
        summary_invalidated: live.narrative_diagnostics?.summary_invalidated || null,
        quality: 'not measured; these are delivery and cost diagnostics' };
    diagnose(ctx, diagnostics);
    return { referenceBlock, currentStateBlock: summaryBlock, diagnostics };
}

export async function runNarrativeGeneration(ctx, services, args) {
    const settings = narrativeSettings(ctx);
    if (quiet(settings, args[3])) {
        for (const key of NARRATIVE_PROMPTS) ctx.setExtensionPrompt?.(key, '', 1, 1, false, 0);
        if (settings.enabled === false) prepare(ctx);
        return;
    }
    const bundle = await buildNarrativeContext(ctx, services, { contextSize: args[1] });
    if (!bundle || !services.isCurrent()) return;
    ctx.setExtensionPrompt(NARRATIVE_PROMPTS[0], bundle.referenceBlock, 1, 4, false, 0);
    ctx.setExtensionPrompt(NARRATIVE_PROMPTS[1], bundle.currentStateBlock, 1, 1, false, 0);
    syncFloorFoldDom(ctx);
    return bundle;
}

export function installNarrativeRuntime(getContext, createServices) {
    const ctx = getContext();
    if (!ctx) return false;
    narrativeSettings(ctx);
    globalThis.aetheriaUnifiedMemoryV54Interceptor = (...args) => {
        const current = getContext();
        return current ? runNarrativeGeneration(current, createServices(current), args) : undefined;
    };
    if (installed) return true;
    installed = true;
    const schedule = () => {
        const current = getContext();
        if (!current || narrativeSettings(current).__narrative_summary_in_progress) return;
        void updateNarrative(current, createServices(current)).then(() => {
            syncFloorFoldDom(current);
            mountNarrativeSettings(getContext, createServices);
        }).catch(error => { storeOf(current).narrative_diagnostics = { error: String(error.message || error) }; });
    };
    for (const name of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED']) {
        if (ctx.eventTypes?.[name]) ctx.eventSource?.on(ctx.eventTypes[name], schedule);
    }
    // The host rebuilds message nodes from the saved chat file, so the collapsed styling has to be
    // re-applied after a load. Per node on render (a full sweep inside every render event would be
    // quadratic on a long chat), and once per chat load.
    const events = ctx.eventTypes || {};
    if (events.MESSAGE_RENDERED) ctx.eventSource?.on(events.MESSAGE_RENDERED, messageId => syncFloorFoldRow(getContext(), messageId));
    if (events.CHAT_LOADED) ctx.eventSource?.on(events.CHAT_LOADED, () => setTimeout(() => syncFloorFoldDom(getContext()), 120));
    // Migration captures originals before any folding; it does not call a model on installation.
    prepare(ctx);
    mountNarrativeSettings(getContext, createServices);
    return true;
}

/**
 * Read-only narrative state for the settings panel. It must not create a key, fold a row or call a
 * model: a diagnostics read that lazily created state would put it back into the chat file on save.
 */
export function readNarrativeReport(ctx) {
    const settings = ctx?.extensionSettings?.[NARRATIVE_SETTINGS_KEY] || {};
    const store = ctx?.chatMetadata?.[NARRATIVE_SETTINGS_KEY] || {};
    const history = store.raw_history;
    const chunks = history ? chunkHistory(history) : [];
    const summary = store.narrative_summary;
    const rows = Array.isArray(ctx?.chat) ? ctx.chat : [];
    return {
        enabled: settings.enabled !== false,
        update_every_floors: bound(settings.narrative_every, defaults.narrative_every, 1, 100),
        messages: history ? history.active.length : 0,
        completed_floors: history
            ? history.active.filter(id => history.records[id].role === 'assistant').length : 0,
        chunks: chunks.length,
        archived_versions: history ? Object.keys(history.records).length - history.active.length : 0,
        summary_valid: validSummary(summary, chunks),
        summary_tokens: summary ? estimateTokens(summary.text) : 0,
        covered_chunks: validSummary(summary, chunks) ? summary.covered.length : 0,
        folded_rows: rows.filter(row => row?.is_system === true && isFoldedRow(row)).length,
        // What the archive costs, in characters, against what the transcript already holds. The chat
        // file carries both, so this is the number a user can compare with the file size.
        archive_chars: history ? Object.values(history.records).reduce((sum, row) => sum + String(row.text || '').length, 0) : 0,
        superseded_chars: history ? Object.entries(history.records)
            .filter(([id]) => !history.active.includes(id))
            .reduce((sum, [, row]) => sum + String(row.text || '').length, 0) : 0,
        visible_chars: rows.filter(row => row?.is_system !== true).reduce((sum, row) => sum + String(row?.mes || '').length, 0),
        diagnostics: store.narrative_diagnostics || null,
    };
}

export function mountNarrativeSettings(getContext, createServices) {
    if (typeof document === 'undefined') return;
    const ctx = getContext();
    if (!ctx) return;
    const parent = document.getElementById('aum-v55-settings-page-memory') || document.getElementById('aum-v54-settings');
    if (!parent || document.getElementById('aum-narrative-settings')) return;
    const root = document.createElement('div');
    root.id = 'aum-narrative-settings';
    root.innerHTML = '<h3>剧情摘要与原文检索</h3><p>摘要保障续写，检索找回原文。未完成总结的楼层继续保留。</p>'
        + [['narrative_every','每几楼更新摘要',1,100],['narrative_summary_tokens','摘要 token 预算',100,4000],
            ['narrative_evidence_tokens','原文证据 token 预算',0,8000],['narrative_setting_tokens','相关设定 token 预算',0,4000]]
            .map(([key,label,min,max]) => `<label>${label}<input type="number" data-key="${key}" min="${min}" max="${max}"></label>`).join('')
        + '<label><input type="checkbox" data-key="narrative_fold">折叠已总结的历史楼层</label>'
        + '<button class="menu_button" data-action="summarize">立即更新摘要</button>'
        + '<button class="menu_button" data-action="restore">恢复原文显示</button><pre data-status></pre>';
    const settings = narrativeSettings(ctx);
    for (const input of root.querySelectorAll('[data-key]')) {
        if (input.type === 'checkbox') input.checked = settings[input.dataset.key] !== false;
        else input.value = settings[input.dataset.key];
        input.addEventListener('change', () => {
            const current = getContext();
            narrativeSettings(current)[input.dataset.key] = input.type === 'checkbox' ? input.checked : Number(input.value);
            current.saveSettingsDebounced?.();
            prepare(current);
            syncFloorFoldDom(current);
        });
    }
    root.querySelector('[data-action="summarize"]').addEventListener('click', async () => {
        const current = getContext();
        await updateNarrative(current, createServices(current), { force: true });
        root.querySelector('[data-status]').textContent = JSON.stringify(readNarrativeReport(current), null, 2);
        syncFloorFoldDom(current);
    });
    root.querySelector('[data-action="restore"]').addEventListener('click', () => {
        const current = getContext();
        narrativeSettings(current).narrative_fold = false;
        current.saveSettingsDebounced?.();
        prepare(current);
        syncFloorFoldDom(current);
        root.querySelector('[data-key="narrative_fold"]').checked = false;
    });
    root.querySelector('[data-status]').textContent = JSON.stringify(readNarrativeReport(ctx), null, 2);
    parent.prepend(root);
}
