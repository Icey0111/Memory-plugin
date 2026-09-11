// Aetheria Unified Memory v5.5 — deterministic Level-1 event digest.
//
// Why this exists. Folding is the only mechanism in this plugin that makes the prompt cheaper, and
// folding was gated on a model-written Level-1 summary, which was in turn gated on a ten-turn clock
// (`summary_level1_every_turns`). Measured consequence across 13 retained test chats: **seven had zero
// folded floors**, including the largest one, whose entire 42,637-token history stayed in the hot
// prompt. A ten-floor chat could never fold anything at all, because nine usable turns is less than
// ten.
//
// The extractor already writes an `event_summary` for every turn it processed. Those per-turn records
// are the natural Level-1 layer, and assembling them needs no model call, no clock, and cannot drift:
//
//   - no model call   -> it cannot be starved, rate-limited, or answered with an error string;
//   - no clock        -> coverage starts at the first extracted turn, not the tenth;
//   - no drift        -> every line is the extractor's reading of ONE original turn, never a summary
//                        of another summary (plan invariant I2 / finding S3).
//
// It is also the honest coverage certificate for folding: a floor may be hidden exactly while its own
// digest line still stands in for it, and the window is bounded, so the two stay in step.

import { fnv1a32 } from './memory-core.js';

export const DIGEST_VERSION = 1;
export const DIGEST_DEFAULT_MAX_ROWS = 120;
export const DIGEST_DEFAULT_MAX_CHARS = 8000;
/** Per-line cap. A runaway event_summary must not be able to eat the whole window. */
export const DIGEST_LINE_MAX_CHARS = 400;

function clean(value, max = DIGEST_LINE_MAX_CHARS) {
    return String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim().slice(0, max);
}

function positiveInt(value, fallback, min, max) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/**
 * One row per extracted turn, oldest first, then capped to the newest window.
 *
 * `turns` is what collectCompletedDialogueTurns() returns — the CURRENT turn ids. A turn with no
 * extraction record has no digest line, so it is simply not covered, and its raw text is never
 * hidden. That is the intended coupling: coverage gaps in extraction turn into coverage gaps in
 * folding instead of into silently lost text.
 */
export function digestRows(store, turns, { maxRows = DIGEST_DEFAULT_MAX_ROWS, maxChars = DIGEST_DEFAULT_MAX_CHARS } = {}) {
    const rowsCap = positiveInt(maxRows, DIGEST_DEFAULT_MAX_ROWS, 1, 1000);
    const charsCap = positiveInt(maxChars, DIGEST_DEFAULT_MAX_CHARS, 400, 200000);
    const byIndex = new Map();
    for (const record of Object.values(store?.extractions && typeof store.extractions === 'object' ? store.extractions : {})) {
        if (!record) continue;
        const index = Number(record.assistant_index_at_creation);
        const text = clean(record.event_summary);
        if (!Number.isInteger(index) || index < 0 || !text) continue;
        byIndex.set(index, { text, at: Number(record.generated_at) || 0 });
    }
    const rows = [];
    for (const turn of Array.isArray(turns) ? turns : []) {
        const index = Number(turn?.assistant_index);
        const hit = byIndex.get(index);
        if (!hit || !turn?.id) continue;
        rows.push({ assistant_index: index, source_id: String(turn.id), text: hit.text, at: hit.at });
    }
    rows.sort((a, b) => a.assistant_index - b.assistant_index);

    const byRows = rows.slice(-rowsCap);
    const kept = [];
    let used = 0;
    for (let i = byRows.length - 1; i >= 0; i -= 1) {
        const cost = byRows[i].text.length + 10;
        // Always keep at least one line; the newest floor is the one a reader is most likely to need.
        if (kept.length && used + cost > charsCap) break;
        used += cost;
        kept.unshift(byRows[i]);
    }
    return kept;
}

/**
 * Digest rows rendered as Level-1 summary rows, so every existing consumer keeps working unchanged.
 *
 * Accepts either one row (\`source_id\`) or a group produced by A4's \`groupDigestRows\` (\`source_ids\`).
 * A group names every turn it stands in for, which is what keeps the fold coverage certificate true
 * while the rendered text gets shorter.
 */
export function digestToLevel1(rows) {
    return (Array.isArray(rows) ? rows : []).map(row => {
        const ids = Array.isArray(row.source_ids) && row.source_ids.length ? row.source_ids.map(String) : [String(row.source_id)];
        return {
            id: 'summary_l1_' + fnv1a32(ids.join(',') + '|' + row.text).toString(36),
            level: 1,
            source_ids: ids,
            text: row.text,
            created_at: row.at || 0,
            // Marks the row as machine-assembled: it is replaced wholesale on every pass, and a model
            // summary with the same source ids is a different, legitimate kind of row.
            digest: true,
            // How many turns this one line stands in for. 1 means A4 found no repetition worth merging.
            merged: ids.length,
        };
    });
}

/** The covered assistant indexes, i.e. exactly the floors whose stand-in is still in the window. */
export function digestCoveredIndexes(level1Rows) {
    const out = new Set();
    for (const row of Array.isArray(level1Rows) ? level1Rows : []) {
        for (const id of Array.isArray(row?.source_ids) ? row.source_ids : []) {
            const match = /^turn_(\d+)_/.exec(String(id));
            if (match) out.add(Number(match[1]));
        }
    }
    return out;
}

/** Diagnostics: what the digest currently stands in for. */
export function digestStats(store, turns, options = {}) {
    const rows = digestRows(store, turns, options);
    const extracted = Object.values(store?.extractions || {}).filter(record => clean(record?.event_summary)).length;
    return {
        version: DIGEST_VERSION,
        lines: rows.length,
        chars: rows.reduce((sum, row) => sum + row.text.length, 0),
        newest_index: rows.length ? rows[rows.length - 1].assistant_index : null,
        oldest_index: rows.length ? rows[0].assistant_index : null,
        extracted_records: extracted,
        uncovered_records: Math.max(0, extracted - rows.length),
    };
}
