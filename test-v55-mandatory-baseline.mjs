import assert from 'node:assert/strict';
import { assembleGenerationContext } from './context-assembler.js';
import { applyMemoryOps, createEmptyStore, getActiveMemories, getMandatoryMemories } from './memory-core.js';

let store = createEmptyStore();
store = applyMemoryOps(store, [
  { op: 'add', kind: 'commitment', slot: '塞拉菲娜.commitment.baiyuan', text: '塞拉菲娜承诺封城结束后陪林昭去白鸢镇。', entities: ['塞拉菲娜', '林昭'], importance: 'high' },
  { op: 'add', kind: 'ownership', slot: '黄铜钥匙.ownership.holder', text: '黄铜钥匙由韩铮保管。', entities: ['黄铜钥匙', '韩铮'], importance: 'high' },
  { op: 'add', kind: 'state', slot: '林昭.location.current', text: '林昭位于锈锚号船舱。', entities: ['林昭'] },
], { sourceMessageIndex: 0, sourceMessageText: '塞拉菲娜把钥匙交给韩铮，又答应陪林昭去白鸢镇。' }).store;

for (let i = 0; i < 300; i += 1) {
  store = applyMemoryOps(store, [
    { op: 'add', kind: 'knowledge', slot: 'noise' + i + '.knowledge.x', text: '林昭听说了一条无关紧要的传闻' + i + '。', entities: ['林昭'], importance: 'low' },
  ], { sourceMessageIndex: i + 1, sourceMessageText: '噪声。' }).store;
}

const mandatory = getMandatoryMemories(store, 24);
assert.deepEqual(mandatory.map(memory => memory.kind).sort(), ['commitment', 'ownership'], 'only irreversible kinds are mandatory');
assert.ok(mandatory.length <= 24, 'the mandatory baseline is bounded');

const ids = new Set(mandatory.map(memory => memory.id));
const active = getActiveMemories(store, '白鸢镇 黄铜钥匙', 12);
const merged = [...mandatory, ...active.filter(memory => !ids.has(memory.id))];
const bundle = assembleGenerationContext({
  activeMemories: merged, mandatoryIds: ids,
  historyResults: [], settingResults: null,
  maxReferenceChars: 12000, maxCurrentStateChars: 5000,
});
assert.match(bundle.currentStateBlock, /Must-remember/, 'mandatory rows render first under their own heading');
assert.ok(bundle.currentStateBlock.indexOf('Must-remember') < bundle.currentStateBlock.indexOf('Current locations'), 'mandatory precedes the ordinary groups');
for (const memory of mandatory) {
  assert.ok(bundle.currentStateBlock.includes(memory.text), 'a mandatory memory must survive the budget trim: ' + memory.id);
}
assert.equal(bundle.diagnostics.mandatoryCount, 2);

// The guarantee is structural, not budgetary: even the smallest budget keeps the mandatory rows.
const tiny = assembleGenerationContext({
  activeMemories: merged, mandatoryIds: ids,
  historyResults: [], settingResults: null, maxCurrentStateChars: 800,
});
for (const memory of mandatory) {
  assert.ok(tiny.currentStateBlock.includes(memory.text), 'mandatory survives the smallest budget: ' + memory.id);
}
console.log('PASS v5.5 mandatory baseline: irreversible changes survive every budget trim');
