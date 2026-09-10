import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    __testResetTauriVectorBackend,
    buildDirectEmbeddingBody,
    clearTauriVectorApiKey,
    cosineSimilarity,
    ensureTauriVectorApiKeyLoaded,
    decodeVector,
    encodeVector,
    getTauriVectorApiKey,
    handleTauriVectorRequest,
    rememberTauriVectorSessionSecret,
    resolveOpenAiCompatibleBaseUrl,
    safeCollectionStoreKey,
    setTauriVectorApiKey,
} from './v55-tauri-vector-backend.js';

__testResetTauriVectorBackend();

const encoded = encodeVector([1, 2, 3]);
assert.deepEqual(Array.from(decodeVector(encoded)), [1, 2, 3]);
assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-6);
assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-6);

assert.equal(resolveOpenAiCompatibleBaseUrl('https://api.jina.ai'), 'https://api.jina.ai/v1');
assert.equal(resolveOpenAiCompatibleBaseUrl('https://api.jina.ai/v1'), 'https://api.jina.ai/v1');
assert.equal(resolveOpenAiCompatibleBaseUrl('https://api.jina.ai/v1/embeddings'), 'https://api.jina.ai/v1');
const safeKey = safeCollectionStoreKey('aetheria_v55_tauri_probe:space/with?illegal#chars');
assert.match(safeKey, /^[A-Za-z0-9_-]+$/);
assert.ok(!safeKey.includes(':'));

const storageMap = new Map();
globalThis.localStorage = {
    getItem(key) { return storageMap.get(key) ?? null; },
    setItem(key, value) { storageMap.set(key, String(value)); },
    removeItem(key) { storageMap.delete(key); },
};
setTauriVectorApiKey('jina-persistent-key');
assert.equal(getTauriVectorApiKey(), 'jina-persistent-key');
assert.equal(storageMap.get('aetheria_v55_embedding_api_key') ?? null, null, 'Embedding API key must not be persisted in WebView localStorage');

const jinaQuery = buildDirectEmbeddingBody({ model: 'jina-embeddings-v3', texts: ['hello'], apiUrl: 'https://api.jina.ai/v1', role: 'query' });
assert.equal(jinaQuery.task, 'retrieval.query');
const jinaDocument = buildDirectEmbeddingBody({ model: 'jina-embeddings-v3', texts: ['hello'], apiUrl: 'https://api.jina.ai/v1', role: 'document' });
assert.equal(jinaDocument.task, 'retrieval.passage');

const kv = new Map();
const storeKeys = [];
const storeDeletes = [];
const store = {
    async tryGetJson({ namespace, table, key }) { storeKeys.push(key); const stored = kv.get(`${namespace}|${table}|${key}`); return stored === undefined ? { found: false } : { found: true, value: structuredClone(stored) }; },
    async setJson({ namespace, table, key, value }) { storeKeys.push(key); assert.match(key, /^[A-Za-z0-9_-]+$/); kv.set(`${namespace}|${table}|${key}`, structuredClone(value)); return true; },
    // Mirrors TauriTavern: deleting an absent key raises CommandError::NotFound, which the Rust
    // layer (log_user_visible_error) surfaces as a global "后端错误" toast that JS cannot suppress.
    async deleteJson({ namespace, table, key }) {
        storeKeys.push(key); storeDeletes.push(key); assert.match(key, /^[A-Za-z0-9_-]+$/);
        const composed = `${namespace}|${table}|${key}`;
        if (!kv.has(composed)) { const error = new Error(`Not found: Extension store JSON entry not found: ${key}`); error.details = { code: 'NotFound' }; throw error; }
        kv.delete(composed); return true;
    },
};
globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { extension: { store } } };

// Credential durability: the Aetheria-owned key belongs in the host extension store rather than the
// WebView, because an Android WebView is torn down and recreated constantly and an in-memory-only
// key forced the user to retype it on essentially every launch.
setTauriVectorApiKey('jina-persistent-key');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(kv.get('aetheria-unified-memory-v55|credentials|embedding_api_key'), 'jina-persistent-key', 'the key is persisted to the host extension store');
__testResetTauriVectorBackend();
assert.equal(getTauriVectorApiKey(), '', 'reset clears the in-memory key');
assert.equal(await ensureTauriVectorApiKeyLoaded(), true, 'the persisted key is re-hydrated after a WebView reload');
assert.equal(getTauriVectorApiKey(), 'jina-persistent-key');

// The exact defect the live TauriTavern run exposed: the host store reports absence as
// { found: false }, and treating that wrapper as a value produced the literal string
// "[object Object]", which then went out as the provider Bearer token and came back 401 on every
// Embedding call. A missing entry must stay missing, and an object must never become a key.
__testResetTauriVectorBackend();
kv.delete('aetheria-unified-memory-v55|credentials|embedding_api_key');
assert.equal(await ensureTauriVectorApiKeyLoaded(), false, 'a missing credential entry must not hydrate anything');
assert.equal(getTauriVectorApiKey(), '');
assert.equal(setTauriVectorApiKey({ found: false }), false, 'an object must never be accepted as a key');
assert.equal(setTauriVectorApiKey(['x']), false);
assert.equal(getTauriVectorApiKey(), '');

const providerCalls = [];
function vectorFor(text) {
    const value = String(text).toLowerCase();
    if (value.includes('alpha')) return [1, 0, 0];
    if (value.includes('beta')) return [0, 1, 0];
    return [0, 0, 1];
}
async function providerFetch(url, init = {}) {
    providerCalls.push({ url: String(url), body: JSON.parse(init.body || '{}') });
    assert.equal(String(url), 'https://api.jina.ai/v1/embeddings', 'Tauri backend must normalize origin to /v1/embeddings and never call host /api/vector');
    assert.equal(String(init.headers?.Authorization || ''), 'Bearer jina-persistent-key');
    const body = JSON.parse(init.body || '{}');
    return new Response(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: vectorFor(text) })) }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const config = { apiUrl: 'https://api.jina.ai', model: 'jina-embeddings-v3', secretId: 'aetheria_local_embedding' };
rememberTauriVectorSessionSecret(config.secretId, 'jina-persistent-key');

let response = await handleTauriVectorRequest('insert', {
    collectionId: 'aetheria_v54_tauri_test:unsafe/path',
    items: [{ hash: 11, text: 'alpha memory', index: 0 }, { hash: 22, text: 'beta memory', index: 1 }],
}, config, providerFetch);
assert.equal(response.status, 200);
assert.equal(providerCalls[0].body.task, 'retrieval.passage');

response = await handleTauriVectorRequest('query', {
    collectionId: 'aetheria_v54_tauri_test:unsafe/path', searchText: 'alpha query', topK: 2, threshold: 0.5,
}, config, providerFetch);
const query = await response.json();
assert.equal(providerCalls[1].body.task, 'retrieval.query');
assert.equal(query.metadata.length, 1);
assert.equal(query.metadata[0].hash, 11);
assert.deepEqual(query.hashes, [11, 22]);

response = await handleTauriVectorRequest('list', { collectionId: 'aetheria_v54_tauri_test:unsafe/path' }, config, providerFetch);
assert.deepEqual((await response.json()).sort((a, b) => a - b), [11, 22]);
await handleTauriVectorRequest('delete', { collectionId: 'aetheria_v54_tauri_test:unsafe/path', hashes: [11] }, config, providerFetch);
response = await handleTauriVectorRequest('list', { collectionId: 'aetheria_v54_tauri_test:unsafe/path' }, config, providerFetch);
assert.deepEqual(await response.json(), [22]);
response = await handleTauriVectorRequest('purge', { collectionId: 'aetheria_v54_tauri_test:unsafe/path' }, config, providerFetch);
assert.equal(response.status, 204);
assert.equal(storeDeletes.length, 1, 'purging a persisted collection deletes its store entry exactly once');

storeDeletes.length = 0;
response = await handleTauriVectorRequest('purge', { collectionId: 'aetheria_v55_never_persisted' }, config, providerFetch);
assert.equal(response.status, 204);
assert.deepEqual(storeDeletes, [], 'purging a collection that was never persisted must not reach deleteJson (TauriTavern answers that with a user-visible NotFound toast)');

assert.ok(providerCalls.every(call => !call.url.includes('/api/vector/')));
assert.ok(storeKeys.every(key => /^[A-Za-z0-9_-]+$/.test(key)));
const backendSource = fs.readFileSync(new URL('./v55-tauri-vector-backend.js', import.meta.url), 'utf8');
assert.doesNotMatch(backendSource, /\/api\/secrets\/(write|read|rotate|find)/);

await clearTauriVectorApiKey();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(kv.has('aetheria-unified-memory-v55|credentials|embedding_api_key'), false, 'clearing the key also clears the persisted copy');
assert.equal(getTauriVectorApiKey(), '');

delete globalThis.__TAURITAVERN__;
delete globalThis.localStorage;
__testResetTauriVectorBackend();
console.log('PASS v5.5 Tauri vector backend: LittleWhiteBox-style API isolation + /v1 normalization + safe extension-store keys + idempotent store purge + durable credential');
