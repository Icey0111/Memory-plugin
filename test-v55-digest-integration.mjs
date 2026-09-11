// End-to-end claim of the deterministic digest: Level 1 exists, covers exactly the turns the
// extractor processed, and costs ZERO model calls. Folding is the only mechanism in this plugin that
// makes the prompt cheaper, and it used to wait on a model summary that waited on a ten-turn clock -
// so a ten-floor chat could never fold, and half of the retained test chats had zero folded floors.
//
// The fixture deletes one extraction record on purpose, which is also what keeps every batch here
// unsealed: sealing and coverage are pinned properly in test-v55-digest-batch.mjs, and what this file
// pins is that level 1 covers exactly the turns the extractor processed, at zero model cost.
import assert from 'node:assert/strict';
import { processSummaryHierarchy } from './v55-summary-runtime.js';
import { digestCoveredIndexes } from './v55-digest.js';

const chat = [];
const extractions = {};
for (let i = 0; i < 12; i += 1) {
  chat.push({ is_user: true, mes: '用户第' + i + '句' });
  chat.push({ is_user: false, mes: '助手第' + i + '句：原始标记A' + i });
  // Assistant messages sit at odd indexes, matching collectCompletedDialogueTurns.
  extractions['x' + i] = {
    assistant_index_at_creation: i * 2 + 1,
    event_summary: '事件纪要第' + i + '条。',
    generated_at: 1000 + i,
  };
}
// One turn was never extracted: it must get no line, and therefore must never be folded.
delete extractions['x5'];

const prompts = [];
let calls = 0;
const ctx = {
  extensionSettings: { aetheriaUnifiedMemoryV54: {
    enabled: true, hierarchical_summary_enabled: true,
    summary_level1_every_turns: 10, summary_level2_every_l1: 2, summary_level3_every_l2: 0,
    summary_max_tokens: 256, summary_source_max_chars: 24000,
    summary_fold_hidden_floors: false, summary_fold_keep_recent_floors: 1,
    summary_digest_enabled: true, summary_digest_max_rows: 120, summary_digest_max_chars: 8000,
  } },
  chatMetadata: { aetheriaUnifiedMemoryV54: { extractions, hierarchical_summaries: {
    version: 3, processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [],
    level1: [], level2: [], level3: [], dirty: false,
  } } },
  chat,
  setExtensionPrompt() {},
  saveMetadataDebounced() {},
  saveSettingsDebounced() {},
  generateQuietPrompt: async ({ quietPrompt }) => { prompts.push(String(quietPrompt)); calls += 1; return '模型摘要标记' + calls; },
};

const result = await processSummaryHierarchy(ctx);
const tree = ctx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries;

// Twelve floors at the default of ten per batch, but one of them was never extracted. A batch seals
// only when EVERY floor it owns has a line, so nothing seals here: eleven extracted floors keep eleven
// per-turn rows and the unextracted floor keeps its raw text. That is the coupling folding depends on -
// a floor with no line can never end up inside a sealed batch that then gets folded.
assert.equal(result.digest_lines, 11, 'one line per extracted turn; the unextracted turn has none');
assert.equal(tree.level1.length, 11);
assert.ok(tree.level1.every(row => row.digest === true), 'level 1 is the deterministic digest');
assert.ok(tree.level1.every(row => row.sealed === false), 'a batch with a missing floor never seals');
assert.ok(!tree.level1.some(row => row.text === '事件纪要第5条。'), 'the unextracted turn contributes nothing');

// Order is the story order, and each line stands for exactly one original turn.
const orderIndexes = tree.level1.map(row => Number(/^turn_(\d+)_/.exec(row.source_ids[0])[1]));
assert.deepEqual(orderIndexes, [...orderIndexes].sort((a, b) => a - b), 'lines are in story order');
assert.equal(orderIndexes[0], 1, 'the digest starts at the first extracted turn, not the tenth');

const indexes = [...digestCoveredIndexes(tree.level1)].sort((a, b) => a - b);
// x5 was deleted, and it belongs to the assistant message at index 11.
assert.deepEqual(indexes, [1, 3, 5, 7, 9, 13, 15, 17, 19, 21, 23], 'every extracted turn is covered, and only those');
assert.equal(digestCoveredIndexes(tree.level1).has(11), false, 'the unextracted turn is NOT covered');

// The economics: producing Level 1 cost nothing.
assert.equal(calls, 0, 'the deterministic digest must not spend a single model call');
assert.equal(prompts.length, 0);
assert.equal(result.level2, 0, 'eleven lines is less than the twenty an L2 spans');

// A rebuild is idempotent: digest rows are replaced, never accumulated.
const before = tree.level1.map(row => row.id);
await processSummaryHierarchy(ctx);
assert.deepEqual(ctx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries.level1.map(row => row.id), before, 'a second pass replaces the digest instead of appending to it');

console.log('PASS v5.5 digest integration: Level 1 covers every extracted turn at zero model cost');
