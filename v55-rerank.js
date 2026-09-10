// Aetheria Unified Memory v5.5 — local candidate reranker.
//
// Fusion scores channels; it never reads the query against the candidate. This stage does, using the
// signals the calibrated tokenizer can supply without a model call:
//
//   coverage  - how much of the query's vocabulary the memory actually contains
//   phrase    - two query words adjacent in the memory, which n-gram scoring cannot express
//   slot      - query vocabulary occurring in the structured slot path
//   entity    - a named entity the fusion stage already decided to protect
//   recency   - exponential decay over turns since the memory was recorded
//   importance- the extractor's own importance label
//   breadth   - how many independent channels agreed
//
// Two decisions make it actually able to reorder a fused list:
//
// 1. Every feature is min-max normalised *across the candidate set* and then centred on 0.5. A
//    feature that is the same for every candidate therefore contributes nothing instead of quietly
//    diluting the ones that discriminate — with raw values, a constant recency term was worth more
//    than a 2x coverage difference.
// 2. The fusion score enters as a within-set min-max too, because an RRF sum has no absolute scale.
//
// It stays deliberately linear and dependency-free: a cross-encoder would be better but needs a
// model, and the retrieval stack must not require one to be available.

import { buildRetrievalText } from './memory-core.js';
import { phraseHits, segmentWords, wordCoverage } from './v55-tokenizer.js';

export const RERANK_VERSION = '5.5-rr2';

const IMPORTANCE = Object.freeze({ high: 1, medium: 0.6, low: 0.3 });

// Feature weights. The first four read the query against the candidate and carry the decision; the
// last three are tie-breakers that only matter when the query match is close.
const WEIGHTS = Object.freeze({
    coverage: 0.30,
    phrase: 0.18,
    slot: 0.12,
    entity: 0.12,
    recency: 0.12,
    importance: 0.08,
    breadth: 0.08,
});

export const DEFAULT_RERANK_WEIGHT = 0.55;

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : (n > 1 ? 1 : n);
}

function minMax(values) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
    }
    // A feature with no spread carries no information; 0.5 centres it so it contributes nothing.
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) return () => 0.5;
    return value => clamp01((Number(value) - min) / (max - min));
}

/**
 * Reorder fused candidates. `rows` are fusion records shaped { memory, score, channels, entityBypass }.
 * Returns the reordered rows with `rerank_score` / `rerank_features` attached and a debug record.
 */
export function rerankCandidates(rowsInput, query, {
    weight = DEFAULT_RERANK_WEIGHT,
    currentMessage = 0,
    chatLength = 0,
    halfLifeTurns = 120,
    maxPool = 60,
} = {}) {
    const rows = Array.isArray(rowsInput) ? rowsInput : [];
    const debug = { version: RERANK_VERSION, considered: rows.length, query_words: 0, weight, top: [] };
    if (rows.length < 2) return { rows, debug };
    const queryWords = segmentWords(String(query ?? ''));
    debug.query_words = queryWords.length;
    if (!queryWords.length) return { rows, debug };

    const now = Number.isFinite(currentMessage) && currentMessage > 0 ? currentMessage : Math.max(1, Number(chatLength) || 1);
    const lambda = Math.log(2) / Math.max(1, Number(halfLifeTurns) || 120);
    const phraseDenominator = Math.max(1, queryWords.length - 1);

    const drafts = rows.map((row, index) => {
        const memory = row?.memory || row;
        const text = buildRetrievalText(memory);
        const coverage = wordCoverage(queryWords, segmentWords(text));
        const phraseScore = queryWords.length > 1 ? clamp01(phraseHits(queryWords, text) / phraseDenominator) : 0;
        const slotWords = segmentWords(String(memory?.slot ?? ''));
        const slotScore = slotWords.length ? wordCoverage(queryWords, slotWords) : 0;
        const recorded = Number(memory?.source_message ?? memory?.recorded_at ?? now);
        const age = Math.max(0, now - (Number.isFinite(recorded) ? recorded : now));
        const recency = Number.isFinite(recorded) ? Math.exp(-lambda * age) : 0.5;
        const importance = IMPORTANCE[String(memory?.importance || 'medium')] ?? IMPORTANCE.medium;
        const channels = Array.isArray(row?.channels) ? row.channels.length : 0;
        const breadth = clamp01(channels / 3);
        const entity = row?.entityBypass ? 1 : 0;
        return { row, index, memory, coverage, phrase: phraseScore, slot: slotScore, entity, recency, importance, breadth, channels, fusion: Number(row?.score) || 0 };
    });

    const norm = {
        coverage: minMax(drafts.map(d => d.coverage)),
        phrase: minMax(drafts.map(d => d.phrase)),
        slot: minMax(drafts.map(d => d.slot)),
        entity: minMax(drafts.map(d => d.entity)),
        recency: minMax(drafts.map(d => d.recency)),
        importance: minMax(drafts.map(d => d.importance)),
        breadth: minMax(drafts.map(d => d.breadth)),
    };
    const baseNorm = minMax(drafts.map(d => d.fusion));

    const scored = drafts.map(draft => {
        let local = 0.5;
        const features = {};
        for (const name of Object.keys(WEIGHTS)) {
            const value = clamp01(norm[name](draft[name]));
            features[name] = Number(value.toFixed(3));
            // Centre on 0.5 so a feature with no spread contributes exactly nothing.
            local += WEIGHTS[name] * (value - 0.5) * 2;
        }
        local = clamp01(local);
        const base = clamp01(baseNorm(draft.fusion));
        const w = clamp01(Number(weight));
        const combined = clamp01((1 - w) * base + w * local) + (draft.entity ? 0.05 : 0);
        features.channels = draft.channels;
        features.entity_bypass = Boolean(draft.entity);
        features.fusion = Number(draft.fusion.toFixed(4));
        features.local = Number(local.toFixed(3));
        return { row: draft.row, combined, features, local, base };
    });

    // Stable: equal combined scores keep the fusion order.
    scored.sort((a, b) => (b.combined - a.combined) || 0);
    const pool = Math.max(1, Number(maxPool) || 60);
    const kept = scored.slice(0, pool).map(entry => ({
        ...entry.row,
        rerank_score: Number(entry.combined.toFixed(6)),
        rerank_features: entry.features,
    }));
    debug.pool = kept.length;
    debug.top = kept.slice(0, 5).map(entry => ({ id: entry.memory?.id || entry.id || null, rerank: entry.rerank_score, features: entry.rerank_features }));
    return { rows: kept, debug };
}
