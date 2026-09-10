// Aetheria Unified Memory v5.5 — TauriTavern plugin-owned vector backend.
// Native TauriTavern does not implement /api/vector yet, so Aetheria owns its derived
// vector collections in extension.store and calls the configured embedding provider directly.
// IMPORTANT: this module never reads, writes, rotates, or depends on TauriTavern/SillyTavern
// provider secrets. The embedding key is Aetheria-owned, following LittleWhiteBox's isolation model.

const STORE_NAMESPACE = 'aetheria-unified-memory-v55';
const STORE_TABLE = 'vectors';
const STORE_VERSION = 2;
const LOCAL_API_KEY = 'aetheria_v55_embedding_api_key';
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
    return Boolean(getHost());
}

function localStore() {
    try { return globalThis.localStorage || globalThis.window?.localStorage || null; }
    catch { return null; }
}

export function setTauriVectorApiKey(value) {
    const key = clean(value, 20000);
    if (!key) return false;
    sessionSecrets.set('aetheria', key);
    const storage = localStore();
    try { storage?.setItem(LOCAL_API_KEY, key); } catch { /* session copy still works */ }
    return true;
}

export function getTauriVectorApiKey() {
    const cached = sessionSecrets.get('aetheria');
    if (cached) return cached;
    const storage = localStore();
    let value = '';
    try { value = clean(storage?.getItem(LOCAL_API_KEY), 20000); } catch { value = ''; }
    if (value) sessionSecrets.set('aetheria', value);
    return value;
}

export function clearTauriVectorApiKey() {
    sessionSecrets.delete('aetheria');
    try { localStore()?.removeItem(LOCAL_API_KEY); } catch { /* ignore */ }
}

// Compatibility exports retained for Iteration10/11 tests and callers.
export function rememberTauriVectorSessionSecret(_secretId, value) { return setTauriVectorApiKey(value); }
export function forgetTauriVectorSessionSecret(_secretId) { clearTauriVectorApiKey(); return true; }
export function hasTauriVectorSessionSecret(_secretId) { return Boolean(getTauriVectorApiKey()); }

async function hostApi() {
    const host = getHost();
    if (!host) return null;
    try { await (host.ready ?? globalThis.window?.__TAURITAVERN_MAIN_READY__ ?? Promise.resolve()); } catch { /* best effort */ }
    return host.api || null;
}

async function extensionStore() {
    const api = await hostApi();
    const store = api?.extension?.store;
    if (!store || typeof store.tryGetJson !== 'function' || typeof store.setJson !== 'function') {
        throw new Error('TauriTavern extension.store API 不可用；无法持久化 Aetheria 派生向量。');
    }
    return store;
}

function fnv1a32(value, seed = 0x811c9dc5) {
    let hash = seed >>> 0;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

export function safeCollectionStoreKey(collectionId) {
    const id = clean(collectionId, 4000);
    if (!id) throw new Error('Vector collectionId 为空。');
    // TauriTavern extension store keys reject characters such as ':'. Use a deterministic,
    // collision-resistant-enough pair of 32-bit hashes and only [A-Za-z0-9_-].
    const a = fnv1a32(id).toString(36);
    const b = fnv1a32(`${id.length}|${id}`, 0x9e3779b9).toString(36);
    return `c_${a}_${b}`;
}

function blankCollection(collectionId) {
    return { version: STORE_VERSION, collection_id: clean(collectionId, 4000), dimension: null, items: [], updated_at: Date.now() };
}

function normalizeCollection(input, collectionId) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const items = Array.isArray(raw.items) ? raw.items : [];
    return {
        version: STORE_VERSION,
        collection_id: clean(raw.collection_id || collectionId, 4000),
        dimension: Number(raw.dimension) > 0 ? Number(raw.dimension) : null,
        items: items.map(row => ({
            hash: Number(row?.hash),
            index: Number.isFinite(Number(row?.index)) ? Number(row.index) : 0,
            text: clean(row?.text, 200000),
            vector: clean(row?.vector, 20_000_000),
            norm: Number(row?.norm) || 0,
        })).filter(row => Number.isFinite(row.hash) && row.vector),
        updated_at: Number(raw.updated_at) || Date.now(),
    };
}

async function loadCollection(collectionId) {
    const key = safeCollectionStoreKey(collectionId);
    if (collectionCache.has(key)) return collectionCache.get(key);
    const store = await extensionStore();
    let raw = null;
    try { raw = await store.tryGetJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key }); } catch { raw = null; }
    const collection = normalizeCollection(raw?.value ?? raw, collectionId);
    collectionCache.set(key, collection);
    return collection;
}

async function saveCollection(collection) {
    const key = safeCollectionStoreKey(collection.collection_id);
    collection.updated_at = Date.now();
    const store = await extensionStore();
    await store.setJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key, value: collection });
    collectionCache.set(key, collection);
}

async function deleteCollection(collectionId) {
    const key = safeCollectionStoreKey(collectionId);
    const store = await extensionStore();
    if (typeof store.deleteJson === 'function') {
        await store.deleteJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key }).catch(() => {});
    } else {
        await store.setJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key, value: blankCollection(collectionId) });
    }
    collectionCache.delete(key);
}

function withCollectionLock(collectionId, task) {
    const key = safeCollectionStoreKey(collectionId);
    const previous = collectionLocks.get(key) || Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => {});
    collectionLocks.set(key, tail);
    return run.finally(() => { if (collectionLocks.get(key) === tail) collectionLocks.delete(key); });
}

function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
    return btoa(binary);
}

function base64ToBytes(value) {
    const text = clean(value, 30_000_000);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
    const binary = atob(text); const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

export function encodeVector(vectorInput) {
    const vector = vectorInput instanceof Float32Array ? vectorInput : Float32Array.from(vectorInput || []);
    if (!vector.length) throw new Error('Embedding 返回空向量。');
    return bytesToBase64(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
}

export function decodeVector(value) {
    const bytes = base64ToBytes(value);
    if (bytes.byteLength % 4) throw new Error('持久化向量长度无效。');
    const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
    return new Float32Array(copy.buffer);
}

export function vectorNorm(vectorInput) {
    const vector = vectorInput instanceof Float32Array ? vectorInput : Float32Array.from(vectorInput || []);
    let sum = 0; for (const value of vector) sum += value * value; return Math.sqrt(sum);
}

export function cosineSimilarity(aInput, bInput, normAInput = null, normBInput = null) {
    const a = aInput instanceof Float32Array ? aInput : Float32Array.from(aInput || []);
    const b = bInput instanceof Float32Array ? bInput : Float32Array.from(bInput || []);
    if (!a.length || a.length !== b.length) return -1;
    let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    const na = Number(normAInput) > 0 ? Number(normAInput) : vectorNorm(a);
    const nb = Number(normBInput) > 0 ? Number(normBInput) : vectorNorm(b);
    return na && nb ? dot / (na * nb) : -1;
}

function isJina(apiUrl, model) {
    try { const host = new URL(apiUrl).hostname.toLowerCase(); if (host === 'api.jina.ai' || host.endsWith('.jina.ai')) return true; } catch { /* ignore */ }
    return /^jina-/i.test(String(model || ''));
}

export function buildDirectEmbeddingBody({ model, texts, apiUrl, role = 'document' }) {
    const body = { model: clean(model, 1000), input: Array.from(texts || [], value => clean(value, 200000)) };
    if (!body.model || !body.input.length || body.input.some(value => !value)) throw new Error('Embedding model/input 配置无效。');
    if (isJina(apiUrl, model)) body.task = role === 'query' ? 'retrieval.query' : 'retrieval.passage';
    return body;
}

export function resolveOpenAiCompatibleBaseUrl(value) {
    let base = clean(value, 4000).replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!base) return '';
    base = base.replace(/\/(?:embeddings|models)$/i, '').replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
    // Mirror LittleWhiteBox: if the user entered only the service origin, append /v1.
    if (!/\/v\d[\w.-]*$/i.test(base)) base = `${base}/v1`;
    return base;
}

export function embeddingEndpoint(value) {
    const base = resolveOpenAiCompatibleBaseUrl(value);
    if (!base) throw new Error('Embedding API URL 为空。');
    return `${base}/embeddings`;
}

async function requestEmbeddings(config, texts, role, fetchImpl) {
    const apiKey = getTauriVectorApiKey();
    if (!apiKey) throw new Error('Aetheria Embedding API Key 未配置。请在插件的向量 API 区域重新输入并保存；不会读取或修改酒馆自己的 API Key。');
    const baseUrl = resolveOpenAiCompatibleBaseUrl(config.apiUrl);
    const body = buildDirectEmbeddingBody({ model: config.model, texts, apiUrl: baseUrl, role });
    let response;
    try {
        response = await fetchImpl(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        });
    } catch (error) {
        throw new Error(`Embedding 网络请求失败：${String(error?.message || error)}。请检查网络/CORS/代理。`);
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Embedding provider 请求失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 500)}` : ''}`);
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.data)) throw new Error('Embedding provider 返回格式无效：缺少 data 数组。');
    const rows = [...payload.data].sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0));
    const vectors = rows.map(row => row?.embedding).filter(Array.isArray).map(row => Float32Array.from(row.map(Number)));
    if (vectors.length !== texts.length) throw new Error(`Embedding provider 返回向量数量不匹配：期望 ${texts.length}，实际 ${vectors.length}。`);
    if (vectors.some(v => !v.length || Array.from(v).some(x => !Number.isFinite(x)))) throw new Error('Embedding provider 返回空向量或非数值向量。');
    return vectors;
}

function jsonResponse(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-aetheria-vector-backend': 'tauritavern-plugin' } }); }
function noContentResponse() { return new Response(null, { status: 204, headers: { 'x-aetheria-vector-backend': 'tauritavern-plugin' } }); }
function topK(value) { return Math.max(1, Math.min(500, Math.floor(Number(value) || 20)); }
function threshold(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0; }

async function insertCollection(payload, config, fetchImpl) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return jsonResponse({ ok: true, inserted: 0 });
    const vectors = await requestEmbeddings(config, items.map(item => item?.text), 'document', fetchImpl);
    return withCollectionLock(payload.collectionId, async () => {
        const collection = await loadCollection(payload.collectionId);
        const dimension = vectors[0]?.length || 0;
        if (collection.dimension && collection.dimension !== dimension) throw new Error(`向量维度变化：集合=${collection.dimension}，新向量=${dimension}。请重建派生集合。`);
        collection.dimension = dimension;
        const byHash = new Map(collection.items.map(row => [Number(row.hash), row]));
        items.forEach((item, index) => {
            const vector = vectors[index];
            byHash.set(Number(item.hash), { hash: Number(item.hash), index: Number.isFinite(Number(item.index)) ? Number(item.index) : index, text: clean(item.text, 200000), vector: encodeVector(vector), norm: vectorNorm(vector) });
        });
        collection.items = [...byHash.values()]; await saveCollection(collection);
        lastDebug = { at: Date.now(), action: 'insert', collection_id: payload.collectionId, inserted: items.length, total: collection.items.length, dimension };
        return jsonResponse({ ok: true, inserted: items.length });
    });
}

async function queryCollection(payload, config, fetchImpl) {
    const [queryVector] = await requestEmbeddings(config, [payload.searchText], 'query', fetchImpl);
    const qn = vectorNorm(queryVector);
    return withCollectionLock(payload.collectionId, async () => {
        const collection = await loadCollection(payload.collectionId);
        if (collection.dimension && collection.dimension !== queryVector.length) throw new Error(`查询向量维度与集合不一致：集合=${collection.dimension}，查询=${queryVector.length}。`);
        const ranked = collection.items.map(row => ({ row, score: cosineSimilarity(queryVector, decodeVector(row.vector), qn, row.norm) })).filter(x => Number.isFinite(x.score)).sort((a, b) => b.score - a.score).slice(0, topK(payload.topK));
        const min = threshold(payload.threshold);
        const metadata = ranked.filter(x => x.score >= min).map(x => ({ hash: x.row.hash, text: x.row.text, index: x.row.index }));
        const hashes = ranked.map(x => Number(x.row.hash));
        lastDebug = { at: Date.now(), action: 'query', collection_id: payload.collectionId, candidates: collection.items.length, returned: metadata.length, threshold: min };
        return jsonResponse({ metadata, hashes });
    });
}

async function listCollection(payload) { return withCollectionLock(payload.collectionId, async () => jsonResponse((await loadCollection(payload.collectionId)).items.map(row => Number(row.hash)))); }
async function deleteItems(payload) {
    const hashes = new Set((Array.isArray(payload.hashes) ? payload.hashes : []).map(Number).filter(Number.isFinite));
    return withCollectionLock(payload.collectionId, async () => {
        const collection = await loadCollection(payload.collectionId); const before = collection.items.length;
        collection.items = collection.items.filter(row => !hashes.has(Number(row.hash))); await saveCollection(collection);
        return jsonResponse({ ok: true, deleted: before - collection.items.length });
    });
}
async function purgeCollection(payload) { return withCollectionLock(payload.collectionId, async () => { await deleteCollection(payload.collectionId); lastDebug = { at: Date.now(), action: 'purge', collection_id: payload.collectionId }; return noContentResponse(); }); }

export async function handleTauriVectorRequest(endpoint, payloadInput, configInput, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    if (!isNativeTauriTavern()) return null;
    if (typeof fetchImpl !== 'function') throw new Error('Direct Embedding fetch 不可用。');
    const payload = payloadInput && typeof payloadInput === 'object' ? payloadInput : {};
    const config = configInput && typeof configInput === 'object' ? configInput : {};
    if (!clean(payload.collectionId, 4000)) throw new Error('Tauri vector request 缺少 collectionId。');
    if (['insert', 'query'].includes(endpoint) && (!clean(config.apiUrl, 4000) || !clean(config.model, 1000))) throw new Error('Tauri direct Embedding transport 配置不完整。');
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
    return { active: isNativeTauriTavern(), backend: 'tauritavern-plugin-vector-v2', persistence: 'window.__TAURITAVERN__.api.extension.store', credential_scope: 'aetheria-localStorage', has_api_key: Boolean(getTauriVectorApiKey()), cached_collection_count: collectionCache.size, last_debug: lastDebug ? structuredClone(lastDebug) : null };
}

export function __testResetTauriVectorBackend() { sessionSecrets.clear(); collectionCache.clear(); collectionLocks.clear(); lastDebug = null; }
