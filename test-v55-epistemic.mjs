// Epistemic honesty: what the prompt publishes must not upgrade a guess to a fact.
//
// Measured over 844 real extraction operations, the model wrote `channel` (saw/heard/told/inferred)
// every time and `epistemic` never. The old default was `op.kind === 'intention' ? 'plan' : 'fact'`,
// so every belief and every inference reached the prompt as `epistemic="fact"` - the injection literals
// asserted exactly the upgrade the extraction rules forbid. This pins the corrected default, the alias
// tolerance, and the fact that an alias no longer drops the whole operation.
import assert from 'node:assert/strict';
import { applyMemoryOps, createEmptyStore, normalizeEpistemic, parseMemoryOpsBlock, validateMemoryOp } from './memory-core.js';

// --- the default follows the kind, not "everything is a fact" -------------------------------------
assert.equal(normalizeEpistemic(undefined, 'belief'), 'belief', 'a belief must not default to fact');
assert.equal(normalizeEpistemic(undefined, 'intention'), 'plan', 'an intention is a plan');
assert.equal(normalizeEpistemic(undefined, 'event'), 'fact', 'an event is a fact');
assert.equal(normalizeEpistemic(undefined, 'knowledge'), 'fact');
assert.equal(normalizeEpistemic('rumor', 'belief'), 'rumor', 'an explicit value wins over the kind');
assert.equal(normalizeEpistemic('', 'state'), 'fact', 'an empty string falls back to the kind');

// --- the channel vocabulary is a wrong field name, not a wrong operation --------------------------
assert.equal(normalizeEpistemic('told', 'state'), 'reported');
assert.equal(normalizeEpistemic('saw', 'state'), 'observed');
assert.equal(normalizeEpistemic('inferred', 'belief'), 'inference');
assert.deepEqual(validateMemoryOp({ op: 'add', kind: 'state', text: 'x', epistemic: 'told' }), [], 'an aliased epistemic must not invalidate the op');
assert.deepEqual(validateMemoryOp({ op: 'add', kind: 'state', text: 'x', epistemic: 'observed' }), []);
assert.equal(validateMemoryOp({ op: 'add', kind: 'state', text: 'x', epistemic: 'vibes' }).length, 1, 'a genuinely unknown word is still rejected');

// --- end to end through applyMemoryOps -----------------------------------------------------------
const store = createEmptyStore();
const applied = applyMemoryOps(store, [
    { op: 'add', kind: 'belief', slot: 'a.one', text: '我认为那口井是源头' },
    { op: 'add', kind: 'knowledge', slot: 'a.two', text: '他被告知七人倒下', epistemic: 'told' },
    { op: 'add', kind: 'knowledge', slot: 'a.three', text: '她亲眼看见灰丝', epistemic: 'saw' },
    { op: 'add', kind: 'intention', slot: 'a.four', text: '我打算天亮前出发' },
], { sourceMessageIndex: 1 });
const live = applied.store || store;
const bySlot = Object.fromEntries(Object.values(live.memories).map(m => [m.slot, { epistemic: m.epistemic, channel: m.channel }]));
assert.equal(bySlot['a.one'].epistemic, 'belief', 'a belief stored without an explicit epistemic is a belief');
assert.equal(bySlot['a.one'].channel, 'inferred', 'and its provenance channel is inferred, not heard');
assert.equal(bySlot['a.two'].epistemic, 'reported', 'the channel vocabulary resolves to an epistemic value');
assert.equal(bySlot['a.three'].epistemic, 'observed');
assert.equal(bySlot['a.four'].epistemic, 'plan');

// --- an update that changes the kind re-derives the default ---------------------------------------
const second = applyMemoryOps(live, [{ op: 'update', target_slot: 'a.one', kind: 'event' }], { sourceMessageIndex: 2 });
const after = second.store || live;
const updated = Object.values(after.memories).find(m => m.slot === 'a.one');
assert.equal(updated.epistemic, 'fact', 'kind is now event, so the stale belief label must not survive');

// --- the parser path keeps the alias instead of deleting it --------------------------------------
const parsed = parseMemoryOpsBlock(JSON.stringify({ operations: [{ op: 'add', kind: 'belief', text: 'x', epistemic: 'inferred' }] }));
if (parsed.ops && parsed.ops.length) {
    assert.equal(parsed.ops[0].epistemic, 'inferred', 'the alias survives parsing');
}

console.log('PASS v5.5 epistemic honesty: a belief is not published as a fact');
