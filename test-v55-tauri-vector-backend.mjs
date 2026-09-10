import assert from 'node:assert/strict';
import {
    __testResetTauriVectorBackend,
    buildDirectEmbeddingBody,
    cosineSimilarity,
    decodeVector,
    encodeVector,
    handleTauriVectorRequest,
    rememberTauriVectorSessionSecret,
} from './v55-tauri-vector-backend.js';

__testResetTauriVectorBackend();

const encoded = encodeVector([1, 2, 3]);
assert.deepEqual(Array.from(decodeVector(encoded)), [1, 2, 3]);
assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-6);
assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-6);

const jinaQuery = buildDirectEmbeddingBody({
    model: 'jina-embeddings-v3',
    texts: ['hello'],
    apiUrl: 'https://api.jina.ai/v1',
    role: 'query',
});
assert.equal(jinaQuery.task, 'retrieval.query');
const jinaDocument = buildDirectEmbeddingBody({
    model: 'jina-embeddings-v3',
    texts: ['hello'],
    apiUrl: 'https://api.jina.ai/v1',
    role: 'document',
});
assert.equal(jinaDocument.task, 'retrieval.passage');

const kv = new Map();
const store = {
    async tryGetJson({ namespace, table, key }) { return kv.get(`${namespace}|${table}|${key}`) ?? null; },
    async setJson({ namespace, table, key, value }) { kv.set(`${namespace}|${table}|${key}`, structuredClone(value)); return true; },
    async deleteJson({ namespace, table, key }) { kv.delete(`${namespace}|${table}|${key}`); return true; },
};
globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { extension: { store } } };

const providerCalls = [];
function vectorFor(text) {
    const value = String(text).toLowerCase();
    if (value.includes('alpha')) return [1, 0, 0];
    if (value.includes('beta')) return [0, 1, 0];
    return [0, 0, 1];
}
async function providerFetch(url, init = {}) {
    providerCalls.push({ url: String(url), body: JSON.parse(init.body || '{}') });
    assert.equal(String(url), 'https://api.jina.ai/v1/embeddings', 'Tauri backend must call Jina directly, never host /api/vector');
    assert.match(String(init.headers?.Authorization || ''), /^Bearer /);
    const body = JSON.parse(init.body || '{}');
    return new Response(JSON.stringify({
        data: body.input.map((text, index) => ({ index, embedding: vectorFor(text) })),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const config = {
    apiUrl: 'https://api.jina.ai/v1',
    model: 'jina-embeddings-v3',
    secretId: 'secret-test',
};
rememberTauriVectorSessionSecret(config.secretId, 'jina-test-key');

let response = await handleTauriVectorRequest('insert', {
    collectionId: 'aetheria_v54_tauri_test',
    items: [
        { hash: 11, text: 'alpha memory', index: 0 },
        { hash: 22, text: 'beta memory', index: 1 },
    ],
}, config, providerFetch);
assert.equal(response.status, 200);
assert.equal(providerCalls[0].body.task, 'retrieval.passage');

response = await handleTauriVectorRequest('query', {
    collectionId: 'aetheria_v54_tauri_test',
    searchText: 'alpha query',
    topK: 2,
    threshold: 0.5,
}, config, providerFetch);
const query = await response.json();
assert.equal(providerCalls[1].body.task, 'retrieval.query');
assert.equal(query.metadata.length, 1);
assert.equal(query.metadata[0].hash, 11);
assert.deepEqual(query.hashes, [11, 22]);

response = await handleTauriVectorRequest('list', { collectionId: 'aetheria_v54_tauri_test' }, config, providerFetch);
assert.deepEqual((await response.json()).sort((a, b) => a - b), [11, 22]);

await handleTauriVectorRequest('delete', { collectionId: 'aetheria_v54_tauri_test', hashes: [11] }, config, providerFetch);
response = await handleTauriVectorRequest('list', { collectionId: 'aetheria_v54_tauri_test' }, config, providerFetch);
assert.deepEqual(await response.json(), [22]);

response = await handleTauriVectorRequest('purge', { collectionId: 'aetheria_v54_tauri_test' }, config, providerFetch);
assert.equal(response.status, 204);
response = await handleTauriVectorRequest('list', { collectionId: 'aetheria_v54_tauri_test' }, config, providerFetch);
assert.deepEqual(await response.json(), []);

assert.ok(providerCalls.every(call => !call.url.includes('/api/vector/')));
delete globalThis.__TAURITAVERN__;
__testResetTauriVectorBackend();
console.log('PASS v5.5 Tauri vector backend: direct Jina embedding + extension-store persistence + cosine retrieval');
