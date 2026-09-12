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
// It is also the honest coverage certificate for folding: a floor may be hidden exactly while a digest
// line still stands in for it. That line used to be rebuilt from the bounded window on every pass, which
// made coverage O(window) rather than O(chat) - the oldest floors lost their stand-in as the window
// rolled forward and came back as raw text. `coalesceDigestBatches` below seals each complete batch of
// floors into one row and the summary pass keeps it, which is what makes coverage O(chat).

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
    // Who each floor was about, taken from the memories that floor produced. A sealed batch row has to cut
    // every member's clause to a share of one line, and a cut clause keeps the HEAD of a sentence, which
    // is frequently not the part that says who it is about. The extractor already named the cast, so the
    // row carries it: the same bytes per member, more of them meaningful. Measured need - digest rows were
    // built from event_summary alone and carried no participants at all, so a reader of a sealed row could
    // not tell a clause about one character from a clause about another.
    const castByIndex = new Map();
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    for (const memory of Object.values(memories)) {
        if (!memory || !Array.isArray(memory.entities) || !memory.entities.length) continue;
        const index = Number(memory.source_message);
        if (!Number.isInteger(index)) continue;
        const list = castByIndex.get(index) || [];
        for (const name of memory.entities) {
            const value = clean(name, 24);
            if (value && !list.includes(value) && list.length < 6) list.push(value);
        }
        castByIndex.set(index, list);
    }
    const rows = [];
    for (const turn of Array.isArray(turns) ? turns : []) {
        const index = Number(turn?.assistant_index);
        const hit = byIndex.get(index);
        if (!hit || !turn?.id) continue;
        rows.push({ assistant_index: index, source_id: String(turn.id), text: hit.text, at: hit.at, entities: castByIndex.get(index) || [] });
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
            // Carried through so a sealed batch can name the cast of a member whose clause it had to cut.
            entities: Array.isArray(row.entities) ? row.entities : [],
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

/** The assistant indexes one row stands in for, read from its turn ids. */
export function digestRowFloorIndexes(row) {
    const out = [];
    for (const id of Array.isArray(row?.source_ids) ? row.source_ids : []) {
        const match = /^turn_(\d+)_/.exec(String(id));
        if (match) out.push(Number(match[1]));
    }
    return out;
}

export const DIGEST_BATCH_VERSION = 1;

/**
 * Coalesce Level-1 rows into floor-aligned batches of `everyTurns`, so narrative coverage becomes
 * append-only instead of window-bounded.
 *
 * Why this exists. `digestRows` returns only the newest rows that fit `summary_digest_max_chars`, and
 * `reconcileFoldCoverage` rebuilt `level1` from that window on every pass, discarding every digest row
 * it did not rebuild. Coverage was therefore O(window), not O(chat), and because a floor may only stay
 * hidden while something stands in for it, `unfoldFloorsNotCovered` had to restore every older floor.
 * Simulated with the live acceptance chat's own event summaries and the live caps (120 rows / 8,000
 * characters, 164 characters per summary): the window saturates at about 45 floors, so 56 floors left 12
 * floors raw, 120 left 75 raw, and 500 floors left **456 raw floors** - more text than the memory system
 * removes. That is the failure this function exists to prevent.
 *
 * Alignment is on a floor's ORDINAL - its position in the whole extracted sequence - never on a position
 * inside the window, because a position in a sliding window is not stable and no batch would ever be
 * recognised twice. A batch holding all `everyTurns` floors is SEALED: it becomes exactly one row whose
 * id is a hash of its floors, so a later pass reproduces the same row verbatim. A batch that is still
 * filling keeps one row per floor, which is why folding still starts at the first extracted turn rather
 * than at the tenth, and why a sealed row never changes once written: ordinals only ever append.
 * `everyTurns = 1` seals every floor on its own, i.e. one permanent row per turn.
 *
 * Sizing. A sealed row is ONE line obeying the same `lineChars` cap as every other digest line, shared
 * out oldest-first exactly as A4 shares a merged group: the cause survives and the restatement is what
 * gets trimmed. So the stored tree costs about `ceil(floors / everyTurns)` lines instead of growing
 * with the transcript - at 500 floors and the shipped default of ten that is 50 lines rather than the
 * 8,000-character window's 45, and every floor keeps a stand-in.
 */
export function coalesceDigestBatches(rows, { everyTurns = 1, lineChars = DIGEST_LINE_MAX_CHARS, ordinalOf = null } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const size = positiveInt(everyTurns, 1, 1, 1000);
    const lineCap = Math.max(80, Math.floor(Number(lineChars) || DIGEST_LINE_MAX_CHARS));
    // The ordinal is a floor's position in the whole extracted sequence, supplied by the caller so that
    // it does not move when the digest window slides. Without it, the floor index itself is the ordinal,
    // which is what the unit tests use.
    const positions = new Map();
    if (ordinalOf instanceof Map) {
        for (const [floor, position] of ordinalOf) positions.set(Number(floor), Number(position));
    } else {
        const seen = new Set();
        for (const row of list) for (const index of digestRowFloorIndexes(row)) seen.add(index);
        [...seen].sort((a, b) => a - b).forEach((floor, position) => positions.set(floor, position));
    }
    const byBatch = new Map();
    for (const row of list) {
        if (!row) continue;
        const ordinals = digestRowFloorIndexes(row)
            .filter(index => positions.has(index))
            .map(index => positions.get(index));
        if (!ordinals.length) continue;
        const key = Math.floor(Math.min(...ordinals) / size);
        if (!byBatch.has(key)) byBatch.set(key, []);
        byBatch.get(key).push(row);
    }
    const out = [];
    for (const key of [...byBatch.keys()].sort((a, b) => a - b)) {
        const bucket = byBatch.get(key);
        const held = new Set();
        for (const row of bucket) {
            for (const index of digestRowFloorIndexes(row)) if (positions.has(index)) held.add(positions.get(index));
        }
        // Sealed means the batch is FULL. A trailing partial batch keeps one row per floor until its
        // floors arrive, which is both why folding still starts at the first extracted turn and why a
        // sealed row never changes afterwards: floor ordinals only ever append.
        const sealed = held.size >= size;
        if (!sealed) {
            // Still filling. One row per floor, tagged with the batch it belongs to, so a sealed row that
            // already stands in for this batch can supersede these without losing a floor.
            for (const row of bucket) out.push({ ...row, batch: key, sealed: false, floors: digestRowFloorIndexes(row).length });
            continue;
        }
        const ids = bucket.flatMap(row => (Array.isArray(row.source_ids) ? row.source_ids.map(String) : []));
        const floorIndexes = [];
        for (const row of bucket) for (const index of digestRowFloorIndexes(row)) if (!floorIndexes.includes(index)) floorIndexes.push(index);
        floorIndexes.sort((a, b) => a - b);
        // One row for the whole batch, bounded by the same per-line cap every other digest line obeys,
        // with the same oldest-first share rule A4 uses: the cause survives and the restatement is what
        // gets trimmed. This is what keeps the stored tree at ceil(floors / everyTurns) * cap characters
        // instead of growing with the transcript.
        const share = Math.max(24, Math.floor((lineCap - (bucket.length - 1)) / bucket.length));
        // Structure survives where prose cannot. A member's clause is cut to a share of one line, and a cut
        // clause keeps the HEAD of a sentence - which is frequently not the part that says who it is about.
        // C3 asks a situation row to carry the dimensions of the situation rather than the head of each
        // sentence, and the one dimension the extraction records give deterministically is the cast. So a
        // member that had to be cut spends part of its share naming its participants instead of spending
        // the whole share on a fragment: the same bytes, more of them meaningful. It also marks the cut,
        // which the bare join did not - a reader could not tell a complete clause from a severed one.
        const member = row => {
            const full = clean(row.text, 4000);
            if (!full) return '';
            if (full.length <= share) return full;
            const names = [...new Set((Array.isArray(row.entities) ? row.entities : [])
                .map(name => clean(name, 24)).filter(Boolean))].slice(0, 3).join('/');
            if (!names) return clean(full, share) + '…';
            return clean(full, Math.max(12, share - names.length - 3)) + '…[' + names + ']';
        };
        const members = bucket.map(member).filter(Boolean);
        out.push({
            id: 'summary_l1_batch_' + fnv1a32(floorIndexes.join(',')).toString(36),
            level: 1,
            source_ids: ids,
            text: clean(members.join('；'), lineCap),
            created_at: bucket.reduce((at, row) => Math.max(at, Number(row.created_at) || 0), 0),
            digest: true,
            merged: ids.length,
            batch: key,
            sealed: true,
            floors: floorIndexes.length,
        });
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
