// Full-stack (index-v55.js) cleanup contract test.
//
// Iteration 07 shipped a regression: the finalizer/consistency passes re-injected the
// Scene Summary block into the Reference extension prompt after the legacy interceptor had
// cleared both prompt keys for quiet / impersonate / disabled generations. This test runs the
// real wrapper stack (not the legacy interceptor alone) with a store that actually has
// extractions, which is the missing fixture that let the regression escape.
import assert from 'node:assert/strict';
import { createEmptyStore } from './memory-core.js';

const prompts = [];
const store = createEmptyStore();
store.memories.state = {
  id: 'state', kind: 'state', slot: '平成.location.current', text: '平成当前在测试大厅。',
  entities: ['平成'], topics: ['地点'], status: 'active', importance: 'high', epistemic: 'fact',
  known_by: ['平成'], indexable: false, source_message: 1,
};
store.extractions = {
  x1: {
    transaction_id: 'tx1', source_hash: 1, branch_id: 'br-one', chat_id: 'chat-1',
    assistant_index_at_creation: 2, event_summary: 'Alice 在大厅拿走了档案钥匙。',
    operations: [{ op: 'add', kind: 'event', text: 'Alice 在大厅拿走了档案钥匙。', entities: ['Alice'] }],
  },
};
const ctx = {
  extensionSettings: {
    aetheriaUnifiedMemoryV54: {
      enabled: true, auto_extract: false, parse_ops: true, setting_retrieval_enabled: false,
      setting_index_use_vector: false, inject_current_state: true, vector_recall: false,
      query_messages: 2, max_active_items: 12, reference_context_max_chars: 4000,
      current_state_context_max_chars: 1800, context_reply_reserve_tokens: 800,
      injection_depth: 4, current_state_injection_depth: 0, manage_context_window: false, debug: false,
      setting_store: { active_world_id: null, worlds: {}, revisions: {}, entries: {} },
    },
    vectors: { source: 'transformers' },
  },
  chatMetadata: { aetheriaUnifiedMemoryV54: store },
  chatId: 'chat-1', getCurrentChatId: () => 'chat-1',
  chat: [{ name: '用户', mes: '继续。', is_user: true, is_system: false }],
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
  setExtensionPrompt: (...args) => prompts.push(args),
  saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {},
  chatCompletionSettings: {}, textCompletionSettings: { server_urls: {} },
  eventSource: { on: () => {} }, eventTypes: {},
};
globalThis.document = { getElementById: () => null };
globalThis.SillyTavern = { getContext: () => ctx };
await import('./index-v55.js');

const REF = 'aetheria_unified_memory_v5_4_reference';
const CUR = 'aetheria_unified_memory_v5_4_current_state';
const LEGACY = 'aetheria_unified_memory_v5_4';
const input = [{ name: '用户', mes: '继续。', is_user: true, is_system: false }];

async function run(type) {
  const start = prompts.length;
  const before = structuredClone(input);
  await globalThis.aetheriaUnifiedMemoryV54Interceptor(input, 4096, () => {}, type);
  assert.deepEqual(input, before, type + ' must not mutate chat');
  const calls = prompts.slice(start);
  const last = key => [...calls].reverse().find(row => row[0] === key);
  return { ref: last(REF), cur: last(CUR), legacy: last(LEGACY) };
}

const normal = await run('normal');
assert.ok(normal.ref, 'normal must update the reference key');
assert.match(normal.ref[1], /SCENE SUMMARY LOCATORS/, 'normal generation still injects scene locators');
assert.ok(normal.cur, 'normal must update the current-state key');
assert.match(normal.cur[1], /测试大厅/, 'normal generation still injects canonical current state');

for (const type of ['quiet', 'impersonate']) {
  const row = await run(type);
  assert.equal(row.ref?.[1], '', type + ' must leave the reference key empty');
  assert.equal(row.cur?.[1], '', type + ' must leave the current-state key empty');
  assert.doesNotMatch(row.ref?.[1] || '', /SCENE SUMMARY LOCATORS/, type + ' must not receive scene locators');
}

// Third-party quiet is still cleared by default. Opting in must only affect third-party quiet,
// never the plugin's own background extraction.
ctx.extensionSettings.aetheriaUnifiedMemoryV54.quiet_allow_third_party_injection = true;
const thirdPartyQuiet = await run('quiet');
assert.ok(thirdPartyQuiet.ref?.[1], 'opted-in third-party quiet receives the reference block');
ctx.extensionSettings.aetheriaUnifiedMemoryV54.__quiet_extraction_in_progress = true;
const ownQuiet = await run('quiet');
assert.equal(ownQuiet.ref?.[1], '', 'plugin-owned quiet extraction stays cleared even with the opt-in');
delete ctx.extensionSettings.aetheriaUnifiedMemoryV54.__quiet_extraction_in_progress;
ctx.extensionSettings.aetheriaUnifiedMemoryV54.quiet_allow_third_party_injection = false;

ctx.extensionSettings.aetheriaUnifiedMemoryV54.enabled = false;
const disabled = await run('normal');
assert.equal(disabled.ref?.[1], '', 'disabled plugin must clear the reference key');
assert.equal(disabled.cur?.[1], '', 'disabled plugin must clear the current-state key');
assert.equal(disabled.legacy?.[1], '', 'disabled plugin must clear the legacy key');

console.log('PASS v5.5 full-stack cleanup: quiet/impersonate/disabled stay cleared while normal keeps Reference + Current State');
