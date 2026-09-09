import assert from 'node:assert/strict';
import { createEmptyStore, computeVectorHash } from './memory-core.js';

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
      score_threshold:0.25, injection_depth:4, max_active_items:12, protect_recent_messages:8,
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
await globalThis.aetheriaUnifiedMemoryV54Interceptor(coreChat, 8192, () => {}, 'normal');
assert.equal(prompts.length, 1);
const [key, payload, position, depth, scan, role] = prompts.at(-1);
assert.equal(key, 'aetheria_unified_memory_v5_4');
assert.match(payload, /<aetheria_memory_context>/);
assert.match(payload, /平成在东街/);
assert.match(payload, /等待璃月/);
assert.equal(depth, 4);

// Quiet generation must clear the injection.
await globalThis.aetheriaUnifiedMemoryV54Interceptor(coreChat, 8192, () => {}, 'quiet');
assert.equal(prompts.length, 2);
assert.equal(prompts.at(-1)[1], '');

console.log('PASS mock interceptor injects current state and clears on quiet generation');
