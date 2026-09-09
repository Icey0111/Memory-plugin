import assert from 'node:assert/strict';
import { createSettingStore } from './setting-store.js';
import { validateSettingStore } from './setting-schema.js';
import { commitImport, findDuplicateSources, previewImport } from './setting-importer.js';

const worldbook = {
  entries: {
    '0': {
      uid: 28,
      comment: '🔵 常驻｜世界总则',
      constant: true,
      content: '# 世界总则\n这里是必须保留的核心设定。',
      key: ['世界', '总则'],
      keysecondary: ['核心'],
      disable: false,
      order: 10,
      selectiveLogic: 0,
      customFutureField: { nested: true },
    },
    '1': {
      uid: 99,
      comment: '停用测试',
      content: '这条保留，但默认不参与召回。',
      key: ['停用'],
      constant: false,
      disable: true,
      order: 20,
      probability: 50,
    },
  },
  customRootField: 'preserved through raw source text',
};

const raw = JSON.stringify(worldbook, null, 2);
const preview = await previewImport(raw, { filename:'aetheria-v5.json' });
assert.equal(preview.format, 'worldbook_json');
assert.equal(preview.entries.length, 2);
assert.equal(preview.metadata.constant_count, 1);
assert.equal(preview.metadata.disabled_count, 1);
assert.equal(preview.entries[0].source_entry_id, 28);
assert.equal(preview.entries[0].title, '世界总则');
assert.deepEqual(preview.entries[0].keys, ['世界', '总则']);
assert.deepEqual(preview.entries[0].secondary_keys, ['核心']);
assert.equal(preview.entries[0].constant, true);
assert.equal(preview.entries[1].disabled, true);
assert.deepEqual(preview.entries[0].raw_extra.customFutureField, { nested:true });
assert.equal(preview.entries[0].raw_extra.selectiveLogic, 0);
assert.match(preview.content_hash, /^(sha256|fnv64)-/);
assert.match(preview.entries[0].content_hash, /^(sha256|fnv64)-/);

let store = createSettingStore({ now: 1000 });
const committed = await commitImport(store, preview, {
  world_name:'艾瑟瑞亚', revision_label:'v5', revision_kind:'baseline', activate:true, now:1001,
});
store = committed.store;
assert.equal(committed.entries.length, 2);
assert.equal(committed.world.active_baseline_revision_id, committed.revision.revision_id);
assert.equal(store.active_world_id, committed.world.world_id);
assert.equal(store.sources[committed.source.source_id].raw_payload, raw, 'exact JSON source text must be retained');
assert.equal(Object.values(store.entries).find(row => row.source_entry_id === 28).raw_extra.customFutureField.nested, true);
assert.equal(validateSettingStore(store).ok, true);

const duplicatePreview = await previewImport(raw, { filename:'copy.json', store });
assert.deepEqual(duplicatePreview.duplicate_source_ids, [committed.source.source_id]);
assert.equal(findDuplicateSources(store, preview.content_hash, {world_id:committed.world.world_id}).length, 1);
await assert.rejects(
  () => commitImport(store, duplicatePreview, {world_id:committed.world.world_id, revision_label:'duplicate', now:1002}),
  /Identical source content already exists/,
);

const reused = await commitImport(store, duplicatePreview, {
  world_id: committed.world.world_id,
  revision_label:'v5-copy-revision',
  duplicate_policy:'reuse_source',
  activate:false,
  now:1003,
});
assert.equal(reused.reused_source, true);
assert.equal(reused.source.source_id, committed.source.source_id);
assert.equal(Object.keys(reused.store.sources).length, 1, 'reuse_source must not clone identical source payload');
assert.equal(Object.keys(reused.store.revisions).length, 2);

const titled = await previewImport('# 第一节\nA\n\n## 第二节\nB', {filename:'addon.txt'});
assert.equal(titled.format, 'titled_txt');
assert.equal(titled.entries.length, 2);
assert.equal(titled.entries[0].title, '第一节');
assert.equal(titled.entries[0].content, 'A');
assert.equal(titled.entries[1].title, '第二节');
assert.equal(titled.entries[1].content, 'B');

const withPreamble = await previewImport('前言内容\n\n# 第一节\n正文', {filename:'notes.md'});
assert.equal(withPreamble.entries.length, 2);
assert.match(withPreamble.entries[0].title, /前言/);
assert.equal(withPreamble.entries[0].content, '前言内容');
assert.ok(withPreamble.warnings.some(x => x.includes('before the first heading')));

const untitled = await previewImport('没有任何标题。\n第二段仍应保持在同一个条目。', {filename:'plain.txt'});
assert.equal(untitled.entries.length, 1, 'untitled text must not be heuristically fragmented');
assert.equal(untitled.entries[0].title, 'plain');
assert.match(untitled.entries[0].content, /第二段/);
assert.ok(untitled.warnings.some(x => x.includes('one entry')));

console.log('PASS setting importer preview/commit, unknown-field preservation, duplicate detection, and conservative TXT segmentation');
