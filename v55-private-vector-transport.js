// Aetheria Unified Memory v5.5 — private vector transport isolation.
// Intercepts only Aetheria /api/vector/* requests and rewrites them to the plugin's independent
// OpenAI-compatible embedding connection. It never changes SillyTavern's global Vector Storage settings.

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const PHYSICAL_SUFFIX = '__aum_private_';

let installed = false;
let originalFetch = null;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function getSettings(ctx) {
    return ctx?.extensionSettings?.[SETTINGS_KEY] || null;
}

function normalizeUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
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

function transportConfig(ctx = getContext()) {
    const settings = getSettings(ctx);
    if (!settings?.vector_direct_api_enabled) return null;
    const apiUrl = normalizeUrl(settings.vector_direct_api_url);
    const model = String(settings.vector_direct_api_model || '').trim();
    const secretId = String(settings.vector_direct_api_secret_id || '').trim();
    if (!apiUrl || !model || !secretId) return null;
    const signature = `vllm:${fnv1a32(`${apiUrl}|${model}`).toString(36)}`;
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

function rewriteVectorRequest(input, init) {
    const endpoint = endpointName(input);
    if (!endpoint || String(init?.method || 'GET').toUpperCase() !== 'POST') return null;
    const payload = parseRequestBody(init);
    if (!payload || !isAetheriaCollection(payload.collectionId)) return null;
    const ctx = getContext();
    const config = transportConfig(ctx);
    if (!config) return null;

    const rewritten = {
        ...payload,
        collectionId: physicalCollectionId(payload.collectionId, config.signature),
    };
    // purge only needs the collection identity; every operation that embeds or opens the index
    // gets the private provider explicitly, independent of ST's global vectors.source.
    if (endpoint !== 'purge') {
        rewritten.source = config.source;
        rewritten.apiUrl = config.apiUrl;
        rewritten.model = config.model;
    }
    return {
        input,
        init: { ...init, body: JSON.stringify(rewritten) },
    };
}

export function invalidateAetheriaVectorState(ctxInput = getContext(), reason = '独立 Embedding 配置已变化，需要重建派生向量。') {
    const ctx = ctxInput;
    const settings = getSettings(ctx);
    if (!ctx || !settings) return false;

    const store = ctx.chatMetadata?.[METADATA_KEY];
    if (store && typeof store === 'object') {
        if (store.vector && typeof store.vector === 'object') {
            store.vector.stale = true;
            store.vector.last_error = reason;
        }
        if (store.baseline?.vector && typeof store.baseline.vector === 'object') {
            store.baseline.vector.stale = true;
            store.baseline.vector.last_error = reason;
        }
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
                    profile.stale = true;
                    profile.ready = false;
                    profile.last_error = reason;
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
        if (settings.vector_direct_previous_source_mode !== undefined) {
            settings.vector_source_mode = settings.vector_direct_previous_source_mode || 'inherit';
            delete settings.vector_direct_previous_source_mode;
            delete settings.vector_direct_transport_signature;
            ctx.saveSettingsDebounced?.();
        }
        return { active: false, reason: 'not-configured' };
    }

    // The mature core only needs a supported logical provider to run its index lifecycle.
    // Physical /api/vector requests are rewritten below, so we use the plugin-private source mode
    // rather than mutating extensionSettings.vectors (which belongs to the host/user globally).
    if (settings.vector_direct_previous_source_mode === undefined) {
        settings.vector_direct_previous_source_mode = settings.vector_source_mode || 'inherit';
    }
    settings.vector_source_mode = 'transformers';

    const previousSignature = String(settings.vector_direct_transport_signature || '');
    if (previousSignature && previousSignature !== config.signature) {
        invalidateAetheriaVectorState(ctx, '独立 Embedding endpoint/model 已变化，Aetheria 向量空间需要重建。');
    }
    settings.vector_direct_transport_signature = config.signature;
    ctx.saveSettingsDebounced?.();
    return { active: true, ...config };
}

export function getPrivateVectorTransportStatus(ctxInput = getContext()) {
    const ctx = ctxInput;
    const config = transportConfig(ctx);
    return config
        ? { active: true, isolated: true, source: config.source, apiUrl: config.apiUrl, model: config.model, signature: config.signature }
        : { active: false, isolated: true };
}

export function installV55PrivateVectorTransport() {
    if (installed) {
        configurePrivateVectorTransport(getContext());
        return true;
    }
    if (typeof globalThis.fetch !== 'function') return false;
    originalFetch = globalThis.fetch.bind(globalThis);
    const wrappedFetch = function aetheriaPrivateVectorFetch(input, init = undefined) {
        try {
            const rewritten = rewriteVectorRequest(input, init);
            if (rewritten) return originalFetch(rewritten.input, rewritten.init);
        } catch (error) {
            console.error('[Aetheria v5.5 Private Vector] request rewrite failed', error);
        }
        return originalFetch(input, init);
    };
    wrappedFetch.__aumV55PrivateVector = true;
    globalThis.fetch = wrappedFetch;
    installed = true;
    configurePrivateVectorTransport(getContext());

    const ctx = getContext();
    const event = ctx?.eventTypes?.CHAT_CHANGED;
    if (event && ctx?.eventSource?.on) {
        ctx.eventSource.on(event, () => setTimeout(() => configurePrivateVectorTransport(getContext()), 50));
    }
    return true;
}
