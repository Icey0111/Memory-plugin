import { captureHistory, chunkHistory, rankRawChunks, validSummary, nextSummaryBatch,
    summaryPrompt, applyNarrativeFolds, packRawEvidence, parseAnchors, formatAnchors, mergeAnchors,
    mergeKnowledge, completedUserTurns } from './raw-history.js';
import { estimateTokens } from './v55-tokenizer.js';
import { formatRelevantSettingContext } from './setting-retriever.js';
import { recordModelCall } from './v55-metrics.js';
import { requestSummary } from './summary-transport.js';
import { isFoldedRow, fnv1a32 } from './memory-core.js';
import { syncFloorFoldDom, syncFloorFoldRow } from './v55-floor-fold.js';

export const NARRATIVE_SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
export const NARRATIVE_PROMPTS = ['aetheria_unified_memory_v5_4_reference', 'aetheria_unified_memory_v5_4_current_state'];
const defaults = { narrative_every: 10, narrative_summary_tokens: 600, narrative_evidence_tokens: 1000,
    narrative_setting_tokens: 400, narrative_input_chars: 18000, narrative_fold: true,
    // Guards. The pipeline can fail quietly in exactly two ways, and both are worse than an error,
    // because the story keeps working while the memory behind it stops: the summary job keeps failing
    // while the unsummarized tail grows into the prompt, or the tail simply outgrows what anyone
    // notices. Neither is prevented by a budget - the tail is host text, not injected text - so both
    // are reported with a threshold instead of being left to be discovered later.
    narrative_pending_warn_tokens: 4000, narrative_summary_failure_warn: 3,
    // Continuity anchors: the commitments, ownership, secrets and life states that must survive every
    // rewrite. They are re-fed to the summarizer and re-injected verbatim, so they stop depending on
    // the model remembering to carry them forward in prose.
    narrative_anchor_tokens: 300, narrative_anchor_unconfirmed_warn: 2,
    // Who knows what. Carried as its own block for the same reason as the anchors: a character
    // silently learning a secret is a story change that no amount of prose quality fixes.
    narrative_knowledge_tokens: 200,
    // The optional cross-encoder stage. Empty model means off, which is what an install that has not
    // configured a reranker keeps: the fused order, and no extra call per generation.
    narrative_rerank_model: '', narrative_rerank_candidates: 24 };
// Both maps are keyed by the host's chat-metadata object, not by the chat store object: the store
// projection replaces the store on a persist, so a store-keyed map would lose the running job and the
// live index on exactly the turns that wrote something. The metadata object is stable for a chat and
// is replaced when the user switches chats, which is the scope both maps want.
const jobs = new WeakMap();
const indexes = new WeakMap();
const indexJobs = new WeakMap();
const summaryRequests = new WeakSet();
const hostKey = ctx => ctx.chatMetadata || storeOf(ctx);
let installed = false;

export function narrativeSettings(ctx) {
    const settings = ctx.extensionSettings[NARRATIVE_SETTINGS_KEY] ??= {};
    settings.narrative_pipeline = true;
    for (const [key, value] of Object.entries(defaults)) if (settings[key] === undefined) settings[key] = value;
    return settings;
}

const bound = (value, fallback, min, max) => Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;

function options(settings) {
    return { pendingWarnTokens: bound(settings.narrative_pending_warn_tokens, 4000, 200, 200000),
        failureWarn: bound(settings.narrative_summary_failure_warn, 3, 1, 50),
        anchorTokens: bound(settings.narrative_anchor_tokens, 300, 0, 4000),
        anchorUnconfirmedWarn: bound(settings.narrative_anchor_unconfirmed_warn, 2, 1, 20),
        knowledgeTokens: bound(settings.narrative_knowledge_tokens, 200, 0, 4000),
        every: bound(settings.narrative_every, 10, 1, 100),
        summaryTokens: bound(settings.narrative_summary_tokens, 600, 100, 4000),
        evidenceTokens: bound(settings.narrative_evidence_tokens, 1000, 0, 8000),
        settingTokens: bound(settings.narrative_setting_tokens, 400, 0, 4000),
        inputChars: bound(settings.narrative_input_chars, 18000, 2000, 100000),
        rerankModel: String(settings.narrative_rerank_model || '').trim(),
        rerankCandidates: bound(settings.narrative_rerank_candidates, 24, 0, 64) };
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
    return settings.enabled === false || type === 'impersonate'
        || (type === 'quiet' && settings.quiet_allow_third_party_injection !== true);
}

export async function generateNarrativeSummary(ctx, prompt, settings) {
    summaryRequests.add(settings);
    let result;
    try {
        result = await requestSummary(ctx, prompt, settings);
        diagnose(ctx, { summary_response: result.metrics });
    } finally {
        summaryRequests.delete(settings);
    }
    const text = result.text;
    if (['length', 'max_tokens'].includes(result.metrics.finish_reason)) {
        throw new Error('总结输出被截断：finish_reason=' + result.metrics.finish_reason
            + '，正文 ' + text.length + ' 字符，推理 ' + result.metrics.reasoning_tokens + ' token；保留旧状态。');
    }
    if (!text || /^\[(?:API\s*(?:错误|error)|error|错误)\]/i.test(text)
        || (text.length < 800 && /rate limit|too many requests|quota exhausted|invalid api key|HTTP\s*[45]\d\d/i.test(text))) {
        throw new Error('总结接口没有返回正文（若模型是推理模型，token 预算可能被推理耗尽：'
            + '请提高总结 token 预算，或为总结单独配置一个非推理连接）；未总结原文继续保留。');
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
    if (!vector.supported) { indexes.delete(host); return { available: false, reason: vector.reason || 'vector unavailable' }; }
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
        indexes.delete(host);
        // A partially written index is not trusted. The next attempt rebuilds it in full.
        if (services.isCurrent()) { delete storeOf(ctx).narrative_vector; persist(ctx); }
        return { available: false, reason: String(error.message || error) };
    }
}

async function ensureIndex(ctx, chunks, services) {
    const key = hostKey(ctx);
    if (indexJobs.has(key)) await indexJobs.get(key);
    if (!services.isCurrent()) return { available: false, reason: 'chat changed' };
    const job = syncIndex(ctx, chunks, services);
    indexJobs.set(key, job);
    try { return await job; }
    finally { if (indexJobs.get(key) === job) indexJobs.delete(key); }
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
    // All three projections have the same source lineage. A history edit must invalidate the whole
    // state, including bindings that would otherwise outlive the prose they came from.
    if (!store.narrative_summary) {
        delete store.narrative_anchors;
        delete store.narrative_knowledge;
    } else {
        const revision = fnv1a32(store.narrative_summary.covered.join('|')).toString(36);
        const mismatch = [store.narrative_anchors, store.narrative_knowledge].some(value =>
            value?.source_revision && value.source_revision !== revision);
        if (mismatch) {
            delete store.narrative_summary;
            delete store.narrative_anchors;
            delete store.narrative_knowledge;
            store.narrative_diagnostics = { ...store.narrative_diagnostics, summary_invalidated: 'state source revision mismatch' };
        } else {
            // Bind migrated v1 state to its still-valid summary once. No independent authority.
            for (const value of [store.narrative_anchors, store.narrative_knowledge]) if (value) value.source_revision = revision;
        }
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
            const before = state.chunks.map(row => row.id);
            const previous = state.store.narrative_summary;
            const previousAnchors = state.store.narrative_anchors;
            try {
                const previousKnowledge = state.store.narrative_knowledge;
                const text = await (services.summarize || generateNarrativeSummary)(ctx,
                    summaryPrompt(previous?.text, batch, opts.summaryTokens, previousAnchors?.active,
                        previousKnowledge?.entries), state.settings);
                if (!services.isCurrent()) return;
                state = prepare(ctx);
                if (!before.every((id, i) => id === state.chunks[i]?.id) || state.settings.enabled === false) return;
                const parsed = parseAnchors(text);
                if (!parsed.summary) throw new Error('总结接口只返回了锚点，没有摘要正文；保留旧摘要与未总结原文。');
                if (estimateTokens(parsed.summary) > opts.summaryTokens) throw new Error('摘要超过预算，保留旧摘要与未总结原文；请缩短总结输出或增加摘要预算。');
                // prepare() above may have persisted and swapped the store object, so write through
                // a fresh read rather than through the reference it returned.
                const live = storeOf(ctx);
                live.narrative_summary = { version: 1, text: parsed.summary,
                    covered: [...(previous?.covered || []), ...batch.map(row => row.id)] };
                // A missing section is not a resolution: without it the anchors are left exactly as they
                // were, because dropping them on a format slip would lose the facts this feature exists
                // to protect.
                if (parsed.sections === 'ok') {
                    live.narrative_anchors = mergeAnchors(previousAnchors, parsed);
                    live.narrative_knowledge = mergeKnowledge(previousKnowledge, parsed);
                } else {
                    if (previousAnchors?.active?.length) live.narrative_anchors = { ...previousAnchors,
                        active: previousAnchors.active.map(item => ({ ...item, unconfirmed: (Number(item.unconfirmed) || 0) + 1 })),
                        parse: 'missing', updated_at: Date.now() };
                    if (previousKnowledge?.entries?.length) live.narrative_knowledge = { ...previousKnowledge,
                        entries: previousKnowledge.entries.map(item => ({ ...item, unconfirmed: (Number(item.unconfirmed) || 0) + 1 })),
                        parse: 'missing', updated_at: Date.now() };
                }
                const revision = fnv1a32(live.narrative_summary.covered.join('|')).toString(36);
                for (const value of [live.narrative_anchors, live.narrative_knowledge]) if (value) value.source_revision = revision;
                diagnose(ctx, { summary_error: null, summary_invalidated: null, summary_failures: 0,
                    anchor_parse: parsed.sections });
                prepare(ctx);
                persist(ctx);
            } catch (error) {
                if (services.isCurrent()) {
                    // Counted, not just recorded: one failure is noise, a run of them is the warning.
                    const failures = Number(storeOf(ctx).narrative_diagnostics?.summary_failures) || 0;
                    diagnose(ctx, { summary_error: String(error.message || error), summary_failures: failures + 1 });
                    persist(ctx);
                }
            }
        }
        if (services.isCurrent()) {
            const index = await ensureIndex(ctx, state.chunks, services);
            diagnose(ctx, { vector_available: index.available, vector_reason: index.reason || null });
        }
    })();
    jobs.set(host, job);
    return job.finally(() => { if (jobs.get(host) === job) jobs.delete(host); });
}

/**
 * How much original text the accepted summary has not reached yet, and the warnings that follow.
 *
 * A summary that keeps failing does not break the story: the floors stay visible, which is the safe
 * direction. What it does break is the premise - the prompt grows with the chat again, and the only
 * symptom is a diagnostic nobody reads. These two numbers are that symptom, stated where a user will
 * see them.
 */
function pendingState(store, chunks) {
    const covered = validSummary(store.narrative_summary, chunks) ? store.narrative_summary.covered.length : 0;
    const pending = chunks.slice(covered);
    return {
        covered,
        pending_floors: completedUserTurns(pending),
        pending_tokens: pending.length ? estimateTokens(pending.map(row => row.retrievalText).join('\n')) : 0,
    };
}

function warningsFor(state, opts) {
    const out = [];
    if (state.summary_failures >= opts.failureWarn) {
        out.push('摘要连续 ' + state.summary_failures + ' 次失败；原文保持可见，但常驻提示词会随楼层增长。'
            + (state.summary_error ? ' 最后一次：' + state.summary_error : ''));
    }
    if (state.pending_tokens >= opts.pendingWarnTokens) {
        out.push('已有 ' + state.pending_floors + ' 个已完成 user turns / 约 ' + state.pending_tokens
            + ' token 原文尚未进入摘要；检查总结接口或调整总结间隔。');
    }
    if (state.anchors_unconfirmed >= opts.anchorUnconfirmedWarn) {
        out.push('有 ' + state.anchors_unconfirmed + ' 条锚点已连续多轮未被总结重复；它们仍在注入，但请检查总结格式。');
    }
    if (state.knowledge_unconfirmed >= opts.anchorUnconfirmedWarn) {
        out.push('有 ' + state.knowledge_unconfirmed + ' 条知情边界已连续多轮未被总结重复；它们仍在注入，但请检查总结格式。');
    }
    if (state.knowledge_duplicate_subjects > 0) {
        out.push('有 ' + state.knowledge_duplicate_subjects + ' 个角色在知情边界里占了多行（最多 '
            + state.knowledge_max_per_subject + ' 行）；每个角色应当只有一行，否则同一个角色的两行可以互相矛盾。');
    }
    if (state.anchors_truncated > 0) {
        out.push('锚点超出注入预算，已省略 ' + state.anchors_truncated + ' 条；调高“锚点 token 预算”或清理已解决的锚点。');
    }
    return out;
}

/** Whole anchor lines only: half a commitment is worse than none. */
function fitLines(lines, tokens) {
    let text = '';
    for (const line of lines) {
        const next = text ? text + '\n' + line : line;
        if (estimateTokens(next) > tokens) break;
        text = next;
    }
    return text;
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

/**
 * The optional cross-encoder stage.
 *
 * It reranks the fused shortlist only. It is fail-open on purpose: no model, no transport or a failed call
 * all leave the fused order exactly as it was, because a prompt with a worse order is still a prompt and a
 * prompt with no retrieval is not. The shortlist is capped so the cost is a fixed number of documents per
 * generation rather than a function of the archive size.
 */
async function applyRerank(services, opts, query, ranked, visibleSources) {
    const model = opts.rerankModel;
    if (!model || !opts.rerankCandidates || ranked.length < 2) return { ranked, used: false, error: null };
    // Only candidates the prompt does not already show can become evidence, so a shortlist that is
    // entirely visible has nothing to reorder. Measured on a live run: while every floor was still
    // unfolded, this stage spent a model call on each of twenty turns and quoted nothing.
    const eligible = ranked.filter(row => !visibleSources.has(row.chunk.source));
    if (eligible.length < 2) return { ranked, used: false, error: null };
    const service = typeof services.rerank === 'function' ? services.rerank() : null;
    if (!service || !service.supported) return { ranked, used: false, error: null };
    const shortlist = eligible.slice(0, opts.rerankCandidates);
    try {
        const order = await service.rerank(query, shortlist.map(row => row.chunk.retrievalText), model);
        const score = new Map(order.map(row => [row.index, row.score]));
        const head = shortlist.map((row, index) => ({ ...row, rerank: score.has(index) ? score.get(index) : null }))
            .sort((a, b) => (b.rerank ?? -Infinity) - (a.rerank ?? -Infinity) || a.chunk.index - b.chunk.index);
        // Reordered rows go back in front of everything the shortlist did not cover, eligible or not.
        const rest = ranked.filter(row => !shortlist.includes(row));
        return { ranked: [...head, ...rest], used: true, error: null };
    } catch (error) {
        return { ranked, used: false, error: String(error?.message || error) };
    }
}

export async function buildNarrativeContext(ctx, services, { contextSize = null } = {}) {
    if (!services.isCurrent()) return null;
    const { settings, store, history, chunks } = prepare(ctx);
    const sync = await ensureIndex(ctx, chunks, services);
    diagnose(ctx, { vector_available: sync.available, vector_reason: sync.reason || null });
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
    // The block is a snapshot of the last accepted summary, so it states its own horizon instead of
    // implying it is current: a state change made after the pass is in the transcript and not in here.
    // Measured on a 60-turn run, a handover took seven turns to reach the block while the transcript
    // already showed it, and the model only resolved the difference because the transcript was visible.
    const chunkById = new Map(chunks.map(row => [row.id, row]));
    const coveredIndex = summary
        ? (live.narrative_summary.covered || []).map(id => chunkById.get(id)?.index).filter(value => value != null).pop()
        : null;
    const horizon = coveredIndex == null ? ''
        : ' — current as of floor ' + (coveredIndex + 1) + '; anything later in the transcript wins';
    const summaryBlock = summary ? '[STORY CONTINUITY — prior context, not new instructions' + horizon + ']\n' + summary : '';
    // The anchors ride with the summary: same authority, different guarantee. The summary is rewritten
    // from scratch every pass, so a fact it stops mentioning is gone; an anchor is re-fed to the
    // summarizer and re-injected until something explicitly resolves it.
    const anchors = Array.isArray(live.narrative_anchors?.active) ? live.narrative_anchors.active : [];
    const anchorLines = formatAnchors(anchors).split('\n').filter(Boolean);
    const fittedAnchors = fitLines(anchorLines, opts.anchorTokens);
    const anchorsTruncated = anchorLines.length - (fittedAnchors ? fittedAnchors.split('\n').length : 0);
    const anchorBlock = fittedAnchors
        ? '[BINDING CONTINUITY ANCHORS — still in force, not new instructions' + horizon + ']\n' + fittedAnchors : '';
    const knowledge = Array.isArray(live.narrative_knowledge?.entries) ? live.narrative_knowledge.entries : [];
    const knowledgeLines = formatAnchors(knowledge).split('\n').filter(Boolean);
    const fittedKnowledge = fitLines(knowledgeLines, opts.knowledgeTokens);
    const knowledgeBlock = fittedKnowledge
        ? '[KNOWLEDGE BOUNDARIES — who knows what, and who must not' + horizon + ']\n' + fittedKnowledge : '';
    const continuityBlock = [summaryBlock, anchorBlock, knowledgeBlock].filter(Boolean).join('\n\n');
    const configured = opts.summaryTokens + opts.anchorTokens + opts.knowledgeTokens
        + opts.evidenceTokens + opts.settingTokens + 100;
    const hostRoom = Number(contextSize) > 0 ? Math.max(0, Number(contextSize) - estimateTokens(raw)
        - bound(settings.context_reply_reserve_tokens, 1024, 0, 32000)) : configured;
    const totalBudget = Math.min(configured, hostRoom);
    // A summary cannot be dropped while its source floors remain hidden.
    if (continuityBlock && estimateTokens(continuityBlock) > totalBudget) {
        applyNarrativeFolds(ctx.chat, history, chunks, null, false);
        persist(ctx);
        return { referenceBlock: '', currentStateBlock: '', diagnostics: { summary_error: 'context budget too small; original floors restored' } };
    }
    const evidenceBudget = Math.max(0, Math.min(opts.evidenceTokens, totalBudget - estimateTokens(continuityBlock)));
    const fused = rankRawChunks(chunks, query, dense);
    const reranked = evidenceBudget > 0 ? await applyRerank(services, opts, query, fused, visibleSources)
        : { ranked: fused, used: false, error: null };
    // The rerank is a host round-trip, so it needs the same guard every other await here has: a result
    // that arrives after the user changed chats must not be packed into this prompt.
    if (!services.isCurrent()) return null;
    const ranked = reranked.ranked;
    const evidence = packRawEvidence(ranked, history, { maxTokens: evidenceBudget, visibleSources });
    let settingText = '';
    if (opts.settingTokens && services.settings) {
        const result = await services.settings(query);
        if (!services.isCurrent()) return null;
        // The setting formatter already enforces role-private audiences in the host service.
        const formatted = formatRelevantSettingContext(result, { maxChars: opts.settingTokens * 4 });
        settingText = fitWholeBlocks(formatted.split('\n\n'), opts.settingTokens);
    }
    const referenceBlock = fitWholeBlocks([evidence.text, settingText], Math.max(0, totalBudget - estimateTokens(continuityBlock)));
    const pending = pendingState(live, chunks);
    const warnings = warningsFor({ ...pending, summary_failures: Number(live.narrative_diagnostics?.summary_failures) || 0,
        summary_error: live.narrative_diagnostics?.summary_error || null,
        anchors_unconfirmed: anchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: anchorsTruncated,
        knowledge_unconfirmed: knowledge.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(live.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(live.narrative_knowledge?.max_per_subject) || 0 }, opts);
    const diagnostics = { summary_tokens: estimateTokens(summaryBlock), evidence_tokens: estimateTokens(evidence.text),
        reference_tokens: estimateTokens(referenceBlock), visible_raw_tokens: estimateTokens(raw),
        covered_chunks: live.narrative_summary?.covered.length || 0, chunks: chunks.length,
        pending_floors: pending.pending_floors, pending_tokens: pending.pending_tokens,
        summary_failures: Number(live.narrative_diagnostics?.summary_failures) || 0,
        anchors_active: anchors.length,
        anchors_unconfirmed: anchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: anchorsTruncated,
        state_horizon_floors: coveredIndex == null ? null : coveredIndex + 1,
        knowledge_entries: knowledge.length,
        knowledge_unconfirmed: knowledge.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(live.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(live.narrative_knowledge?.max_per_subject) || 0,
        warnings,
        sources: evidence.sources, candidates: ranked.length,
        rerank_model: opts.rerankModel || null, rerank_used: reranked.used, rerank_error: reranked.error,
        channels: { lexical: ranked.filter(row => row.channels.includes('lexical')).length,
            vector: ranked.filter(row => row.channels.includes('vector')).length },
        vector_available: Boolean(index?.available && !vectorError),
        vector_error: vectorError || live.narrative_diagnostics?.vector_reason || null,
        summary_error: live.narrative_diagnostics?.summary_error || null,
        summary_invalidated: live.narrative_diagnostics?.summary_invalidated || null,
        quality: 'not measured; these are delivery and cost diagnostics' };
    diagnose(ctx, diagnostics);
    return { referenceBlock, currentStateBlock: continuityBlock, diagnostics };
}

export async function runNarrativeGeneration(ctx, services, args) {
    const settings = narrativeSettings(ctx);
    if (quiet(settings, args[3]) || (args[3] === 'quiet' && summaryRequests.has(settings))) {
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
    const settings = narrativeSettings(ctx);
    // A summary pass clears these in a finally block, which does not run when the page is torn down
    // mid-call - a reload, an app close. Because they live on the settings object they were persisted
    // with it, and a stale flag is poison: quiet() then skips every injection and schedule() skips every
    // capture, so the whole pipeline stops without a single warning. Nothing can legitimately be in
    // flight during a fresh install, so whatever is here is stale and is cleared. Found by running the
    // acceptance scenario twice in a row: the second run wrote twenty floors and produced no archive,
    // no summary, no anchors and no diagnostics at all.
    delete settings.__narrative_summary_in_progress;
    delete settings.__quiet_extraction_in_progress;
    globalThis.aetheriaUnifiedMemoryV54Interceptor = (...args) => {
        const current = getContext();
        return current ? runNarrativeGeneration(current, createServices(current), args) : undefined;
    };
    if (installed) return true;
    installed = true;
    const schedule = () => {
        const current = getContext();
        if (!current) return;
        prepare(current); // Capture edits even when another summary request is still running.
        void updateNarrative(current, createServices(current)).then(() => {
            syncFloorFoldDom(current);
            // A panel failure is a panel failure. It used to replace the whole diagnostics object, so a
            // thrown prepend erased the delivery report the panel exists to show.
            try { mountNarrativeSettings(getContext, createServices); }
            catch (error) { diagnose(current, { panel_error: String(error.message || error) }); }
        }).catch(error => { diagnose(current, { error: String(error.message || error) }); });
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
    const pending = pendingState(store, chunks);
    const failures = Number(store.narrative_diagnostics?.summary_failures) || 0;
    return {
        enabled: settings.enabled !== false,
        summary_running: jobs.has(hostKey(ctx)),
        cadence_unit: 'completed user turns (normally two message floors)',
        update_every_user_turns: bound(settings.narrative_every, defaults.narrative_every, 1, 100),
        update_every_floors: bound(settings.narrative_every, defaults.narrative_every, 1, 100),
        pending_floors: pending.pending_floors,
        pending_tokens: pending.pending_tokens,
        summary_failures: failures,
        anchors_active: (store.narrative_anchors?.active || []).length,
        anchors_unconfirmed: (store.narrative_anchors?.active || []).filter(item => Number(item.unconfirmed) > 0).length,
        anchors_resolved: (store.narrative_anchors?.resolved || []).length,
        anchor_parse: store.narrative_diagnostics?.anchor_parse || store.narrative_anchors?.parse || null,
        knowledge_entries: (store.narrative_knowledge?.entries || []).length,
        knowledge_unconfirmed: (store.narrative_knowledge?.entries || []).filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(store.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(store.narrative_knowledge?.max_per_subject) || 0,
        warnings: warningsFor({ ...pending, summary_failures: failures,
            summary_error: store.narrative_diagnostics?.summary_error || null,
            anchors_unconfirmed: (store.narrative_anchors?.active || []).filter(item => Number(item.unconfirmed) > 0).length,
            anchors_truncated: 0,
            knowledge_unconfirmed: (store.narrative_knowledge?.entries || []).filter(item => Number(item.unconfirmed) > 0).length,
            knowledge_duplicate_subjects: Number(store.narrative_knowledge?.duplicate_subjects) || 0,
            knowledge_max_per_subject: Number(store.narrative_knowledge?.max_per_subject) || 0 },
            options(settings)),
        messages: history ? history.active.length : 0,
        completed_floors: completedUserTurns(chunks),
        chunks: chunks.length,
        archived_versions: history ? Object.keys(history.records).length - history.active.length : 0,
        summary_valid: validSummary(summary, chunks),
        state_horizon_floors: store.narrative_diagnostics?.state_horizon_floors ?? null,
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
        + [['narrative_every','每几轮更新摘要（1 user turn 通常为 2 楼）',1,100],['narrative_summary_tokens','摘要 token 预算',100,4000],
            ['narrative_evidence_tokens','原文证据 token 预算',0,8000],['narrative_setting_tokens','相关设定 token 预算',0,4000],
            ['narrative_anchor_tokens','锚点 token 预算',0,4000],
            ['narrative_pending_warn_tokens','未总结原文告警阈值',200,200000],['narrative_summary_failure_warn','连续失败几次告警',1,50]]
            .map(([key,label,min,max]) => `<label>${label}<input type="number" data-key="${key}" min="${min}" max="${max}"></label>`).join('')
        + '<label>重排模型（留空则关闭，例如 jina-reranker-v3）<input type="text" data-key="narrative_rerank_model" data-text="1"></label>'
        + '<label><input type="checkbox" data-key="narrative_fold">折叠已总结的历史楼层</label>'
        + '<button class="menu_button" data-action="summarize">立即更新摘要</button>'
        + '<button class="menu_button" data-action="restore">恢复原文显示</button>'
        + '<div data-warning class="aum-v51-status"></div><pre data-status></pre>';
    const settings = narrativeSettings(ctx);
    for (const input of root.querySelectorAll('[data-key]')) {
        if (input.type === 'checkbox') input.checked = settings[input.dataset.key] !== false;
        else input.value = settings[input.dataset.key];
        input.addEventListener('change', () => {
            const current = getContext();
            narrativeSettings(current)[input.dataset.key] = input.type === 'checkbox' ? input.checked
                : input.dataset.text ? String(input.value).trim() : Number(input.value);
            current.saveSettingsDebounced?.();
            prepare(current);
            syncFloorFoldDom(current);
        });
    }
    root.querySelector('[data-action="summarize"]').addEventListener('click', async () => {
        const current = getContext();
        await updateNarrative(current, createServices(current), { force: true });
        renderNarrativePanel(root, current);
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
    // Mount first, then fill: a render that throws must not leave the panel unattached, and the append
    // belongs to the function whose scope owns the parent element. It used to sit in the renderer, where
    // the only 'parent' in scope is the browser's window.parent - so the panel never mounted and every
    // scheduled pass threw "parent.prepend is not a function" (found by the live acceptance run).
    parent.prepend(root);
    renderNarrativePanel(root, ctx);
    return true;
}

/** One place that writes the panel, so a warning cannot be shown on one path and lost on another. */
function renderNarrativePanel(root, ctx) {
    const report = readNarrativeReport(ctx);
    const warning = root.querySelector('[data-warning]');
    if (warning) {
        warning.textContent = report.warnings.length ? '⚠ ' + report.warnings.join(' ') : '';
        warning.hidden = !report.warnings.length;
    }
    root.querySelector('[data-status]').textContent = JSON.stringify(report, null, 2);
}
