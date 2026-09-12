// Three fixes that each remove a bound the design says should not be there.
//
// A0 - entity matching was exact substring containment, so a turn saying 井台 found nothing tagged
//      井水样瓶. The names form containment families, and those families are NOT co-reference (the
//      biggest holds a port city, its slum, an alley, a well, the water, a bottle, a shop and a
//      shopkeeper), so they are a matching aid and must never reach the entity registry.
// D3 - the mandatory baseline sliced its own never-drop set to a planning bound. Measured on the
//      acceptance chat it sat at 23 of 24: the next promise would have been dropped from the baseline
//      silently, at the moment it mattered most.
// D4 - the certificate's sufficiency number is a claim about SLOT-BEARING memories, and was read as a
//      claim about the store. It travels with its scope now.
import assert from 'node:assert/strict';
import { applyMemoryOps, createEmptyStore, entityMatchFamilies, lexicalSearchMemories } from './memory-core.js';
import { mandatoryBaselineSize, mandatoryMemories } from './v55-spine.js';
import { formatCertificate, lengthCertificate } from './v55-certificate.js';

// --- A0: permissive matching, strict identity -------------------------------------------
{
    const families = entityMatchFamilies(['井', '井台', '井水', '井水样瓶', '弥拉', '弥拉的手札', '钟楼']);
    assert.ok(families.get('井台').includes('井水样瓶'), 'names joined by a shared prefix share a family');
    assert.ok(families.get('弥拉').includes('弥拉的手札'), 'a person and her notebook share a family');
    assert.equal(families.has('钟楼'), false, 'a name with no relative is not in any family');
    assert.equal(families.has('井'), false, 'a one-character joiner links but is never itself a member');
    assert.equal(entityMatchFamilies(['甲', '甲虫']).has('甲虫'), false,
        'a single character that is not a prefix or suffix of the other does not join them');
}
{
    // The family is built from the store's OWN vocabulary, not from a dictionary, so two names only
    // relate once both have been extracted. That is the right constraint - the plugin does not know that
    // two things are related until the story has named them both.
    let store = createEmptyStore();
    store = applyMemoryOps(store, [
        { op: 'add', kind: 'knowledge', slot: 'a.knowledge.bottle', text: '井水样瓶里浮着一层灰。', entities: ['井水样瓶'], indexable: true },
        { op: 'add', kind: 'state', slot: 'a.state.platform', text: '井台上结了一层薄霜。', entities: ['井台'], indexable: true },
        // The joiner has to be in the store too. Two names are related only when something the story
        // actually named connects them - here the single character 井, exactly as it did on the live chat.
        { op: 'add', kind: 'state', slot: 'a.state.well', text: '井被石头和石灰封住了。', entities: ['井'], indexable: true },
    ], { sourceMessageIndex: 0, sourceMessageText: '她把井水样瓶举到灯下，瓶里浮着一层灰；井台上结了一层薄霜；井被石头和石灰封住了。' }).store;
    const byName = lexicalSearchMemories(store, '井水样瓶', { limit: 5 });
    const bySibling = lexicalSearchMemories(store, '井台', { limit: 5 });
    const tagged = bySibling.find(row => row.memory.entities.includes('井水样瓶'));
    assert.ok(byName.length >= 1, 'the exact name finds its memory');
    assert.ok(tagged, 'and a sibling name in the same family finds the memory tagged with the other member');
    assert.equal(tagged.entityMatches.length, 1, 'which counts as an entity match, not as loose text overlap');
    const unrelated = lexicalSearchMemories(store, '钟楼', { limit: 5 });
    assert.ok(!unrelated.some(row => row.memory.entities.includes('井水样瓶') && row.entityMatches.length),
        'a name in no family does not become an entity match for it');
}

// --- D3: the baseline is a planning bound, not a truncation ------------------------------
const ops = [];
for (let i = 0; i < 30; i += 1) {
    ops.push({ op: 'add', kind: 'commitment', slot: 'p.commitment.c' + i, text: '第' + i + '个承诺仍然有效。', entities: ['p'] });
}
let big = createEmptyStore();
big = applyMemoryOps(big, ops, { sourceMessageIndex: 0, sourceMessageText: '他答应了很多事。' }).store;
assert.equal(mandatoryMemories(big).length, 30, 'every never-drop memory is returned, not the first 24');
const size = mandatoryBaselineSize(big, 24);
assert.equal(size.count, 30);
assert.equal(size.over_limit, true, 'exceeding the planning bound is reported, not hidden');
const small = createEmptyStore();
const one = applyMemoryOps(small, [{ op: 'add', kind: 'commitment', slot: 'p.commitment.a', text: '他答应过一件事。', entities: ['p'] }],
    { sourceMessageIndex: 0, sourceMessageText: '他答应了。' }).store;
assert.deepEqual(mandatoryBaselineSize(one, 24), { count: 1, limit: 24, over_limit: false });

// --- D4: the sufficiency number carries its scope ----------------------------------------
{
    let store = createEmptyStore();
    store = applyMemoryOps(store, [
        { op: 'add', kind: 'state', slot: 'a.location.current', text: '甲位于钟楼二层。', entities: ['甲'] },
        // Deliberately slotless: the sufficiency number describes slot-bearing memories, and this one is
        // active without owning a slot, so the store is provably bigger than the set it counts.
        { op: 'add', kind: 'commitment', text: '甲答应明天带一只铜铃来。', entities: ['甲'] },
    ], { sourceMessageIndex: 0, sourceMessageText: '甲走进钟楼，甲答应明天带一只铜铃来。' }).store;
    const cert = lengthCertificate(store, { projection: '', actor: '甲' });
    assert.equal(cert.state.scope, 'live-slot-memories', 'the scope is stated, not implied');
    assert.ok(cert.state.active_memories > cert.state.total,
        'and the store is bigger than the set the number describes');
    assert.ok(formatCertificate(cert).includes('slots'),
        'the summary line says which set it counted: ' + formatCertificate(cert));
}

console.log('PASS v5.5 matching and baseline: permissive matching, strict identity, and no silent truncation');