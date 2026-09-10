import assert from 'node:assert/strict';
import { buildSceneSummaries, collectSceneEvidence, formatSceneSummaryBlock } from './v55-finalizer.js';
import { filterSummaryTreeForActor, sanitizeStoreForActor } from './v55-privacy.js';

const secret = '保险库密码是 7391';
const store = { extractions: { tx: { transaction_id: 'tx-secret', assistant_index_at_creation: 3, event_summary: `Bob 看见桌子；${secret}。`, operations: [
  { op: 'add', kind: 'event', text: 'Bob 看见桌子。', entities: ['Bob'] },
  { op: 'add', kind: 'knowledge', text: secret, entities: ['Alice'], known_by: ['Alice'] },
] } } };
const bob = { aliases: ['bob'], ids: [] };
const sanitized = sanitizeStoreForActor(store, bob);
assert.equal(sanitized.hiddenOperationCount, 1);
assert.equal(sanitized.hiddenSourceKeys.length, 1);
assert.doesNotMatch(sanitized.store.extractions.tx.event_summary, /7391/);
assert.match(sanitized.store.extractions.tx.event_summary, /桌子/);
const scenes = buildSceneSummaries(sanitized.store);
const sceneText = formatSceneSummaryBlock(scenes);
const evidence = collectSceneEvidence(sanitized.store, scenes, { maxChars: 4000 });
assert.doesNotMatch(sceneText, /7391/);
assert.doesNotMatch(evidence, /7391/);
assert.match(`${sceneText}\n${evidence}`, /桌子/);
const tree = { level1: [
  { id: 'l1-secret', source_ids: ['turn_3_deadbeef'], text: secret },
  { id: 'l1-public', source_ids: ['turn_5_ok'], text: '公开摘要' },
], level2: [{ id: 'l2-secret', source_ids: ['l1-secret'], text: `阶段：${secret}` }], level3: [{ id: 'l3-secret', source_ids: ['l2-secret'], text: `长期：${secret}` }] };
const visibleTree = filterSummaryTreeForActor(tree, store, bob);
assert.deepEqual(visibleTree.level1.map(row => row.id), ['l1-public']);
assert.equal(visibleTree.level2.length, 0);
assert.equal(visibleTree.level3.length, 0);
console.log('PASS v5.5 privacy: derived scene/evidence/hierarchical summaries cannot reintroduce hidden knowledge');
