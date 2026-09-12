// The storage projection must remove exactly the wrapper, and nothing that changes what a reader sees.
import assert from 'node:assert/strict';
// The decoder is imported from the module that owns it - memory-core, where normalizeStore calls it - and
// the encoder from the projection module. The round trip below therefore crosses the real boundary
// between "what is written" and "what every reader gets back", not two halves of one file.
import { decodeRecordMap } from './memory-core.js';
import { COMPACT_DROP_FIELDS, compactRecord, compactSavings, encodeRecordMap } from './v55-store-compact.js';

const identity = { world_id: 'w1', chat_id: 'chat-1', branch_id: 'br_now' };
const record = {
  id: 'm1', kind: 'commitment', status: 'active', text: 'Keep the promise.',
  world_id: 'w1', chat_id: 'chat-1', branch_id: 'br_now',
  invalid_reason: null, close_reason: null, superseded_by: null, supersedes: null,
  known_by: null, known_by_ids: [], quality_flags: [], scope: '', indexable: false,
  last_recalled_message: null, source_message: 4, reinforcement: 0,
};
const compacted = compactRecord(record, identity);

// Absent fields carry nothing, so they are not written.
for (const key of ['invalid_reason', 'close_reason', 'superseded_by', 'supersedes', 'known_by', 'known_by_ids', 'quality_flags', 'scope', 'indexable', 'last_recalled_message']) {
  assert.ok(!(key in compacted), key + ' has no value and must not be stored');
}
// Identity stamps are removed only when they merely repeat the store's own identity.
for (const key of ['world_id', 'chat_id', 'branch_id']) assert.ok(!(key in compacted), key + ' repeats runtime_identity');
const moved = compactRecord({ ...record, branch_id: 'br_original' }, identity);
assert.equal(moved.branch_id, 'br_original', 'an origin branch that differs from the current one is a fact, not a repeat');
assert.equal(compactRecord({ ...record, chat_id: 'chat-2' }, identity).chat_id, 'chat-2', 'a foreign chat id is kept');

// Facts are untouched, including falsy-but-meaningful numbers.
assert.equal(compacted.source_message, 4);
assert.equal(compacted.reinforcement, 0, 'zero is a value, not an absence');
assert.equal(compacted.text, 'Keep the promise.');

// Write-only fields and recomputed caches are removed whatever they hold.
const extraction = { source_key: 'x', operations: [{ op: 'add' }], prompt_plan: { big: 'x'.repeat(50) }, generation_mode: 'normal', user_index_at_creation: 3, setting_index_fingerprint: 'fp' };
const slim = compactRecord(extraction, identity, { drop: COMPACT_DROP_FIELDS.extractions });
for (const key of ['prompt_plan', 'generation_mode', 'user_index_at_creation', 'setting_index_fingerprint']) {
  assert.ok(!(key in slim), key + ' has no reader and must not be stored');
}
assert.deepEqual(slim.operations, [{ op: 'add' }]);
const memorySlim = compactRecord({ id: 'm', entity_ids: ['ent_a'], entities: ['A'] }, identity, { drop: COMPACT_DROP_FIELDS.memories });
assert.deepEqual(memorySlim.entities, ['A'], 'the source of the derived cache is kept');
assert.ok(!('entity_ids' in memorySlim), 'entity_ids is recomputed by stampRuntimeIdentity on every generation');
// known_by_ids is the one derived field that stays: two visibility checks read it, and a missing value
// there would make a private memory look public if the check ran before the next stamp.
const privacy = compactRecord({ id: 'm', known_by_ids: ['ent_a'] }, identity, { drop: COMPACT_DROP_FIELDS.memories });
assert.deepEqual(privacy.known_by_ids, ['ent_a']);

// --- the column encoding ---------------------------------------------------------------------------
const map = { a: record, b: { ...record, id: 'm2', slot: 'x.y', entities: ['A'], topicless: undefined } };
const columns = encodeRecordMap(map, identity, { drop: COMPACT_DROP_FIELDS.memories });
assert.equal(columns.__columns, 1, 'the format is versioned');
assert.deepEqual(columns.keys, ['a', 'b']);
assert.ok(columns.fields.includes('text') && columns.fields.includes('slot'), 'every field any record uses gets one column');
const decoded = decodeRecordMap(columns);
assert.deepEqual(Object.keys(decoded), ['a', 'b']);
assert.equal(decoded.a.text, 'Keep the promise.');
assert.equal(decoded.b.slot, 'x.y');
assert.deepEqual(decoded.b.entities, ['A']);
assert.equal(decoded.a.reinforcement, 0, 'a zero survives the round trip');
for (const key of ['invalid_reason', 'scope', 'indexable', 'last_recalled_message']) {
  assert.ok(!(key in decoded.a), key + ' must not come back as an own property');
}

// Columns are what makes the wrapper cheap: the field names are written once, not once per record.
const saved = compactSavings(map, identity, { drop: COMPACT_DROP_FIELDS.memories });
assert.ok(saved.saved > 0, 'the projection saves characters, got ' + JSON.stringify(saved));
const wide = {};
for (let i = 0; i < 40; i += 1) wide['k' + i] = { ...record, id: 'k' + i };
assert.ok(compactSavings(wide, identity).saved > compactSavings({ a: record }, identity).saved * 4, 'the saving grows with the number of records, which is what a repeated key name would not do');

// Unknown shapes pass through rather than corrupting the store.
assert.deepEqual(decodeRecordMap(null), {});
assert.deepEqual(decodeRecordMap([1, 2]), {}, 'an array is not a map of records; normalizeStore has always treated one as empty');
assert.equal(encodeRecordMap(null, identity), null);
assert.deepEqual(decodeRecordMap({ m1: { id: 'm1' } }), { m1: { id: 'm1' } }, 'an unencoded map is returned unchanged');

console.log('PASS v5.5 store compaction: the per-memory wrapper is dropped and no reader loses a value');
