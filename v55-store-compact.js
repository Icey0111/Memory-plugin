// Aetheria Unified Memory v5.5 - the storage projection.
//
// Why this exists. The chat file stores one JSON object per memory, and the object is mostly wrapper:
// measured on the 50-floor acceptance chat (72 memories), the memory records were 65,958 characters for
// 5,111 characters of actual memory text. Two parts of that wrapper carry no information at all:
//
//   * 18,631 characters were keys whose value was null, undefined, '' , false or [] for that record.
//     'invalid_reason', 'superseded_by', 'close_reason', 'supersedes', 'known_by' and 'known_by_ids' were
//     null on all 72 records - about 9,300 characters of key that never held a value.
//   * 6,552 characters were the per-record copies of world_id / chat_id / branch_id. They are the same
//     string on every record and are already stored once in store.runtime_identity; stampRuntimeIdentity
//     re-derives them on every generation.
//
// This is a serialisation projection only. The live store keeps every field, `toJSON` is the single place
// a chat is written, and no reader can tell a missing key from a null one here: every reader that cares
// uses `|| default`, `?? default`, `Array.isArray` or `Number.isFinite`. The one field where presence is
// NOT the same as value is excluded below.

export const STORE_COMPACT_VERSION = 1;

/** Per-record copies of the store's own identity. Removed only when they equal runtime_identity. */
const IDENTITY_FIELDS = Object.freeze(['world_id', 'chat_id', 'branch_id']);

/**
 * Fields where a null value is READ differently from a missing one, so they are never removed.
 *
 * `memory-core.fuseHybridCandidates` computes `Number(memory.last_recalled_message)` and applies a
 * recall cooldown whenever that is finite. `Number(null)` is 0 and finite, `Number(undefined)` is NaN,
 * so removing the key would silently stop penalising never-recalled memories. That difference is a
 * recall-scoring question, not a storage one, and it is not this projection's to settle.
 */
const PRESENCE_MATTERS = Object.freeze(['last_recalled_message']);

function isAbsent(value) {
    if (value === null || value === undefined || value === false || value === '') return true;
    return Array.isArray(value) && value.length === 0;
}

export function compactRecord(record, identity = null) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    const out = {};
    for (const [key, value] of Object.entries(record)) {
        if (PRESENCE_MATTERS.includes(key)) { out[key] = value; continue; }
        if (isAbsent(value)) continue;
        if (identity && IDENTITY_FIELDS.includes(key) && value === identity[key]) continue;
        out[key] = value;
    }
    return out;
}

/** Project one record map (memories, extractions). Unknown shapes are returned untouched. */
export function compactRecordMap(map, identity = null) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
    const out = {};
    for (const [key, value] of Object.entries(map)) out[key] = compactRecord(value, identity);
    return out;
}

/** Characters a record map saves under this projection, for the report that quotes it. */
export function compactSavings(map, identity = null) {
    const before = JSON.stringify(map || {}) || '';
    const after = JSON.stringify(compactRecordMap(map, identity)) || '';
    return { before: before.length, after: after.length, saved: before.length - after.length };
}
