import assert from 'node:assert/strict';
import { provenanceChannel } from './v55-spine.js';
import { applyMemoryOps, createEmptyStore } from './memory-core.js';

assert.equal(provenanceChannel({}, { kind: 'knowledge', text: '林昭从塞拉菲娜处得知，苏晚失踪了。' }), 'told');
assert.equal(provenanceChannel({}, { kind: 'state', text: '林昭位于钟楼旅店。' }), 'saw');
assert.equal(provenanceChannel({}, { kind: 'ownership', text: '黄铜钥匙由韩铮保管。' }), 'saw');
assert.equal(provenanceChannel({}, { kind: 'belief', text: '塞拉菲娜怀疑林昭中毒。' }), 'inferred');
assert.equal(provenanceChannel({}, { kind: 'knowledge', epistemic: 'rumor', text: '城西古井被人投毒。' }), 'inferred');
assert.equal(provenanceChannel({}, { kind: 'knowledge', text: '城西古井被人投毒。' }), 'heard');
assert.equal(provenanceChannel({ channel: 'heard' }, { kind: 'state', text: '随便写点什么。' }), 'heard', 'an explicit channel always wins');

const store = createEmptyStore();
const result = applyMemoryOps(store, [
  { op: 'add', kind: 'knowledge', slot: '林昭.knowledge.suwan_missing', text: '林昭从塞拉菲娜处得知苏晚失踪。', entities: ['苏晚'], channel: 'told' },
  { op: 'add', kind: 'state', slot: '林昭.location.current', text: '林昭在锈锚号上。', entities: ['林昭'] },
], { sourceMessageIndex: 3, sourceMessageText: '苏晚失踪了。' });
const rows = Object.values(result.store.memories);
assert.equal(rows.length, 2);
assert.equal(rows.find(row => String(row.slot).endsWith('knowledge.suwan_missing')).channel, 'told');
assert.equal(rows.find(row => String(row.slot).endsWith('location.current')).channel, 'saw');
for (const row of rows) {
  assert.ok(['saw', 'heard', 'told', 'inferred'].includes(row.channel), 'every memory must answer how it was known');
  assert.ok(Number.isFinite(Number(row.source_message)), 'every memory keeps its source pointer');
}
console.log('PASS v5.5 provenance channel: every memory records how its holder came to know it');
