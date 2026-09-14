// Offline proofs for the natural track.
//
// The natural track exists to stop a hand-written question from being read as product evidence. Its query is
// the real user message, planned by planRetrievalQuery, and every target it counts is derived from the prefix
// history. These tests use a synthetic 12-turn chat, so they prove the plumbing - mode, folding, visibility,
// the packer's no-re-echo rule and the aggregate - and never claim a real recall number.
import assert from 'node:assert/strict';
import { MEASUREMENT_TRACKS, NATURAL_TRACK, planNaturalTurns, scoreNaturalTurn, summarizeNaturalTrack,
    formatNaturalTrack, naturalDeclaredInputs } from './natural-track.mjs';

// A greeting plus twelve complete turns. Turn 11 asks about a lamp introduced on turn 2; turn 12 is a bare
// continuation command.
const chat = [{ name: 'Seraphina', is_user: false, mes: '雪停了，渡口的灯还亮着。' }];
for (let i = 1; i <= 12; i++) {
    const user = i === 11 ? '那盏青铜灯的裂缝修好了吗？' : (i === 12 ? '继续。' : '第' + i + '回：把水囊收进袋里，往渡口走。');
    const assistant = '第' + i + '回的回复，雨还在下。' + (i === 2 ? '青铜灯上有一道细裂缝，灯座刻着托林的名字。' : '');
    chat.push({ name: '玩家', is_user: true, mes: user });
    chat.push({ name: 'Seraphina', is_user: false, mes: assistant });
}

// --- 1. the tracks are named, and the natural one is separate -----------------------------------------
{
    assert.deepEqual(MEASUREMENT_TRACKS.map(track => track.id),
        ['synthetic-probe', 'source-first-labelled', 'natural-capture']);
    assert.equal(NATURAL_TRACK, 'natural-capture');
    const natural = MEASUREMENT_TRACKS.find(track => track.id === NATURAL_TRACK);
    assert.ok(natural.query.includes('real user message'));
    assert.equal(natural.evidence, 'the only product evidence');
}

// --- 2. a plan exists only after the cadence, and its query is the real user message -------------------
{
    const plans = planNaturalTurns(chat, { cadence: 10 });
    assert.equal(plans.length, 2, 'one plan per real user message once ten turns are complete');
    const [request, continuation] = plans;
    assert.equal(request.turn, 10);
    assert.equal(request.boundary, 10);
    assert.equal(request.plan.mode, 'request');
    assert.equal(request.plan.strategy, 'focused');
    assert.equal(request.plan.query, '那盏青铜灯的裂缝修好了吗？', 'the query is the user text, not a hand-written probe');
    assert.equal(continuation.plan.mode, 'continuation');
    assert.equal(continuation.plan.asked, '继续。');
    assert.notEqual(continuation.plan.query, '继续。', 'a continuation plans the scene query, not the command');
    // Below the cadence there is no plan at all: the replay never measures a generation the runtime would
    // not have made with a folded window.
    assert.equal(planNaturalTurns(chat.slice(0, 11), { cadence: 10 }).length, 0);
}

// --- 3. folding hides the boundary floors and keeps the newest complete pair visible -------------------
{
    const plans = planNaturalTurns(chat, { cadence: 10 });
    const first = plans[0];
    // raw_5 is the assistant row of turn 2; raw_21 is turn 10's assistant reply.
    assert.equal(first.visible.has('raw_5'), false, 'a floor the batch covers is folded');
    assert.equal(first.visible.has('raw_21'), true, 'the newest complete pair stays visible');
    const later = plans[1];
    assert.equal(later.visible.has('raw_5'), false, 'the folded floor stays hidden on the next turn');
    assert.equal(later.boundary, 10);
}

// --- 4. scoring counts only what was packed, and never re-echoes a visible source ---------------------
{
    const plan = planNaturalTurns(chat, { cadence: 10 })[0];
    const scored = scoreNaturalTurn(plan, { evidenceTokens: 1000 });
    assert.equal(scored.mode, 'request');
    assert.equal(scored.query, plan.plan.query);
    assert.equal(scored.queryChars, plan.plan.query.length);
    assert.equal(scored.visibleQuoted, 0, 'the packer skips text the transcript still shows (N7)');
    assert.ok(scored.tokens <= 1000);
    assert.ok(scored.slots >= 0);
    assert.ok(scored.entities.total >= 0);
    assert.equal(scored.directiveSlots, 0, 'the packed evidence never quotes the pending request row');
    const byOtherRule = scoreNaturalTurn(plan, { scorer: 'idf', packPolicy: 'greedy' });
    assert.equal(typeof byOtherRule.tokens, 'number', 'the shipped scorer/packer switches pass through');
}

// --- 5. the continuation turn plans differently and is scored the same way ---------------------------
{
    const plans = planNaturalTurns(chat, { cadence: 10 });
    const continuation = scoreNaturalTurn(plans[1], {});
    assert.equal(continuation.mode, 'continuation');
    assert.equal(continuation.directiveSlots, 0);
    assert.equal(continuation.visibleQuoted, 0);
}

// --- 6. the aggregate and its line ------------------------------------------------------------------
{
    const plans = planNaturalTurns(chat, { cadence: 10 });
    const turns = plans.map(plan => scoreNaturalTurn(plan, {}));
    const summary = summarizeNaturalTrack(turns);
    assert.equal(summary.track, 'natural-capture');
    assert.equal(summary.turns, 2);
    assert.equal(summary.request.turns, 1);
    assert.equal(summary.continuation.turns, 1);
    assert.equal(summary.all.turns, 2);
    assert.ok(summary.all.meanTokens !== null);
    assert.equal(summary.all.directiveSlots, 0);
    const line = formatNaturalTrack(summary);
    assert.ok(line.startsWith('natural capture:'), line);
    assert.ok(line.includes('situation-term recall'), line);
    assert.ok(line.includes('request 1, continuation 1'), line);
}

// --- 7. the declared inputs are the real queries and the union of the per-turn chunks -----------------
{
    const plans = planNaturalTurns(chat, { cadence: 10 });
    const inputs = naturalDeclaredInputs(plans);
    assert.equal(inputs.questions.length, 2, 'the real queries are declared and deduplicated');
    assert.ok(inputs.questions[0].includes('青铜灯'));
    assert.ok(inputs.chunks.length > 0);
    const hashes = new Set(inputs.chunks.map(chunk => String(chunk.hash)));
    assert.equal(hashes.size, inputs.chunks.length, 'the document set is deduplicated by chunk hash');
    assert.deepEqual(naturalDeclaredInputs([]), { chunks: [], questions: [] });
}

// --- 8. maxTurns caps a long chat without changing one plan ------------------------------------------
{
    const plans = planNaturalTurns(chat, { cadence: 10, maxTurns: 1 });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].plan.query, '那盏青铜灯的裂缝修好了吗？');
    assert.equal(planNaturalTurns(chat, { cadence: 10, strategy: 'legacy' })[0].plan.strategy, 'legacy');
}

console.log('PASS natural track: real user queries, synthetic folding, shipped scoring, and the three named tracks');
