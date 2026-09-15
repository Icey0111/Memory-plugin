// The natural track: measure retrieval with the query the product actually builds.
//
// Two of this project's measurements ask their own questions. The synthetic probe cuts a needle out of an
// answer and asks the sentence back ("这件事你记得吗"); the source-first labelled set writes a question
// against a literal chosen from the original. Both are useful for a mechanism, and neither is product
// evidence: a user does not type the probe. LittleWhiteBox's gold-eval contract names this directly - a
// question passed in as the query is exactly the kind it forbids from deciding a shipping policy.
//
// This module adds the third track. It replays a real chat turn by turn, folds synthetic batches at the
// configured cadence the way the runtime does, and builds the query with planRetrievalQuery from the real
// user message - the same function and the same default strategy a generation uses. Nothing here is
// hand-written, and the targets the recall metrics count (the rare situation terms, the asked thing, a
// named character's description) are derived from the prefix's own history rather than from a needle an
// author picked.
//
// What it still is not: no summary is fed to an earlier turn, so this measures lexical, situation and
// profile recall, not narrative continuity; and a target derived from the system's own tokenizer is a
// proxy, not an answer label. It is the only track that can say what the product does with real input.

import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence, entityRecall, askedThingRecall,
    profileRecall } from './raw-history.js';
import { planRetrievalQuery, isContinuation } from './retrieval-query.js';

/** The three measurement tracks, named so that every number can be attributed to one of them. */
export const MEASUREMENT_TRACKS = Object.freeze([
    { id: 'synthetic-probe', name: 'synthetic probe', query: 'cut from the answer',
      truth: 'the answer substring', evidence: 'mechanism and budget pressure' },
    { id: 'source-first-labelled', name: 'source-first labelled', query: 'an authored question',
      truth: 'a literal chosen from the original before the run', evidence: 'answer-in-context' },
    { id: 'natural-capture', name: 'natural capture', query: 'the real user message through planRetrievalQuery',
      truth: 'terms derived from the prefix history', evidence: 'the only product evidence' },
]);

export const NATURAL_TRACK = 'natural-capture';
export const NATURAL_CADENCE = 10;

/**
 * The turn plans: one per real user message once the chat has at least `cadence` completed turns, with every
 * `cadence`-th completed turn folded and the newest complete pair left visible, which is the replay
 * condition the runtime produces. A plan carries the history and chunks it was built from so the caller
 * scores it with the shipped ranker and packer instead of a second implementation.
 */
export function planNaturalTurns(messages, { cadence = NATURAL_CADENCE, strategy = 'focused', maxTurns = 0 } = {}) {
    const rows = (messages || [])
        .filter(row => row && typeof row.mes === 'string' && row.mes.trim())
        .map(row => Object.assign({}, row, { is_system: false }));
    const store = {};
    const prefix = [];
    let complete = 0;
    const plans = [];
    for (const row of rows) {
        prefix.push(row);
        if (row.is_user !== true) {
            if (prefix[prefix.length - 2] && prefix[prefix.length - 2].is_user === true) complete += 1;
            continue;
        }
        if (complete < cadence) continue;
        const history = captureHistory(store, prefix).history;
        const chunks = chunkHistory(history);
        const boundary = Math.floor(complete / cadence) * cadence;
        let turns = 0;
        let cut = -1;
        for (let index = 0; index < prefix.length - 1; index += 1) {
            const endsTurn = prefix[index].is_user !== true && prefix[index - 1] && prefix[index - 1].is_user === true;
            if (endsTurn && (turns += 1) === boundary) { cut = index; break; }
        }
        // min(cut, len - 4) keeps the newest complete pair visible exactly as retrieval-audit.mjs does, so
        // the two prefix replays stay comparable.
        const visible = new Set(history.active.filter(id => history.records[id].index > Math.min(cut, prefix.length - 4)));
        const names = [...new Set(prefix.map(item => item.name).filter(Boolean))];
        const plan = planRetrievalQuery(history, { strategy, names });
        plans.push({ turn: complete, boundary, cut, visible, names, history, chunks, plan });
        if (maxTurns && plans.length >= maxTurns) break;
    }
    return plans;
}

/**
 * Score one planned turn with the shipped ranking and packing, and count the recall proxies on the evidence
 * that was actually packed. `dense` is the replayed vector list the ruler resolved from its cassette; an
 * empty list is a lexical turn only when the run declared no dense channel.
 */
export function scoreNaturalTurn(plan, { scorer = 'bm25', denseWeight = 0, packPolicy = 'greedy',
    dense = [], evidenceTokens = 1000, entries = null, spanCost = false, trackedNames } = {}) {
    const query = plan.plan.query;
    const ranked = rankRawChunks(plan.chunks, query, dense, { scorer, denseWeight,
        visibleSources: plan.visible, names: plan.plan.profileNames, trackedNames });
    const packed = packRawEvidence(ranked, plan.history, { maxTokens: evidenceTokens, maxEntries: entries,
        visibleSources: plan.visible, policy: packPolicy, query, spanCost });
    const entities = entityRecall(plan.chunks, plan.history, { query, visibleSources: plan.visible,
        packed: packed.sources });
    const asked = plan.plan.metricsApplicable
        ? askedThingRecall(plan.chunks, plan.history, { asked: plan.plan.asked, visibleSources: plan.visible,
            packed: packed.sources })
        : [];
    const profiles = profileRecall(plan.chunks, plan.history, { names: plan.plan.profileNames,
        visibleSources: plan.visible, packed: packed.sources });
    // A pure continuation command is archived but never quoted (raw-history.js), so this stays 0; it is
    // reported so a regression that lets one into a slot is visible rather than assumed absent.
    const directiveSlots = packed.sources.filter(span => {
        const row = plan.history.records[span.source];
        return row && row.role === 'user' && isContinuation(row.text);
    }).length;
    return { turn: plan.turn, boundary: plan.boundary, mode: plan.plan.mode, strategy: plan.plan.strategy,
        query, queryChars: query.length, askedApplicable: plan.plan.metricsApplicable,
        // The packer may not quote text the transcript still shows (N7). A non-zero count here is a bug,
        // not a result, so it is carried on every turn instead of being assumed away.
        visibleQuoted: packed.sources.filter(span => plan.visible.has(span.source)).length,
        entities: { recalled: entities.filter(row => row.recalled).length, total: entities.length },
        asked: { recalled: asked.filter(row => row.recalled).length, total: asked.length },
        profiles: { detailed: profiles.filter(row => row.detailed).length, total: profiles.length },
        tokens: packed.tokens, slots: packed.sources.length, directiveSlots };
}

/** The per-track aggregate. Request and continuation are kept apart because they plan different queries. */
export function summarizeNaturalTrack(turns = []) {
    const totals = rows => ({
        turns: rows.length,
        entitiesRecalled: rows.reduce((n, row) => n + row.entities.recalled, 0),
        entitiesTotal: rows.reduce((n, row) => n + row.entities.total, 0),
        askedRecalled: rows.reduce((n, row) => n + row.asked.recalled, 0),
        askedTotal: rows.reduce((n, row) => n + row.asked.total, 0),
        profilesDetailed: rows.reduce((n, row) => n + row.profiles.detailed, 0),
        profilesTotal: rows.reduce((n, row) => n + row.profiles.total, 0),
        meanTokens: rows.length ? Math.round(rows.reduce((n, row) => n + row.tokens, 0) / rows.length) : null,
        meanSlots: rows.length ? Math.round(rows.reduce((n, row) => n + row.slots, 0) / rows.length * 10) / 10 : null,
        directiveSlots: rows.reduce((n, row) => n + row.directiveSlots, 0),
    });
    const mode = name => totals(turns.filter(row => row.mode === name));
    return { track: NATURAL_TRACK, turns: turns.length, all: totals(turns), request: mode('request'),
        continuation: mode('continuation') };
}

/** The natural-track line, always prefixed with the track so it cannot be read as a probe number. */
export function formatNaturalTrack(summary) {
    const rate = (hit, total) => total ? Math.round(hit / total * 100) + '%' : 'n/a';
    const all = summary.all;
    return 'natural capture: ' + summary.turns + ' real turns (request ' + summary.request.turns
        + ', continuation ' + summary.continuation.turns + ')'
        + ' | situation-term recall ' + rate(all.entitiesRecalled, all.entitiesTotal)
        + ' (' + all.entitiesRecalled + '/' + all.entitiesTotal + ')'
        + ' | asked-thing ' + rate(all.askedRecalled, all.askedTotal)
        + ' | profile ' + rate(all.profilesDetailed, all.profilesTotal)
        + ' | evidence ' + (all.meanTokens == null ? 'n/a' : all.meanTokens) + ' tokens/query'
        + ' | directive slots ' + all.directiveSlots;
}

/** The vectors a natural run needs: every real query and the union of the per-turn chunks. */
export function naturalDeclaredInputs(plans = []) {
    const questions = [];
    const seen = new Set();
    const chunks = new Map();
    for (const plan of plans) {
        const query = plan.plan.query;
        if (query && !seen.has(query)) { seen.add(query); questions.push(query); }
        for (const chunk of plan.chunks) chunks.set(String(chunk.hash), chunk);
    }
    return { chunks: [...chunks.values()], questions };
}
