// Recall used to start inside the generate interceptor, so prompt assembly waited for the dense
// round-trip. Prefetching it during the host's message events is only safe if the prefetch does NOT
// commit: recalled_count, last_recalled_message and the recall cooldown are all mutated by a recall,
// and committing at prefetch time would bump counters for a generation that never happens and would
// eat the next turn's cooldown.
import assert from 'node:assert/strict';
import { createEmptyStore } from './memory-core.js';

const prompts = [];
const store = createEmptyStore();
store.memories.m1 = {
  id: 'm1', kind: 'commitment', slot: '平成.commitment.reply', text: '平成仍在等待璃月对合作提案的回复。',
  entities: ['平成', '璃月'], topics: ['合作', '等待回复'], status: 'active', importance: 'high',
  epistemic: 'fact', known_by: ['平成'], indexable: true, source_message: 1, vector_hash: 1,
};
store.memories.m2 = {
  id: 'm2', kind: 'state', slot: '平成.location.current', text: '平成现在在东街的茶馆。',
  entities: ['平成', '东街'], topics: ['位置'], status: 'active', importance: 'medium',
  epistemic: 'fact', known_by: ['平成'], indexable: true, source_message: 2, vector_hash: 1,
};

const context = {
  extensionSettings: {
    aetheriaUnifiedMemoryV54: {
      enabled: true, parse_ops: true, inject_current_state: true, vector_recall: true,
      vector_source_mode: 'inherit', query_messages: 3, candidate_top_k: 12, final_recall_count: 6,
      score_threshold: 0.25, injection_depth: 4, current_state_injection_depth: 1,
      max_active_items: 12, auto_rebuild_vectors_on_history_change: false,
      debug: false, hybrid_recall: true, graph_diffusion: true, rerank_enabled: true, mmr_lambda: 0.78,
      recall_cooldown_turns: 0, temporal_channel_enabled: true, temporal_channel_limit: 6,
      lexical_candidate_top_k: 28, lexical_weight: 0.9, rrf_k: 60,
      // 0 so the fixture's short chat does not mark every memory as "too recent to recall"; the
      // production default of 8 protects the last eight turns and would filter this fixture out.
      protect_recent_messages: 0,
    },
    vectors: { source: 'transformers' },
  },
  chatMetadata: { aetheriaUnifiedMemoryV54: store },
  chat: [],
  chatId: 'prefetch-chat',
  getCurrentChatId: () => 'prefetch-chat',
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
  setExtensionPrompt: (...args) => prompts.push(args),
  saveMetadataDebounced: () => {},
  saveSettingsDebounced: () => {},
  chatCompletionSettings: {},
  textCompletionSettings: { server_urls: {} },
};

globalThis.SillyTavern = { getContext: () => context };
// index.js schedules a status refresh on a timer; without a document the timer throws after the test
// body has already finished.
globalThis.document = { getElementById: () => null };
const mod = await import('./index.js?recall-prefetch');

const chat = [
  { name: '平成', mes: '上一轮完整正文，提到合作提案。', is_system: false },
  { name: '用户', mes: '璃月对合作提案有回复了吗？', is_system: false },
];
context.chat = chat;

// Every write goes through getStore(), which returns a fresh normalised object and replaces
// chatMetadata's copy, so assertions must read the live store rather than the fixture object.
const live = () => context.chatMetadata.aetheriaUnifiedMemoryV54;

const signature = mod.recallSignature(context, chat);
assert.ok(signature.includes('prefetch-chat'), 'the signature must be scoped to the chat');
assert.equal(mod.recallSignature({ ...context, chat }, [...chat]), signature, 'the signature is stable for the same chat state');
assert.notEqual(mod.recallSignature({ ...context, chat }, [...chat, { mes: 'x', is_system: false }]), signature, 'a new message invalidates it');

assert.equal(mod.startRecallPrefetch(context), true);
// Let the parked ranking settle.
await new Promise(r => setTimeout(r, 250));
assert.equal(mod.recallPrefetchStatus().armed, true, 'the prefetch must park a ranking');
assert.equal(mod.recallPrefetchStatus().last_error, null, 'the prefetch must not have failed: ' + mod.recallPrefetchStatus().last_error);
assert.ok(mod.recallPrefetchStatus().parked > 0, 'a ranking must be parked and waiting');
assert.equal(mod.recallPrefetchStatus().armed, true);
assert.equal(live().last_recall_debug, null, 'a prefetch must not write recall diagnostics');
assert.equal(live().memories.m1.recalled_count, undefined, 'a prefetch must not bump recall counters');
assert.equal(live().memories.m2.recalled_count, undefined);

// A generation in the same chat state commits exactly once.
const committed = mod.commitPrefetchedRecall(context, signature);
assert.ok(Array.isArray(committed), 'the interceptor must receive the parked ranking');
assert.ok(committed.length >= 1, 'the parked ranking must contain candidates');
assert.ok(live().last_recall_debug && live().last_recall_debug.prefetched === true, 'the commit marks the recall as prefetched');
assert.ok(Number.isFinite(live().last_recall_debug.prefetch_lead_ms));
const bumped = Object.values(live().memories).filter(m => Number(m.recalled_count || 0) > 0).length;
assert.ok(bumped >= 1, 'the commit bumps the counters');
assert.equal(mod.commitPrefetchedRecall(context, signature), null, 'a parked ranking is consumed only once');

// A prefetch that is never consumed leaves no trace, and a stale one is refused.
assert.equal(mod.startRecallPrefetch(context), true);
await new Promise(r => setTimeout(r, 250));
assert.equal(mod.commitPrefetchedRecall(context, 'a-different-chat-state'), null, 'a stale signature must be refused');
const countsBefore = Object.fromEntries(Object.entries(live().memories).map(([id, m]) => [id, Number(m.recalled_count || 0)]));
assert.equal(mod.startRecallPrefetch(context), true);
await new Promise(r => setTimeout(r, 250));
assert.deepEqual(Object.fromEntries(Object.entries(live().memories).map(([id, m]) => [id, Number(m.recalled_count || 0)])), countsBefore, 'prefetching alone never moves a counter');
assert.equal(mod.startRecallPrefetch(context), true, 're-arming the same chat state is a no-op, not an error');

const warm = await mod.warmupRecallRuntime(context);
assert.ok(Number.isFinite(warm.ms), 'warmup must report its cost');
assert.ok('provider' in warm);
console.log('PASS v5.5 recall prefetch: the ranking is computed early and committed only by a real generation');
