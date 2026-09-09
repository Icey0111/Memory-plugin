import assert from 'node:assert/strict';
import { createEmptyStore } from './memory-core.js';

const prompts=[];
const legacyStore=createEmptyStore();
legacyStore.memories.m_old={
  id:'m_old',kind:'commitment',slot:'平成.commitment.liyue',
  text:'平成与璃月已经正式签订长期合作协议。',
  entities:['平成','璃月'],topics:['合作协议','长期合作'],
  status:'active',importance:'high',epistemic:'fact',known_by:['平成','璃月'],
  indexable:true,source_message:1,vector_hash:null,evidence_excerpt:'双方当场确认并签署合作协议。',quality_flags:[],
};
legacyStore.slots['平成.commitment.liyue']='m_old';
legacyStore.vector.stale=true;

const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV51:{
      enabled:true,parse_ops:true,inject_current_state:false,vector_recall:true,
      vector_source_mode:'inherit',query_messages:2,candidate_top_k:18,final_recall_count:6,
      score_threshold:0.22,injection_depth:4,max_active_items:12,protect_recent_messages:0,
      auto_rebuild_vectors_on_history_change:true,debug:false,
    },
    vectors:{source:'webllm'}, // unsupported Dense provider => lexical fallback must remain usable
  },
  chatMetadata:{aetheriaUnifiedMemoryV51:legacyStore},
  chat:[{mes:'old'}],chatId:'migration-chat',getCurrentChatId:()=> 'migration-chat',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),
  setExtensionPrompt:(...args)=>prompts.push(args),saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},
  chatCompletionSettings:{},textCompletionSettings:{server_urls:{}},
};

globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
await import('./index.js?migration-fallback');
await globalThis.aetheriaUnifiedMemoryV54Interceptor([
  {name:'用户',mes:'之前是不是有过一份正式合作协议？',is_system:false},
],8192,()=>{},'normal');

assert.ok(context.extensionSettings.aetheriaUnifiedMemoryV54,'v5.1 settings should migrate to v5.4');
assert.ok(context.chatMetadata.aetheriaUnifiedMemoryV54,'v5.1 canonical store should migrate to v5.4');
assert.equal(prompts.length,1);
assert.match(prompts[0][1],/长期合作协议/);
assert.equal(context.chatMetadata.aetheriaUnifiedMemoryV54.last_recall_debug?.dense_available,false);
assert.ok((context.chatMetadata.aetheriaUnifiedMemoryV54.last_recall_debug?.lexical || []).length>0);
console.log('PASS v5.1 metadata migrates and lexical recall falls back when Dense provider is unavailable');
