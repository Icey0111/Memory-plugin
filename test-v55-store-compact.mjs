// The storage projection must remove exactly the wrapper, and nothing that changes what a reader sees.
import assert from 'node:assert/strict';
import { compactRecord, compactRecordMap, compactSavings } from './v55-store-compact.js';

const identity = { world_id: 'w1', chat_id: 'chat-1', branch_id: 'br_now' };
const record = {
  id: 'm1', kind: 'commitment', status: 'active', text: 'Keep the promise.',
  world_id: 'w1', chat_id: 'chat-1', branch_id: 'br_now',
  invalid_reason: null, close_reason: null, superseded_by: null, supersedes: null,
  known_by: null, known_by_ids: [], quality_flags: [], scope: '', indexable: false,
  last_recalled_message: null, source_message: 4,
};
const compacted = compactRecord(record, identity);

// Absent fields carry nothing, so they are not written.
for (const key of ['invalid_reason', 'close_reason', 'superseded_by', 'supersedes', 'known_by', 'known_by_ids', 'quality_flags', 'scope', 'indexable']) {
  assert.ok(!(key in compacted), key + ' has no value and must not be stored');
}
// Identity stamps are removed only when they merely repeat the store's own identity.
for (const key of ['world_id', 'chat_id', 'branch_id']) assert.ok(!(key in compacted), key + ' repeats runtime_identity');
const moved = compactRecord({ ...record, branch_id: 'br_original' }, identity);
assert.equal(moved.branch_id, 'br_original', 'an origin branch that differs from the current one is a fact, not a repeat');
const otherChat = compactRecord({ ...record, chat_id: 'chat-2' }, identity);
assert.equal(otherChat.chat_id, 'chat-2', 'a foreign chat id is kept');

// The one field where null and missing are read differently is never removed.
assert.equal(compacted.last_recalled_message, null, 'a null recall cooldown is preserved: Number(null) is finite, Number(undefined) is not');

// Facts are untouched, including falsy-but-meaningful numbers.
assert.equal(compacted.source_message, 4);
assert.equal(compacted.text, 'Keep the promise.');

// A non-object entry, and a map that is not a map, pass through rather than corrupting the store.
assert.equal(compactRecord(null, identity), null);
assert.equal(compactRecordMap([1, 2], identity).length, 2);
const map = { a: record, b: { ...record, id: 'm2', slot: 'x.y' } };
const saved = compactSavings(map, identity);
assert.ok(saved.saved > 0, 'the projection saves characters, got ' + JSON.stringify(saved));
assert.ok(JSON.stringify(compactRecordMap(map, identity)).length < JSON.stringify(map).length);

console.log('PASS v5.5 store compaction: the per-memory wrapper is dropped and no reader loses a value');
