// A machine verdict is not a conclusion. These are the contracts that keep the difference.
//
// Written against the failure this project kept making: three separate measurements were read wrong because a
// regex was treated as a verdict - a correct answer called a miss, a closed evidence channel charged to the
// model, and a right answer with no evidence in the prompt counted as a memory success. Applying the first
// version of this module to a full matrix then produced "scorer-false-negative" for rows the grader had called
// a hit, which is how the two extra directions below were found.
import assert from 'node:assert/strict';
import { ADJUDICATION_CLASSIFICATIONS, PROMPT_EVIDENCE_ASSESSMENTS, MACHINE_VERDICTS, classifyAnswer,
    derivesSemanticPass, parseAdjudicationJsonl, summarizeAdjudication } from './answer-adjudication.mjs';

const NL = String.fromCharCode(10);
const row = (id, machineVerdict, promptEvidence, replyConveys, extra = {}) =>
    JSON.stringify({ id, machineVerdict, promptEvidence, replyConveys, ...extra });

// --- 1. the taxonomy is derived from the prompt, the reply and the machine verdict -------------------
{
    assert.deepEqual([...MACHINE_VERDICTS], ['hit', 'miss']);
    assert.deepEqual([...PROMPT_EVIDENCE_ASSESSMENTS], ['sufficient', 'missing', 'distorted']);
    assert.deepEqual([...ADJUDICATION_CLASSIFICATIONS].sort(),
        ['confirmed-pass', 'fixture-defect', 'model-error', 'prompt-insufficient',
            'scorer-false-negative', 'scorer-false-positive'].sort());
    const c = (machineVerdict, promptEvidence, replyConveys) => classifyAnswer({ machineVerdict, promptEvidence, replyConveys });
    assert.equal(c('miss', 'sufficient', false), 'model-error');
    assert.equal(c('miss', 'sufficient', true), 'scorer-false-negative', 'the grader was wrong, not the model');
    assert.equal(c('hit', 'sufficient', true), 'confirmed-pass');
    assert.equal(c('hit', 'sufficient', false), 'scorer-false-positive', 'the other direction the method has no name for');
    assert.equal(c('miss', 'missing', false), 'prompt-insufficient');
    assert.equal(c('hit', 'missing', true), 'prompt-insufficient', 'a correct answer on an empty prompt is not a pass');
    assert.equal(c('miss', 'distorted', true), 'prompt-insufficient');
    assert.equal(classifyAnswer({ machineVerdict: 'miss', promptEvidence: 'sufficient', replyConveys: true, fixtureDefect: true }),
        'fixture-defect', 'a broken probe outranks the stage question: it says nothing about any stage');
}

// --- 2. a pass is derived, so a row cannot disagree with its own evidence ------------------------------
{
    assert.equal(derivesSemanticPass({ promptEvidence: 'sufficient', replyConveys: true }), true);
    assert.equal(derivesSemanticPass({ promptEvidence: 'missing', replyConveys: true }), false);
    assert.equal(derivesSemanticPass({ promptEvidence: 'sufficient', replyConveys: false }), false);
    assert.equal(derivesSemanticPass({ promptEvidence: 'sufficient', replyConveys: true, fixtureDefect: true }), false);
    // semanticPass is not an input: writing it cannot make a pass out of an empty prompt.
    const forced = parseAdjudicationJsonl(row('x', 'hit', 'missing', true, { semanticPass: true }));
    assert.deepEqual(forced.errors, []);
    assert.equal(forced.rows[0].semanticPass, false, 'the field is ignored and derived');
    assert.equal(forced.rows[0].classification, 'prompt-insufficient');
}

// --- 3. every problem is collected, and every readable row is returned for repair ---------------------
{
    const parsed = parseAdjudicationJsonl([
        row('a', 'miss', 'nonsense', false),
        row('a', 'miss', 'sufficient', false),
        row('b', 'sort-of', 'sufficient', false),
        'not json',
        JSON.stringify({ machineVerdict: 'miss', promptEvidence: 'sufficient' }),
        row('ok', 'miss', 'sufficient', true),
    ].join(NL));
    assert.equal(parsed.rows.length, 5, 'five of the six lines parse as objects');
    assert.ok(parsed.errors.some(e => e.includes('promptEvidence 无效')));
    assert.ok(parsed.errors.some(e => e.includes('id 重复')), 'a duplicate id is refused');
    assert.ok(parsed.errors.some(e => e.includes('machineVerdict 无效')));
    assert.ok(parsed.errors.some(e => e.includes('不是 JSON')));
    assert.ok(parsed.errors.some(e => e.includes('缺少 id')));
    assert.equal(parsed.rows.find(r => r.id === 'ok').classification, 'scorer-false-negative');
}

// --- 4. the two questions a batch is read for ---------------------------------------------------------
{
    const parsed = parseAdjudicationJsonl([
        row('m1', 'miss', 'sufficient', true),
        row('m2', 'miss', 'sufficient', false),
        row('m3', 'miss', 'missing', false, { carrier: 'none' }),
        row('h1', 'hit', 'sufficient', true, { carrier: 'line' }),
        row('h2', 'hit', 'missing', true, { carrier: 'none' }),
        row('h3', 'hit', 'sufficient', false),
        row('d1', 'miss', 'sufficient', false, { carrier: 'none' }),
        row('f1', 'hit', 'missing', true, { fixtureDefect: true, carrier: 'none' }),
    ].join(NL));
    assert.deepEqual(parsed.errors, []);
    const s = summarizeAdjudication(parsed.rows);
    assert.equal(s.rows, 8);
    assert.equal(s.machineMisses, 4);
    assert.equal(s.realMisses, 2, 'm2 and d1 are the real misses');
    assert.equal(s.machineNegativePrecision, 0.5, 'so half the machine negatives were not negatives at all');
    assert.equal(s.scorerFalseNegatives, 1, 'm1');
    assert.equal(s.machineHits, 4);
    assert.equal(s.scorerFalsePositives, 1, 'h3 was called a hit and conveys nothing');
    assert.equal(s.memoryAttributed, 2, 'm1 and h1: h2 has no evidence, f1 is void');
    assert.equal(s.ungroundedPasses, 1, 'h2 conveys the fact with no evidence; f1 is void instead');
    assert.deepEqual(s.ungroundedIds, ['h2']);
    assert.equal(s.byEvidence.sufficient, 5);
    // d1 says the prompt had the evidence and the carrier resolution says nothing did: reconcile by hand.
    assert.deepEqual(s.disagreements, [{ id: 'd1', promptEvidence: 'sufficient', carrier: 'none' }]);
    assert.equal(summarizeAdjudication([]).machineNegativePrecision, null, 'an empty batch has no rate to report');
    assert.deepEqual(summarizeAdjudication([]).ungroundedIds, []);
}

console.log('answer-adjudication: ok');
