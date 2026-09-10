// Aetheria Unified Memory v5.5 — private vector transport isolation.
// Aetheria-owned /api/vector/* requests may use an independent OpenAI-compatible embedding
// connection without mutating SillyTavern's Vector Storage configuration. Current SillyTavern
// release does not forward per-request secret_id through its vLLM vector adapter, so this module
// uses a serialized selected-secret rotation bridge and restores the user's previous active key.
// If that bridge cannot prove the requested credential is selected, the request fails closed.

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const PHYSICAL_SUFFIX = '__aum_private_';
const VLLM_SECRET_KEY = 'api_key_vllm';

let installed = false;
let originalFetch = null;
let credentialQueue = Promise.resolve();
let lastCredentialDebug = null;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function getSettings(ctx) {
    return ctx?.extensionSettings?.[SETTINGS_KEY] || null;
}

function getRequestHeaders(ctx) {
    return typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };
}

export function normalizeOpenAiEmbeddingBaseUrl(value) {
    let url = String(value || '').trim();
    if (!url) return '';
    url = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
    url = url.replace(/\/(?:embeddings|models)$/i, '');
    url = url.replace(/\/chat\/completions$/i, '');
    return url.replace(/\/+$/, '');
}

function fnv1a32(value) {
    let hash = 0x811c9dc5;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function directModeRequested(ctx = getContext()) {
    return getSettings(ctx)?.vector_direct_api_enabled === true;
}

function transportConfig(ctx = getContext()) {
    const settings = getSettings(ctx);
    if (!settings?.vector_direct_api_enabled) return null;
    const apiUrl = normalizeOpenAiEmbeddingBaseUrl(settings.vector_direct_api_url);
    const model = String(settings.vector_direct_api_model || '').trim();
    const secretId = String(settings.vector_direct_api_secret_id || '').trim();
    if (!apiUrl || !model || !secretId) return null;
    const signature = `vllm:${fnv1a32(`${apiUrl}|${model}|${secretId}`).toString(36)}`;
    return { source: 'vllm', apiUrl, model, secretId, signature };
}

function isAetheriaCollection(collectionId) {
    return typeof collectionId === 'string' && /^aetheria_v5[45]_/.test(collectionId);
}

function physicalCollectionId(collectionId, signature) {
    if (!isAetheriaCollection(collectionId)) return collectionId;
    const suffix = `${PHYSICAL_SUFFIX}${String(signature).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    if (collectionId.endsWith(suffix)) return collectionId;
    return `${collectionId}${suffix}`;
}

function parseRequestBody(init) {
    const body = init?.body;
    if (!body) return null;
    if (typeof body === 'string') {
        try { return JSON.parse(body); } catch { return null; }
    }
    return null;
}

function endpointName(input) {
    const url = typeof input === 'string' ? input : input?.url;
    const match = String(url || '').match(/\/api\/vector\/(insert|query|delete|list|purge)(?:\?|$)/);
    return match?.[1] || null;
}

export function buildPrivateVectorPayload(payloadInput, endpoint, ctxInput = getContext()) {
    const payload = payloadInput && typeof payloadInput === 'object' ? payloadInput : null;
    if (!payload || !isAetheriaCollection(payload.collectionId)) return null;
    const config = transportConfig(ctxInput);
    if (!config) {
        if (directModeRequested(ctxInput)) throw new Error('Aetheria 独立 Embedding 已启用，但 endpoint / model / secret_id 配置不完整。');
        return null;
    }
    const rewritten = { ...payload, collectionId: physicalCollectionId(payload.collectionId, config.signature) };
    if (endpoint !== 'purge') {
        rewritten.source = config.source;
        rewritten.apiUrl = config.apiUrl;
        rewritten.model = config.model;
        rewritten.secret_id = config.secretId;
    }
    return { payload: rewritten, config };
}

function rewriteVectorRequest(input, init) {
    const endpoint = endpointName(input);
    if (!endpoint || String(init?.method || 'GET').toUpperCase() !== 'POST') return null;
    const payload = parseRequestBody(init);
    if (!payload || !isAetheriaCollection(payload.collectionId)) return null;
    const built = buildPrivateVectorPayload(payload, endpoint, getContext());
    if (!built) return null;
    return { endpoint, config: built.config, input, init: { ...init, body: JSON.stringify(built.payload) } };
}

async function serverJson(ctx, path, body) {
    const response = await originalFetch(path, { method: 'POST', headers: getRequestHeaders(ctx), body: JSON.stringify(body) });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${path} failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
    }
    if (response.status === 204) return null;
    return await response.json().catch(() => null);
}

async function readVllmSecretState(ctx) {
    const state = await serverJson(ctx, '/api/secrets/read', {});
    const rows = Array.isArray(state?.[VLLM_SECRET_KEY]) ? state[VLLM_SECRET_KEY] : [];
    return rows.map(row => ({ id: String(row?.id || ''), active: row?.active === true, label: String(row?.label || '') })).filter(row => row.id);
}

async function rotateVllmSecret(ctx, id) {
    await serverJson(ctx, '/api/secrets/rotate', { key: VLLM_SECRET_KEY, id });
}

function enqueueCredentialTask(task) {
    const run = credentialQueue.then(task, task);
    credentialQueue = run.catch(() => {});
    return run;
}

async function withSelectedVllmSecret(ctx, config, task) {
    return enqueueCredentialTask(async () => {
        const before = await readVllmSecretState(ctx);
        const selected = before.find(row => row.id === config.secretId);
        if (!selected) throw new Error('选定的 Aetheria VLLM Secret ID 已不存在；拒绝回退到宿主默认密钥。');
        const previousActive = before.find(row => row.active)?.id || null;
        let rotated = false;
        try {
            if (!selected.active) { await rotateVllmSecret(ctx, config.secretId); rotated = true; }
            lastCredentialDebug = { at: Date.now(), selected_secret_id: config.secretId, previous_active_secret_id: previousActive, rotated, restored: !rotated, mode: 'serialized-selected-secret-rotation' };
            return await task();
        } finally {
            if (rotated && previousActive && previousActive !== config.secretId) {
                try {
                    await rotateVllmSecret(ctx, previousActive);
                    if (lastCredentialDebug) lastCredentialDebug.restored = true;
                } catch (restoreError) {
                    if (lastCredentialDebug) { lastCredentialDebug.restored = false; lastCredentialDebug.restore_error = String(restoreError?.message || restoreError); }
                    throw new Error(`Aetheria 向量请求结束后无法恢复原 VLLM 密钥：${String(restoreError?.message || restoreError)}`);
                }
            }
        }
    });
}

async function executeRewritten(rewritten) {
    const ctx = getContext();
    const send = () => originalFetch(rewritten.input, rewritten.init);
    if (rewritten.endpoint === 'insert' || rewritten.endpoint === 'query') return withSelectedVllmSecret(ctx, rewritten.config, send);
    return send();
}

export function invalidateAetheriaVectorState(ctxInput = getContext(), reason = '独立 Embedding 配置已变化，需要重建派生向量。') {
    const ctx = ctxInput;
    const settings = getSettings(ctx);
    if (!ctx || !settings) return false;
    const store = ctx.chatMetadata?.[METADATA_KEY];
    if (store && typeof store === 'object') {
        if (store.vector && typeof store.vector === 'object') { store.vector.stale = true; store.vector.last_error = reason; }
        if (store.baseline?.vector && typeof store.baseline.vector === 'object') { store.baseline.vector.stale = true; store.baseline.vector.last_error = reason; }
        ctx.saveMetadataDebounced?.();
    }
    const state = settings.setting_index_state;
    if (state?.scopes && typeof state.scopes === 'object') {
        for (const scope of Object.values(state.scopes)) {
            if (!scope || typeof scope !== 'object') continue;
            scope.vector_degraded = true;
            scope.last_error = reason;
            if (scope.profiles && typeof scope.profiles === 'object') {
                for (const profile of Object.values(scope.profiles)) {
                    if (!profile || typeof profile !== 'object') continue;
                    profile.stale = true; profile.ready = false; profile.last_error = reason;
                }
            }
        }
        ctx.saveSettingsDebounced?.();
    }
    return true;
}

export function configurePrivateVectorTransport(ctxInput = getContext()) {
    const ctx = ctxInput;
    const settings = getSettings(ctx);
    if (!ctx || !settings) return { active: false, reason: 'context-unavailable' };
    const config = transportConfig(ctx);
    if (!config) {
        if (settings.vector_direct_previous_source_mode !== undefined && !settings.vector_direct_api_enabled) {
            settings.vector_source_mode = settings.vector_direct_previous_source_mode || 'inherit';
            delete settings.vector_direct_previous_source_mode;
            delete settings.vector_direct_transport_signature;
            ctx.saveSettingsDebounced?.();
        }
        return { active: false, reason: settings.vector_direct_api_enabled ? 'incomplete-config' : 'not-configured' };
    }
    if (settings.vector_direct_previous_source_mode === undefined) settings.vector_direct_previous_source_mode = settings.vector_source_mode || 'inherit';
    settings.vector_source_mode = 'transformers';
    const previousSignature = String(settings.vector_direct_transport_signature || '');
    if (previousSignature && previousSignature !== config.signature) invalidateAetheriaVectorState(ctx, '独立 Embedding endpoint/model/credential 已变化，Aetheria 向量空间需要重建。');
    settings.vector_direct_transport_signature = config.signature;
    ctx.saveSettingsDebounced?.();
    return { active: true, ...config };
}

export function getPrivateVectorTransportStatus(ctxInput = getContext()) {
    const config = transportConfig(ctxInput);
    return config ? { active: true, isolated: true, source: config.source, apiUrl: config.apiUrl, model: config.model, signature: config.signature, credential_mode: 'serialized-selected-secret-rotation', last_credential_debug: lastCredentialDebug ? structuredClone(lastCredentialDebug) : null } : { active: false, isolated: true, reason: directModeRequested(ctxInput) ? 'incomplete-config' : 'not-configured' };
}

export function installV55PrivateVectorTransport() {
    if (installed) { configurePrivateVectorTransport(getContext()); return true; }
    if (typeof globalThis.fetch !== 'function') return false;
    originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async function aetheriaPrivateVectorFetch(input, init = undefined) {
        const endpoint = endpointName(input);
        const payload = parseRequestBody(init);
        const isAetheria = Boolean(endpoint && payload && isAetheriaCollection(payload.collectionId));
        try {
            const rewritten = rewriteVectorRequest(input, init);
            if (rewritten) return await executeRewritten(rewritten);
        } catch (error) {
            if (isAetheria && directModeRequested(getContext())) { console.error('[Aetheria v5.5 Private Vector] isolated request failed closed', error); throw error; }
            console.error('[Aetheria v5.5 Private Vector] request rewrite failed', error);
        }
        if (isAetheria && directModeRequested(getContext())) throw new Error('Aetheria 独立 Embedding 请求无法建立安全 transport；拒绝使用宿主默认向量凭据。');
        return originalFetch(input, init);
    };
    globalThis.fetch.__aumV55PrivateVector = true;
    installed = true;
    configurePrivateVectorTransport(getContext());
    const ctx = getContext();
    const event = ctx?.eventTypes?.CHAT_CHANGED;
    if (event && ctx?.eventSource?.on) ctx.eventSource.on(event, () => setTimeout(() => configurePrivateVectorTransport(getContext()), 50));
    return true;
}
