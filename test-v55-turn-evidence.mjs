// The retrieval trigger must be computed, not chosen by the model.
//
// The converged semantics say attention is a computed signal and no model holds the veto. Until this
// change the only route by which ORIGINAL text reached the prompt was the model writing a 【查阅记忆】
// marker in its previous reply - and a model writes that only when it already suspects it has forgotten
// something, which is exactly the case it cannot detect. v55-evidence.js says so itself: 'a path that
// only works when the model chooses to speak is the failure mode this project was warned about.'
//
// resolveTurnEvidence is the computed half. It reads the turn, takes its lexical neighbours, drops what
// the prompt already shows, and resolves the rest to original text - every turn, with no model decision
// anywhere in the path.
import assert from 'node:assert/strict';
import { applyMemoryOps, createEmptyStore } from './memory-core.js';
import { formatEvidenceBlock, resolveTurnEvidence } from './v55-evidence.js';

const USER = '你说那口井怎么了？';
const ASSISTANT = '井沿上有几道新的凿痕，打上来的水浮着一层灰。';
const chat = [
    { is_user: true, mes: USER },
    { is_user: false, mes: ASSISTANT },
];

function storeWith(ops, index = 1) {
    let store = createEmptyStore();
    store = applyMemoryOps(store, ops, { sourceMessageIndex: index, sourceMessageText: ASSISTANT }).store;
    return store;
}

const WELL = { op: 'add', kind: 'knowledge', slot: 'Seraphina.knowledge.well_rim', text: '井沿上多了几道新凿痕，井水浮着一层灰。', entities: ['井', '凿痕'], indexable: true };

// 1. The trigger fires with NO model marker anywhere in the transcript.
{
    const store = storeWith([WELL]);
    const result = resolveTurnEvidence(store, chat, {});
    assert.equal(result.query.includes('【查阅记忆】'), false, 'the fixture contains no model marker');
    assert.ok(result.entries.length >= 1, 'the turn alone must trigger retrieval');
}

// 2. What comes back is the ORIGINAL text, not the stored memory.
{
    const store = storeWith([WELL]);
    const result = resolveTurnEvidence(store, chat, {});
    const texts = result.entries.flatMap(entry => (entry.turns || []).map(turn => turn.text)).join('\n');
    assert.ok(texts.includes(ASSISTANT), 'the resolved evidence is the assistant turn verbatim');
    assert.ok(texts.includes(USER), 'and the user turn it answers');
}

// 3. Anything the prompt already carries is a duplicate, not evidence.
{
    const store = storeWith([WELL]);
    const memoryText = Object.values(store.memories)[0].text;
    const hidden = resolveTurnEvidence(store, chat, { alreadyVisible: 'x ' + memoryText.slice(0, 24) + ' y' });
    assert.equal(hidden.entries.length, 0, 'a memory the block already renders is not sent again');
}

// 4. Abstention: naming something the registry tracks while nothing resolves must be SAID, not omitted.
{
    const store = storeWith([WELL]);
    store.entity_registry = { ent_shadow: { entity_id: 'ent_shadow', canonical_name: '影牙', aliases: ['影牙'] } };
    const rows = [{ is_user: true, mes: '影牙还在跟着我们吗？' }, { is_user: false, mes: '风里没有它的味道。' }];
    const result = resolveTurnEvidence(store, rows, {});
    assert.equal(result.entries.length, 0, 'nothing in the store answers this turn');
    assert.equal(result.abstained, true, 'so the system abstains rather than staying silent');
    assert.ok(result.unmatched.includes('影牙'), 'and it names what it could not find');
    const block = formatEvidenceBlock([], { abstained: true, unmatched: result.unmatched });
    assert.ok(block.includes('MEMORY ABSTENTION'), 'the abstention reaches the prompt: ' + block);
    assert.ok(block.includes('影牙'), 'naming the subject');
}

// 5. No abstention when the turn names nothing the registry tracks - silence is correct there.
{
    const store = storeWith([WELL]);
    const rows = [{ is_user: true, mes: '今天天气不错。' }, { is_user: false, mes: '风从林子里过来。' }];
    const result = resolveTurnEvidence(store, rows, {});
    assert.equal(result.abstained, false, 'an ordinary turn is not an abstention');
    assert.equal(formatEvidenceBlock([], { abstained: false, unmatched: [] }), '', 'and emits nothing');
}

// 6. The block is bounded and says where the text came from.
{
    const store = storeWith([WELL]);
    const result = resolveTurnEvidence(store, chat, {});
    const block = formatEvidenceBlock(result.entries, { maxChars: 4000 });
    assert.ok(block.startsWith('[MEMORY EVIDENCE'), 'labelled as evidence, per the 0% warning: ' + block.slice(0, 60));
    assert.ok(/live|cold-snapshot/.test(block), 'and it names the carrier');
    assert.ok(block.length <= 4000, 'bounded');
}

console.log('PASS v5.5 turn evidence: the original-text trigger is computed, and silence is not the fallback');
