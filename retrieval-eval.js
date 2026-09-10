// Aetheria Unified Memory v5.5 — provider-neutral retrieval evaluation helpers.
// Pure module: metrics operate on ranked ids and labelled similarity samples only.

function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function clamp01(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function scoreRankedCase({ expected = [], ranked = [], k = 10 } = {}) {
    const gold = new Set(unique(expected));
    const rows = unique(ranked).slice(0, Math.max(1, Number(k) || 10));
    if (!gold.size) {
        return { recall: 1, precision: rows.length ? 0 : 1, reciprocal_rank: 0, hit: false, hits: [] };
    }
    const hits = rows.filter(id => gold.has(id));
    let firstRank = 0;
    for (let i = 0; i < rows.length; i++) {
        if (gold.has(rows[i])) { firstRank = i + 1; break; }
    }
    return {
        recall: hits.length / gold.size,
        precision: rows.length ? hits.length / rows.length : 0,
        reciprocal_rank: firstRank ? 1 / firstRank : 0,
        hit: hits.length > 0,
        hits,
    };
}

export function evaluateRankedCases(casesInput, { k = 10 } = {}) {
    const cases = Array.isArray(casesInput) ? casesInput : [];
    if (!cases.length) return { cases: 0, recall_at_k: 0, precision_at_k: 0, mrr: 0, hit_rate: 0 };
    const scores = cases.map(row => scoreRankedCase({ expected: row.expected, ranked: row.ranked, k }));
    const mean = key => scores.reduce((sum, row) => sum + Number(row[key] || 0), 0) / scores.length;
    return {
        cases: scores.length,
        k: Math.max(1, Number(k) || 10),
        recall_at_k: mean('recall'),
        precision_at_k: mean('precision'),
        mrr: mean('reciprocal_rank'),
        hit_rate: scores.filter(row => row.hit).length / scores.length,
        per_case: scores,
    };
}

function confusion(samples, threshold) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const sample of samples) {
        const positive = sample.label === true || sample.label === 1 || sample.label === 'positive';
        const predicted = Number(sample.score) >= threshold;
        if (positive && predicted) tp++;
        else if (positive) fn++;
        else if (predicted) fp++;
        else tn++;
    }
    return { tp, fp, tn, fn };
}

function statsFromConfusion(c) {
    const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 1;
    const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 1;
    const specificity = c.tn + c.fp ? c.tn / (c.tn + c.fp) : 1;
    const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    return { precision, recall, specificity, f1 };
}

export function calibrateSimilarityThreshold(samplesInput, { minRecall = 0.98 } = {}) {
    const samples = (Array.isArray(samplesInput) ? samplesInput : [])
        .map(row => ({ score: Number(row?.score), label: row?.label }))
        .filter(row => Number.isFinite(row.score));
    if (!samples.length) return { threshold: null, reason: 'no-samples', evaluated: [] };

    const floors = unique(samples.map(row => String(clamp01(row.score)))).map(Number).sort((a, b) => a - b);
    const candidates = unique(['0', ...floors.map(String), '1']).map(Number).sort((a, b) => a - b);
    const requiredRecall = clamp01(minRecall);
    const evaluated = candidates.map(threshold => {
        const counts = confusion(samples, threshold);
        return { threshold, ...counts, ...statsFromConfusion(counts) };
    });
    const eligible = evaluated.filter(row => row.recall >= requiredRecall);
    const pool = eligible.length ? eligible : evaluated;
    pool.sort((a, b) => b.precision - a.precision || b.f1 - a.f1 || b.threshold - a.threshold);
    const best = pool[0];
    return {
        threshold: best.threshold,
        min_recall: requiredRecall,
        met_min_recall: best.recall >= requiredRecall,
        precision: best.precision,
        recall: best.recall,
        specificity: best.specificity,
        f1: best.f1,
        confusion: { tp: best.tp, fp: best.fp, tn: best.tn, fn: best.fn },
        sample_count: samples.length,
        evaluated,
    };
}

export function compareRetrievalRuns(baselineInput, candidateInput) {
    const baseline = baselineInput || {};
    const candidate = candidateInput || {};
    const keys = ['recall_at_k', 'precision_at_k', 'mrr', 'hit_rate'];
    const delta = {};
    for (const key of keys) delta[key] = Number(candidate[key] || 0) - Number(baseline[key] || 0);
    return {
        baseline: Object.fromEntries(keys.map(key => [key, Number(baseline[key] || 0)])),
        candidate: Object.fromEntries(keys.map(key => [key, Number(candidate[key] || 0)])),
        delta,
    };
}
