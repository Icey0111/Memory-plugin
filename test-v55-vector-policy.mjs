import assert from 'node:assert/strict';
import { configureV55VectorPolicy, ensureCurrentVectorSpaceIdentity, getV55EmbeddingProfile, rewriteAetheriaPolicyPayload } from './v55-vector-policy.js';
function makeSettings(overrides = {}) { return { vector_direct_api_enabled: true, vector_direct_api_url: 'https://api.example.com/v1/embeddings', vector_direct_api_model: 'intfloat/multilingual-e5-large', vector_embedding_family: 'auto', vector_embedding_role_strategy: 'auto', vector_embedding_query_prefix: '', vector_embedding_document_prefix: '', vector_embedding_dimensions: '', vector_embedding_normalization: 'auto', vector_score_memory_threshold: 0.33, vector_score_setting_threshold: '', vector_score_baseline_threshold: '', vector_multi_query_fusion: true, vector_multi_query_rrf_k: 60, vector_profile_policy_version: 3, ...overrides }; }
function makeCtx(settings = makeSettings()) { return { extensionSettings: { aetheriaUnifiedMemoryV54: settings, vectors: { source: 'transformers' } }, chatMetadata: { aetheriaUnifiedMemoryV54: { memories: {}, vector: {}, baseline: { vector: {} } } }, textCompletionSettings: { server_urls: {} }, chatCompletionSettings: {}, saveSettingsDebounced() {}, saveMetadataDebounced() {} }; }
const c = makeCtx();
const p = getV55EmbeddingProfile(c);
assert.equal(p.family, 'e5');
assert.equal(p.role_strategy, 'prefix');
const inserted = rewriteAetheriaPolicyPayload({ source: 'transformers', collectionId: 'aetheria_v54_demo', items: [{ hash: 1, text: 'memory text', index: 0 }] }, 'insert', c);
assert.ok(inserted.payload.collectionId.includes('__aum_space_'));
assert.equal(inserted.payload.items[0].text, 'passage: memory text');
const queried = rewriteAetheriaPolicyPayload({ source: 'transformers', collectionId: 'aetheria_v54_demo', searchText: 'where', topK: 10, threshold: 0.22 }, 'query', c);
assert.equal(queried.payload.searchText, 'query: where');
assert.equal(queried.payload.threshold, 0.33);
const host = makeCtx(makeSettings({ vector_direct_api_enabled: false }));
host.extensionSettings.vectors = { source: 'vllm', vllm_model: 'intfloat/multilingual-e5-large', use_alt_endpoint: true, alt_endpoint_url: 'http://localhost:8000/v1' };
const hostQuery = rewriteAetheriaPolicyPayload({ source: 'vllm', model: 'intfloat/multilingual-e5-large', apiUrl: 'http://localhost:8000/v1', collectionId: 'aetheria_v54_host', searchText: 'question', threshold: 0.22 }, 'query', host);
assert.equal(hostQuery.payload.collectionId, 'aetheria_v54_host');
assert.equal(hostQuery.payload.searchText, 'query: question');
const threshold = makeCtx(makeSettings({ vector_score_memory_threshold: 0.49 }));
assert.equal(getV55EmbeddingProfile(c).space_fingerprint, getV55EmbeddingProfile(threshold).space_fingerprint);
assert.notEqual(getV55EmbeddingProfile(c).retrieval_policy_fingerprint, getV55EmbeddingProfile(threshold).retrieval_policy_fingerprint);
const shared = makeSettings();
const a = makeCtx(shared), b = makeCtx(shared), oldProfile = getV55EmbeddingProfile(a);
shared.vector_embedding_policy_signature = oldProfile.space_fingerprint;
for (const x of [a, b]) {
  x.chatMetadata.aetheriaUnifiedMemoryV54.memories = { m_indexed: { id: 'm_indexed', vector_hash: 424242, text: 'a row that really lives in the dense index' } };
  x.chatMetadata.aetheriaUnifiedMemoryV54.vector = { fingerprint: 'provider-built', stale: false, last_sync_at: 1, space_fingerprint: oldProfile.space_fingerprint };
  x.chatMetadata.aetheriaUnifiedMemoryV54.baseline.vector = { fingerprint: 'baseline-built', provider_fingerprint: 'provider-built', stale: false, last_sync_at: 1, space_fingerprint: oldProfile.space_fingerprint };
}
shared.vector_embedding_query_prefix = 'Q: ';
const configuredA = configureV55VectorPolicy(a);
assert.equal(configuredA.active, true);
assert.equal(a.chatMetadata.aetheriaUnifiedMemoryV54.vector.stale, true);
const newSpace = shared.vector_embedding_policy_signature;
assert.notEqual(newSpace, oldProfile.space_fingerprint);
const configuredB = configureV55VectorPolicy(b);
assert.equal(configuredB.per_index.mismatches.length >= 1, true);
assert.equal(b.chatMetadata.aetheriaUnifiedMemoryV54.vector.stale, true);
assert.equal(b.chatMetadata.aetheriaUnifiedMemoryV54.vector.expected_space_fingerprint, newSpace);
const legacyCtx = makeCtx(makeSettings());
const legacyProfile = getV55EmbeddingProfile(legacyCtx);
legacyCtx.chatMetadata.aetheriaUnifiedMemoryV54.memories = { m_legacy: { id: 'm_legacy', vector_hash: 7, text: 'vectorised by an older plugin version' } };
legacyCtx.chatMetadata.aetheriaUnifiedMemoryV54.vector = { fingerprint: 'old-provider', stale: false, last_sync_at: 1 };
const legacyCheck = ensureCurrentVectorSpaceIdentity(legacyCtx, legacyProfile);
assert.equal(legacyCheck.mismatches[0].stored, null);
assert.equal(legacyCtx.chatMetadata.aetheriaUnifiedMemoryV54.vector.stale, true);

// A dense index that was only *ensured* (provider fingerprint stamped, zero vectorized rows) is not a
// stale index: there is nothing to rebuild, and the "no per-index space_fingerprint" message that a
// fresh chat used to get was simply false. It self-healed only once a memory was actually indexed.
const ensuredOnly = makeCtx(makeSettings());
ensuredOnly.chatMetadata.aetheriaUnifiedMemoryV54.vector = { fingerprint: 'provider-ensured', stale: true, last_sync_at: null };
const ensuredCheck = ensureCurrentVectorSpaceIdentity(ensuredOnly, getV55EmbeddingProfile(ensuredOnly));
assert.equal(ensuredCheck.mismatches.length, 0, 'an ensured but empty memory index must not be reported as a space mismatch');
assert.equal(ensuredOnly.chatMetadata.aetheriaUnifiedMemoryV54.vector.last_error, undefined, 'a fresh chat must not be given a stale-index error');
assert.equal(ensuredOnly.chatMetadata.aetheriaUnifiedMemoryV54.vector.expected_space_fingerprint, undefined);
console.log('PASS v55 vector policy: role transforms plus per-chat space identity prevent cross-space reuse');
