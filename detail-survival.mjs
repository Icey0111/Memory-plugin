// Detail survival: does the summary keep a detail, or does retrieval have to recover it?
//
// The product contract splits the work: the structured summary protects plot logic, retrieval recovers
// precise original detail. That split is only testable if a run says, per detail, which of the two
// actually carried it. The first such run was done by hand (PR #1): 20 turns introduced a new person, a
// new place and several small details; the summaries committed at floor 10 and floor 20; the four details
// absent from the merged summary came back from quoted original rows, while the floor-10 summary had held
// them. Hand-picking the needles and hand-reading the replies is not reproducible and cannot catch a
// question that gives its own answer away.
//
// This module is the reusable form of that baseline. It is pure: no Node imports, no model call, no file
// I/O. acceptance-longchat.mjs wires it to the live host and test-detail-survival.mjs proves it offline.
//
// The division of labour with answer-adjudication.mjs matters. This module makes only the readings that are
// facts about text that was already captured:
//   - which detail survived into the committed summary (summary prose + active anchors + knowledge);
//   - which channel the probe turn actually saw (continuity / evidence / neither) - read from
//     injections.thisTurn, the block that turn's own generation set, never the previous turn's;
//   - whether the needle occurs in the reply and whether the question leaked it.
// A needle is matched with a paraphrase-tolerant reading (a contiguous run of its content characters), so a
// summary that says "缺角" still counts for a needle written "缺了一角"; the strict substring reading stays
// where it matters, in the question-leak check. The match kind is recorded on every row.
// A needle match is a machine reading, not a conclusion. Every probe item is emitted as an
// answer-adjudication row so the classification (confirmed-pass / model-error / prompt-insufficient /
// fixture-defect ...) is derived there, and a needle-language mismatch is recorded as a fixture defect
// instead of being charged to the model - one English reply was once scored a miss by a Chinese needle.
//
// Measurement only. Nothing here changes the summary budget, the retrieval ranking or the injected block.

export const DETAIL_SURVIVAL_SCHEMA_VERSION = 1;

/** Where the needle was found in the block the probe turn actually saw. */
export const DETAIL_CHANNELS = Object.freeze(['continuity', 'evidence', 'both', 'none']);

/** What the author expected when the detail was written down. Recorded, never used to select. */
export const DETAIL_EXPECTATIONS = Object.freeze(['summary', 'dropped', 'unsure']);

/**
 * The kinds a declared fact can have, and whether losing it is a defect. This is the product contract's
 * list, not a new taxonomy: the summary is supposed to keep identity, place, still-live state, promises,
 * conditions, negations and knowledge boundaries, while an incidental detail is what retrieval exists for.
 */
export const FACT_KINDS = Object.freeze({
    identity: { mustKeep: true }, place: { mustKeep: true }, state: { mustKeep: true },
    promise: { mustKeep: true }, condition: { mustKeep: true }, negation: { mustKeep: true },
    knowledge: { mustKeep: true }, detail: { mustKeep: false },
});
export const DEFAULT_FACT_KIND = 'detail';
/** Losing this kind is a defect; losing an incidental detail is the division of labour working. */
export function isMustKeep(kind) { return Boolean(FACT_KINDS[kind] && FACT_KINDS[kind].mustKeep); }

/**
 * Case, width and whitespace folding for substring matching. NFKC turns full-width digits and letters into
 * their ASCII forms, so a needle written in one width still matches a reply in the other.
 */
export function normalizeText(value) {
    return String(value == null ? '' : value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A needle is one string or several surface forms (for example a Chinese term and its English rendering). */
export function needleForms(item) {
    const raw = item && item.needle;
    const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
    return list.map(normalizeText).filter(Boolean);
}

/** Does any surface form occur in the text verbatim? Empty text and empty needle are both false. */
export function containsAny(haystack, forms) {
    const text = normalizeText(haystack);
    if (!text) return false;
    return (forms || []).some(form => form && text.includes(form));
}

/**
 * Characters that carry no content, so a paraphrase may drop or reorder them: "缺了一角" and "缺角" are the
 * same defect, "第三天夜里" and "第三夜前" are the same promise.
 */
const NEEDLE_STOP_CHARS = new Set(['了', '的', '是', '里', '之', '着', '过', '在', '和', '与',
    '就', '都', '也', '还', '又', '把', '被', '给', '对', '从', '到', '这', '那', '一']);

/** The content characters of one surface form, in order. */
function contentChars(form) {
    return [...normalizeText(form)].filter(ch => /[\u3400-\u9fff]/.test(ch) && !NEEDLE_STOP_CHARS.has(ch));
}

/**
 * Match a needle against captured text, tolerating paraphrase.
 *
 * A verbatim-only reading binds the needle to the wording the author happened to pick, and a generated
 * summary or reply paraphrases. On the first live run three of six details were read as absent while the
 * channel carried them as "缺角" for "缺了一角", "左耳白" for "左耳是白的" and "第三夜前" for "第三天夜里".
 * That is the instrument's phrasing assumption failing, not the memory.
 *
 * The second reading accepts any contiguous run of >= 2 of the needle's content characters, longest first,
 * and reports which run matched so the reading stays auditable. Two characters is the floor: a shorter run
 * is not evidence. The question-leak check stays on the strict substring reading.
 */
export function matchNeedle(text, forms) {
    const hay = normalizeText(text);
    if (!hay) return { matched: false, how: null, token: null };
    for (const form of forms || []) {
        if (form && hay.includes(form)) return { matched: true, how: 'verbatim', token: form };
    }
    for (const form of forms || []) {
        const chars = contentChars(form);
        for (let len = Math.min(4, chars.length); len >= 2; len -= 1) {
            for (let start = 0; start + len <= chars.length; start += 1) {
                const run = chars.slice(start, start + len).join('');
                if (hay.includes(run)) return { matched: true, how: 'run' + len, token: run };
            }
        }
    }
    return { matched: false, how: null, token: null };
}

/**
 * Does a probe question give its own answer away? Stricter than matchNeedle: a question legitimately shares
 * short phrases with its answer, so only a verbatim needle or a run of at least three content characters
 * counts. A question ending "什么时候才开？" against a needle "雾散了才开" is not a leak - and charging it as
 * one aborted a paid run after phase 1 had already generated twenty turns.
 */
export function leaksNeedle(text, forms) {
    if (containsAny(text, forms)) return true;
    const hay = normalizeText(text);
    for (const form of forms || []) {
        const chars = contentChars(form);
        for (let len = Math.min(4, chars.length); len >= 3; len -= 1) {
            for (let start = 0; start + len <= chars.length; start += 1) {
                if (hay.includes(chars.slice(start, start + len).join(''))) return true;
            }
        }
    }
    return false;
}

const cleanId = value => String(value == null ? '' : value).trim();

/**
 * Read a turns file. A legacy file is the bare array of turn strings the driver has always accepted, and it
 * carries no details, so a detail-survival run refuses it with a message instead of silently probing nothing.
 * A detailed file is an object with `turns` (each `{ text, details }`) and `negativeControls`.
 *
 * Every detail declares an id, a needle and the question that will be asked about it. A negative control
 * declares an id, a needle and a question too; its needle is something the story never wrote. Problems are
 * collected, so one pass repairs the whole file. A detailed file looks like this:
 *
 *   { "cadence": 10, "phase1Turns": 20, "probeMode": "single",
 *     "turns": [
 *       { "text": "…", "details": [
 *         { "id": "d-patches", "needle": ["三块皮子", "three patches"],
 *           "question": "水囊上有几块补丁？", "expect": "dropped" } ] } ],
 *     "negativeControls": [
 *       { "id": "n-bag", "needle": ["暗红", "dark red"], "question": "工具袋是什么颜色？" } ] }
 *
 * The question names the subject and the needle is the value that proves the answer; a question that
 * contains its own needle is refused. Supply every surface form the reply might use (a Chinese term and its
 * English rendering), because a needle bound to one language cannot match a reply in another.
 */
export function parseTurnsFile(raw) {
    const errors = [];
    const out = { legacy: false, cadence: 10, phase1Turns: null, probeMode: 'single',
        turns: [], details: [], negatives: [], errors };
    if (Array.isArray(raw)) {
        out.legacy = true;
        out.turns = raw.map((text, index) => {
            if (typeof text !== 'string') errors.push('turn ' + (index + 1) + ' 不是字符串');
            return { text: typeof text === 'string' ? text : '' };
        });
        return out;
    }
    if (!raw || typeof raw !== 'object') { errors.push('turns 文件既不是数组也不是对象'); return out; }
    const cadence = Number(raw.cadence);
    if (Number.isFinite(cadence) && cadence > 0) out.cadence = cadence;
    const phase1 = Number(raw.phase1Turns);
    if (Number.isFinite(phase1) && phase1 > 0) out.phase1Turns = Math.floor(phase1);
    out.probeMode = raw.probeMode === 'perTurn' ? 'perTurn' : 'single';
    const seen = new Set();
    const readProbe = (entry, where, kind) => {
        const id = cleanId(entry && entry.id);
        const forms = needleForms(entry);
        const question = String((entry && entry.question) || '').trim();
        if (!id) errors.push(where + ' 缺少 id');
        if (!forms.length) errors.push(where + ' 缺少 needle');
        if (!question) errors.push(where + ' 缺少 question');
        if (id && seen.has(id)) errors.push(where + ' id 重复: ' + id);
        if (id) seen.add(id);
        return { id, needle: forms, question, kind, turn: null, expect: 'unsure' };
    };
    const rawTurns = Array.isArray(raw.turns) ? raw.turns : [];
    if (!rawTurns.length) errors.push('turns 文件没有 turns');
    rawTurns.forEach((turn, index) => {
        const where = 'turn ' + (index + 1);
        if (!turn || typeof turn !== 'object' || typeof turn.text !== 'string') {
            errors.push(where + ' 缺少 text');
            out.turns.push({ text: '', details: [] });
            return;
        }
        const details = [];
        const rawDetails = Array.isArray(turn.details) ? turn.details : [];
        rawDetails.forEach((detail, detailIndex) => {
            const record = readProbe(detail, where + ' detail ' + (detailIndex + 1), DEFAULT_FACT_KIND);
            record.turn = index + 1;
            record.expect = DETAIL_EXPECTATIONS.includes(detail && detail.expect) ? detail.expect : 'unsure';
            const factKind = typeof (detail && detail.kind) === 'string' && detail.kind ? detail.kind : DEFAULT_FACT_KIND;
            if (!FACT_KINDS[factKind]) errors.push(where + ' detail ' + (detailIndex + 1) + ' 未知 kind: ' + factKind);
            record.kind = factKind;
            details.push(record);
            out.details.push(record);
        });
        out.turns.push({ text: turn.text, details });
    });
    const rawNegatives = Array.isArray(raw.negativeControls) ? raw.negativeControls : [];
    rawNegatives.forEach((entry, index) => {
        out.negatives.push(readProbe(entry, 'negativeControl ' + (index + 1), 'negative'));
    });
    return out;
}

/**
 * The text the continuity channel is built from: the committed summary body, the active anchors and the
 * knowledge boundaries. Selection uses the committed store, so a detail the summary dropped is found in
 * none of the three. The injected block is read separately, at grading time.
 */
export function continuityBag(state) {
    const parts = [];
    const summary = state && state.summary;
    if (summary && typeof summary.text === 'string') parts.push(summary.text);
    const anchors = state && state.anchors && Array.isArray(state.anchors.active) ? state.anchors.active : [];
    for (const anchor of anchors) parts.push([anchor && anchor.kind, anchor && anchor.text].filter(Boolean).join(' '));
    const knowledge = state && state.knowledge && Array.isArray(state.knowledge.entries) ? state.knowledge.entries : [];
    for (const entry of knowledge) parts.push([entry && entry.kind, entry && entry.text].filter(Boolean).join(' '));
    return parts.join('\n');
}

/**
 * The adaptive step. Nothing is assumed from the author's expectation: the committed summary is read once and
 * every declared detail is classified by what it actually contains. `expectationMismatches` records where the
 * author's guess was wrong, which is calibration rather than selection.
 */
export function splitDetailsByRetention(details, bag) {
    const retained = [];
    const dropped = [];
    const expectationMismatches = [];
    for (const detail of details || []) {
        const found = matchNeedle(bag, detail.needle).matched;
        if (found) retained.push(detail); else dropped.push(detail);
        if (detail.expect === 'summary' && !found) expectationMismatches.push(detail.id);
        if (detail.expect === 'dropped' && found) expectationMismatches.push(detail.id);
    }
    return { total: (details || []).length, retained, dropped, expectationMismatches };
}

/**
 * One positive control, chosen deterministically: the earliest retained detail that has a question. A run
 * with no retained detail has no positive control, and says so rather than inventing one.
 */
export function choosePositive(retained) {
    return (retained || [])
        .filter(detail => detail && detail.question)
        .slice()
        .sort((a, b) => (a.turn || 0) - (b.turn || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

/** The probe items, in a fixed order: dropped details, then the positive control, then negative controls. */
export function buildProbeItems({ dropped = [], positive = null, negatives = [] } = {}) {
    const items = [];
    for (const detail of dropped) {
        items.push({ id: detail.id, kind: 'detail', needle: detail.needle, question: detail.question,
            expect: detail.expect, turn: detail.turn });
    }
    if (positive) {
        items.push({ id: positive.id, kind: 'positive', needle: positive.needle, question: positive.question,
            expect: positive.expect, turn: positive.turn });
    }
    for (const negative of negatives) {
        items.push({ id: negative.id, kind: 'negative', needle: negative.needle, question: negative.question,
            expect: negative.expect, turn: negative.turn });
    }
    return items;
}

/**
 * One probe turn. Every item's question is asked in the same turn, because question turns contaminate each
 * other: a later turn sees the earlier replies and the model restates what it just said. `leaks` names any
 * item whose needle the question itself contains - a question must name the subject, never the value, or the
 * probe could pass on the prompt alone.
 */
export function buildProbeQuestion(items) {
    const header = '【记忆核对】请只依据你记得的剧情回答下面每一条。记得就简短说清，不记得就直接说“不记得”，不要猜测，也不要补全。请保留编号逐条回答。';
    const lines = (items || []).map((item, index) => (index + 1) + '. ' + item.question);
    const text = [header].concat(lines).join('\n');
    // Tolerant, because a leading question that repeats a content run of the answer has leaked it even
    // when it does not repeat the whole needle.
    // A leak is verbatim or a long content run; a shared short phrase is not one (see leaksNeedle).
    const leaks = (items || []).filter(item => leaksNeedle(text, item.needle)).map(item => item.id);
    return { text, leaks };
}

/**
 * Which channel the block the probe turn saw carried the needle. `injection` is a snapshot's
 * `injections.thisTurn`: `current_state` is the continuity channel, `reference` is the quoted evidence.
 */
export function attributeChannel(injection, item) {
    const continuity = matchNeedle(injection && injection.current_state, item.needle);
    const evidence = matchNeedle(injection && injection.reference, item.needle);
    const channel = continuity.matched && evidence.matched ? 'both'
        : continuity.matched ? 'continuity' : evidence.matched ? 'evidence' : 'none';
    return { channel, continuity: continuity.matched, evidence: evidence.matched,
        continuityMatch: continuity, evidenceMatch: evidence };
}

/**
 * A Chinese-only needle against a reply with no CJK characters cannot match, and that is the instrument's
 * language assumption failing, not the model. It is recorded as a fixture defect so it is never read as a
 * model miss; the reader can add a surface form and re-run.
 */
export function looksLikeLanguageMismatch(item, replyText) {
    const reply = String(replyText || '');
    if (!reply) return false;
    const replyHasCjk = /[\u3400-\u9fff]/.test(reply);
    const asciiForms = (item.needle || []).filter(form => /[a-z]/i.test(form));
    const cjkForms = (item.needle || []).filter(form => /[\u3400-\u9fff]/.test(form));
    return cjkForms.length > 0 && asciiForms.length === 0 && !replyHasCjk;
}

/**
 * Turn one probe item into an answer-adjudication row plus the deterministic readings behind it. The machine
 * verdict is a text-level needle match and the prompt evidence is the channel: the adjudication module derives
 * the classification from those, so a fabrication with no channel is `prompt-insufficient` and an answer the
 * evidence carried but the reply missed is `model-error`.
 */
export function gradeProbeItem(item, { injection = null, replyText = '', questionText = '', probeFailed = false } = {}) {
    const { channel, continuity, evidence, continuityMatch, evidenceMatch } = attributeChannel(injection, item);
    const replyMatch = matchNeedle(replyText, item.needle);
    const needleInReply = replyMatch.matched;
    // The leak check stays strict: a question that contains the needle verbatim gives its own answer away.
    const leaked = containsAny(questionText, item.needle);
    const languageMismatch = looksLikeLanguageMismatch(item, replyText);
    // A probe turn that errored or produced no reply is not an observation at all: it is recorded as a
    // fixture defect so it is never read as the model failing to use evidence it may never have seen.
    const failed = probeFailed === true;
    const fixtureDefect = leaked || languageMismatch || failed;
    const note = [item.kind, 'channel=' + channel,
        item.expect && item.expect !== 'unsure' ? 'expect=' + item.expect : null,
        leaked ? 'question-leak' : null,
        languageMismatch ? 'needle-language-mismatch' : null,
        failed ? 'probe-turn-error' : null].filter(Boolean).join('; ');
    return {
        id: item.id, kind: item.kind, channel, continuity, evidence, needleInReply, leaked, languageMismatch,
        continuityMatch, evidenceMatch, replyMatch,
        mechanical: {
            id: item.id, machineVerdict: needleInReply ? 'hit' : 'miss',
            promptEvidence: channel === 'none' ? 'missing' : 'sufficient',
            replyConveys: needleInReply, fixtureDefect, carrier: channel, note,
        },
    };
}

/**
 * The four numbers the acceptance asks for, over the probe items, from the adjudicated rows.
 *   摘要保留 summary-kept          the continuity channel carried the needle
 *   检索取回 retrieval-recovered   only the evidence channel carried it, and the reply used it
 *   拒绝     refused               no channel carried it and the reply did not assert it
 *   编造     fabricated            the reply asserted it while no channel carried it
 * Two readings keep the partition honest rather than hiding a stage: `retrievedNotConveyed` (the evidence had
 * it and the reply did not) and `summaryKeptNotConveyed`. `negativeLeaks` names a negative control whose
 * fabricated value turned up in a captured channel, which is a defective fixture rather than a model result.
 */
export function summarizeDetailSurvival({ rows = [], retention = null, items = [] } = {}) {
    const byId = new Map((rows || []).map(row => [row.id, row]));
    let summaryKept = 0;
    let summaryKeptNotConveyed = 0;
    let retrievalRecovered = 0;
    let retrievedNotConveyed = 0;
    let refused = 0;
    let fabricated = 0;
    let negativeLeaks = 0;
    let fixtureDefects = 0;
    let bothChannels = 0;
    const outcomes = [];
    for (const item of items || []) {
        const row = byId.get(item.id) || null;
        const channel = row ? row.carrier : 'unknown';
        const conveys = row ? row.replyConveys === true : false;
        const defect = row ? row.fixtureDefect === true : false;
        if (defect) fixtureDefects += 1;
        let outcome = null;
        if (item.kind === 'negative') {
            if (channel !== 'none' && channel !== 'unknown') negativeLeaks += 1;
            outcome = conveys ? 'fabricated' : 'refused';
        } else if (channel === 'continuity' || channel === 'both') {
            if (channel === 'both') bothChannels += 1;
            outcome = 'summary-kept';
            if (!conveys) summaryKeptNotConveyed += 1;
        } else if (channel === 'evidence') {
            outcome = conveys ? 'retrieval-recovered' : 'retrieved-not-conveyed';
            if (conveys) retrievalRecovered += 1; else retrievedNotConveyed += 1;
        } else {
            outcome = conveys ? 'fabricated' : 'refused';
        }
        if (outcome === 'summary-kept') summaryKept += 1;
        if (outcome === 'refused') refused += 1;
        if (outcome === 'fabricated') fabricated += 1;
        outcomes.push({ id: item.id, kind: item.kind, channel, conveys, outcome,
            fixtureDefect: defect });
    }
    return {
        schemaVersion: DETAIL_SURVIVAL_SCHEMA_VERSION,
        items: (items || []).length,
        summaryKept, summaryKeptNotConveyed, retrievalRecovered, retrievedNotConveyed,
        refused, fabricated, negativeLeaks, fixtureDefects, bothChannels, outcomes,
        retention: retention ? {
            total: retention.total,
            retained: (retention.retained || []).map(detail => detail.id),
            dropped: (retention.dropped || []).map(detail => detail.id),
            expectationMismatches: retention.expectationMismatches || [],
        } : null,
    };
}

/**
 * Per-merge survival of the declared facts, by kind.
 *
 * `observations` are the committed-summary readings in batch order: [{ batchTurn, retained: [ids] }]. A fact
 * kept at the first merge and absent from the second was **lost in a merge** - the case the product contract
 * cares about - while a fact absent from the first merge was never carried at all.
 */
export function summarizeFactSurvival(details = [], observations = []) {
    const batches = observations.map(observation => observation.batchTurn);
    const facts = (details || []).map(detail => {
        const retainedAt = {};
        for (const observation of observations) {
            retainedAt[observation.batchTurn] = (observation.retained || []).includes(detail.id);
        }
        let lostAt = null;
        for (const turn of batches) if (retainedAt[turn] !== true) { lostAt = turn; break; }
        const everRetained = batches.some(turn => retainedAt[turn] === true);
        return { id: detail.id, kind: detail.kind || DEFAULT_FACT_KIND, retainedAt, lostAt, everRetained,
            lostInMerge: lostAt !== null && everRetained };
    });
    const kinds = {};
    for (const fact of facts) {
        const row = kinds[fact.kind] || (kinds[fact.kind] = { kind: fact.kind, mustKeep: isMustKeep(fact.kind),
            total: 0, keptAtLastMerge: 0, lostInAMerge: 0, idsLost: [] });
        row.total += 1;
        const lastTurn = batches.length ? batches[batches.length - 1] : null;
        if (lastTurn !== null && fact.retainedAt[lastTurn] === true) row.keptAtLastMerge += 1;
        if (fact.lostInMerge) { row.lostInAMerge += 1; row.idsLost.push(fact.id); }
    }
    const mustKeep = facts.filter(fact => isMustKeep(fact.kind));
    const incidental = facts.filter(fact => !isMustKeep(fact.kind));
    const lastTurn = batches.length ? batches[batches.length - 1] : null;
    return { batches, facts, kinds,
        mustKeepTotal: mustKeep.length,
        mustKeepLostInAMerge: mustKeep.filter(fact => fact.lostInMerge).map(fact => fact.id),
        mustKeepLostAtLastMerge: lastTurn === null ? []
            : mustKeep.filter(fact => fact.retainedAt[lastTurn] !== true).map(fact => fact.id),
        incidentalKeptAtLastMerge: lastTurn === null ? []
            : incidental.filter(fact => fact.retainedAt[lastTurn] === true).map(fact => fact.id) };
}

/** The fact-survival block: one line per kind, then the must-keep losses named. */
export function formatFactSurvival(summary) {
    const lines = ['FACT-SURVIVAL across ' + summary.batches.length + ' merge(s) at [' + summary.batches.join(', ') + ']'];
    for (const row of Object.values(summary.kinds).sort((a, b) => a.kind.localeCompare(b.kind))) {
        lines.push('  ' + String(row.kind).padEnd(10) + (row.mustKeep ? 'must-keep ' : 'incidental')
            + ' ' + row.keptAtLastMerge + '/' + row.total + ' kept at the last merge'
            + (row.idsLost.length ? ' | lost in a merge: ' + row.idsLost.join(', ') : ''));
    }
    lines.push('  must-keep lost in a merge: ' + summary.mustKeepLostInAMerge.length + '/' + summary.mustKeepTotal
        + (summary.mustKeepLostInAMerge.length ? ' (' + summary.mustKeepLostInAMerge.join(', ') + ')' : ''));
    lines.push('  must-keep absent at the last merge: ' + summary.mustKeepLostAtLastMerge.length
        + (summary.mustKeepLostAtLastMerge.length ? ' (' + summary.mustKeepLostAtLastMerge.join(', ') + ')' : ''));
    if (summary.incidentalKeptAtLastMerge.length) {
        lines.push('  incidental still occupying the summary: ' + summary.incidentalKeptAtLastMerge.join(', '));
    }
    return lines.join('\n');
}

/** The acceptance line: the four counts the mode exists to print, with the extra readings appended. */
export function formatDetailReport(survival) {
    const extra = [];
    if (survival.retrievedNotConveyed) extra.push('检索到但未答 ' + survival.retrievedNotConveyed + ' 个');
    if (survival.summaryKeptNotConveyed) extra.push('摘要留下但未答 ' + survival.summaryKeptNotConveyed + ' 个');
    if (survival.negativeLeaks) extra.push('负控命中通道 ' + survival.negativeLeaks + ' 个');
    return 'DETAIL-SURVIVAL: 摘要保留了 ' + survival.summaryKept + ' 个 / 检索取回 ' + survival.retrievalRecovered
        + ' 个 / 拒绝 ' + survival.refused + ' 个 / 编造 ' + survival.fabricated + ' 个'
        + (extra.length ? '（' + extra.join('，') + '）' : '')
        + ' [问题 ' + survival.items + ' 条，fixture-defect ' + survival.fixtureDefects + ']';
}

/** The run record written outside the repository, with the block and reply it was read from. */
export function buildDetailEvidence({ at, probeTurns = [], phase1Last = null, retention = null, positive = null,
    items = [], probes = [], adjudicationErrors = [], adjudicationSummary = null, survival = null } = {}) {
    return {
        schemaVersion: DETAIL_SURVIVAL_SCHEMA_VERSION,
        at, phase1Last,
        probeTurns,
        positiveControl: positive ? positive.id : null,
        retention: retention ? {
            total: retention.total,
            retained: (retention.retained || []).map(detail => detail.id),
            dropped: (retention.dropped || []).map(detail => detail.id),
            expectationMismatches: retention.expectationMismatches || [],
        } : null,
        items: (items || []).map(item => ({ id: item.id, kind: item.kind, needle: item.needle,
            question: item.question, expect: item.expect, turn: item.turn })),
        probes: (probes || []).map(probe => ({ turn: probe.turn, question: probe.question,
            leaks: probe.leaks || [], replyText: probe.replyText || '', error: probe.error || null,
            injection: probe.injection ? { continuity: probe.injection.current_state || null,
                evidence: probe.injection.reference || null } : null })),
        graded: (probes || []).flatMap(probe => probe.graded || []),
        adjudicationErrors,
        adjudicationSummary,
        survival,
    };
}
