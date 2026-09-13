import { captureHistory, chunkHistory, rankRawChunks, validSummary, nextSummaryBatch,
    summaryMessages, summaryRequest, summaryBlockState, stateRevisionOf, LEGACY_INPUT_CHARS_DEFAULT,
    applyNarrativeFolds, packRawEvidence, parseAnchors, formatAnchors, mergeAnchors,
    mergeKnowledge, completedUserTurns, entityRecall, profileRecall, askedThingRecall, normalizeKnowledgeEntries } from './raw-history.js';
import { planRetrievalQuery } from './retrieval-query.js';
import { rerankShortlist, applyRerankOrder } from './v55-rerank.js';
import { estimateTokens } from './v55-tokenizer.js';
import { formatRelevantSettingContext } from './setting-retriever.js';
import { recordModelCall } from './v55-metrics.js';
import { requestSummary } from './summary-transport.js';
import { isFoldedRow, fnv1a32 } from './memory-core.js';
import { syncFloorFoldDom, syncFloorFoldRow } from './v55-floor-fold.js';

export const NARRATIVE_SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
export const NARRATIVE_PROMPTS = ['aetheria_unified_memory_v5_4_reference', 'aetheria_unified_memory_v5_4_current_state'];
// narrative_input_chars is the default a NEW install gets. It is the measured size of a ten-turn batch on
// the chat that failed the first batching acceptance (23,742 characters), not the old 18000 that could not
// hold it. An install that already stored 18000 keeps it - that value may be a deliberate choice, and a
// silent overwrite would be a config change nobody asked for - and is told about the discrepancy instead.
const defaults = { narrative_every: 10, narrative_summary_tokens: 600, narrative_evidence_tokens: 1000,
    narrative_setting_tokens: 400, narrative_input_chars: 40000, narrative_fold: true,
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

/**
 * A failed summary is one of several different problems, and calling them all "the interface failed" is
 * how a size limit gets mistaken for a provider outage. Each throw names its stage here, where the
 * evidence still exists; the record that survives is built from it in updateNarrative.
 */
const FAILURE_STAGES = { transport: '传输或服务商错误', empty_body: '接口没有返回正文',
    truncated: '总结输出被截断', over_budget: '摘要正文超过接受预算', format: '只有锚点、没有摘要正文',
    input_budget: '本地输入预算不足', unknown: '未分类的失败' };
const stageLabel = stage => FAILURE_STAGES[stage] || FAILURE_STAGES.unknown;
const tagged = (stage, error, extra) => {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.stage = stage;
    if (extra) Object.assign(wrapped, extra);
    return wrapped;
};
/** One bounded string: a provider can answer with a paragraph, and this rides in the chat file. */
const bounded = (value, limit = 300) => {
    const text = String(value ?? '');
    return text.length > limit ? text.slice(0, limit) + '…' : text;
};

export async function generateNarrativeSummary(ctx, prompt, settings) {
    summaryRequests.add(settings);
    let result;
    try {
        result = await requestSummary(ctx, prompt, settings);
        diagnose(ctx, { summary_response: result.metrics });
    } catch (error) {
        throw tagged('transport', error);
    } finally {
        summaryRequests.delete(settings);
    }
    const text = result.text;
    if (['length', 'max_tokens'].includes(result.metrics.finish_reason)) {
        throw tagged('truncated', new Error('总结输出被截断：finish_reason=' + result.metrics.finish_reason
            + '，正文 ' + text.length + ' 字符，推理 ' + result.metrics.reasoning_tokens + ' token；保留旧状态。'),
            { response: result.metrics, summary_tokens: estimateTokens(text) });
    }
    if (!text || /^\[(?:API\s*(?:错误|error)|error|错误)\]/i.test(text)
        || (text.length < 800 && /rate limit|too many requests|quota exhausted|invalid api key|HTTP\s*[45]\d\d/i.test(text))) {
        throw tagged('empty_body', new Error('总结接口没有返回正文（若模型是推理模型，token 预算可能被推理耗尽：'
            + '请提高总结 token 预算，或为总结单独配置一个非推理连接）；未总结原文继续保留。'),
            { response: result.metrics, summary_tokens: estimateTokens(text) });
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
    let knowledgeNormalized = false;
    if (store.narrative_knowledge?.entries) {
        const normalized = normalizeKnowledgeEntries(store.narrative_knowledge.entries);
        if (JSON.stringify(normalized) !== JSON.stringify(store.narrative_knowledge.entries)) {
            const counts = new Map();
            for (const item of normalized) { const name = item.kind.split('/')[0]; counts.set(name, (counts.get(name) || 0) + 1); }
            store.narrative_knowledge = { ...store.narrative_knowledge, entries: normalized,
                duplicate_subjects: [...counts.values()].filter(n => n > 1).length,
                max_per_subject: Math.max(0, ...counts.values()) };
            knowledgeNormalized = true;
        }
    }
    const { history, changed } = captureHistory(store, ctx.chat || []);
    const chunks = chunkHistory(history);
    const legacy = store.narrative_summary;
    if (validSummary(legacy, chunks) && !legacy.fixed_batch) {
        const prefix = chunks.slice(0, legacy.covered.length);
        const count = completedUserTurns(prefix);
        const end = prefix.at(-1);
        if (!count || count % options(settings).every !== 0 || end.role !== 'assistant'
            || chunks[prefix.length]?.source === end.source) {
            delete store.narrative_summary;
            store.narrative_diagnostics = { ...store.narrative_diagnostics,
                summary_invalidated: 'legacy summary is not aligned to complete N-turn batches' };
            knowledgeNormalized = true;
        } else {
            legacy.fixed_batch = true;
            knowledgeNormalized = true;
        }
    }
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
        const revision = store.narrative_summary.source_revision
            || fnv1a32(store.narrative_summary.covered.join('|')).toString(36);
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
    if (changed || folded || knowledgeNormalized) persist(ctx);
    return { settings, store, history, chunks };
}

export function updateNarrative(ctx, services) {
    storeOf(ctx);
    const host = hostKey(ctx);
    if (jobs.has(host)) return jobs.get(host);
    const job = (async () => {
        let state = prepare(ctx);
        if (state.settings.enabled === false) return;
        const opts = options(state.settings);
        // Freeze the batch, the carried state and the request text before any await. Nothing after this
        // point adds material, and the text measured below is the text that is sent. prepare() persists
        // and can swap the store object, so the freeze reads the live store rather than the returned one.
        const frozen = storeOf(ctx);
        const batch = nextSummaryBatch(frozen.narrative_summary, state.chunks, { every: opts.every });
        if (!batch) return;
        const previous = frozen.narrative_summary;
        const previousAnchors = frozen.narrative_anchors;
        const previousKnowledge = frozen.narrative_knowledge;
        const request = summaryRequest(previous?.text, summaryMessages(state.history, batch),
            opts.summaryTokens, previousAnchors?.active, previousKnowledge?.entries);
        // The cost report is written before the budget is checked, so a blocked request and a failed
        // request still show what the request was made of. The context window is not known here and is
        // not implied: only the local character budget was measured.
        diagnose(ctx, { summary_cost: { ...request.parts, budget_chars: opts.inputChars, turns: batch.turns,
            prompt_tokens_estimated: estimateTokens(request.text),
            context_tokens: null, context_tokens_status: 'unknown' } });
        // A local input-budget shortfall is a block, not a model failure. Nothing was sent, nothing is
        // hidden, and re-checking the same frozen batch with the same budget is the same event.
        if (request.text.length > opts.inputChars) {
            diagnose(ctx, { summary_block: summaryBlockState(storeOf(ctx).narrative_diagnostics?.summary_block,
                { batch, request, inputChars: opts.inputChars, summaryTokens: opts.summaryTokens }) });
            persist(ctx);
            return;
        }
        const before = [...(previous?.covered || []), ...batch.covered];
        // The response record belongs to one attempt. Without this, a transport failure would report the
        // metrics of the last call that did return, which is a different failure entirely.
        diagnose(ctx, { summary_response: null });
        try {
            const text = await (services.summarize || generateNarrativeSummary)(ctx, request.text, state.settings);
            if (!services.isCurrent()) return;
            state = prepare(ctx);
            // The coverage claim comes from the frozen batch, never from the chat length at the end of
            // the call: an append during the request must not be summarized by a result it predates.
            if (!before.every((id, i) => id === state.chunks[i]?.id) || state.settings.enabled === false) return;
            const parsed = parseAnchors(text);
            const attemptResponse = storeOf(ctx).narrative_diagnostics?.summary_response || null;
            if (!parsed.summary) throw tagged('format', new Error('总结接口只返回了锚点，没有摘要正文；保留旧摘要与未总结原文。'),
                { response: attemptResponse, summary_tokens: estimateTokens(text) });
            const acceptedTokens = estimateTokens(parsed.summary);
            if (acceptedTokens > opts.summaryTokens) throw tagged('over_budget',
                new Error('摘要超过预算，保留旧摘要与未总结原文；请缩短总结输出或增加摘要预算。'),
                { response: attemptResponse, summary_tokens: acceptedTokens });
            // prepare() above may have persisted and swapped the store object, so write through
            // a fresh read rather than through the reference it returned.
            const live = storeOf(ctx);
            live.narrative_summary = { version: 1, fixed_batch: true, text: parsed.summary, covered: before };
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
            // Two versions, because they answer two questions: which sources this state read, and what
            // this state says. Only the second can tell an old injection from the current state, since
            // coverage is a count of floors and two different states can share it.
            const sourceRevision = fnv1a32(before.join('|')).toString(36);
            for (const value of [live.narrative_anchors, live.narrative_knowledge]) if (value) value.source_revision = sourceRevision;
            live.narrative_summary.source_revision = sourceRevision;
            live.narrative_summary.state_revision = stateRevisionOf(live.narrative_summary,
                live.narrative_anchors?.active, live.narrative_knowledge?.entries);
            const pastFailure = live.narrative_diagnostics?.summary_last_error;
            // Committing clears the current error, the block and the counter. It marks the last failure
            // recovered rather than erasing it: a failure that disappears the moment the retry works is
            // exactly the failure nobody can diagnose afterwards.
            diagnose(ctx, { summary_error: null, summary_invalidated: null, summary_failures: 0,
                summary_block: null, anchor_parse: parsed.sections,
                summary_last_error: pastFailure ? { ...pastFailure, recovered: true, recovered_at: Date.now(),
                    recovered_by: { source_revision: sourceRevision,
                        state_revision: live.narrative_summary.state_revision } } : null });
            prepare(ctx);
            persist(ctx);
        } catch (error) {
            if (services.isCurrent()) {
                // Counted, not just recorded: one failure is noise, a run of them is the warning. This
                // counter is for model-call failures only; a local budget block never reaches here.
                const live = storeOf(ctx);
                const stage = error?.stage || 'transport';
                const previousFailure = live.narrative_diagnostics?.summary_last_error;
                const batchId = [batch.sources[0], batch.sources.at(-1), batch.covered.length].join('|');
                const sameBatch = previousFailure && !previousFailure.recovered && previousFailure.batch_id === batchId;
                const failures = Number(live.narrative_diagnostics?.summary_failures) || 0;
                const response = error?.response || null;
                diagnose(ctx, { summary_error: String(error.message || error), summary_failures: failures + 1,
                    summary_last_error: {
                        at: Date.now(), stage, stage_label: stageLabel(stage),
                        reason: bounded(error?.message || error),
                        batch_id: batchId,
                        batch: { first: batch.sources[0], last: batch.sources.at(-1), turns: batch.turns,
                            covered: batch.covered.length, messages: batch.sources.length },
                        input_chars: request.text.length, input_tokens_estimated: estimateTokens(request.text),
                        budget_chars: opts.inputChars,
                        context_tokens: null, context_tokens_status: 'unknown',
                        summary_tokens: Number.isFinite(error?.summary_tokens) ? error.summary_tokens : null,
                        summary_budget_tokens: opts.summaryTokens,
                        response: response ? { finish_reason: response.finish_reason ?? null,
                            content_chars: response.content_chars ?? null,
                            completion_tokens: response.completion_tokens ?? null,
                            reasoning_tokens: response.reasoning_tokens ?? null,
                            model: response.model ?? null, transport: response.transport ?? null } : null,
                        attempt: sameBatch ? (Number(previousFailure.attempt) || 1) + 1 : 1,
                        recovered: false, recovered_at: null } });
                persist(ctx);
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
 * How much original text the accepted summary has not reached yet, and which condition that is.
 *
 * A summary that keeps failing does not break the story: the floors stay visible, which is the safe
 * direction. What it does break is the premise - the prompt grows with the chat again, and the only
 * symptom is a diagnostic nobody reads. The number alone cannot say which condition it is, though: the
 * same "nine turns pending" is a healthy batch filling up, a batch that is being written right now, or a
 * pipeline that has stopped. So the number is paired with a state, and only some states are faults.
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

/**
 * One word for "what is the summary subsystem doing", because the same pending count means different
 * things. Blocked and summarizing outrank the rest: a block will not clear itself, and a running pass is
 * progress rather than a fault however much text is waiting behind it.
 */
function summarizeState(state) {
    if (state.summary_block) return 'blocked';
    if (state.summarizing) return 'summarizing';
    if (state.summary_failures >= state.failureWarn) return 'failing';
    if (state.every && state.pending_floors >= state.every) return 'backlog';
    if (state.pending_floors > 0) return 'accumulating';
    return 'idle';
}

/**
 * Settings that are not wrong but are worth saying out loud once. The input budget is the one case: an
 * install that has the value this key used to default to cannot hold a ten-turn batch of long replies, and
 * guessing whether the user chose it would be worse than saying so. It is never overwritten.
 */
function noticesFor(settings) {
    const out = [];
    if (Number(settings.narrative_input_chars) === LEGACY_INPUT_CHARS_DEFAULT) {
        out.push('每批总结输入字符预算是旧默认值 ' + LEGACY_INPUT_CHARS_DEFAULT
            + '，完整十轮批次可能装不下（实测约 23,742 字符，需要约 24000 以上）。该值没有被自动覆盖，请按需调整。');
    }
    return out;
}

function warningsFor(state, opts) {
    const out = [];
    state = { ...state, failureWarn: opts.failureWarn,
        summary_state: summarizeState({ ...state, failureWarn: opts.failureWarn }) };
    // Two blockers that look alike to a user and are not: a request the local character budget cannot
    // hold (nothing was sent) and an interface that failed (something was). They are reported apart so
    // the fix is not guessed at, and a budget block is not counted as a model failure.
    if (state.summary_block) {
        out.push('本地输入预算不足：完整 ' + state.summary_block.turns + ' 轮的请求约 '
            + state.summary_block.needed_chars + ' 字符，超过每批总结输入字符预算 '
            + state.summary_block.budget_chars + ' 字符；没有调用模型，原文保持可见（同一批次已检查 '
            + state.summary_block.checks + ' 次）。请提高预算或缩短总结间隔。');
    }
    if (state.summary_failures >= opts.failureWarn) {
        out.push('摘要连续 ' + state.summary_failures + ' 次失败；原文保持可见，但常驻提示词会随楼层增长。'
            + (state.summary_error ? ' 最后一次：' + state.summary_error : ''));
    }
    // The tail is not a fault by itself: it is exactly the material the next batch will read, and right
    // after a commit a whole batch is normally waiting for the next event to consume it. The warning needs
    // both conditions - a full batch with nothing running, AND a tail past the size threshold. The size
    // alone no longer raises one, which is what made every batch cycle look like a fault.
    if (state.summary_state === 'backlog' && state.pending_tokens >= opts.pendingWarnTokens) {
        out.push('已有 ' + state.pending_floors + ' 个已完成 user turns（约 ' + state.pending_tokens
            + ' token）等待总结，但没有正在进行的总结任务；检查总结接口或调整总结间隔。');
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
/** How many situation-channel documents a rerank shortlist admits beyond its score-ordered head. */
const RERANK_ENTITY_EXTRA = 8;

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
    const pick = rerankShortlist(ranked, visibleSources, opts.rerankCandidates, RERANK_ENTITY_EXTRA);
    // Anything the situation channel claimed keeps a seat. That channel exists for the returning character
    // whose introduction ranked late, so the guarantee is worth as many extra documents as it claims terms.
    const started = performance.now();
    const cost = () => ({ elapsed_ms: Math.round(performance.now() - started), documents: pick.length,
        input_tokens_estimated: estimateTokens([query, ...pick.map(row => row.chunk.retrievalText)].join('\n')), provider_tokens: null });
    try {
        const order = await service.rerank(query, pick.map(row => row.chunk.retrievalText), model);
        return { ranked: applyRerankOrder(ranked, pick, order), used: true, error: null,
            metrics: order.metrics || cost() };
    } catch (error) {
        return { ranked, used: false, error: String(error?.message || error), metrics: cost() };
    }
}

/**
 * The three continuity blocks, composed for whatever state is committed right now.
 *
 * It is a function rather than a run of statements because the same state can have to be composed twice:
 * once while the rest of the prompt is assembled, and once more if a background summary committed during
 * one of those awaits. The transcript folding and the injected block have to describe one version, or the
 * rows the newer commit hid are neither in the summary nor in the visible transcript.
 */
function composeContinuity(store, chunks, opts) {
    const summaryValid = validSummary(store.narrative_summary, chunks);
    const coveredChunks = summaryValid ? store.narrative_summary.covered.length : 0;
    const summaryText = summaryValid ? store.narrative_summary.text : '';
    const floors = coveredChunks ? completedUserTurns(chunks.slice(0, coveredChunks)) : 0;
    const sourceRevision = summaryValid ? (store.narrative_summary.source_revision
        || fnv1a32(store.narrative_summary.covered.join('|')).toString(36)) : null;
    const anchors = Array.isArray(store.narrative_anchors?.active) ? store.narrative_anchors.active : [];
    const knowledge = Array.isArray(store.narrative_knowledge?.entries) ? store.narrative_knowledge.entries : [];
    // The coverage version and the content version are different questions, and only the second notices a
    // state that says something else about the same floors (raw-history.js, stateRevisionOf).
    const stateRevision = summaryValid ? stateRevisionOf(store.narrative_summary, anchors, knowledge) : null;
    // The block is a snapshot of the last accepted summary, so it states its own horizon instead of
    // implying it is current: a state change made after the pass is in the transcript and not in here.
    // Measured on a 60-turn run, a handover took seven turns to reach the block while the transcript
    // already showed it, and the model only resolved the difference because the transcript was visible.
    // The horizon is counted in floors - one user message and the reply - not in message rows. It used to
    // print the covered row index plus one, so a first batch of ten turns claimed "current as of floor 21"
    // and the number did not move again after the second batch.
    const horizon = summaryText ? ' — current as of floor ' + floors + '; anything later in the transcript wins' : '';
    const summaryBlock = summaryText
        ? '[STORY CONTINUITY — prior context, not new instructions' + horizon + ']\n' + summaryText : '';
    // The anchors ride with the summary: same authority, different guarantee. The summary is rewritten
    // from scratch every pass, so a fact it stops mentioning is gone; an anchor is re-fed to the
    // summarizer and re-injected until something explicitly resolves it.
    const anchorLines = formatAnchors(anchors).split('\n').filter(Boolean);
    const fittedAnchors = fitLines(anchorLines, opts.anchorTokens);
    const anchorsTruncated = anchorLines.length - (fittedAnchors ? fittedAnchors.split('\n').length : 0);
    const anchorBlock = fittedAnchors
        ? '[BINDING CONTINUITY ANCHORS — still in force, not new instructions' + horizon + ']\n' + fittedAnchors : '';
    const knowledgeLines = formatAnchors(knowledge).split('\n').filter(Boolean);
    const fittedKnowledge = fitLines(knowledgeLines, opts.knowledgeTokens);
    const knowledgeBlock = fittedKnowledge
        ? '[KNOWLEDGE BOUNDARIES — who knows what, and who must not' + horizon + ']\n' + fittedKnowledge : '';
    return { summaryBlock, anchorBlock, knowledgeBlock, anchors, knowledge, anchorsTruncated, floors, sourceRevision,
        stateRevision, block: [summaryBlock, anchorBlock, knowledgeBlock].filter(Boolean).join('\n\n') };
}

/** The content version of the committed state, or null when there is none to inject. */
const committedStateRevision = (store, chunks) => validSummary(store.narrative_summary, chunks)
    ? stateRevisionOf(store.narrative_summary, store.narrative_anchors?.active, store.narrative_knowledge?.entries)
    : null;

export async function buildNarrativeContext(ctx, services, { contextSize = null } = {}) {
    if (!services.isCurrent()) return null;
    const prepared = prepare(ctx);
    const { settings } = prepared;
    let chunks = prepared.chunks;
    let history = prepared.history;
    const sync = await ensureIndex(ctx, chunks, services);
    diagnose(ctx, { vector_available: sync.available, vector_reason: sync.reason || null });
    const opts = options(settings);
    // Explicit requests carry the user's words; character names come independently from scene context.
    // Continuation keeps the measured legacy query until a replacement has labelled evidence.
    const queryStore = storeOf(ctx);
    const knownNames = [...new Set([...(queryStore.narrative_knowledge?.entries || []).map(item => String(item.kind || '').split('/')[0]),
        String(ctx.name1 || '').trim(), String(ctx.name2 || '').trim()])].filter(name => name.length >= 2 && name.length <= 12);
    const plan = planRetrievalQuery(history, { strategy: settings.narrative_query_strategy || 'focused',
        summary: queryStore.narrative_summary?.text || '', names: knownNames });
    const query = plan.query;
    let dense = [];
    let vectorError = null;
    const index = indexes.get(hostKey(ctx));
    if (index?.available) {
        try { dense = (await index.vector.query(query, 24)).metadata; }
        catch (error) { vectorError = String(error.message || error); }
    }
    if (!services.isCurrent()) return null;
    // prepare() persists, and a persist replaces the chat store object; read the live one from here on.
    let live = storeOf(ctx);
    let visibleSources = new Set(history.active.filter(id => !ctx.chat[history.records[id].index]?.is_system));
    let continuity = composeContinuity(live, chunks, opts);
    const raw = history.active.filter(id => visibleSources.has(id)).map(id => history.records[id].text).join('\n');
    // Who the situation is about. The knowledge block is keyed by character name, so the names are already
    // extracted and do not need a second model call: a name that the summary tracks and that the last three
    // messages mention is a character who is in the scene.
    const profileNames = plan.profileNames;
    const configured = opts.summaryTokens + opts.anchorTokens + opts.knowledgeTokens
        + opts.evidenceTokens + opts.settingTokens + 100;
    const hostRoom = Number(contextSize) > 0 ? Math.max(0, Number(contextSize) - estimateTokens(raw)
        - bound(settings.context_reply_reserve_tokens, 1024, 0, 32000)) : configured;
    const totalBudget = Math.min(configured, hostRoom);
    // A summary cannot be dropped while its source floors remain hidden.
    if (continuity.block && estimateTokens(continuity.block) > totalBudget) {
        applyNarrativeFolds(ctx.chat, history, chunks, null, false);
        persist(ctx);
        return { referenceBlock: '', currentStateBlock: '', diagnostics: { summary_error: 'context budget too small; original floors restored' } };
    }
    const evidenceBudget = Math.max(0, Math.min(opts.evidenceTokens, totalBudget - estimateTokens(continuity.block)));
    const fused = rankRawChunks(chunks, query, dense, { visibleSources, names: profileNames });
    const reranked = evidenceBudget > 0 ? await applyRerank(services, opts, query, fused, visibleSources)
        : { ranked: fused, used: false, error: null };
    // The rerank is a host round-trip, so it needs the same guard every other await here has: a result
    // that arrives after the user changed chats must not be packed into this prompt.
    if (!services.isCurrent()) return null;
    // The setting plane is another host round-trip, so it runs before the committed state is read for the
    // last time: everything that can wait has waited by the time the blocks are composed.
    let settingText = '';
    if (opts.settingTokens && services.settings) {
        const result = await services.settings(query);
        if (!services.isCurrent()) return null;
        // The setting formatter already enforces role-private audiences in the host service.
        const formatted = formatRelevantSettingContext(result, { maxChars: opts.settingTokens * 4 });
        settingText = fitWholeBlocks(formatted.split('\n\n'), opts.settingTokens);
    }
    // A background summary can commit while this function waits on the vector collection, the reranker or
    // the setting plane. Folding already happened, so a block that still describes the older state would
    // leave the rows the newer commit hid neither summarized nor visible. Re-read the committed state and,
    // if it moved, fold and compose again: the injected block and the hidden range end up one version.
    if (committedStateRevision(storeOf(ctx), chunks) !== continuity.stateRevision) {
        const refreshed = prepare(ctx);
        chunks = refreshed.chunks;
        history = refreshed.history;
        live = storeOf(ctx);
        visibleSources = new Set(history.active.filter(id => !ctx.chat[history.records[id].index]?.is_system));
        continuity = composeContinuity(live, chunks, opts);
        if (continuity.block && estimateTokens(continuity.block) > totalBudget) {
            applyNarrativeFolds(ctx.chat, history, chunks, null, false);
            persist(ctx);
            return { referenceBlock: '', currentStateBlock: '', diagnostics: { summary_error: 'context budget too small; original floors restored' } };
        }
    }
    const ranked = reranked.ranked;
    const evidence = packRawEvidence(ranked, history, { maxTokens: evidenceBudget, visibleSources });
    // The metric the hand-written probe runs had to be replaced by: of the rare terms of this situation that
    // exist only in hidden floors, how many came back with the evidence that was actually packed.
    const entityState = entityRecall(chunks, history, { query, visibleSources, packed: evidence.sources });
    const entityMissed = entityState.filter(row => !row.recalled);
    const askedState = plan.metricsApplicable ? askedThingRecall(chunks, history,
        { asked: plan.asked, visibleSources, packed: evidence.sources }) : [];
    // The second half of the same question: was the character described, not merely mentioned.
    const profileState = profileRecall(chunks, history, { names: profileNames, visibleSources, packed: evidence.sources });
    const referenceBlock = fitWholeBlocks([evidence.text, settingText], Math.max(0, totalBudget - estimateTokens(continuity.block)));
    const pending = pendingState(live, chunks);
    const warnings = warningsFor({ ...pending, summary_failures: Number(live.narrative_diagnostics?.summary_failures) || 0,
        summary_error: live.narrative_diagnostics?.summary_error || null,
        summary_block: live.narrative_diagnostics?.summary_block || null,
        summarizing: jobs.has(hostKey(ctx)), every: opts.every,
        anchors_unconfirmed: continuity.anchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: continuity.anchorsTruncated,
        knowledge_unconfirmed: continuity.knowledge.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(live.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(live.narrative_knowledge?.max_per_subject) || 0,
        entity_missed: 0 }, opts); // Query-term coverage is a trace, not a quality alarm.
    const diagnostics = { summary_tokens: estimateTokens(continuity.summaryBlock), evidence_tokens: estimateTokens(evidence.text),
        reference_tokens: estimateTokens(referenceBlock), visible_raw_tokens: estimateTokens(raw),
        covered_chunks: live.narrative_summary?.covered.length || 0, chunks: chunks.length,
        pending_floors: pending.pending_floors, pending_tokens: pending.pending_tokens,
        summary_failures: Number(live.narrative_diagnostics?.summary_failures) || 0,
        anchors_active: continuity.anchors.length,
        anchors_unconfirmed: continuity.anchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: continuity.anchorsTruncated,
        // What the accepted summary covers right now. The injected numbers are written by
        // runNarrativeGeneration, after the host has actually been given the block: a build is not an
        // injection, and a report that conflated them could not tell a pending pass from a delivered one.
        summary_covered_floors: continuity.floors,
        summary_revision: continuity.sourceRevision,
        summary_state_revision: continuity.stateRevision,
        entity_candidates: entityState.length,
        query_strategy: plan.strategy, retrieval_mode: plan.mode,
        asked_status: !plan.metricsApplicable ? 'not_applicable' : askedState.length ? 'measured_proxy' : 'no_targets',
        asked_targets: askedState.length, asked_recalled: askedState.filter(row => row.recalled).length,
        asked_terms: askedState,
        answer_coverage: 'unmeasured_without_labelled_answers',
        entity_metric: 'query_term_coverage_only_not_quality',
        entity_recalled: entityState.length - entityMissed.length,
        entity_terms: entityState.map(row => ({ term: row.term, first_floor: row.first_floor, recalled: row.recalled })),
        profile_names: profileNames,
        profile_terms: profileState.map(row => ({ name: row.name, quoted: row.quoted, detailed: row.detailed, descriptors: row.descriptors })),
        entity_missed: entityMissed.map(row => ({ term: row.term, first_floor: row.first_floor, hidden_floors: row.hidden_floors })),
        knowledge_entries: continuity.knowledge.length,
        knowledge_unconfirmed: continuity.knowledge.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(live.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(live.narrative_knowledge?.max_per_subject) || 0,
        warnings,
        sources: evidence.sources, candidates: ranked.length,
        rerank_model: opts.rerankModel || null, rerank_used: reranked.used, rerank_error: reranked.error,
        rerank_cost: reranked.metrics || null,
        channels: { lexical: ranked.filter(row => row.channels.includes('lexical')).length,
            vector: ranked.filter(row => row.channels.includes('vector')).length },
        vector_available: Boolean(index?.available && !vectorError),
        vector_error: vectorError || live.narrative_diagnostics?.vector_reason || null,
        summary_error: live.narrative_diagnostics?.summary_error || null,
        summary_invalidated: live.narrative_diagnostics?.summary_invalidated || null,
        quality: 'not measured; these are delivery and cost diagnostics' };
    diagnose(ctx, diagnostics);
    // The bundle carries what the injection step needs to re-check the state without another host
    // round-trip, and what it must record if (and only if) the prompt is really handed over.
    return { referenceBlock, currentStateBlock: continuity.block, chunks, opts, diagnostics,
        injection: { floors: continuity.floors || null, source_revision: continuity.sourceRevision,
            state_revision: continuity.stateRevision, chars: estimateTokens(continuity.block) } };
}

export async function runNarrativeGeneration(ctx, services, args) {
    const settings = narrativeSettings(ctx);
    if (quiet(settings, args[3]) || (args[3] === 'quiet' && summaryRequests.has(settings))) {
        for (const key of NARRATIVE_PROMPTS) ctx.setExtensionPrompt?.(key, '', 1, 1, false, 0);
        if (settings.enabled === false) prepare(ctx);
        return;
    }
    let bundle = await buildNarrativeContext(ctx, services, { contextSize: args[1] });
    if (!bundle || !services.isCurrent()) return;
    // The last check before the block is handed over is synchronous on purpose: with no await between
    // reading the committed state and setting the prompt, a commit cannot slip into that gap and leave
    // the transcript hiding rows this block does not describe.
    const settled = storeOf(ctx);
    if (bundle.chunks && committedStateRevision(settled, bundle.chunks) !== bundle.injection.state_revision) {
        const again = composeContinuity(settled, bundle.chunks, bundle.opts);
        bundle = { ...bundle, currentStateBlock: again.block,
            injection: { floors: again.floors || null, source_revision: again.sourceRevision,
                state_revision: again.stateRevision, chars: estimateTokens(again.block) } };
    }
    ctx.setExtensionPrompt(NARRATIVE_PROMPTS[0], bundle.referenceBlock, 1, 4, false, 0);
    ctx.setExtensionPrompt(NARRATIVE_PROMPTS[1], bundle.currentStateBlock, 1, 1, false, 0);
    // "Injected" means the host was given the block. A build that ends in a quiet generation, a chat
    // switch or a thrown host call leaves the last real injection as the answer to "what did the model see".
    diagnose(ctx, { state_horizon_floors: bundle.injection.floors,
        injected_source_revision: bundle.injection.source_revision,
        injected_state_revision: bundle.injection.state_revision,
        injected_chars: bundle.injection.chars, injected_at: Date.now() });
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
    // Committed coverage is computed from the store every time, and injected coverage is what the last
    // generation actually wrote into the prompt. They differ exactly between a commit and the next
    // generation, and a report that showed only one of them could not say whether a summary had landed.
    const coveredChunks = validSummary(summary, chunks) ? summary.covered.length : 0;
    const committedFloors = coveredChunks ? completedUserTurns(chunks.slice(0, coveredChunks)) : 0;
    const committedRevision = coveredChunks ? (summary.source_revision
        || fnv1a32(summary.covered.join('|')).toString(36)) : null;
    // Coverage is a count of floors; the content version is what actually reached the prompt. Two states
    // can cover the same floors and say different things, and only the version comparison notices that.
    const committedStateRev = committedStateRevision(store, chunks);
    const injectedFloors = store.narrative_diagnostics?.state_horizon_floors ?? null;
    const injectedRevision = store.narrative_diagnostics?.injected_state_revision ?? null;
    const summarizing = jobs.has(hostKey(ctx));
    const every = bound(settings.narrative_every, defaults.narrative_every, 1, 100);
    // The anchor block is fitted on every assembly, so a read-only report has to fit it the same way to
    // know whether anything was dropped. It used to hard-code zero here, which meant the panel could never
    // show the truncation warning the generation itself had recorded.
    const activeAnchors = store.narrative_anchors?.active || [];
    const reportAnchorLines = formatAnchors(activeAnchors).split('\n').filter(Boolean);
    const reportFitted = fitLines(reportAnchorLines, options(settings).anchorTokens);
    const anchorsTruncated = reportAnchorLines.length - (reportFitted ? reportFitted.split('\n').filter(Boolean).length : 0);
    const state = { ...pending, summary_failures: failures,
        summary_error: store.narrative_diagnostics?.summary_error || null,
        summary_block: store.narrative_diagnostics?.summary_block || null,
        summarizing, every,
        anchors_unconfirmed: activeAnchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: anchorsTruncated,
        knowledge_unconfirmed: (store.narrative_knowledge?.entries || []).filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(store.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(store.narrative_knowledge?.max_per_subject) || 0 };
    return {
        enabled: settings.enabled !== false,
        summary_running: summarizing,
        summary_state: summarizeState({ ...state, failureWarn: options(settings).failureWarn }),
        summary_block: state.summary_block,
        summary_last_error: store.narrative_diagnostics?.summary_last_error || null,
        notices: noticesFor(settings),
        // The unit is the floor as a reader of the chat counts it: one user message and the character's
        // reply. The setting has always been in that unit, and every second field that repeated it under a
        // different name made a cadence of ten read as ten message rows, which it is not.
        cadence_unit: 'floor = one user message + the character reply (two message rows)',
        update_every_floors: bound(settings.narrative_every, defaults.narrative_every, 1, 100),
        update_every_user_turns: bound(settings.narrative_every, defaults.narrative_every, 1, 100),
        // Message floors, not the setting repeated. The two were the same number under two names, so a
        // cadence of ten read as "ten floors" while it is ten completed user turns - normally twenty floors,
        // and the reader who counted hidden floors saw nineteen after the first pass and concluded the
        // hiding was wrong. A user turn is a user message and its reply; the greeting is not a turn.
        update_every_messages: bound(settings.narrative_every, defaults.narrative_every, 1, 100) * 2,
        // Count complete committed turns, excluding the greeting and any unanswered user rows.
        folded_floors: Math.round(rows.filter(row => row?.is_system === true && isFoldedRow(row)).length / 2),
        pending_floors: pending.pending_floors,
        pending_tokens: pending.pending_tokens,
        summary_failures: failures,
        anchors_active: activeAnchors.length,
        anchors_unconfirmed: activeAnchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: anchorsTruncated,
        anchors_resolved: (store.narrative_anchors?.resolved || []).length,
        anchor_parse: store.narrative_diagnostics?.anchor_parse || store.narrative_anchors?.parse || null,
        knowledge_entries: (store.narrative_knowledge?.entries || []).length,
        knowledge_unconfirmed: (store.narrative_knowledge?.entries || []).filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(store.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(store.narrative_knowledge?.max_per_subject) || 0,
        entity_candidates: store.narrative_diagnostics?.entity_candidates || 0,
        entity_metric: 'query_term_coverage_only_not_quality',
        query_strategy: store.narrative_diagnostics?.query_strategy || null,
        retrieval_mode: store.narrative_diagnostics?.retrieval_mode || null,
        asked_status: store.narrative_diagnostics?.asked_status || 'not_measured',
        asked_targets: store.narrative_diagnostics?.asked_targets ?? null,
        asked_recalled: store.narrative_diagnostics?.asked_recalled ?? null,
        answer_coverage: 'unmeasured_without_labelled_answers',
        rerank_cost: store.narrative_diagnostics?.rerank_cost || null,
        profile_quoted: (store.narrative_diagnostics?.profile_terms || []).filter(row => row.quoted).length,
        profile_detailed: (store.narrative_diagnostics?.profile_terms || []).filter(row => row.detailed).length,
        profile_missing: (store.narrative_diagnostics?.profile_terms || []).filter(row => !row.detailed).map(row => row.name),
        entity_recalled: store.narrative_diagnostics?.entity_recalled || 0,
        entity_missed: (store.narrative_diagnostics?.entity_missed || []).map(row => row.term),
        warnings: warningsFor({ ...state, entity_missed: 0 }, options(settings)),
        messages: history ? history.active.length : 0,
        completed_floors: completedUserTurns(chunks),
        chunks: chunks.length,
        archived_versions: history ? Object.keys(history.records).length - history.active.length : 0,
        summary_valid: validSummary(summary, chunks),
        summary_covered_floors: committedFloors,
        summary_revision: committedRevision,
        summary_state_revision: committedStateRev,
        injected_floors: injectedFloors,
        injected_revision: injectedRevision,
        injected_source_revision: store.narrative_diagnostics?.injected_source_revision ?? null,
        injected_state_revision: store.narrative_diagnostics?.injected_state_revision ?? null,
        injected_at: store.narrative_diagnostics?.injected_at ?? null,
        injected_chars: store.narrative_diagnostics?.injected_chars ?? null,
        // Versions, not counts: the same floor count with different prose is still an old injection.
        injected_stale: Boolean(summary) && injectedRevision !== committedStateRev,
        summary_cost: store.narrative_diagnostics?.summary_cost || null,
        // Kept as the alias the panel and the earlier docs use: the floor the injected block is current as of.
        state_horizon_floors: injectedFloors,
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
        + [['narrative_every','每几楼更新摘要（1 楼 = user 消息 + 角色回复）',1,100],['narrative_summary_tokens','摘要 token 预算',100,4000],
            ['narrative_evidence_tokens','原文证据 token 预算',0,8000],['narrative_setting_tokens','相关设定 token 预算',0,4000],
            ['narrative_anchor_tokens','锚点 token 预算',0,4000],
            ['narrative_input_chars','每批总结输入字符预算（必须容纳完整批次）',2000,100000],
            ['narrative_pending_warn_tokens','未总结原文大小提示阈值（仅在积压时附加说明）',200,200000],['narrative_summary_failure_warn','连续失败几次告警',1,50]]
            .map(([key,label,min,max]) => `<label>${label}<input type="number" data-key="${key}" min="${min}" max="${max}"></label>`).join('')
        + '<label>重排模型（留空则关闭，例如 jina-reranker-v3）<input type="text" data-key="narrative_rerank_model" data-text="1"></label>'
        + '<label><input type="checkbox" data-key="narrative_fold">折叠已总结的历史楼层</label>'
        + '<button class="menu_button" data-action="summarize">总结下一完整批次</button>'
        + '<button class="menu_button" data-action="restore">恢复原文显示</button>'
        + '<div data-state class="aum-v51-status"></div>'
        + '<div data-notice class="aum-v51-status"></div>'
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
const SUMMARY_STATE_TEXT = { idle: '空闲', accumulating: '正常积累（未满一个批次）',
    summarizing: '正在总结', failing: '连续失败', blocked: '输入预算阻塞', backlog: '有完整批次等待总结' };

function renderNarrativePanel(root, ctx) {
    const report = readNarrativeReport(ctx);
    // "Progress" has to be visible as progress: a cadence of ten turns spends most of its time with a tail
    // waiting, and a reader who only sees a number cannot tell that from a pipeline that stopped.
    const state = root.querySelector('[data-state]');
    if (state) {
        state.textContent = '摘要状态：' + (SUMMARY_STATE_TEXT[report.summary_state] || report.summary_state || '未知')
            + '（待总结 ' + report.pending_floors + ' 个已完成 user turns / 约 ' + report.pending_tokens + ' token'
            + (report.summary_running ? '，任务运行中' : '') + '）';
    }
    // A notice is not a fault: it is something about the configuration the user should know, shown apart
    // from the warnings so that a real fault is not read as one more line of advice.
    const notice = root.querySelector('[data-notice]');
    if (notice) {
        notice.textContent = report.notices.length ? 'ℹ ' + report.notices.join(' ') : '';
        notice.hidden = !report.notices.length;
    }
    const warning = root.querySelector('[data-warning]');
    if (warning) {
        warning.textContent = report.warnings.length ? '⚠ ' + report.warnings.join(' ') : '';
        warning.hidden = !report.warnings.length;
    }
    root.querySelector('[data-status]').textContent = JSON.stringify(report, null, 2);
}
