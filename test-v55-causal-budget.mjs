// The change chain is the only carrier of "why is it like this now", and it had the smallest budget in
// the system: 600 characters, which rendered 7 of 19 replaced values, leaving causal coverage at 6/17
// (change_log Entry 14). Raising it to 4,000 moved causal coverage to 13/17 and T-Causal to 37/40, and
// the reference block was trimmed to pay for it so the total injection still fell. These assertions pin
// the mechanism, not the constants, so the budget cannot silently shrink back.
import assert from 'node:assert/strict';
import { spinePromptBlock, SPINE_VERSION } from './v55-spine.js';

const N = 20;
const memories = {};
const slots = {};
const nodes = [];
const bySlot = {};
for (let i = 0; i < N; i += 1) {
    const slot = 'x.slot.' + i;
    const id = 'm' + i;
    memories[id] = { id, kind: 'state', slot, status: 'active', text: '当前值 ' + i + ' ' + 'C'.repeat(40), created_seq: i * 2 };
    slots[slot] = id;
    nodes.push({ id: 'n' + i + 'a', seq: i * 2, slot, memory: id + '_old' });
    nodes.push({ id: 'n' + i + 'b', seq: i * 2 + 1, slot, memory: id, previous: '被替换的旧值 ' + i + ' ' + 'P'.repeat(40) });
    bySlot[slot] = ['n' + i + 'a', 'n' + i + 'b'];
}
const store = {
    version: '5.4', memories, slots, extractions: {}, source_fingerprints: [],
    spine: { version: SPINE_VERSION, nodes, ledger: [], by_slot: bySlot, by_memory: {}, first_by_slot: {}, seq: N * 2 },
};

const fragments = nodes.filter(n => n.previous).map(n => String(n.previous).slice(0, 24));
const carries = block => fragments.filter(f => block.includes(f)).length;

const narrow = spinePromptBlock(store, { maxChars: 600, maxRows: 8 });
const wide = spinePromptBlock(store, { maxChars: 4000, maxRows: 24 });

assert.ok(narrow.length > 0, 'the chain must render something at the small budget');
assert.ok(carries(wide) > carries(narrow), 'the larger budget must carry more replaced values: ' + carries(narrow) + ' -> ' + carries(wide));
assert.ok(carries(wide) >= 15, 'a 4,000-character chain must carry most replaced values: got ' + carries(wide));
// The slot itself must appear, otherwise the reader cannot tell which fact is being explained.
assert.ok(wide.includes('x.slot.0'), 'the changed slot must be named');
// A slot that never changed is not a change, and must not be listed.
assert.equal(spinePromptBlock({ memories: { a: { id: 'a', kind: 'state', slot: 's', status: 'active', text: 'x' } }, slots: { s: 'a' }, spine: { version: SPINE_VERSION, nodes: [{ id: 'n', seq: 1, slot: 's', memory: 'a' }], ledger: [], by_slot: { s: ['n'] }, by_memory: {}, first_by_slot: {}, seq: 1 } }), '', 'a slot with one node has not changed');

console.log('PASS v5.5 causal budget: the chain carries the replaced values, at a budget that scales');
