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
// uses `|| default`, `?? default`, `Array.isArray` or `Number.isFinite`.
//
// One field used to violate that rule and no longer does. `memory-core.fuseHybridCandidates` read
// `Number(memory.last_recalled_message)` and applied a recall cooldown whenever the result was finite;
// `Number(null)` is 0 and finite, so a never-recalled memory was penalised as if it had been recalled at
// the start of the chat. The guard now requires a positive value, which is what it always meant, so a
// missing key and a null key finally agree. The fix is in the scoring code, not hidden in this
// projection - a storage layer must not be where a scoring bug is resolved.

import { STORE_COLUMNS_MARKER, STORE_COLUMNS_VERSION } from './memory-core.js';

export const STORE_COMPACT_VERSION = 1;

/** Per-record copies of the store's own identity. Removed only when they equal runtime_identity. */
const IDENTITY_FIELDS = Object.freeze(['world_id', 'chat_id', 'branch_id']);

/**
 * Fields a record map may drop outright because nothing reads them, whatever they hold.
 *
 * Extraction records carried four write-only diagnostics: `prompt_plan`, `setting_index_fingerprint`,
 * `generation_mode` and `user_index_at_creation` are written in one place (index.js) and read nowhere -
 * a repository-wide search finds only the assignment. They measured 8,330 characters over 26 records.
 * `entity_ids` is a per-memory cache of the entity registry, and `stampRuntimeIdentity` recomputes it
 * from `memory.entities` on every generation, deterministically, so the stored copy can never disagree
 * with the recomputed one. `known_by_ids` is deliberately NOT here: it is the deterministic twin of
 * `entity_ids`, but `isPrivateMemoryVisible` and `isOperationVisibleToActor` read it, and a missing
 * value there would make a private memory look public if the reader ran before the next stamp.
 */
const WRITE_ONLY_FIELDS = Object.freeze(['prompt_plan', 'setting_index_fingerprint', 'generation_mode', 'user_index_at_creation']);
const RECOMPUTED_FIELDS = Object.freeze(['entity_ids']);

function isAbsent(value) {
    if (value === null || value === undefined || value === false || value === '') return true;
    return Array.isArray(value) && value.length === 0;
}

export function compactRecord(record, identity = null, { drop = null } = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    const out = {};
    for (const [key, value] of Object.entries(record)) {
        if (drop && drop.includes(key)) continue;
        if (isAbsent(value)) continue;
        if (identity && IDENTITY_FIELDS.includes(key) && value === identity[key]) continue;
        out[key] = value;
    }
    return out;
}

/** The fields the projection removes from each collection, named so a reader can audit the difference. */
export const COMPACT_DROP_FIELDS = Object.freeze({
    memories: RECOMPUTED_FIELDS,
    extractions: Object.freeze([...WRITE_ONLY_FIELDS, ...RECOMPUTED_FIELDS]),
});

/** Characters a record map saves under this projection, for the report that quotes it. */
export function compactSavings(map, identity = null, options = {}) {
    const before = JSON.stringify(map || {}) || '';
    const after = JSON.stringify(encodeRecordMap(map, identity, options)) || '';
    return { before: before.length, after: after.length, saved: before.length - after.length };
}
/**
 * Column encoding: write each field NAME once instead of once per record.
 *
 * After the removals above, what was left of the memory wrapper was almost entirely repeated key names:
 * 74 records still spent 24,620 bytes writing the same 28 field names 74 times. A column per field pays
 * that cost once. Measured on the acceptance chat, the whole projection takes the memory records from
 * 62,385 bytes to under half that, and the chat file loses a further ~22 KB.
 *
 * The encoding is lossless for everything a reader can observe, because it is built on the same rule the
 * projection already uses: `null`, `undefined`, `''`, `false` and `[]` are indistinguishable to every
 * reader in this codebase, so they all encode as an empty cell and decode as an absent key. Numbers,
 * including 0, survive as themselves.
 *
 * The decoder lives in `memory-core.js`, next to the record definition and inside `normalizeStore` - the one
 * function every reader obtains a store through - so nothing outside those two files has to know the chat
 * file uses columns. The shape constants are defined there and imported here, so there is one definition.
 */

export function encodeRecordMap(map, identity = null, { drop = null } = {}) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
    const keys = Object.keys(map);
    if (!keys.length) return {};
    const fields = [];
    const seen = new Set();
    const projected = keys.map(key => compactRecord(map[key], identity, { drop }));
    for (const record of projected) {
        for (const field of Object.keys(record)) {
            if (seen.has(field)) continue;
            seen.add(field);
            fields.push(field);
        }
    }
    if (!fields.length) return {};
    const rows = projected.map(record => fields.map(field => (Object.prototype.hasOwnProperty.call(record, field) ? record[field] : null)));
    return { [STORE_COLUMNS_MARKER]: STORE_COLUMNS_VERSION, keys, fields, rows };
}
