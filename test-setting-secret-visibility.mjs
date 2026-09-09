// Iteration 08: explicit role-private setting visibility (proposal B10 / P0 "world secret
// vs character knowledge"). Secrets are never inferred from prose or filenames: an entry is
// private only when the source explicitly marks it secret and names an audience.
import assert from 'node:assert/strict';
import { createSettingStore } from './setting-store.js';
import { commitImport, previewImport } from './setting-importer.js';
import { buildSettingChunks } from './setting-index.js';
import { filterSettingRowsForActor, fuseSettingCandidates, isSettingRowVisible } from './setting-retriever.js';

const worldbook = {
  entries: {
    '0': { uid: 1, comment: '公开地点', content: '档案馆位于城北。', key: ['档案馆'] },
    '1': { uid: 2, comment: '密室真相', content: '档案馆地下二层藏着国王的私生女。', key: ['档案馆', '秘密'], constant: true, secret: true, known_by: ['Alice'] },
    '2': { uid: 3, comment: '无受众秘密', content: '没有人知道这件事。', key: ['秘密'], secret: true, known_by: [] },
  },
};

const preview = await previewImport(JSON.stringify(worldbook), { filename: 'secrets.json' });
const aliceEntry = preview.entries.find(entry => entry.source_entry_id === 2);
assert.equal(aliceEntry.secret, true, 'explicit secret flag must survive import preview');
assert.deepEqual(aliceEntry.known_by, ['Alice']);
const nobodyEntry = preview.entries.find(entry => entry.source_entry_id === 3);
assert.equal(nobodyEntry.secret, true);
assert.deepEqual(nobodyEntry.known_by, []);

let store = createSettingStore({ now: 2000 });
const committed = await commitImport(store, preview, { world_name: '保密世界', revision_label: 'v1', activate: true, now: 2001 });
store = committed.store;
const storedAlice = Object.values(store.entries).find(entry => entry.source_entry_id === 2);
assert.equal(storedAlice.secret, true);
assert.deepEqual(storedAlice.known_by, ['Alice']);

const { chunks } = buildSettingChunks(store);
assert.ok(chunks.length >= 3);
const secretChunk = chunks.find(chunk => chunk.entry_id === storedAlice.entry_id);
assert.equal(secretChunk.secret, true, 'secret flag must reach the chunk record');
assert.deepEqual(secretChunk.known_by, ['Alice']);

const fused = fuseSettingCandidates({ chunks }, {
  lexical: chunks.map((chunk, index) => ({ chunk, score: 1 - index * 0.01 })),
  topEntries: 20,
  maxChars: 100_000,
});
const entryId = sourceEntryId => Object.values(store.entries).find(entry => entry.source_entry_id === sourceEntryId).entry_id;
const publicId = entryId(1);
const secretId = entryId(2);
const nobodyId = entryId(3);
assert.ok(fused.results.some(row => row.entry_id === secretId), 'unfiltered retrieval still sees the secret');

const bob = filterSettingRowsForActor(fused, { aliases: ['bob'], ids: ['ent_bob'] });
assert.ok(bob.results.some(row => row.entry_id === publicId), 'public entry stays visible');
assert.ok(!bob.results.some(row => row.entry_id === secretId), 'secret entry hidden from the wrong character');
assert.ok(!bob.constant_entries.some(row => row.entry_id === secretId), 'secret constant entry hidden from the wrong character');
assert.ok(!bob.results.some(row => row.entry_id === nobodyId), 'secret with no audience is visible to nobody');
assert.ok(bob.hidden_secret_entry_ids.includes(secretId));

const alice = filterSettingRowsForActor(fused, { aliases: ['Alice'], ids: ['ent_alice'] });
assert.ok(alice.results.some(row => row.entry_id === secretId), 'secret entry visible to its named audience');
assert.ok(alice.constant_entries.some(row => row.entry_id === secretId), 'secret constant entry visible to its named audience');
assert.ok(!alice.results.some(row => row.entry_id === nobodyId), 'no-audience secret stays hidden even for a named actor');

assert.equal(isSettingRowVisible({ secret: false, known_by: [] }, { aliases: [], ids: [] }), true);
assert.equal(isSettingRowVisible({ secret: true, known_by: ['ent_alice'] }, { aliases: [], ids: ['ent_alice'] }), true);

console.log('PASS setting secret visibility: explicit schema only, audience filtered by id or alias, constants included');
