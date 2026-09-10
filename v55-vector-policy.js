import {
    applyEmbeddingRoleText,
    buildTransportQueryViews,
    classifyAetheriaCollection,
    fuseRankedMetadata,
    normalizeEmbeddingProfile,
    resolveCalibratedThreshold,
} from './embedding-profile.js';
import { invalidateAetheriaVectorState, normalizeOpenAiEmbeddingBaseUrl } from './v55-private-vector-transport.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const SPACE_SUFFIX = '__aum_space_';
const POLICY_VERSION = 3;
let installed = false;
let originalFetch = null;
let lastDebug = null;

const getContext = () => globalThis.SillyTavern?.getContext?.();
const getSettings = ctx => ctx?.extensionSettings?.[SETTINGS_KEY] || null;
const isAetheriaCollection = value => typeof value === 'string' && /^aetheria_v5[45]_/.test(value);

function endpointName(input) {
    const url = typeof input === 'string' ? input : input?.url;
    return String(url || '').match(/\/api\/vector\/(insert|query|delete|list|purge)(?:\?|$)/)?.[1] || null;
}
function parseBody(init) { if (typeof init?.body !== 'string') return null; try { return JSON.parse(init.body); } catch { return null; } }
function scorePolicy(settings) { return { memory: settings?.vector_score_memory_threshold, setting: settings?.vector_score_setting_threshold, baseline: settings?.vector_score_baseline_threshold }; }
function directDescriptor(settings) { if (!settings?.vector_direct_api_enabled) return null; return { provider: 'vllm', model: String(settings.vector_direct_api_model || '').trim(), endpoint: normalizeOpenAiEmbeddingBaseUrl(settings.vector_direct_api_url) }; }

function hostRequestDescriptor(ctx) {
    const settings = getSettings(ctx) || {};
    const direct = directDescriptor(settings);
    if (direct) return { source: direct.provider, model: direct.model, apiUrl: direct.endpoint };
    const vectors = ctx?.extensionSettings?.vectors || {};
    const source = settings.vector_source_mode === 'transformers' ? 'transformers' : String(vectors.source || 'transformers');
    const text = ctx?.textCompletionSettings || {}, oai = ctx?.chatCompletionSettings || {};
    const altUrl = vectors.use_alt_endpoint ? String(vectors.alt_endpoint_url || '').trim() : '';
    const descriptor = { source };
    switch (source) {
        case 'electronhub': descriptor.model = vectors.electronhub_model; break;
        case 'openrouter': descriptor.model = vectors.openrouter_model; break;
        case 'togetherai': descriptor.model = vectors.togetherai_model; break;
        case 'openai': descriptor.model = vectors.openai_model; break;
        case 'cohere': descriptor.model = vectors.cohere_model; break;
        case 'ollama': descriptor.model = vectors.ollama_model; descriptor.apiUrl = altUrl || text.server_urls?.ollama || ''; break;
        case 'llamacpp': descriptor.apiUrl = altUrl || text.server_urls?.llamacpp || ''; break;
        case 'vllm': descriptor.model = vectors.vllm_model; descriptor.apiUrl = altUrl || text.server_urls?.vllm || ''; break;
        case 'palm': case 'vertexai': descriptor.model = vectors.google_model; break;
        case 'chutes': descriptor.model = vectors.chutes_model; break;
        case 'nanogpt': descriptor.model = vectors.nanogpt_model; break;
        case 'siliconflow': descriptor.model = vectors.siliconflow_model; descriptor.siliconflow_endpoint = oai.siliconflow_endpoint || ''; break;
        case 'workers_ai': descriptor.model = vectors.workers_ai_model || '@cf/baai/bge-m3'; break;
        default: break;
    }
    return descriptor;
}

function profileInput(settings, request = {}) {
    const direct = directDescriptor(settings);
    return { provider: direct?.provider || request?.source || 'host', model: direct?.model || request?.model || '', endpoint: direct?.endpoint || request?.apiUrl || request?.siliconflow_endpoint || '', family: settings?.vector_embedding_family || 'auto', role_strategy: settings?.vector_embedding_role_strategy || 'auto', query_prefix: settings?.vector_embedding_query_prefix || '', document_prefix: settings?.vector_embedding_document_prefix || '', dimensions: settings?.vector_embedding_dimensions ?? null, normalization: settings?.vector_embedding_normalization || 'auto', score_policy: scorePolicy(settings), multi_query_fusion: settings?.vector_multi_query_fusion !== false, multi_query_rrf_k: settings?.vector_multi_query_rrf_k || 60 };
}
export function getV55EmbeddingProfile(ctxInput = getContext(), request = {}) { return normalizeEmbeddingProfile(profileInput(getSettings(ctxInput) || {}, request)); }
function currentSpaceProfile(ctx) { return getV55EmbeddingProfile(ctx, hostRequestDescriptor(ctx)); }
function physicalCollectionId(collectionId, profile, settings) { if (!settings?.vector_direct_api_enabled || !isAetheriaCollection(collectionId)) return collectionId; const suffix = `${SPACE_SUFFIX}${String(profile.space_fingerprint).replace(/[^a-zA-Z0-9_-]/g, '_')}`; return collectionId.includes(suffix) ? collectionId : `${collectionId}${suffix}`; }

export function rewriteAetheriaPolicyPayload(payloadInput, endpoint, ctxInput = getContext()) {
    if (!payloadInput || !isAetheriaCollection(payloadInput.collectionId)) return null;
    const settings = getSettings(ctxInput) || {};
    const requestDescriptor = { ...hostRequestDescriptor(ctxInput), ...payloadInput };
    const profile = normalizeEmbeddingProfile(profileInput(settings, requestDescriptor));
    const collectionKind = classifyAetheriaCollection(payloadInput.collectionId);
    const payload = { ...payloadInput, collectionId: physicalCollectionId(payloadInput.collectionId, profile, settings) };
    if (endpoint === 'insert' && Array.isArray(payload.items)) payload.items = payload.items.map(item => ({ ...item, text: applyEmbeddingRoleText(item?.text, profile, 'document') }));
    if (endpoint === 'query') { payload.searchText = applyEmbeddingRoleText(payload.searchText, profile, 'query'); payload.threshold = resolveCalibratedThreshold(profile, collectionKind, payload.threshold); }
    return { payload, profile, collectionKind, logicalCollectionId: payloadInput.collectionId };
}
function makeRequest(input, init, payload) { return { input, init: { ...init, body: JSON.stringify(payload) } }; }
async function readJson(response) { try { return await response.json(); } catch { return null; } }
function makeJsonResponse(data, source = null) { const headers = new Headers(source?.headers || undefined); headers.set('content-type', 'application/json; charset=utf-8'); return new Response(JSON.stringify(data), { status: source?.ok ? source.status : 200, statusText: source?.ok ? source.statusText : 'OK', headers }); }
function indexStateForKind(ctx, kind) { const store = ctx?.chatMetadata?.[METADATA_KEY]; if (!store || typeof store !== 'object') return null; if (kind === 'memory') return store.vector && typeof store.vector === 'object' ? store.vector : null; if (kind === 'baseline') return store.baseline?.vector && typeof store.baseline.vector === 'object' ? store.baseline.vector : null; return null; }
// A memory dense index only exists once it holds at least one vectorized row. The plugin stamps a
// provider fingerprint as soon as it merely *ensures* the collection, so reading that stamp as
// "built" made a brand-new chat report `stale` together with "现有 memory Dense 索引没有 per-index
// space_fingerprint；拒绝把它当作当前空间使用" even though no memory had ever been indexed. A legacy
// index that really was built always carries vectorized rows, so it is still detected.
function indexLooksBuilt(indexState, kind, store) { if (!indexState) return false; if (kind === 'memory') return Object.values(store?.memories || {}).some(memory => Number.isFinite(Number(memory?.vector_hash))); return Boolean(indexState.fingerprint || indexState.provider_fingerprint || indexState.last_sync_at); }
function markIndexSpaceStale(ctx, kind, indexState, expected, reason) { if (!indexState) return false; indexState.stale = true; indexState.expected_space_fingerprint = expected; indexState.last_error = reason; ctx?.saveMetadataDebounced?.(); return true; }

export function ensureCurrentVectorSpaceIdentity(ctxInput = getContext(), profileInput = null) {
    const ctx = ctxInput, store = ctx?.chatMetadata?.[METADATA_KEY];
    if (!ctx || !store) return { checked: false, expected: null, mismatches: [] };
    const profile = profileInput?.space_fingerprint ? profileInput : currentSpaceProfile(ctx), expected = profile.space_fingerprint, mismatches = [];
    for (const kind of ['memory', 'baseline']) {
        const state = indexStateForKind(ctx, kind);
        if (!state || !indexLooksBuilt(state, kind, store)) continue;
        const stored = String(state.space_fingerprint || '');
        if (stored !== expected) {
            const reason = stored ? `Embedding space 已变化（${stored} → ${expected}）；${kind} Dense 索引必须重建。` : `现有 ${kind} Dense 索引没有 per-index space_fingerprint；拒绝把它当作当前空间使用。`;
            markIndexSpaceStale(ctx, kind, state, expected, reason);
            mismatches.push({ kind, stored: stored || null, expected, reason });
        }
    }
    return { checked: true, expected, mismatches };
}

function querySpaceUsable(ctx, rewritten) {
    if (!['memory', 'baseline'].includes(rewritten.collectionKind)) return { usable: true };
    const state = indexStateForKind(ctx, rewritten.collectionKind), store = ctx?.chatMetadata?.[METADATA_KEY];
    if (!state || !indexLooksBuilt(state, rewritten.collectionKind, store)) return { usable: true };
    const stored = String(state.space_fingerprint || ''), expected = rewritten.profile.space_fingerprint;
    if (stored === expected && state.stale !== true) return { usable: true };
    const reason = stored === expected ? `${rewritten.collectionKind} Dense 索引已标记 stale。` : `请求空间 ${expected} 与已建索引 ${stored || '(missing)'} 不一致。`;
    markIndexSpaceStale(ctx, rewritten.collectionKind, state, expected, reason);
    return { usable: false, reason, stored: stored || null, expected };
}
function stampSuccessfulSpace(ctx, rewritten, endpoint) { if (!['insert', 'purge'].includes(endpoint) || !['memory', 'baseline'].includes(rewritten.collectionKind)) return; const state = indexStateForKind(ctx, rewritten.collectionKind); if (!state) return; state.space_fingerprint = rewritten.profile.space_fingerprint; state.expected_space_fingerprint = rewritten.profile.space_fingerprint; ctx?.saveMetadataDebounced?.(); }

async function runSettingMultiView(input, init, originalPayload, rewritten) {
    if (rewritten.collectionKind !== 'setting' || !rewritten.profile.multi_query_fusion) return null;
    const views = buildTransportQueryViews(originalPayload.searchText, { maxViews: 4 });
    if (views.length <= 1) return null;
    const topK = Math.max(1, Math.min(500, Number(originalPayload.topK) || 20)), lists = [], weights = [];
    let template = null;
    try {
        for (const view of views) {
            const sub = { ...rewritten.payload, searchText: applyEmbeddingRoleText(view.text, rewritten.profile, 'query'), topK };
            const req = makeRequest(input, init, sub), response = await originalFetch(req.input, req.init);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await readJson(response);
            if (!Array.isArray(body?.metadata)) throw new Error('metadata missing');
            if (!template) template = response;
            lists.push(body.metadata); weights.push(view.weight);
        }
        const metadata = fuseRankedMetadata(lists, { weights, rrfK: rewritten.profile.multi_query_rrf_k, topK });
        lastDebug = { at: Date.now(), stage: 'setting-multi-view', profile: rewritten.profile.space_fingerprint, retrieval_policy: rewritten.profile.retrieval_policy_fingerprint, views: views.map((view, index) => ({ name: view.name, weight: view.weight, returned: lists[index]?.length || 0 })), fused_count: metadata.length };
        return makeJsonResponse({ metadata }, template);
    } catch (error) {
        lastDebug = { at: Date.now(), stage: 'setting-multi-view', fallback: 'single-rewritten-query', error: String(error?.message || error) };
        return null;
    }
}

async function intercept(input, init) {
    const endpoint = endpointName(input);
    if (!endpoint || String(init?.method || 'GET').toUpperCase() !== 'POST') return null;
    const originalPayload = parseBody(init);
    if (!originalPayload || !isAetheriaCollection(originalPayload.collectionId)) return null;
    const ctx = getContext(), rewritten = rewriteAetheriaPolicyPayload(originalPayload, endpoint, ctx);
    if (!rewritten) return null;
    if (endpoint === 'query') {
        const space = querySpaceUsable(ctx, rewritten);
        if (!space.usable) { lastDebug = { at: Date.now(), stage: 'query-space-guard', collection_kind: rewritten.collectionKind, ...space }; return makeJsonResponse({ metadata: [] }); }
        const fused = await runSettingMultiView(input, init, originalPayload, rewritten);
        if (fused) return fused;
    }
    lastDebug = { at: Date.now(), stage: endpoint, collection_kind: rewritten.collectionKind, profile: rewritten.profile.space_fingerprint, retrieval_policy: rewritten.profile.retrieval_policy_fingerprint, threshold_requested: endpoint === 'query' ? Number(originalPayload.threshold ?? 0) : null, threshold_effective: endpoint === 'query' ? Number(rewritten.payload.threshold ?? 0) : null };
    const req = makeRequest(input, init, rewritten.payload), response = await originalFetch(req.input, req.init);
    if (response.ok) stampSuccessfulSpace(ctx, rewritten, endpoint);
    return response;
}
function retrievalFingerprint(settings) { return normalizeEmbeddingProfile({ provider: 'policy', score_policy: scorePolicy(settings), multi_query_fusion: settings?.vector_multi_query_fusion !== false, multi_query_rrf_k: settings?.vector_multi_query_rrf_k || 60 }).retrieval_policy_fingerprint; }

export function configureV55VectorPolicy(ctxInput = getContext()) {
    const ctx = ctxInput, settings = getSettings(ctx);
    if (!ctx || !settings) return { active: false, reason: 'context-unavailable' };
    const profile = currentSpaceProfile(ctx), prevSpace = String(settings.vector_embedding_policy_signature || ''), prevRetrieval = String(settings.vector_retrieval_policy_signature || ''), nextSpace = profile.space_fingerprint, nextRetrieval = retrievalFingerprint(settings);
    if (Number(settings.vector_profile_policy_version) !== POLICY_VERSION) { settings.vector_profile_policy_version = POLICY_VERSION; invalidateAetheriaVectorState(ctx, 'Embedding Space Profile v3 已启用；当前聊天旧派生向量需要一次性安全重建。'); }
    else if (prevSpace && prevSpace !== nextSpace) invalidateAetheriaVectorState(ctx, 'Embedding provider/model/role representation space 已变化；当前聊天派生向量需要安全重建。');
    const perIndex = ensureCurrentVectorSpaceIdentity(ctx, profile);
    settings.vector_embedding_policy_signature = nextSpace;
    settings.vector_retrieval_policy_signature = nextRetrieval;
    ctx.saveSettingsDebounced?.();
    return { active: true, space_policy: nextSpace, retrieval_policy: nextRetrieval, retrieval_changed: Boolean(prevRetrieval && prevRetrieval !== nextRetrieval), profile, per_index: perIndex };
}
export function getV55VectorPolicyStatus(ctxInput = getContext()) { const settings = getSettings(ctxInput) || {}; return { installed, policy_version: POLICY_VERSION, profile: currentSpaceProfile(ctxInput), stored_space_policy: settings.vector_embedding_policy_signature || null, stored_retrieval_policy: settings.vector_retrieval_policy_signature || null, last_debug: lastDebug ? structuredClone(lastDebug) : null }; }
export function installV55VectorPolicy() {
    if (installed) { configureV55VectorPolicy(getContext()); return true; }
    if (typeof globalThis.fetch !== 'function') return false;
    originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async function aetheriaVectorPolicyFetch(input, init = undefined) {
        const endpoint = endpointName(input), payload = parseBody(init), aetheriaRequest = Boolean(endpoint && payload && isAetheriaCollection(payload.collectionId));
        if (!aetheriaRequest) return originalFetch(input, init);
        return await intercept(input, init);
    };
    installed = true;
    configureV55VectorPolicy(getContext());
    const ctx = getContext(), changed = ctx?.eventTypes?.CHAT_CHANGED;
    if (changed && ctx?.eventSource?.on) ctx.eventSource.on(changed, () => setTimeout(() => configureV55VectorPolicy(getContext()), 50));
    return true;
}
