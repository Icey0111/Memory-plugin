import assert from 'node:assert/strict';
import { createEmptyStore } from './memory-core.js';

const prompts = [];
const store = createEmptyStore();
store.last_active_state = '【当前有效状态】平成在东街，当前仍在等璃月回复。';
store.memories.m1 = {
  id:'m1', kind:'commitment', slot:'平成.commitment.reply', text:'平成仍在等待璃月对合作提案的回复。',
  entities:['平成','璃月'], topics:['合作','等待回复'], status:'active', importance:'high', epistemic:'fact', known_by:['平成'],
  indexable:false, source_message:2, vector_hash:null,
};

const context = {
  extensionSettings: {
    aetheriaUnifiedMemoryV53: {
      enabled:true, parse_ops:true, inject_current_state:true, vector_recall:false,
      vector_source_mode:'inherit', query_messages:3, candidate_top_k:12, final_recall_count:6,
      score_threshold:0.25, injection_depth:4, current_state_injection_depth:1,
      max_active_items:12, protect_recent_messages:8,
      auto_rebuild_vectors_on_history_change:true, debug:false,
    },
    vectors: { source:'transformers' },
  },
  chatMetadata: { aetheriaUnifiedMemoryV53: store },
  chat: [],
  chatId: 'mock-chat',
  getCurrentChatId: () => 'mock-chat',
  getRequestHeaders: () => ({'Content-Type':'application/json'}),
  setExtensionPrompt: (...args) => prompts.push(args),
  saveMetadataDebounced: () => {},
  saveSettingsDebounced: () => {},
  chatCompletionSettings: {},
  textCompletionSettings: {server_urls:{}},
};

globalThis.SillyTavern = { getContext: () => context };
const mod = await import('./index.js');
assert.equal(typeof globalThis.aetheriaUnifiedMemoryV54Interceptor, 'function');

const coreChat = [
  {name:'平成', mes:'上一轮完整正文。', is_system:false},
  {name:'用户', mes:'璃月有回复了吗？', is_system:false},
];
const before = structuredClone(coreChat);
await globalThis.aetheriaUnifiedMemoryV54Interceptor(coreChat, 8192, () => {}, 'normal');
assert.deepEqual(coreChat,before,'generation interceptor must not mutate the real chat array');

const reference = prompts.find(row=>row[0]==='aetheria_unified_memory_v5_4_reference');
const current = prompts.find(row=>row[0]==='aetheria_unified_memory_v5_4_current_state');
assert.ok(reference,'reference prompt must be set');
assert.ok(current,'current-state prompt must be set');
assert.equal(reference[3],4);
assert.equal(current[3],1);
assert.match(current[1],/PLUGIN CURRENT STATE/);
assert.match(current[1],/平成在东街/);
assert.match(current[1],/等待璃月/);
assert.doesNotMatch(reference[1],/平成在东街/,'current state must not leak into reference prompt');

const diag=mod.__testGetLastGenerationContextDiagnostics();
assert.equal(diag.reference_depth,4);
assert.equal(diag.current_state_depth,1);

// Quiet generation must clear both Commit F keys and the legacy one-block key.
const start=prompts.length;
await globalThis.aetheriaUnifiedMemoryV54Interceptor(coreChat, 8192, () => {}, 'quiet');
const clears=prompts.slice(start);
for(const key of ['aetheria_unified_memory_v5_4','aetheria_unified_memory_v5_4_reference','aetheria_unified_memory_v5_4_current_state']){
  const row=clears.find(x=>x[0]===key);
  assert.ok(row,`quiet must clear ${key}`);
  assert.equal(row[1],'');
}

console.log('PASS Commit F interceptor uses dual prompt keys/depths, preserves chat, and clears on quiet');
