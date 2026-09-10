import assert from 'node:assert/strict';
import { createEmptyStore, applyMemoryOps, getMandatoryMemories } from './memory-core.js';
import { SPINE_KEY, spineTrace, factHistory, spineStats } from './v55-spine.js';

// S1: one spine node per APPLIED operation, and one ledger row per extraction batch.
let result = applyMemoryOps(createEmptyStore(), [
  { op: 'add', kind: 'ownership', slot: '黄铜钥匙.ownership.holder', text: '塞拉菲娜持有黄铜钥匙。', entities: ['黄铜钥匙'], topics: ['所有权'] },
  { op: 'add', kind: 'state', slot: '林昭.location.current', text: '林昭位于钟楼旅店。', entities: ['林昭'], topics: ['位置'] },
], { sourceMessageIndex: 2, sourceHash: 11, sourceMessageText: '塞拉菲娜把钥匙收进怀里。' });
let store = result.store;
assert.ok(store[SPINE_KEY], 'applying operations must produce a spine');
assert.equal(store[SPINE_KEY].nodes.length, 2, 'one node per applied operation');
assert.equal(store[SPINE_KEY].ledger.length, 1, 'one ledger row per batch');

// S5: the first time a slot is seen is recorded exactly once and never again.
assert.equal(store[SPINE_KEY].nodes[0].first, true);
assert.equal(store[SPINE_KEY].nodes[1].first, true);
assert.equal(spineStats(store).first_occurrences, 2);
result = applyMemoryOps(store, [
  { op: 'add', kind: 'state', slot: '林昭.location.current', text: '林昭位于钟楼旅店。', entities: ['林昭'], topics: ['位置'] },
], { sourceMessageIndex: 4, sourceMessageText: '林昭仍在旅店。' });
store = result.store;
assert.equal(store[SPINE_KEY].nodes.at(-1).first, false, 'a repeated slot is not a new first occurrence');
assert.equal(spineStats(store).first_occurrences, 2);

// S2: a supersede is an edge with both ends, and the value history is enumerable.
const before = store.slots['黄铜钥匙.ownership.holder'];
result = applyMemoryOps(store, [
  { op: 'supersede', target_slot: '黄铜钥匙.ownership.holder', kind: 'ownership', slot: '黄铜钥匙.ownership.holder', text: '黄铜钥匙由韩铮保管。', entities: ['黄铜钥匙', '韩铮'], topics: ['所有权'] },
], { sourceMessageIndex: 10, sourceMessageText: '韩铮把钥匙放进舵轮暗格。' });
store = result.store;
const after = store.slots['黄铜钥匙.ownership.holder'];
assert.notEqual(before, after, 'the slot must now point at the replacement');
assert.equal(store.memories[before].superseded_by, after);
assert.equal(store.memories[after].supersedes, before);
const chain = factHistory(store, '黄铜钥匙.ownership.holder');
assert.deepEqual(chain.map(row => row.status), ['superseded', 'active']);
assert.deepEqual(chain.map(row => row.superseded_by), [after, null]);

const trace = spineTrace(store, { slot: '黄铜钥匙.ownership.holder' });
assert.ok(trace.length >= 2, 'the trace must contain both the original add and the supersede');
assert.ok(trace.some(node => node.memory === before && node.op === 'add'), 'the trace must expose the original end of the chain');
assert.ok(trace.some(node => node.target === before), 'the trace must expose the superseded end');
assert.ok(trace.every((node, index) => index === 0 || node.seq > trace[index - 1].seq), 'the trace is ordered');

// S4 input: an irreversible ownership change is mandatory; a reversible state is not.
const mandatoryIds = new Set(getMandatoryMemories(store, 24).map(memory => memory.id));
assert.ok(mandatoryIds.has(after), 'ownership is mandatory');
assert.equal(mandatoryIds.has(store.slots['林昭.location.current']), false, 'a reversible state is not mandatory');

// S8: the ledger has one row per batch, so its size is a function of turns, not of memory count.
const ledgerBefore = store[SPINE_KEY].ledger.length;
for (let i = 0; i < 40; i += 1) {
  result = applyMemoryOps(store, [
    { op: 'add', kind: 'state', slot: 'noise' + i + '.state.x', text: '噪声状态' + i, entities: ['林昭'] },
  ], { sourceMessageIndex: 100 + i, sourceMessageText: '噪声。' });
  store = result.store;
}
assert.equal(store[SPINE_KEY].ledger.length, ledgerBefore + 40);
assert.equal(store[SPINE_KEY].nodes.length, 4 + 40);

// Determinism: replaying the same operations yields a byte-identical spine (no timestamps stored).
const ops = [{ op: 'add', kind: 'knowledge', slot: 'x.knowledge.y', text: '知道了一件事', entities: ['x'] }];
const one = applyMemoryOps(createEmptyStore(), ops, { sourceMessageIndex: 4, sourceMessageText: '你知道了。' }).store;
const two = applyMemoryOps(createEmptyStore(), ops, { sourceMessageIndex: 4, sourceMessageText: '你知道了。' }).store;
assert.equal(JSON.stringify(one[SPINE_KEY]), JSON.stringify(two[SPINE_KEY]), 'the spine must be identical on replay');

console.log('PASS v5.5 spine: deterministic change chain, supersede edges, first occurrence, bounded ledger');
