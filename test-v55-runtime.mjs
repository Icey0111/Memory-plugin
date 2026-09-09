import assert from 'node:assert/strict';
import {
  normalizeSettingBinding,
  bindingFromSettingStore,
  validateSettingBinding,
  projectSettingStore,
  deriveBranchId,
  buildCanonicalState,
  computeCombinedPromptBudget,
  budgetPromptPair,
} from './v55-runtime.js';

const settingStore = {
  active_world_id: 'w1',
  worlds: {
    w1: { world_id: 'w1', name: 'World 1', active_baseline_revision_id: 'b1', active_extension_revision_ids: ['e1'] },
    w2: { world_id: 'w2', name: 'World 2', active_baseline_revision_id: 'b2', active_extension_revision_ids: [] },
  },
  revisions: {
    b1: { revision_id: 'b1', world_id: 'w1', revision_kind: 'baseline' },
    b2: { revision_id: 'b2', world_id: 'w2', revision_kind: 'baseline' },
    e1: { revision_id: 'e1', world_id: 'w1', revision_kind: 'extension', base_revision_id: 'b1' },
    eBad: { revision_id: 'eBad', world_id: 'w1', revision_kind: 'extension', base_revision_id: 'b2' },
  },
};

assert.deepEqual(bindingFromSettingStore(settingStore), normalizeSettingBinding({ world_id: 'w1', baseline_revision_id: 'b1', extension_revision_ids: ['e1'] }));
assert.equal(validateSettingBinding(settingStore, { world_id: 'w1', baseline_revision_id: 'b1', extension_revision_ids: ['e1'] }).ok, true);
assert.equal(validateSettingBinding(settingStore, { world_id: 'w1', baseline_revision_id: 'b1', extension_revision_ids: ['eBad'] }).ok, false);
const projected = projectSettingStore(settingStore, { world_id: 'w2', baseline_revision_id: 'b2', extension_revision_ids: [] });
assert.equal(projected.applied, true);
assert.equal(projected.store.active_world_id, 'w2');
assert.equal(settingStore.active_world_id, 'w1', 'projection must not mutate library store');

const branchA = deriveBranchId([{ is_user: true, mes: 'hello' }, { is_user: false, mes: 'one', swipe_id: 0 }]);
const branchB = deriveBranchId([{ is_user: true, mes: 'hello' }, { is_user: false, mes: 'two', swipe_id: 1 }]);
assert.notEqual(branchA, branchB, 'regenerated/swiped branch must receive a different branch id');

const canonical = buildCanonicalState({ memories: {
  old: { id: 'old', kind: 'state', slot: 'scene.location', status: 'closed', text: 'Old room', source_message: 1 },
  now: { id: 'now', kind: 'state', slot: 'scene.location', status: 'active', text: 'New room', source_message: 2, entity_ids: ['ent_a'] },
  secret: { id: 'secret', kind: 'knowledge', slot: 'knowledge.secret', status: 'active', text: 'The vault code changed', source_message: 3, known_by_ids: ['ent_a'] },
} });
assert.match(canonical, /New room/);
assert.doesNotMatch(canonical, /Old room/);
assert.match(canonical, /known_by=ent_a/);

assert.equal(computeCombinedPromptBudget({ contextSize: 4000, replyReserve: 1000, maxReferenceChars: 10000, maxCurrentStateChars: 5000 }), 6000);
const bounded = budgetPromptPair('R'.repeat(10000), 'S'.repeat(3000), {
  contextSize: 4000,
  replyReserve: 1000,
  maxReferenceChars: 10000,
  maxCurrentStateChars: 5000,
});
assert.ok(bounded.referenceBlock.length + bounded.currentStateBlock.length <= 6000);
assert.ok(bounded.currentStateBlock.length >= 2900, 'current state should win budget pressure');

console.log('test-v55-runtime: ok');
