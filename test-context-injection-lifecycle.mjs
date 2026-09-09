import assert from 'node:assert/strict';
import { createEmptyStore } from './memory-core.js';

const prompts=[];
const store=createEmptyStore();
store.last_active_state='平成当前在测试大厅。';
store.memories.state={
  id:'state',kind:'state',slot:'平成.location.current',text:'平成当前在测试大厅。',entities:['平成','测试大厅'],topics:['地点'],
  status:'active',importance:'high',epistemic:'fact',known_by:['平成'],indexable:false,source_message:1,
};
const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV54:{
      enabled:true,auto_extract:false,parse_ops:true,setting_retrieval_enabled:false,setting_index_use_vector:false,
      inject_current_state:true,vector_recall:false,query_messages:2,max_active_items:12,
      reference_context_max_chars:4000,current_state_context_max_chars:1800,context_reply_reserve_tokens:800,
      injection_depth:4,current_state_injection_depth:0,manage_context_window:false,debug:false,
    },
    vectors:{source:'transformers'},
  },
  chatMetadata:{aetheriaUnifiedMemoryV54:store},chatId:'lifecycle-chat',getCurrentChatId:()=> 'lifecycle-chat',chat:[],
  getRequestHeaders:()=>({'Content-Type':'application/json'}),setExtensionPrompt:(...args)=>prompts.push(args),
  saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},chatCompletionSettings:{},textCompletionSettings:{server_urls:{}},
};
globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
await import('./index.js?context-lifecycle');

const input=[{name:'用户',mes:'继续。',is_user:true,is_system:false}];
for(const type of ['normal','continue','regenerate','group']){
  const start=prompts.length;
  const before=structuredClone(input);
  await globalThis.aetheriaUnifiedMemoryV54Interceptor(input,4096,()=>{},type);
  assert.deepEqual(input,before,`${type} must not mutate chat`);
  const calls=prompts.slice(start);
  const ref=calls.find(x=>x[0]==='aetheria_unified_memory_v5_4_reference');
  const cur=calls.find(x=>x[0]==='aetheria_unified_memory_v5_4_current_state');
  assert.ok(ref,`${type} must update reference key even when payload is empty`);
  assert.ok(cur,`${type} must update current-state key`);
  assert.equal(ref[3],4);
  assert.equal(cur[3],0,'legal current-state depth=0 must be preserved');
  assert.match(cur[1],/测试大厅/);
}

for(const type of ['quiet','impersonate']){
  const start=prompts.length;
  await globalThis.aetheriaUnifiedMemoryV54Interceptor(input,4096,()=>{},type);
  const calls=prompts.slice(start);
  for(const key of ['aetheria_unified_memory_v5_4','aetheria_unified_memory_v5_4_reference','aetheria_unified_memory_v5_4_current_state']){
    const row=calls.find(x=>x[0]===key);
    assert.ok(row,`${type} must clear ${key}`);
    assert.equal(row[1],'');
  }
}

context.extensionSettings.aetheriaUnifiedMemoryV54.enabled=false;
const disableStart=prompts.length;
await globalThis.aetheriaUnifiedMemoryV54Interceptor(input,4096,()=>{},'normal');
const disableCalls=prompts.slice(disableStart);
for(const key of ['aetheria_unified_memory_v5_4','aetheria_unified_memory_v5_4_reference','aetheria_unified_memory_v5_4_current_state']){
  assert.equal(disableCalls.find(x=>x[0]===key)?.[1],'',`disabled plugin must clear ${key}`);
}

console.log('PASS Commit F normal/continue/regenerate/group lifecycle + quiet/impersonate/disable cleanup + depth=0');
