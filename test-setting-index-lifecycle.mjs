import assert from 'node:assert/strict';
import { createSettingStore, createWorld, addSource, addRevision, addEntries, setActiveBaselineRevision } from './setting-store.js';
import {
  buildSettingEntryManifest,
  buildSettingIndexSnapshot,
  buildSettingVectorItems,
  computeSettingEmbeddingProfileHash,
  diffSettingEntryManifests,
  getSettingCollectionId,
} from './setting-index.js';

let store=createSettingStore({now:100});
let r=createWorld(store,{world_id:'w',name:'Lifecycle World'},{now:101}); store=r.store;
r=addSource(store,{source_id:'s',world_id:'w',format:'titled_txt',content_hash:'src',raw_payload:'x'},{now:102}); store=r.store;
r=addRevision(store,{revision_id:'rev',world_id:'w',source_id:'s',revision_label:'v1',revision_kind:'baseline'},{now:103}); store=r.store;
r=addEntries(store,[
  {entry_id:'a',world_id:'w',source_id:'s',revision_id:'rev',source_entry_id:1,title:'A',content:'Alpha rule stays unchanged.',keys:['alpha'],order:1,content_hash:'ha'},
  {entry_id:'b',world_id:'w',source_id:'s',revision_id:'rev',source_entry_id:2,title:'B',content:'Beta old rule.',keys:['beta'],order:2,content_hash:'hb-old'},
  {entry_id:'c',world_id:'w',source_id:'s',revision_id:'rev',source_entry_id:3,title:'C',content:'Gamma removed rule.',keys:['gamma'],order:3,content_hash:'hc'},
],{now:104}); store=r.store;
store=setActiveBaselineRevision(store,'w','rev',{now:105});

const before=buildSettingIndexSnapshot(store,{maxChars:180});
const beforeManifest=buildSettingEntryManifest(before);

// Simulate a repaired legacy snapshot in the same immutable revision scope so the lifecycle
// layer can prove it performs a per-entry diff instead of purging the whole collection.
const nextStore=structuredClone(store);
nextStore.entries.b={...nextStore.entries.b,content:'Beta NEW rule with changed semantics.',content_hash:'hb-new'};
delete nextStore.entries.c;
nextStore.entries.d={
  ...nextStore.entries.a,
  entry_id:'d',source_entry_id:4,title:'D',content:'Delta newly added rule.',keys:['delta'],order:4,content_hash:'hd',
};
const after=buildSettingIndexSnapshot(nextStore,{maxChars:180});
const afterManifest=buildSettingEntryManifest(after);
const diff=diffSettingEntryManifests(beforeManifest,afterManifest);

assert.deepEqual(diff.added,['d']);
assert.deepEqual(diff.changed,['b']);
assert.deepEqual(diff.removed,['c']);
assert.deepEqual(diff.unchanged,['a']);
assert.equal(diff.has_changes,true);
assert.ok(diff.delete_hashes.length>=2,'changed + removed entries must expose old vector hashes for targeted deletion');
const selected=buildSettingVectorItems(after,{entryIds:diff.insert_entry_ids});
assert.ok(selected.length>=2);
assert.ok(selected.every(item=>{
  const chunk=after.chunks[item.index];
  return ['b','d'].includes(chunk.entry_id);
}),'incremental inserts must contain only added/changed entries');

const p1=computeSettingEmbeddingProfileHash('transformers:profile-a');
const p2=computeSettingEmbeddingProfileHash('openai:profile-b');
assert.notEqual(p1,p2);
const c1=getSettingCollectionId(after.scope,p1,'generation-one');
const c2=getSettingCollectionId(after.scope,p2,'generation-one');
const c1b=getSettingCollectionId(after.scope,p1,'generation-two');
assert.notEqual(c1,c2,'physical vector collections must be separated by embedding profile');
assert.notEqual(c1,c1b,'safe full rebuild generations must use inactive staging collection ids');
assert.match(c1,/^aetheria_v55_setting_/);

console.log('PASS Commit G pure lifecycle: per-entry diff + embedding-profile/generation collection identity');
