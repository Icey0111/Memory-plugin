import assert from 'node:assert/strict';
import { processSummaryHierarchy } from './v55-summary-runtime.js';

const chat = [];
for (let i = 0; i < 40; i += 1) {
  chat.push({ is_user: true, mes: '用户第' + i + '句：原始内容标记U' + i });
  chat.push({ is_user: false, mes: '助手第' + i + '句：原始内容标记A' + i });
}
const prompts = [];
let call = 0;
const ctx = {
  extensionSettings: { aetheriaUnifiedMemoryV54: {
    enabled: true,
    hierarchical_summary_enabled: true,
    summary_level1_every_turns: 10,
    summary_level2_every_l1: 2,
    summary_level3_every_l2: 0,
    summary_max_tokens: 256,
    summary_source_max_chars: 24000,
    summary_fold_hidden_floors: false,
    // This file covers the model-written Level-1 fallback path. The deterministic digest path is
    // covered by test-v55-digest.mjs and test-v55-digest-integration.mjs.
    summary_digest_enabled: false,
  } },
  chatMetadata: { aetheriaUnifiedMemoryV54: { hierarchical_summaries: {
    version: 3, processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [],
    level1: [], level2: [], level3: [], dirty: false,
  } } },
  chat,
  setExtensionPrompt() {},
  saveMetadataDebounced() {},
  saveSettingsDebounced() {},
  generateQuietPrompt: async ({ quietPrompt }) => {
    prompts.push(String(quietPrompt));
    call += 1;
    return '模型摘要标记' + call;
  },
};

const result = await processSummaryHierarchy(ctx);
const tree = ctx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries;
assert.equal(result.level1, 4, '40 turns at 10 per level-1');
assert.equal(result.level2, 2, '4 level-1 rows at 2 per level-2');
assert.equal(tree.level2.length, 2);

// S3: a level above one cites ORIGINAL turns, never the summary that covered them.
for (const row of tree.level2) {
  assert.ok(row.source_ids.length, 'a level-2 row must carry sources');
  assert.ok(row.source_ids.every(id => id.startsWith('turn_')), 'level 2 must cite original turns: ' + JSON.stringify(row.source_ids));
  assert.ok(!row.source_ids.some(id => id.startsWith('summary_l')), 'no summary-to-summary chain is allowed');
  assert.ok(Array.isArray(row.derived_from) && row.derived_from.every(id => id.startsWith('summary_l1_')), 'the level-1 provenance is kept separately');
}
assert.deepEqual(tree.level2[0].source_ids, tree.level1[0].source_ids.concat(tree.level1[1].source_ids));
assert.deepEqual(tree.level2[1].source_ids, tree.level1[2].source_ids.concat(tree.level1[3].source_ids));

// S3: the model was shown the original dialogue, not the level-1 summary text.
const level2Prompt = prompts[4];
assert.ok(level2Prompt, 'a level-2 prompt must exist');
assert.match(level2Prompt, /原始内容标记A0/, 'level 2 must be generated from the original turns');
assert.match(level2Prompt, /原始内容标记A19/);
assert.ok(!level2Prompt.includes('模型摘要标记1'), 'level 2 must not be generated from a level-1 summary');

// The level-1 rows still carry their own original turn ids, so the tree is one hop from the source.
for (const row of tree.level1) {
  assert.ok(row.source_ids.every(id => id.startsWith('turn_')), 'level 1 also cites original turns');
}
console.log('PASS v5.5 summary source chain: every level above one is built from the original turns');
