// The change chain is the only carrier of "why is it like this now", and it was measured to be the first
// casualty of budget pressure (change_log 2026_09_12 entry 10): rendered at the tail of the current-state
// block and appended AFTER the assembler had already spent the whole cap, v55-consistency's
// budgetPromptPair trim removed it wholesale. On the live 28-assistant-floor chat the chain is 694
// characters and losing it drops the certificate's causal from 3/3 to 1/3 at a 6,000-character cap while
// state, commitment, soundness and epistemic all stay green.
//
// These assertions pin the reservation contract: the chain is paid for out of the current-state cap, the
// effective cap can never be pushed below the assembler's own clamp floor, and the reservation costs
// nothing while there is headroom.
import assert from 'node:assert/strict';
import { planSpineReservation, spinePromptBlock, SPINE_STATE_FLOOR, SPINE_VERSION } from './v55-spine.js';

// A store whose chain is comfortably larger than the floor, so the reservation has something to reserve.
const N = 24;
const memories = {};
const slots = {};
const nodes = [];
const bySlot = {};
for (let i = 0; i < N; i += 1) {
    const slot = 'x.slot.' + i;
    const id = 'm' + i;
    memories[id] = { id, kind: 'state', slot, status: 'active', text: '当前值 ' + i + ' ' + 'C'.repeat(30), created_seq: i * 2 };
    slots[slot] = id;
    nodes.push({ id: 'n' + i + 'a', seq: i * 2, slot, memory: id + '_old' });
    nodes.push({ id: 'n' + i + 'b', seq: i * 2 + 1, slot, memory: id, previous: '被替换的旧值 ' + i + ' ' + 'P'.repeat(30) });
    bySlot[slot] = ['n' + i + 'a', 'n' + i + 'b'];
}
const store = {
    version: '5.4', memories, slots, extractions: {}, source_fingerprints: [],
    spine: { version: SPINE_VERSION, nodes, ledger: [], by_slot: bySlot, by_memory: {}, first_by_slot: {}, seq: N * 2 },
};

const FULL = spinePromptBlock(store, { maxChars: 4000, maxRows: 24 });
assert.ok(FULL.length > SPINE_STATE_FLOOR, 'fixture chain must be larger than the clamp floor: ' + FULL.length);

// 1. The chain is reserved whole whenever there is headroom, and costs the state block exactly its size.
{
    const cap = 20000;
    const plan = planSpineReservation(store, { stateCap: cap, maxChars: 4000, maxRows: 24 });
    assert.equal(plan.spineBlock, FULL, 'with headroom the chain is reserved in full');
    assert.equal(plan.currentStateCap, cap - FULL.length, 'the state cap pays for the chain');
    assert.equal(plan.reservedChars + plan.currentStateCap, cap, 'the reservation is exactly the chain');
}

// 2. The regression itself: at every cap the chain is either intact or absent - never half-appended after
//    the state block has already claimed the whole budget.
for (const cap of [20000, 12000, 9000, 7000, 6000, 5500, 3000, 1500, 900]) {
    const plan = planSpineReservation(store, { stateCap: cap, maxChars: 4000, maxRows: 24 });
    assert.ok(plan.reservedChars + plan.currentStateCap <= cap, 'chain plus state must fit the cap at ' + cap);
    assert.ok(plan.spineBlock === '' || plan.spineBlock.startsWith('[记忆变更链'), 'a reserved chain is a whole chain at ' + cap);
    if (cap >= SPINE_STATE_FLOOR + FULL.length) {
        assert.equal(plan.spineBlock, FULL, 'a cap with room must carry the whole chain at ' + cap);
        assert.equal(plan.reservedChars, FULL.length, 'and reserve all of it at ' + cap);
    }
}

// 3. The effective cap may never fall below the floor the assembler clamps at, or the clamp would raise
//    it back and the chain would overflow the block exactly as it did before the fix.
for (const cap of [800, 900, 1000, 1200, 1500, 2000, SPINE_STATE_FLOOR + FULL.length - 1]) {
    const plan = planSpineReservation(store, { stateCap: cap, maxChars: 4000, maxRows: 24 });
    assert.ok(plan.currentStateCap >= SPINE_STATE_FLOOR || cap < SPINE_STATE_FLOOR,
        'the reservation must not push the state cap under the clamp floor at ' + cap + ' (got ' + plan.currentStateCap + ')');
    assert.ok(plan.currentStateCap <= cap, 'the reservation never grows the cap at ' + cap);
}

// 4. At or below the floor there is no room to reserve, and the chain steps aside rather than starving
//    the state block the certificate reads.
{
    const plan = planSpineReservation(store, { stateCap: SPINE_STATE_FLOOR, maxChars: 4000, maxRows: 24 });
    assert.equal(plan.spineBlock, '', 'no reservation is possible at the floor');
    assert.equal(plan.currentStateCap, SPINE_STATE_FLOOR, 'and the cap is handed over untouched');
    const tiny = planSpineReservation(store, { stateCap: 0, maxChars: 4000, maxRows: 24 });
    assert.equal(tiny.spineBlock, '', 'a zero cap reserves nothing');
    assert.equal(tiny.currentStateCap, 0, 'and stays zero');
}

// 5. A store with nothing replaced has no chain, so the cap is untouched.
{
    const flat = {
        memories: { a: { id: 'a', kind: 'state', slot: 's', status: 'active', text: 'x' } },
        slots: { s: 'a' },
        spine: { version: SPINE_VERSION, nodes: [{ id: 'n', seq: 1, slot: 's', memory: 'a' }], ledger: [], by_slot: { s: ['n'] }, by_memory: {}, first_by_slot: {}, seq: 1 },
    };
    const plan = planSpineReservation(flat, { stateCap: 5000, maxChars: 4000, maxRows: 24 });
    assert.equal(plan.spineBlock, '', 'a slot with one node has not changed');
    assert.equal(plan.currentStateCap, 5000, 'and the cap is untouched');
    assert.equal(plan.reservedChars, 0, 'nothing reserved');
}

// 6. Shrinking the chain setting shrinks the reservation, never the other way round.
{
    const narrow = planSpineReservation(store, { stateCap: 20000, maxChars: 600, maxRows: 8 });
    const wide = planSpineReservation(store, { stateCap: 20000, maxChars: 4000, maxRows: 24 });
    assert.ok(narrow.reservedChars <= wide.reservedChars, 'a smaller chain setting reserves no more');
    assert.ok(narrow.reservedChars > 0, 'a 600-character chain still reserves something');
}

console.log('PASS v5.5 spine reservation: the change chain is paid for out of the cap, and never overflows it');
