// Iteration 08: baseline write-gate calibration samples (proposal P1 "校准误删").
//
// Offline we cannot measure a real embedding provider, but we can lock the decision policy for
// the five proposal scenarios and report the story-delta false-reject rate.
import assert from 'node:assert/strict';
import { evaluateBaselineDuplicate, hasExplicitChangeSignal } from './baseline-index.js';

const record = (id, text, entityIds = null) => ({ id, text, normalized: text, ...(entityIds ? { entity_ids: entityIds } : {}) });

const cases = [
  {
    name: '原设定重述',
    baseline: [record('r1', '平成住在城东公寓。')],
    op: { op: 'add', kind: 'state', slot: '平成.residence', text: '平成住在城东公寓。' },
    expectBlocked: true,
    storyDelta: false,
  },
  {
    name: '新事件',
    baseline: [record('r1', '平成住在城东公寓。')],
    op: { op: 'add', kind: 'event', text: '平成今天在城东公寓楼下遇到了璃月。' },
    expectBlocked: false,
    storyDelta: true,
  },
  {
    name: '否定变化',
    baseline: [record('r1', '平成喜欢咖啡。')],
    op: { op: 'add', kind: 'state', slot: '平成.preference.coffee', text: '平成不再喜欢咖啡。' },
    expectBlocked: false,
    storyDelta: true,
  },
  {
    name: '同名实体（显式不同 id）',
    baseline: [record('r1', '小美是城东咖啡店的店员。', ['ent_xiaomei_a'])],
    op: { op: 'add', kind: 'state', slot: '小美.job', text: '小美是城东咖啡店的店员。', entity_ids: ['ent_xiaomei_b'] },
    expectBlocked: false,
    storyDelta: true,
  },
  {
    name: '角色新得知秘密',
    baseline: [record('r1', '档案馆地下二层有密室。')],
    op: { op: 'add', kind: 'knowledge', text: '平成现在知道档案馆地下二层有密室。', entities: ['平成'] },
    expectBlocked: false,
    storyDelta: true,
  },
  {
    name: '语义相近但被明确变化词豁免',
    baseline: [record('r1', '平成住在城东。')],
    op: { op: 'add', kind: 'state', slot: '平成.residence', text: '平成把城东的房子卖掉了。' },
    expectBlocked: false,
    storyDelta: true,
  },
];

let falseRejects = 0;
let storyDeltas = 0;
for (const item of cases) {
  const result = evaluateBaselineDuplicate(item.op, item.baseline, { lexicalThreshold: 0.78, semanticThreshold: 0.84 });
  assert.equal(result.blocked, item.expectBlocked, item.name + ' decision mismatch: ' + JSON.stringify(result));
  if (item.storyDelta) {
    storyDeltas += 1;
    if (result.blocked) falseRejects += 1;
  }
}
assert.equal(hasExplicitChangeSignal('平成把城东的房子卖掉了。'), true);
assert.equal(hasExplicitChangeSignal('平成住在城东。'), false);

const rate = storyDeltas ? falseRejects / storyDeltas : 0;
assert.equal(rate, 0, 'story-delta false-reject rate must stay 0 on the calibration sample');
console.log('PASS baseline calibration: 6 samples, story-delta false-reject rate = ' + rate.toFixed(2) + ' (threshold 0.84 remains provider-calibrated later)');
