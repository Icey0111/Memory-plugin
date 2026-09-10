import { applyEmbeddingRoleText, buildTransportQueryViews, classifyAetheriaCollection, fuseRankedMetadata, normalizeEmbeddingProfile, resolveCalibratedThreshold } from './embedding-profile.js';
import { invalidateAetheriaVectorState, normalizeOpenAiEmbeddingBaseUrl } from './v55-private-vector-transport.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const SPACE_SUFFIX = '__aum_space_';
const POLICY_VERSION = 2;
let installed = false;
let originalFetch = null;
let lastDebug = null;

const getContext = () => globalThis.SillyTavern?.getContext?.();
const getSettings = ctx => ctx?.extensionSettings?.[SETTINGS_KEY] || null;
const isAetheriaCollection = value => typeof value === 'string' && /^aetheria_v5[45]_/.test(value);
function endpointName(input) { const url = typeof input === 'string' ? input : input?.url; return String(url || '').match(/\/api\/vector\/(insert|query|delete|list|purge)(?:\?|$)/)?.[1] || null; }
function parseBody(init) { if (typeof init?.body !== 'string') return null; try { return JSON.parse(init.body); } catch { return null; } }
function scorePolicy(settings) { return { memory: settings?.vector_score_memory_threshold, setting: settings?.vector_score_setting_threshold, baseline: settings?.vector_score_baseline_threshold }; }
function directDescriptor(settings) {
    if (!settings?.vector_direct_api_enabled) return null;
    const endpoint = normalizeOpenAiEmbeddingBaseUrl(settings.vector_direct_api_url);
    const model = String(settings.vector_direct_api_model || '').trim();
    return endpoint && model ? { provider: 'vllm', model, endpoint } : null;
}
function profileInput(settings, request = {}) {
    const direct = directDescriptor(settings);
    return {
        provider: direct?.provider || request?.source || 'host', model: direct?.model || request?.model || '', endpoint: direct?.endpoint || request?.apiUrl || request?.siliconflow_endpoint || '',
        family: settings?.vector_embedding_family || 'auto', role_strategy: settings?.vector_embedding_role_strategy || 'auto', query_prefix: settings?.vector_embedding_query_prefix || '', document_prefix: settings?.vector_embedding_document_prefix || '',
        dimensions: settings?.vector_embedding_dimensions ?? null, normalization: settings?.vector_embedding_normalization || 'auto', score_policy: scorePolicy(settings), multi_query_fusion: settings?.vector_multi_query_fusion !== false, multi_query_rrf_k: settings?.vector_multi_query_rrf_k || 60,
    };
}
export function getV55EmbeddingProfile(ctxInput = getContext(), request = {}) { return normalizeEmbeddingProfile(profileInput(getSettings(ctxInput) || {}, request)); }
function physicalCollectionId(collectionId, profile, settings) {
    if (!settings?.vector_direct_api_enabled || !isAetheriaCollection(collectionId)) return collectionId;
    const suffix = `${SPACE_SUFFIX}${String(profile.space_fingerprint).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    return collectionId.includes(suffix) ? collectionId : `${collectionId}${suffix}`;
}
export function rewriteAetheriaPolicyPayload(payloadInput, endpoint, ctxInput = getContext()) {
    if (!payloadInput || !isAetheriaCollection(payloadInput.collectionId)) return null;
    const settings = getSettings(ctxInput) || {};
    const profile = normalizeEmbeddingProfile(profileInput(settings, payloadInput));
    const collectionKind = classifyAetheriaCollection(payloadInput.collectionId);
    const payload = { ...payloadInput, collectionId: physicalCollectionId(payloadInput.collectionId, profile, settings) };
    if (endpoint === 'insert' && Array.isArray(payload.items)) payload.items = payload.items.map(item => ({ ...item, text: applyEmbeddingRoleText(item?.text, profile, 'document') }));
    if (endpoint === 'query') { payload.searchText = applyEmbeddingRoleText(payload.searchText, profile, 'query'); payload.threshold = resolveCalibratedThreshold(profile, collectionKind, payload.threshold); }
    return { payload, profile, collectionKind };
}
function makeRequest(input, init, payload) { return { input, init: { ...init, body: JSON.stringify(payload) } }; }
async function readJson(response) { try { return await response.json(); } catch { return null; } }
function makeJsonResponse(data, source) { const headers = new Headers(source?.headers || undefined); headers.set('content-type', 'application/json; charset=utf-8'); return new Response(JSON.stringify(data), { status: source?.ok ? source.status : 200, statusText: source?.ok ? source.statusText : 'OK', headers }); }
async function runSettingMultiView(input, init, originalPayload, rewritten) {
    if (rewritten.collectionKind !== 'setting' || !rewritten.profile.multi_query_fusion) return null;
    const views = buildTransportQueryViews(originalPayload.searchText, { maxViews: 4 });
    if (views.length <= 1) return null;
    const topK = Math.max(1, Math.min(500, Number(originalPayload.topK) || 20)); const lists = []; const weights = []; let template = null;
    try {
        for (const view of views) {
            const sub = { ...rewritten.payload, searchText: applyEmbeddingRoleText(view.text, rewritten.profile, 'query'), topK };
            const req = makeRequest(input, init, sub); const response = await originalFetch(req.input, req.init); if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await readJson(response); if (!Array.isArray(body?.metadata)) throw new Error('metadata missing'); if (!template) template = response; lists.push(body.metadata); weights.push(view.weight);
        }
        const metadata = fuseRankedMetadata(lists, { weights, rrfK: rewritten.profile.multi_query_rrf_k, topK });
        lastDebug = { at: Date.now(), stage: 'setting-multi-view', profile: rewritten.profile.space_fingerprint, retrieval_policy: rewritten.profile.retrieval_policy_fingerprint, views: views.map((v,i)=>({name:v.name,weight:v.weight,returned:lists[i]?.length||0})), fused_count: metadata.length };
        return makeJsonResponse({ metadata }, template);
    } catch (error) { lastDebug = { at: Date.now(), stage: 'setting-multi-view', fallback: 'single-query', error: String(error?.message || error) }; return null; }
}
async function intercept(input, init) {
    const endpoint = endpointName(input); if (!endpoint || String(init?.method || 'GET').toUpperCase() !== 'POST') return null;
    const originalPayload = parseBody(init); if (!originalPayload || !isAetheriaCollection(originalPayload.collectionId)) return null;
    const rewritten = rewriteAetheriaPolicyPayload(originalPayload, endpoint, getContext()); if (!rewritten) return null;
    if (endpoint === 'query') { const fused = await runSettingMultiView(input, init, originalPayload, rewritten); if (fused) return fused; }
    lastDebug = { at: Date.now(), stage: endpoint, collection_kind: rewritten.collectionKind, profile: rewritten.profile.space_fingerprint, retrieval_policy: rewritten.profile.retrieval_policy_fingerprint, threshold_requested: endpoint === 'query' ? Number(originalPayload.threshold ?? 0) : null, threshold_effective: endpoint === 'query' ? Number(rewritten.payload.threshold ?? 0) : null };
    const req = makeRequest(input, init, rewritten.payload); return originalFetch(req.input, req.init);
}
function policySpaceFingerprint(settings) { return normalizeEmbeddingProfile({ provider:'policy', family:settings?.vector_embedding_family||'auto', role_strategy:settings?.vector_embedding_role_strategy||'auto', query_prefix:settings?.vector_embedding_query_prefix||'', document_prefix:settings?.vector_embedding_document_prefix||'', dimensions:settings?.vector_embedding_dimensions??null, normalization:settings?.vector_embedding_normalization||'auto', score_policy:{}, multi_query_fusion:false }).space_fingerprint; }
function retrievalFingerprint(settings) { return normalizeEmbeddingProfile({ provider:'policy', score_policy:scorePolicy(settings), multi_query_fusion:settings?.vector_multi_query_fusion!==false, multi_query_rrf_k:settings?.vector_multi_query_rrf_k||60 }).retrieval_policy_fingerprint; }
export function configureV55VectorPolicy(ctxInput = getContext()) {
    const ctx = ctxInput; const settings = getSettings(ctx); if (!ctx || !settings) return { active:false, reason:'context-unavailable' };
    const prevSpace = String(settings.vector_embedding_policy_signature || ''); const prevRetrieval = String(settings.vector_retrieval_policy_signature || ''); const nextSpace = policySpaceFingerprint(settings); const nextRetrieval = retrievalFingerprint(settings);
    if (Number(settings.vector_profile_policy_version) !== POLICY_VERSION) { settings.vector_profile_policy_version = POLICY_VERSION; invalidateAetheriaVectorState(ctx, 'Embedding Space Profile v2 已启用；旧派生向量缺少完整空间身份，需要一次性安全重建。'); }
    else if (prevSpace && prevSpace !== nextSpace) invalidateAetheriaVectorState(ctx, 'Embedding role / representation space 已变化，需要安全重建派生向量。');
    settings.vector_embedding_policy_signature = nextSpace; settings.vector_retrieval_policy_signature = nextRetrieval; ctx.saveSettingsDebounced?.();
    return { active:true, space_policy:nextSpace, retrieval_policy:nextRetrieval, retrieval_changed:Boolean(prevRetrieval && prevRetrieval !== nextRetrieval), profile:getV55EmbeddingProfile(ctx) };
}
export function getV55VectorPolicyStatus(ctxInput = getContext()) { const settings = getSettings(ctxInput) || {}; return { installed, policy_version:POLICY_VERSION, profile:getV55EmbeddingProfile(ctxInput), stored_space_policy:settings.vector_embedding_policy_signature||null, stored_retrieval_policy:settings.vector_retrieval_policy_signature||null, last_debug:lastDebug ? structuredClone(lastDebug) : null }; }
export function installV55VectorPolicy() {
    if (installed) { configureV55VectorPolicy(getContext()); return true; }
    if (typeof globalThis.fetch !== 'function') return false; originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async function aetheriaVectorPolicyFetch(input, init = undefined) { try { const handled = await intercept(input, init); if (handled) return handled; } catch (error) { console.error('[Aetheria v5.5 Vector Policy] overlay failed', error); } return originalFetch(input, init); };
    installed = true; configureV55VectorPolicy(getContext()); const ctx = getContext(); const changed = ctx?.eventTypes?.CHAT_CHANGED; if (changed && ctx?.eventSource?.on) ctx.eventSource.on(changed, () => setTimeout(() => configureV55VectorPolicy(getContext()), 50)); return true;
}
