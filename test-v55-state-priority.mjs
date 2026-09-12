// The current-state block renders every live memory and then cuts whatever does not fit, so the ORDER
// of the rows is the priority: whatever is last is what is lost when the budget binds.
//
// This used to be a fixed topical order - locations, present, conditions, commitments, knowledge,
// other - which is not the canonical order at all. Measured on the 51-assistant-floor chat (101 rows,
// 217 live memories, 197 slot-bearing) at the 20,000-character ceiling the assembler clamps to:
//
//   Knowledge changes    0 of 46 rendered   - the whole group sat past the cut
//   Other active facts   0 of  4 rendered   - world_delta, same
//   Open commitments     0 of 13 rendered   - survived only through the Must-remember baseline
//   intentions           3 of  9 rendered
//   Active conditions  123 rows rendered, and because that one group held state (weight 7),
//                      relation/ownership (4) and belief (2) together, 65 beliefs were emitted
//                      BEFORE any knowledge row (weight 3) could be reached.
//
// These assertions pin the property that fixes it: the surviving set is always a prefix of the
// canonical weight order, so a lower-consequence memory can never outrank a higher one.
import assert from 'node:assert/strict';
import { assembleGenerationContext } from './context-assembler.js';

const PLAN = [
    ['state', 8], ['commitment', 8], ['knowledge', 20], ['belief', 40], ['world_delta', 4],
];
const WEIGHT = { state: 7, commitment: 5, knowledge: 3, belief: 2, world_delta: 1 };

const activeMemories = [];
for (const [kind, count] of PLAN) {
    for (let i = 0; i < count; i += 1) {
        activeMemories.push({
            id: kind + '_' + i,
            kind,
            slot: kind + '.slot_' + i,
            text: kind + '记录' + i + '：' + '甲'.repeat(28),
        });
    }
}
const total = activeMemories.length;
const kindOf = text => activeMemories.find(m => text.includes(m.text))?.kind;

function blockAt(maxCurrentStateChars) {
    return assembleGenerationContext({
        activeMemories,
        historyResults: [],
        settingResults: null,
        maxReferenceChars: 0,
        maxCurrentStateChars,
    }).currentStateBlock;
}

// 1. A generous budget renders every live memory, in every kind.
{
    const block = blockAt(20000);
    for (const memory of activeMemories) {
        assert.ok(block.includes(memory.text), 'a generous budget must carry every live memory: ' + memory.id);
    }
}

// 2. The invariant, at every budget from tight to generous: if a memory survived and another did not,
//    the survivor is never the less consequential one.
for (const cap of [800, 1200, 1500, 2000, 2600, 3400, 4200, 6000, 9000]) {
    const block = blockAt(cap);
    const kept = activeMemories.filter(m => block.includes(m.text));
    const dropped = activeMemories.filter(m => !block.includes(m.text));
    if (!kept.length || !dropped.length) continue;
    const worstKept = Math.min(...kept.map(m => WEIGHT[m.kind]));
    const bestDropped = Math.max(...dropped.map(m => WEIGHT[m.kind]));
    assert.ok(worstKept >= bestDropped,
        'at cap ' + cap + ' a weight-' + worstKept + ' memory survived while a weight-' + bestDropped + ' one was cut');
}

// 3. The specific defect: belief (weight 2) must never be rendered while knowledge (weight 3) is cut.
//    In the old topical order this was guaranteed to happen, because belief rode inside the
//    "conditions" group, which was emitted two headings before "Knowledge changes".
for (const cap of [1400, 1500, 1700, 2000, 2400, 3000]) {
    const block = blockAt(cap);
    const beliefs = activeMemories.filter(m => m.kind === 'belief' && block.includes(m.text)).length;
    const knowledge = activeMemories.filter(m => m.kind === 'knowledge' && block.includes(m.text)).length;
    if (beliefs > 0) {
        assert.equal(knowledge, 20, 'at cap ' + cap + ' a belief was rendered while ' + (20 - knowledge) + ' knowledge rows were cut');
    }
}

// 4. The trim is a tail cut, so the kinds that survive are the leading ones - not an arbitrary subset.
{
    const block = blockAt(1500);
    const kindsSeen = new Set(activeMemories.filter(m => block.includes(m.text)).map(m => m.kind));
    assert.ok(kindsSeen.has('state'), 'the highest weight kind always renders');
    assert.ok(kindsSeen.has('commitment'), 'the second highest always renders');
    assert.ok(!kindsSeen.has('world_delta'), 'the lowest weight kind is the first to go');
}

// 5. The mandatory baseline is still emitted before every ordinary group.
{
    const mandatory = [activeMemories.find(m => m.kind === 'commitment')];
    const ids = new Set(mandatory.map(m => m.id));
    const block = assembleGenerationContext({
        activeMemories, mandatoryIds: ids, historyResults: [], settingResults: null,
        maxReferenceChars: 0, maxCurrentStateChars: 1500,
    }).currentStateBlock;
    assert.ok(block.includes('Must-remember'), 'the irreversible rows are labelled');
    const firstHeading = block.search(/^(Current|Open|Relations|Knowledge|Beliefs|Other)/m);
    assert.ok(block.indexOf('Must-remember') < firstHeading, 'and rendered before every ordinary group');
    for (const memory of mandatory) assert.ok(block.includes(memory.text), 'the mandatory row survives');
}

// 6. Group headings are emitted once per contiguous run, never row by row.
{
    const block = blockAt(20000);
    const headings = block.match(/^(Current locations|Present characters \/ scene participants|Current state|Open commitments \/ objectives|Relations \/ ownership|Knowledge changes|Beliefs \/ expectations|Other active facts):$/gm) || [];
    assert.equal(headings.length, new Set(headings).size, 'a heading is not repeated while its rows are contiguous');
    assert.ok(headings.length >= 5, 'the block is still grouped: got ' + headings.length + ' headings');
}

// 7. Within one kind, the tiebreak is recoverability-by-epistemic, not recency.
//
// The kind ordering decides which categories survive a trim; this decides which rows of an equally
// ranked category do. Recency used to be the tiebreak and was measured to be a weak relevance signal.
// The replacement ranks by how hard the memory is to recover from elsewhere in the prompt: content the
// character personally observed or reasoned to exists only in the turn that produced it, while a plain
// fact is by definition the kind of thing the setting, the world book or the scene can supply again.
{
    const rows = [];
    for (let i = 0; i < 30; i += 1) rows.push({ id: 'f' + i, kind: 'state', slot: 'state.fact_' + i, epistemic: 'fact', text: '客观事实记录' + i + '：' + '甲'.repeat(28), source_message: i });
    for (let i = 0; i < 10; i += 1) rows.push({ id: 'o' + i, kind: 'state', slot: 'state.seen_' + i, epistemic: 'observed', text: '亲眼所见记录' + i + '：' + '乙'.repeat(28), source_message: 100 + i });
    const block = assembleGenerationContext({
        activeMemories: rows, historyResults: [], settingResults: null,
        maxReferenceChars: 0, maxCurrentStateChars: 2000,
    }).currentStateBlock;
    const seen = rows.filter(r => r.epistemic === 'observed' && block.includes(r.text)).length;
    const facts = rows.filter(r => r.epistemic === 'fact' && block.includes(r.text)).length;
    assert.equal(seen, 10, 'every first-hand row survives before any restatement: got ' + seen + '/10');
    assert.ok(facts < 30, 'and the trim lands on the restatements: ' + facts + ' of 30 kept');
    assert.ok(facts > 0, 'without discarding them entirely while room remains');
}

// 8. Epistemic ranks below kind: a low-retention kind never outranks a high-retention one.
{
    // The commitment carries the HIGHER retention (observed 5) and the state the lower (fact 2). If
    // epistemic outranked kind, the commitment would be rendered first. It must not be.
    const rows = [
        { id: 'c', kind: 'commitment', slot: 'commitment.seen', epistemic: 'observed', text: '承诺记录：' + '甲'.repeat(30) },
        { id: 's', kind: 'state', slot: 'state.fact', epistemic: 'fact', text: '亲眼所见：' + '乙'.repeat(30) },
    ];
    const block = assembleGenerationContext({
        activeMemories: rows, historyResults: [], settingResults: null,
        maxReferenceChars: 0, maxCurrentStateChars: 900,
    }).currentStateBlock;
    assert.ok(block.includes(rows[0].text) && block.includes(rows[1].text), 'a small fixture carries both');
    assert.ok(block.indexOf('亲眼所见') < block.indexOf('承诺记录'),
        'state (kind weight 7) must precede commitment (kind weight 5) even though the commitment has the '
        + 'higher epistemic retention - the kind order is the primary key');
}

assert.equal(kindOf('nothing'), undefined);
console.log('PASS v5.5 state priority: the budget trims the least consequential memory, and ' + total + ' rows stay ordered');
