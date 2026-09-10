import assert from 'node:assert/strict';
import { configureV55VectorPolicy, getV55EmbeddingProfile, rewriteAetheriaPolicyPayload } from './v55-vector-policy.js';
function ctx(overrides={}) { const settings={ vector_direct_api_enabled:true, vector_direct_api_url:'https://api.example.com/v1/embeddings', vector_direct_api_model:'intfloat/multilingual-e5-large', vector_embedding_family:'auto', vector_embedding_role_strategy:'auto', vector_embedding_query_prefix:'', vector_embedding_document_prefix:'', vector_embedding_dimensions:'', vector_embedding_normalization:'auto', vector_score_memory_threshold:0.33, vector_score_setting_threshold:'', vector_score_baseline_threshold:'', vector_multi_query_fusion:true, vector_multi_query_rrf_k:60, vector_profile_policy_version:2, ...overrides }; return { extensionSettings:{aetheriaUnifiedMemoryV54:settings}, chatMetadata:{aetheriaUnifiedMemoryV54:{vector:{},baseline:{vector:{}}}}, saveSettingsDebounced(){}, saveMetadataDebounced(){} }; }
const c=ctx(); const p=getV55EmbeddingProfile(c); assert.equal(p.family,'e5'); assert.equal(p.role_strategy,'prefix');
const inserted=rewriteAetheriaPolicyPayload({source:'transformers',collectionId:'aetheria_v54_demo',items:[{hash:1,text:'memory text',index:0}]},'insert',c);
assert.ok(inserted.payload.collectionId.includes('__aum_space_')); assert.equal(inserted.payload.items[0].text,'passage: memory text');
const queried=rewriteAetheriaPolicyPayload({source:'transformers',collectionId:'aetheria_v54_demo',searchText:'where',topK:10,threshold:0.22},'query',c);
assert.equal(queried.payload.searchText,'query: where'); assert.equal(queried.payload.threshold,0.33);
const host=ctx({vector_direct_api_enabled:false}); const hostQuery=rewriteAetheriaPolicyPayload({source:'vllm',model:'intfloat/multilingual-e5-large',apiUrl:'http://localhost:8000/v1',collectionId:'aetheria_v54_host',searchText:'question',threshold:0.22},'query',host);
assert.equal(hostQuery.payload.collectionId,'aetheria_v54_host'); assert.equal(hostQuery.payload.searchText,'query: question');
const threshold=ctx({vector_score_memory_threshold:0.49}); assert.equal(getV55EmbeddingProfile(c).space_fingerprint,getV55EmbeddingProfile(threshold).space_fingerprint); assert.notEqual(getV55EmbeddingProfile(c).retrieval_policy_fingerprint,getV55EmbeddingProfile(threshold).retrieval_policy_fingerprint);
assert.equal(configureV55VectorPolicy(c).active,true);
console.log('v55-vector-policy tests passed');
