import assert from 'node:assert/strict';
import { createSettingStore, createWorld, addSource, addRevision, addEntries, setActiveBaselineRevision, setActiveExtensionRevisions } from './setting-store.js';
import { buildSettingIndexSnapshot, lexicalSearchSettingChunks, resolveActiveSettingScope } from './setting-index.js';

let store = createSettingStore({ now: 1000 });
let r = createWorld(store, { world_id:'world_a', name:'测试世界' }, { now:1001 }); store = r.store;
r = addSource(store, { source_id:'src_base', world_id:'world_a', format:'worldbook_json', content_hash:'src-base', raw_payload:'{}' }, { now:1002 }); store = r.store;
r = addRevision(store, { revision_id:'rev_base', world_id:'world_a', source_id:'src_base', revision_label:'base', revision_kind:'baseline' }, { now:1003 }); store = r.store;
r = addEntries(store, [
  { entry_id:'e_core', world_id:'world_a', source_id:'src_base', revision_id:'rev_base', source_entry_id:0, title:'世界运行总则', content:'这是核心规则。角色知识不等于世界客观事实。', keys:['核心规则'], constant:true, order:0, content_hash:'h-core' },
  { entry_id:'e_tail', world_id:'world_a', source_id:'src_base', revision_id:'rev_base', source_entry_id:99, title:'遥远尾部设施', content:'前段说明。'.repeat(80) + '终末星港的蓝色检修门只有持有星轨维护证的人可以开启。', keys:['终末星港','星轨维护证'], order:999, content_hash:'h-tail' },
  { entry_id:'e_disabled', world_id:'world_a', source_id:'src_base', revision_id:'rev_base', source_entry_id:100, title:'停用秘密', content:'不应进入索引。', keys:['不应命中'], disabled:true, order:1000, content_hash:'h-disabled' },
], { now:1004 }); store = r.store;
store = setActiveBaselineRevision(store, 'world_a', 'rev_base', { now:1005 });

r = addSource(store, { source_id:'src_ext', world_id:'world_a', format:'titled_txt', content_hash:'src-ext', raw_payload:'x' }, { now:1006 }); store = r.store;
r = addRevision(store, { revision_id:'rev_ext', world_id:'world_a', source_id:'src_ext', revision_label:'addon', revision_kind:'extension', base_revision_id:'rev_base' }, { now:1007 }); store = r.store;
r = addEntries(store, [
  { entry_id:'e_ext', world_id:'world_a', source_id:'src_ext', revision_id:'rev_ext', source_entry_id:'x', title:'扩展交通', content:'月环列车只在夜间跨区运行。', keys:['月环列车'], order:10, content_hash:'h-ext' },
], { now:1008 }); store = r.store;
store = setActiveExtensionRevisions(store, 'world_a', ['rev_ext'], { now:1009 });

const scope = resolveActiveSettingScope(store);
assert.deepEqual(scope.revision_ids, ['rev_base','rev_ext']);

const snapshot = buildSettingIndexSnapshot(store, { maxChars:160 });
assert.equal(snapshot.scope.world_id, 'world_a');
assert.equal(snapshot.collection_id.startsWith('aetheria_v55_setting_'), true);
assert.equal(snapshot.chunks.some(c => c.entry_id === 'e_disabled'), false, 'disabled entries must stay out of active index');
assert.equal(snapshot.chunks.some(c => c.entry_id === 'e_ext'), true, 'active extension must be indexed');
const tailChunks = snapshot.chunks.filter(c => c.entry_id === 'e_tail');
assert.ok(tailChunks.length > 1, 'long entry should be structurally chunked');
assert.ok(tailChunks.every(c => c.retrieval_text.includes('标题: 遥远尾部设施')), 'every child chunk must retain parent title context');
assert.ok(tailChunks.every(c => c.retrieval_text.includes('终末星港')), 'every child chunk must retain parent primary keys');
assert.ok(tailChunks.every(c => c.entry_id === 'e_tail' && c.revision_id === 'rev_base'), 'parent/revision linkage must be retained');

const byKey = lexicalSearchSettingChunks(snapshot.chunks, '我到了终末星港，星轨维护证能开哪扇门？', { topK:5 });
assert.ok(byKey.length > 0);
assert.equal(byKey[0].chunk.entry_id, 'e_tail');
assert.match(byKey[0].chunk.body_text, /终末星港.*蓝色检修门|蓝色检修门/, 'body-specific query terms should rank the answer-bearing child chunk first');

const byExtension = lexicalSearchSettingChunks(snapshot.chunks, '月环列车什么时候跨区？', { topK:3 });
assert.equal(byExtension[0].chunk.entry_id, 'e_ext');

const beforeCollection = snapshot.collection_id;
store = setActiveExtensionRevisions(store, 'world_a', [], { now:1010 });
const snapshotWithoutExtension = buildSettingIndexSnapshot(store, { maxChars:160 });
assert.notEqual(snapshotWithoutExtension.collection_id, beforeCollection, 'active revision scope change must change shared collection id');
assert.notEqual(snapshotWithoutExtension.fingerprint, snapshot.fingerprint);
assert.equal(snapshotWithoutExtension.chunks.some(c => c.entry_id === 'e_ext'), false);

console.log('PASS setting index builds revision-scoped chunks with tail lexical retrieval and stable parent linkage');
