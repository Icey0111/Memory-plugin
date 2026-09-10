// A chat-history mutation event must only invalidate the summary tree when a turn that had already
// been summarized actually disappeared. The host re-emits its update events while it hydrates the chat
// at startup, and treating those as edits wiped the tree and re-summarized every turn on every launch.
import assert from 'node:assert/strict';

const listeners = new Map();
const chat = [
  { is_user: true, mes: '你好' }, { is_user: false, mes: '你好，有什么事？' },
  { is_user: true, mes: '去图书馆。' }, { is_user: false, mes: '好，我们出发。' },
];
const settings = {
  enabled: true, hierarchical_summary_enabled: true, summary_auto_rebuild_on_history_change: true,
  summary_provider_mode: 'current', summary_max_tokens: 512, summary_injection_depth: 4,
  summary_level1_every_turns: 1, summary_level2_every_l1: 3, summary_level3_every_l2: 3,
  summary_max_context_chars: 6000,
};
const ctx = {
  extensionSettings: { aetheriaUnifiedMemoryV54: settings },
  chatMetadata: { aetheriaUnifiedMemoryV54: {} },
  chat,
  eventTypes: {
    MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    CHAT_CHANGED: 'chat_changed', MESSAGE_SWIPED: 'message_swiped', MESSAGE_EDITED: 'message_edited',
    MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'message_deleted',
  },
  eventSource: {
    on: (event, handler) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(handler); },
    emit: (event, ...args) => (listeners.get(event) || []).forEach(handler => handler(...args)),
  },
  setExtensionPrompt: () => {}, saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {},
  generateQuietPrompt: async () => '一级摘要文本',
};
globalThis.SillyTavern = { getContext: () => ctx };

const mod = await import('./v55-summary-runtime.js?summary-dirty');
const turns = mod.collectCompletedDialogueTurns(chat);
assert.equal(turns.length, 2);

const store = ctx.chatMetadata.aetheriaUnifiedMemoryV54;
store.hierarchical_summaries = {
  version: 3, processed_turn_ids: turns.map(t => t.id), consumed_l1_ids: [], consumed_l2_ids: [],
  level1: [{ id: 'l1_a', level: 1, source_ids: [turns[0].id], text: '一级摘要A', created_at: 1 }],
  level2: [{ id: 'l2_a', level: 2, source_ids: ['l1_a'], text: '二级摘要A', created_at: 2 }],
  level3: [], dirty: false, last_run_at: 1, last_error: null, visibility_debug: null,
};
assert.equal(mod.installV55HierarchicalSummary(), true);

// The startup-hydration shape: update events fire, but no summarized turn is gone.
ctx.eventSource.emit('message_updated');
ctx.eventSource.emit('message_updated');
assert.equal(store.hierarchical_summaries.level1.length, 1, 'a hydration update must not wipe the summary tree');
assert.equal(store.hierarchical_summaries.level2.length, 1, 'the whole tree must survive');
assert.equal(store.hierarchical_summaries.processed_turn_ids.length, turns.length);
assert.equal(store.hierarchical_summaries.dirty, false);

// A real edit changes the turn fingerprint, so the summarized turn is gone and the tree must rebuild.
chat[1].mes = '改过的回复内容。';
ctx.eventSource.emit('message_edited');
assert.equal(store.hierarchical_summaries.level1.length, 0, 'an edited turn must invalidate the tree');
assert.equal(store.hierarchical_summaries.level2.length, 0);
assert.equal(store.hierarchical_summaries.processed_turn_ids.length, 0);

console.log('PASS v5.5 summary tree invalidation: hydration update events no longer wipe and re-summarize the whole chat');
