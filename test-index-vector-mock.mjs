import assert from 'node:assert/strict';
import { createEmptyStore, computeVectorHash, fnv1a32, stableStringify } from './memory-core.js';

const prompts=[];
const requests=[];
const store=createEmptyStore();
const memory={
  id:'m_event', kind:'event', slot:null,
  text:'平成曾在星环学盟第三浮空港因误乘接驳艇而首次结识璃月。',
  entities:['平成','璃月','星环学盟第三浮空港'], topics:['初次相识','误乘接驳艇'],
  status:'closed', importance:'high', epistemic:'fact', known_by:['平成','璃月'], indexable:true,
  source_message:1, recalled_count:0,
};
memory.vector_hash=computeVectorHash(memory);
store.memories[memory.id]=memory;
const fpBody={source:'transformers',model:'',apiUrl:'',keep:false,api:'',vertexai_auth_mode:'',vertexai_region:'',vertexai_express_project_id:'',siliconflow_endpoint:'',workers_ai_account_id:''};
store.vector.fingerprint=`transformers:${fnv1a32(stableStringify(fpBody)).toString(36)}`;
store.vector.stale=false;
store.vector.collection_id='aetheria_v54_mock';

const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV53:{enabled:true,parse_ops:true,inject_current_state:false,vector_recall:true,vector_source_mode:'inherit',query_messages:2,candidate_top_k:12,final_recall_count:6,score_threshold:0.25,injection_depth:4,max_active_items:12,protect_recent_messages:0,auto_rebuild_vectors_on_history_change:true,debug:false},
    vectors:{source:'transformers'},
  },
  chatMetadata:{aetheriaUnifiedMemoryV53:store},
  chat:[{mes:'old'}], chatId:'mock-chat', getCurrentChatId:()=> 'mock-chat',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),
  setExtensionPrompt:(...args)=>prompts.push(args), saveMetadataDebounced:()=>{}, saveSettingsDebounced:()=>{},
  chatCompletionSettings:{}, textCompletionSettings:{server_urls:{}},
};

globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
globalThis.fetch=async (url,options)=>{
  requests.push({url,body:JSON.parse(options.body)});
  assert.equal(url,'/api/vector/query');
  return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({metadata:[],hashes:[]}),text:async()=>''};
};
await import('./index.js?vector-mock');
await globalThis.aetheriaUnifiedMemoryV54Interceptor([
  {name:'用户',mes:'我是不是以前在浮空港见过璃月？',is_system:false},
],8192,()=>{},'normal');
assert.equal(requests.length,1);
assert.equal(requests[0].body.source,'transformers');
assert.match(requests[0].body.searchText,/璃月/);
const reference=prompts.find(row=>row[0]==='aetheria_unified_memory_v5_4_reference');
const current=prompts.find(row=>row[0]==='aetheria_unified_memory_v5_4_current_state');
assert.ok(reference);
assert.ok(current);
assert.match(reference[1],/HISTORICAL MEMORY/);
assert.match(reference[1],/星环学盟第三浮空港/);
assert.equal(current[1],'','inject_current_state=false should leave current-state prompt empty');
assert.equal(context.chatMetadata.aetheriaUnifiedMemoryV53.memories.m_event.recalled_count,1);
console.log('PASS hybrid entity-bypass recalls exact named memory even when dense vector returns no hit');
