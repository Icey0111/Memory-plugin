import {
    MEMORY_VERSION,
    applyMemoryOps,
    buildQueryText,
    buildQueryVariants,
    buildRetrievalText,
    collectOpsSources,
    computeVectorHash,
    createEmptyStore,
    diversifyCandidates,
    filterRecalledMemories,
    fuseHybridCandidates,
    graphDiffuseCandidates,
    findLatestActiveState,
    fnv1a32,
    formatMemoryContext,
    getActiveMemories,
    getIndexableMemories,
    lexicalSearchMemories,
    isMemorySettled,
    normalizeStore,
    parseMemoryOpsFromMessage,
    replayStoreFromChat,
    replayStoreFromExtractions,
    computeDialoguePairFingerprint,
    collectAutonomousExtractionSources,
    shouldIndexMemory,
    sourcesArePrefix,
    stableStringify,
    stripSummaryForQuery,
    validateMemoryOp,
} from './memory-core.js';

import {
    EXTRACTION_JSON_SCHEMA,
    buildAutonomousExtractionPrompt,
    parseExtractionResult,
} from './memory-extractor.js';

import {
    buildBaselineHint,
    buildBaselineRecords,
    computeBaselineFingerprint,
    evaluateBaselineDuplicate,
    fnv1a32Baseline,
    isBaselineGateEligible,
} from './baseline-index.js';

import { collectSemanticBaselineSources } from './baseline-host.js';

const MODULE_ID = 'aetheria-unified-memory-v5_4';
const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const LEGACY_SETTINGS_KEYS = ['aetheriaUnifiedMemoryV53', 'aetheriaUnifiedMemoryV52', 'aetheriaUnifiedMemoryV51'];
const LEGACY_METADATA_KEYS = ['aetheriaUnifiedMemoryV53', 'aetheriaUnifiedMemoryV52', 'aetheriaUnifiedMemoryV51'];
const PROMPT_KEY = 'aetheria_unified_memory_v5_4';
const INTERCEPTOR_NAME = 'aetheriaUnifiedMemoryV54Interceptor';
const EXTENSION_PATH = 'third-party/Memory-plugin';
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    // v5.4 owns extraction. Legacy <memory_ops> parsing only exists for v5/v5.1/v5.2 migration.
    auto_extract: true,
    extraction_context_messages: 4,
    extraction_structured_output: true,
    extraction_retry_plain_json: true,
    memory_freshness_wait_ms: 800,
    extraction_notifications: false,
    parse_ops: true,
    // v5.4: independent Persona / character / World Info semantic baseline gate.
    semantic_baseline_gate: true,
    baseline_use_vector: true,
    baseline_auto_rebuild: true,
    baseline_include_active_world_info: true,
    baseline_lexical_threshold: 0.78,
    baseline_similarity_threshold: 0.84,
    baseline_semantic_lexical_floor: 0.16,
    baseline_chunk_chars: 420,
    baseline_hint_chars: 12000,
    inject_current_state: true,
    vector_recall: true,
    vector_source_mode: 'inherit', // inherit | transformers
    query_messages: 3,
    candidate_top_k: 18,
    lexical_candidate_top_k: 28,
    final_recall_count: 6,
    score_threshold: 0.22,
    hybrid_recall: true,
    lexical_weight: 0.9,
    rrf_k: 60,
    graph_diffusion: true,
    graph_damping: 0.18,
    mmr_lambda: 0.78,
    recall_cooldown_turns: 4,
    vector_settle_messages: 0,
    max_memory_context_chars: 7000,
    include_evidence: true,
    injection_depth: 4,
    max_active_items: 12,
    protect_recent_messages: 8,
    auto_rebuild_vectors_on_history_change: true,
    // Optional prompt-window management. Disabled by default until real-chat acceptance.
    manage_context_window: false, // reserved; v5.4 intentionally does not mutate chat history
    keep_recent_messages: 12,
    debug: false,
});

const SUPPORTED_SERVER_VECTOR_SOURCES = new Set([
    'transformers', 'mistral', 'openai', 'palm', 'togetherai', 'nomicai', 'cohere',
    'ollama', 'llamacpp', 'vllm', 'vertexai', 'electronhub', 'openrouter', 'chutes',
    'nanogpt', 'siliconflow', 'workers_ai',
]);
const UNSUPPORTED_CLIENT_VECTOR_SOURCES = new Set(['webllm', 'koboldcpp', 'extras']);

let initialized = false;
let operationQueue = Promise.resolve();
let extractionQueue = Promise.resolve();
let extractionPending = 0;
let vectorQueue = Promise.resolve();
let statusTimer = null;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function log(...args) {
    const ctx = getContext();
    const settings = ctx ? getSettings(ctx) : DEFAULT_SETTINGS;
    if (settings.debug) console.debug('[Aetheria Memory v5.4]', ...args);
}

function notify(type, message, title = '艾瑟瑞亚统一记忆') {
    const toast = globalThis.toastr;
    if (toast && typeof toast[type] === 'function') toast[type](message, title);
    else console[type === 'error' ? 'error' : 'log'](`[${title}] ${message}`);
}

function getSettings(ctx) {
    if (!ctx.extensionSettings[SETTINGS_KEY] || typeof ctx.extensionSettings[SETTINGS_KEY] !== 'object') {
        const legacy = LEGACY_SETTINGS_KEYS.map(key => ctx.extensionSettings[key]).find(value => value && typeof value === 'object');
        ctx.extensionSettings[SETTINGS_KEY] = legacy && typeof legacy === 'object'
            ? { ...DEFAULT_SETTINGS, ...legacy }
            : { ...DEFAULT_SETTINGS };
    }
    const current = ctx.extensionSettings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (current[key] === undefined) current[key] = value;
    }
    return current;
}

function getStore(ctx) {
    const legacySource = LEGACY_METADATA_KEYS.map(key => ctx.chatMetadata?.[key]).find(value => value && typeof value === 'object');
    const source = ctx.chatMetadata?.[METADATA_KEY] ?? legacySource;
    const normalized = normalizeStore(source);
    if (!ctx.chatMetadata) return normalized;
    ctx.chatMetadata[METADATA_KEY] = normalized;
    return normalized;
}

function setStore(ctx, store, save = true) {
    if (!ctx.chatMetadata) return;
    ctx.chatMetadata[METADATA_KEY] = normalizeStore(store);
    if (save) ctx.saveMetadataDebounced?.();
    scheduleStatusUpdate();
}

function enqueue(task) {
    operationQueue = operationQueue
        .then(() => task())
        .catch(error => {
            console.error('[Aetheria Memory v5.4] queued task failed', error);
            notify('error', String(error?.message || error));
        });
    return operationQueue;
}

function enqueueExtraction(task) {
    extractionPending += 1;
    const run = extractionQueue.then(() => task(), () => task());
    extractionQueue = run
        .catch(error => {
            console.error('[Aetheria Memory v5.4] extraction task failed', error);
            const ctx = getContext();
            const settings = ctx ? getSettings(ctx) : DEFAULT_SETTINGS;
            if (settings.extraction_notifications) notify('error', String(error?.message || error), '自动记忆抽取失败');
        })
        .finally(() => {
            extractionPending = Math.max(0, extractionPending - 1);
            scheduleStatusUpdate();
        });
    scheduleStatusUpdate();
    return run;
}

async function waitForExtractionFreshness(ctx) {
    const settings = getSettings(ctx);
    const ms = Math.max(0, Math.min(5000, Number(settings.memory_freshness_wait_ms) || 0));
    if (!ms || extractionPending <= 0) return;
    await Promise.race([
        extractionQueue.catch(() => {}),
        new Promise(resolve => setTimeout(resolve, ms)),
    ]);
}


function withVectorLock(task) {
    const run = vectorQueue.then(() => task(), () => task());
    vectorQueue = run.catch(error => {
        log('vector queue task failed', error);
    });
    return run;
}

function getCollectionId(ctx) {
    const rawChatId = ctx.getCurrentChatId?.() ?? ctx.chatId ?? '';
    const chatId = String(rawChatId || '').trim();
    if (!chatId) return null;
    return `aetheria_v54_${fnv1a32(chatId).toString(36)}`;
}


function getChatIdentity(ctx) {
    return String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? '').trim();
}


function getBaselineCollectionId(ctx) {
    const chatId = getChatIdentity(ctx);
    if (!chatId) return null;
    return `aetheria_v54_baseline_${fnv1a32(chatId).toString(36)}`;
}

function computeBaselineVectorHash(record) {
    return fnv1a32Baseline(`baseline-v54|${record?.id || ''}|${record?.normalized || record?.text || ''}`);
}

function summarizeBaselineSources(sources) {
    return (Array.isArray(sources) ? sources : []).map(s => ({
        type: String(s?.source_type || 'unknown'),
        id: String(s?.source_id || ''),
        title: String(s?.title || ''),
        chars: String(s?.text || '').length,
    }));
}

async function ensureSemanticBaseline(ctx, { force = false, silent = true } = {}) {
    const settings = getSettings(ctx);
    const sources = await collectSemanticBaselineSources(ctx, {
        includeActiveWorldInfo: Boolean(settings.baseline_include_active_world_info),
    });
    const records = buildBaselineRecords(sources, { maxChars: settings.baseline_chunk_chars });
    const fingerprint = computeBaselineFingerprint(records);
    // Activated World Info can change from turn to turn as keyword/selective entries fire.
    // Keep it in the lexical hard gate + extractor hint, but do not force a full vector rebuild
    // every time that volatile activation set changes. Stable bound sources form the vector corpus.
    const vectorRecords = records.filter(record => record.source_type !== 'active_world_info');
    const vectorFingerprint = computeBaselineFingerprint(vectorRecords);
    const hint = buildBaselineHint(records, settings.baseline_hint_chars);
    let store = getStore(ctx);
    const provider = getVectorProvider(ctx);
    const collectionId = getBaselineCollectionId(ctx);
    const previous = store.baseline || createEmptyStore().baseline;
    const fingerprintChanged = previous.vector?.fingerprint !== vectorFingerprint;
    const providerChanged = Boolean(previous.vector?.provider_fingerprint && previous.vector.provider_fingerprint !== provider.fingerprint);

    store.baseline = {
        ...previous,
        fingerprint,
        record_count: records.length,
        vector_record_count: vectorRecords.length,
        source_count: sources.length,
        source_labels: summarizeBaselineSources(sources),
        last_built_at: Date.now(),
        vector: {
            ...previous.vector,
            collection_id: collectionId,
        },
    };

    if (!records.length) {
        store.baseline.vector.stale = false;
        store.baseline.vector.fingerprint = vectorFingerprint;
        store.baseline.vector.provider_fingerprint = provider.fingerprint;
        store.baseline.vector.last_error = null;
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, hint, vectorReady: false, provider, collectionId };
    }

    if (!settings.semantic_baseline_gate) {
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = 'Semantic Baseline Gate 已关闭。';
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, hint, vectorReady: false, provider, collectionId };
    }

    if (!settings.baseline_use_vector) {
        store.baseline.vector.stale = false;
        store.baseline.vector.last_error = null;
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, hint, vectorReady: false, provider, collectionId };
    }

    if (!collectionId) {
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = '当前没有聊天ID，Baseline向量索引不可用；仍使用本地词法硬过滤。';
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, hint, vectorReady: false, provider, collectionId };
    }
    if (!provider.supported) {
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = `${provider.reason || 'Embedding provider不可用'}；仍使用本地词法硬过滤。`;
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, hint, vectorReady: false, provider, collectionId };
    }

    const needsRebuild = force || fingerprintChanged || providerChanged
        || previous.vector?.stale !== false
        || previous.vector?.fingerprint !== vectorFingerprint
        || previous.vector?.provider_fingerprint !== provider.fingerprint;

    if (needsRebuild && settings.baseline_auto_rebuild) {
        try {
            const items = vectorRecords.map((record, index) => ({
                hash: computeBaselineVectorHash(record),
                text: `[${record.source_type}:${record.title}] ${record.text}`,
                index,
            }));
            await withVectorLock(async () => {
                await purgeVectorCollection(ctx, collectionId);
                const batchSize = 40;
                for (let i = 0; i < items.length; i += batchSize) {
                    await vectorInsert(ctx, provider, collectionId, items.slice(i, i + batchSize));
                }
            });
            store = getStore(ctx);
            store.baseline = {
                ...(store.baseline || {}),
                fingerprint,
                record_count: records.length,
                vector_record_count: vectorRecords.length,
                source_count: sources.length,
                source_labels: summarizeBaselineSources(sources),
                last_built_at: Date.now(),
                vector: {
                    ...(store.baseline?.vector || {}),
                    collection_id: collectionId,
                    fingerprint: vectorFingerprint,
                    provider_fingerprint: provider.fingerprint,
                    stale: false,
                    last_error: null,
                    last_sync_at: Date.now(),
                },
            };
            setStore(ctx, store);
            if (!silent) notify('success', `Semantic Baseline 已重建：${records.length} 个分块。`, 'Baseline Index');
        } catch (error) {
            store = getStore(ctx);
            store.baseline.vector = {
                ...(store.baseline?.vector || {}),
                collection_id: collectionId,
                fingerprint: vectorFingerprint,
                provider_fingerprint: provider.fingerprint,
                stale: true,
                last_error: String(error?.message || error),
            };
            setStore(ctx, store);
            if (!silent) notify('warning', `Baseline向量重建失败，将退化到词法过滤：${store.baseline.vector.last_error}`, 'Baseline Index');
        }
    } else {
        if (needsRebuild) {
            store.baseline.vector.stale = true;
            store.baseline.vector.last_error = 'Baseline来源或Embedding provider已变化，需要重建。';
        }
        setStore(ctx, store);
    }

    const current = getStore(ctx);
    const vectorReady = Boolean(
        settings.baseline_use_vector
        && provider.supported
        && collectionId
        && current.baseline?.vector?.stale === false
        && current.baseline?.vector?.fingerprint === vectorFingerprint
        && current.baseline?.vector?.provider_fingerprint === provider.fingerprint
    );
    return { sources, records, vectorRecords, fingerprint, vectorFingerprint, hint, vectorReady, provider, collectionId };
}

async function getSemanticBaselineMatches(ctx, op, prepared) {
    const settings = getSettings(ctx);
    if (!prepared?.vectorReady || !isBaselineGateEligible(op)) return [];
    const threshold = Math.max(0, Math.min(1, Number(settings.baseline_similarity_threshold) || 0.84));
    try {
        const result = await withVectorLock(() => vectorQuery(
            ctx,
            prepared.provider,
            prepared.collectionId,
            String(op.text || ''),
            5,
            threshold,
        ));
        return (Array.isArray(result?.metadata) ? result.metadata : []).map(row => {
            const index = Number(row?.index);
            return {
                index,
                record: Number.isInteger(index) ? prepared.vectorRecords?.[index] || prepared.records[index] : null,
                // ST's /api/vector/query threshold-filtered metadata does not guarantee score exposure.
                score: Number.isFinite(Number(row?.score)) ? Number(row.score) : threshold,
            };
        }).filter(x => x.record);
    } catch (error) {
        const store = getStore(ctx);
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = `Baseline query failed: ${String(error?.message || error)}`;
        setStore(ctx, store);
        return [];
    }
}

async function filterOperationsAgainstBaseline(ctx, ops, prepared) {
    const settings = getSettings(ctx);
    if (!settings.semantic_baseline_gate || !prepared?.records?.length) {
        return { accepted: [...ops], rejected: [] };
    }
    const accepted = [];
    const rejected = [];
    for (const op of ops) {
        if (!isBaselineGateEligible(op)) {
            accepted.push(op);
            continue;
        }
        let decision = evaluateBaselineDuplicate(op, prepared.records, {
            lexicalThreshold: settings.baseline_lexical_threshold,
            semanticThreshold: settings.baseline_similarity_threshold,
            semanticLexicalFloor: settings.baseline_semantic_lexical_floor,
        });
        if (!decision.blocked && prepared.vectorReady) {
            const semanticMatches = await getSemanticBaselineMatches(ctx, op, prepared);
            decision = evaluateBaselineDuplicate(op, prepared.records, {
                lexicalThreshold: settings.baseline_lexical_threshold,
                semanticMatches,
                semanticThreshold: settings.baseline_similarity_threshold,
                semanticLexicalFloor: settings.baseline_semantic_lexical_floor,
            });
        }
        if (decision.blocked) {
            rejected.push({
                op,
                reason: decision.reason,
                baseline_id: decision.match?.id || null,
                baseline_source: decision.match ? `${decision.match.source_type}:${decision.match.title}` : null,
                baseline_preview: String(decision.match?.text || '').slice(0, 300),
                lexical_score: decision.lexical_score ?? decision.best_lexical ?? null,
                semantic_score: decision.semantic_score ?? null,
            });
        } else accepted.push(op);
    }
    return { accepted, rejected };
}

function isAssistantMessage(message) {
    return Boolean(message && message.is_user !== true && !message.is_system && String(message.mes ?? '').trim());
}

function findLatestAssistantIndex(chat) {
    const rows = Array.isArray(chat) ? chat : [];
    for (let i = rows.length - 1; i >= 0; i--) {
        if (isAssistantMessage(rows[i])) return i;
    }
    return -1;
}

function buildRecentContextForExtraction(chat, assistantIndex, maxMessages = 4) {
    const rows = Array.isArray(chat) ? chat : [];
    const count = Math.max(0, Math.min(12, Number(maxMessages) || 0));
    if (!count) return '';
    const start = Math.max(0, Number(assistantIndex) - count - 1);
    const lines = [];
    for (let i = start; i < assistantIndex - 1; i++) {
        const msg = rows[i];
        if (!msg || msg.is_system) continue;
        const text = stripSummaryForQuery(String(msg.mes ?? '')).trim();
        if (!text) continue;
        lines.push(`${msg.is_user ? '[USER]' : '[ASSISTANT]'} ${text}`);
    }
    return lines.join('\n\n').slice(-16000);
}

function formatCanonicalStateForExtraction(storeInput) {
    const store = normalizeStore(storeInput);
    const active = Object.values(store.memories)
        .filter(m => m.status === 'active')
        .sort((a, b) => Number(b.source_message ?? -1) - Number(a.source_message ?? -1))
        .slice(0, 28)
        .map(m => {
            const slot = m.slot ? ` slot=${m.slot}` : '';
            const known = Array.isArray(m.known_by) && m.known_by.length ? ` known_by=${m.known_by.join(',')}` : '';
            return `- [${m.kind}${slot}${known}] ${m.text}`;
        });
    const recentClosed = Object.values(store.memories)
        .filter(m => m.status === 'closed' && ['high', 'critical'].includes(m.importance || 'medium'))
        .sort((a, b) => Number(b.source_message ?? -1) - Number(a.source_message ?? -1))
        .slice(0, 8)
        .map(m => `- [past:${m.kind}] ${m.text}`);
    return [...active, ...recentClosed].join('\n').slice(0, 12000);
}

function pruneStaleExtractionRecords(storeInput, chat) {
    const store = normalizeStore(storeInput);
    const valid = new Set();
    for (let i = 0; i < (Array.isArray(chat) ? chat.length : 0); i++) {
        const pair = computeDialoguePairFingerprint(chat, i);
        if (pair) valid.add(pair.key);
    }
    for (const key of Object.keys(store.extractions || {})) {
        if (!valid.has(key)) delete store.extractions[key];
    }
    return store;
}

async function runQuietExtraction(ctx, prompt, useStructured = true) {
    if (typeof ctx.generateQuietPrompt !== 'function') {
        throw new Error('当前 SillyTavern Context 未提供 generateQuietPrompt，无法执行自动记忆抽取。');
    }
    const options = { quietPrompt: prompt };
    if (useStructured) options.jsonSchema = EXTRACTION_JSON_SCHEMA;
    return await ctx.generateQuietPrompt(options);
}

async function extractMemoryForAssistant(ctx, assistantIndex, { force = false } = {}) {
    const settings = getSettings(ctx);
    if (!settings.enabled || !settings.auto_extract) return { skipped: 'disabled' };
    const rows = ctx.chat || [];
    const pair = computeDialoguePairFingerprint(rows, assistantIndex);
    if (!pair) return { skipped: 'not-assistant' };
    const chatIdentity = getChatIdentity(ctx);
    if (!chatIdentity) return { skipped: 'no-chat' };

    let store = getStore(ctx);
    const existing = store.extractions?.[pair.key];
    if (!force && existing && Number(existing.source_hash) === Number(pair.hash)) {
        return { skipped: 'already-extracted', record: existing };
    }
    const replacingExistingRecord = Boolean(force && existing && Number(existing.source_hash) === Number(pair.hash));
    // v5/v5.1/v5.2 already embedded machine operations in assistant replies.
    // During migration, replay those operations instead of paying for a duplicate quiet extraction.
    if (!force && settings.parse_ops && /<memory_ops\b[^>]*>/i.test(String(rows[assistantIndex]?.mes ?? ''))) {
        return { skipped: 'legacy-inline-ops' };
    }

    let preparedBaseline = await ensureSemanticBaseline(ctx, { silent: true });
    const prompt = buildAutonomousExtractionPrompt({
        userText: pair.userText,
        assistantText: pair.assistantText,
        recentContext: buildRecentContextForExtraction(rows, assistantIndex, settings.extraction_context_messages),
        canonicalState: formatCanonicalStateForExtraction(store),
        baselineHint: preparedBaseline.hint,
    });

    const started = performance.now?.() ?? Date.now();
    let raw = '';
    let parsed = null;
    let mode = 'structured';
    try {
        raw = await runQuietExtraction(ctx, prompt, Boolean(settings.extraction_structured_output));
        parsed = parseExtractionResult(raw);
        if ((!parsed.ok || (raw.trim() === '{}' && !parsed.eventSummary)) && settings.extraction_retry_plain_json) {
            mode = 'plain-json-retry';
            raw = await runQuietExtraction(ctx, `${prompt}\n\n严格只输出JSON，不要代码围栏。`, false);
            parsed = parseExtractionResult(raw);
        }
    } catch (error) {
        store.last_extraction_debug = {
            status: 'error', message_index: assistantIndex, source_key: pair.key,
            error: String(error?.message || error), at: Date.now(),
        };
        setStore(ctx, store);
        throw error;
    }
    if (!parsed?.ok) {
        const error = new Error(`记忆抽取JSON解析失败：${parsed?.error || 'unknown error'}`);
        store.last_extraction_debug = {
            status: 'parse-error', message_index: assistantIndex, source_key: pair.key,
            raw_preview: String(raw || '').slice(0, 1200), error: error.message, at: Date.now(),
        };
        setStore(ctx, store);
        throw error;
    }

    // Do not commit a result produced for a chat/branch that changed while the quiet LLM call was running.
    const current = getContext();
    const currentPair = current && getChatIdentity(current) === chatIdentity
        ? computeDialoguePairFingerprint(current.chat || [], assistantIndex)
        : null;
    if (!currentPair || currentPair.key !== pair.key || Number(currentPair.hash) !== Number(pair.hash)) {
        return { skipped: 'source-changed-during-extraction' };
    }

    const validatedOps = [];
    const validationErrors = [];
    for (const op of parsed.operations) {
        const validationErrorsForOp = validateMemoryOp(op);
        if (!validationErrorsForOp.length) validatedOps.push(op);
        else validationErrors.push(...validationErrorsForOp);
    }

    // Refresh baseline after the quiet call too. Persona / World Info may have changed while the
    // extraction request was in flight; the hard write gate must use the current canonical baseline.
    preparedBaseline = await ensureSemanticBaseline(current, { silent: true });
    const baselineFiltered = await filterOperationsAgainstBaseline(current, validatedOps, preparedBaseline);
    const validOps = baselineFiltered.accepted;
    const baselineRejections = baselineFiltered.rejected;
    if (!validOps.length) {
        validOps.push({
            op: 'noop',
            reason: baselineRejections.length
                ? '候选操作均与Persona/角色卡/World Info基线重复，已由v5.4写入层拦截。'
                : '抽取器未返回可提交的记忆操作。',
        });
    }

    store = getStore(current);
    store = pruneStaleExtractionRecords(store, current.chat || []);
    const record = {
        version: '5.4',
        source_hash: pair.hash,
        source_key: pair.key,
        assistant_index_at_creation: assistantIndex,
        user_index_at_creation: pair.userIndex,
        event_summary: parsed.eventSummary,
        active_state: parsed.activeState,
        operations: validOps,
        baseline_fingerprint: preparedBaseline.fingerprint,
        baseline_rejections: baselineRejections,
        generated_at: Date.now(),
        generation_mode: mode,
    };
    store.extractions[pair.key] = record;

    let changedIds = [];
    let applyErrors = [];
    if (replacingExistingRecord) {
        // A forced re-extraction replaces one transaction. Replay all autonomous records so
        // memories emitted by the old transaction cannot survive as ghosts.
        const previousVector = store.vector;
        const previousBaseline = store.baseline;
        const replayed = replayStoreFromExtractions(current.chat || [], store.extractions || {}, {
            includeLegacyMessageOps: Boolean(settings.parse_ops),
        });
        store = replayed.store;
        store.baseline = previousBaseline || createEmptyStore().baseline;
        store.vector = {
            ...previousVector,
            stale: true,
            last_error: '记忆抽取记录被替换，需要安全重建向量。',
        };
        changedIds = Object.keys(store.memories);
        applyErrors = replayed.errors;
    } else {
        const applied = applyMemoryOps(store, validOps, {
            sourceMessageIndex: assistantIndex,
            sourceHash: pair.hash,
            sourceMessageText: `${pair.userText}\n${pair.assistantText}`,
        });
        store = applied.store;
        store.extractions[pair.key] = record;
        store.last_active_state = parsed.activeState;
        store.last_active_state_source = assistantIndex;
        store.last_event_summary = parsed.eventSummary;
        store.source_fingerprints = collectAutonomousExtractionSources(current.chat || [], store.extractions)
            .map(x => ({ index: x.assistantIndex, hash: x.hash }));
        changedIds = applied.changedIds;
        applyErrors = applied.errors;
    }
    const elapsed = (performance.now?.() ?? Date.now()) - started;
    store.last_extraction_debug = {
        status: 'ok', message_index: assistantIndex, source_key: pair.key,
        elapsed_ms: Math.round(elapsed * 10) / 10,
        op_count: validOps.length,
        baseline_input_count: validatedOps.length,
        baseline_rejected_count: baselineRejections.length,
        baseline_rejections: baselineRejections,
        baseline_fingerprint: preparedBaseline.fingerprint,
        changed_ids: changedIds,
        validation_errors: validationErrors,
        apply_errors: applyErrors,
        mode,
        replaced_existing: replacingExistingRecord,
        at: Date.now(),
    };
    store.baseline.last_gate_debug = {
        source_key: pair.key,
        input_count: validatedOps.length,
        accepted_count: validOps.filter(op => op.op !== 'noop').length,
        rejected_count: baselineRejections.length,
        rejections: baselineRejections,
        fingerprint: preparedBaseline.fingerprint,
        at: Date.now(),
    };
    store.last_errors = [
        ...(store.last_errors || []),
        ...validationErrors.map(e => `extract message ${assistantIndex}: ${e}`),
        ...applyErrors.map(e => `extract message ${assistantIndex}: ${e}`),
    ].slice(-100);
    setStore(current, store);
    if (replacingExistingRecord && settings.vector_recall) await rebuildVectorIndex(current, { silent: true });
    else await syncChangedVectors(current, [...new Set(changedIds)]);
    if (settings.extraction_notifications) notify('success', `已提交记忆操作 ${validOps.length} 个；Baseline拦截 ${baselineRejections.length} 个。`, '自动记忆');
    log('autonomous extraction complete', store.last_extraction_debug);
    return { record, changedIds, baselineRejections, errors: [...validationErrors, ...applyErrors] };
}

function scheduleLatestAssistantExtraction({ force = false } = {}) {
    const ctx = getContext();
    if (!ctx) return;
    const settings = getSettings(ctx);
    if (!settings.auto_extract) return;
    const index = findLatestAssistantIndex(ctx.chat || []);
    if (index < 0) return;
    void enqueueExtraction(() => extractMemoryForAssistant(getContext(), index, { force }));
}

function getVectorProvider(ctx) {
    const settings = getSettings(ctx);
    const vectors = ctx.extensionSettings?.vectors || {};
    const source = settings.vector_source_mode === 'transformers' ? 'transformers' : String(vectors.source || 'transformers');
    const body = {};
    const oai = ctx.chatCompletionSettings || {};
    const text = ctx.textCompletionSettings || {};
    const altUrl = vectors.use_alt_endpoint ? String(vectors.alt_endpoint_url || '').trim() : '';

    switch (source) {
        case 'electronhub': body.model = vectors.electronhub_model; break;
        case 'openrouter': body.model = vectors.openrouter_model; break;
        case 'togetherai': body.model = vectors.togetherai_model; break;
        case 'openai': body.model = vectors.openai_model; break;
        case 'cohere': body.model = vectors.cohere_model; break;
        case 'ollama':
            body.model = vectors.ollama_model;
            body.apiUrl = altUrl || text.server_urls?.ollama || '';
            body.keep = Boolean(vectors.ollama_keep);
            break;
        case 'llamacpp':
            body.apiUrl = altUrl || text.server_urls?.llamacpp || '';
            break;
        case 'vllm':
            body.apiUrl = altUrl || text.server_urls?.vllm || '';
            body.model = vectors.vllm_model;
            break;
        case 'palm':
            body.model = vectors.google_model;
            body.api = 'makersuite';
            break;
        case 'vertexai':
            body.model = vectors.google_model;
            body.api = 'vertexai';
            body.vertexai_auth_mode = oai.vertexai_auth_mode;
            body.vertexai_region = oai.vertexai_region;
            body.vertexai_express_project_id = oai.vertexai_express_project_id;
            break;
        case 'chutes': body.model = vectors.chutes_model; break;
        case 'nanogpt': body.model = vectors.nanogpt_model; break;
        case 'siliconflow':
            body.model = vectors.siliconflow_model;
            body.siliconflow_endpoint = oai.siliconflow_endpoint;
            break;
        case 'workers_ai':
            body.model = vectors.workers_ai_model || '@cf/baai/bge-m3';
            body.workers_ai_account_id = oai.workers_ai_account_id;
            break;
        case 'mistral':
        case 'nomicai':
        case 'transformers':
            break;
        default:
            break;
    }

    let supported = SUPPORTED_SERVER_VECTOR_SOURCES.has(source);
    let reason = '';
    if (UNSUPPORTED_CLIENT_VECTOR_SOURCES.has(source)) {
        supported = false;
        reason = `${source} 在 v5.4 仍需要客户端先生成 embedding，当前插件暂不接管该客户端向量源。请改用 Local (Transformers) 或其他服务端 provider。`;
    } else if (!supported) {
        reason = `未知或暂不支持的 Vector Storage source: ${source}`;
    } else if (['ollama', 'llamacpp', 'vllm'].includes(source) && !body.apiUrl) {
        supported = false;
        reason = `${source} 没有可用 API URL。`;
    } else if (['ollama', 'vllm'].includes(source) && !body.model) {
        supported = false;
        reason = `${source} 没有配置 embedding model。`;
    }

    // Never put API keys/secrets into the fingerprint or canonical chat metadata.
    const fingerprintBody = {
        source,
        model: body.model || '',
        apiUrl: body.apiUrl || '',
        keep: body.keep || false,
        api: body.api || '',
        vertexai_auth_mode: body.vertexai_auth_mode || '',
        vertexai_region: body.vertexai_region || '',
        vertexai_express_project_id: body.vertexai_express_project_id || '',
        siliconflow_endpoint: body.siliconflow_endpoint || '',
        workers_ai_account_id: body.workers_ai_account_id || '',
    };
    const fingerprint = `${source}:${fnv1a32(stableStringify(fingerprintBody)).toString(36)}`;
    return { source, body, fingerprint, supported, reason };
}

async function vectorRequest(ctx, endpoint, payload) {
    const response = await fetch(`/api/vector/${endpoint}`, {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Vector API ${endpoint} failed: HTTP ${response.status}${text ? ` ${text}` : ''}`);
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? await response.json() : await response.text();
}

async function vectorInsert(ctx, provider, collectionId, items) {
    if (!items.length) return;
    await vectorRequest(ctx, 'insert', {
        ...provider.body,
        collectionId,
        items,
        source: provider.source,
    });
}

async function vectorDelete(ctx, provider, collectionId, hashes) {
    const unique = [...new Set(hashes.map(Number).filter(Number.isFinite))];
    if (!unique.length) return;
    await vectorRequest(ctx, 'delete', {
        ...provider.body,
        collectionId,
        hashes: unique,
        source: provider.source,
    });
}

async function vectorQuery(ctx, provider, collectionId, searchText, topK, threshold) {
    return await vectorRequest(ctx, 'query', {
        ...provider.body,
        collectionId,
        searchText,
        topK,
        threshold,
        source: provider.source,
    });
}

async function purgeVectorCollection(ctx, collectionId) {
    await vectorRequest(ctx, 'purge', { collectionId });
}

async function rebuildVectorIndex(ctx, { silent = false } = {}) {
    const settings = getSettings(ctx);
    const store = getStore(ctx);
    const provider = getVectorProvider(ctx);
    const collectionId = getCollectionId(ctx);
    store.vector.collection_id = collectionId;

    if (!collectionId) {
        store.vector.stale = true;
        store.vector.last_error = '当前没有选中的聊天，无法建立向量集合。';
        setStore(ctx, store);
        if (!silent) notify('warning', store.vector.last_error);
        return false;
    }

    if (!provider.supported) {
        store.vector.stale = true;
        store.vector.last_error = provider.reason;
        setStore(ctx, store);
        if (!silent) notify('warning', provider.reason || '当前 embedding provider 不受支持');
        return false;
    }

    try {
        // Purge means every client-side vector_hash must be rebuilt as well;
        // otherwise an unsettled memory could keep a stale hash and never be inserted later.
        for (const memory of Object.values(store.memories)) memory.vector_hash = null;
        const memories = getIndexableMemories(store).filter(memory =>
            isMemorySettled(memory, ctx.chat?.length || 0, settings.vector_settle_messages));
        const items = memories.map((memory, index) => {
            const hash = computeVectorHash(memory);
            memory.vector_hash = hash;
            return { hash, text: buildRetrievalText(memory), index };
        });
        await withVectorLock(async () => {
            await purgeVectorCollection(ctx, collectionId);
            const batchSize = 40;
            for (let i = 0; i < items.length; i += batchSize) {
                await vectorInsert(ctx, provider, collectionId, items.slice(i, i + batchSize));
            }
        });
        store.vector.fingerprint = provider.fingerprint;
        store.vector.stale = false;
        store.vector.last_error = null;
        store.vector.last_sync_at = Date.now();
        setStore(ctx, store);
        if (!silent) notify('success', `向量索引已重建：${items.length} 条可检索记忆`);
        log('vector rebuild complete', { count: items.length, provider: provider.source });
        return true;
    } catch (error) {
        store.vector.stale = true;
        store.vector.last_error = String(error?.message || error);
        setStore(ctx, store);
        if (!silent) notify('error', store.vector.last_error, '向量索引重建失败');
        return false;
    }
}

async function syncChangedVectors(ctx, changedIds = []) {
    const settings = getSettings(ctx);
    if (!settings.vector_recall) return;
    const store = getStore(ctx);
    const idsToSync = new Set(changedIds);
    for (const memory of Object.values(store.memories)) {
        if (shouldIndexMemory(memory)
            && memory.vector_hash == null
            && isMemorySettled(memory, ctx.chat?.length || 0, settings.vector_settle_messages)) {
            idsToSync.add(memory.id);
        }
    }
    if (!idsToSync.size) return;
    const provider = getVectorProvider(ctx);
    const collectionId = getCollectionId(ctx);
    store.vector.collection_id = collectionId;

    if (!collectionId) {
        store.vector.stale = true;
        store.vector.last_error = '当前没有选中的聊天，无法同步向量。';
        setStore(ctx, store);
        return;
    }

    if (!provider.supported) {
        store.vector.stale = true;
        store.vector.last_error = provider.reason;
        setStore(ctx, store);
        return;
    }

    const hasExistingIndexable = Object.values(store.memories).some(m => m.vector_hash != null);
    if (store.vector.fingerprint && store.vector.fingerprint !== provider.fingerprint) {
        store.vector.stale = true;
        store.vector.last_error = 'Embedding source/model 已变化，需要重建向量索引。';
        setStore(ctx, store);
        return;
    }
    if (!store.vector.fingerprint && hasExistingIndexable) {
        store.vector.stale = true;
        store.vector.last_error = '检测到已有记忆但没有 provider 指纹，请执行一次“重建向量索引”。';
        setStore(ctx, store);
        return;
    }
    if (!store.vector.fingerprint) store.vector.fingerprint = provider.fingerprint;

    try {
        const deleteHashes = [];
        const insertItems = [];
        let insertIndex = 0;
        for (const id of idsToSync) {
            const memory = store.memories[id];
            if (!memory) continue;
            const oldHash = memory.vector_hash == null ? null : Number(memory.vector_hash);
            if (!shouldIndexMemory(memory) || !isMemorySettled(memory, ctx.chat?.length || 0, settings.vector_settle_messages)) {
                if (Number.isFinite(oldHash)) deleteHashes.push(oldHash);
                memory.vector_hash = null;
                continue;
            }
            const newHash = computeVectorHash(memory);
            if (Number.isFinite(oldHash) && oldHash !== newHash) deleteHashes.push(oldHash);
            if (!Number.isFinite(oldHash) || oldHash !== newHash) {
                insertItems.push({ hash: newHash, text: buildRetrievalText(memory), index: insertIndex++ });
            }
            memory.vector_hash = newHash;
        }
        await withVectorLock(async () => {
            await vectorDelete(ctx, provider, collectionId, deleteHashes);
            await vectorInsert(ctx, provider, collectionId, insertItems);
        });
        store.vector.stale = false;
        store.vector.last_error = null;
        store.vector.last_sync_at = Date.now();
        setStore(ctx, store);
    } catch (error) {
        store.vector.stale = true;
        store.vector.last_error = String(error?.message || error);
        setStore(ctx, store);
        log('incremental vector sync failed', error);
    }
}

function updateActiveSnapshot(store, chat) {
    const active = findLatestActiveState(chat);
    store.last_active_state = active.text;
    store.last_active_state_source = active.source;
}

async function rebuildCanonicalFromChat(ctx, { rebuildVectors = false, silent = true } = {}) {
    const settings = getSettings(ctx);
    const previous = getStore(ctx);
    const replayed = replayStoreFromExtractions(ctx.chat || [], previous.extractions || {}, {
        includeLegacyMessageOps: Boolean(settings.parse_ops),
    });
    replayed.store.vector = {
        ...createEmptyStore().vector,
        collection_id: getCollectionId(ctx),
        // Full replay can change deterministic memory ids after history edits; force a safe re-index.
        fingerprint: previous.vector?.fingerprint || null,
        stale: true,
        last_error: '聊天历史/分支发生变化，Canonical Memory 已从抽取记录重放；向量索引需要同步。',
        last_sync_at: previous.vector?.last_sync_at || null,
    };
    replayed.store.last_extraction_debug = previous.last_extraction_debug || null;
    // Baseline is derived from host Persona/character/World Info, not from extraction replay.
    replayed.store.baseline = previous.baseline || createEmptyStore().baseline;
    setStore(ctx, replayed.store);
    if (replayed.errors.length && !silent) {
        notify('warning', `重放完成，但有 ${replayed.errors.length} 条记忆诊断。`);
    }
    if (rebuildVectors) await rebuildVectorIndex(ctx, { silent });
    log('canonical store rebuilt from autonomous extractions', {
        memories: Object.keys(replayed.store.memories).length,
        extractions: Object.keys(replayed.store.extractions || {}).length,
        legacy: replayed.usedLegacy?.length || 0,
        errors: replayed.errors.length,
    });
    return replayed;
}

async function reconcileCurrentChat(ctx, { forceRebuild = false } = {}) {
    if (!ctx) return;
    const settings = getSettings(ctx);
    let store = pruneStaleExtractionRecords(getStore(ctx), ctx.chat || []);
    const currentSources = collectAutonomousExtractionSources(ctx.chat || [], store.extractions || {})
        .map(x => ({ index: x.assistantIndex, hash: x.hash }));
    const previousSources = Array.isArray(store.source_fingerprints) ? store.source_fingerprints : [];
    const needsReplay = forceRebuild || !sourcesArePrefix(previousSources, currentSources) || previousSources.length !== currentSources.length;
    if (needsReplay) {
        await rebuildCanonicalFromChat(ctx, {
            rebuildVectors: settings.vector_recall && settings.auto_rebuild_vectors_on_history_change,
            silent: true,
        });
        return;
    }
    store.source_fingerprints = currentSources;
    setStore(ctx, store);
}

function getProviderStatus(ctx, store) {
    const provider = getVectorProvider(ctx);
    const fingerprintChanged = Boolean(store.vector.fingerprint && store.vector.fingerprint !== provider.fingerprint);
    return { provider, fingerprintChanged };
}

async function recallMemories(ctx, interceptorChat) {
    const settings = getSettings(ctx);
    if (!settings.vector_recall) return [];
    const variants = buildQueryVariants(interceptorChat, settings.query_messages);
    if (!variants.length) return [];
    const store = getStore(ctx);
    const { provider, fingerprintChanged } = getProviderStatus(ctx, store);
    const collectionId = getCollectionId(ctx);
    const denseAvailable = Boolean(
        provider.supported
        && !fingerprintChanged
        && !store.vector.stale
        && store.vector.fingerprint
        && collectionId
    );
    if (fingerprintChanged) {
        store.vector.stale = true;
        store.vector.last_error = 'Embedding source/model 已变化；Dense通道暂停，Lexical通道仍可工作。请重建向量索引。';
        setStore(ctx, store);
    }
    const started = performance.now?.() ?? Date.now();
    try {
        // LittleWhiteBox-inspired: multiple dense query views + a local lexical route.
        // If Dense is unavailable, local lexical retrieval stays usable instead of failing closed.
        const denseLists = [];
        const denseDebug = [];
        if (denseAvailable) {
            await withVectorLock(async () => {
                for (const variant of variants) {
                    const result = await vectorQuery(
                        ctx,
                        provider,
                        collectionId,
                        variant.text,
                        Math.max(1, Number(settings.candidate_top_k) || 18),
                        Math.min(1, Math.max(0, Number(settings.score_threshold) || 0)),
                    );
                    const dense = filterRecalledMemories(store, result?.metadata || [], {
                        finalCount: Math.max(1, Number(settings.candidate_top_k) || 18),
                        protectRecent: settings.protect_recent_messages,
                        chatLength: ctx.chat?.length || 0,
                    });
                    denseLists.push(dense);
                    denseDebug.push({ name: variant.name, count: dense.length, ids: dense.map(m => m.id) });
                }
            });
        }

        const lexicalQuery = variants.find(v => v.name === 'context')?.text || variants[0].text;
        const lexical = settings.hybrid_recall
            ? lexicalSearchMemories(store, lexicalQuery, {
                limit: settings.lexical_candidate_top_k,
                protectRecent: settings.protect_recent_messages,
                chatLength: ctx.chat?.length || 0,
            })
            : [];

        // If no Dense backend is available, lexical becomes an intentional fallback and is not gated.
        // If Dense is available, lexical-only candidates need semantic agreement, except exact entity matches.
        let fused = fuseHybridCandidates(store, denseLists, lexical, {
            rrfK: settings.rrf_k,
            denseWeights: variants.map(v => v.weight),
            lexicalWeight: settings.lexical_weight,
            denseGate: denseAvailable,
            currentMessage: ctx.chat?.length || 0,
            cooldownTurns: settings.recall_cooldown_turns,
        });
        const fusedBeforeGraph = fused.map(r => ({ id: r.memory.id, score: r.score, channels: r.channels, entityBypass: r.entityBypass }));
        if (settings.graph_diffusion) {
            fused = graphDiffuseCandidates(store, fused, { damping: settings.graph_damping, iterations: 5 });
        }
        const selected = diversifyCandidates(fused, {
            finalCount: settings.final_recall_count,
            lambda: settings.mmr_lambda,
        });
        const currentMessage = ctx.chat?.length || 0;
        for (const row of selected) {
            const memory = row.memory;
            memory.recalled_count = Number(memory.recalled_count || 0) + 1;
            memory.last_recalled_message = currentMessage;
        }
        const elapsed = (performance.now?.() ?? Date.now()) - started;
        store.last_recall_debug = {
            at_message: currentMessage,
            elapsed_ms: Math.round(elapsed * 10) / 10,
            dense_available: denseAvailable,
            dense_reason: denseAvailable ? null : (fingerprintChanged ? 'provider fingerprint changed' : (!provider.supported ? provider.reason : (store.vector.stale ? 'vector index stale' : 'no usable collection/index'))),
            query_variants: variants.map(v => ({ name: v.name, weight: v.weight, chars: v.text.length })),
            dense: denseDebug,
            lexical: lexical.slice(0, 20).map(x => ({ id: x.memory.id, score: Math.round(x.score * 1000) / 1000, entityMatches: x.entityMatches })),
            fused: fusedBeforeGraph.slice(0, 24),
            graph_top: fused.slice(0, 20).map(x => ({ id: x.memory.id, score: x.score, graphScore: x.graphScore ?? null })),
            selected: selected.map(x => ({ id: x.memory.id, score: x.score, mmrScore: x.mmrScore ?? null })),
        };
        if (selected.length || settings.debug || !denseAvailable) setStore(ctx, store);
        return selected;
    } catch (error) {
        store.vector.last_error = String(error?.message || error);
        store.last_recall_debug = { error: store.vector.last_error, at_message: ctx.chat?.length || 0 };
        setStore(ctx, store);
        log('hybrid recall failed', error);
        return [];
    }
}

async function buildInjectedMemoryContext(interceptorChat) {
    const ctx = getContext();
    if (!ctx) return '';
    const settings = getSettings(ctx);
    if (!settings.enabled) return '';

    await waitForExtractionFreshness(ctx);
    await operationQueue;
    const store = getStore(ctx);
    const queryText = buildQueryText(interceptorChat, settings.query_messages);
    const activeMemories = settings.inject_current_state
        ? getActiveMemories(store, queryText, settings.max_active_items)
        : [];
    const activeState = settings.inject_current_state ? store.last_active_state : '';
    const recalledMemories = await recallMemories(ctx, interceptorChat);
    return formatMemoryContext({
        activeState,
        activeMemories,
        recalledMemories,
        maxChars: settings.max_memory_context_chars,
        includeEvidence: settings.include_evidence,
    });
}


function trimPromptHistory(_chat, _keepRecentMessages) {
    // Deliberately disabled in v5.4. SillyTavern documents interceptor chat rows as mutable
    // application data; splicing them can mutate real history. Context compaction must use a
    // non-destructive host API before this feature can be enabled safely.
    return 0;
}

async function backfillMissingExtractions(ctx, { maxMessages = 200 } = {}) {
    if (!ctx) return { processed: 0, skipped: 0 };
    const settings = getSettings(ctx);
    const rows = ctx.chat || [];
    let processed = 0;
    let skipped = 0;
    const cap = Math.max(1, Math.min(2000, Number(maxMessages) || 200));
    for (let i = 0; i < rows.length && processed < cap; i++) {
        const pair = computeDialoguePairFingerprint(rows, i);
        if (!pair) continue;
        const store = getStore(ctx);
        const record = store.extractions?.[pair.key];
        if (record && Number(record.source_hash) === Number(pair.hash)) {
            skipped += 1;
            continue;
        }
        // Legacy v5.x messages already contain usable machine ops; avoid spending a second LLM call.
        if (settings.parse_ops && /<memory_ops\b[^>]*>/i.test(String(rows[i]?.mes ?? ''))) {
            skipped += 1;
            continue;
        }
        await extractMemoryForAssistant(ctx, i, { force: false });
        processed += 1;
    }
    await rebuildCanonicalFromChat(ctx, { rebuildVectors: Boolean(settings.vector_recall), silent: true });
    return { processed, skipped };
}

async function generationInterceptor(chat, _contextSize, _abort, type) {
    const ctx = getContext();
    if (!ctx) return;
    const settings = getSettings(ctx);
    if (!settings.enabled) {
        ctx.setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, settings.injection_depth, false, SYSTEM_ROLE);
        return;
    }
    if (type === 'quiet' || type === 'impersonate') {
        ctx.setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, settings.injection_depth, false, SYSTEM_ROLE);
        return;
    }
    const prompt = await buildInjectedMemoryContext(chat);
    ctx.setExtensionPrompt(PROMPT_KEY, prompt, IN_CHAT, Math.max(0, Number(settings.injection_depth) || 4), false, SYSTEM_ROLE);
    const removed = settings.manage_context_window ? trimPromptHistory(chat, settings.keep_recent_messages) : 0;
    log('interceptor injected memory', { type, chars: prompt.length, trimmedMessages: removed });
}

globalThis[INTERCEPTOR_NAME] = generationInterceptor;

function scheduleStatusUpdate() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(updateStatusUi, 100);
}

function updateStatusUi() {
    const ctx = getContext();
    const el = document.getElementById('aum-v54-status');
    if (!ctx || !el) return;
    const store = getStore(ctx);
    const provider = getVectorProvider(ctx);
    const memories = Object.values(store.memories);
    const activeSlots = Object.keys(store.slots).length;
    const indexable = memories.filter(shouldIndexMemory).length;
    const vectorState = !provider.supported
        ? `不可用：${provider.reason}`
        : store.vector.stale
            ? `待重建${store.vector.last_error ? `（${store.vector.last_error}）` : ''}`
            : '已同步';
    const extractionCount = Object.keys(store.extractions || {}).length;
    const baselineState = !getSettings(ctx).semantic_baseline_gate
        ? '关闭'
        : store.baseline?.vector?.stale
            ? `词法可用/向量待重建${store.baseline?.vector?.last_error ? `（${store.baseline.vector.last_error}）` : ''}`
            : `已就绪 ${Number(store.baseline?.record_count || 0)}块`;
    el.textContent = `Provider: ${provider.source} ｜ 记忆 ${memories.length} ｜ 抽取 ${extractionCount} ｜ Active slots ${activeSlots} ｜ 可向量化 ${indexable} ｜ Memory Vector ${vectorState} ｜ Baseline ${baselineState} ｜ 后台任务 ${extractionPending}`;
    const diagnostics = document.getElementById('aum-v54-diagnostics');
    if (diagnostics) {
        const errors = (store.last_errors || []).slice(-6).join('\n');
        const extraction = store.last_extraction_debug ? `\n\n[Extraction] ${JSON.stringify(store.last_extraction_debug, null, 2)}` : '';
        const baseline = store.baseline ? `\n\n[Baseline] ${JSON.stringify({ fingerprint: store.baseline.fingerprint, record_count: store.baseline.record_count, source_count: store.baseline.source_count, source_labels: store.baseline.source_labels, vector: store.baseline.vector, last_gate_debug: store.baseline.last_gate_debug }, null, 2)}` : '';
        const recall = store.last_recall_debug ? `\n\n[Recall] ${JSON.stringify(store.last_recall_debug, null, 2)}` : '';
        diagnostics.textContent = (errors || '无记忆诊断。') + extraction + baseline + recall;
    }
    const lastEvent = document.getElementById('aum-v54-last-event');
    if (lastEvent) lastEvent.textContent = store.last_event_summary || '暂无自动事件摘要。';
    const lastState = document.getElementById('aum-v54-last-state');
    if (lastState) lastState.textContent = store.last_active_state || '暂无当前状态。';
}

function bindCheckbox(id, key) {
    const ctx = getContext();
    const settings = getSettings(ctx);
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = Boolean(settings[key]);
    el.addEventListener('change', () => {
        settings[key] = Boolean(el.checked);
        ctx.saveSettingsDebounced?.();
        scheduleStatusUpdate();
    });
}

function bindNumber(id, key, { min = 0, max = Infinity, integer = false } = {}) {
    const ctx = getContext();
    const settings = getSettings(ctx);
    const el = document.getElementById(id);
    if (!el) return;
    el.value = settings[key];
    el.addEventListener('change', () => {
        let value = Number(el.value);
        if (!Number.isFinite(value)) value = DEFAULT_SETTINGS[key];
        value = Math.max(min, Math.min(max, value));
        if (integer) value = Math.round(value);
        settings[key] = value;
        el.value = value;
        ctx.saveSettingsDebounced?.();
    });
}

function bindSelect(id, key) {
    const ctx = getContext();
    const settings = getSettings(ctx);
    const el = document.getElementById(id);
    if (!el) return;
    el.value = settings[key];
    el.addEventListener('change', () => {
        settings[key] = String(el.value);
        ctx.saveSettingsDebounced?.();
        const store = getStore(ctx);
        store.vector.stale = true;
        store.vector.last_error = 'Embedding source模式已变化，需要重建向量索引。';
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = 'Embedding source模式已变化，需要重建 Baseline 向量索引。';
        setStore(ctx, store);
    });
}

function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function setupUi() {
    if (document.getElementById('aum-v54-settings')) return;
    const ctx = getContext();
    if (!ctx) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) {
        setTimeout(setupUi, 500);
        return;
    }
    let html = '';
    try {
        html = await ctx.renderExtensionTemplateAsync(EXTENSION_PATH, 'settings');
    } catch (error) {
        console.warn('[Aetheria Memory v5.4] settings template load failed', error);
        return;
    }
    host.insertAdjacentHTML('beforeend', html);

    bindCheckbox('aum-v54-enabled', 'enabled');
    bindCheckbox('aum-v54-auto-extract', 'auto_extract');
    bindCheckbox('aum-v54-structured', 'extraction_structured_output');
    bindCheckbox('aum-v54-extraction-notify', 'extraction_notifications');
    bindCheckbox('aum-v54-parse', 'parse_ops');
    bindCheckbox('aum-v54-baseline-gate', 'semantic_baseline_gate');
    bindCheckbox('aum-v54-baseline-vector', 'baseline_use_vector');
    bindCheckbox('aum-v54-baseline-auto', 'baseline_auto_rebuild');
    bindCheckbox('aum-v54-baseline-active-wi', 'baseline_include_active_world_info');
    bindCheckbox('aum-v54-inject-state', 'inject_current_state');
    bindCheckbox('aum-v54-vector', 'vector_recall');
    bindCheckbox('aum-v54-hybrid', 'hybrid_recall');
    bindCheckbox('aum-v54-graph', 'graph_diffusion');
    bindCheckbox('aum-v54-evidence', 'include_evidence');
    bindCheckbox('aum-v54-auto-rebuild', 'auto_rebuild_vectors_on_history_change');
    bindCheckbox('aum-v54-manage-window', 'manage_context_window');
    bindCheckbox('aum-v54-debug', 'debug');
    bindSelect('aum-v54-source-mode', 'vector_source_mode');
    bindNumber('aum-v54-extract-context', 'extraction_context_messages', { min: 0, max: 12, integer: true });
    bindNumber('aum-v54-freshness-wait', 'memory_freshness_wait_ms', { min: 0, max: 5000, integer: true });
    bindNumber('aum-v54-baseline-lexical', 'baseline_lexical_threshold', { min: 0.4, max: 1 });
    bindNumber('aum-v54-baseline-semantic', 'baseline_similarity_threshold', { min: 0.5, max: 1 });
    bindNumber('aum-v54-baseline-semantic-floor', 'baseline_semantic_lexical_floor', { min: 0, max: 1 });
    bindNumber('aum-v54-baseline-chunk', 'baseline_chunk_chars', { min: 120, max: 1200, integer: true });
    bindNumber('aum-v54-baseline-hint', 'baseline_hint_chars', { min: 1000, max: 30000, integer: true });
    bindNumber('aum-v54-keep-recent', 'keep_recent_messages', { min: 2, max: 200, integer: true });
    bindNumber('aum-v54-query-messages', 'query_messages', { min: 1, max: 12, integer: true });
    bindNumber('aum-v54-candidate-k', 'candidate_top_k', { min: 1, max: 80, integer: true });
    bindNumber('aum-v54-lexical-k', 'lexical_candidate_top_k', { min: 1, max: 120, integer: true });
    bindNumber('aum-v54-final-count', 'final_recall_count', { min: 0, max: 20, integer: true });
    bindNumber('aum-v54-threshold', 'score_threshold', { min: 0, max: 1 });
    bindNumber('aum-v54-lexical-weight', 'lexical_weight', { min: 0, max: 3 });
    bindNumber('aum-v54-rrf-k', 'rrf_k', { min: 1, max: 500, integer: true });
    bindNumber('aum-v54-graph-damping', 'graph_damping', { min: 0, max: 0.35 });
    bindNumber('aum-v54-mmr-lambda', 'mmr_lambda', { min: 0, max: 1 });
    bindNumber('aum-v54-cooldown', 'recall_cooldown_turns', { min: 0, max: 100, integer: true });
    bindNumber('aum-v54-settle', 'vector_settle_messages', { min: 0, max: 20, integer: true });
    bindNumber('aum-v54-budget', 'max_memory_context_chars', { min: 1200, max: 30000, integer: true });
    bindNumber('aum-v54-depth', 'injection_depth', { min: 0, max: 100, integer: true });
    bindNumber('aum-v54-max-active', 'max_active_items', { min: 0, max: 50, integer: true });
    bindNumber('aum-v54-protect-recent', 'protect_recent_messages', { min: 0, max: 100, integer: true });

    document.getElementById('aum-v54-rebuild-baseline')?.addEventListener('click', () => {
        void enqueueExtraction(async () => {
            const current = getContext();
            if (!current) return;
            const result = await ensureSemanticBaseline(current, { force: true, silent: false });
            notify('success', `Baseline已刷新：${result.records.length} 个分块 / ${result.sources.length} 个来源。`, 'Baseline Index');
        });
    });

    document.getElementById('aum-v54-extract-latest')?.addEventListener('click', () => {
        scheduleLatestAssistantExtraction({ force: true });
    });
    document.getElementById('aum-v54-backfill')?.addEventListener('click', () => {
        void enqueueExtraction(async () => {
            const result = await backfillMissingExtractions(getContext(), { maxMessages: 500 });
            notify('success', `历史补建完成：新抽取 ${result.processed} 条，跳过 ${result.skipped} 条。`, '自动记忆');
        });
    });

    document.getElementById('aum-v54-rebuild-memory')?.addEventListener('click', () => {
        void enqueue(async () => {
            await rebuildCanonicalFromChat(ctx, { rebuildVectors: false, silent: false });
            notify('success', `Canonical Memory 已从当前聊天重放：${Object.keys(getStore(ctx).memories).length} 条。`);
        });
    });
    document.getElementById('aum-v54-rebuild-vectors')?.addEventListener('click', () => {
        void enqueue(async () => { await rebuildVectorIndex(ctx, { silent: false }); await ensureSemanticBaseline(ctx, { force: true, silent: true }); });
    });
    document.getElementById('aum-v54-rebuild-all')?.addEventListener('click', () => {
        void enqueue(async () => {
            await rebuildCanonicalFromChat(ctx, { rebuildVectors: true, silent: false });
            await ensureSemanticBaseline(ctx, { force: true, silent: true });
            notify('success', 'Canonical Memory、剧情向量与 Semantic Baseline 已完整重建。');
        });
    });
    document.getElementById('aum-v54-export')?.addEventListener('click', () => {
        downloadJson(`aetheria-memory-${Date.now()}.json`, getStore(ctx));
    });
    document.getElementById('aum-v54-clear')?.addEventListener('click', () => {
        if (!confirm('确定清空当前聊天的艾瑟瑞亚 v5.4 统一记忆、剧情向量与Baseline派生向量吗？聊天正文、Persona和世界书不会删除。')) return;
        void enqueue(async () => {
            const collectionId = getCollectionId(ctx);
            const baselineCollectionId = getBaselineCollectionId(ctx);
            if (collectionId) {
                try { await withVectorLock(() => purgeVectorCollection(ctx, collectionId)); } catch (error) { log('purge memory on clear failed', error); }
            }
            if (baselineCollectionId) {
                try { await withVectorLock(() => purgeVectorCollection(ctx, baselineCollectionId)); } catch (error) { log('purge baseline on clear failed', error); }
            }
            const empty = createEmptyStore();
            empty.vector.collection_id = collectionId;
            empty.baseline.vector.collection_id = baselineCollectionId;
            setStore(ctx, empty);
            notify('success', '当前聊天的统一记忆已清空。');
        });
    });
    scheduleStatusUpdate();
}

function registerEvents() {
    const ctx = getContext();
    if (!ctx) return;
    const { eventSource, eventTypes } = ctx;

    // Streaming and non-streaming paths can emit different finalization events. The pair fingerprint
    // makes duplicate scheduling harmless.
    const onIf = (event, handler) => { if (event) eventSource.on(event, handler); };
    const afterAssistant = () => scheduleLatestAssistantExtraction({ force: false });
    onIf(eventTypes.MESSAGE_RECEIVED, afterAssistant);
    onIf(eventTypes.CHARACTER_MESSAGE_RENDERED, afterAssistant);

    const afterHistoryMutation = () => {
        void enqueue(async () => {
            const current = getContext();
            if (!current) return;
            await reconcileCurrentChat(current, { forceRebuild: true });
            scheduleLatestAssistantExtraction({ force: false });
        });
    };
    for (const event of [eventTypes.MESSAGE_SWIPED, eventTypes.MESSAGE_EDITED, eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_DELETED]) {
        onIf(event, afterHistoryMutation);
    }

    onIf(eventTypes.CHAT_CHANGED, () => {
        const current = getContext();
        if (!current) return;
        const settings = getSettings(current);
        current.setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, settings.injection_depth, false, SYSTEM_ROLE);
        void enqueue(async () => {
            await reconcileCurrentChat(current, { forceRebuild: true });
            scheduleLatestAssistantExtraction({ force: false });
        });
        scheduleStatusUpdate();
    });
}

async function startup() {
    if (initialized) return;
    initialized = true;
    const ctx = getContext();
    if (!ctx) return;
    getSettings(ctx);
    registerEvents();
    await setupUi();
    // v5.2/v5.1 canonical metadata migrates automatically; old inline <memory_ops> are replayed once.
    void enqueue(async () => {
        await reconcileCurrentChat(ctx, { forceRebuild: true });
        await ensureSemanticBaseline(ctx, { silent: true });
        scheduleLatestAssistantExtraction({ force: false });
    });
    scheduleStatusUpdate();
    console.log(`[Aetheria Memory v${MEMORY_VERSION}] autonomous plugin initialized`);
}

// Small explicit test hooks. They are not used by normal runtime, but make the autonomous
// extraction pipeline verifiable without depending on DOM event timing.
export async function __testExtractMemoryForAssistant(ctx, assistantIndex, options = {}) {
    return extractMemoryForAssistant(ctx, assistantIndex, options);
}

export async function __testBackfillMissingExtractions(ctx, options = {}) {
    return backfillMissingExtractions(ctx, options);
}

export function __testGetStore(ctx) {
    return getStore(ctx);
}

export async function __testEnsureSemanticBaseline(ctx, options = {}) {
    return ensureSemanticBaseline(ctx, options);
}

export async function __testFilterOperationsAgainstBaseline(ctx, ops, prepared) {
    return filterOperationsAgainstBaseline(ctx, ops, prepared);
}

/** Manifest lifecycle hook. Keep activation lightweight; async work is deferred. */
export function init() {
    const ctx = getContext();
    if (!ctx) return;
    const ready = () => setTimeout(() => void startup(), 0);
    // If activation happens before APP_READY this is the clean path; timeout fallback handles already-ready sessions.
    ctx.eventSource.on(ctx.eventTypes.APP_READY, ready);
    setTimeout(() => void startup(), 750);
}
