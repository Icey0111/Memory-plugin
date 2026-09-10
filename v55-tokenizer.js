// Aetheria Unified Memory v5.5 — tokenizer and token accounting.
//
// Two jobs, both previously done badly:
//
// 1. Word segmentation. The lexical channel used fixed CJK 2-/3-grams, which over-matches (every
//    overlapping pair of characters is a term) and cannot express a multi-character word as a unit.
//    Intl.Segmenter ships with the host's own ICU data, so real word segmentation costs no dependency
//    and no download. N-grams stay as the recall floor; words are added as the precision layer.
//
// 2. Token accounting. v55-metrics used chars / 4 and the context assembler used chars / 2 — two
//    different estimates in one codebase, and the first under-reported a Chinese prompt by ~46%.
//    The model below is least-squares fitted to 126 retained provider requests and their reported
//    prompt_tokens:
//
//        tokens = 0.9408 * cjkChars + 0.2441 * otherChars   (-21 constant for the whole request)
//        R2 = 0.9989, MAPE = 1.1%
//
//    i.e. one Chinese character is worth about one token and one Latin character about a quarter.
//    The constant absorbs fixed request boilerplate and is deliberately NOT applied per fragment.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const LATIN_WORD = /[A-Za-z0-9_]+/g;

// Fitted coefficients. Keep them in one place so the calibration can be redone in one edit.
export const TOKEN_MODEL = Object.freeze({
    version: 'fit-126-v1',
    cjkPerChar: 0.9408,
    otherPerChar: 0.2441,
    requestOverhead: 21,
    // A whole request averages ~2.2 chars/token; a fragment is estimated from its own script mix.
    fallbackCharsPerToken: 2.2,
});

const segmenterCache = new Map();

function segmenterFor(locale) {
    const key = String(locale || 'zh');
    if (segmenterCache.has(key)) return segmenterCache.get(key);
    let segmenter = null;
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
            segmenter = new Intl.Segmenter(key, { granularity: 'word' });
        }
    } catch { segmenter = null; }
    segmenterCache.set(key, segmenter);
    return segmenter;
}

export function hasWordSegmenter(locale = 'zh') {
    return Boolean(segmenterFor(locale));
}

function countCjk(value) {
    let cjk = 0;
    let other = 0;
    for (const ch of String(value ?? '')) {
        if (CJK.test(ch)) cjk += 1; else other += 1;
    }
    return { cjk, other };
}

/**
 * Estimated tokens for one fragment. No request overhead: this is used to compare and to budget
 * fragments, and adding a constant to a fragment would make short fragments absurd.
 */
export function estimateTokens(value) {
    const text = String(value ?? '');
    if (!text) return 0;
    const { cjk, other } = countCjk(text);
    const tokens = cjk * TOKEN_MODEL.cjkPerChar + other * TOKEN_MODEL.otherPerChar;
    return Math.max(1, Math.ceil(tokens));
}

/** Measured chars per token for this exact text, for diagnostics and for inverse budgeting. */
export function charsPerToken(value) {
    const text = String(value ?? '');
    if (!text) return TOKEN_MODEL.fallbackCharsPerToken;
    const tokens = estimateTokens(text);
    return tokens > 0 ? text.length / tokens : TOKEN_MODEL.fallbackCharsPerToken;
}

/**
 * How many characters of text shaped like `sample` fit in `tokens`. Falls back to the whole-request
 * average when there is no sample, and never returns less than the token count itself (one token can
 * never buy more than one CJK character).
 */
export function tokensToChars(tokens, sample = '') {
    const budget = Math.max(0, Number(tokens) || 0);
    if (!budget) return 0;
    const ratio = sample ? charsPerToken(sample) : TOKEN_MODEL.fallbackCharsPerToken;
    return Math.max(1, Math.floor(budget * Math.max(1, ratio)));
}

/**
 * Real word segmentation when the host has Intl.Segmenter, and a Unicode-run split when it does not.
 * Returns word-like segments only, NFKC-normalised and lower-cased.
 */
export function segmentWords(value, locale = 'zh') {
    const text = String(value ?? '').normalize('NFKC');
    if (!text) return [];
    const segmenter = segmenterFor(locale);
    const out = [];
    if (segmenter) {
        for (const part of segmenter.segment(text)) {
            if (!part.isWordLike) continue;
            const word = String(part.segment || '').toLowerCase();
            if (word) out.push(word);
        }
        return out;
    }
    for (const match of text.matchAll(/[A-Za-z0-9_]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
        out.push(match[0].toLowerCase());
    }
    return out;
}

/**
 * Adjacent word pairs of a query, as a single string each. Used to reward a candidate that contains
 * the phrase rather than the two words scattered apart — the thing n-grams cannot express.
 */
export function phraseBigrams(words) {
    const list = Array.isArray(words) ? words : [];
    const out = [];
    for (let i = 0; i + 1 < list.length; i++) {
        out.push(list[i] + '\u0001' + list[i + 1]);
    }
    return out;
}

/** Fraction of `queryWords` that appear in `docWords`, weighted by word length. */
export function wordCoverage(queryWords, docWords) {
    const query = Array.isArray(queryWords) ? queryWords : [];
    if (!query.length) return 0;
    const doc = new Set((Array.isArray(docWords) ? docWords : []).map(w => String(w)));
    let hit = 0;
    let total = 0;
    for (const word of query) {
        const weight = Math.max(1, Array.from(String(word)).length);
        total += weight;
        if (doc.has(String(word))) hit += weight;
    }
    return total ? hit / total : 0;
}

/** How many adjacent word pairs of the query occur consecutively in the document text. */
export function phraseHits(queryWords, docText) {
    const words = Array.isArray(queryWords) ? queryWords : [];
    if (words.length < 2) return 0;
    const haystack = String(docText ?? '').normalize('NFKC').toLowerCase();
    if (!haystack) return 0;
    let hits = 0;
    for (let i = 0; i + 1 < words.length; i++) {
        const a = words[i];
        const b = words[i + 1];
        // Allow the few punctuation/whitespace characters that can sit between two words.
        const pattern = new RegExp(escapeRegExp(a) + '[\\s\\p{P}\\p{S}]{0,2}' + escapeRegExp(b), 'u');
        if (pattern.test(haystack)) hits += 1;
    }
    return hits;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Diagnostic label for the metrics panel. */
export function tokenModelLabel() {
    return 'tokens = ' + TOKEN_MODEL.cjkPerChar + '*CJK + ' + TOKEN_MODEL.otherPerChar + '*other (' + TOKEN_MODEL.version + ')';
}
