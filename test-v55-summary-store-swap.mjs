// A Canonical replay replaces the whole chat-metadata store object while a summary model call is in
// flight. A summary tree captured before that await then receives every later batch while the store
// that actually reaches disk keeps an empty one — a fully summarized chat came back with l1=0 after a
// live run. Every mutation must re-read the tree from chat metadata.
import assert from 'node:assert/strict';
import { installMetadataIntegrityForContext } from './v55-store-integrity.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const chat = [];
for (let i = 0; i < 25; i++) {
  chat.push({ is_user: true, mes: `用户第${i + 1}层` });
  chat.push({ is_user: false, mes: `助手第${i + 1}层回复` });
}
const settings = {
  enabled: true, hierarchical_summary_enabled: true, summary_auto_rebuild_on_history_change: true,
  summary_provider_mode: 'current', summary_max_tokens: 512, summary_injection_depth: 4,
  summary_level1_every_turns: 10, summary_level2_every_l1: 2, summary_level3_every_l2: 2,
  summary_max_context_chars: 9000, summary_source_max_chars: 24000,
  summary_fold_hidden_floors: false, summary_fold_keep_recent_floors: 1,
  // Exercises the model-written Level-1 path; the deterministic digest has its own tests.
  summary_digest_enabled: false,
};
const ctx = {
  extensionSettings: { [KEY]: settings },
  chatMetadata: { [KEY]: {} },
  chat,
  setExtensionPrompt: () => {}, saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {}, saveChat: () => {},
  // The replay lands between the first and the second model call, exactly as it does in production.
  // The ownership guard keeps the auxiliary tree, but it does so by cloning it into a new store
  // object, so a tree reference captured before the await is orphaned from then on.
  generateQuietPrompt: async () => {
    const calls = (ctx.__calls = (ctx.__calls || 0) + 1);
    if (calls === 2) {
      ctx.chatMetadata[KEY] = { version: '5.4', memories: {}, slots: {}, extractions: {}, baseline: { vector: {} }, vector: {} };
    }
    return `摘要文本${calls}`;
  },
};
globalThis.SillyTavern = { getContext: () => ctx };
assert.equal(installMetadataIntegrityForContext(ctx), true, 'the ownership guard must be active for this shape');

const mod = await import('./v55-summary-runtime.js?store-swap');
const result = await mod.processSummaryHierarchy(ctx);
assert.equal(result.created, 3, 'two level-1 batches and one level-2 batch must be created');
const stored = ctx.chatMetadata[KEY].hierarchical_summaries;
assert.ok(stored, 'the summary tree must exist in the store that survived the swap');
assert.equal(stored.level1.length, 2, 'both level-1 summaries must land in the live store, not an orphan');
assert.equal(stored.level2.length, 1, 'the level-2 summary must land in the live store');
assert.equal(stored.processed_turn_ids.length, 20);
assert.equal(stored.last_error, null);
console.log('PASS v5.5 summary store swap: summaries follow the live chat store across a mid-call replacement');
