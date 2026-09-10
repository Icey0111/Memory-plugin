import assert from 'node:assert/strict';
import {
    buildPrivateVectorPayload,
    getPrivateVectorTransportStatus,
    installV55PrivateVectorTransport,
    normalizeOpenAiEmbeddingBaseUrl,
    resetPrivateVectorTransportBreaker,
} from './v55-private-vector-transport.js';
import { setTauriVectorApiKey } from './v55-tauri-vector-backend.js';

function ctx(secretId = 'secret-a') { return { extensionSettings: { aetheriaUnifiedMemoryV54: { vector_direct_api_enabled: true, vector_direct_api_url: 'https://api.jina.ai/v1/embeddings', vector_direct_api_model: 'jina-embeddings-v3', vector_direct_api_secret_id: secretId } } }; }
assert.equal(normalizeOpenAiEmbeddingBaseUrl('https://api.jina.ai/v1/embeddings'), 'https://api.jina.ai/v1');
const a = buildPrivateVectorPayload({ collectionId: 'aetheria_v54_chat', source: 'transformers', items: [] }, 'insert', ctx('secret-a'));
assert.equal(a.payload.source, 'vllm');
assert.equal(a.payload.secret_id, 'secret-a');
assert.ok(a.payload.collectionId.includes('__aum_private_'));
const b = buildPrivateVectorPayload({ collectionId: 'aetheria_v54_chat', source: 'transformers', items: [] }, 'insert', ctx('secret-b'));
assert.notEqual(a.payload.collectionId, b.payload.collectionId);
assert.throws(() => buildPrivateVectorPayload({ collectionId: 'aetheria_v54_chat' }, 'query', ctx('')), /配置不完整/);

// --- transport brake -------------------------------------------------------------------------
// Dense vector calls sit inside the turn pipeline, so a provider this device cannot reach must not
// be retried at full cost on every turn. Drive the real interception path rather than the unit seams.
const settings = { vector_direct_api_enabled: true, vector_direct_api_url: 'https://api.jina.ai/v1/embeddings', vector_direct_api_model: 'jina-embeddings-v3', vector_direct_api_secret_id: 'aetheria_local_embedding' };
const liveCtx = {
    extensionSettings: { aetheriaUnifiedMemoryV54: settings },
    chatMetadata: {},
    saveSettingsDebounced() {},
    saveMetadataDebounced() {},
};
globalThis.SillyTavern = { getContext: () => liveCtx };

const store = { async tryGetJson() { return { found: false }; }, async setJson() { return true; } };
const host = {
    ready: Promise.resolve(),
    api: { extension: { store } },
    invoke: { async safeInvoke() { throw new Error('The request timed out before the target service responded. (https://api.jina.ai/v1/embeddings)'); } },
};
globalThis.__TAURITAVERN__ = host;
setTauriVectorApiKey('breaker-test-key');
installV55PrivateVectorTransport();

const insert = () => globalThis.fetch('/api/vector/insert', { method: 'POST', body: JSON.stringify({ collectionId: 'aetheria_v54_breaker_test', items: [{ hash: 7, text: 'alpha', index: 0 }] }) });
const capture = promise => promise.then(() => null, error => error);

for (let attempt = 1; attempt <= 3; attempt++) {
    const error = await capture(insert());
    assert.ok(error, `attempt ${attempt} must fail while the provider is unreachable`);
    assert.match(error.message, /Native HTTP Embedding/);
}

const status = getPrivateVectorTransportStatus(liveCtx);
assert.equal(status.transport_breaker.failures, 3, 'three unreachable attempts are counted');
assert.ok(status.transport_breaker.open_until > Date.now(), 'three unreachable attempts open the brake');
assert.match(status.transport_breaker.reason, /timed out/);

const braked = await capture(insert());
assert.match(braked.message, /连续失败 3 次/);
assert.match(braked.message, /暂停/);

// A provider that answered and rejected the request is reachable; that is configuration to fix, not
// an outage, so it must never open the brake.
resetPrivateVectorTransportBreaker();
host.invoke.safeInvoke = async () => { throw new Error('Embedding provider 请求失败：HTTP 400 model not found'); };
for (let attempt = 0; attempt < 4; attempt++) {
    const error = await capture(insert());
    assert.match(error.message, /HTTP 400/);
    assert.doesNotMatch(error.message, /连续失败/);
    assert.equal(getPrivateVectorTransportStatus(liveCtx).transport_breaker.failures, 0);
}

delete globalThis.__TAURITAVERN__;
console.log('PASS v5.5 private vector transport: credential identity is explicit, incomplete isolation fails closed, and an unreachable provider is braked instead of retried on every turn');
