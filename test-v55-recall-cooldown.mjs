// A memory that was never recalled must not be penalised as if it had been recalled at message 0.
import assert from 'node:assert/strict';
import { createEmptyStore, fuseHybridCandidates } from './memory-core.js';

const memory = (id, extra) => ({ id, kind: 'state', status: 'active', importance: 'medium', text: '地点是档案室。', ...extra });
const neverNull = memory('never_null', { last_recalled_message: null });
const neverAbsent = memory('never_absent', {});
const neverZero = memory('never_zero', { last_recalled_message: 0 });
const recalledRecently = memory('recalled_recent', { last_recalled_message: 3 });

const store = createEmptyStore();
store.memories = Object.fromEntries([neverNull, neverAbsent, neverZero, recalledRecently].map(m => [m.id, m]));

// One dense list each, at rank 0 with equal weight, so every row starts from the same score and the only
// difference the ranking can show is the cooldown itself.
const dense = [[neverNull], [neverAbsent], [neverZero], [recalledRecently]];
const rows = fuseHybridCandidates(store, dense, [], {
  denseWeights: [1, 1, 1, 1], currentMessage: 5, cooldownTurns: 6,
});
const score = id => rows.find(row => row.memory.id === id).score;

assert.equal(score('never_null'), score('never_absent'), 'a null stamp and an absent stamp mean the same thing');
assert.equal(score('never_zero'), score('never_absent'), 'a zero stamp means the same thing again');
assert.ok(score('never_absent') > score('recalled_recent'), 'a memory recalled on turn 3, five turns ago, is cooled down');

// The cooldown still works when it applies: a memory recalled inside the window scores below one that was
// not, and a memory recalled outside it is not penalised at all.
const half = memory('recalled_half', { last_recalled_message: 5 });
const store2 = createEmptyStore();
store2.memories = { never_absent: neverAbsent, recalled_half: half };
const rows2 = fuseHybridCandidates(store2, [[neverAbsent], [half]], [], { denseWeights: [1, 1], currentMessage: 6, cooldownTurns: 6 });
const s2 = id => rows2.find(row => row.memory.id === id).score;
assert.ok(s2('never_absent') > s2('recalled_half'), 'a memory recalled on the previous turn is cooled down');
// Recalled on the current turn is age zero, which the cooldown never penalised and still does not.
const rows3 = fuseHybridCandidates(store2, [[neverAbsent], [half]], [], { denseWeights: [1, 1], currentMessage: 5, cooldownTurns: 6 });
const s3 = id => rows3.find(row => row.memory.id === id).score;
assert.equal(s3('never_absent'), s3('recalled_half'), 'age zero is not a cooldown');

console.log('PASS v5.5 recall cooldown: never-recalled is not recalled-at-message-zero');
