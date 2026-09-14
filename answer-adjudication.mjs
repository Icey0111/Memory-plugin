// Machine verdicts are not conclusions. This module holds the record that turns a graded answer into a
// conclusion about which stage to fix, because a negative can mean several different things and only one of
// them is the model's fault.
//
// The method is LittleWhiteBox's gold-eval one (scripts/gold-eval/lib/adjudication.mjs): a verdict is
// adjudicated against the prompt that was actually assembled, and a machine miss is classified as
// prompt-insufficient / scorer-false-negative / model-error / fixture-defect. Three of this project's own
// measurements were mis-read before that habit existed - a regex called a correct answer a miss, a closed
// evidence channel produced a miss that was charged to the model, and an answer that was right with no
// evidence in the prompt at all was counted as a memory success.
//
// Two things are ours. That method is written for machine *negatives* only, so a legitimate pass and a
// machine false *positive* have no name in it; applying it to a full matrix produced "scorer-false-negative"
// for rows the grader had called a hit. It also carries one field, `semanticPass`, for two questions - "the
// reply says the right thing" and "the memory delivered it" - and its invariant refuses a pass whose prompt
// evidence was missing, so the case this project cares about most, a correct answer with nothing in the
// prompt, cannot be written down. Here `replyConveys` is the text-level fact, `semanticPass` is derived from
// it plus the evidence, and both directions of grader error have a name.

export const ADJUDICATION_SCHEMA_VERSION = 1;

/** What fixing this row means. Derived, never hand-written. */
export const ADJUDICATION_CLASSIFICATIONS = Object.freeze([
    'fixture-defect',         // the probe is broken (needle not unique, visible-window or card leak)
    'prompt-insufficient',    // the prompt did not carry the fact: nothing about the model can be concluded
    'model-error',            // the prompt carried it, the grader called it a miss, and the reply missed it
    'scorer-false-negative',  // the prompt carried it and the reply used it: the miss was the grader's
    'confirmed-pass',         // the prompt carried it, the grader called it a hit, and the reply used it
    'scorer-false-positive',  // the grader called it a hit but the reply does not convey it
]);

export const PROMPT_EVIDENCE_ASSESSMENTS = Object.freeze(['sufficient', 'missing', 'distorted']);
export const MACHINE_VERDICTS = Object.freeze(['hit', 'miss']);

/**
 * The stage the row points at. `fixtureDefect` outranks everything: a broken probe says nothing about any
 * stage. Otherwise insufficient evidence is the prompt's problem before it can be anyone else's, and only
 * then does the machine verdict mean what it says.
 */
export function classifyAnswer({ machineVerdict, promptEvidence, replyConveys, fixtureDefect }) {
    if (fixtureDefect) return 'fixture-defect';
    if (promptEvidence !== 'sufficient') return 'prompt-insufficient';
    if (machineVerdict === 'miss') return replyConveys ? 'scorer-false-negative' : 'model-error';
    return replyConveys ? 'confirmed-pass' : 'scorer-false-positive';
}

/** A pass is a claim about memory, so it needs evidence in the prompt and a reply that conveys the fact. */
export function derivesSemanticPass({ promptEvidence, replyConveys, fixtureDefect }) {
    return Boolean(replyConveys) && promptEvidence === 'sufficient' && !fixtureDefect;
}

const clean = value => String(value ?? '').trim();
const asBool = value => value === true;

/**
 * Parse one adjudication JSONL. Every problem is collected rather than thrown, so a batch can be repaired in
 * one pass instead of one error at a time.
 */
export function parseAdjudicationJsonl(text) {
    const rows = [];
    const errors = [];
    const seen = new Set();
    String(text || '').split(/\r?\n/).forEach((line, index) => {
        const raw = line.trim();
        if (!raw) return;
        const where = '第 ' + (index + 1) + ' 行';
        let input = null;
        try { input = JSON.parse(raw); } catch { errors.push(where + ' 不是 JSON'); return; }
        const id = clean(input?.id);
        const machineVerdict = clean(input?.machineVerdict);
        const promptEvidence = clean(input?.promptEvidence);
        const fixtureDefect = asBool(input?.fixtureDefect);
        const replyConveys = asBool(input?.replyConveys);
        if (!id) errors.push(where + ' 缺少 id');
        else if (seen.has(id)) errors.push(where + ' id 重复: ' + id);
        else seen.add(id);
        if (!MACHINE_VERDICTS.includes(machineVerdict)) errors.push(where + ' machineVerdict 无效: ' + machineVerdict);
        if (!PROMPT_EVIDENCE_ASSESSMENTS.includes(promptEvidence)) {
            errors.push(where + ' promptEvidence 无效: ' + promptEvidence);
        }
        // semanticPass is not an input. It is exactly "the reply conveys it and the prompt carried it", so
        // writing it by hand could only produce a row that disagrees with its own evidence.
        const semanticPass = derivesSemanticPass({ promptEvidence, replyConveys, fixtureDefect });
        rows.push({ schemaVersion: ADJUDICATION_SCHEMA_VERSION, id, machineVerdict, promptEvidence,
            fixtureDefect, replyConveys, semanticPass, carrier: clean(input?.carrier) || null,
            note: clean(input?.note) || null,
            classification: classifyAnswer({ machineVerdict, promptEvidence, replyConveys, fixtureDefect }) });
    });
    return { rows, errors };
}

/**
 * The distribution a batch is read for.
 *
 * `machineNegativePrecision` is the headline: of the rows the grader called a miss, how many survive
 * adjudication as a real miss. `ungroundedPasses` is the other one, and it is not a failure - it is a reply
 * that conveys the fact while the prompt did not carry it, so it cannot be counted as a memory success.
 */
export function summarizeAdjudication(rows = []) {
    const byClassification = {};
    const byEvidence = {};
    for (const row of rows) {
        byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
        byEvidence[row.promptEvidence] = (byEvidence[row.promptEvidence] || 0) + 1;
    }
    const misses = rows.filter(row => row.machineVerdict === 'miss');
    const hits = rows.filter(row => row.machineVerdict === 'hit');
    const realMisses = misses.filter(row => row.classification === 'model-error');
    const falseNegatives = misses.filter(row => row.classification === 'scorer-false-negative');
    // A fixture defect is void rather than ungrounded: the probe could not have attributed the answer anyway.
    const ungroundedPasses = rows.filter(row => row.replyConveys && row.promptEvidence !== 'sufficient'
        && !row.fixtureDefect);
    // A disagreement is not an error: the carrier resolution reads only the ledger blocks and the packed
    // evidence, while the summary prose can carry a fact no block holds. It is listed so the two readings are
    // reconciled by hand instead of one silently overriding the other.
    const disagreements = rows.filter(row => row.carrier
        && ((row.promptEvidence === 'sufficient' && row.carrier === 'none')
            || (row.promptEvidence === 'missing' && row.carrier !== 'none')));
    return { rows: rows.length, byClassification, byEvidence,
        machineMisses: misses.length, realMisses: realMisses.length,
        machineNegativePrecision: misses.length ? realMisses.length / misses.length : null,
        scorerFalseNegatives: falseNegatives.length,
        machineHits: hits.length,
        scorerFalsePositives: hits.filter(row => row.classification === 'scorer-false-positive').length,
        // Not "passes": a row can be attributed to memory and still have been called a miss by the grader.
        memoryAttributed: rows.filter(row => row.semanticPass).length,
        ungroundedPasses: ungroundedPasses.length,
        ungroundedIds: ungroundedPasses.map(row => row.id),
        disagreements: disagreements.map(row => ({ id: row.id, promptEvidence: row.promptEvidence, carrier: row.carrier })) };
}
