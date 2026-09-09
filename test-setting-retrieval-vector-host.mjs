import assert from 'node:assert/strict';
import { createSettingStore, createWorld, addSource, addRevision, addEntries, setActiveBaselineRevision } from './setting-store.js';

let store=createSettingStore({now:1});
let r=createWorld(store,{world_id:'w_dense',name:'Dense World'},{now:2});store=r.store;
r=addSource(store,{source_id:'src',world_id:'w_dense',format:'worldbook_json',content_hash:'src',raw_payload:'{}'},{now:3});store=r.store;
r=addRevision(store,{revision_id:'rev',world_id:'w_dense',source_id:'src',revision_label:'v5',revision_kind:'baseline'},{now:4});store=r.store;
r=addEntries(store,[
  {entry_id:'e_train',world_id:'w_dense',source_id:'src',revision_id:'rev',source_entry_id:1,title:'夜间列车',content:'月环列车只在夜间跨区运行。',keys:['月环列车'],order:1,content_hash:'h1'},
  {entry_id:'e_gate',world_id:'w_dense',source_id:'src',revision_id:'rev',source_entry_id:2,title:'检修门权限',content:'蓝色检修门需要星轨维护证才能开启。',keys:['检修门','维护证'],order:2,content_hash:'h2'},
],{now:5});store=r.store;
store=setActiveBaselineRevision(store,'w_dense','rev',{now:6});

const requests=[];
let inserted=[];
const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV54:{
      enabled:true,setting_store:store,setting_index_use_vector:true,setting_index_auto_rebuild:true,setting_index_chunk_chars:180,
      setting_index_lexical_top_k:12,setting_index_lexical_min_score:0.01,
      setting_retrieval_enabled:true,setting_retrieval_use_dense:true,setting_retrieval_candidate_top_k:8,
      setting_retrieval_final_count:4,setting_retrieval_dense_threshold:0.10,setting_retrieval_rrf_k:60,setting_retrieval_max_chars:6000,
      semantic_baseline_gate:true,baseline_use_vector:false,vector_recall:false,vector_source_mode:'inherit',debug:false,
    },
    vectors:{source:'transformers'},
  },
  chatMetadata:{},chat:[],chatId:'chat-do-not-use-for-setting-collection',getCurrentChatId:()=> 'chat-do-not-use-for-setting-collection',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},
  chatCompletionSettings:{},textCompletionSettings:{server_urls:{}},
};
globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
globalThis.fetch=async (url,options)=>{
  const body=options?.body ? JSON.parse(options.body) : {};
  requests.push({url,body});
  if(url==='/api/vector/purge') return {ok:true,status:204,headers:{get:()=>''},text:async()=>''};
  if(url==='/api/vector/insert') { inserted.push(...(body.items||[])); return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''}; }
  if(url==='/api/vector/query') {
    const item=inserted.find(x=>String(x.text).includes('蓝色检修门')) || inserted[0];
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({metadata:item?[{index:item.index,hash:item.hash,score:0.95}]:[]}),text:async()=>''};
  }
  throw new Error('unexpected '+url);
};

const mod=await import('./index.js?setting-retrieval-vector-host');
const result=await mod.__testRetrievePluginSettings(context,{mode:'generation',text:'那个需要特定资格才能开启的蓝色门怎么处理？',components:{}},{candidateTopK:8});
assert.equal(result.dense_available,true);
assert.ok(result.dense.some(row=>row.chunk.entry_id==='e_gate'));
assert.equal(result.results[0].entry_id,'e_gate');
const settingQuery=requests.find(r=>r.url==='/api/vector/query');
assert.ok(settingQuery);
assert.match(String(settingQuery.body.collectionId),/^aetheria_v55_setting_/);
assert.doesNotMatch(String(settingQuery.body.collectionId),/chat-do-not-use/,'Setting dense retrieval collection must remain world/revision scoped, not chat scoped');
assert.equal(settingQuery.body.source,'transformers');

console.log('PASS Commit E host dense Setting query maps vector metadata and fuses with lexical candidates');
