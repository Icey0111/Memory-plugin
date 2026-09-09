import assert from 'node:assert/strict';
import {
  SETTING_STORE_SCHEMA_VERSION,
  deserializeSettingStore,
  migrateSettingStore,
  serializeSettingStore,
  validateSettingStore,
} from './setting-schema.js';
import {
  addEntries,
  addRevision,
  addSource,
  createSettingStore,
  createWorld,
  deleteWorld,
  listEntriesForRevision,
  renameWorld,
  setActiveBaselineRevision,
  setActiveExtensionRevisions,
} from './setting-store.js';

const NOW = 1_800_000_000_000;
let store = createSettingStore({ now: NOW });
assert.equal(store.schema_version, SETTING_STORE_SCHEMA_VERSION);

let result = createWorld(store, { world_id:'world_aetheria', name:'艾瑟瑞亚' }, { now: NOW + 1 });
store = result.store;
assert.equal(store.active_world_id, 'world_aetheria');

result = addSource(store, {
  source_id:'source_v5', world_id:'world_aetheria', format:'worldbook_json', filename:'aetheria_v5.json',
  content_hash:'hash-source-v5', raw_payload:{entries:{0:{comment:'核心',content:'原始内容',unknown_field:{x:1}}}}, metadata:{origin:'fixture'},
}, { now: NOW + 2 });
store = result.store;
assert.deepEqual(store.sources.source_v5.raw_payload.entries['0'].unknown_field, {x:1}, 'raw source payload must survive store normalization');

result = addRevision(store, {
  revision_id:'rev_v5', world_id:'world_aetheria', source_id:'source_v5', revision_label:'v5', revision_kind:'baseline',
}, { now: NOW + 3 });
store = result.store;

result = addEntries(store, [
  {entry_id:'entry_core',world_id:'world_aetheria',source_id:'source_v5',revision_id:'rev_v5',source_entry_id:0,title:'核心设定',content:'艾瑟瑞亚有稳定的核心规则。',keys:['艾瑟瑞亚'],constant:true,disabled:false,order:0,raw_extra:{selectiveLogic:0},content_hash:'h1'},
  {entry_id:'entry_disabled',world_id:'world_aetheria',source_id:'source_v5',revision_id:'rev_v5',source_entry_id:1,title:'停用条目',content:'这是保留但不召回的条目。',disabled:true,order:1,content_hash:'h2'},
], { now: NOW + 4 });
store = result.store;
store = setActiveBaselineRevision(store, 'world_aetheria', 'rev_v5', { now: NOW + 5 });
assert.equal(store.worlds.world_aetheria.active_baseline_revision_id, 'rev_v5');
assert.equal(listEntriesForRevision(store, 'rev_v5', {includeDisabled:false}).length, 1);

// Extension revisions are explicitly tied to one baseline.
result = addSource(store, {source_id:'source_ext',world_id:'world_aetheria',format:'titled_txt',filename:'addon.txt',content_hash:'hash-ext',raw_payload:'## addon\n...',metadata:{}}, {now:NOW+6});
store = result.store;
result = addRevision(store, {revision_id:'rev_ext',world_id:'world_aetheria',source_id:'source_ext',revision_label:'addon',revision_kind:'extension',base_revision_id:'rev_v5'}, {now:NOW+7});
store = result.store;
store = setActiveExtensionRevisions(store, 'world_aetheria', ['rev_ext'], {now:NOW+8});
assert.deepEqual(store.worlds.world_aetheria.active_extension_revision_ids, ['rev_ext']);

const validation = validateSettingStore(store);
assert.equal(validation.ok, true, validation.errors.join('\n'));
assert.equal(validation.warnings.length, 0);

const text = serializeSettingStore(store);
const restored = deserializeSettingStore(text, {now:NOW+9});
assert.deepEqual(restored, store, 'serialized store must round-trip without semantic change');

// Development v0 snapshots may use arrays and `activeWorldId`; migration must be deterministic.
const legacy = {
  version:0,
  activeWorldId:'legacy_world',
  worlds:[{world_id:'legacy_world',name:'Legacy',created_at:1,updated_at:1}],
  sources:[], revisions:[], entries:[], created_at:1, updated_at:1,
};
const migrated = migrateSettingStore(legacy, {now:NOW});
assert.equal(migrated.migrated, true);
assert.equal(migrated.store.schema_version, 1);
assert.equal(migrated.store.active_world_id, 'legacy_world');
assert.ok(migrated.store.worlds.legacy_world);

// Revisions are immutable: a new world version is a new source + revision, not an in-place edit.
assert.throws(() => addRevision(store, {revision_id:'rev_v5',world_id:'world_aetheria',source_id:'source_v5',revision_label:'mutated',revision_kind:'baseline'}), /already exists/);
assert.throws(() => addSource(store, {source_id:'source_v5',world_id:'world_aetheria'}), /already exists/);

// Deleting a populated world requires explicit cascade.
assert.throws(() => deleteWorld(store, 'world_aetheria'), /dependent setting data/);
const cleared = deleteWorld(store, 'world_aetheria', {cascade:true,now:NOW+10});
assert.equal(Object.keys(cleared.worlds).length, 0);
assert.equal(Object.keys(cleared.sources).length, 0);
assert.equal(Object.keys(cleared.revisions).length, 0);
assert.equal(Object.keys(cleared.entries).length, 0);

const renamed = renameWorld(migrated.store, 'legacy_world', 'Legacy 2', {now:NOW+11});
assert.equal(renamed.worlds.legacy_world.name, 'Legacy 2');

console.log('PASS v5.5 plugin-owned Setting Store schema, CRUD, immutability, migration and serialization');
