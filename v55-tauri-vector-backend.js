// Aetheria Unified Memory v5.5 — TauriTavern plugin-owned vector backend.
//
// Native TauriTavern currently exposes /api/vector/* only as an explicit 501 compatibility
// boundary. In TauriTavern, Aetheria therefore owns the derived vector collection itself:
// embeddings are requested directly from the configured OpenAI-compatible endpoint, while
// vectors are persisted through the documented window.__TAURITAVERN__.api.extension.store ABI.
// Canonical memory remains elsewhere; this module stores rebuildable derived data only.

const STORE_NAMESPACE = 'aetheria-unified-memory-v55';
const STORE_TABLE = 'vectors';
const STORE_VERSION = 1;
const SESSION_SECRET_PREFIX = 'vllm:';

const sessionSecrets = new Map();
const collectionCache = new Map();
const collectionLocks = new Map();
let lastDebug = null;

function clean(value, max = 10000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function getHost() {
    return globalThis.__TAURITAVERN__ || globalThis.window?.__TAURITAVERN__ || null;
}

export function isNativeTauriTavern() {
    const host = getHost();
    return Boolean(host && typeof host === 'object');
}

export function rememberTauriVectorSessionSecret(secretId, value) {
    const id = clean(secretId, 300);
    const secret = clean(value, 20000);
    if (!id || !secret) return false;
    sessionSecrets.set(`${SESSION_SECRET_PREFIX}${id}`, secret);
    return true;
}

export function forgetTauriVectorSessionSecret(secretId) {
    return sessionSecrets.delete(`${SESSION_SECRET_PREFIX}${clean(secretId, 300)}`);
}

export function hasTauriVectorSessionSecret(secretId) {
    return sessionSecrets.has(`${SESSION_SECRET_PREFIX}${clean(secretId, 300)}`);
}

async function hostApi() {
    const host = getHost();
    if (!host) return null;
    try {
        await (host.ready ?? globalThis.window?.__TAURITAVERN_MAIN_READY__ ?? Promise.resolve());
    } catch {
        // The API object can already be usable even if an optional ready promise rejected.
    }
    return host.api || null;
}

async function extensionStore() {
    const api = await hostApi();
    const store = api?.extension?.store;
    if (!store || typeof store.tryGetJson !== 'function' || typeof store.setJson !== 'function') {
        throw new Error('TauriTavern extension.store API 不可用；无法安全持久化 Aetheria 派生向量。');
    }
    return store;
}

function collectionKey(collectionId) {
    const id = clean(collectionId, 2000);
    if (!id) throw new Error('Vector collectionId 为空。');
    return `collection:${id}`;
}

function blankCollection(collectionId) {
    return {
        version: STORE_VERSION,
        collection_id: clean(collectionId, 2000),
        dimension: null,
        items: [],
        updated_at: Date.now(),
    };
}

function normalizeCollection(input, collectionId) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const items = Array.isArray(raw.items) ? raw.items : [];
    return {
        version: STORE_VERSION,
        collection_id: clean(raw.collection_id || collectionId, 2000),
        dimension: Number.isInteger(Number(raw.dimension)) && Number(raw.dimension) > 0 ? Number(raw.dimension) : null,
        items: items.map(row => ({
            hash: Number(row?.hash),
            index: Number.isFinite(Number(row?.index)) ? Number(row.index) : 0,
            text: clean(row?.text, 200000),
            vector: clean(row?.vector, 10_000_000),
            norm: Number(row?.norm) || 0,
        })).filter(row => Number.isFinite(row.hash) && row.vector),
        updated_at: Number(raw.updated_at) || Date.now(),
    };
}

async function loadCollection(collectionId) {
    const key = collectionKey(collectionId);
    if (collectionCache.has(key)) return collectionCache.get(key);
    const store = await extensionStore();
    let raw = null;
    try {
        raw = await store.tryGetJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key });
    } catch {
        raw = null;
    }
    const normalized = normalizeCollection(raw?.value ?? raw, collectionId);
    collectionCache.set(key, normalized);
    return normalized;
}

async function saveCollection(collection) {
    const key = collectionKey(collection.collection_id);
    collection.updated_at = Date.now();
    const store = await extensionStore();
    await store.setJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key, value: collection });
    collectionCache.set(key, collection);
}

async function deleteCollection(collectionId) {
    const key = collectionKey(collectionId);
    const store = await extensionStore();
    if (typeof store.deleteJson === 'function') {
        await store.deleteJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key }).catch(() => {});
    } else {
        await store.setJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key, value: blankCollection(collectionId) });
    }
    collectionCache.delete(key);
}

function withCollectionLock(collectionId, task) {
    const key = collectionKey(collectionId);
    const previous = collectionLocks.get(key) || Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => {});
    collectionLocks.set(key, tail);
    return run.finally(() => {
        if (collectionLocks.get(key) === tail) collectionLocks.delete(key);
    });
}

function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const text = clean(value, 20_000_000);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function encodeVector(vectorInput) {
    const vector = vectorInput instanceof Float32Array ? vectorInput : Float32Array.from(vectorInput || []);
    if (!vector.length) throw new Error('Embedding 返回空向量。');
    return bytesToBase64(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
}

export function decodeVector(value) {
    const bytes = base64ToBytes(value);
    if (bytes.byteLength % 4 !== 0) throw new Error('持久化向量长度无效。');
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Float32Array(copy.buffer);
}

export function vectorNorm(vectorInput) {
    const vector = vectorInput instanceof Float32Array ? vectorInput : Float32Array.from(vectorInput || []);
    let sum = 0;
    for (const value of vector) sum += value * value;
    return Math.sqrt(sum);
}

export function cosineSimilarity(aInput, bInput, normAInput = null, normBInput = null) {
    const a = aInput instanceof Float32Array ? aInput : Float32Array.from(aInput || []);
    const b = bInput instanceof Float32Array ? bInput : Float32Array.from(bInput || []);
    if (!a.length || a.length !== b.length) return -1;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    const normA = Number(normAInput) > 0 ? Number(normAInput) : vectorNorm(a);
    const normB = Number(normBInput) > 0 ? Number(normBInput) : vectorNorm(b);
    if (!normA || !normB) return -1;
    return dot / (normA * normB);
}

function isJinaEndpoint(apiUrl, model) {
    try {
        const host = new URL(apiUrl).hostname.toLowerCase();
        if (host === 'api.jina.ai' || host.endsWith('.jina.ai')) return true;
    } catch {
        // Fall through to model-name detection.
    }
    return /(^|[\/_-])jina[-_/]/i.test(String(model || '')) || /^jina-/i.test(String(model || ''));
}

export function buildDirectEmbeddingBody({ model, texts, apiUrl, role = 'document' }) {
    const body = { model: clean(model, 1000), input: Array.from(texts || [], value => clean(value, 200000)) };
    if (!body.model || !body.input.length || body.input.some(value => !value)) throw new Error('Embedding model/input 配置无效。');
    if (isJinaEndpoint(apiUrl, model)) {
        body.task = role === 'query' ? 'retrieval.query' : 'retrieval.passage';
    }
    return body;
}

async function resolveSecretFromHost(secretId, fetchImpl) {
    // TauriTavern intentionally blocks /api/secrets/find unless allow_keys_exposure is enabled.
    // We attempt it only as an optional convenience. Failure is not bypassed with another secret.
    const id = clean(secretId, 300);
    if (!id || typeof fetchImpl !== 'function') return '';
    try {
        const headers = { 'Content-Type': 'application/json' };
        const settingsResponse = await fetchImpl('/api/secrets/settings', { method: 'POST', headers, body: '{}' });
        if (!settingsResponse.ok) return '';
        const settings = await settingsResponse.json().catch(() => ({}));
        if (settings?.allowKeysExposure !== true && settings?.allow_keys_exposure !== true) return '';
        const response = await fetchImpl('/api/secrets/find', {
            method: 'POST', headers,
            body: JSON.stringify({ key: 'api_key_vllm', id }),
        });
        if (!response.ok) return '';
        const payload = await response.json().catch(() => ({}));
        return clean(payload?.value, 20000);
    } catch {
        return '';
    }
}

async function resolveApiKey(config, fetchImpl) {
    const secretId = clean(config?.secretId, 300);
    const cached = sessionSecrets.get(`${SESSION_SECRET_PREFIX}${secretId}`);
    if (cached) return cached;
    const hostValue = await resolveSecretFromHost(secretId, fetchImpl);
    if (hostValue) {
        rememberTauriVectorSessionSecret(secretId, hostValue);
        return hostValue;
    }
    throw new Error('TauriTavern 已保存 Embedding Secret ID，但当前安全策略不允许扩展读回密钥。请重新输入 API Key 并点击“保存密钥并连接”；密钥只会在本次应用会话内用于直连 Embedding。');
}

function embeddingEndpoint(apiUrl) {
    const base = clean(apiUrl, 4000).replace(/\/+$/, '');
    if (!base) throw new Error('Embedding API URL 为空。');
    return /\/embeddings$/i.test(base) ? base : `${base}/embeddings`;
}

async function requestEmbeddings(config, texts, role, fetchImpl) {
    const apiKey = await resolveApiKey(config, fetchImpl);
    const body = buildDirectEmbeddingBody({ model: config.model, texts, apiUrl: config.apiUrl, role });
    let response;
    try {
        response = await fetchImpl(embeddingEndpoint(config.apiUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });
    } catch (error) {
        throw new Error(`TauriTavern WebView 无法直连 Embedding endpoint：${String(error?.message || error)}。这不是 /api/vector 501；请检查网络/CORS/代理。`);
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Embedding provider 请求失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 500)}` : ''}`);
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.data)) throw new Error('Embedding provider 返回格式无效：缺少 data 数组。');
    const rows = [...payload.data].sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0));
    const vectors = rows.map(row => row?.embedding).filter(Array.isArray);
    if (vectors.length !== texts.length) throw new Error(`Embedding provider 返回向量数量不匹配：期望 ${texts.length}，实际 ${vectors.length}。`);
    const result = vectors.map(vector => Float32Array.from(vector.map(Number)));
    if (result.some(vector => !vector.length || Array.from(vector).some(value => !Number.isFinite(value)))) throw new Error('Embedding provider 返回了空向量或非数值向量。');
    return result;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-aetheria-vector-backend': 'tauritavern-plugin' },
    });
}

function noContentResponse() {
    return new Response(null, { status: 204, headers: { 'x-aetheria-vector-backend': 'tauritavern-plugin' } });
}

function topK(value) {
    return Math.max(1, Math.min(500, Math.floor(Number(value) || 20)));
}

function threshold(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
}

async function insertCollection(payload, config, fetchImpl) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return jsonResponse({ ok: true, inserted: 0 });
    const vectors = await requestEmbeddings(config, items.map(item => item?.text), 'document', fetchImpl);
    return withCollectionLock(payload.collectionId, async () => {
        const collection = await loadCollection(payload.collectionId);
        const dimension = vectors[0]?.length || 0;
        if (collection.dimension && collection.dimension !== dimension) throw new Error(`向量维度变化：集合=${collection.dimension}，新向量=${dimension}。请重建该派生集合。`);
        collection.dimension = dimension;
        const byHash = new Map(collection.items.map(row => [Number(row.hash), row]));
        items.forEach((item, index) => {
            const vector = vectors[index];
            byHash.set(Number(item.hash), {
                hash: Number(item.hash),
                index: Number.isFinite(Number(item.index)) ? Number(item.index) : index,
                text: clean(item.text, 200000),
                vector: encodeVector(vector),
                norm: vectorNorm(vector),
            });
        });
        collection.items = [...byHash.values()];
        await saveCollection(collection);
        lastDebug = { at: Date.now(), action: 'insert', collection_id: payload.collectionId, inserted: items.length, total: collection.items.length, dimension };
        return jsonResponse({ ok: true, inserted: items.length });
    });
}

async function queryCollection(payload, config, fetchImpl) {
    const [queryVector] = await requestEmbeddings(config, [payload.searchText], 'query', fetchImpl);
    const queryNorm = vectorNorm(queryVector);
    return withCollectionLock(payload.collectionId, async () => {
        const collection = await loadCollection(payload.collectionId);
        if (collection.dimension && collection.dimension !== queryVector.length) throw new Error(`查询向量维度与集合不一致：集合=${collection.dimension}，查询=${queryVector.length}。`);
        const ranked = collection.items.map(row => {
            const vector = decodeVector(row.vector);
            return { row, score: cosineSimilarity(queryVector, vector, queryNorm, row.norm) };
        }).filter(row => Number.isFinite(row.score)).sort((a, b) => b.score - a.score).slice(0, topK(payload.topK));
        const min = threshold(payload.threshold);
        const metadata = ranked.filter(result => result.score >= min).map(result => ({ hash: result.row.hash, text: result.row.text, index: result.row.index }));
        // SillyTavern's vector endpoint returns hashes for the topK ranking and applies threshold
        // only to metadata. Preserve that contract so existing Aetheria mappers remain unchanged.
        const hashes = ranked.map(result => Number(result.row.hash));
        lastDebug = { at: Date.now(), action: 'query', collection_id: payload.collectionId, candidates: collection.items.length, returned: metadata.length, threshold: min };
        return jsonResponse({ metadata, hashes });
    });
}

async function listCollection(payload) {
    return withCollectionLock(payload.collectionId, async () => {
        const collection = await loadCollection(payload.collectionId);
        return jsonResponse(collection.items.map(row => Number(row.hash)));
    });
}

async function deleteItems(payload) {
    const hashes = new Set((Array.isArray(payload.hashes) ? payload.hashes : []).map(Number).filter(Number.isFinite));
    return withCollectionLock(payload.collectionId, async () => {
        const collection = await loadCollection(payload.collectionId);
        const before = collection.items.length;
        collection.items = collection.items.filter(row => !hashes.has(Number(row.hash)));
        await saveCollection(collection);
        return jsonResponse({ ok: true, deleted: before - collection.items.length });
    });
}

async function purgeCollection(payload) {
    return withCollectionLock(payload.collectionId, async () => {
        await deleteCollection(payload.collectionId);
        lastDebug = { at: Date.now(), action: 'purge', collection_id: payload.collectionId };
        return noContentResponse();
    });
}

export async function handleTauriVectorRequest(endpoint, payloadInput, configInput, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    if (!isNativeTauriTavern()) return null;
    if (typeof fetchImpl !== 'function') throw new Error('Direct Embedding fetch 不可用。');
    const payload = payloadInput && typeof payloadInput === 'object' ? payloadInput : {};
    const config = configInput && typeof configInput === 'object' ? configInput : {};
    if (!clean(payload.collectionId, 2000)) throw new Error('Tauri vector request 缺少 collectionId。');
    if (['insert', 'query'].includes(endpoint) && (!clean(config.apiUrl, 4000) || !clean(config.model, 1000) || !clean(config.secretId, 300))) {
        throw new Error('Tauri direct Embedding transport 配置不完整。');
    }
    switch (endpoint) {
        case 'insert': return insertCollection(payload, config, fetchImpl);
        case 'query': return queryCollection(payload, config, fetchImpl);
        case 'list': return listCollection(payload);
        case 'delete': return deleteItems(payload);
        case 'purge': return purgeCollection(payload);
        default: throw new Error(`Tauri plugin vector backend 不支持 endpoint: ${endpoint}`);
    }
}

export function getTauriVectorBackendStatus() {
    return {
        active: isNativeTauriTavern(),
        backend: 'tauritavern-plugin-vector-v1',
        persistence: 'window.__TAURITAVERN__.api.extension.store',
        session_secret_count: sessionSecrets.size,
        cached_collection_count: collectionCache.size,
        last_debug: lastDebug ? structuredClone(lastDebug) : null,
    };
}

export function __testResetTauriVectorBackend() {
    sessionSecrets.clear();
    collectionCache.clear();
    collectionLocks.clear();
    lastDebug = null;
}
