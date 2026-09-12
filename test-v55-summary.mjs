import assert from 'node:assert/strict';
import { collectCompletedDialogueTurns, getHierarchicalSummaryContext, normalizeSummaryInjectionDepth, processSummaryHierarchy, refreshSummaryPrompt } from './v55-summary-runtime.js';

const turns = collectCompletedDialogueTurns([
  { is_user: true, mes: '你好' }, { is_user: false, mes: '你好，有什么事？' },
  { is_user: true, mes: '去图书馆。' }, { is_user: false, mes: '好，我们出发。' },
]);
assert.equal(turns.length, 2);
assert.match(turns[0].text, /用户：你好/);
assert.match(turns[0].text, /助手：你好，有什么事？/);
assert.notEqual(turns[0].id, turns[1].id);
assert.equal(normalizeSummaryInjectionDepth(0, 4), 0);
assert.equal(normalizeSummaryInjectionDepth('0', 4), 0);
let modelCalls = 0;
const prompts = [];
const disabledCtx = {
  extensionSettings: { aetheriaUnifiedMemoryV54: { enabled: false, hierarchical_summary_enabled: true, summary_injection_depth: 0 } },
  chatMetadata: { aetheriaUnifiedMemoryV54: {} }, chat: [{ is_user: true, mes: 'A' }, { is_user: false, mes: 'B' }],
  setExtensionPrompt: (...args) => prompts.push(args), generateQuietPrompt: async () => { modelCalls++; return 'should not run'; },
  saveMetadataDebounced() {}, saveSettingsDebounced() {},
};
assert.equal((await processSummaryHierarchy(disabledCtx)).skipped, 'disabled');
assert.equal(modelCalls, 0);
// The standalone summary prompt no longer exists: the summary is injected into the reference block, and
// registering the key with an empty value still costs a projection range the host does not have. Writing
// it on every generation was the third range, and every generation failed because of it.
const promptCountBefore = prompts.length;
assert.equal(refreshSummaryPrompt(disabledCtx), false, 'refreshSummaryPrompt is a no-op now');
assert.equal(prompts.length, promptCountBefore, 'and it registers no prompt at all');
const privacyCtx = {
  name2: 'Bob',
  extensionSettings: { aetheriaUnifiedMemoryV54: { enabled: true, hierarchical_summary_enabled: true, summary_max_context_chars: 6000 } },
  chatMetadata: { aetheriaUnifiedMemoryV54: {
    extractions: { x: { assistant_index_at_creation: 1, event_summary: 'secret', operations: [{ op: 'add', kind: 'knowledge', text: '密码7391', known_by: ['Alice'] }] } },
    hierarchical_summaries: { version: 3, processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [], dirty: false,
      level1: [{ id: 'secret-summary', source_ids: ['turn_1_x'], text: '密码7391' }, { id: 'public-summary', source_ids: ['external-public'], text: 'Bob 去了大厅。' }], level2: [], level3: [] },
  } },
};
const context = getHierarchicalSummaryContext(privacyCtx, { actor: { aliases: ['bob'], ids: [] } });
assert.doesNotMatch(context, /7391/);
assert.match(context, /大厅/);
console.log('PASS v5.5 hierarchical summary: lifecycle, depth, visibility, and standalone cleanup are unified');
