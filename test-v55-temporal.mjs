// Iteration 13: recorded/effective/scope separation and the query-time temporal channel.
import assert from 'node:assert/strict';
import { applyMemoryOps, createEmptyStore, fuseHybridCandidates, selectTemporalCandidates, validateMemoryOp } from './memory-core.js';

let store = createEmptyStore();
let applied = applyMemoryOps(store, [
    { op: 'add', kind: 'knowledge', slot: 'user.preference.style', text: '用户以前喜欢简短回答。', scope: '学习数学时' },
], { sourceMessageIndex: 10, sourceHash: 1, sourceMessageText: '用户以前喜欢简短回答。' });
store = applied.store;
const old = Object.values(store.memories)[0];
assert.equal(old.recorded_at, 10, 'recorded_at records when it was said');
assert.equal(old.effective_from, 10);
assert.equal(old.effective_until, null);
assert.equal(old.scope, '学习数学时');

applied = applyMemoryOps(store, [
    { op: 'add', kind: 'knowledge', slot: 'user.preference.style', text: '用户现在喜欢详细推导。', scope: '学习数学时' },
], { sourceMessageIndex: 12, sourceHash: 2, sourceMessageText: '用户现在喜欢详细推导。' });
store = applied.store;
const closed = store.memories[old.id];
assert.equal(closed.status, 'superseded', 'a newer preference supersedes the old window for knowledge');
assert.equal(closed.effective_until, 12, 'closing must close the effective window, not only valid_until');

const active = selectTemporalCandidates(store, { asOfIndex: 20, limit: 10 });
assert.equal(active.length, 1);
assert.match(active[0].memory.text, /详细推导/);
assert.equal(selectTemporalCandidates(store, { asOfIndex: 20, scope: '学习数学时', limit: 10 })[0].reason, 'scope');
assert.equal(selectTemporalCandidates(store, { asOfIndex: 20, scope: '战斗场景', limit: 10 }).length, 0, 'a different explicit scope is not applicable');
assert.equal(selectTemporalCandidates(store, { asOfIndex: 5, limit: 10 }).length, 0, 'nothing is effective before it is stated');

const scoped = selectTemporalCandidates(store, { asOfIndex: 20, scope: '学习数学时', limit: 10 });
const fused = fuseHybridCandidates(store, [], [], { rrfK: 60, denseGate: false, structuredLists: [scoped], currentMessage: 20, cooldownTurns: 0 });
assert.equal(fused.length, 1);
assert.ok(fused[0].channels.includes('structured1'), 'structured channel is labelled in fusion');

assert.ok(validateMemoryOp({ op: 'add', kind: 'state', text: 'ok', scope: 'x'.repeat(201) }).some(e => /scope/.test(e)));
assert.deepEqual(validateMemoryOp({ op: 'add', kind: 'state', text: 'ok', scope: '学习数学时' }), []);
console.log('PASS three-way recorded/effective/scope model + temporal channel + structured fusion');