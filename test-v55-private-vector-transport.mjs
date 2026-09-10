import assert from 'node:assert/strict';
import { buildPrivateVectorPayload, normalizeOpenAiEmbeddingBaseUrl } from './v55-private-vector-transport.js';
function ctx(secretId = 'secret-a') { return { extensionSettings: { aetheriaUnifiedMemoryV54: { vector_direct_api_enabled: true, vector_direct_api_url: 'https://api.jina.ai/v1/embeddings', vector_direct_api_model: 'jina-embeddings-v3', vector_direct_api_secret_id: secretId } } }; }
assert.equal(normalizeOpenAiEmbeddingBaseUrl('https://api.jina.ai/v1/embeddings'), 'https://api.jina.ai/v1');
const a = buildPrivateVectorPayload({ collectionId: 'aetheria_v54_chat', source: 'transformers', items: [] }, 'insert', ctx('secret-a'));
assert.equal(a.payload.source, 'vllm');
assert.equal(a.payload.secret_id, 'secret-a');
assert.ok(a.payload.collectionId.includes('__aum_private_'));
const b = buildPrivateVectorPayload({ collectionId: 'aetheria_v54_chat', source: 'transformers', items: [] }, 'insert', ctx('secret-b'));
assert.notEqual(a.payload.collectionId, b.payload.collectionId);
assert.throws(() => buildPrivateVectorPayload({ collectionId: 'aetheria_v54_chat' }, 'query', ctx('')), /配置不完整/);
console.log('PASS v5.5 private vector transport: credential identity is explicit and incomplete isolation fails closed');
