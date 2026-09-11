// Aetheria Unified Memory v5.5 — A4: repetition-driven compression, and the grouping it needs.
//
// The plan (section 3, A4) says the compression budget must be `f(repetition)` rather than a constant,
// because repetition is the only thing that makes text genuinely redundant. The plan also flags it as
// unverified. There is one trap that has to be designed around first:
//
//   shrinking the digest WINDOW does not compress anything. The digest window is the fold coverage
//   certificate - a floor may stay hidden only while a line still names its turn - so dropping lines
//   restores raw floors and makes the prompt BIGGER. Compression has to come from merging turns into
//   fewer, shorter lines that still carry every turn id they stand in for.
//
// So A4 is implemented as grouping: when the story repeats itself, consecutive turns collapse into one
// Level-1 line whose `source_ids` hold all of their turn ids. Coverage is unchanged by construction,
// the rendered text shrinks, and the amount it shrinks is driven by the measured repetition.

import { phraseBigrams, segmentWords } from './v55-tokenizer.js';
import { readTurn } from './v55-boundary.js';

export const COMPRESSION_VERSION = 1;
export const DEFAULT_MAX_GROUP = 4;
export const DEFAULT_LINE_CHARS = 400;
/** Never merge more than this, whatever the repetition says: a reader still has to follow the story. */
export const HARD_MAX_GROUP = 8;
/** Below this the overlap is ordinary shared vocabulary, not repetition. */
export const DEFAULT_DEAD_ZONE = 0.2;

function clean(value, max = 400) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const value of a) if (b.has(value)) shared += 1;
    return shared / (a.size + b.size - shared);
}

function bigramSet(text) {
    return new Set(phraseBigrams(segmentWords(clean(text, 2000))));
}

/**
 * How much of the window repeats something already said. Two independent, deterministic signals:
 *
 *   text reuse   - the largest bigram overlap of each line against any earlier line, averaged. High
 *                  means the extractor keeps re-describing the same situation.
 *   slot novelty - the share of turns that touched a slot nobody touched before. Low means the turns
 *                  are changing values, not introducing new ones.
 *
 * The result is one number in [0,1]; 0 is "every line is new", 1 is "every line is a restatement".
 */
export function repetitionScore(store, turns, rows = null) {
    const list = Array.isArray(rows) && rows.length
        ? rows.map(row => String(row.text ?? ''))
        : (Array.isArray(turns) ? turns.map(turn => String(turn?.text ?? '')) : []);
    if (list.length < 2) return { version: COMPRESSION_VERSION, score: 0, text_reuse: 0, slot_novelty: 1, samples: list.length };

    const sets = list.map(bigramSet);
    let reuseTotal = 0;
    for (let i = 1; i < sets.length; i += 1) {
        let best = 0;
        for (let j = 0; j < i; j += 1) {
            const overlap = jaccard(sets[i], sets[j]);
            if (overlap > best) best = overlap;
        }
        reuseTotal += best;
    }
    const textReuse = reuseTotal / (sets.length - 1);

    let novel = 0;
    let touched = 0;
    const seen = new Set();
    for (const turn of Array.isArray(turns) ? turns : []) {
        const reading = readTurn(store, Number(turn?.assistant_index));
        const slots = reading.slots.map(entry => entry.slot).filter(Boolean);
        if (!slots.length) continue;
        touched += 1;
        if (slots.some(slot => !seen.has(slot))) novel += 1;
        for (const slot of slots) seen.add(slot);
    }
    const slotNovelty = touched ? novel / touched : 1;
    const score = Math.max(0, Math.min(1, 0.6 * textReuse + 0.4 * (1 - slotNovelty)));
    return {
        version: COMPRESSION_VERSION,
        score: Number(score.toFixed(4)),
        text_reuse: Number(textReuse.toFixed(4)),
        slot_novelty: Number((touched ? slotNovelty : 1).toFixed(4)),
        samples: sets.length,
    };
}

/**
 * Turn a repetition score into a compression plan.
 *
 *   repetition 0.0 -> factor 1.00, groups of 1   (nothing repeats; do not merge anything)
 *   repetition 0.5 -> factor 0.50, groups of 2
 *   repetition 1.0 -> factor 0.35, groups of 4   (the floor: even a maximally repetitive window keeps
 *                                               35% of its budget and never merges more than 4 turns)
 *
 * The floor is deliberate. Merging without limit would eventually produce one line for the whole chat,
 * which answers "the story so far" and nothing else; the plan's I3 ("most detail is still within reach")
 * forbids that.
 */
export function compressionPlan(repetition, {
    baseRows = 120,
    baseChars = 8000,
    maxGroup = DEFAULT_MAX_GROUP,
    minFactor = 0.35,
    deadZone = DEFAULT_DEAD_ZONE,
} = {}) {
    const raw = Math.max(0, Math.min(1, Number(repetition?.score ?? repetition) || 0));
    // Ordinary prose shares particles and names, so a window of genuinely new material still scores a
    // little. Measured on four unrelated Chinese sentences: 0.17. Treating that as repetition would
    // compress a chat for no reason, so anything under the dead zone counts as none at all.
    const value = raw < deadZone ? 0 : raw;
    const factor = Math.max(minFactor, Math.min(1, 1 - value * 0.65));
    const groupCap = Math.max(1, Math.min(HARD_MAX_GROUP, Math.floor(Number(maxGroup) || DEFAULT_MAX_GROUP)));
    const groupSize = Math.max(1, Math.min(groupCap, 1 + Math.round(value * (groupCap - 1))));
    return {
        version: COMPRESSION_VERSION,
        repetition: value,
        factor: Number(factor.toFixed(4)),
        group_size: groupSize,
        max_rows: Math.max(1, Math.round(Math.max(1, Number(baseRows) || 120) * factor)),
        max_chars: Math.max(400, Math.round(Math.max(400, Number(baseChars) || 8000) * factor)),
        line_chars: DEFAULT_LINE_CHARS,
    };
}

/**
 * Merge digest rows into groups. Every turn id of every member row lands in the group's `source_ids`,
 * so the fold coverage certificate is unchanged; only the rendered text gets shorter.
 *
 * Grouping is skipped across a boundary opener by default: a new scene is exactly the point where a
 * reader stops being able to assume the previous line still applies (A2 feeds A4).
 */
export function groupDigestRows(rows, {
    groupSize = 1,
    lineChars = DEFAULT_LINE_CHARS,
    boundaryPositions = null,
} = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const size = Math.max(1, Math.min(HARD_MAX_GROUP, Math.floor(Number(groupSize) || 1)));
    const cap = Math.max(80, Math.floor(Number(lineChars) || DEFAULT_LINE_CHARS));
    const stops = boundaryPositions instanceof Set ? boundaryPositions : new Set(boundaryPositions || []);
    if (size === 1) {
        return list.map(single);
    }
    const out = [];
    let bucket = [];
    const single = row => ({ rows: [row], source_ids: [String(row.source_id)], assistant_index: row.assistant_index, text: clean(row.text, cap), at: row.at || 0 });
    const flush = () => {
        if (!bucket.length) return;
        if (bucket.length === 1) { out.push(single(bucket[0])); bucket = []; return; }
        const sourceIds = bucket.flatMap(row => [String(row.source_id)]);
        // One line per group, budgeted as a share of the group's own budget, oldest text first so the
        // cause survives and the restatement is what gets trimmed. One separator character per join is
        // charged before the per-row share is handed out, so the merged line is bounded by `cap`.
        const perRow = Math.max(48, Math.floor((cap - (bucket.length - 1)) / bucket.length));
        const text = clean(bucket.map(row => clean(row.text, perRow)).filter(Boolean).join('；'), cap);
        // Only merge when merging actually pays. Joining four short lines adds separators and saves
        // nothing, and a "compression" that grows the prompt is worse than none; the rows are emitted
        // individually in that case. This is also why A4 needs repetition AND length: repetition alone
        // does not make text shorter.
        const separate = bucket.reduce((sum, row) => sum + String(row.text ?? '').length, 0);
        if (text.length >= separate) { for (const row of bucket) out.push(single(row)); bucket = []; return; }
        out.push({
            rows: bucket,
            source_ids: sourceIds,
            assistant_index: bucket[bucket.length - 1].assistant_index,
            text,
            at: bucket[bucket.length - 1].at || 0,
        });
        bucket = [];
    };
    list.forEach((row, position) => {
        if (position > 0 && stops.has(position)) flush();
        bucket.push(row);
        if (bucket.length >= size) flush();
    });
    flush();
    return out;
}

export function compressionStats(store, turns, rows, plan) {
    const repetition = repetitionScore(store, turns, rows);
    const computed = plan || compressionPlan(repetition);
    const grouped = groupDigestRows(rows || [], { groupSize: computed.group_size, lineChars: computed.line_chars });
    const before = (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + String(row.text ?? '').length, 0);
    const after = grouped.reduce((sum, group) => sum + String(group.text ?? '').length, 0);
    return {
        version: COMPRESSION_VERSION,
        repetition,
        plan: computed,
        lines_before: Array.isArray(rows) ? rows.length : 0,
        lines_after: grouped.length,
        chars_before: before,
        chars_after: after,
        ratio: before ? Number((after / before).toFixed(4)) : null,
    };
}
