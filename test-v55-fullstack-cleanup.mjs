// Bootstrap-level generation lifecycle regression test.
import assert from 'node:assert/strict';
import { createEmptyStore } from './memory-core.js';

const prompts = [];
const store = createEmptyStore();
store.setting_binding = { world_id: null, baseline_revision_id: null, extension_revision_ids: [], pinned: true };
store.memories.state = { id: 'state', kind: 'state', slot: '平成.location.current', text: '平成当前在测试大厅。', entities: ['平成'], topics: ['地点'], status: 'active', importance: 'high', epistemic: 'fact', known_by: ['平成'], indexable: false, source_message: 1 };
store.extractions = { x1: { transaction_id: 'tx1', source_hash: 1, branch_id: 'br-one', chat_id: 'chat-1', assistant_index_at_creation: 2, event_summary: 'Alice 在大厅拿走了档案钥匙。', operations: [{ op: 'add', kind: 'event', text: 'Alice 在大厅拿走了档案钥匙。', entities: ['Alice'] }] } };
store.hierarchical_summaries = { version: 3, processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [], dirty: false, level1: [{ id: 'summary-public', level: 1, source_ids: ['external-public'], text: '公开长期摘要：档案室仍待调查。' }], level2: [], level3: [], last_run_at: null, last_error: null };
const settings = { enabled: true, auto_extract: false, parse_ops: true, setting_retrieval_enabled: false, setting_index_use_vector: false, inject_current_state: true, vector_recall: false, query_messages: 2, max_active_items: 12, reference_context_max_chars: 4000, current_state_context_max_chars: 1800, context_reply_reserve_tokens: 800, injection_depth: 4, current_state_injection_depth: 0, manage_context_window: false, debug: false, hierarchical_summary_enabled: true, summary_max_context_chars: 1200, summary_injection_depth: 0, quiet_allow_third_party_injection: false, setting_store: { active_world_id: null, worlds: {}, revisions: {}, entries: {} }, vector_profile_policy_version: 3 };
const ctx = {
  extensionSettings: { aetheriaUnifiedMemoryV54: settings, vectors: { source: 'transformers' } },
  chatMetadata: { aetheriaUnifiedMemoryV54: store }, chatId: 'chat-1', getCurrentChatId: () => 'chat-1',
  chat: [{ name: '用户', mes: '继续。', is_user: true, is_system: false }], name2: 'Bob', name1: 'User',
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }), setExtensionPrompt: (...args) => prompts.push(args),
  saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {}, chatCompletionSettings: {}, textCompletionSettings: { server_urls: {} }, eventSource: { on: () => {} }, eventTypes: {},
};
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
globalThis.SillyTavern = { getContext: () => ctx };
await import('./index-v55-bootstrap.js');
const REF='aetheria_unified_memory_v5_4_reference', CUR='aetheria_unified_memory_v5_4_current_state', LEGACY='aetheria_unified_memory_v5_4', SUMMARY='aetheria_unified_memory_v5_5_hierarchical_summary';
const input=[{ name:'用户', mes:'继续。', is_user:true, is_system:false }];
async function run(type){const start=prompts.length,before=structuredClone(input);await globalThis.aetheriaUnifiedMemoryV54Interceptor(input,4096,()=>{},type);assert.deepEqual(input,before);const calls=prompts.slice(start),last=key=>[...calls].reverse().find(row=>row[0]===key);return{ref:last(REF),cur:last(CUR),legacy:last(LEGACY),summary:last(SUMMARY)};}
const normal=await run('normal');
assert.ok(normal.ref); assert.doesNotMatch(normal.ref[1],/SCENE SUMMARY LOCATORS/,'the duplicated locator block is not injected'); assert.match(normal.ref[1],/公开长期摘要/); assert.ok(normal.cur); assert.match(normal.cur[1],/测试大厅/); assert.equal(normal.summary,undefined,'the standalone summary key is never registered: the summary rides inside the reference block, and an empty registration still costs a projection range the host does not have');
for(const type of['quiet','impersonate']){const row=await run(type);assert.equal(row.ref?.[1],'');assert.equal(row.cur?.[1],'');assert.equal(row.summary,undefined);}
settings.quiet_allow_third_party_injection=true; assert.ok((await run('quiet')).ref?.[1]); settings.__quiet_extraction_in_progress=true; const ownQuiet=await run('quiet'); assert.equal(ownQuiet.ref?.[1],''); assert.equal(ownQuiet.summary,undefined); delete settings.__quiet_extraction_in_progress; settings.quiet_allow_third_party_injection=false;
settings.enabled=false; const disabled=await run('normal'); assert.equal(disabled.ref?.[1],''); assert.equal(disabled.cur?.[1],''); assert.equal(disabled.summary,undefined); assert.equal(disabled.legacy,undefined,'the v5.4 single-block key is only touched when an upgrade left a value in it');
console.log('PASS v5.5 bootstrap lifecycle: normal unified Reference; quiet/impersonate/disabled clear every plugin prompt channel');
