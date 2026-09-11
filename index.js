import {
    MEMORY_VERSION,
    applyMemoryOps,
    buildQueryText,
    buildQueryVariants,
    buildRetrievalText,
    computeVectorHash,
    createEmptyStore,
    diversifyCandidates,
    filterRecalledMemories,
    fuseHybridCandidates,
    graphDiffuseCandidates,
    findLatestActiveState,
    fnv1a32,
    getActiveMemories,
    getMandatoryMemories,
    getIndexableMemories,
    lexicalSearchMemories,
    isMemorySettled,
    isDialogueRow,
    normalizeStore,
    replayStoreFromExtractions,
    computeDialoguePairFingerprint,
    collectAutonomousExtractionSources,
    shouldIndexMemory,
    selectTemporalCandidates,
    sourcesArePrefix,
    stableStringify,
    stripSummaryForQuery,
    validateMemoryOp,
} from './memory-core.js';

import {
    EXTRACTION_JSON_SCHEMA,
    buildAutonomousExtractionPrompt,
    parseExtractionResult,
    planExtractionPromptBudget,
} from './memory-extractor.js';

// A8: the quality side of the measurement story. v55-metrics.js meters cost; this meters whether
// memory stayed good. Pure module, no host globals, so it is fully offline-testable.
import { injectionComposition, qualityReport as computeQualityReport } from './v55-quality-metrics.js';
import { runTcausal, formatTcausalReport, buildTcausalCases } from './v55-tcausal.js';
import { lengthCertificate, formatCertificate } from './v55-certificate.js';

import {
    buildBaselineRecords,
    computeBaselineFingerprint,
    evaluateBaselineDuplicate,
    baselineLexicalSimilarity,
    fnv1a32Baseline,
    isBaselineGateEligible,
} from './baseline-index.js';

import { collectSemanticBaselineSources } from './baseline-host.js';
import { spinePromptBlock, spineStats } from './v55-spine.js';
import { migrateSettingStore } from './setting-schema.js';
import { listRevisionsForWorld, listWorlds } from './setting-store.js';
import { commitImport, findDuplicateSources, previewImport } from './setting-importer.js';
import {
    buildSettingEntryManifest,
    buildSettingIndexSnapshot,
    buildSettingVectorItems,
    computeSettingEmbeddingProfileHash,
    diffSettingEntryManifests,
    getSettingCollectionId,
    lexicalSearchSettingChunks,
    summarizeSettingSnapshot,
} from './setting-index.js';
import {
    buildExtractionSettingQuery,
    buildGenerationSettingQuery,
    filterSettingRowsForActor,
    formatRelevantSettingContext,
    fuseSettingCandidates,
    mapDenseSettingMetadata,
    settingChunksToBaselineRecords,
} from './setting-retriever.js';
import { assembleGenerationContext } from './context-assembler.js';
import { buildCanonicalState, deriveActorIdentity, orderCanonicalMemories } from './v55-runtime.js';
import { pruneColdTurns, recordColdTurn } from './v55-evidence.js';
import { writeMergedChatStore } from './v55-store-integrity.js';
import { awaitDerivedReady, ensureDerivedHydrated, installV55DerivedStore, persistChatStore, resetDerivedHydration } from './v55-derived-store.js';
import { rerankCandidates } from './v55-rerank.js';
import { formatMetrics, recordEmbeddingCall, recordModelCall, resetMetrics } from './v55-metrics.js';
import { formatSelfCheck, runRetrievalSelfCheck } from './v55-selfcheck.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const LEGACY_SETTINGS_KEYS = ['aetheriaUnifiedMemoryV53', 'aetheriaUnifiedMemoryV52', 'aetheriaUnifiedMemoryV51'];
const LEGACY_METADATA_KEYS = ['aetheriaUnifiedMemoryV53', 'aetheriaUnifiedMemoryV52', 'aetheriaUnifiedMemoryV51'];
const LEGACY_PROMPT_KEY = 'aetheria_unified_memory_v5_4';
const REFERENCE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_reference';
const CURRENT_STATE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_current_state';
const INTERCEPTOR_NAME = 'aetheriaUnifiedMemoryV54Interceptor';
function resolveExtensionPath() {
    // Derive the host extension folder from this module's own URL so a renamed install
    // folder cannot silently break the settings template. Falls back to the historical path.
    try {
        const scriptPath = new URL(import.meta.url).pathname;
        const marker = '/scripts/extensions/';
        const at = scriptPath.indexOf(marker);
        if (at >= 0) {
            const parts = scriptPath.slice(at + marker.length).split('/');
            if (parts.length >= 2 && parts[0] === 'third-party' && parts[1]) return parts[0] + '/' + parts[1];
        }
    } catch { /* non-browser hosts */ }
    return 'third-party/aetheria-unified-memory-v5_4';
}
const EXTENSION_PATH = resolveExtensionPath();
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    // v5.4 owns extraction. Legacy <memory_ops> parsing only exists for v5/v5.1/v5.2 migration.
    auto_extract: true,
    extraction_context_messages: 4,
    extraction_structured_output: true,
    extraction_retry_plain_json: true,
    // Quiet extraction is generated through the host's chat-completion stack, so without an explicit
    // budget it inherits the preset's chat max_tokens. A reasoning model then spends that whole budget
    // on hidden reasoning and the visible JSON arrives truncated ("finish_reason: length"), which the
    // parser correctly rejects. A live session showed 1024 still being exhausted by ~2500 characters of
    // reasoning, so the default is 2048 and a starved JSON completion triggers one doubled retry.
    extraction_response_tokens: 2048,
    // Measured: the gateway answers an oversized quiet request with 502, which costs the turn its
    // extraction entirely. The pair under review is mandatory; the context windows are planned to fit.
    extraction_prompt_max_chars: 20000,
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
    // v5.5-dev Commit D: plugin-owned setting index. Lexical projection is always local;
    // vector projection is shared by world+active revision scope, never by chat id.
    setting_index_use_vector: true,
    setting_index_auto_rebuild: true,
    setting_index_chunk_chars: 420,
    setting_index_lexical_top_k: 12,
    setting_index_lexical_min_score: 0.05,
    setting_index_verify_build: true,
    setting_index_state: null,
    // v5.5-dev Commit E: relevant Setting retrieval. Retrieval is separate from story-memory recall.
    setting_retrieval_enabled: true,
    setting_retrieval_use_dense: true,
    setting_retrieval_candidate_top_k: 18,
    setting_retrieval_final_count: 8,
    setting_retrieval_dense_threshold: 0.18,
    setting_retrieval_rrf_k: 60,
    setting_retrieval_max_chars: 10000,
    setting_extraction_max_chars: 7000,
    setting_retrieval_constant_limit: 2,
    // Iteration 14 (architecture drift): the setting (world-info) plane and the memory plane are two
    // different products, but a coupling had grown between them in both directions:
    //   memory -> setting : active memories seed the setting retrieval query
    //   setting -> memory : setting chunks become baseline records and can reject a memory write
    // Both are now explicit switches with the historical behaviour as the default, so a memory-only
    // run is measurable instead of impossible to construct.
    setting_baseline_veto_enabled: true,
    setting_query_seed_from_memories: true,
    // v5.5-dev Commit F: one context assembler, two extension-prompt blocks.
    // Measured (change_log Entry 15). The reference block is flat below 4,000 characters: on a 50-floor
    // chat, 8,000 / 4,000 / 2,000 all produced state 10/10, commitment 22/22, causal 3/3 and T-Causal 12/14,
    // while the injection fell from 12,576 to 9,513 to 7,541 tokens. 2,000 is not taken as the default
    // because on a denser chat the same trim cost 3 T-Causal points - the recall channel is worth something
    // exactly when a conversation has more going on. 4,000 is the point that is free on the sparse chat and
    // still funded on the dense one.
    reference_context_max_chars: 4000,
    // Measured on a 50-floor live chat by ablation, not by argument (change_log Entry 10): at a 5,000
    // character cap the block carried only 17 of 31 live values, and raising it moved state coverage
    // 55% -> 90% and T-Causal 43% -> 65% while total injected tokens FELL from 8,897 to 7,213, because
    // state the model is given no longer has to be recalled.
    // Since v4 this cap bounds ONE rendering of the state instead of a 45% share of a double one, so it
    // is set to keep the block no larger than the double rendering ever was: the old summary alone was
    // capped at 9,000 characters and the must-rows plus groups added roughly 3,000 more. 12,000 carries
    // at least what that did, and bounds the block so a lengthening chat cannot grow it without limit.
    current_state_context_max_chars: 12000,
    context_reply_reserve_tokens: 1200,
    current_state_injection_depth: 1,
    // Iteration 08: quiet generations are cleared by default (including background extraction).
    // Opting in only affects third-party quiet requests; the plugin's own extraction stays clear.
    quiet_allow_third_party_injection: false,
    inject_current_state: true,
    // Iteration 14 S4: irreversible changes are injected whatever recall decides. Ordering inside the
    // current-state block is the guarantee; this only bounds how many such rows are eligible.
    mandatory_baseline_enabled: true,
    mandatory_baseline_limit: 24,
    // Iteration 14 S1/S2: the change chain. Slots whose value was replaced, and what replaced it.
    spine_injection_enabled: true,
    // Measured (change_log Entry 14): at 600 characters the change chain rendered 7 of 19 replaced
    // values, and causal coverage sat at 6/17 (35%) - the largest remaining hole. The chain is the only
    // carrier of "why is it like this now", and it was the smallest budget in the system. At 4,000
    // characters causal coverage is 13/17 (76%) and T-Causal 37/40 (93%), and the total injection is
    // still cheaper than before, because the reference block was trimmed to pay for it.
    spine_injection_max_chars: 4000,
    spine_injection_max_rows: 24,
    // The budgets above were corrected by measurement, not by taste. An install that already saved the old
    // values would never see the new ones, because getSettings only fills keys that are missing - so the
    // correction carries a version and a one-time migration.
    memory_budget_version: 2,
    // Plan A2/A4/A6. All three are on by default and all three degrade to the previous behaviour when
    // switched off, which is the plan's own degradation rule for the A list ("a failed detector is never
    // worse than the floor beat").
    boundary_detection_enabled: true,
    compression_repetition_enabled: true,
    cold_eviction_by_reconstructability: true,
    // Iteration 14 (drift fix): the current-state block renders EVERY active memory, not only the
    // mandatory set, so it was already a baseline wider than S4 claimed. That was implicit, which
    // made the "irreversible-only" experiment impossible to run. Now it is a named setting and the
    // default is the behaviour real users already have.
    current_state_scope: 'mandatory+broad', // mandatory+broad | mandatory-only
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
    // Local candidate reranking: fusion ranks channels, this ranks the query against the candidate.
    rerank_enabled: true,
    rerank_weight: 0.55,
    rerank_half_life_turns: 120,
    mmr_lambda: 0.78,
    recall_cooldown_turns: 4,
    vector_settle_messages: 0,
    max_memory_context_chars: 7000,
    include_evidence: true,
    injection_depth: 4,
    max_active_items: 12,
    protect_recent_messages: 8,
    auto_rebuild_vectors_on_history_change: true,
    // Iteration 13: cost shape, cold原文 snapshot, temporal channel, metering.
    extraction_batch_turns: 1,
    cold_turn_snapshot_enabled: true,
    cold_turn_max_chars: 200000,
    memory_evidence_enabled: true,
    memory_evidence_max_chars: 3000,
    temporal_channel_enabled: true,
    temporal_channel_limit: 6,
    metrics_enabled: true,
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
let pendingSettingImportPreview = null;
let lastSettingRetrievalDebug = null;
let lastGenerationSettingRetrieval = null;
let lastGenerationContextDiagnostics = null;
// Iteration 14 (drift fix): observable proof of whether memories seeded the setting query.
let lastSettingSeedDebug = null;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function normalizeDepth(value, fallback = 4) {
    // null / undefined / blank input are "not set", not depth 0. A legal numeric 0 (and the
    // string '0') is preserved; negative / NaN / garbage falls back.
    const blank = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    if (blank) return Math.max(0, Math.floor(Number(fallback) || 0));
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
    return Math.floor(n);
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

/**
 * One-time correction of the injection budgets.
 *
 * A changed default reaches new installs for free and reaches existing ones never, because the merge in
 * getSettings only supplies keys that are absent. Measured corrections therefore have to be carried over
 * explicitly. The migration rewrites only the budget keys, and only once: after it runs the version is
 * stamped, so a value the user edits afterwards is kept.
 */
export const MEMORY_BUDGET_VERSION = 4;
export const MEMORY_BUDGET_MIGRATIONS = Object.freeze({
    2: Object.freeze({
        spine_injection_max_chars: 4000,
        spine_injection_max_rows: 24,
        reference_context_max_chars: 8000,
    }),
    3: Object.freeze({
        reference_context_max_chars: 4000,
    }),
    // v4 renders the current state once instead of twice. The old 20,000 cap was never reached because
    // the flat summary inside it was independently capped at 9,000; with that summary gone the cap is
    // the only bound, so it is set to the size the double rendering actually produced.
    4: Object.freeze({
        current_state_context_max_chars: 12000,
    }),
});

export function migrateMemoryBudgets(settings, { version = MEMORY_BUDGET_VERSION } = {}) {
    if (!settings || typeof settings !== 'object') return { migrated: false, applied: [] };
    const from = Number(settings.memory_budget_version) || 1;
    const target = Math.max(1, Number(version) || MEMORY_BUDGET_VERSION);
    if (from >= target) return { migrated: false, from, applied: [] };
    const applied = [];
    for (let step = from + 1; step <= target; step += 1) {
        const patch = MEMORY_BUDGET_MIGRATIONS[step];
        if (!patch) continue;
        for (const [key, value] of Object.entries(patch)) {
            settings[key] = value;
            applied.push(key);
        }
    }
    settings.memory_budget_version = target;
    return { migrated: true, from, to: target, applied };
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

function getSettingStore(ctx, { saveMigration = true } = {}) {
    const settings = getSettings(ctx);
    const migration = migrateSettingStore(settings.setting_store);
    settings.setting_store = migration.store;
    if (migration.migrated && saveMigration) ctx.saveSettingsDebounced?.();
    return settings.setting_store;
}

function setSettingStore(ctx, store, { save = true } = {}) {
    const settings = getSettings(ctx);
    const migration = migrateSettingStore(store);
    settings.setting_store = migration.store;
    if (save) ctx.saveSettingsDebounced?.();
    return settings.setting_store;
}

function normalizeSettingEntryManifest(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const entries = raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {};
    const normalizedEntries = {};
    for (const [entryId, rowInput] of Object.entries(entries)) {
        const row = rowInput && typeof rowInput === 'object' && !Array.isArray(rowInput) ? rowInput : {};
        const id = String(row.entry_id || entryId || '').trim();
        if (!id) continue;
        normalizedEntries[id] = {
            entry_id: id,
            revision_id: typeof row.revision_id === 'string' ? row.revision_id : null,
            source_id: typeof row.source_id === 'string' ? row.source_id : null,
            parent_content_hash: typeof row.parent_content_hash === 'string' ? row.parent_content_hash : '',
            chunk_count: Math.max(0, Number(row.chunk_count) || 0),
            vector_hashes: Array.isArray(row.vector_hashes) ? [...new Set(row.vector_hashes.map(Number).filter(Number.isFinite))] : [],
            signature: typeof row.signature === 'string' ? row.signature : '',
        };
    }
    return {
        manifest_version: 1,
        snapshot_fingerprint: typeof raw.snapshot_fingerprint === 'string' ? raw.snapshot_fingerprint : null,
        entry_count: Object.keys(normalizedEntries).length,
        chunk_count: Object.values(normalizedEntries).reduce((sum, row) => sum + row.chunk_count, 0),
        entries: normalizedEntries,
    };
}

function normalizeSettingProfileState(input, profileHash = null) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return {
        embedding_profile_hash: typeof raw.embedding_profile_hash === 'string' ? raw.embedding_profile_hash : (profileHash || null),
        provider_fingerprint: typeof raw.provider_fingerprint === 'string' ? raw.provider_fingerprint : null,
        collection_id: typeof raw.collection_id === 'string' ? raw.collection_id : null,
        fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : null,
        entry_manifest: normalizeSettingEntryManifest(raw.entry_manifest),
        ready: raw.ready === true,
        stale: raw.stale !== false,
        vector_disabled: raw.vector_disabled === true,
        cleanup_pending_hashes: Array.isArray(raw.cleanup_pending_hashes) ? [...new Set(raw.cleanup_pending_hashes.map(Number).filter(Number.isFinite))] : [],
        last_error: typeof raw.last_error === 'string' ? raw.last_error : null,
        last_sync_at: Number.isFinite(Number(raw.last_sync_at)) ? Number(raw.last_sync_at) : null,
        last_verified_at: Number.isFinite(Number(raw.last_verified_at)) ? Number(raw.last_verified_at) : null,
        last_built_at: Number.isFinite(Number(raw.last_built_at)) ? Number(raw.last_built_at) : null,
        last_diff: raw.last_diff && typeof raw.last_diff === 'object' && !Array.isArray(raw.last_diff) ? structuredClone(raw.last_diff) : null,
        verification: raw.verification && typeof raw.verification === 'object' && !Array.isArray(raw.verification) ? structuredClone(raw.verification) : null,
    };
}

function normalizeSettingScopeState(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const rawProfiles = raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles) ? raw.profiles : {};
    const profiles = {};
    for (const [profileHash, row] of Object.entries(rawProfiles)) {
        const cleanHash = String(profileHash || '').trim();
        if (!cleanHash) continue;
        profiles[cleanHash] = normalizeSettingProfileState(row, cleanHash);
    }
    const legacyV1 = !Object.keys(profiles).length && raw.collection_id
        ? {
            collection_id: typeof raw.collection_id === 'string' ? raw.collection_id : null,
            provider_fingerprint: typeof raw.provider_fingerprint === 'string' ? raw.provider_fingerprint : null,
            fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : null,
            migrated_at: Date.now(),
            reason: 'v1 Setting Index collections did not include embedding_profile_hash and are retained but not trusted as active v5.5-G indexes.',
        }
        : (raw.legacy_v1 && typeof raw.legacy_v1 === 'object' ? structuredClone(raw.legacy_v1) : null);
    return {
        index_version: typeof raw.index_version === 'string' ? raw.index_version : null,
        world_id: typeof raw.world_id === 'string' ? raw.world_id : null,
        world_name: typeof raw.world_name === 'string' ? raw.world_name : null,
        revision_ids: Array.isArray(raw.revision_ids) ? raw.revision_ids.map(String) : [],
        scope_key: typeof raw.scope_key === 'string' ? raw.scope_key : null,
        fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : null,
        entry_count: Math.max(0, Number(raw.entry_count) || 0),
        chunk_count: Math.max(0, Number(raw.chunk_count) || 0),
        constant_chunk_count: Math.max(0, Number(raw.constant_chunk_count) || 0),
        active_profile_hash: typeof raw.active_profile_hash === 'string' ? raw.active_profile_hash : null,
        active_collection_id: typeof raw.active_collection_id === 'string' ? raw.active_collection_id : null,
        profiles,
        retired_collection_ids: Array.isArray(raw.retired_collection_ids) ? [...new Set(raw.retired_collection_ids.map(String).filter(Boolean))] : [],
        vector_degraded: raw.vector_degraded === true,
        last_error: typeof raw.last_error === 'string' ? raw.last_error : null,
        last_attempt_profile_hash: typeof raw.last_attempt_profile_hash === 'string' ? raw.last_attempt_profile_hash : null,
        last_attempt_at: Number.isFinite(Number(raw.last_attempt_at)) ? Number(raw.last_attempt_at) : null,
        legacy_v1: legacyV1,
    };
}

function normalizeSettingIndexState(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const scopesInput = raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes) ? raw.scopes : {};
    const scopes = {};
    for (const [scopeKey, row] of Object.entries(scopesInput)) {
        scopes[scopeKey] = normalizeSettingScopeState(row);
    }
    return {
        state_version: 2,
        active_scope_key: typeof raw.active_scope_key === 'string' ? raw.active_scope_key : null,
        scopes,
    };
}

function getSettingIndexState(ctx) {
    const settings = getSettings(ctx);
    const state = normalizeSettingIndexState(settings.setting_index_state);
    settings.setting_index_state = state;
    return state;
}

function setSettingIndexState(ctx, state, { save = true } = {}) {
    const settings = getSettings(ctx);
    settings.setting_index_state = normalizeSettingIndexState(state);
    if (save) ctx.saveSettingsDebounced?.();
    return settings.setting_index_state;
}

/**
 * The single place the plugin writes chat state. The derived part goes to the external derived store
 * and the projected remainder goes to the chat file; before hydration the projection is a no-op so a
 * chat can never lose derived data to an unreachable backend.
 */
function persistStore(ctx, store, save = true) {
    // One implementation, owned by the derived store, so a module that mutates the store in place and
    // saves cannot bypass the projection.
    return persistChatStore(ctx, store, { save }) || store;
}

function getStore(ctx) {
    const legacySource = LEGACY_METADATA_KEYS.map(key => ctx.chatMetadata?.[key]).find(value => value && typeof value === 'object');
    const source = ctx.chatMetadata?.[METADATA_KEY] ?? legacySource;
    const normalized = normalizeStore(source);
    // The canonical state summary is not persisted: it is `buildCanonicalState` over `memories`, which the
    // same chat file already carries in full (see v55-store-compact.js). Rebuild it here - at the single
    // point every reader obtains a store from - so no reader can observe the difference. A summary whose
    // source is not 'canonical-memory' came from the legacy extractor and is left exactly as loaded.
    if (normalized.last_active_state_source === 'canonical-memory' && !String(normalized.last_active_state || '').trim()) {
        normalized.last_active_state = buildCanonicalState(normalized);
    }
    if (!ctx.chatMetadata) return normalized;
    return persistStore(ctx, normalized, false);
}

function setStore(ctx, store, save = true) {
    if (!ctx.chatMetadata) return;
    // Merge rather than assign: a Canonical replay must never erase the v5.5 tree and fold audit, and
    // the ownership guard cannot be relied on here because SillyTavern replaces chat_metadata wholesale
    // when it loads a chat.
    persistStore(ctx, store, save);
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
    // Same identity normalisation as getChatIdentity(): collection ids must not depend on whether the
    // host spelled the chat id with its file extension.
    const chatId = getChatIdentity(ctx);
    if (!chatId) return null;
    const id = `aetheria_v54_${fnv1a32(chatId).toString(36)}`;
    rememberVectorCollection(ctx, id, 'memory');
    return id;
}


function getChatIdentity(ctx) {
    // The host reports the same chat with and without its .jsonl suffix depending on which path
    // opened it (a UI chat switch versus openCharacterChat / restore-at-startup). Hashing the raw
    // string produced two different vector collections for one chat: the plugin rebuilt into the
    // second one and then reported the first as a stale index with no per-index space_fingerprint.
    return String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? '').trim().replace(/\.jsonl$/i, '');
}


function getBaselineCollectionId(ctx) {
    const chatId = getChatIdentity(ctx);
    if (!chatId) return null;
    const id = `aetheria_v54_baseline_${fnv1a32(chatId).toString(36)}`;
    rememberVectorCollection(ctx, id, 'baseline');
    return id;
}

function vectorCollectionRegistry(ctx) {
    const settings = getSettings(ctx);
    if (!settings.vector_collections || typeof settings.vector_collections !== 'object' || Array.isArray(settings.vector_collections)) {
        settings.vector_collections = {};
    }
    return settings.vector_collections;
}

function rememberVectorCollection(ctx, collectionId, kind) {
    if (!collectionId) return;
    const registry = vectorCollectionRegistry(ctx);
    const chatId = getChatIdentity(ctx) || null;
    const existing = registry[collectionId];
    if (existing && existing.chat_id === chatId && existing.kind === kind) return;
    registry[collectionId] = { chat_id: chatId, kind, at: Date.now() };
    ctx.saveSettingsDebounced?.();
}

function disposeVectorCollection(ctx, collectionId) {
    const registry = vectorCollectionRegistry(ctx);
    if (!registry[collectionId]) return;
    delete registry[collectionId];
    ctx.saveSettingsDebounced?.();
}

/** Deletes the vector collections of a chat that no longer exists. */
async function purgeChatVectorCollections(ctx, chatId) {
    const target = String(chatId || '').trim();
    if (!target) return [];
    const registry = vectorCollectionRegistry(ctx);
    const ids = Object.entries(registry)
        .filter(([, row]) => row && String(row.chat_id || '') === target)
        .map(([id]) => id);
    const purged = [];
    for (const id of ids) {
        try {
            await withVectorLock(() => purgeVectorCollection(ctx, id));
            purged.push(id);
        } catch (error) {
            log('purge chat collection failed', error);
        }
        disposeVectorCollection(ctx, id);
    }
    return purged;
}

/** Explicit maintenance action: purge every Aetheria-owned vector collection we know about. */
async function purgeAllAetheriaCollections(ctx) {
    const registry = vectorCollectionRegistry(ctx);
    const ids = Object.keys(registry).filter(id => id.startsWith('aetheria_'));
    const purged = [];
    for (const id of ids) {
        try {
            await withVectorLock(() => purgeVectorCollection(ctx, id));
            purged.push(id);
        } catch (error) {
            log('purge collection failed', error);
        }
        disposeVectorCollection(ctx, id);
    }
    return purged;
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
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, vectorReady: false, provider, collectionId };
    }

    if (!settings.semantic_baseline_gate) {
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = 'Semantic Baseline Gate 已关闭。';
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, vectorReady: false, provider, collectionId };
    }

    if (!settings.baseline_use_vector) {
        store.baseline.vector.stale = false;
        store.baseline.vector.last_error = null;
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, vectorReady: false, provider, collectionId };
    }

    if (!collectionId) {
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = '当前没有聊天ID，Baseline向量索引不可用；仍使用本地词法硬过滤。';
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, vectorReady: false, provider, collectionId };
    }
    if (!provider.supported) {
        store.baseline.vector.stale = true;
        store.baseline.vector.last_error = `${provider.reason || 'Embedding provider不可用'}；仍使用本地词法硬过滤。`;
        setStore(ctx, store);
        return { sources, records, vectorRecords, fingerprint, vectorFingerprint, vectorReady: false, provider, collectionId };
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
    return { sources, records, vectorRecords, fingerprint, vectorFingerprint, vectorReady, provider, collectionId };
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

async function filterOperationsAgainstBaseline(ctx, ops, preparedHost, pluginDeduper = null) {
    const settings = getSettings(ctx);
    if (!settings.semantic_baseline_gate) return { accepted: [...ops], rejected: [] };
    const hostRecords = Array.isArray(preparedHost?.records) ? preparedHost.records : [];
    const hasPluginRecords = Boolean(pluginDeduper?.records?.length);
    if (!hostRecords.length && !hasPluginRecords) return { accepted: [...ops], rejected: [] };

    const accepted = [];
    const rejected = [];
    for (const op of ops) {
        if (!isBaselineGateEligible(op)) {
            accepted.push(op);
            continue;
        }

        let decision = { blocked: false, reason: 'no-baseline-duplicate' };
        let source = null;
        if (hostRecords.length) {
            decision = evaluateBaselineDuplicate(op, hostRecords, {
                lexicalThreshold: settings.baseline_lexical_threshold,
                semanticThreshold: settings.baseline_similarity_threshold,
                semanticLexicalFloor: settings.baseline_semantic_lexical_floor,
            });
            if (!decision.blocked && preparedHost?.vectorReady) {
                const semanticMatches = await getSemanticBaselineMatches(ctx, op, preparedHost);
                decision = evaluateBaselineDuplicate(op, hostRecords, {
                    lexicalThreshold: settings.baseline_lexical_threshold,
                    semanticMatches,
                    semanticThreshold: settings.baseline_similarity_threshold,
                    semanticLexicalFloor: settings.baseline_semantic_lexical_floor,
                });
            }
            if (decision.blocked) source = 'host_baseline';
        }

        if (!decision.blocked && pluginDeduper?.records?.length) {
            const pluginDecision = await pluginDeduper.findPossibleMatches(op);
            if (pluginDecision?.blocked) {
                decision = pluginDecision;
                source = 'plugin_setting';
            }
        }

        if (decision.blocked) {
            rejected.push({
                op,
                reason: decision.reason,
                baseline_source_kind: source,
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
    // Folded rows are excluded from the prompt but remain dialogue: dropping them here would make
    // extraction and its dialogue-pair fingerprints change identity the moment a floor is folded.
    return Boolean(message && message.is_user !== true && isDialogueRow(message) && String(message.mes ?? '').trim());
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
        if (!msg || !isDialogueRow(msg)) continue;
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

// A quiet generation is not a safe carrier for the extraction prompt in TauriTavern: the request
// that reached the provider carried the character card as the user message and none of the extraction
// instructions, so the model answered with roleplay prose or raw reasoning and the JSON parse always
// failed. generateRaw delivered the exact prompt and returned clean JSON against the same host, which
// is also why the summary path works (it goes through a different host service). generateQuietPrompt
// stays as the fallback for hosts without generateRaw.
const EXTRACTION_SYSTEM_PROMPT = '你是记忆抽取器。只输出严格 JSON，不要解释、标题或代码围栏。';

// A reasoning model spends part of the budget on hidden reasoning before it emits any visible text, so
// a completion that starts like JSON and stops mid-string is a starved generation rather than a
// formatting mistake. That is worth one retry with a doubled budget instead of another prompt variant.
function looksLikeStarvedJson(raw) {
    const text = String(raw ?? '').trim();
    if (!text.startsWith('{')) return false;
    try { JSON.parse(text); return false; } catch { return true; }
}

// Sticky: set once the provider has refused response_format, so later extractions go straight to the
// plain-text path instead of paying for a request that is already known to be rejected every turn.
let structuredOutputRefused = false;

/**
 * The three budgets one extraction is allowed to spend, in order.
 *
 * Measured live on a reasoning model: the first attempt at 2048 tokens routinely comes back as the
 * host's "No message generated", because the visible answer never starts before the budget is gone.
 * The retry ladder therefore has to ESCALATE. The third rung used to pass no override at all, i.e. it
 * fell back to the base budget — so a request that had just starved at double the room was retried
 * with half of it. That is the shape of a retry that cannot succeed, and it is why a live 40-turn run
 * ended with 9 of 40 extractions.
 */
export function extractionBudgetLadder(configuredBudget) {
    const base = Math.max(128, Math.min(8192, Number(configuredBudget) || 2048));
    return {
        first: base,
        retry: Math.min(8192, base * 2),
        plain: Math.min(8192, base * 4),
    };
}

export function __testExtractionBudgetLadder(configuredBudget) {
    return extractionBudgetLadder(configuredBudget);
}

async function runQuietExtraction(ctx, prompt, useStructured = true, budgetOverride = null) {
    if (typeof ctx.generateRaw !== 'function' && typeof ctx.generateQuietPrompt !== 'function') {
        throw new Error('当前 SillyTavern Context 未提供 generateRaw / generateQuietPrompt，无法执行自动记忆抽取。');
    }
    const settings = getSettings(ctx);
    // Never inherit the chat preset's max_tokens: see extraction_response_tokens in DEFAULT_SETTINGS.
    const configured = Math.max(128, Math.min(8192, Number(settings.extraction_response_tokens) || 2048));
    const budget = Math.max(128, Math.min(8192, Number(budgetOverride) || configured));
    const schema = useStructured ? EXTRACTION_JSON_SCHEMA : null;
    // Mark the plugin's own call so the interceptor/wrappers can keep it cleared even when third-party
    // quiet injection is opted in.
    settings.__quiet_extraction_in_progress = true;
    runQuietExtraction.lastBudget = budget;
    try {
        const result = typeof ctx.generateRaw === 'function'
            ? await ctx.generateRaw({ prompt, systemPrompt: EXTRACTION_SYSTEM_PROMPT, responseLength: budget, jsonSchema: schema })
            : await ctx.generateQuietPrompt({ quietPrompt: prompt, responseLength: budget, ...(schema ? { jsonSchema: schema } : {}) });
        if (settings.metrics_enabled !== false) {
            const raw = typeof result === 'string' ? result : (result?.content ?? '');
            recordModelCall(ctx, {
                kind: 'extraction',
                promptChars: String(prompt ?? '').length,
                completionChars: String(raw ?? '').length,
                // Pass the text as well: the token estimate is script-aware, so a Chinese prompt is
                // no longer charged at the Latin characters / 4 rate.
                promptText: String(prompt ?? ''),
                completionText: String(raw ?? ''),
            });
        }
        return result;
    } finally {
        delete settings.__quiet_extraction_in_progress;
    }
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
    let preparedSettingIndex = await ensurePluginSettingIndex(ctx, { silent: true });
    const extractionSettingRetrieval = await retrieveExtractionSettings(ctx, pair, store, preparedSettingIndex);
    const relevantSettingContext = formatRelevantSettingContext(extractionSettingRetrieval, {
        maxChars: settings.setting_extraction_max_chars,
        constantLimit: settings.setting_retrieval_constant_limit,
        includeConstants: true,
    });
    const relevantHostBaseline = buildRelevantHostBaselineContext(
        preparedBaseline,
        extractionSettingRetrieval.query?.text || `${pair.userText}
${pair.assistantText}`,
        Math.min(4500, Math.max(1200, Math.floor(settings.setting_extraction_max_chars * 0.55))),
    );
    const promptLayers = {
        recentContext: buildRecentContextForExtraction(rows, assistantIndex, extractionContextMessages(settings)),
        canonicalState: formatCanonicalStateForExtraction(store),
        relevantSettingContext,
        hostBaselineContext: relevantHostBaseline,
    };
    const promptPlan = planExtractionPromptBudget({
        limit: settings.extraction_prompt_max_chars,
        pairChars: String(pair.userText || '').length + String(pair.assistantText || '').length,
        layerChars: Object.fromEntries(Object.entries(promptLayers).map(([key, value]) => [key, String(value || '').length])),
    });
    const prompt = buildAutonomousExtractionPrompt({
        userText: pair.userText,
        assistantText: pair.assistantText,
        ...promptLayers,
        optionalCeilings: promptPlan.ceilings,
    });

    const started = performance.now?.() ?? Date.now();
    let raw = '';
    let parsed = null;
    let mode = 'structured';
    // Every provider round-trip is recorded, failures included. Without this a truncated attempt and
    // a skipped retry look identical from the outside: both end in the same parse error, and the only
    // way to tell them apart was to correlate host-side request logs by hand.
    const attempts = [];
    const noteAttempt = (phase, value, ok) => attempts.push({
        phase,
        budget: runQuietExtraction.lastBudget ?? null,
        type: typeof value,
        chars: typeof value === 'string' ? value.length : null,
        parsed: Boolean(ok),
        starved: looksLikeStarvedJson(value),
    });
    // A provider that refuses response_format rejects the WHOLE request ("This response_format type
    // is unavailable now" on the proxy this ran against live), so each attempt is contained here and
    // a turn falls through to the plain-text path instead of losing its extraction outright.
    const configuredBudget = Math.max(128, Math.min(8192, Number(settings.extraction_response_tokens) || 2048));
    const wantsStructured = Boolean(settings.extraction_structured_output) && !structuredOutputRefused;
    const attemptExtraction = async (phase, useStructured, budget, text) => {
        try {
            const value = await runQuietExtraction(ctx, text, useStructured, budget);
            const result = parseExtractionResult(value);
            noteAttempt(phase, value, result.ok);
            return { value, result };
        } catch (error) {
            const message = String(error?.message || error);
            // A provider that cannot accept response_format refuses it on every single turn. Remember
            // that, so the next extraction does not pay for two requests that are known to be rejected.
            if (useStructured && /response_format|json_schema|json_object|unavailable now/i.test(message)) {
                structuredOutputRefused = true;
            }
            noteAttempt(phase, message, false);
            return { value: '', result: { ok: false, error: message } };
        }
    };
    try {
        let step = await attemptExtraction('structured', wantsStructured, null, prompt);
        raw = step.value;
        parsed = step.result;
        // Retry on any parse failure with budget headroom, not only on "looks truncated" output: a
        // reasoning model can also spend the whole budget before it emits its first brace, and that
        // shape is indistinguishable from a formatting mistake. The doubled budget is the fix for
        // both, so the gate is deliberately just "did not parse".
        const ladder = extractionBudgetLadder(configuredBudget);
        if (!parsed.ok && configuredBudget < 8192) {
            mode = 'budget-retry';
            step = await attemptExtraction('budget-retry', wantsStructured && !structuredOutputRefused, ladder.retry, prompt);
            raw = step.value;
            parsed = step.result;
        }
        if ((!parsed.ok || (typeof raw === 'string' && raw.trim() === '{}' && !parsed.eventSummary)) && settings.extraction_retry_plain_json !== false) {
            mode = 'plain-json-retry';
            // The plain-text rung keeps the escalated budget. Passing no override here made the last
            // attempt smaller than the one that had already failed.
            step = await attemptExtraction('plain-json-retry', false, ladder.plain, prompt + '\n\n严格只输出JSON，不要代码围栏。');
            raw = step.value;
            parsed = step.result;
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
        const rawText = String(raw || '');
        const error = new Error(`记忆抽取JSON解析失败：${parsed?.error || 'unknown error'}`);
        store.last_extraction_debug = {
            status: 'parse-error', message_index: assistantIndex, source_key: pair.key,
            raw_preview: rawText.slice(0, 1200), error: error.message, at: Date.now(),
            raw_length: rawText.length,
            response_tokens_budget: runQuietExtraction.lastBudget ?? null,
            mode,
            attempts,
            // A completion that carries no JSON delimiter at all is almost always a starved or
            // reasoning-dominated generation rather than a formatting mistake, so say which.
            truncated_hint: !rawText.includes('{')
                ? '响应中没有 JSON（疑似被 max_tokens 截断或全部消耗在推理内容上）；可提高 extraction_response_tokens。'
                : (looksLikeStarvedJson(rawText) ? 'JSON 未闭合（疑似被 max_tokens 截断，推理内容吃掉了预算）；可提高 extraction_response_tokens。' : null),
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
        // An operation with no text is a hole in the record: it cannot become a memory, cannot be
        // replayed into one, and only inflates the canonical transaction log (measured at 18-443% of
        // the raw dialogue). Measured live: 0-7 such operations per chat.
        if (!validationErrorsForOp.length && String(op?.text || '').trim()) validatedOps.push(op);
        else validationErrors.push(...validationErrorsForOp);
    }

    // Refresh both host baseline and plugin-owned active Setting scope after the quiet call.
    // The write gate must use the current canonical sources, not the snapshot from before generation.
    preparedBaseline = await ensureSemanticBaseline(current, { silent: true });
    preparedSettingIndex = await ensurePluginSettingIndex(current, { silent: true });
    const pluginBaselineDeduper = createPluginBaselineDeduper(current, preparedSettingIndex);
    const baselineFiltered = await filterOperationsAgainstBaseline(current, validatedOps, preparedBaseline, pluginBaselineDeduper);
    const validOps = baselineFiltered.accepted;
    const baselineRejections = baselineFiltered.rejected;
    if (!validOps.length) {
        validOps.push({
            op: 'noop',
            reason: baselineRejections.length
                ? '候选操作均与Host Baseline或插件自有世界设定重复，已由写入层拦截。'
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
        setting_scope_key: preparedSettingIndex.scope?.scope_key || null,
        setting_index_fingerprint: preparedSettingIndex.fingerprint || null,
        relevant_setting_ids: extractionSettingRetrieval.results.map(row => row.entry_id),
        baseline_rejections: baselineRejections,
        prompt_plan: promptPlan,
        generated_at: Date.now(),
        generation_mode: mode,
    };
    store.extractions[pair.key] = record;
    // Cold原文 snapshot: the live chat is the only other copy, and an edit or delete would
    // destroy it. Snapshot the pair under the same fingerprint the memory points at.
    // This is an EVIDENCE CACHE, not memory: memory-core.js never reads cold_turns, and the extractor
    // stays correct with the switch off. It exists so 【查阅记忆】 can still show original wording
    // after the host text changed — which is why it is a copy of the transcript and not a fact store.
    if (settings.cold_turn_snapshot_enabled === false) {
        pruneColdTurns(store, settings.cold_turn_max_chars, { byReconstructability: settings.cold_eviction_by_reconstructability !== false });
    } else {
        recordColdTurn(store, {
            source_key: pair.key,
            fingerprint: pair.hash,
            assistantIndex,
            userIndex: pair.userIndex,
            userText: pair.userText,
            assistantText: pair.assistantText,
        }, { maxChars: settings.cold_turn_max_chars });
    }

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
        if (parsed.activeState) store.last_active_state = parsed.activeState;
        store.last_active_state_source = assistantIndex;
        if (parsed.eventSummary) store.last_event_summary = parsed.eventSummary;
        store.source_fingerprints = collectAutonomousExtractionSources(current.chat || [], store.extractions)
            .map(x => ({ index: x.assistantIndex, hash: x.hash }));
        changedIds = applied.changedIds;
        applyErrors = applied.errors;
    }
    const elapsed = (performance.now?.() ?? Date.now()) - started;
    store.last_extraction_debug = {
        status: applyErrors.length ? 'partial' : 'ok', message_index: assistantIndex, source_key: pair.key,
        elapsed_ms: Math.round(elapsed * 10) / 10,
        op_count: validOps.filter(op => op.op !== 'noop').length,
        baseline_input_count: validatedOps.length,
        baseline_rejected_count: baselineRejections.length,
        baseline_rejections: baselineRejections,
        baseline_fingerprint: preparedBaseline.fingerprint,
        setting_scope_key: preparedSettingIndex.scope?.scope_key || null,
        relevant_setting_ids: extractionSettingRetrieval.results.map(row => row.entry_id),
        setting_retrieval: extractionSettingRetrieval.debug,
        changed_ids: changedIds,
        validation_errors: validationErrors,
        apply_errors: applyErrors,
        mode,
        attempts,
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
    if (settings.extraction_notifications) {
        const committedOps = validOps.filter(op => op.op !== 'noop').length;
        if (applyErrors.length || validationErrors.length) notify('warning', `记忆抽取部分失败：提交 ${committedOps} 个，错误 ${applyErrors.length + validationErrors.length} 条。`, '自动记忆');
        else notify('success', `已提交记忆操作 ${committedOps} 个；Baseline拦截 ${baselineRejections.length} 个。`, '自动记忆');
    }
    log('autonomous extraction complete', store.last_extraction_debug);
    return { record, changedIds, baselineRejections, errors: [...validationErrors, ...applyErrors] };
}

function countAssistantTurns(chat, upToIndex) {
    const rows = Array.isArray(chat) ? chat : [];
    let count = 0;
    for (let i = 0; i <= upToIndex && i < rows.length; i++) {
        if (rows[i] && !rows[i].is_user && isDialogueRow(rows[i])) count += 1;
    }
    return count;
}

function extractionContextMessages(settings) {
    const base = Math.max(0, Math.min(12, Number(settings.extraction_context_messages) || 0));
    const batch = Math.max(1, Math.min(10, Math.floor(Number(settings.extraction_batch_turns) || 1)));
    // A batch of N samples the extractor every N-th turn; widen the recent-context window so the
    // skipped span is still visible to the model instead of being silently dropped.
    return Math.min(12, base + (batch - 1) * 2);
}

function scheduleLatestAssistantExtraction({ force = false } = {}) {
    const ctx = getContext();
    if (!ctx) return;
    const settings = getSettings(ctx);
    if (!settings.auto_extract) return;
    const index = findLatestAssistantIndex(ctx.chat || []);
    if (index < 0) return;
    const batch = Math.max(1, Math.min(10, Math.floor(Number(settings.extraction_batch_turns) || 1)));
    if (!force && batch > 1 && countAssistantTurns(ctx.chat || [], index) % batch !== 0) return;
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
    if (!contentType.includes('application/json')) return await response.text();
    let body = null;
    try {
        body = await response.json();
    } catch (error) {
        throw new Error(`Vector API ${endpoint} returned unparseable JSON: ${String(error?.message || error)}`);
    }
    if (body && typeof body === 'object' && (body.ok === false || body.success === false || body.error)) {
        throw new Error(`Vector API ${endpoint} reported failure: ${String(body.error || body.message || 'unknown error')}`);
    }
    return body;
}

async function vectorInsert(ctx, provider, collectionId, items) {
    if (!items.length) return null;
    const result = await vectorRequest(ctx, 'insert', {
        ...provider.body,
        collectionId,
        items,
        source: provider.source,
    });
    const inserted = Number(result?.inserted ?? result?.count ?? NaN);
    if (Number.isFinite(inserted) && inserted < items.length) {
        throw new Error(`Vector insert stored ${inserted}/${items.length} items.`);
    }
    if (getSettings(ctx)?.metrics_enabled !== false) {
        recordEmbeddingCall(ctx, { count: items.length, chars: items.reduce((n, item) => n + String(item?.text || '').length, 0) });
    }
    return result;
}

async function vectorDelete(ctx, provider, collectionId, hashes) {
    const unique = [...new Set(hashes.map(Number).filter(Number.isFinite))];
    if (!unique.length) return;
    const result = await vectorRequest(ctx, 'delete', {
        ...provider.body,
        collectionId,
        hashes: unique,
        source: provider.source,
    });
    const deleted = Number(result?.deleted ?? result?.count ?? NaN);
    if (Number.isFinite(deleted) && deleted < unique.length) {
        throw new Error(`Vector delete removed ${deleted}/${unique.length} hashes.`);
    }
    return result;
}

async function vectorQuery(ctx, provider, collectionId, searchText, topK, threshold) {
    const result = await vectorRequest(ctx, 'query', {
        ...provider.body,
        collectionId,
        searchText,
        topK,
        threshold,
        source: provider.source,
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('Vector query returned no JSON object.');
    }
    if (!Array.isArray(result.metadata)) {
        throw new Error('Vector query response is missing the metadata array.');
    }
    if (getSettings(ctx)?.metrics_enabled !== false) {
        recordEmbeddingCall(ctx, { count: 1, chars: String(searchText || '').length });
    }
    return result;
}

async function purgeVectorCollection(ctx, collectionId) {
    await vectorRequest(ctx, 'purge', { collectionId });
}

function getSettingProfileHash(provider) {
    return computeSettingEmbeddingProfileHash(provider?.fingerprint || provider?.source || 'unknown-provider');
}

function settingDiffSummary(diff, mode = 'incremental') {
    return {
        mode,
        added: [...(diff?.added || [])],
        changed: [...(diff?.changed || [])],
        removed: [...(diff?.removed || [])],
        unchanged_count: Array.isArray(diff?.unchanged) ? diff.unchanged.length : 0,
        insert_entry_count: Array.isArray(diff?.insert_entry_ids) ? diff.insert_entry_ids.length : 0,
        delete_hash_count: Array.isArray(diff?.delete_hashes) ? diff.delete_hashes.length : 0,
        at: Date.now(),
    };
}

function settingVectorHashFromMetadata(snapshot, row) {
    const direct = Number(row?.hash);
    if (Number.isFinite(direct)) return direct;
    const index = Number(row?.index);
    if (Number.isInteger(index) && index >= 0 && index < (snapshot?.chunks?.length || 0)) {
        const hash = Number(snapshot.chunks[index]?.vector_hash);
        return Number.isFinite(hash) ? hash : null;
    }
    return null;
}

async function verifySettingVectorCollection(ctx, provider, collectionId, snapshot, { entryIds = null } = {}) {
    const settings = getSettings(ctx);
    if (!settings.setting_index_verify_build) {
        return { ok: true, skipped: true, reason: 'verification-disabled', expected_count: snapshot?.chunks?.length || 0 };
    }
    const filter = entryIds ? new Set(Array.from(entryIds, value => String(value))) : null;
    const candidates = (snapshot?.chunks || []).filter(chunk => !filter || filter.has(String(chunk.entry_id)));
    const sample = candidates[0] || null;
    if (!sample) return { ok: true, skipped: true, reason: 'empty-sample', expected_count: snapshot?.chunks?.length || 0 };
    const allowedHashes = new Set(candidates.map(chunk => Number(chunk.vector_hash)).filter(Number.isFinite));
    try {
        const response = await vectorQuery(ctx, provider, collectionId, sample.retrieval_text, Math.min(8, Math.max(1, candidates.length)), 0);
        const metadata = Array.isArray(response?.metadata) ? response.metadata : [];
        const returnedHashes = metadata.map(row => settingVectorHashFromMetadata(snapshot, row)).filter(Number.isFinite);
        const matchedHash = returnedHashes.find(hash => allowedHashes.has(hash));
        return {
            ok: Number.isFinite(matchedHash),
            skipped: false,
            expected_count: snapshot?.chunks?.length || 0,
            sample_entry_id: sample.entry_id,
            sample_chunk_id: sample.chunk_id,
            sample_hash: Number(sample.vector_hash),
            returned_count: metadata.length,
            matched_hash: Number.isFinite(matchedHash) ? matchedHash : null,
            reason: Number.isFinite(matchedHash) ? null : 'sample-query-did-not-return-current-index-hash',
        };
    } catch (error) {
        return {
            ok: false,
            skipped: false,
            expected_count: snapshot?.chunks?.length || 0,
            sample_entry_id: sample.entry_id,
            sample_chunk_id: sample.chunk_id,
            sample_hash: Number(sample.vector_hash),
            returned_count: 0,
            matched_hash: null,
            reason: `sample-query-failed: ${String(error?.message || error)}`,
        };
    }
}

async function insertSettingVectorItemsBatched(ctx, provider, collectionId, items, batchSize = 40) {
    for (let i = 0; i < items.length; i += batchSize) {
        await vectorInsert(ctx, provider, collectionId, items.slice(i, i + batchSize));
    }
}

async function buildSettingVectorCollectionSafely(ctx, provider, snapshot, profileHash) {
    const generationKey = `${snapshot.fingerprint}|${Date.now()}|${Math.random()}`;
    const collectionId = getSettingCollectionId(snapshot.scope, profileHash, generationKey);
    const items = buildSettingVectorItems(snapshot);
    // Purging is allowed only for this inactive staging collection. The previous active
    // collection is never purged before a replacement has been built and verified.
    await purgeVectorCollection(ctx, collectionId);
    try {
        await insertSettingVectorItemsBatched(ctx, provider, collectionId, items);
        const verification = await verifySettingVectorCollection(ctx, provider, collectionId, snapshot);
        if (!verification.ok) throw new Error(`Setting staging verification failed: ${verification.reason || 'unknown verification failure'}`);
        return { collectionId, verification };
    } catch (error) {
        try { await purgeVectorCollection(ctx, collectionId); } catch { /* inactive failed staging collection; leave diagnostics only */ }
        throw error;
    }
}

async function updateSettingVectorCollectionIncrementally(ctx, provider, collectionId, snapshot, previousManifest) {
    const nextManifest = buildSettingEntryManifest(snapshot);
    const diff = diffSettingEntryManifests(previousManifest, nextManifest);
    if (!diff.has_changes) {
        return {
            manifest: nextManifest,
            diff,
            verification: { ok: true, skipped: true, reason: 'manifest-equivalent', expected_count: snapshot.chunks.length },
            cleanupPendingHashes: [],
        };
    }

    const insertItems = buildSettingVectorItems(snapshot, { entryIds: diff.insert_entry_ids });
    const insertedHashes = [...new Set(insertItems.map(item => Number(item.hash)).filter(Number.isFinite))];
    const currentHashes = new Set(snapshot.chunks.map(chunk => Number(chunk.vector_hash)).filter(Number.isFinite));
    const deleteHashes = [...new Set(diff.delete_hashes.map(Number).filter(hash => Number.isFinite(hash) && !currentHashes.has(hash)))];

    try {
        // Insert replacements first. If insertion or verification fails, old vectors are still intact.
        await insertSettingVectorItemsBatched(ctx, provider, collectionId, insertItems);
        const verification = insertItems.length
            ? await verifySettingVectorCollection(ctx, provider, collectionId, snapshot, { entryIds: diff.insert_entry_ids })
            : { ok: true, skipped: true, reason: 'delete-only-update', expected_count: snapshot.chunks.length };
        if (!verification.ok) throw new Error(`Setting incremental verification failed: ${verification.reason || 'unknown verification failure'}`);

        let cleanupPendingHashes = [];
        if (deleteHashes.length) {
            try {
                await vectorDelete(ctx, provider, collectionId, deleteHashes);
            } catch (error) {
                // Old hashes are harmless for retrieval because metadata is mapped back through the
                // current snapshot and unknown hashes are ignored. Keep the index usable and retry GC later.
                cleanupPendingHashes = deleteHashes;
                log('setting index stale-hash cleanup deferred', error);
            }
        }
        return { manifest: nextManifest, diff, verification, cleanupPendingHashes };
    } catch (error) {
        // Best-effort rollback of newly inserted hashes. Since deletion of old hashes happens only
        // after successful verification, a failed update retains the previous valid collection.
        if (insertedHashes.length) {
            try { await vectorDelete(ctx, provider, collectionId, insertedHashes); } catch { /* old collection still remains authoritative */ }
        }
        throw error;
    }
}

async function ensurePluginSettingIndex(ctx, { force = false, silent = true } = {}) {
    const settings = getSettings(ctx);
    const snapshotBase = buildSettingIndexSnapshot(getSettingStore(ctx), {
        maxChars: settings.setting_index_chunk_chars,
    });
    const provider = getVectorProvider(ctx);
    const profileHash = getSettingProfileHash(provider);
    const state = getSettingIndexState(ctx);
    const scopeKey = snapshotBase.scope.scope_key;
    const summary = summarizeSettingSnapshot(snapshotBase);
    const snapshot = {
        ...snapshotBase,
        logical_collection_id: snapshotBase.collection_id,
        embedding_profile_hash: profileHash,
    };

    if (!scopeKey || !snapshot.chunks.length) {
        state.active_scope_key = scopeKey || null;
        if (scopeKey) {
            const scopeRow = normalizeSettingScopeState(state.scopes[scopeKey]);
            state.scopes[scopeKey] = {
                ...scopeRow,
                ...summary,
                fingerprint: snapshot.fingerprint,
                vector_degraded: false,
                last_error: null,
                last_attempt_profile_hash: profileHash,
                last_attempt_at: Date.now(),
            };
        }
        setSettingIndexState(ctx, state);
        return {
            ...snapshot,
            collection_id: null,
            provider,
            lexicalReady: snapshot.chunks.length > 0,
            vectorReady: false,
            vector_degraded: false,
            state: scopeKey ? getSettingIndexState(ctx).scopes[scopeKey] : null,
            profile_state: null,
        };
    }

    let scopeRow = normalizeSettingScopeState(state.scopes[scopeKey]);
    scopeRow = {
        ...scopeRow,
        ...summary,
        fingerprint: snapshot.fingerprint,
        last_attempt_profile_hash: profileHash,
        last_attempt_at: Date.now(),
    };
    state.active_scope_key = scopeKey;

    const currentProfile = normalizeSettingProfileState(scopeRow.profiles[profileHash], profileHash);
    const matchingReadyProfile = Boolean(
        currentProfile.ready
        && currentProfile.stale === false
        && currentProfile.vector_disabled !== true
        && currentProfile.provider_fingerprint === provider.fingerprint
        && currentProfile.fingerprint === snapshot.fingerprint
        && currentProfile.collection_id
    );

    if (!settings.setting_index_use_vector) {
        scopeRow.vector_degraded = false;
        scopeRow.last_error = null;
        state.scopes[scopeKey] = scopeRow;
        setSettingIndexState(ctx, state);
        return { ...snapshot, collection_id: null, provider, lexicalReady: true, vectorReady: false, vector_degraded: false, state: scopeRow, profile_state: matchingReadyProfile ? currentProfile : null };
    }

    if (!provider.supported) {
        scopeRow.vector_degraded = true;
        scopeRow.last_error = `${provider.reason || 'Embedding provider不可用'}；插件设定仍可使用本地词法索引，已有向量集合不会被删除。`;
        state.scopes[scopeKey] = scopeRow;
        setSettingIndexState(ctx, state);
        return { ...snapshot, collection_id: null, provider, lexicalReady: true, vectorReady: false, vector_degraded: true, state: scopeRow, profile_state: null };
    }

    if (matchingReadyProfile && !force) {
        let reusableProfile = currentProfile;
        if (currentProfile.cleanup_pending_hashes.length) {
            try {
                await withVectorLock(() => vectorDelete(ctx, provider, currentProfile.collection_id, currentProfile.cleanup_pending_hashes));
                reusableProfile = normalizeSettingProfileState({ ...currentProfile, cleanup_pending_hashes: [], last_error: null }, profileHash);
            } catch (error) {
                reusableProfile = normalizeSettingProfileState({ ...currentProfile, last_error: `旧 hash 清理仍待重试：${String(error?.message || error)}` }, profileHash);
            }
        }
        scopeRow.active_profile_hash = profileHash;
        scopeRow.active_collection_id = reusableProfile.collection_id;
        scopeRow.vector_degraded = false;
        scopeRow.last_error = reusableProfile.cleanup_pending_hashes.length
            ? `向量可用；有 ${reusableProfile.cleanup_pending_hashes.length} 个旧 hash 等待清理。`
            : null;
        scopeRow.profiles[profileHash] = reusableProfile;
        state.scopes[scopeKey] = scopeRow;
        setSettingIndexState(ctx, state);
        return { ...snapshot, collection_id: reusableProfile.collection_id, provider, lexicalReady: true, vectorReady: true, vector_degraded: false, state: scopeRow, profile_state: reusableProfile };
    }

    const needsBuild = force || !matchingReadyProfile;
    if (needsBuild && !(force || settings.setting_index_auto_rebuild)) {
        scopeRow.vector_degraded = true;
        scopeRow.last_error = '设定范围、内容或Embedding profile已变化，需要更新派生向量；当前自动更新已关闭。';
        state.scopes[scopeKey] = scopeRow;
        setSettingIndexState(ctx, state);
        return { ...snapshot, collection_id: null, provider, lexicalReady: true, vectorReady: false, vector_degraded: true, state: scopeRow, profile_state: null };
    }

    try {
        const canIncrement = Boolean(
            !force
            && currentProfile.ready
            && currentProfile.stale === false
            && currentProfile.collection_id
            && currentProfile.provider_fingerprint === provider.fingerprint
            && currentProfile.entry_manifest?.entry_count >= 0
            && currentProfile.fingerprint !== snapshot.fingerprint
        );

        let nextProfile;
        if (canIncrement) {
            const incremental = await withVectorLock(() => updateSettingVectorCollectionIncrementally(
                ctx,
                provider,
                currentProfile.collection_id,
                snapshot,
                currentProfile.entry_manifest,
            ));
            nextProfile = normalizeSettingProfileState({
                ...currentProfile,
                embedding_profile_hash: profileHash,
                provider_fingerprint: provider.fingerprint,
                collection_id: currentProfile.collection_id,
                fingerprint: snapshot.fingerprint,
                entry_manifest: incremental.manifest,
                ready: true,
                stale: false,
                vector_disabled: false,
                cleanup_pending_hashes: incremental.cleanupPendingHashes,
                last_error: incremental.cleanupPendingHashes.length ? '旧向量 hash 清理延后；当前快照检索仍可用。' : null,
                last_sync_at: Date.now(),
                last_verified_at: incremental.verification.skipped ? currentProfile.last_verified_at : Date.now(),
                last_built_at: currentProfile.last_built_at || Date.now(),
                last_diff: settingDiffSummary(incremental.diff, 'incremental'),
                verification: incremental.verification,
            }, profileHash);
            if (!silent) notify('success', `插件设定索引已增量更新：新增 ${incremental.diff.added.length} / 修改 ${incremental.diff.changed.length} / 删除 ${incremental.diff.removed.length}。`, 'Setting Index');
        } else {
            const built = await withVectorLock(() => buildSettingVectorCollectionSafely(ctx, provider, snapshot, profileHash));
            const manifest = buildSettingEntryManifest(snapshot);
            const previousActiveCollection = scopeRow.active_collection_id;
            nextProfile = normalizeSettingProfileState({
                embedding_profile_hash: profileHash,
                provider_fingerprint: provider.fingerprint,
                collection_id: built.collectionId,
                fingerprint: snapshot.fingerprint,
                entry_manifest: manifest,
                ready: true,
                stale: false,
                vector_disabled: false,
                cleanup_pending_hashes: [],
                last_error: null,
                last_sync_at: Date.now(),
                last_verified_at: built.verification.skipped ? null : Date.now(),
                last_built_at: Date.now(),
                last_diff: settingDiffSummary({ added: Object.keys(manifest.entries), changed: [], removed: [], unchanged: [] }, 'safe-full-build'),
                verification: built.verification,
            }, profileHash);
            if (previousActiveCollection && previousActiveCollection !== built.collectionId) {
                scopeRow.retired_collection_ids = [...new Set([...scopeRow.retired_collection_ids, previousActiveCollection])];
            }
            if (!silent) notify('success', `插件设定新向量空间已安全构建并切换：${snapshot.chunks.length} 个分块。`, 'Setting Index');
        }

        // Atomic local pointer switch happens only after insert + verification succeeded.
        scopeRow.profiles[profileHash] = nextProfile;
        scopeRow.active_profile_hash = profileHash;
        scopeRow.active_collection_id = nextProfile.collection_id;
        scopeRow.vector_degraded = false;
        scopeRow.last_error = nextProfile.last_error;
        state.scopes[scopeKey] = scopeRow;
        setSettingIndexState(ctx, state);
        return { ...snapshot, collection_id: nextProfile.collection_id, provider, lexicalReady: true, vectorReady: true, vector_degraded: false, state: scopeRow, profile_state: nextProfile };
    } catch (error) {
        scopeRow.vector_degraded = true;
        scopeRow.last_error = `设定向量更新失败；保留既有索引并降级词法：${String(error?.message || error)}`;
        // Prefer the last known-good profile for the same provider so a failed refresh does not
        // drop dense recall for the rest of the request. If the provider itself changed, the old
        // collection is not trustworthy and dense retrieval degrades to lexical only.
        const fallbackHash = scopeRow.active_profile_hash;
        const fallbackProfile = fallbackHash && scopeRow.profiles ? scopeRow.profiles[fallbackHash] : null;
        const usableFallback = fallbackProfile && fallbackProfile.ready !== false
            && fallbackProfile.collection_id
            && fallbackProfile.provider_fingerprint === provider.fingerprint
            ? fallbackProfile
            : null;
        state.scopes[scopeKey] = scopeRow;
        setSettingIndexState(ctx, state);
        if (!silent) notify('warning', scopeRow.last_error, 'Setting Index');
        return {
            ...snapshot,
            collection_id: usableFallback ? usableFallback.collection_id : null,
            provider,
            lexicalReady: true,
            vectorReady: Boolean(usableFallback),
            vector_degraded: true,
            state: scopeRow,
            profile_state: usableFallback,
            fallback_profile_hash: usableFallback ? fallbackHash : null,
        };
    }
}

function searchPluginSettingsLexical(ctx, query, options = {}) {
    const settings = getSettings(ctx);
    const snapshot = buildSettingIndexSnapshot(getSettingStore(ctx), {
        maxChars: settings.setting_index_chunk_chars,
    });
    const results = lexicalSearchSettingChunks(snapshot.chunks, query, {
        topK: options.topK ?? settings.setting_index_lexical_top_k,
        minScore: options.minScore ?? settings.setting_index_lexical_min_score,
    });
    return { snapshot, results };
}

function buildRelevantHostBaselineContext(preparedBaseline, queryText, maxChars = 4500) {
    const records = Array.isArray(preparedBaseline?.records) ? preparedBaseline.records : [];
    if (!records.length) return '';
    const coreTypes = new Set(['persona', 'character_description', 'character_personality', 'character_scenario']);
    const coreReserve = records.filter(record => coreTypes.has(record.source_type)).slice(0, 6);
    const ranked = String(queryText || '').trim()
        ? records
            .map(record => ({ record, score: baselineLexicalSimilarity(queryText, record.text || '') }))
            .filter(row => row.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(row => row.record)
        : [];
    const selected = [];
    const seen = new Set();
    for (const record of [...coreReserve, ...ranked]) {
        const key = record.id || `${record.source_type}:${record.source_id}:${record.title}:${record.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push(record);
    }
    const cap = Math.max(1000, Math.min(12000, Number(maxChars) || 4500));
    const lines = ['[RELEVANT HOST BASELINE — PERSONA / CHARACTER / HOST WORLD INFO]'];
    let used = lines[0].length;
    for (const record of selected) {
        const line = `- [${record.source_type}:${record.title}] ${record.text}`;
        if (used + line.length + 1 > cap) break;
        lines.push(line);
        used += line.length + 1;
    }
    return lines.length > 1 ? lines.join('\n') : '';
}

async function retrievePluginSettings(ctx, queryInput, options = {}) {
    const settings = getSettings(ctx);
    const query = typeof queryInput === 'string' ? { mode: options.mode || 'generic', text: queryInput, components: {} } : (queryInput || {});
    if (!settings.setting_retrieval_enabled || !String(query.text || '').trim()) {
        return {
            query,
            snapshot: buildSettingIndexSnapshot(getSettingStore(ctx), { maxChars: settings.setting_index_chunk_chars }),
            results: [], constant_entries: [], dropped_entry_ids: [], candidate_entry_count: 0,
            lexical: [], dense: [], dense_available: false, dense_reason: 'disabled-or-empty-query',
        };
    }

    const prepared = options.prepared || await ensurePluginSettingIndex(ctx, { silent: true });
    const candidateTopK = Math.max(1, Math.min(80, Number(options.candidateTopK ?? settings.setting_retrieval_candidate_top_k) || 18));
    const lexical = lexicalSearchSettingChunks(prepared.chunks, query.text, {
        topK: candidateTopK,
        minScore: options.minScore ?? settings.setting_index_lexical_min_score,
    });

    let dense = [];
    let denseAvailable = false;
    let denseReason = null;
    if (settings.setting_retrieval_use_dense && prepared.vectorReady && prepared.collection_id && prepared.provider?.supported) {
        try {
            const response = await withVectorLock(() => vectorQuery(
                ctx,
                prepared.provider,
                prepared.collection_id,
                query.text,
                candidateTopK,
                Math.max(0, Math.min(1, Number.isFinite(Number(settings.setting_retrieval_dense_threshold)) ? Number(settings.setting_retrieval_dense_threshold) : 0.18)),
            ));
            dense = mapDenseSettingMetadata(prepared, response.metadata);
            denseAvailable = true;
        } catch (error) {
            denseReason = `setting dense query failed: ${String(error?.message || error)}`;
        }
    } else {
        denseReason = !settings.setting_retrieval_use_dense
            ? 'dense-disabled'
            : prepared.vectorReady
                ? 'no-collection-or-provider'
                : 'setting-vector-not-ready';
    }

    const fused = fuseSettingCandidates(prepared, {
        lexical,
        dense,
        rrfK: settings.setting_retrieval_rrf_k,
        topEntries: options.topEntries ?? settings.setting_retrieval_final_count,
        maxChars: options.maxChars ?? settings.setting_retrieval_max_chars,
    });
    const debug = {
        mode: query.mode || options.mode || 'generic',
        world_id: prepared.scope?.world_id || null,
        scope_key: prepared.scope?.scope_key || null,
        query_chars: String(query.text || '').length,
        query_components: query.components || {},
        lexical_count: lexical.length,
        dense_available: denseAvailable,
        dense_reason: denseAvailable ? null : denseReason,
        vector_degraded: Boolean(prepared.vector_degraded),
        embedding_profile_hash: prepared.embedding_profile_hash || null,
        vector_collection_id: prepared.collection_id || null,
        dense_count: dense.length,
        candidate_entry_count: fused.candidate_entry_count,
        selected: fused.results.map(row => ({
            entry_id: row.entry_id,
            title: row.title,
            revision_id: row.revision_id,
            score: Math.round(Number(row.score || 0) * 1e6) / 1e6,
            channels: row.channels,
            matched_chunks: row.matched_chunks.slice(0, 3).map(chunk => ({ chunk_id: chunk.chunk_id, chunk_index: chunk.chunk_index, channels: chunk.channels })),
        })),
        dropped_entry_ids: fused.dropped_entry_ids,
        at: Date.now(),
    };
    lastSettingRetrievalDebug = debug;
    return {
        ...fused,
        query,
        snapshot: prepared,
        lexical,
        dense,
        dense_available: denseAvailable,
        dense_reason: denseReason,
        debug,
    };
}

async function retrieveGenerationSettings(ctx, interceptorChat, storeInput = null) {
    const settings = getSettings(ctx);
    const store = normalizeStore(storeInput || getStore(ctx));
    const querySeed = buildQueryText(interceptorChat, settings.query_messages);
    const activeMemories = settings.setting_query_seed_from_memories === false
        ? []
        : getActiveMemories(store, querySeed, settings.max_active_items);
    const query = buildGenerationSettingQuery({
        chat: interceptorChat,
        activeMemories,
        activeState: store.last_active_state,
    });
    lastSettingSeedDebug = { scope: 'generation', from_memories: settings.setting_query_seed_from_memories !== false, memory_seed_count: activeMemories.length, at: Date.now() };
    const retrieval = await retrievePluginSettings(ctx, query, { mode: 'generation' });
    // Role-private setting visibility: the active character only receives entries whose explicit
    // audience includes them. Baseline write dedup still uses the full objective snapshot.
    const visible = filterSettingRowsForActor(retrieval, deriveActorIdentity(ctx, store));
    lastGenerationSettingRetrieval = visible;
    return visible;
}

async function retrieveExtractionSettings(ctx, pair, storeInput, prepared = null) {
    const settings = getSettings(ctx);
    const store = normalizeStore(storeInput || getStore(ctx));
    const pairSeed = `${pair?.userText || ''}
${pair?.assistantText || ''}`;
    const activeMemories = settings.setting_query_seed_from_memories === false
        ? []
        : getActiveMemories(store, pairSeed, Math.max(settings.max_active_items, 18));
    const query = buildExtractionSettingQuery({
        userText: pair?.userText || '',
        assistantText: pair?.assistantText || '',
        activeMemories,
        currentState: store.last_active_state,
    });
    lastSettingSeedDebug = { scope: 'extraction', from_memories: settings.setting_query_seed_from_memories !== false, memory_seed_count: activeMemories.length, at: Date.now() };
    const retrieval = await retrievePluginSettings(ctx, query, {
        mode: 'extraction',
        prepared,
        topEntries: settings.setting_retrieval_final_count,
        maxChars: settings.setting_extraction_max_chars,
    });
    // Keep role-private entries out of the extraction prompt as well; the extractor must not turn
    // a world secret into "the active character already knows it". Dedup still sees the full index.
    return filterSettingRowsForActor(retrieval, deriveActorIdentity(ctx, store));
}

function createPluginBaselineDeduper(ctx, preparedSettingIndex) {
    const settings = getSettings(ctx);
    const prepared = preparedSettingIndex || buildSettingIndexSnapshot(getSettingStore(ctx), { maxChars: settings.setting_index_chunk_chars });
    const records = settingChunksToBaselineRecords(prepared);
    return {
        snapshot: prepared,
        records,
        async findPossibleMatches(candidateOperation) {
            if (settings.setting_baseline_veto_enabled === false) {
                return { blocked: false, reason: 'setting-veto-disabled', source: 'plugin_setting', records, semanticMatches: [] };
            }
            if (!settings.semantic_baseline_gate || !isBaselineGateEligible(candidateOperation) || !records.length) {
                return { blocked: false, reason: 'ineligible-or-empty', source: 'plugin_setting', records, semanticMatches: [] };
            }
            let decision = evaluateBaselineDuplicate(candidateOperation, records, {
                lexicalThreshold: settings.baseline_lexical_threshold,
                semanticThreshold: settings.baseline_similarity_threshold,
                semanticLexicalFloor: settings.baseline_semantic_lexical_floor,
            });
            let semanticMatches = [];
            if (!decision.blocked && prepared.vectorReady && prepared.collection_id && prepared.provider?.supported) {
                try {
                    const response = await withVectorLock(() => vectorQuery(
                        ctx,
                        prepared.provider,
                        prepared.collection_id,
                        String(candidateOperation.text || ''),
                        6,
                        Math.max(0, Math.min(1, Number(settings.baseline_similarity_threshold) || 0.84)),
                    ));
                    const denseRows = mapDenseSettingMetadata(prepared, response?.metadata || []);
                    const recordByChunkId = new Map(records.map((record, index) => [prepared.chunks[index]?.chunk_id, record]));
                    semanticMatches = denseRows.map(row => ({
                        record: recordByChunkId.get(row.chunk.chunk_id),
                        score: Number.isFinite(Number(row.score)) ? Number(row.score) : settings.baseline_similarity_threshold,
                    })).filter(row => row.record);
                    decision = evaluateBaselineDuplicate(candidateOperation, records, {
                        lexicalThreshold: settings.baseline_lexical_threshold,
                        semanticMatches,
                        semanticThreshold: settings.baseline_similarity_threshold,
                        semanticLexicalFloor: settings.baseline_semantic_lexical_floor,
                    });
                } catch (error) {
                    log('plugin setting baseline semantic query failed', error);
                }
            }
            return { ...decision, source: 'plugin_setting', records, semanticMatches };
        },
    };
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
        const pendingHashes = new Map();
        for (const id of idsToSync) {
            const memory = store.memories[id];
            if (!memory) continue;
            const oldHash = memory.vector_hash == null ? null : Number(memory.vector_hash);
            if (!shouldIndexMemory(memory) || !isMemorySettled(memory, ctx.chat?.length || 0, settings.vector_settle_messages)) {
                if (Number.isFinite(oldHash)) deleteHashes.push(oldHash);
                pendingHashes.set(id, null);
                continue;
            }
            const newHash = computeVectorHash(memory);
            if (Number.isFinite(oldHash) && oldHash !== newHash) deleteHashes.push(oldHash);
            if (!Number.isFinite(oldHash) || oldHash !== newHash) {
                insertItems.push({ hash: newHash, text: buildRetrievalText(memory), index: insertIndex++ });
            }
            pendingHashes.set(id, newHash);
        }
        // Vectors must land before the local hash pointers move: on transport failure we keep the
        // previous hashes so the same memories are retried instead of being treated as indexed.
        await withVectorLock(async () => {
            await vectorInsert(ctx, provider, collectionId, insertItems);
            await vectorDelete(ctx, provider, collectionId, deleteHashes);
        });
        for (const [id, hash] of pendingHashes) {
            const memory = store.memories[id];
            if (memory) memory.vector_hash = hash;
        }
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

/**
 * Recall prefetch.
 *
 * Recall used to start inside the generate interceptor, so prompt assembly waited for the full dense
 * round-trip. The host fires its message events well before the next user turn, which is free time.
 *
 * The prefetch deliberately does NOT commit: recalled_count, last_recalled_message and the recall
 * cooldown are all mutated by a recall, and committing at prefetch time would bump counters for a
 * generation that may never happen and would eat the next turn's cooldown. It computes the ranking and
 * parks it; the interceptor commits it only when a generation actually consumes it. A stale prefetch
 * is simply discarded and the live path runs.
 */
let recallPrefetch = null;
let pendingRecallCommit = null;

export function recallSignature(ctx, chat) {
    const rows = Array.isArray(chat) ? chat : [];
    const last = rows[rows.length - 1] || {};
    return [getChatIdentity(ctx) || '', rows.length, String(last.mes ?? '').length, String(last.swipe_id ?? last.swipeId ?? '')].join('|');
}

export function startRecallPrefetch(ctx = getContext()) {
    const settings = getSettings(ctx);
    if (!settings.vector_recall) return false;
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    if (!chat.length) return false;
    const signature = recallSignature(ctx, chat);
    if (recallPrefetch && recallPrefetch.signature === signature) return true;
    const startedAt = Date.now();
    const promise = recallMemories(ctx, chat, { commit: false, startedAt })
        .then(rows => ({ rows, ms: Date.now() - startedAt }))
        .catch(error => {
            // A failed prefetch is not fatal: the interceptor falls back to a live recall. It must
            // still be visible, or a permanently broken prefetch path would look like a cache miss.
            lastRecallPrefetchError = String(error?.message || error).slice(0, 200);
            log('recall prefetch failed', error);
            return { rows: [], ms: Date.now() - startedAt };
        });
    recallPrefetch = { signature, promise, startedAt, chatId: getChatIdentity(ctx) };
    lastRecallPrefetchError = null;
    return true;
}

export function recallPrefetchStatus() {
    return {
        armed: Boolean(recallPrefetch),
        signature: recallPrefetch?.signature || null,
        // How many candidates are parked and not yet committed. The store is untouched until the
        // interceptor commits them.
        parked: pendingRecallCommit ? pendingRecallCommit.ids.length : 0,
        last_lead_ms: lastRecallPrefetchLeadMs,
        last_error: lastRecallPrefetchError,
    };
}

let lastRecallPrefetchLeadMs = null;
let lastRecallPrefetchError = null;

/** Consume a parked prefetch for this exact chat state, committing it as the real recall. */
export function commitPrefetchedRecall(ctx, signature) {
    if (!pendingRecallCommit || pendingRecallCommit.signature !== signature) return null;
    const parked = pendingRecallCommit;
    pendingRecallCommit = null;
    const store = getStore(ctx);
    const rows = parked.ids.map(id => ({ memory: store.memories?.[id] })).filter(row => row.memory);
    if (!rows.length) return null;
    for (const row of rows) {
        row.memory.recalled_count = Number(row.memory.recalled_count || 0) + 1;
        row.memory.last_recalled_message = parked.currentMessage;
    }
    lastRecallPrefetchLeadMs = Date.now() - parked.startedAt;
    store.last_recall_debug = {
        ...(parked.debug || {}),
        prefetched: true,
        prefetch_lead_ms: lastRecallPrefetchLeadMs,
    };
    if (rows.length || getSettings(ctx).debug) setStore(ctx, store);
    return rows;
}

/** Cheap preparation that has nothing to do with a specific query. */
export async function warmupRecallRuntime(ctx = getContext()) {
    const started = Date.now();
    const out = { credential: false, provider: null, ms: 0 };
    try {
        const mod = await import('./v55-tauri-vector-backend.js');
        if (typeof mod.ensureTauriVectorApiKeyLoaded === 'function') out.credential = await mod.ensureTauriVectorApiKeyLoaded();
    } catch { /* not a Tauri host */ }
    try {
        const provider = getVectorProvider(ctx);
        out.provider = { supported: Boolean(provider.supported), source: provider.source || null };
    } catch { /* provider probing must never break warmup */ }
    out.ms = Date.now() - started;
    return out;
}

async function recallMemories(ctx, interceptorChat, { commit = true, startedAt = 0 } = {}) {
    const settings = getSettings(ctx);
    if (!settings.vector_recall) return [];
    const variants = buildQueryVariants(interceptorChat, settings.query_messages);
    if (!variants.length) return [];
    const store = getStore(ctx);
    const { provider, fingerprintChanged } = getProviderStatus(ctx, store);
    const collectionId = getCollectionId(ctx);
    let denseAvailable = Boolean(
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
            try {
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
                        const dense = filterRecalledMemories(store, result.metadata, {
                            finalCount: Math.max(1, Number(settings.candidate_top_k) || 18),
                            protectRecent: settings.protect_recent_messages,
                            chatLength: ctx.chat?.length || 0,
                        });
                        denseLists.push(dense);
                        denseDebug.push({ name: variant.name, count: dense.length, ids: dense.map(m => m.id) });
                    }
                });
            } catch (error) {
                // A failed dense query must not fail the whole recall; lexical retrieval and the
                // Dense Gate semantics both depend on knowing dense is genuinely unavailable.
                denseAvailable = false;
                denseDebug.push({ error: String(error?.message || error) });
                store.vector.last_error = String(error?.message || error);
            }
        }

        const lexicalQuery = variants.find(v => v.name === 'context')?.text || variants[0].text;
        const lexical = settings.hybrid_recall
            ? lexicalSearchMemories(store, lexicalQuery, {
                limit: settings.lexical_candidate_top_k,
                protectRecent: settings.protect_recent_messages,
                chatLength: ctx.chat?.length || 0,
            })
            : [];
        // Third recall channel: effective-time window / scope precision, independent of similarity.
        const structured = settings.temporal_channel_enabled === false ? [] : selectTemporalCandidates(store, {
            asOfIndex: ctx.chat?.length || 0,
            limit: settings.temporal_channel_limit,
            protectRecent: settings.protect_recent_messages,
            chatLength: ctx.chat?.length || 0,
        });

        // If no Dense backend is available, lexical becomes an intentional fallback and is not gated.
        // If Dense is available, lexical-only candidates need semantic agreement, except exact entity matches.
        let fused = fuseHybridCandidates(store, denseLists, lexical, {
            rrfK: settings.rrf_k,
            denseWeights: variants.map(v => v.weight),
            lexicalWeight: settings.lexical_weight,
            denseGate: denseAvailable,
            structuredLists: structured.length ? [structured] : [],
            currentMessage: ctx.chat?.length || 0,
            cooldownTurns: settings.recall_cooldown_turns,
        });
        const fusedBeforeGraph = fused.map(r => ({ id: r.memory.id, score: r.score, channels: r.channels, entityBypass: r.entityBypass }));
        if (settings.graph_diffusion) {
            fused = graphDiffuseCandidates(store, fused, { damping: settings.graph_damping, iterations: 5 });
        }
        // Fusion scores channels; it never reads the query against the candidate. This stage does, and
        // it runs before diversity selection so a query-matching candidate is not dropped first.
        let rerankDebug = null;
        if (settings.rerank_enabled !== false && fused.length > 1) {
            const outcome = rerankCandidates(fused, lexicalQuery, {
                weight: Number(settings.rerank_weight) || 0.55,
                currentMessage: ctx.chat?.length || 0,
                halfLifeTurns: Number(settings.rerank_half_life_turns) || 120,
                maxPool: Math.max(30, (Number(settings.final_recall_count) || 6) * 5),
            });
            fused = outcome.rows;
            rerankDebug = outcome.debug;
        }
        const selected = diversifyCandidates(fused, {
            finalCount: settings.final_recall_count,
            lambda: settings.mmr_lambda,
        });
        const currentMessage = ctx.chat?.length || 0;
        const elapsed = (performance.now?.() ?? Date.now()) - started;
        const recallDebug = {
            at_message: currentMessage,
            elapsed_ms: Math.round(elapsed * 10) / 10,
            dense_available: denseAvailable,
            dense_reason: denseAvailable ? null : (fingerprintChanged ? 'provider fingerprint changed' : (!provider.supported ? provider.reason : (store.vector.stale ? 'vector index stale' : 'no usable collection/index'))),
            query_variants: variants.map(v => ({ name: v.name, weight: v.weight, chars: v.text.length })),
            dense: denseDebug,
            lexical: lexical.slice(0, 20).map(x => ({ id: x.memory.id, score: Math.round(x.score * 1000) / 1000, entityMatches: x.entityMatches })),
            fused: fusedBeforeGraph.slice(0, 24),
            structured: structured.map(x => ({ id: x.memory.id, score: Math.round(x.score * 1000) / 1000, reason: x.reason })),
            graph_top: fused.slice(0, 20).map(x => ({ id: x.memory.id, score: x.score, graphScore: x.graphScore ?? null })),
            rerank: rerankDebug,
            selected: selected.map(x => ({ id: x.memory.id, score: x.score, mmrScore: x.mmrScore ?? null })),
        };
        if (!commit) {
            // Park the ranking without touching counters, cooldowns or the store.
            pendingRecallCommit = {
                chatId: getChatIdentity(ctx),
                signature: recallSignature(ctx, ctx.chat),
                ids: selected.map(x => x.memory.id),
                currentMessage,
                debug: recallDebug,
                startedAt: startedAt || Date.now(),
            };
            return selected;
        }
        for (const row of selected) {
            const memory = row.memory;
            memory.recalled_count = Number(memory.recalled_count || 0) + 1;
            memory.last_recalled_message = currentMessage;
        }
        store.last_recall_debug = recallDebug;
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

async function buildInjectedContextBundle(interceptorChat, contextSize = null) {
    const ctx = getContext();
    if (!ctx) return { referenceBlock: '', currentStateBlock: '', diagnostics: {} };
    const settings = getSettings(ctx);
    if (!settings.enabled) return { referenceBlock: '', currentStateBlock: '', diagnostics: {} };

    await waitForExtractionFreshness(ctx);
    await operationQueue;
    const store = getStore(ctx);
    const queryText = buildQueryText(interceptorChat, settings.query_messages);
    const currentStateScope = resolveCurrentStateScope(settings);
    const baseActive = settings.inject_current_state && currentStateScope === 'mandatory+broad'
        ? getActiveMemories(store, queryText, settings.max_active_items)
        : [];
    // S4: the mandatory baseline is unioned in before assembly and marked, so the budget trim inside
    // the assembler can never remove an irreversible change.
    const mandatory = settings.inject_current_state && settings.mandatory_baseline_enabled !== false
        ? getMandatoryMemories(store, settings.mandatory_baseline_limit ?? 24)
        : [];
    const mandatoryIds = new Set(mandatory.map(memory => memory.id));
    // The rows are the state carrier now, so they must span everything the flat canonical summary used
    // to carry: every live memory, in the canonical order. Handing them a query-scoped slice is what
    // made the old block render the state twice - summary plus the subset that fit - and that subset is
    // also why trimming the summary once dropped coverage from 10/10 to 8/10. `baseActive` is still
    // computed because its size is the diagnostic for how much recall would have chosen on its own.
    const activeMemories = !settings.inject_current_state
        ? []
        : currentStateScope === 'mandatory-only'
            ? mandatory
            : orderCanonicalMemories(store);
    const settingResults = await retrieveGenerationSettings(ctx, interceptorChat, store);
    // Prefer the ranking the host's message events already computed. It is committed here, so the
    // recall counters and the cooldown only ever move for a generation that really happened.
    const signature = recallSignature(ctx, interceptorChat);
    const recalledMemories = commitPrefetchedRecall(ctx, signature) ?? await recallMemories(ctx, interceptorChat);
    const bundle = assembleGenerationContext({
        scope: settingResults?.snapshot?.scope || null,
        latestMessages: interceptorChat,
        activeMemories,
        mandatoryIds,
        settingResults,
        historyResults: recalledMemories,
        hostContextBudget: contextSize,
        replyReserve: settings.context_reply_reserve_tokens,
        maxReferenceChars: settings.reference_context_max_chars,
        maxCurrentStateChars: settings.current_state_context_max_chars,
        includeEvidence: settings.include_evidence,
        constantLimit: settings.setting_retrieval_constant_limit,
    });
    // S1/S2: the change chain rides with the current-state block. It is appended after assembly so a
    // tail trim removes it before it can remove the mandatory rows that were rendered first.
    if (settings.spine_injection_enabled !== false && bundle.currentStateBlock !== undefined) {
        const spineBlock = spinePromptBlock(store, {
            maxChars: settings.spine_injection_max_chars ?? 600,
            maxRows: settings.spine_injection_max_rows ?? 8,
        });
        if (spineBlock) {
            bundle.currentStateBlock = bundle.currentStateBlock
                ? bundle.currentStateBlock + '\n\n' + spineBlock
                : spineBlock;
            bundle.diagnostics.spineChars = spineBlock.length;
        }
    }
    lastGenerationContextDiagnostics = {
        ...bundle.diagnostics,
        spine: spineStats(store),
        mandatory_ids: [...mandatoryIds],
        current_state_scope: currentStateScope,
        broad_active_count: baseActive.length,
        at: Date.now(),
        reference_prompt_key: REFERENCE_PROMPT_KEY,
        current_state_prompt_key: CURRENT_STATE_PROMPT_KEY,
        reference_depth: normalizeDepth(settings.injection_depth, DEFAULT_SETTINGS.injection_depth),
        current_state_depth: normalizeDepth(settings.current_state_injection_depth, DEFAULT_SETTINGS.current_state_injection_depth),
    };
    // The outer layers used to capture this write by swapping ctx.setExtensionPrompt on the context
    // they were handed. That cannot work on a real host: getContext() returns a fresh object each
    // call, so the swap mutated a throwaway and this module wrote through the real host function.
    // v55-consistency then overwrote the block using position/depth from an empty capture, and
    // Number(undefined) is NaN, which SillyTavern silently drops because it matches no position type.
    // Publishing the bundle is how the outer layers now get the text they are responsible for.
    const publishTarget = ctx.chatMetadata?.[METADATA_KEY];
    if (publishTarget && typeof publishTarget === 'object') {
        publishTarget.v55_inner_bundle = {
            reference_block: String(bundle.referenceBlock || ''),
            current_state_block: String(bundle.currentStateBlock || ''),
            reference_position: IN_CHAT,
            reference_depth: normalizeDepth(settings.injection_depth, DEFAULT_SETTINGS.injection_depth),
            current_state_position: IN_CHAT,
            current_state_depth: normalizeDepth(settings.current_state_injection_depth, DEFAULT_SETTINGS.current_state_injection_depth),
            at: Date.now(),
        };
    }
    return bundle;
}

function clearInjectedPrompts(ctx, settings, { includeLegacy = true } = {}) {
    const referenceDepth = normalizeDepth(settings.injection_depth, DEFAULT_SETTINGS.injection_depth);
    const currentDepth = normalizeDepth(settings.current_state_injection_depth, DEFAULT_SETTINGS.current_state_injection_depth);
    if (includeLegacy) ctx.setExtensionPrompt(LEGACY_PROMPT_KEY, '', IN_CHAT, referenceDepth, false, SYSTEM_ROLE);
    ctx.setExtensionPrompt(REFERENCE_PROMPT_KEY, '', IN_CHAT, referenceDepth, false, SYSTEM_ROLE);
    ctx.setExtensionPrompt(CURRENT_STATE_PROMPT_KEY, '', IN_CHAT, currentDepth, false, SYSTEM_ROLE);
}

function applyInjectedContextBundle(ctx, settings, bundle) {
    const referenceDepth = normalizeDepth(settings.injection_depth, DEFAULT_SETTINGS.injection_depth);
    const currentDepth = normalizeDepth(settings.current_state_injection_depth, DEFAULT_SETTINGS.current_state_injection_depth);
    ctx.setExtensionPrompt(REFERENCE_PROMPT_KEY, bundle?.referenceBlock || '', IN_CHAT, referenceDepth, false, SYSTEM_ROLE);
    ctx.setExtensionPrompt(CURRENT_STATE_PROMPT_KEY, bundle?.currentStateBlock || '', IN_CHAT, currentDepth, false, SYSTEM_ROLE);
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
        clearInjectedPrompts(ctx, settings);
        lastGenerationContextDiagnostics = null;
        return;
    }
    if (type === 'impersonate' || type === 'quiet') {
        const pluginOwnedQuiet = settings.__quiet_extraction_in_progress === true;
        const thirdPartyQuietInjection = type === 'quiet' && settings.quiet_allow_third_party_injection === true && !pluginOwnedQuiet;
        if (!thirdPartyQuietInjection) {
            clearInjectedPrompts(ctx, settings);
            return;
        }
    }
    // Derived chat state (cold snapshots, scene locators, diagnostics) now lives outside the chat
    // file, and prompt assembly is the one place that must see it. Bounded so a slow backend can
    // never stall a generation.
    await awaitDerivedReady(ctx, settings.derived_hydration_budget_ms ?? 1500);
    const bundle = await buildInjectedContextBundle(chat, _contextSize);
    // The interceptor never splices or appends fake chat messages. Both blocks are host
    // extension prompts with distinct keys and depths.
    applyInjectedContextBundle(ctx, settings, bundle);
    const removed = settings.manage_context_window ? trimPromptHistory(chat, settings.keep_recent_messages) : 0;
    log('interceptor injected context bundle', {
        type,
        referenceChars: bundle.referenceBlock.length,
        currentStateChars: bundle.currentStateBlock.length,
        referenceDepth: normalizeDepth(settings.injection_depth, DEFAULT_SETTINGS.injection_depth),
        currentStateDepth: normalizeDepth(settings.current_state_injection_depth, DEFAULT_SETTINGS.current_state_injection_depth),
        trimmedMessages: removed,
    });
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
    const settingStore = getSettingStore(ctx);
    const settingWorld = settingStore.active_world_id ? settingStore.worlds[settingStore.active_world_id] : null;
    const activeSettingRevisionIds = settingWorld
        ? [settingWorld.active_baseline_revision_id, ...settingWorld.active_extension_revision_ids].filter(Boolean)
        : [];
    const activeSettingEntries = Object.values(settingStore.entries).filter(entry => activeSettingRevisionIds.includes(entry.revision_id) && !entry.disabled).length;
    const settingSnapshot = buildSettingIndexSnapshot(settingStore, { maxChars: getSettings(ctx).setting_index_chunk_chars });
    const settingIndexState = getSettingIndexState(ctx);
    const settingIndexRow = settingSnapshot.scope.scope_key ? settingIndexState.scopes[settingSnapshot.scope.scope_key] : null;
    const currentSettingProfileHash = getSettingProfileHash(provider);
    const currentSettingProfile = settingIndexRow?.profiles?.[currentSettingProfileHash] || null;
    const currentSettingVectorReady = Boolean(
        currentSettingProfile?.ready
        && currentSettingProfile?.stale === false
        && currentSettingProfile?.provider_fingerprint === provider.fingerprint
        && currentSettingProfile?.fingerprint === settingSnapshot.fingerprint
        && currentSettingProfile?.collection_id
    );
    const settingVectorState = !settingWorld
        ? '未导入'
        : !getSettings(ctx).setting_index_use_vector
            ? '词法就绪/向量关闭'
            : !provider.supported
                ? '词法就绪/向量不可用（已有集合保留）'
                : currentSettingVectorReady
                    ? `词法+向量已同步 [${currentSettingProfileHash}]${currentSettingProfile.cleanup_pending_hashes?.length ? ` / 待清理${currentSettingProfile.cleanup_pending_hashes.length}` : ''}`
                    : `词法就绪/向量降级 [${currentSettingProfileHash}]${settingIndexRow?.last_error ? `（${settingIndexRow.last_error}）` : ''}`;
    const settingState = settingWorld
        ? `${settingWorld.name} / ${activeSettingEntries} entries / ${settingSnapshot.chunk_count} chunks / ${settingVectorState}`
        : '未导入';
    const baselineState = !getSettings(ctx).semantic_baseline_gate
        ? '关闭'
        : store.baseline?.vector?.stale
            ? `词法可用/向量待重建${store.baseline?.vector?.last_error ? `（${store.baseline.vector.last_error}）` : ''}`
            : `已就绪 ${Number(store.baseline?.record_count || 0)}块`;
    el.textContent = `Provider: ${provider.source} ｜ 记忆 ${memories.length} ｜ 抽取 ${extractionCount} ｜ Active slots ${activeSlots} ｜ 可向量化 ${indexable} ｜ Memory Vector ${vectorState} ｜ Host Baseline ${baselineState} ｜ Plugin Setting ${settingState} ｜ 后台任务 ${extractionPending}`;
    const diagnostics = document.getElementById('aum-v54-diagnostics');
    if (diagnostics) {
        const errors = (store.last_errors || []).slice(-6).join('\n');
        const extraction = store.last_extraction_debug ? `\n\n[Extraction] ${JSON.stringify(store.last_extraction_debug, null, 2)}` : '';
        const baseline = store.baseline ? `\n\n[Baseline] ${JSON.stringify({ fingerprint: store.baseline.fingerprint, record_count: store.baseline.record_count, source_count: store.baseline.source_count, source_labels: store.baseline.source_labels, vector: store.baseline.vector, last_gate_debug: store.baseline.last_gate_debug }, null, 2)}` : '';
        const settingIndex = settingSnapshot.scope.world_id ? `\n\n[SettingIndex] ${JSON.stringify({ ...summarizeSettingSnapshot(settingSnapshot), current_embedding_profile_hash: currentSettingProfileHash, current_profile_ready: currentSettingVectorReady, state: settingIndexRow || null }, null, 2)}` : '';
        const settingRetrieval = lastSettingRetrievalDebug ? `\n\n[SettingRetrieval] ${JSON.stringify(lastSettingRetrievalDebug, null, 2)}` : '';
        const contextAssembler = lastGenerationContextDiagnostics ? `\n\n[ContextAssembler] ${JSON.stringify(lastGenerationContextDiagnostics, null, 2)}` : '';
        const recall = store.last_recall_debug ? `\n\n[Recall] ${JSON.stringify(store.last_recall_debug, null, 2)}` : '';
        diagnostics.textContent = (errors || '无记忆诊断。') + extraction + baseline + settingIndex + settingRetrieval + contextAssembler + recall;
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
        if (key === 'enabled' && !settings[key]) {
            clearInjectedPrompts(ctx, settings);
            lastGenerationContextDiagnostics = null;
        }
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

function filenameStem(filename) {
    const name = String(filename || '').replace(/\\/g, '/').split('/').pop() || '';
    return name.replace(/\.[^.]+$/, '').trim();
}

function replaceSelectOptions(select, rows, preferredValue = null) {
    if (!select) return;
    const previous = preferredValue ?? select.value;
    select.replaceChildren();
    for (const row of rows) {
        const option = document.createElement('option');
        option.value = String(row.value);
        option.textContent = String(row.label);
        select.appendChild(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function refreshSettingStoreControls(ctx, { preserveWorld = true } = {}) {
    const store = getSettingStore(ctx);
    const worldSelect = document.getElementById('aum-v54-setting-world');
    const baseSelect = document.getElementById('aum-v54-setting-base-revision');
    const kindSelect = document.getElementById('aum-v54-setting-revision-kind');
    const newWorldInput = document.getElementById('aum-v54-setting-world-name');
    const selectedBefore = preserveWorld ? worldSelect?.value : null;
    const worlds = listWorlds(store);
    const preferred = selectedBefore || store.active_world_id || '__new__';
    replaceSelectOptions(worldSelect, [
        { value: '__new__', label: '＋ 新建世界' },
        ...worlds.map(world => ({
            value: world.world_id,
            label: `${world.name} (${world.world_id})`,
        })),
    ], preferred);

    const selectedWorldId = worldSelect?.value && worldSelect.value !== '__new__' ? worldSelect.value : null;
    const baselines = selectedWorldId
        ? listRevisionsForWorld(store, selectedWorldId).filter(row => row.revision_kind === 'baseline')
        : [];
    const activeBaselineId = selectedWorldId ? store.worlds[selectedWorldId]?.active_baseline_revision_id : null;
    replaceSelectOptions(baseSelect, [
        { value: '', label: baselines.length ? '选择 Baseline…' : '无可用 Baseline' },
        ...baselines.map(revision => ({
            value: revision.revision_id,
            label: `${revision.revision_label} (${revision.revision_id})`,
        })),
    ], activeBaselineId || '');

    const isExtension = kindSelect?.value === 'extension';
    if (baseSelect) baseSelect.disabled = !isExtension || !selectedWorldId || baselines.length === 0;
    if (newWorldInput) newWorldInput.disabled = Boolean(selectedWorldId);
}

function renderSettingImportPreview(preview) {
    const output = document.getElementById('aum-v54-setting-preview-output');
    const commit = document.getElementById('aum-v54-setting-commit');
    if (!output || !commit) return;
    if (!preview) {
        output.textContent = '尚未选择导入文件。';
        commit.disabled = true;
        return;
    }
    const lines = [
        `文件：${preview.filename || '未命名来源'}`,
        `格式：${preview.format}`,
        `条目：${preview.entries.length}（constant ${preview.metadata?.constant_count || 0} / disabled ${preview.metadata?.disabled_count || 0}）`,
        `Content hash：${preview.content_hash}`,
    ];
    if (preview.duplicate_source_ids?.length) lines.push(`检测到相同 Source：${preview.duplicate_source_ids.join(', ')}`);
    if (preview.warnings?.length) lines.push(`警告：${preview.warnings.join('；')}`);
    const sample = preview.entries.slice(0, 6).map((entry, index) => `${index + 1}. ${entry.title || entry.comment || entry.source_entry_id || '未命名条目'}`);
    if (sample.length) lines.push(`预览：${sample.join(' ｜ ')}${preview.entries.length > sample.length ? ' …' : ''}`);
    output.textContent = lines.join('\n');
    commit.disabled = false;
}

async function commitSettingImportToContext(ctx, preview, options = {}) {
    const result = await commitImport(getSettingStore(ctx), preview, options);
    setSettingStore(ctx, result.store);
    scheduleStatusUpdate();
    return result;
}

function bindSettingImportUi(ctx) {
    const fileInput = document.getElementById('aum-v54-setting-file');
    const previewButton = document.getElementById('aum-v54-setting-preview');
    const commitButton = document.getElementById('aum-v54-setting-commit');
    const worldSelect = document.getElementById('aum-v54-setting-world');
    const worldName = document.getElementById('aum-v54-setting-world-name');
    const revisionLabel = document.getElementById('aum-v54-setting-revision-label');
    const revisionKind = document.getElementById('aum-v54-setting-revision-kind');
    const baseRevision = document.getElementById('aum-v54-setting-base-revision');
    const activate = document.getElementById('aum-v54-setting-activate');

    refreshSettingStoreControls(ctx, { preserveWorld: false });
    renderSettingImportPreview(pendingSettingImportPreview);

    worldSelect?.addEventListener('change', () => refreshSettingStoreControls(ctx));
    revisionKind?.addEventListener('change', () => refreshSettingStoreControls(ctx));

    previewButton?.addEventListener('click', () => {
        void (async () => {
            const file = fileInput?.files?.[0];
            if (!file) {
                notify('warning', '请先选择 JSON / TXT 文件。', '设定库导入');
                return;
            }
            try {
                previewButton.disabled = true;
                pendingSettingImportPreview = await previewImport(file, { store: getSettingStore(ctx) });
                renderSettingImportPreview(pendingSettingImportPreview);
                if (revisionLabel && !revisionLabel.value.trim()) revisionLabel.value = filenameStem(file.name) || 'Imported revision';
                if (worldName && !worldName.value.trim()) worldName.value = filenameStem(file.name) || 'Imported World';
                notify('success', `已解析 ${pendingSettingImportPreview.entries.length} 个条目；尚未写入。`, '设定库预览');
            } catch (error) {
                pendingSettingImportPreview = null;
                renderSettingImportPreview(null);
                notify('error', String(error?.message || error), '设定库预览失败');
            } finally {
                previewButton.disabled = false;
            }
        })();
    });

    commitButton?.addEventListener('click', () => {
        void (async () => {
            if (!pendingSettingImportPreview) return;
            const selectedWorld = worldSelect?.value || '__new__';
            const targetWorldId = selectedWorld === '__new__' ? null : selectedWorld;
            const kind = revisionKind?.value === 'extension' ? 'extension' : 'baseline';
            if (!targetWorldId && kind === 'extension') {
                notify('error', 'Extension 必须导入到已有世界并显式绑定一个 Baseline。', '设定库导入');
                return;
            }
            if (kind === 'extension' && !baseRevision?.value) {
                notify('error', '请选择 Extension 要绑定的 Baseline revision。', '设定库导入');
                return;
            }
            try {
                commitButton.disabled = true;
                const currentStore = getSettingStore(ctx);
                const duplicates = targetWorldId
                    ? findDuplicateSources(currentStore, pendingSettingImportPreview.content_hash, { world_id: targetWorldId })
                    : [];
                let duplicatePolicy = 'reject';
                if (duplicates.length) {
                    const reuse = confirm(`目标世界中已经存在完全相同的 Source：${duplicates.map(row => row.source_id).join(', ')}。\n\n是否复用该 Source 并显式创建另一个 Revision？`);
                    if (!reuse) return;
                    duplicatePolicy = 'reuse_source';
                }
                const result = await commitSettingImportToContext(ctx, pendingSettingImportPreview, {
                    world_id: targetWorldId,
                    world_name: worldName?.value || null,
                    revision_label: revisionLabel?.value || null,
                    revision_kind: kind,
                    base_revision_id: kind === 'extension' ? baseRevision?.value : null,
                    activate: activate?.checked !== false,
                    duplicate_policy: duplicatePolicy,
                });
                pendingSettingImportPreview = null;
                if (fileInput) fileInput.value = '';
                renderSettingImportPreview(null);
                refreshSettingStoreControls(ctx, { preserveWorld: false });
                if (worldSelect) worldSelect.value = result.world.world_id;
                refreshSettingStoreControls(ctx);
                scheduleStatusUpdate();
                if (activate?.checked !== false) {
                    void enqueue(async () => {
                        await ensurePluginSettingIndex(ctx, { silent: true });
                        scheduleStatusUpdate();
                    });
                }
                notify('success', `已写入 ${result.entries.length} 个条目：${result.world.name} / ${result.revision.revision_label}`, '设定库导入');
            } catch (error) {
                notify('error', String(error?.message || error), '设定库导入失败');
            } finally {
                commitButton.disabled = pendingSettingImportPreview === null;
            }
        })();
    });

    document.getElementById('aum-v54-setting-export')?.addEventListener('click', () => {
        downloadJson(`aetheria-setting-store-${Date.now()}.json`, getSettingStore(ctx));
    });
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
    // Iteration 13 controls: cold snapshot, temporal channel, metering, batching, evidence budget.
    bindCheckbox('aum-v54-cold-snapshot', 'cold_turn_snapshot_enabled');
    bindCheckbox('aum-v54-evidence-enabled', 'memory_evidence_enabled');
    bindCheckbox('aum-v54-temporal-channel', 'temporal_channel_enabled');
    bindCheckbox('aum-v54-metrics', 'metrics_enabled');
    bindNumber('aum-v54-extract-batch', 'extraction_batch_turns', { min: 1, max: 10, integer: true });
    bindNumber('aum-v54-evidence-chars', 'memory_evidence_max_chars', { min: 400, max: 8000, integer: true });
    const selfCheckOutput = document.getElementById('aum-v54-selfcheck');
    const writeSelfCheck = text => { if (selfCheckOutput) selfCheckOutput.textContent = String(text ?? ''); };
    document.getElementById('aum-v54-run-selfcheck')?.addEventListener('click', () => {
        const report = runRetrievalSelfCheck();
        getSettings(ctx).selfcheck_last = { passed: report.passed, total: report.total, ok: report.ok, at: Date.now() };
        ctx.saveSettingsDebounced?.();
        writeSelfCheck(formatSelfCheck(report));
    });
    document.getElementById('aum-v54-show-metrics')?.addEventListener('click', () => writeSelfCheck(formatMetrics(ctx)));
    document.getElementById('aum-v54-reset-metrics')?.addEventListener('click', () => { resetMetrics(ctx); writeSelfCheck(formatMetrics(ctx)); });
    document.getElementById('aum-v54-purge-collections')?.addEventListener('click', async () => {
        const purged = await purgeAllAetheriaCollections(ctx);
        writeSelfCheck(`已清理 ${purged.length} 个 Aetheria 向量集合。`);
    });
    bindSelect('aum-v54-source-mode', 'vector_source_mode');
    bindNumber('aum-v54-extract-context', 'extraction_context_messages', { min: 0, max: 12, integer: true });
    bindNumber('aum-v54-freshness-wait', 'memory_freshness_wait_ms', { min: 0, max: 5000, integer: true });
    bindNumber('aum-v54-baseline-lexical', 'baseline_lexical_threshold', { min: 0.4, max: 1 });
    bindNumber('aum-v54-baseline-semantic', 'baseline_similarity_threshold', { min: 0.5, max: 1 });
    bindNumber('aum-v54-baseline-semantic-floor', 'baseline_semantic_lexical_floor', { min: 0, max: 1 });
    bindNumber('aum-v54-baseline-chunk', 'baseline_chunk_chars', { min: 120, max: 1200, integer: true });
    bindCheckbox('aum-v54-quiet-third-party', 'quiet_allow_third_party_injection');
    bindCheckbox('aum-v54-setting-index-vector', 'setting_index_use_vector');
    bindCheckbox('aum-v54-setting-index-auto', 'setting_index_auto_rebuild');
    bindNumber('aum-v54-setting-index-chunk', 'setting_index_chunk_chars', { min: 120, max: 1200, integer: true });
    bindCheckbox('aum-v54-setting-retrieval-enabled', 'setting_retrieval_enabled');
    bindCheckbox('aum-v54-setting-retrieval-dense', 'setting_retrieval_use_dense');
    bindNumber('aum-v54-setting-retrieval-candidate-k', 'setting_retrieval_candidate_top_k', { min: 1, max: 80, integer: true });
    bindNumber('aum-v54-setting-retrieval-final', 'setting_retrieval_final_count', { min: 1, max: 30, integer: true });
    bindNumber('aum-v54-setting-retrieval-threshold', 'setting_retrieval_dense_threshold', { min: 0, max: 1 });
    bindNumber('aum-v54-setting-retrieval-rrf', 'setting_retrieval_rrf_k', { min: 1, max: 500, integer: true });
    bindNumber('aum-v54-setting-retrieval-budget', 'setting_retrieval_max_chars', { min: 1000, max: 50000, integer: true });
    bindNumber('aum-v54-setting-extraction-budget', 'setting_extraction_max_chars', { min: 1000, max: 30000, integer: true });
    bindNumber('aum-v54-setting-constant-limit', 'setting_retrieval_constant_limit', { min: 0, max: 20, integer: true });
    // Iteration 14 (architecture drift): the two directions of the setting<->memory coupling.
    bindCheckbox('aum-v54-setting-veto', 'setting_baseline_veto_enabled');
    bindCheckbox('aum-v54-setting-seed', 'setting_query_seed_from_memories');
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
    bindNumber('aum-v54-budget', 'reference_context_max_chars', { min: 1200, max: 60000, integer: true });
    bindNumber('aum-v54-current-state-budget', 'current_state_context_max_chars', { min: 800, max: 20000, integer: true });
    bindNumber('aum-v54-depth', 'injection_depth', { min: 0, max: 100, integer: true });
    bindNumber('aum-v54-current-state-depth', 'current_state_injection_depth', { min: 0, max: 100, integer: true });
    bindNumber('aum-v54-reply-reserve', 'context_reply_reserve_tokens', { min: 0, max: 32000, integer: true });
    bindNumber('aum-v54-max-active', 'max_active_items', { min: 0, max: 50, integer: true });
    bindSelect('aum-v54-current-state-scope', 'current_state_scope');
    bindNumber('aum-v54-protect-recent', 'protect_recent_messages', { min: 0, max: 100, integer: true });

    bindSettingImportUi(ctx);

    document.getElementById('aum-v54-rebuild-setting-index')?.addEventListener('click', () => {
        void enqueue(async () => {
            const current = getContext();
            if (!current) return;
            const result = await ensurePluginSettingIndex(current, { force: true, silent: false });
            notify('success', `Setting Index：${result.chunks.length} 个分块；词法 ${result.lexicalReady ? '可用' : '空'}；向量 ${result.vectorReady ? '已就绪' : '未就绪/已降级'}。`, 'Setting Index');
            scheduleStatusUpdate();
        });
    });

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
        void enqueue(async () => {
            await rebuildVectorIndex(ctx, { silent: false });
            await ensureSemanticBaseline(ctx, { force: true, silent: true });
            await ensurePluginSettingIndex(ctx, { force: true, silent: true });
        });
    });
    document.getElementById('aum-v54-rebuild-all')?.addEventListener('click', () => {
        void enqueue(async () => {
            await rebuildCanonicalFromChat(ctx, { rebuildVectors: true, silent: false });
            await ensureSemanticBaseline(ctx, { force: true, silent: true });
            await ensurePluginSettingIndex(ctx, { force: true, silent: true });
            notify('success', 'Canonical Memory、剧情向量、Host Baseline 与 Plugin Setting Index 已完整重建。');
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
    void warmupRecallRuntime(ctx);
}

function registerEvents() {
    const ctx = getContext();
    if (!ctx) return;
    const { eventSource, eventTypes } = ctx;

    // Streaming and non-streaming paths can emit different finalization events. The pair fingerprint
    // makes duplicate scheduling harmless.
    const onIf = (event, handler) => { if (event) eventSource.on(event, handler); };
    const afterAssistant = () => {
        scheduleLatestAssistantExtraction({ force: false });
        // Free time: the next turn's prompt is at least one user message away, so the dense
        // round-trip can start now and the interceptor then only has to commit the ranking.
        try { startRecallPrefetch(getContext()); } catch (error) { log('recall prefetch failed', error); }
    };
    onIf(eventTypes.MESSAGE_RECEIVED, afterAssistant);
    onIf(eventTypes.CHARACTER_MESSAGE_RENDERED, afterAssistant);
    // Warm the credential and provider path once per chat so the first real recall does not pay for it.
    onIf(eventTypes.CHAT_CHANGED, () => { void warmupRecallRuntime(getContext()); });

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
        clearInjectedPrompts(current, settings);
        lastGenerationContextDiagnostics = null;
        void enqueue(async () => {
            await reconcileCurrentChat(current, { forceRebuild: true });
            scheduleLatestAssistantExtraction({ force: false });
        });
        scheduleStatusUpdate();
    });

    // Deleted chats used to leave their per-chat memory/baseline vector collections behind.
    onIf(eventTypes.CHAT_DELETED, chatId => {
        void enqueue(async () => {
            const current = getContext();
            if (!current) return;
            const purged = await purgeChatVectorCollections(current, chatId);
            if (purged.length) log('purged vector collections for deleted chat', purged);
        });
    });
}

async function startup() {
    if (initialized) return;
    initialized = true;
    const ctx = getContext();
    if (!ctx) return;
    const settings = getSettings(ctx);
    getSettingStore(ctx);
    // In-place upgrade safety: the old single-block key must not coexist with Commit F prompts.
    ctx.setExtensionPrompt?.(LEGACY_PROMPT_KEY, '', IN_CHAT, normalizeDepth(settings.injection_depth, DEFAULT_SETTINGS.injection_depth), false, SYSTEM_ROLE);
    registerEvents();
    await setupUi();
    // v5.2/v5.1 canonical metadata migrates automatically; old inline <memory_ops> are replayed once.
    void enqueue(async () => {
        await reconcileCurrentChat(ctx, { forceRebuild: true });
        await ensureSemanticBaseline(ctx, { silent: true });
        await ensurePluginSettingIndex(ctx, { silent: true });
        scheduleLatestAssistantExtraction({ force: false });
    });
    scheduleStatusUpdate();
    console.log(`[Aetheria Memory v${MEMORY_VERSION}] autonomous plugin initialized`);
}

// Small explicit test hooks. They are not used by normal runtime, but make the autonomous
// extraction pipeline verifiable without depending on DOM event timing.
export function __testNormalizeDepth(value, fallback = DEFAULT_SETTINGS.injection_depth) {
    return normalizeDepth(value, fallback);
}

export async function __testExtractMemoryForAssistant(ctx, assistantIndex, options = {}) {
    return extractMemoryForAssistant(ctx, assistantIndex, options);
}

export async function __testBackfillMissingExtractions(ctx, options = {}) {
    return backfillMissingExtractions(ctx, options);
}

export function __testGetStore(ctx) {
    return getStore(ctx);
}

export function __testGetSettingStore(ctx, options = {}) {
    return getSettingStore(ctx, options);
}

export function __testSetSettingStore(ctx, store, options = {}) {
    return setSettingStore(ctx, store, options);
}

export async function __testPreviewSettingImport(input, options = {}) {
    return previewImport(input, options);
}

export async function __testCommitSettingImport(ctx, preview, options = {}) {
    return commitSettingImportToContext(ctx, preview, options);
}

export async function __testEnsurePluginSettingIndex(ctx, options = {}) {
    return ensurePluginSettingIndex(ctx, options);
}

export function __testSearchPluginSettingsLexical(ctx, query, options = {}) {
    return searchPluginSettingsLexical(ctx, query, options);
}

export function __testGetSettingIndexState(ctx) {
    return getSettingIndexState(ctx);
}

export async function __testRetrievePluginSettings(ctx, query, options = {}) {
    return retrievePluginSettings(ctx, query, options);
}

export async function __testRetrieveGenerationSettings(ctx, chat, store = null) {
    return retrieveGenerationSettings(ctx, chat, store);
}

export function __testGetLastSettingRetrievalDebug() {
    return lastSettingRetrievalDebug;
}

export function __testGetLastGenerationContextDiagnostics() {
    return lastGenerationContextDiagnostics;
}

export async function __testBuildInjectedContextBundle(chat, contextSize = null) {
    return buildInjectedContextBundle(chat, contextSize);
}

export function __testCreatePluginBaselineDeduper(ctx, prepared = null) {
    return createPluginBaselineDeduper(ctx, prepared);
}

export async function __testEnsureSemanticBaseline(ctx, options = {}) {
    return ensureSemanticBaseline(ctx, options);
}

export async function __testFilterOperationsAgainstBaseline(ctx, ops, prepared) {
    return filterOperationsAgainstBaseline(ctx, ops, prepared);
}

/**
 * The current-state block is a baseline wider than the mandatory set: it renders every active
 * memory, not only the irreversible ones. This resolves which of the two a run is using, so the
 * choice is a named policy rather than an implicit property of the assembly path.
 */
export function resolveCurrentStateScope(settings) {
    return settings?.current_state_scope === 'mandatory-only' ? 'mandatory-only' : 'mandatory+broad';
}

export function __testResolveCurrentStateScope(settings) {
    return resolveCurrentStateScope(settings);
}

export function __testGetLastSettingSeedDebug() {
    return lastSettingSeedDebug;
}

/**
 * A8 quality report for the current chat: key retention, causal recall (canonical vs injected) and
 * the compression curve. Reads only the store and the last published bundle, so it spends no model
 * call and can be run at any time — including by the live acceptance harness.
 */
export function getQualityReport(ctxInput = null, { everyFloors = 10, probeLimit = 60, injectedText = null, renderedBlock = null } = {}) {
    const ctx = ctxInput || getContext();
    if (!ctx) return null;
    const settings = getSettings(ctx);
    const store = getStore(ctx);
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const dialogueTextsPerFloor = chat
        .filter(row => isDialogueRow(row))
        .map(row => String(row.mes ?? ''));
    const published = ctx.chatMetadata?.[METADATA_KEY]?.v55_inner_bundle || null;
    // A harness measuring at injection time passes the blocks it just read, which is the only moment
    // they are guaranteed to exist.
    const supplied = injectedText !== null || renderedBlock !== null;
    const effectiveInjected = injectedText !== null
        ? String(injectedText)
        : [published?.reference_block, published?.current_state_block].filter(Boolean).join('\n\n');
    const mandatory = settings.inject_current_state
        ? getMandatoryMemories(store, settings.mandatory_baseline_limit ?? 24)
        : [];
    const report = computeQualityReport({
        store,
        rendered: renderedBlock !== null ? String(renderedBlock) : String(published?.current_state_block || ''),
        injectedText: effectiveInjected,
        // The published bundle lives in the derived record, so it can legitimately be absent — for
        // example when this runs after the chat was reloaded. Pass that through: an unmeasured metric
        // must not be published as a zero.
        injectedAvailable: supplied || published !== null,
        mandatory,
        dialogueTextsPerFloor,
        everyFloors,
        probeLimit,
    });
    // A8's fourth number: the per-section cost of the block that was actually published. Taken apart
    // here rather than re-derived by hand, so the number is reproducible after the run.
    report.injection_composition = injectionComposition(effectiveInjected);
    // T-Causal (plan section 1 / section 6): the acceptance instrument the A-list is gated on. Only the
    // cases generated from this chat's own spine are scored here - the authored fixture in
    // tcausal-cases.json belongs to the offline regression test, because its expectations are about a
    // fixed scenario and would read as misses on any live chat.
    report.tcausal = {
        canonical: runTcausal(store, { generated: probeLimit, scope: 'canonical' }),
        injected: runTcausal(store, {
            generated: probeLimit,
            scope: 'injected',
            injectedText: effectiveInjected,
            renderedBlock: effectiveInjected,
            available: supplied || published !== null,
        }),
    };
    report.tcausal_text = formatTcausalReport(report.tcausal.canonical);
    // The length certificate: the judge-free ruling on this exact projection. It reads the same
    // effective injected text as T-Causal, so the two cannot disagree about what the model was shown,
    // and it calls no model, so the same store and projection always give the same certificate.
    report.certificate = lengthCertificate(store, {
        projection: effectiveInjected,
        actor: String(ctx.name2 || '') || null,
        cases: buildTcausalCases(store, { limit: probeLimit }),
    });
    report.certificate_text = formatCertificate(report.certificate);
    return report;
}

export function __testQualityReport(ctx, options = {}) {
    return getQualityReport(ctx, options);
}

/** Manifest lifecycle hook. Keep activation lightweight; async work is deferred. */
export function init() {
    const ctx = getContext();
    if (!ctx) return;
    // Measured budget corrections reach existing installs only if something carries them over, because
    // getSettings supplies missing keys and nothing else. Done here, once, at activation: doing it inside
    // getSettings meant a settings write from a pure read path, which broke the host test that counts
    // exactly how many times the setting library is persisted.
    try {
        if (migrateMemoryBudgets(getSettings(ctx)).migrated) ctx.saveSettingsDebounced?.();
    } catch { /* a failed migration must never block activation */ }
    const ready = () => setTimeout(() => void startup(), 0);
    // If activation happens before APP_READY this is the clean path; timeout fallback handles already-ready sessions.
    ctx.eventSource.on(ctx.eventTypes.APP_READY, ready);
    setTimeout(() => void startup(), 750);
}
