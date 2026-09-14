// Offline proofs for the detail-survival mode.
//
// The live mode costs a story generation and needs a host page, so its decision logic is proved here against
// captured text: the adaptive split against a committed summary, the channel each needle is read in from the
// probe turn's own injections.thisTurn, and the four counts the acceptance asks for. The baseline this
// reproduces is PR #1: four details the merged summary dropped were recovered from quoted original rows, one
// retained control came from continuity, and a never-written value was refused.
//
// The trap this file guards is the instrument defect fixed in 76c50d0: the block a turn saw is its own
// injections.thisTurn, not the previous turn's injections.before. Grading before made retrieval look a turn
// late on the live run, so the driver source is checked for the label it reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DETAIL_CHANNELS, DETAIL_EXPECTATIONS, normalizeText, needleForms, containsAny, parseTurnsFile,
  continuityBag, splitDetailsByRetention, choosePositive, buildProbeItems, buildProbeQuestion,
  attributeChannel, looksLikeLanguageMismatch, gradeProbeItem, summarizeDetailSurvival,
  formatDetailReport, buildDetailEvidence, matchNeedle, FACT_KINDS, DEFAULT_FACT_KIND, isMustKeep,
  summarizeFactSurvival, formatFactSurvival, leaksNeedle,
} from './detail-survival.mjs';
import { parseAdjudicationJsonl, summarizeAdjudication } from './answer-adjudication.mjs';

const detail = (id, needle, question, expect, turn) => ({ id, needle, question, expect, turn });
const adjudicate = graded => {
  const parsed = parseAdjudicationJsonl(graded.map(row => JSON.stringify(row.mechanical)).join('\n'));
  assert.deepEqual(parsed.errors, []);
  return parsed.rows;
};

// --- 1. the turns-file schema: legacy is read, a detailed file is validated, nothing is assumed --------
{
  const legacy = parseTurnsFile(['a', 'b']);
  assert.equal(legacy.legacy, true);
  assert.deepEqual(legacy.turns.map(turn => turn.text), ['a', 'b']);
  assert.deepEqual(legacy.details, []);
  const parsed = parseTurnsFile({
    cadence: 10, phase1Turns: 20, probeMode: 'perTurn',
    turns: [
      { text: 't1', details: [{ id: 'd1', needle: ['水囊', 'waterskin'], question: '水囊有几块补丁？', expect: 'dropped' }] },
      { text: 't2' },
    ],
    negativeControls: [{ id: 'n1', needle: '暗红', question: '工具袋是什么颜色？' }],
  });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.cadence, 10);
  assert.equal(parsed.phase1Turns, 20);
  assert.equal(parsed.probeMode, 'perTurn');
  assert.equal(parsed.details.length, 1);
  assert.deepEqual(parsed.details[0].needle, ['水囊', 'waterskin']);
  assert.equal(parsed.details[0].turn, 1);
  assert.equal(parsed.negatives.length, 1);
  assert.equal(parsed.negatives[0].kind, 'negative');
  // Problems are collected rather than thrown, so a file is repaired in one pass.
  const bad = parseTurnsFile({ turns: [
    { text: 't1', details: [detail('', [], '', 'nonsense'), detail('x', 'a', 'q', 'dropped')] },
    { text: 't2', details: [detail('x', 'b', 'q2', 'dropped')] },
  ], negativeControls: [{ id: 'n', needle: 'z' }] });
  assert.ok(bad.errors.some(error => error.includes('缺少 id')));
  assert.ok(bad.errors.some(error => error.includes('缺少 needle')));
  assert.ok(bad.errors.some(error => error.includes('缺少 question')));
  assert.ok(bad.errors.some(error => error.includes('id 重复: x')));
  assert.ok(DETAIL_EXPECTATIONS.includes('unsure'));
  assert.deepEqual([...DETAIL_CHANNELS], ['continuity', 'evidence', 'both', 'none']);
}

// --- 2. matching folds case and width; an empty needle never matches -----------------------------------
{
  assert.equal(normalizeText('  A  B '), 'a b');
  assert.equal(containsAny('The Three Patches', ['three patches']), true);
  assert.equal(containsAny('全角１２３', ['123']), true, 'NFKC folds full-width digits');
  assert.equal(containsAny('', ['x']), false);
  assert.equal(containsAny('anything', []), false);
  assert.deepEqual(needleForms({ needle: ['A', ''] }), ['a']);
  assert.deepEqual(needleForms({}), []);
}

// --- 3. the adaptive split reads the committed summary, not the author's expectation -------------------
{
  const bag = continuityBag({
    summary: { text: '托林·瓦什住在断桅渡；他用一种胶修补湿木头。' },
    anchors: { active: [{ kind: '状态', text: '风灯挂在门边' }] },
    knowledge: { entries: [{ kind: '托林', text: '托林不知道水囊的补丁数' }] },
  });
  const details = [
    detail('d-person', ['托林·瓦什'], '新来的那个人叫什么？', 'summary', 2),
    detail('d-glue', ['胶'], '他用什么粘湿木头？', 'dropped', 5),
    detail('d-patches', ['三块皮子'], '水囊上有几块补丁？', 'dropped', 3),
    detail('d-ear', ['铜环'], '他左边耳垂上有什么？', 'dropped', 4),
  ];
  const split = splitDetailsByRetention(details, bag);
  assert.equal(split.total, 4);
  assert.deepEqual(split.retained.map(item => item.id), ['d-person', 'd-glue']);
  assert.deepEqual(split.dropped.map(item => item.id), ['d-patches', 'd-ear']);
  assert.deepEqual(split.expectationMismatches, ['d-glue'], 'the expectation is calibration, never selection');
  // An anchor or a knowledge line also counts as the summary carrying the detail.
  const extra = splitDetailsByRetention([detail('a', ['风灯'], 'q', 'unsure', 1),
    detail('k', ['水囊'], 'q', 'unsure', 1)], bag);
  assert.deepEqual(extra.retained.map(item => item.id), ['a', 'k']);
  assert.equal(choosePositive([]), null, 'no retained detail means no positive control');
  assert.equal(choosePositive(split.retained).id, 'd-person', 'the earliest retained detail is the control');
}

// --- 4. one probe turn asks the dropped details, the control and the negative control -----------------
{
  const dropped = [detail('d-patches', ['三块皮子'], '水囊上有几块补丁？', 'dropped', 3)];
  const positive = detail('d-person', ['托林·瓦什'], '新来的那个人叫什么？', 'summary', 2);
  const negatives = [{ id: 'n-bag', needle: ['暗红'], question: '工具袋是什么颜色？', kind: 'negative', turn: null, expect: 'unsure' }];
  const items = buildProbeItems({ dropped, positive, negatives });
  assert.deepEqual(items.map(item => item.id), ['d-patches', 'd-person', 'n-bag']);
  assert.deepEqual(items.map(item => item.kind), ['detail', 'positive', 'negative']);
  const question = buildProbeQuestion(items);
  assert.deepEqual(question.leaks, [], 'a question names the subject, never the value');
  assert.ok(question.text.includes('水囊上有几块补丁？'));
  assert.ok(question.text.includes('保留编号'));
  // A question that contains its own answer is refused before a generation is spent.
  const leaky = buildProbeQuestion([detail('d', ['三块皮子'], '水囊上有三块皮子吗？', 'dropped', 1)]);
  assert.deepEqual(leaky.leaks, ['d']);
}

// --- 5. the channel is read from the block the probe turn saw -----------------------------------------
{
  const item = { id: 'd', needle: ['三块皮子'] };
  const none = attributeChannel({ current_state: '托林·瓦什', reference: '无关原文' }, item);
  assert.deepEqual([none.channel, none.continuity, none.evidence], ['none', false, false]);
  assert.equal(attributeChannel({ current_state: '托林·瓦什', reference: '水囊上有三块皮子。' }, item).channel, 'evidence');
  assert.equal(attributeChannel({ current_state: '摘要说三块皮子。', reference: null }, item).channel, 'continuity');
  assert.equal(attributeChannel({ current_state: '三块皮子', reference: '三块皮子' }, item).channel, 'both');
  // thisTurn is the block this generation set; before is the previous turn's block.
  const injection = { thisTurn: { current_state: null, reference: '水囊上有三块皮子。' },
    before: { current_state: '三块皮子', reference: null } };
  assert.equal(attributeChannel(injection.thisTurn, item).channel, 'evidence');
}

// --- 6. grading hands the channel and the machine verdict to answer-adjudication -----------------------
{
  const item = { id: 'd-patches', kind: 'detail', needle: ['三块皮子', 'three patches'],
    question: '水囊上有几块补丁？', expect: 'dropped', turn: 3 };
  const recovered = gradeProbeItem(item, { injection: { current_state: null, reference: '三块皮子' },
    replyText: 'Three patches.', questionText: '水囊上有几块补丁？' });
  assert.equal(recovered.channel, 'evidence');
  assert.equal(recovered.needleInReply, true);
  assert.equal(recovered.mechanical.promptEvidence, 'sufficient');
  assert.equal(recovered.mechanical.carrier, 'evidence');
  assert.equal(adjudicate([recovered])[0].classification, 'confirmed-pass');
  assert.equal(adjudicate([recovered])[0].semanticPass, true);
  // The evidence carried it and the reply missed it: the model-error sample section C is still missing.
  const missed = gradeProbeItem(item, { injection: { current_state: null, reference: '三块皮子' },
    replyText: '我不确定。', questionText: '水囊上有几块补丁？' });
  assert.equal(adjudicate([missed])[0].classification, 'model-error');
  // No channel carried it and the reply asserted it: ungrounded, not a memory pass.
  const invented = gradeProbeItem(item, { injection: { current_state: '托林·瓦什', reference: '无关' },
    replyText: '有三块皮子。', questionText: '水囊上有几块补丁？' });
  assert.equal(adjudicate([invented])[0].classification, 'prompt-insufficient');
  assert.equal(adjudicate([invented])[0].semanticPass, false);
  // A Chinese-only needle against an all-ASCII reply is the instrument's defect, not the model's error.
  const language = { id: 'd-lang', kind: 'detail', needle: ['水囊'], question: '他背着什么？', expect: 'dropped', turn: 1 };
  const mismatch = gradeProbeItem(language, { injection: { current_state: null, reference: null },
    replyText: 'a waterskin', questionText: '他背着什么？' });
  assert.equal(mismatch.languageMismatch, true);
  assert.equal(adjudicate([mismatch])[0].classification, 'fixture-defect');
  const asciiAlt = gradeProbeItem(Object.assign({}, language, { needle: ['水囊', 'waterskin'] }),
    { injection: { current_state: null, reference: null }, replyText: 'a waterskin', questionText: '他背着什么？' });
  assert.equal(asciiAlt.languageMismatch, false);
  assert.equal(adjudicate([asciiAlt])[0].classification, 'prompt-insufficient');
  assert.equal(looksLikeLanguageMismatch(language, ''), false, 'an empty reply is not a language artifact');
  // A probe turn that never produced a reply is not an observation: fixture-defect outranks the model.
  const failed = gradeProbeItem(item, { injection: { current_state: null, reference: '三块皮子' },
    replyText: '', questionText: '水囊上有几块补丁？', probeFailed: true });
  assert.equal(failed.mechanical.fixtureDefect, true);
  assert.ok(failed.mechanical.note.includes('probe-turn-error'));
  assert.equal(adjudicate([failed])[0].classification, 'fixture-defect', 'a failed generation is never a model miss');
}

// --- 7. the four acceptance counts, over the probe items ----------------------------------------------
{
  // The baseline: the merged summary kept the person; it dropped four details; all four came back from the
  // quoted original rows; the never-written value was refused.
  const bag = continuityBag({ summary: { text: '托林·瓦什住在断桅渡；他用一种胶修补湿木头。' },
    anchors: { active: [] }, knowledge: { entries: [] } });
  const details = [
    detail('d-person', ['托林·瓦什'], '新来的那个人叫什么？', 'summary', 2),
    detail('d-patches', ['三块皮子'], '水囊上有几块补丁？', 'dropped', 3),
    detail('d-ear', ['铜环'], '他左边耳垂上有什么？', 'dropped', 4),
    detail('d-knot', ['死结'], '靴带是怎么系的？', 'dropped', 5),
    detail('d-axe', ['豁了口'], '斧头的刃口是什么状态？', 'dropped', 6),
  ];
  const retention = splitDetailsByRetention(details, bag);
  assert.equal(retention.dropped.length, 4);
  const items = buildProbeItems({ dropped: retention.dropped, positive: choosePositive(retention.retained),
    negatives: [{ id: 'n-bag', needle: ['暗红'], question: '工具袋是什么颜色？', kind: 'negative', turn: null, expect: 'unsure' }] });
  const question = buildProbeQuestion(items);
  const replyText = '1. 三块皮子。2. 一个铜环。3. 打的是死结。4. 刃口豁了口。5. 托林·瓦什。6. 我不记得工具袋的颜色。';
  const injection = { current_state: '托林·瓦什住在断桅渡；他用一种胶修补湿木头。',
    reference: '水囊上是三块皮子；耳垂上有铜环；靴带打的是死结；斧刃豁了口。' };
  const rows = adjudicate(items.map(item => gradeProbeItem(item, { injection, replyText, questionText: question.text })));
  const survival = summarizeDetailSurvival({ rows, retention, items });
  assert.equal(survival.summaryKept, 1, 'the positive control came from continuity');
  assert.equal(survival.retrievalRecovered, 4, 'all four dropped details came back from evidence and were used');
  assert.equal(survival.refused, 1, 'the never-written value was refused rather than invented');
  assert.equal(survival.fabricated, 0);
  assert.equal(survival.retrievedNotConveyed, 0);
  assert.equal(survival.fixtureDefects, 0);
  assert.equal(survival.items, 6);
  const line = formatDetailReport(survival);
  for (const label of ['摘要保留了 1 个', '检索取回 4 个', '拒绝 1 个', '编造 0 个']) assert.ok(line.includes(label), line);
  // The partition covers every item exactly once.
  assert.equal(survival.summaryKept + survival.retrievalRecovered + survival.retrievedNotConveyed
    + survival.refused + survival.fabricated, survival.items);
}

// --- 8. a fabricated negative control, and the MemProbe-A control case ---------------------------------
{
  // MemProbe-A: every declared detail leaked into the floor-10 summary, so continuity answered and retrieval
  // was never exercised; the never-written blanket colour was invented. A needle-only grader would score that
  // as a hit, which is why the channel and the adjudication are separate readings.
  const bag = continuityBag({ summary: { text: '水囊上有三块皮子；耳垂上有铜环。' }, anchors: { active: [] },
    knowledge: { entries: [] } });
  const details = [detail('d-patches', ['三块皮子'], '水囊上有几块补丁？', 'summary', 3),
    detail('d-ear', ['铜环'], '耳垂上有什么？', 'summary', 4)];
  const retention = splitDetailsByRetention(details, bag);
  assert.equal(retention.dropped.length, 0, 'nothing was dropped, so the run cannot prove retrieval');
  const items = buildProbeItems({ dropped: retention.dropped, positive: choosePositive(retention.retained),
    negatives: [{ id: 'n-blanket', needle: ['暗红褐色'], question: '毯子是什么颜色？', kind: 'negative', turn: null, expect: 'unsure' }] });
  const question = buildProbeQuestion(items);
  const injection = { current_state: '水囊上有三块皮子；耳垂上有铜环。', reference: null };
  const replyText = '水囊上三块皮子；耳垂上有个铜环；毯子是暗红褐色的。';
  const rows = adjudicate(items.map(item => gradeProbeItem(item, { injection, replyText, questionText: question.text })));
  const survival = summarizeDetailSurvival({ rows, retention, items });
  assert.equal(survival.summaryKept, 1);
  assert.equal(survival.fabricated, 1, 'the never-written value was asserted');
  assert.equal(survival.refused, 0);
  assert.equal(summarizeAdjudication(rows).ungroundedPasses, 1, 'a fabricated value on an empty evidence channel is not a memory pass');
}
{
  // A negative control whose value is actually in the prompt is a defective fixture, and is named.
  const items = [{ id: 'n-glue', kind: 'negative', needle: ['胶'], question: '用什么粘？', expect: 'unsure', turn: null }];
  const rows = adjudicate(items.map(item => gradeProbeItem(item,
    { injection: { current_state: '胶', reference: null }, replyText: '胶。', questionText: '工具袋是什么颜色？' })));
  const survival = summarizeDetailSurvival({ rows, retention: null, items });
  assert.equal(survival.negativeLeaks, 1);
  assert.equal(survival.fabricated, 1);
}

// --- 9. the evidence record keeps the block and the reply it was read from -----------------------------
{
  const retention = { total: 2, retained: [detail('p', ['托林'], 'q', 'summary', 2)],
    dropped: [detail('d', ['三块'], 'q2', 'dropped', 3)], expectationMismatches: [] };
  const items = [{ id: 'd', kind: 'detail', needle: ['三块'], question: 'q2', expect: 'dropped', turn: 3 }];
  const graded = [gradeProbeItem(items[0], { injection: { current_state: null, reference: '三块' },
    replyText: '三块', questionText: 'q2' })];
  const rows = adjudicate(graded);
  const evidence = buildDetailEvidence({ at: 'now', probeTurns: [4], phase1Last: 3, retention,
    positive: retention.retained[0], items, probes: [{ turn: 4, question: 'q2', leaks: [], replyText: '三块',
      injection: { current_state: null, reference: '三块' }, graded }], adjudicationErrors: [],
    adjudicationSummary: summarizeAdjudication(rows), survival: summarizeDetailSurvival({ rows, retention, items }) });
  assert.equal(evidence.positiveControl, 'p');
  assert.deepEqual(evidence.retention.retained, ['p']);
  assert.deepEqual(evidence.retention.dropped, ['d']);
  assert.equal(evidence.probes[0].injection.evidence, '三块');
  assert.equal(evidence.graded.length, 1);
}

// --- 10. the driver reads the block the turn saw, and the mode is reachable ----------------------------
{
  const source = fs.readFileSync('acceptance-longchat.mjs', 'utf8');
  assert.ok(source.includes('--detail-survival'), 'the mode is a documented flag');
  assert.ok(source.includes("'./detail-survival.mjs'"), 'the driver uses the versioned decision logic');
  assert.ok(source.includes('record.injections.thisTurn'), 'grading reads the block this turn saw');
  assert.ok(!source.includes('injections.before'), 'the probe phase never reads the previous turn');
  assert.ok(source.includes('question.leaks'), 'a question that contains its own answer is refused');
}

// --- 11. paraphrase tolerance: the reading follows the fact, not the author's wording ----------------
{
  // The first live run's three misreads: the channel carried each detail in different words, so a
  // verbatim-only reader called two of them fabricated and one refused.
  const bell = matchNeedle('门柱缺角哑铜铃, 铃身没晃起来——它本来就缺角', ['缺了一角']);
  assert.equal(bell.matched, true);
  assert.equal(bell.token, '缺角');
  assert.equal(matchNeedle('只有左耳是白的', ['左耳是白的']).how, 'verbatim');
  assert.equal(matchNeedle('第三夜前', ['第三天夜里']).matched, true, 'the promise survives as 第三');
  assert.equal(matchNeedle('白的那只耳朵', ['左耳是白的']).matched, false, 'one wording is not every wording');
  // A run needs two content characters that occur contiguously: a paraphrase is not a coincidence.
  assert.equal(matchNeedle('水深，草是绿的', ['深绿']).matched, false);
  assert.equal(matchNeedle('无关原文', ['深绿']).matched, false);
  assert.equal(matchNeedle('', ['缺角']).matched, false);
  assert.deepEqual(matchNeedle('x', []), { matched: false, how: null, token: null });
  // Retention uses the same reading, so a summary that paraphrases still counts as keeping the detail.
  const bag = continuityBag({ summary: { text: '门柱缺角哑铜铃；阿灰左耳白。' }, anchors: { active: [] }, knowledge: { entries: [] } });
  const split = splitDetailsByRetention([
    detail('d-bell', ['缺了一角'], '门柱上那只铜铃有什么缺损？', 'summary', 1),
    detail('d-cat', ['左耳是白的'], '阿灰的耳朵有什么特别的地方？', 'dropped', 3),
    detail('d-missing', ['三天两头'], 'q', 'dropped', 2)], bag);
  assert.deepEqual(split.retained.map(item => item.id), ['d-bell', 'd-cat']);
  assert.deepEqual(split.dropped.map(item => item.id), ['d-missing']);
  // The channel reading follows suit, and the question-leak check refuses a leading question.
  const channel = attributeChannel({ current_state: '门柱缺角哑铜铃', reference: null }, { id: 'x', needle: ['缺了一角'] });
  assert.equal(channel.channel, 'continuity');
  assert.equal(channel.continuityMatch.token, '缺角');
  // A leak is verbatim or a long content run; a shared short phrase is not.
  assert.deepEqual(buildProbeQuestion([{ id: 'd', kind: 'detail', needle: ['缺了一角'], question: '那铃缺了一角吗？' }]).leaks, ['d']);
  assert.deepEqual(buildProbeQuestion([{ id: 'k', kind: 'condition', needle: ['雾散了才开'], question: '老谈的船什么时候才开？' }]).leaks, [],
    'a two-character run is not a leak');
  assert.equal(leaksNeedle('老谈的船什么时候才开？', ['雾散了才开']), false);
  assert.equal(leaksNeedle('雾散了才开吗？', ['雾散了才开']), true);
}

// --- 12. fact survival across merges, by kind ---------------------------------------------------------
{
  assert.equal(isMustKeep('identity'), true);
  assert.equal(isMustKeep('state'), true);
  assert.equal(isMustKeep('knowledge'), true);
  assert.equal(isMustKeep('detail'), false);
  assert.equal(isMustKeep('nonsense'), false);
  assert.deepEqual(Object.keys(FACT_KINDS).sort(),
    ['condition', 'detail', 'identity', 'knowledge', 'negation', 'place', 'promise', 'state']);
  const parsedKinds = parseTurnsFile({ turns: [{ text: 't', details: [
    { id: 'a', needle: 'x', question: 'q', kind: 'identity' },
    { id: 'b', needle: 'y', question: 'q' },
    { id: 'c', needle: 'z', question: 'q', kind: 'nope' }] }] });
  assert.equal(parsedKinds.details.find(item => item.id === 'a').kind, 'identity');
  assert.equal(parsedKinds.details.find(item => item.id === 'b').kind, DEFAULT_FACT_KIND);
  assert.ok(parsedKinds.errors.some(error => error.includes('未知 kind: nope')));
  const summary = summarizeFactSurvival([
    { id: 'k-id', kind: 'identity' }, { id: 'k-state', kind: 'state' }, { id: 'd-bell', kind: 'detail' }],
    [{ batchTurn: 10, retained: ['k-id', 'k-state'] }, { batchTurn: 20, retained: ['k-id'] }]);
  assert.deepEqual(summary.batches, [10, 20]);
  const state = summary.facts.find(fact => fact.id === 'k-state');
  assert.equal(state.lostInMerge, true);
  assert.equal(state.lostAt, 20);
  const bell = summary.facts.find(fact => fact.id === 'd-bell');
  assert.equal(bell.everRetained, false, 'a fact the first merge never carried was never carried at all');
  assert.equal(bell.lostAt, 10);
  assert.deepEqual(summary.mustKeepLostInAMerge, ['k-state']);
  assert.equal(summary.mustKeepTotal, 2);
  assert.deepEqual(summary.mustKeepLostAtLastMerge, ['k-state']);
  assert.deepEqual(summary.incidentalKeptAtLastMerge, []);
  const text = formatFactSurvival(summary);
  assert.ok(text.includes('must-keep lost in a merge: 1/2'), text);
  assert.ok(text.includes('state'), text);
  // An incidental that still occupies the summary at the last merge is named as wasted room.
  const kept = summarizeFactSurvival([{ id: 'd-bell', kind: 'detail' }], [{ batchTurn: 20, retained: ['d-bell'] }]);
  assert.deepEqual(kept.incidentalKeptAtLastMerge, ['d-bell']);
  assert.ok(formatFactSurvival(kept).includes('incidental still occupying the summary: d-bell'));
}

console.log('PASS detail survival: adaptive retention, per-channel recovery, refusal and fabrication, read from the probe turn block');
