// Iteration 08: a selected scene can expand to its linked event evidence (proposal C8).
import assert from 'node:assert/strict';
import { collectSceneEvidence, injectSceneEvidenceBlock } from './v55-finalizer.js';

const store = {
  extractions: {
    k1: {
      transaction_id: 'tx1', event_summary: 'Alice 拿走了钥匙。',
      operations: [
        { op: 'add', kind: 'event', text: 'Alice 在档案室拿走了钥匙。' },
        { op: 'add', kind: 'knowledge', text: 'Alice 知道钥匙的位置。' },
      ],
    },
    k2: {
      transaction_id: 'tx2', event_summary: 'Bob 关闭了档案室。',
      operations: [{ op: 'add', kind: 'world_delta', text: '档案室被封闭。' }],
    },
    k3: { transaction_id: 'tx3', event_summary: '只有摘要的回合。', operations: [] },
  },
};
const scenes = [
  { scene_id: 'scene_a', source_keys: ['k1', 'k2'] },
  { scene_id: 'scene_b', source_keys: ['k3'] },
  { scene_id: 'scene_c', source_keys: ['missing'] },
];

const evidence = collectSceneEvidence(store, scenes, { maxChars: 4000, perScene: 5 });
assert.match(evidence, /拿走/, 'event op text is expanded');
assert.match(evidence, /档案室被封闭/, 'world_delta op text is expanded');
assert.doesNotMatch(evidence, /知道钥匙的位置/, 'knowledge ops are not expanded as scene evidence');
assert.match(evidence, /只有摘要的回合/, 'a transaction with no event ops falls back to its event summary');
assert.doesNotMatch(evidence, /scene_c/, 'scenes without linked records produce no evidence');

const longStore = {
  extractions: {
    k: {
      operations: Array.from({ length: 20 }, (_, i) => ({ op: 'add', kind: 'event', text: '事件' + i + '：' + '很长的描述'.repeat(12) })),
    },
  },
};
const capped = collectSceneEvidence(longStore, [{ scene_id: 's', source_keys: ['k'] }], { maxChars: 300, perScene: 20 });
assert.ok(capped.length > 0 && capped.length <= 300, 'evidence respects the character cap');
assert.ok(capped.length < collectSceneEvidence(longStore, [{ scene_id: 's', source_keys: ['k'] }], { maxChars: 4000, perScene: 20 }).length);

const injected = injectSceneEvidenceBlock('[HISTORICAL MEMORY]', evidence);
assert.match(injected, /SCENE EVIDENCE — LINKED EVENT RECORDS/);
assert.ok(injected.indexOf('SCENE EVIDENCE') > injected.indexOf('[HISTORICAL MEMORY]'), 'evidence is appended after the reference body');
assert.equal(injectSceneEvidenceBlock('[X]', ''), '[X]', 'empty evidence leaves the reference untouched');
assert.match(injectSceneEvidenceBlock('', 'row'), /PLUGIN REFERENCE DATA — NOT DIALOGUE/);

console.log('PASS scene evidence expansion: bounded, derived-only, event/world_delta ops with summary fallback');
