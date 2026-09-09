import assert from 'node:assert/strict';

const requests=[];
const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV54:{
      enabled:true,semantic_baseline_gate:true,baseline_use_vector:true,baseline_auto_rebuild:true,
      baseline_include_active_world_info:false,baseline_lexical_threshold:0.99,baseline_similarity_threshold:0.80,
      baseline_semantic_lexical_floor:0.05,baseline_chunk_chars:300,baseline_hint_chars:12000,
      vector_source_mode:'inherit',vector_recall:false,debug:false,
    },
    vectors:{source:'transformers'},
  },
  powerUserSettings:{persona_description:'平成喜欢照料植物与盆栽，也会逛花市和温室。'},
  characterId:0,characters:[{name:'平成',data:{description:'平成是卢米纳的成年大学生。'}}],
  chatMetadata:{},chat:[],chatId:'baseline-vector-chat',getCurrentChatId:()=> 'baseline-vector-chat',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},
  chatCompletionSettings:{},textCompletionSettings:{server_urls:{}},
};

globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
globalThis.fetch=async (url,options)=>{
  const body=JSON.parse(options.body); requests.push({url,body});
  if(url==='/api/vector/purge') return {ok:true,status:204,headers:{get:()=>''},text:async()=>''};
  if(url==='/api/vector/insert') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  if(url==='/api/vector/query') {
    // Simulate ST returning threshold-passed metadata. Index 0 points to the relevant baseline chunk.
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({metadata:[{index:0,hash:body.topK}]}),text:async()=>''};
  }
  if(url==='/api/vector/delete') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  throw new Error('unexpected '+url);
};

const mod=await import('./index.js?baseline-vector-mock');
let prepared=await mod.__testEnsureSemanticBaseline(context,{force:true,silent:true});
assert.equal(prepared.vectorReady,true);
assert.ok(requests.some(r=>r.url==='/api/vector/purge'));
assert.ok(requests.some(r=>r.url==='/api/vector/insert' && String(r.body.collectionId).includes('baseline')));

const op={op:'add',kind:'state',text:'平成长期把养护绿色盆景当作日常爱好。',entities:['平成'],topics:['植物'],status:'active',importance:'medium',epistemic:'fact',indexable:true};
const filtered=await mod.__testFilterOperationsAgainstBaseline(context,[op],prepared);
assert.equal(filtered.accepted.length,0);
assert.equal(filtered.rejected.length,1,'semantic baseline query should block paraphrase after threshold hit');
assert.equal(filtered.rejected[0].reason,'semantic-baseline-duplicate');
assert.ok(requests.some(r=>r.url==='/api/vector/query' && String(r.body.collectionId).includes('baseline')));

const beforeFingerprint=mod.__testGetStore(context).baseline.vector.provider_fingerprint;
context.extensionSettings.vectors.source='openai';
context.extensionSettings.vectors.openai_model='text-embedding-test';
prepared=await mod.__testEnsureSemanticBaseline(context,{silent:true});
const afterFingerprint=mod.__testGetStore(context).baseline.vector.provider_fingerprint;
assert.notEqual(beforeFingerprint,afterFingerprint,'provider/model fingerprint change must rebuild baseline projection');
assert.equal(mod.__testGetStore(context).baseline.vector.stale,false);

context.powerUserSettings.persona_description+=' 平成现在还固定研究一种新的盆栽结构。';
const oldBase=prepared.fingerprint;
prepared=await mod.__testEnsureSemanticBaseline(context,{silent:true});
assert.notEqual(oldBase,prepared.fingerprint,'Persona change must change baseline fingerprint and rebuild derived index');

console.log('PASS v5.4 semantic baseline vector gate + provider/source fingerprint rebuild');
