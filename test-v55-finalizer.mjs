import assert from 'node:assert/strict';
import {
  applySettingOverrides,
  buildSceneSummaries,
  selectSceneSummaries,
  formatSceneSummaryBlock,
  filterPrivateKnowledge,
  injectSceneSummaryBlock,
  previewUntitledTextSegments,
  settingOverrideKey,
} from './v55-finalizer.js';

const store = {
  entries: {
    e1: { entry_id: 'e1', world_id: 'w1', revision_id: 'r1', content: 'old', title: 'Rule', keys: [], secondary_keys: [], constant: false, disabled: false, order: 1, raw_extra: {}, content_hash: 'oldhash' },
    e2: { entry_id: 'e2', world_id: 'w2', revision_id: 'r2', content: 'other', title: 'Other', keys: [], secondary_keys: [], constant: false, disabled: false, order: 1, raw_extra: {}, content_hash: 'otherhash' },
  },
};
const key = settingOverrideKey('w1', 'r1', 'e1');
const overlaid = applySettingOverrides(store, { [key]: { content: 'new content', keys: ['new'], updated_at: 1 } }, {
  world_id: 'w1', baseline_revision_id: 'r1', extension_revision_ids: [],
});
assert.equal(overlaid.store.entries.e1.content, 'new content');
assert.deepEqual(overlaid.store.entries.e1.keys, ['new']);
assert.notEqual(overlaid.store.entries.e1.content_hash, 'oldhash');
assert.equal(store.entries.e1.content, 'old', 'immutable imported store must not be mutated');
assert.equal(overlaid.store.entries.e2.content, 'other', 'other world must remain untouched');

const memoryStore = {
  extractions: {
    a: {
      transaction_id: 'tx1', world_id: 'w1', chat_id: 'c1', branch_id: 'b1', assistant_index_at_creation: 2,
      event_summary: 'Arrived at the station.',
      operations: [
        { op: 'add', kind: 'state', slot: 'scene.location', text: 'Central Station', entities: ['Alice'] },
        { op: 'add', kind: 'intention', slot: 'alice.goal', text: 'Find the archive', entities: ['Alice'] },
      ],
    },
    b: {
      transaction_id: 'tx2', world_id: 'w1', chat_id: 'c1', branch_id: 'b1', assistant_index_at_creation: 4,
      event_summary: 'Met Bob and obtained a map.',
      operations: [{ op: 'add', kind: 'event', text: 'Map received', entities: ['Alice', 'Bob'] }],
    },
    c: {
      transaction_id: 'tx3', world_id: 'w1', chat_id: 'c1', branch_id: 'b1', assistant_index_at_creation: 6,
      event_summary: 'Entered the old library.',
      operations: [{ op: 'add', kind: 'state', slot: 'scene.location', text: 'Old Library', entities: ['Alice'] }],
    },
  },
};
const scenes = buildSceneSummaries(memoryStore);
assert.equal(scenes.length, 2, 'location change should form a new scene');
assert.deepEqual(scenes[0].source_transaction_ids, ['tx1', 'tx2']);
assert.equal(scenes[1].location, 'Old Library');
const selected = selectSceneSummaries(scenes, 'archive station map', { limit: 2 });
assert.ok(selected.length >= 1);
const sceneBlock = formatSceneSummaryBlock(selected);
assert.match(sceneBlock, /DERIVED, REBUILDABLE/);
assert.match(sceneBlock, /transactions=/);
const referenceWithScene = injectSceneSummaryBlock('[PLUGIN REFERENCE DATA — NOT DIALOGUE]\n\n[HISTORICAL MEMORY — PAST EVENTS, NOT NECESSARILY CURRENT]\nfoo', sceneBlock);
assert.ok(referenceWithScene.indexOf('SCENE SUMMARY LOCATORS') < referenceWithScene.indexOf('HISTORICAL MEMORY'));

const privateStore = {
  memories: {
    public: { id: 'public', kind: 'knowledge', text: 'The gate is open', known_by: [] },
    secret: { id: 'secret', kind: 'knowledge', text: 'Vault code is 1234', known_by: ['Alice'], known_by_ids: ['ent_alice'] },
  },
};
const reference = '<memory id="secret"><summary>Vault code is 1234</summary></memory>\n<direct>keep</direct>';
const current = '- [knowledge:secret] Vault code is 1234\n- [state] visible';
const filteredForBob = filterPrivateKnowledge(reference, current, privateStore, { aliases: ['bob'], ids: ['ent_bob'] });
assert.doesNotMatch(filteredForBob.referenceBlock, /Vault code/);
assert.doesNotMatch(filteredForBob.currentStateBlock, /Vault code/);
assert.deepEqual(filteredForBob.hiddenMemoryIds, ['secret']);
const filteredForAlice = filterPrivateKnowledge(reference, current, privateStore, { aliases: ['alice'], ids: ['ent_alice'] });
assert.match(filteredForAlice.referenceBlock, /Vault code/);

const untitled = previewUntitledTextSegments('第一段。\n\n第二段。\n\n第三段。');
assert.equal(untitled.applicable, true);
assert.equal(untitled.total_segments, 3);
const titled = previewUntitledTextSegments('# Title\nbody');
assert.equal(titled.applicable, false);

console.log('test-v55-finalizer: ok');
