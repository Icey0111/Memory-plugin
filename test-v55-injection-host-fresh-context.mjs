// Regression test for the injection chain on a *real-shaped* SillyTavern host.
//
// The v5.5 layers (v55-runtime -> v55-finalizer -> v55-consistency) coordinated by swapping
// `ctx.setExtensionPrompt` on the object they were handed. Real SillyTavern builds a fresh context
// object on every getContext() call, so the swap only ever mutated a throwaway: nothing was ever
// captured, and v55-consistency re-emitted the composed block with position/depth taken from an empty
// capture. `Number(undefined)` is NaN, SillyTavern matches `position` against its own
// extension_prompt_types, and NaN matches nothing — so every Aetheria block was silently dropped from
// the outgoing request while the plugin kept reporting success.
//
// The mock hosts in the other tests return one stable context object, which is exactly why they never
// caught it. This one returns a fresh object per call, like the real host.
import assert from 'node:assert/strict';
import { createEmptyStore } from './memory-core.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const INTERCEPTOR = 'aetheriaUnifiedMemoryV54Interceptor';

const settings = {
  enabled: true, auto_extract: false, parse_ops: true,
  setting_retrieval_enabled: false, setting_index_use_vector: false,
  inject_current_state: true, vector_recall: false, query_messages: 2, max_active_items: 12,
  reference_context_max_chars: 4000, current_state_context_max_chars: 1800,
  context_reply_reserve_tokens: 800, injection_depth: 4, current_state_injection_depth: 1,
  manage_context_window: false, debug: false, memory_evidence_enabled: true,
  summary_max_context_chars: 6000, hierarchical_summary_enabled: false,
  summary_injection_depth: 4, semantic_baseline_gate: false,
};

const store = createEmptyStore();
store.last_active_state = '平成当前在测试大厅。';
store.memories.state = {
  id: 'state', kind: 'state', slot: '平成.location.current', text: '平成当前在测试大厅。',
  entities: ['平成', '测试大厅'], topics: ['地点'], status: 'active', importance: 'high',
  epistemic: 'fact', known_by: ['平成'], indexable: false, source_message: 1,
};

// Exactly what SillyTavern's setExtensionPrompt does, including the Number() coercions.
const hostPrompts = new Map();
const hostApi = {
  extensionSettings: { [SETTINGS_KEY]: settings, vectors: { source: 'transformers' } },
  chatMetadata: { [METADATA_KEY]: store },
  chatId: 'fresh-context-chat',
  getCurrentChatId: () => 'fresh-context-chat',
  chat: [],
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
  setExtensionPrompt: (key, value, position, depth, scan = false, role = 0, filter = null) => {
    hostPrompts.set(key, {
      key, value: String(value), position: Number(position), depth: Number(depth),
      scan: Boolean(scan), role: Number(role), filter,
    });
  },
  saveMetadataDebounced: () => {},
  saveSettingsDebounced: () => {},
  chatCompletionSettings: {},
  textCompletionSettings: { server_urls: {} },
  eventSource: { on: () => {}, emit: () => {} },
  eventTypes: {},
};

globalThis.document = { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }) };
// The whole point: a brand new object every call, so property writes cannot be seen by anyone else.
globalThis.SillyTavern = { getContext: () => ({ ...hostApi }) };

await import('./index.js?fresh-context-host');
const { installV55Runtime } = await import('./v55-runtime.js');
const { installV55Finalizer } = await import('./v55-finalizer.js');
const { installV55Consistency } = await import('./v55-consistency.js');
const getContext = () => globalThis.SillyTavern.getContext();
assert.equal(typeof globalThis[INTERCEPTOR], 'function');
installV55Runtime(getContext, INTERCEPTOR);
installV55Finalizer(getContext, INTERCEPTOR);
installV55Consistency(getContext, INTERCEPTOR);

const input = [{ name: '用户', mes: '我们还在测试大厅吗？', is_user: true, is_system: false }];
await globalThis[INTERCEPTOR](input, 4096, () => {}, 'normal');

const reference = hostPrompts.get('aetheria_unified_memory_v5_4_reference');
const current = hostPrompts.get('aetheria_unified_memory_v5_4_current_state');
assert.ok(reference, 'the reference prompt must still be written');
assert.ok(current, 'the current-state prompt must still be written');
assert.ok(Number.isFinite(reference.position), 'a fresh-context host must receive a real numeric position, not NaN');
assert.ok(Number.isFinite(current.position), 'the current-state position must be numeric too');
assert.equal(reference.position, 1);
assert.equal(current.position, 1);
assert.equal(reference.depth, 4, 'the configured reference depth must survive the outer passes');
assert.equal(current.depth, 1, 'the configured current-state depth must survive the outer passes');
assert.match(current.value, /测试大厅/, 'the current-state text must survive the outer consistency pass');
assert.equal(
  Object.prototype.hasOwnProperty.call(store, 'v55_inner_bundle'), false,
  'the per-generation scratch bundle must not accumulate in chat metadata',
);

console.log('PASS v5.5 injection reaches a fresh-context host: numeric position/depth preserved and blocks survive the outer passes');
