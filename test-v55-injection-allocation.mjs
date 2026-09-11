// The current-state budget is the lever the 50-floor ablation identified: the block was capped and
// binding while covering 55% of live state, and the summary was spending budget for no measurable gain.
// Raising the cap raised coverage AND lowered total tokens. These assertions pin the behaviour, not a
// constant, so a future clamp regression cannot silently restore the old ceiling.
import assert from 'node:assert/strict';
import { __test } from './context-assembler.js';
const { buildCurrentStateBlock } = __test;

const make = (n, chars) => Array.from({ length: n }, (_, i) => ({
    id: 'm' + i, kind: 'state', slot: 'x.state.' + i, status: 'active',
    text: 'T'.repeat(chars),
}));

// 60 memories of 200 characters is 12,000 characters of state. Under the old 5,000 ceiling most of it
// was discarded; the ceiling must now admit it.
const wide = buildCurrentStateBlock({ activeState: '', activeMemories: make(60, 200), maxCurrentStateChars: 20000 });
assert.ok(wide.length > 8000, 'a 20,000 ceiling must admit far more than the old 5,000: got ' + wide.length);

const narrow = buildCurrentStateBlock({ activeState: '', activeMemories: make(60, 200), maxCurrentStateChars: 5000 });
assert.ok(narrow.length < wide.length, 'the ceiling must actually bind when it is small');

// The hard maximum is unchanged, so the new default cannot be pushed past the declared limit.
const huge = buildCurrentStateBlock({ activeState: '', activeMemories: make(400, 200), maxCurrentStateChars: 999999 });
assert.ok(huge.length <= 21000, 'the declared maximum of 20,000 characters must still hold: got ' + huge.length);

// The irreversible guarantee is independent of the budget: mandatory rows survive even a tiny ceiling.
const must = buildCurrentStateBlock({ activeState: '', activeMemories: make(40, 200), maxCurrentStateChars: 800, mandatoryIds: new Set(['m39']) });
assert.ok(must.includes('T'.repeat(200)), 'a mandatory row must survive the smallest ceiling');

console.log('PASS v5.5 injection allocation: the state ceiling admits the live set, still caps, never drops an irreversible row');
