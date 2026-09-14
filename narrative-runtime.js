import { captureHistory, chunkHistory, rankRawChunks, validSummary, nextSummaryBatch,
    summaryMessages, summaryRequest, summaryBlockState, anchorRepairRequest, summaryBodyRepairRequest, stateRevisionOf,
    LEGACY_INPUT_CHARS_DEFAULT, LEGACY_ANCHOR_TOKENS_DEFAULT,
    selectAnchors, selectKnowledge, MAX_SUPERSEDED, parseAnchorChanges, sourceBatchFingerprint, countAnchorCollisions,
    SHIPPED_PACK_POLICY, shippedRetrievalConfig, ledgerCarriers, supersededSources,
    applyNarrativeFolds, packRawEvidence, parseAnchors, formatAnchors, mergeAnchors,
    mergeKnowledge, completedUserTurns, entityRecall, profileRecall, askedThingRecall, normalizeKnowledgeEntries,
    summaryLengthVerdict, summarizeEvidenceCandidates, summarizeEvidenceTrace } from './raw-history.js';
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
const defaults = { narrative_every: 10, narrative_summary_tokens: 600, narrative_summary_ceiling_tokens: 0,
    narrative_evidence_tokens: 1000,
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
    // 600, not 300. The contract is that an anchor is re-injected until something explicitly resolves it,
    // and the measured corpus does not fit 300: the 40-turn run ended with 30 live anchors, about 29 tokens
    // each, and the 300-token block injected 10 of them. That is a structural mismatch between the contract
    // and the budget, not an unexplained failure, so it is sized rather than hoped at.
    narrative_anchor_tokens: 600, narrative_anchor_unconfirmed_warn: 2,
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
    const summaryTokens = bound(settings.narrative_summary_tokens, 600, 100, 4000);
    // The soft target is what the model is asked for; the ceiling is the emergency acceptance line the
    // runtime enforces. They used to be one number, so a 610-token body was refused against the target it
    // was told to aim at. 0 means "derive from the target": dense material gets room without adding a
    // density classifier or an unverified numeric heuristic.
    const configuredCeiling = bound(settings.narrative_summary_ceiling_tokens, 0, 0, 4000);
    const summaryCeiling = configuredCeiling > 0 ? Math.max(configuredCeiling, summaryTokens)
        : Math.min(4000, Math.max(summaryTokens + 100, Math.round(summaryTokens * 1.5)));
    return { pendingWarnTokens: bound(settings.narrative_pending_warn_tokens, 4000, 200, 200000),
        failureWarn: bound(settings.narrative_summary_failure_warn, 3, 1, 50),
        anchorTokens: bound(settings.narrative_anchor_tokens, 300, 0, 4000),
        anchorUnconfirmedWarn: bound(settings.narrative_anchor_unconfirmed_warn, 2, 1, 20),
        knowledgeTokens: bound(settings.narrative_knowledge_tokens, 200, 0, 4000),
        every: bound(settings.narrative_every, 10, 1, 100),
        summaryTokens, summaryCeiling,
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
    input_budget: '本地输入预算不足', anchor_ops: '锚点变更引用了无效编号或冲突操作',
    unknown: '未分类的失败' };
/** One short phrase per refused operation, so the panel says which rule was broken and not just that one was. */
const ANCHOR_ERROR_TEXT = { unknown_op: '不是“新增/更新/结束”三种写法之一', alias_required: '“更新/结束”没有写编号',
    unknown_alias: '编号不在本批提供的【当前锚点】里', alias_not_allowed: '“新增”不应带编号',
    missing_kind: '“新增”没有写类型', bad_fields: '类型、主体或来源字段数量不符',
    missing_section: '缺少【锚点变更】章节', empty_section: '锚点章节为空；没有变化请明确写“无”',
    mixed_none: '同一章节同时写了“无”和变更内容',
    missing_source: '没有写“来源 raw_N”', source_not_in_batch: '来源不在本批【新增原文】里',
    bad_source: '来源不是 raw_N 这样的编号',
    empty_statement: '没有写陈述', duplicate_target: '同一条记录在本批被改了两次',
    stale_target: '这条记录在本批生成后已被结束', stale_version: '这条记录在本批生成后已被改动' };
const describeAnchorErrors = errors => (errors || []).slice(0, 4).map(error =>
    '“' + String(error.line || '').slice(0, 60) + '” —— ' + (ANCHOR_ERROR_TEXT[error.reason] || error.reason)).join('；');
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
/** The batch as one name, so a failure, a block and a committed operation set can be matched up. */
const batchIdOf = batch => [batch.sources[0], batch.sources.at(-1), batch.covered.length].join('|');

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
    // A ledger written before the change protocol is migrated exactly as it stands. It used to be folded
    // here so a chat carrying restatements was corrected on load; that fold is the rule this protocol
    // removes, and running it on load would leave one place where a label still authorised a replacement.
    // Records without a `revision` read as version 0 in planAnchors and mergeAnchors, so nothing has to be
    // rewritten to be usable, and a label collision the old rule created is now reported, not hidden.
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
        const messages = summaryMessages(state.history, batch);
        // summaryRequest builds the alias table from the same anchor list it formats, and returns it, so the
        // ids the model is shown are exactly the versions the answer will be checked against.
        const request = summaryRequest(previous?.text, messages, opts.summaryTokens,
            previousAnchors?.active, previousKnowledge?.entries, { ceiling: opts.summaryCeiling });
        // Rule 5: the operations only mean anything against the text the model was handed. This is that
        // text, as one number, checked again at commit so a row edited during the call is noticed.
        const batchFingerprint = sourceBatchFingerprint(messages);
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
        // A first answer is evaluated into its parsed pieces and its checked operations, or it is refused with
        // the valid prefix attached. Nothing is written during evaluation, so a refused first attempt leaves the
        // store exactly as the model found it and the repair reads the same frozen state.
        const evaluateAnswer = (answer, responseMetrics) => {
            const parsed = parseAnchors(answer);
            if (!parsed.summary) throw tagged('format', new Error('总结接口只返回了锚点，没有摘要正文；保留旧摘要与未总结原文。'),
                { response: responseMetrics, summary_tokens: estimateTokens(answer) });
            const acceptedTokens = estimateTokens(parsed.summary);
            const lengthVerdict = summaryLengthVerdict(acceptedTokens, { target: opts.summaryTokens, ceiling: opts.summaryCeiling });
            if (!lengthVerdict.accepted) throw tagged('over_budget',
                new Error('摘要超过预算（硬上限 ' + opts.summaryCeiling + ' token），保留旧摘要与未总结原文；请缩短总结输出或提高摘要硬上限。'),
                { response: responseMetrics, summary_tokens: acceptedTokens,
                    summary_target_tokens: opts.summaryTokens, summary_ceiling_tokens: opts.summaryCeiling });
            if (parsed.anchor_section === 'missing' || parsed.anchor_section === 'empty') {
                const error = tagged('anchor_ops', new Error('锚点变更章节缺失或为空；本批不提交、不隐藏原文。'),
                    { response: responseMetrics, anchor_errors: [{ line: '', reason: parsed.anchor_section + '_section' }] });
                error.parsed = parsed; error.valid_lines = []; error.anchor_section = parsed.anchor_section;
                error.overTarget = lengthVerdict.over_target;
                throw error;
            }
            const checked = parseAnchorChanges(parsed.anchorLines,
                { plan: request.anchors, batchSources: new Set(batch.sources) });
            if (checked.errors.length) {
                const error = tagged('anchor_ops',
                    new Error('锚点变更引用了无效编号或批次外的来源（' + describeAnchorErrors(checked.errors)
                        + '）；本批不提交、不隐藏原文。'),
                    { response: responseMetrics, anchor_errors: checked.errors });
                // The valid prefix is what the repair must not lose. It rides on the error, never written here:
                // the summary and the ledger stay untouched until one merged, re-checked set passes.
                error.parsed = parsed;
                error.valid_lines = checked.changes.map(change => change.line);
                error.anchor_section = parsed.anchor_section;
                error.overTarget = lengthVerdict.over_target;
                throw error;
            }
            return { parsed, checked, overTarget: lengthVerdict.over_target };
        };
        // The only writer. It takes the already-evaluated summary and boundaries plus one fully re-checked
        // operation set, so the first answer and the repaired answer cannot diverge in what they commit.
        const commitMerged = (parsed, changes, responseMetrics, repair, overTarget = false) => {
            const live = storeOf(ctx);
            const applied = mergeAnchors(live.narrative_anchors, changes, { plan: request.anchors, at: Date.now() });
            if (!applied.ok) throw tagged('anchor_ops',
                new Error('锚点变更与请求发出时的版本不一致（' + describeAnchorErrors(applied.errors)
                    + '）；本批不提交、不隐藏原文。'),
                { response: responseMetrics, anchor_errors: applied.errors });
            const anchorOps = { ...applied.stats, section: parsed.anchor_section,
                ...(repair ? { repaired: true, repair_at: repair.at } : {}), at: Date.now(), batch_id: batchIdOf(batch) };
            live.narrative_summary = { version: 1, fixed_batch: true, text: parsed.summary, covered: before };
            live.narrative_anchors = applied.ledger;
            if (parsed.sections === 'ok') live.narrative_knowledge = mergeKnowledge(previousKnowledge, parsed);
            else if (previousKnowledge?.entries?.length) live.narrative_knowledge = { ...previousKnowledge,
                entries: previousKnowledge.entries.map(item => ({ ...item, unconfirmed: (Number(item.unconfirmed) || 0) + 1 })),
                parse: 'missing', updated_at: Date.now() };
            // Two versions, because they answer two questions: which sources this state read, and what
            // this state says. Only the second can tell an old injection from the current state, since
            // coverage is a count of floors and two different states can share it.
            const sourceRevision = fnv1a32(before.join('|')).toString(36);
            for (const value of [live.narrative_anchors, live.narrative_knowledge]) if (value) value.source_revision = sourceRevision;
            live.narrative_summary.source_revision = sourceRevision;
            live.narrative_summary.state_revision = stateRevisionOf(live.narrative_summary,
                live.narrative_anchors?.active, live.narrative_knowledge?.entries);
            const pastFailure = live.narrative_diagnostics?.summary_last_error;
            const pastRepair = live.narrative_diagnostics?.anchor_repair;
            const pastBodyRepair = live.narrative_diagnostics?.body_repair;
            // A repair that is being committed did recover the batch it was sent for, and says so; the failure
            // branches below keep their own record with recovered false.
            const committedRepair = repair ? { ...repair, recovered: true, recovered_at: Date.now() } : null;
            diagnose(ctx, { summary_error: null, summary_invalidated: null, summary_failures: 0,
                persist_error: null,
                summary_block: null, summary_batch_changed: null, anchor_parse: parsed.anchor_section,
                summary_target_tokens: opts.summaryTokens, summary_ceiling_tokens: opts.summaryCeiling,
                summary_over_target: overTarget ? { at: Date.now(), target: opts.summaryTokens,
                    ceiling: opts.summaryCeiling, accepted_tokens: estimateTokens(parsed.summary) } : null,
                anchor_ops: anchorOps,
                // A repair record is named for what it repaired. A body repair is not an anchor repair, and
                // a reader chasing "which stage was refused" must not be sent to the anchor section.
                anchor_repair: (committedRepair && committedRepair.kind !== 'body') ? committedRepair
                    : (pastRepair ? { ...pastRepair, recovered: true, recovered_at: Date.now() } : null),
                body_repair: (committedRepair && committedRepair.kind === 'body') ? committedRepair
                    : (pastBodyRepair ? { ...pastBodyRepair, recovered: true, recovered_at: Date.now() } : null),
                anchor_op_errors: live.narrative_diagnostics?.anchor_op_errors
                    ? { ...live.narrative_diagnostics.anchor_op_errors, recovered: true, recovered_at: Date.now() }
                    : null,
                summary_last_error: pastFailure ? { ...pastFailure, recovered: true, recovered_at: Date.now(),
                    recovered_by: { source_revision: sourceRevision,
                        state_revision: live.narrative_summary.state_revision } } : null });
            // The state is already on the store, so a metadata-write failure here is a persistence problem,
            // not a model failure: it must not increment summary_failures or claim stage 'transport' (audit
            // F-1). A write that fails before the commit still rejects and hides nothing, as it should.
            try {
                prepare(ctx);
                persist(ctx);
            } catch (error) {
                diagnose(ctx, { persist_error: { at: Date.now(), stage: 'metadata_write',
                    reason: bounded(String(error?.message || error)) } });
            }
        };
        // One check, used after every model call on both paths, so the first answer and the repair can never
        // commit under different conditions. "Current" covers the open chat, the enabled switch, the frozen
        // coverage prefix and the batch text; the record versions are checked inside mergeAnchors.
        const stillFrozen = () => {
            if (!services.isCurrent()) return 'chat';
            state = prepare(ctx);
            if (state.settings.enabled === false) return 'disabled';
            if (!before.every((id, i) => id === state.chunks[i]?.id)) return 'coverage';
            if (sourceBatchFingerprint(summaryMessages(state.history, batch)) !== batchFingerprint) return 'batch';
            return null;
        };
        const stopFor = reason => {
            if (reason === 'batch') {
                // A covered row was edited while the answer was being written. Committing would hide floors
                // this answer never read, so the batch is left for the next pass instead.
                diagnose(ctx, { summary_batch_changed: { at: Date.now(), batch_id: batchIdOf(batch) } });
                persist(ctx);
            }
            return true;
        };
        try {
            const text = await (services.summarize || generateNarrativeSummary)(ctx, request.text, state.settings);
            {
                const reason = stillFrozen();
                if (reason) return stopFor(reason);
            }
            const firstResponse = storeOf(ctx).narrative_diagnostics?.summary_response || null;
            let first = null;
            try {
                first = evaluateAnswer(text, firstResponse);
            } catch (commitError) {
                // One targeted repair. A body that is missing or past the ceiling is repaired by asking for the
                // whole answer again with the ceiling stated; an anchor section that failed validation is
                // repaired by replacing the rejected lines. A transport failure, a local budget block or a
                // record-version failure is neither and is not repaired.
                if (commitError?.stage === 'format' || commitError?.stage === 'over_budget') {
                    if (!services.isCurrent()) throw commitError;
                    const bodyPrompt = summaryBodyRepairRequest({ requestText: request.text,
                        reason: commitError.stage, detail: bounded(String(commitError.message || '')),
                        summaryTokens: opts.summaryTokens, ceiling: opts.summaryCeiling, refusedText: text });
                    const repair = { kind: 'body', at: Date.now(), attempt: 1, batch_id: batchIdOf(batch),
                        stage: commitError.stage, reason: bounded(String(commitError.message || '')),
                        refused_chars: String(text || '').length,
                        summary_tokens: Number.isFinite(commitError.summary_tokens) ? commitError.summary_tokens : null,
                        request_chars: bodyPrompt.text.length,
                        prompt_tokens_estimated: estimateTokens(bodyPrompt.text),
                        sent: false, blocked: false, error: null, response: null,
                        recovered: false, recovered_at: null,
                        cost: { prompt_chars: bodyPrompt.text.length,
                            prompt_tokens_estimated: estimateTokens(bodyPrompt.text),
                            completion_tokens: null, reasoning_tokens: null, usage_status: 'unknown' } };
                    if (bodyPrompt.text.length > opts.inputChars) {
                        repair.blocked = true; repair.stage = 'input_budget';
                        repair.needed_chars = bodyPrompt.text.length; repair.budget_chars = opts.inputChars;
                        diagnose(ctx, { body_repair: repair });
                        commitError.repair = repair;
                        throw commitError;
                    }
                    repair.sent = true;
                    let repairedText;
                    try {
                        repairedText = await (services.summarize || generateNarrativeSummary)(ctx, bodyPrompt.text, state.settings);
                    } catch (repairFailure) {
                        repair.stage = repairFailure?.stage || 'transport';
                        repair.error = bounded(String(repairFailure?.message || repairFailure));
                        repair.response = repairFailure?.response || null;
                        diagnose(ctx, { body_repair: repair });
                        commitError.repair = repair;
                        throw commitError;
                    }
                    repair.response = storeOf(ctx).narrative_diagnostics?.summary_response || null;
                    if (repair.response) {
                        repair.cost.completion_tokens = repair.response.completion_tokens ?? null;
                        repair.cost.reasoning_tokens = repair.response.reasoning_tokens ?? null;
                        repair.cost.usage_status = 'reported';
                    }
                    {
                        const reason = stillFrozen();
                        if (reason) {
                            repair.stopped = reason;
                            diagnose(ctx, { body_repair: repair });
                            persist(ctx);
                            return;
                        }
                    }
                    // The second answer is evaluated exactly like the first - body, ceiling, section and every
                    // anchor reference - so a repair cannot commit through a weaker path than the answer it
                    // replaces, and a repair that is still wrong leaves the batch as refused as it was.
                    let second;
                    try {
                        second = evaluateAnswer(repairedText, repair.response);
                    } catch (secondError) {
                        repair.stage_after = secondError?.stage || 'unknown';
                        repair.reason_after = bounded(String(secondError?.message || secondError));
                        repair.errors_after = secondError?.anchor_errors || null;
                        diagnose(ctx, { body_repair: repair });
                        if (secondError && typeof secondError === 'object') secondError.repair = repair;
                        throw secondError;
                    }
                    commitMerged(second.parsed, second.checked.changes, repair.response, repair, second.overTarget === true);
                    return;
                }
                if (commitError?.stage !== 'anchor_ops' || !commitError.parsed || !services.isCurrent()) throw commitError;
                const repairPrompt = anchorRepairRequest({ validLines: commitError.valid_lines || [],
                    errors: commitError.anchor_errors, plan: request.anchors, sources: batch.sources,
                    maxTokens: opts.summaryTokens });
                // The repair record exists before anything is sent, so a blocked or failed attempt still carries
                // its request, its cost base and the errors it was meant to fix.
                const repair = { at: Date.now(), attempt: 1, batch_id: batchIdOf(batch),
                    errors: commitError.anchor_errors || null,
                    original_anchor_errors: commitError.anchor_errors || null,
                    valid_preserved: (commitError.valid_lines || []).length,
                    original_response_chars: String(text || '').length,
                    request_chars: repairPrompt.text.length,
                    prompt_tokens_estimated: estimateTokens(repairPrompt.text),
                    sent: false, blocked: false, stage: null, error: null, response: null,
                    replacement_lines: 0, errors_after: null, reason_after: null,
                    // Usage is only known when the transport reports it; anything else is recorded as unknown
                    // rather than as zero.
                    cost: { prompt_chars: repairPrompt.text.length,
                        prompt_tokens_estimated: estimateTokens(repairPrompt.text),
                        completion_tokens: null, reasoning_tokens: null, usage_status: 'unknown' },
                    recovered: false, recovered_at: null };
                if (repairPrompt.text.length > opts.inputChars) {
                    // A local budget block is not a model call. It is recorded on the repair, and the batch keeps
                    // the refusal that asked for the repair in the first place.
                    repair.blocked = true; repair.stage = 'input_budget';
                    repair.needed_chars = repairPrompt.text.length; repair.budget_chars = opts.inputChars;
                    commitError.repair = repair;
                    throw commitError;
                }
                repair.sent = true;
                let repairedText;
                try {
                    repairedText = await (services.summarize || generateNarrativeSummary)(ctx, repairPrompt.text, state.settings);
                } catch (repairFailure) {
                    // The repair's own failure is kept beside the refusal it was fixing; the batch stays refused
                    // for the anchor section, which is still the condition a reader needs to see.
                    repair.stage = repairFailure?.stage || 'transport';
                    repair.error = bounded(String(repairFailure?.message || repairFailure));
                    repair.response = repairFailure?.response || null;
                    commitError.repair = repair;
                    throw commitError;
                }
                repair.response = storeOf(ctx).narrative_diagnostics?.summary_response || null;
                if (repair.response) {
                    repair.cost.completion_tokens = repair.response.completion_tokens ?? null;
                    repair.cost.reasoning_tokens = repair.response.reasoning_tokens ?? null;
                    repair.cost.usage_status = 'reported';
                }
                {
                    const reason = stillFrozen();
                    if (reason) {
                        repair.stopped = reason;
                        diagnose(ctx, { anchor_repair: repair, ...(reason === 'batch'
                            ? { summary_batch_changed: { at: Date.now(), batch_id: batchIdOf(batch) } } : {}) });
                        persist(ctx);
                        return;
                    }
                }
                // The kept lines and the replacement lines are re-parsed as one batch, so a repair cannot add a
                // duplicate target or a foreign source that the single-line checks would miss. An explicit "无"
                // in the repair means "no replacement", not a new change line.
                const repairParsed = parseAnchors(repairedText);
                const firstSection = commitError.parsed.anchor_section;
                if ((firstSection === 'missing' || firstSection === 'empty')
                    && (repairParsed.anchor_section === 'missing' || repairParsed.anchor_section === 'empty')) {
                    // The section was never supplied. A repair that answers nothing is not the explicit "no
                    // change" an explicit 无 is, so the batch stays refused for the section that was missing.
                    const error = tagged('anchor_ops', new Error('修复后仍然没有【锚点变更】章节；本批不提交、不隐藏原文。'),
                        { response: repair.response, anchor_errors: commitError.anchor_errors });
                    error.repair = repair;
                    error.original_anchor_errors = commitError.anchor_errors || null;
                    throw error;
                }
                const replacement = repairParsed.anchorLines
                    .filter(line => !/^(无|（无）|none)$/i.test(String(line).trim()));
                repair.replacement_lines = replacement.length;
                const combined = parseAnchorChanges([...(commitError.valid_lines || []), ...replacement],
                    { plan: request.anchors, batchSources: new Set(batch.sources) });
                if (combined.errors.length) {
                    repair.errors_after = combined.errors;
                    repair.reason_after = describeAnchorErrors(combined.errors);
                    // The batch is still refused for the reason the first answer was refused, so the rule a
                    // reader needs is not replaced by whatever the repair happened to break; the repair's own
                    // errors stay beside it in errors_after.
                    const error = tagged('anchor_ops',
                        new Error('修复后的锚点变更仍不合法（' + describeAnchorErrors(combined.errors)
                            + '）；本批不提交、不隐藏原文。'),
                        { response: repair.response, anchor_errors: commitError.anchor_errors || combined.errors });
                    error.repair = repair;
                    error.original_anchor_errors = commitError.anchor_errors || null;
                    throw error;
                }
                // The committed summary and boundaries are the first answer's, not the repair's: the repair only
                // supplies the missing operations. This is what stops a repair that answers "无" from erasing
                // content the first answer already validated.
                try {
                    commitMerged(commitError.parsed, combined.changes, repair.response, repair, commitError.overTarget === true);
                } catch (mergeError) {
                    if (mergeError && typeof mergeError === 'object') {
                        mergeError.repair = repair;
                        mergeError.original_anchor_errors = commitError.anchor_errors || null;
                    }
                    throw mergeError;
                }
                return;
            }
            commitMerged(first.parsed, first.checked.changes, firstResponse, null, first.overTarget === true);
        } catch (error) {
            if (services.isCurrent()) {
                // Counted, not just recorded: one failure is noise, a run of them is the warning. This
                // counter is for model-call failures only; a local budget block never reaches here.
                const live = storeOf(ctx);
                const stage = error?.stage || 'transport';
                const previousFailure = live.narrative_diagnostics?.summary_last_error;
                const batchId = batchIdOf(batch);
                const sameBatch = previousFailure && !previousFailure.recovered && previousFailure.batch_id === batchId;
                const failures = Number(live.narrative_diagnostics?.summary_failures) || 0;
                const response = error?.response || null;
                diagnose(ctx, { summary_error: String(error.message || error), summary_failures: failures + 1,
                    // A refused operation set is kept beside the failure so the panel can name the rule that
                    // was broken. A model-call failure keeps whatever the last refusal was.
                    anchor_op_errors: error?.anchor_errors
                        ? { at: Date.now(), stage, batch_id: batchId, errors: error.anchor_errors }
                        : (live.narrative_diagnostics?.anchor_op_errors || null),
                    // A failed repair keeps its own record, named for what it repaired: what it cost, and the
                    // errors it was asked to fix.
                    anchor_repair: (error?.repair && error.repair.kind !== 'body') ? error.repair
                        : (live.narrative_diagnostics?.anchor_repair || null),
                    body_repair: (error?.repair && error.repair.kind === 'body') ? error.repair
                        : (live.narrative_diagnostics?.body_repair || null),
                    summary_last_error: {
                        anchor_errors: error?.anchor_errors || null,
                        repair: error?.repair || null,
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
                        summary_target_tokens: opts.summaryTokens,
                        summary_ceiling_tokens: opts.summaryCeiling,
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
    // Same rule as above: a stored value that happens to be the old default is reported, never overwritten,
    // because the plugin cannot tell it apart from a deliberate choice.
    if (Number(settings.narrative_anchor_tokens) === LEGACY_ANCHOR_TOKENS_DEFAULT) {
        out.push('锚点 token 预算是旧默认值 ' + LEGACY_ANCHOR_TOKENS_DEFAULT
            + '，当前账本装不下（实测 28 条活值约需 900 token）。该值没有被自动覆盖，请按需调整。');
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
    // The anchor-unconfirmed alarm is gone on purpose. It counted a protocol in which the model had to
    // restate every anchor, so "not restated" meant "the format slipped". Under the change protocol not
    // restating is the required shape, and an untouched anchor says nothing about whether its fact still
    // holds - an alarm on it would fire on every healthy batch. What replaces it is the shape that is
    // actually wrong: two live records under one label, which is what a missed "更新 A#" looks like.
    if (state.anchors_same_subject > 0) {
        out.push('有 ' + state.anchors_same_subject + ' 组锚点共用同一标签且同时有多条活值；这只是同标签记录数，'
            + '不代表这些记录互相矛盾。同一可变事实的新状态应当用“更新 A#”提交，“新增”不取代旧值，两条都会被注入。');
    }
    if (state.anchor_op_errors?.errors?.length && !state.anchor_op_errors.recovered) {
        out.push('最近一批锚点变更被拒绝（' + state.anchor_op_errors.errors.length + ' 条无效引用或冲突）：'
            + describeAnchorErrors(state.anchor_op_errors.errors) + '。本批没有提交，原文保持可见。');
    }
    if (state.knowledge_unconfirmed >= opts.anchorUnconfirmedWarn) {
        // "They are still injected" was a claim the block could not keep: an unrepeated boundary stays in
        // the ledger, but whether it reaches the prompt is the boundary block's budget, and at the 200-token
        // default three of four entries do not.
        out.push('有 ' + state.knowledge_unconfirmed + ' 条知情边界已连续多轮未被总结重复；它们仍留在台账里'
            + '（是否注入取决于“知情边界 token 预算”），但请检查总结格式。');
    }
    if (state.knowledge_duplicate_subjects > 0) {
        out.push('有 ' + state.knowledge_duplicate_subjects + ' 个角色在知情边界里占了多行（最多 '
            + state.knowledge_max_per_subject + ' 行）；每个角色应当只有一行，否则同一个角色的两行可以互相矛盾。');
    }
    // A parked entry is a live fact the model will not see this turn. That is worth saying: it used to be
    // reported as "省略 N 条" without saying that the block had been filled oldest-first, so the ones cut
    // were the newest facts in the story.
    if (state.anchors_truncated > 0) {
        out.push('锚点块装不下当前活值：共 ' + (state.anchors_total || 0) + ' 条，注入 '
            + (state.anchors_injected || 0) + ' 条，搁置 ' + state.anchors_truncated
            + ' 条（按类型轮流各取一条、类型内新→旧，裁掉的是最旧的活值；被取代的旧陈述本来就不会注入）。'
            + '可调高“锚点 token 预算”，或让总结用“结束 A#”结束已经结束的事实。');
    }
    // The same sentence as the anchor block, for the same reason: an entry the budget dropped is a boundary
    // the model does not see this turn. It went unsaid because the block returned only its surviving text,
    // so a reader could not tell a boundary that fits from one that does not.
    if (state.knowledge_parked > 0) {
        out.push('知情边界块装不下当前条目：共 ' + (state.knowledge_entries || 0) + ' 条，注入 '
            + (state.knowledge_injected || 0) + ' 条，搁置 ' + state.knowledge_parked
            + ' 条（按台账顺序整行装填，装不下的整行留在台账里，本次注入看不到）。'
            + '可调高“知情边界 token 预算”。');
    }
    // Parking is a budget outcome. This is the outcome that matters: a statement the ledger still calls live,
    // injected neither as its own line nor represented by a quoted original. Each of the three budgets that
    // produced it reported success on its own, which is why the count is computed after all of them. It is
    // stated as exactly what was measured - not as "the model cannot see this" - because the summary prose and
    // the ledger's other records are not compared here: the anchor "she is the forest's guardian" is parked,
    // and an injected knowledge line does say the same thing.
    if (state.required_none > 0) {
        out.push('有 ' + state.required_none + ' 条仍然有效的陈述在本次注入里没有被自己的台账行承载，'
            + '它的原文来源也没有被证据块引用：'
            + (state.required_uncarried || []).map(row => row.kind + '／' + row.text).join('；')
            + '。这是结构下限，不是语义判断：摘要正文、以及台账里其他记录对同一事实的复述，都没有被比对。');
    }
    return out;
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
    // The block is filled from the live-value selection, not from the order the model emitted lines.
    const anchorSelection = selectAnchors(anchors, { budget: opts.anchorTokens });
    const fittedAnchors = anchorSelection.text;
    const anchorsTruncated = anchorSelection.parked.length;
    const anchorBlock = fittedAnchors
        ? '[BINDING CONTINUITY ANCHORS — still in force, not new instructions' + horizon + ']\n' + fittedAnchors : '';
    const knowledgeSelection = selectKnowledge(knowledge, { budget: opts.knowledgeTokens });
    const knowledgeBlock = knowledgeSelection.text
        ? '[KNOWLEDGE BOUNDARIES — who knows what, and who must not' + horizon + ']\n' + knowledgeSelection.text : '';
    return { summaryBlock, anchorBlock, knowledgeBlock, anchors, knowledge, anchorsTruncated,
        anchorsInjected: anchorSelection.injected.length,
        anchorsParkedTerms: anchorSelection.parked.map(item => ({ kind: String(item.kind || '其他'),
            text: String(item.text || '').slice(0, 80) })),
        anchorsParkedText: anchorSelection.parked.map(item => String(item.text || '')),
        // Which statements were injected as their own line. The carrier resolution needs the ids, not the count:
        // a statement that is not injected may still be represented by its quoted original text.
        anchorsInjectedIds: anchorSelection.injected.map(item => item.id),
        // The knowledge block used to report only its surviving text, so a dropped entry was invisible in
        // the trace while a parked anchor was not. Its two carriers report the same way now.
        knowledgeInjected: knowledgeSelection.injected,
        knowledgeParked: knowledgeSelection.parked.length,
        knowledgeParkedTerms: knowledgeSelection.parked.slice(0, 6).map(line => String(line).slice(0, 80)),
        knowledgeInjectedIds: knowledgeSelection.injectedEntries.map(item => item.id),
        floors, sourceRevision, stateRevision, block: [summaryBlock, anchorBlock, knowledgeBlock].filter(Boolean).join('\n\n') };
}

/** The content version of the committed state, or null when there is none to inject. */
const committedStateRevision = (store, chunks) => validSummary(store.narrative_summary, chunks)
    ? stateRevisionOf(store.narrative_summary, store.narrative_anchors?.active, store.narrative_knowledge?.entries)
    : null;

/**
 * Feed parked active anchors to the retrieval query.
 *
 * A parked anchor is not in the state block, and its derived wording may not appear in the original at
 * all - the d7eed81 audit's east-room constraint says 遗物间/碰锁 while the source says 朝东的房门还是锁着. The
 * original is still reachable: measured offline on that frozen state, the base query packed the source row
 * without the span carrying the constraint, and adding the parked statements recovered the original row
 * (raw_18). Bounded by the query's existing 5000-character cap.
 */
export function parkedAnchorQuery(query, parkedText, maxChars = 5000) {
    if (!parkedText) return query;
    return [query, parkedText].join('\n').slice(-maxChars);
}

/**
 * The injection budget, separated from the summary's own length. `configured` is the worst case the
 * blocks may occupy - the summary at its ceiling plus the anchor, knowledge, evidence and setting
 * budgets - and `hostRoom` is what the host context leaves after the visible transcript and the reply
 * reserve. The smaller is the total. Kept pure so the "no room" path is testable without a host.
 */
export function budgetsOf(opts, { contextSize = null, rawTokens = 0, replyReserve = 1024 } = {}) {
    const configured = opts.summaryCeiling + opts.anchorTokens + opts.knowledgeTokens
        + opts.evidenceTokens + opts.settingTokens + 100;
    const hostRoom = Number(contextSize) > 0
        ? Math.max(0, Number(contextSize) - Number(rawTokens || 0) - Number(replyReserve || 0)) : configured;
    return { configured, hostRoom, totalBudget: Math.min(configured, hostRoom) };
}

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
    let query = plan.query;
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
    // A parked anchor is invisible to the state block, so give its wording a route back through the
    // existing retrieval channels before the ranking runs. The dense query above is untouched: this is
    // not a weight change and not a reserved evidence seat.
    if (continuity.anchorsTruncated > 0 && continuity.anchorsParkedText.length) {
        const parkedText = continuity.anchorsParkedText.join('\n');
        query = parkedAnchorQuery(query, parkedText);
        diagnose(ctx, { retrieval_parked_anchors: { at: Date.now(), anchors: continuity.anchorsTruncated,
            query_chars: query.length } });
    }
    const raw = history.active.filter(id => visibleSources.has(id)).map(id => history.records[id].text).join('\n');
    // Who the situation is about. The knowledge block is keyed by character name, so the names are already
    // extracted and do not need a second model call: a name that the summary tracks and that the last three
    // messages mention is a character who is in the scene.
    const profileNames = plan.profileNames;
    const { configured, hostRoom, totalBudget } = budgetsOf(opts, { contextSize,
        rawTokens: estimateTokens(raw), replyReserve: bound(settings.context_reply_reserve_tokens, 1024, 0, 32000) });
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
    // The policy is named here rather than left to the packer's default, so the runtime module states which
    // packer it ships and a future edit cannot switch a live prompt to the offline submodular experiment by
    // changing a default somewhere else.
    // The query is passed, not only used for ranking: a span larger than its share is trimmed from the head,
    // and the packer needs the question to know which part to keep. Omitting it left that rule inert in the
    // shipped prompt while every offline harness - which does pass it - measured it working.
    const evidence = packRawEvidence(ranked, history, { maxTokens: evidenceBudget, visibleSources,
        policy: SHIPPED_PACK_POLICY, query });
    // The three local questions (may this floor be hidden, what fits the anchor block, what fits the boundary
    // block) are answered above; this is the one they do not answer between them: of the statements the ledger
    // still calls live, which ones does this prompt carry at all.
    const carriers = ledgerCarriers({ anchors: continuity.anchors, knowledge: continuity.knowledge,
        anchorInjected: new Set(continuity.anchorsInjectedIds || []),
        knowledgeInjected: new Set(continuity.knowledgeInjectedIds || []),
        evidenceSources: new Set(evidence.sources.map(row => row.source)) });
    // The other error direction from the carrier resolution: not a required statement that is missing, but a
    // quoted row that only a retired statement names. The retired statement's row stays active, so it is still
    // ranked; what stops it being current is the ledger, not the index.
    const supersededOnly = supersededSources(continuity.anchors, live.narrative_anchors?.superseded || []);
    const supersededEvidence = evidence.sources.filter(row => supersededOnly.has(String(row.source)));
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
        anchors_total: continuity.anchors.length, anchors_injected: continuity.anchorsInjected,
        anchors_same_subject: countAnchorCollisions(continuity.anchors),
        anchor_op_errors: live.narrative_diagnostics?.anchor_op_errors || null,
        knowledge_unconfirmed: continuity.knowledge.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(live.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(live.narrative_knowledge?.max_per_subject) || 0,
        knowledge_entries: continuity.knowledge.length,
        knowledge_injected: continuity.knowledgeInjected,
        knowledge_parked: continuity.knowledgeParked,
        required_none: carriers.none,
        required_uncarried: carriers.uncarried,
        entity_missed: 0 }, opts); // Query-term coverage is a trace, not a quality alarm.
    const diagnostics = { summary_tokens: estimateTokens(continuity.summaryBlock), evidence_tokens: estimateTokens(evidence.text),
        reference_tokens: estimateTokens(referenceBlock), visible_raw_tokens: estimateTokens(raw),
        covered_chunks: live.narrative_summary?.covered.length || 0, chunks: chunks.length,
        pending_floors: pending.pending_floors, pending_tokens: pending.pending_tokens,
        summary_failures: Number(live.narrative_diagnostics?.summary_failures) || 0,
        anchors_active: continuity.anchors.length,
        anchors_injected: continuity.anchorsInjected,
        anchors_parked: continuity.anchorsTruncated,
        anchors_parked_terms: continuity.anchorsParkedTerms,
        anchors_superseded: (live.narrative_anchors?.superseded || []).length,
        // Entries with no subject can only be folded when they are near-verbatim, so this is the number that
        // says how much of the ledger supersession still cannot reason about.
        anchors_without_subject: continuity.anchors.filter(item => !String(item.subject || '').trim()).length,
        anchors_unconfirmed: continuity.anchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: continuity.anchorsTruncated,
        anchors_same_subject: countAnchorCollisions(continuity.anchors),
        anchors_ops: live.narrative_diagnostics?.anchor_ops || null,
        anchor_op_errors: live.narrative_diagnostics?.anchor_op_errors?.errors || null,
        anchors_superseded_limit: MAX_SUPERSEDED,
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
        knowledge_injected: continuity.knowledgeInjected,
        knowledge_parked: continuity.knowledgeParked,
        knowledge_parked_terms: continuity.knowledgeParkedTerms,
        knowledge_unconfirmed: continuity.knowledge.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(live.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(live.narrative_knowledge?.max_per_subject) || 0,
        warnings,
        // The carrier resolution for this prompt: how many live ledger statements were injected as their own
        // line, how many are merely represented by a quoted original, and how many are in neither.
        required_total: carriers.rows, required_line: carriers.line, required_source: carriers.source,
        required_none: carriers.none, required_uncarried: carriers.uncarried,
        required_source_detail: carriers.sourceDetail,
        // What the number above is, in one machine-readable word, because it is not a reading of the summary.
        required_metric: 'structural_lower_bound_not_meaning',
        // The other direction: quoted rows that only a retired statement names. Reported, not alarmed - it is
        // frequently non-zero and only the reply can say whether the old value was used as the current one.
        superseded_evidence: supersededEvidence.length,
        superseded_evidence_sources: supersededEvidence.map(row => String(row.source)),
        superseded_source_pool: supersededOnly.size,
        superseded_evidence_metric: 'risk_indicator_not_a_verdict',
        sources: evidence.sources, candidates: ranked.length,
        // What was quoted is not the same question as what ranked. Both are recorded, bounded, so a row the
        // answer is in can be told apart from a row that never ranked without a live debugging session:
        // evidence_candidates is the order and per-channel signal the packer was given, evidence_trace is
        // what it did with each row (included / budget / too_long / entry_cap / not_selected / same-text /
        // same-message) and whether an included quote had to be shortened to fit.
        evidence_candidates: summarizeEvidenceCandidates(ranked),
        evidence_trace: summarizeEvidenceTrace(evidence.trace),
        rerank_model: opts.rerankModel || null, rerank_used: reranked.used, rerank_error: reranked.error,
        rerank_cost: reranked.metrics || null,
        channels: { lexical: ranked.filter(row => row.channels.includes('lexical')).length,
            vector: ranked.filter(row => row.channels.includes('vector')).length },
        // What the retrieval layers are, not only how many candidates each returned. "Dense was on" reads the
        // same at a 0.1 vote and at a 1.0 vote, and the packer's policy was not stated anywhere in the trace.
        retrieval_config: shippedRetrievalConfig(),
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
    // The anchor block is selected on every assembly, so a read-only report runs the same selection to know
    // what was left out. It used to hard-code zero here, which meant the panel could never show the warning
    // the generation itself had recorded.
    const activeAnchors = store.narrative_anchors?.active || [];
    const reportSelection = selectAnchors(activeAnchors, { budget: options(settings).anchorTokens });
    const anchorsTruncated = reportSelection.parked.length;
    // The knowledge block is fitted on every assembly too, and it used to report only its surviving text:
    // the panel could state a parked anchor but not a dropped knowledge entry. The report runs the same
    // selection, so one rule decides what is missing here and in the generation.
    const knowledgeEntries = store.narrative_knowledge?.entries || [];
    const reportKnowledge = selectKnowledge(knowledgeEntries, { budget: options(settings).knowledgeTokens });
    // The carrier resolution uses the evidence the last generation actually packed, which the build recorded,
    // and the two selections recomputed above. So the panel states the same thing the generation did without
    // running one.
    const reportCarriers = ledgerCarriers({ anchors: activeAnchors, knowledge: knowledgeEntries,
        anchorInjected: new Set(reportSelection.injected.map(item => item.id)),
        knowledgeInjected: new Set(reportKnowledge.injectedEntries.map(item => item.id)),
        evidenceSources: new Set((store.narrative_diagnostics?.sources || []).map(row => row.source)) });
    // Same two directions the build reports, recomputed from the evidence the last generation packed.
    const reportSupersededOnly = supersededSources(activeAnchors, store.narrative_anchors?.superseded || []);
    const reportSupersededEvidence = (store.narrative_diagnostics?.sources || [])
        .map(row => String(row.source)).filter(source => reportSupersededOnly.has(source));
    const state = { ...pending, summary_failures: failures,
        summary_error: store.narrative_diagnostics?.summary_error || null,
        summary_block: store.narrative_diagnostics?.summary_block || null,
        summarizing, every,
        anchors_unconfirmed: activeAnchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: anchorsTruncated,
        anchors_total: activeAnchors.length, anchors_injected: reportSelection.injected.length,
        anchors_same_subject: countAnchorCollisions(activeAnchors),
        anchor_op_errors: store.narrative_diagnostics?.anchor_op_errors || null,
        knowledge_unconfirmed: knowledgeEntries.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(store.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(store.narrative_knowledge?.max_per_subject) || 0,
        knowledge_entries: knowledgeEntries.length,
        knowledge_injected: reportKnowledge.injected,
        knowledge_parked: reportKnowledge.parked.length,
        required_none: reportCarriers.none,
        required_uncarried: reportCarriers.uncarried };
    return {
        enabled: settings.enabled !== false,
        summary_running: summarizing,
        summary_state: summarizeState({ ...state, failureWarn: options(settings).failureWarn }),
        summary_block: state.summary_block,
        summary_last_error: store.narrative_diagnostics?.summary_last_error || null,
        persist_error: store.narrative_diagnostics?.persist_error || null,
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
        summary_target_tokens: options(settings).summaryTokens,
        summary_ceiling_tokens: options(settings).summaryCeiling,
        summary_over_target: store.narrative_diagnostics?.summary_over_target || null,
        summary_failures: failures,
        anchors_active: activeAnchors.length,
        anchors_injected: reportSelection.injected.length,
        anchors_parked: anchorsTruncated,
        anchors_parked_terms: reportSelection.parked.map(item => ({ kind: String(item.kind || '其他'),
            text: String(item.text || '').slice(0, 80) })),
        anchors_superseded: (store.narrative_anchors?.superseded || []).length,
        anchors_without_subject: activeAnchors.filter(item => !String(item.subject || '').trim()).length,
        anchors_unconfirmed: activeAnchors.filter(item => Number(item.unconfirmed) > 0).length,
        anchors_truncated: anchorsTruncated,
        anchors_resolved: (store.narrative_anchors?.resolved || []).length,
        anchor_parse: store.narrative_diagnostics?.anchor_parse || store.narrative_anchors?.parse || null,
        // What the last committed batch did, what the last refused one was refused for, and what the
        // retirement window actually keeps. "The retired history is complete" is not a claim this makes:
        // the window is 40 records, and past it only the original floors remain.
        anchors_ops: store.narrative_diagnostics?.anchor_ops || null,
        anchor_op_errors: store.narrative_diagnostics?.anchor_op_errors?.errors || null,
        anchor_op_errors_at: store.narrative_diagnostics?.anchor_op_errors?.at || null,
        anchor_op_errors_recovered: store.narrative_diagnostics?.anchor_op_errors?.recovered === true,
        // A repair is a second model call with its own cost. It is reported apart from the batch request so
        // the price of a format failure stays visible instead of hiding inside the batch's token total.
        anchor_repaired: store.narrative_diagnostics?.anchor_ops?.repaired === true,
        anchor_repair: store.narrative_diagnostics?.anchor_repair || null,
        body_repair: store.narrative_diagnostics?.body_repair || null,
        anchors_same_subject: countAnchorCollisions(activeAnchors),
        anchors_superseded_limit: MAX_SUPERSEDED,
        anchors_superseded_recent: (store.narrative_anchors?.superseded || []).slice(0, 6).map(item => ({
            kind: String(item.kind || '其他'), subject: String(item.subject || ''),
            text: String(item.text || '').slice(0, 80), source: String(item.source || ''),
            reason: String(item.reason || '') })),
        knowledge_entries: knowledgeEntries.length,
        knowledge_injected: reportKnowledge.injected,
        knowledge_parked: reportKnowledge.parked.length,
        knowledge_parked_terms: reportKnowledge.parked.slice(0, 6).map(line => String(line).slice(0, 80)),
        // Live ledger statements with no carrier in the prompt the last generation actually delivered.
        required_total: reportCarriers.rows,
        required_line: reportCarriers.line,
        required_source: reportCarriers.source,
        required_none: reportCarriers.none,
        required_uncarried: reportCarriers.uncarried,
        required_source_detail: reportCarriers.sourceDetail,
        required_metric: 'structural_lower_bound_not_meaning',
        superseded_evidence: reportSupersededEvidence.length,
        superseded_evidence_sources: reportSupersededEvidence,
        superseded_source_pool: reportSupersededOnly.size,
        superseded_evidence_metric: 'risk_indicator_not_a_verdict',
        knowledge_unconfirmed: knowledgeEntries.filter(item => Number(item.unconfirmed) > 0).length,
        knowledge_duplicate_subjects: Number(store.narrative_knowledge?.duplicate_subjects) || 0,
        knowledge_max_per_subject: Number(store.narrative_knowledge?.max_per_subject) || 0,
        entity_candidates: store.narrative_diagnostics?.entity_candidates || 0,
        entity_metric: 'query_term_coverage_only_not_quality',
        query_strategy: store.narrative_diagnostics?.query_strategy || null,
        retrieval_config: shippedRetrievalConfig(),
        retrieval_parked_anchors: store.narrative_diagnostics?.retrieval_parked_anchors || null,
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
        + [['narrative_every','每几楼更新摘要（1 楼 = user 消息 + 角色回复）',1,100],['narrative_summary_tokens','摘要 token 目标',100,4000],['narrative_summary_ceiling_tokens','摘要硬上限 token（0=按目标自动，超出才拒绝）',0,4000],
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
        + '<div data-anchors class="aum-v51-status"></div>'
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
        // The soft target and the emergency ceiling are different numbers, so an accepted over-target body
        // is stated as such instead of being hidden inside a pass. A parked anchor that was folded into the
        // retrieval query is stated apart from the parked count, because the two are different conditions.
        const extras = [];
        if (report.summary_over_target) extras.push('上次摘要超出软目标（目标 ' + report.summary_over_target.target
            + ' / 硬上限 ' + report.summary_over_target.ceiling + '，实测 ' + report.summary_over_target.accepted_tokens + ' token）');
        if (report.retrieval_parked_anchors) extras.push('已将 ' + report.retrieval_parked_anchors.anchors + ' 条停放锚点并入检索查询');
        state.textContent = '摘要状态：' + (SUMMARY_STATE_TEXT[report.summary_state] || report.summary_state || '未知')
            + '（待总结 ' + report.pending_floors + ' 个已完成 user turns / 约 ' + report.pending_tokens + ' token'
            + (report.summary_running ? '，任务运行中' : '') + '）' + (extras.length ? '；' + extras.join('；') : '');
    }
    // A notice is not a fault: it is something about the configuration the user should know, shown apart
    // from the warnings so that a real fault is not read as one more line of advice.
    // The anchor line states what the last committed batch did to the ledger and what the last refused one
    // was refused for. It is separate from the warnings because "3 updates applied" and "the batch was not
    // applied" are different sentences, and a user who only sees the second cannot tell whether the feature
    // is working at all.
    const anchorState = root.querySelector('[data-anchors]');
    if (anchorState) {
        const ops = report.anchors_ops;
        const parts = [];
        if (ops) parts.push('上一批锚点变更：共 ' + ops.total + ' 条（新增 ' + ops.added + '，更新 ' + ops.updated
            + '，结束 ' + ops.ended + '，重复 ' + ops.restated
            + (ops.reinterpreted ? '，把“更新”当“新增”用了 ' + ops.reinterpreted + ' 条' : '') + '）');
        parts.push('锚点活值 ' + report.anchors_active + ' 条，注入 ' + report.anchors_injected + ' 条'
            + (report.anchors_parked ? '（搁置 ' + report.anchors_parked + '）' : '')
            + '，退场记录 ' + report.anchors_superseded + ' 条（最多保留 ' + report.anchors_superseded_limit + ' 条）');
        parts.push('知情边界 ' + report.knowledge_entries + ' 条，注入 ' + report.knowledge_injected + ' 条'
            + (report.knowledge_parked ? '（搁置 ' + report.knowledge_parked + '）' : ''));
        if (report.required_none) parts.push('本次注入里没有任何载体的活陈述 ' + report.required_none
            + ' 条（共 ' + report.required_total + ' 条）');
        if (report.superseded_evidence) parts.push('证据里 ' + report.superseded_evidence
            + ' 条来自只被已取代陈述引用的原文行（历史成立、可能被当成现状用）');
        if (report.anchors_same_subject) parts.push('同一主体多活值 ' + report.anchors_same_subject + ' 组');
        if (report.anchor_op_errors?.length) parts.push((report.anchor_op_errors_recovered ? '上一次' : '最近一批')
            + '锚点变更被拒绝 ' + report.anchor_op_errors.length + ' 条'
            + (report.anchor_op_errors_recovered ? '（已恢复）' : ''));
        anchorState.textContent = parts.join('；');
        const retired = report.anchors_superseded_recent?.[0];
        if (retired) anchorState.textContent += '；最近退场：' + retired.kind + '／' + (retired.subject || '无主体')
            + '（来源 ' + (retired.source || '未知') + '）';
    }
    const notice = root.querySelector('[data-notice]');
    if (notice) {
        notice.textContent = report.notices.length ? 'ℹ ' + report.notices.join(' ') : '';
        notice.hidden = !report.notices.length;
    }
    const warning = root.querySelector('[data-warning]');
    if (warning) {
        const lines = [...report.warnings];
        // A write that failed after the commit is not a lost summary, but it is not on disk either, so it is
        // a warning a reader must see rather than a silent detail in the JSON below (audit F-1).
        if (report.persist_error) lines.unshift('元数据写入失败（提交已生效，但尚未落盘）：' + report.persist_error.reason);
        warning.textContent = lines.length ? '⚠ ' + lines.join(' ') : '';
        warning.hidden = !lines.length;
    }
    root.querySelector('[data-status]').textContent = JSON.stringify(report, null, 2);
}
