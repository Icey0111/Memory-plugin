import assert from 'node:assert/strict';

const context = {
  extensionSettings: {},
  chatMetadata: {},
  chat: [],
  chatId: 'setting-import-host-test',
  getCurrentChatId: () => 'setting-import-host-test',
  saveSettingsCalls: 0,
  saveSettingsDebounced() { this.saveSettingsCalls += 1; },
  saveMetadataDebounced() {},
  setExtensionPrompt() {},
  getRequestHeaders: () => ({'Content-Type':'application/json'}),
  chatCompletionSettings: {},
  textCompletionSettings: {server_urls:{}},
};

globalThis.document = { getElementById: () => null };
globalThis.SillyTavern = { getContext: () => context };

const mod = await import('./index.js?setting-import-host');
const preview = await mod.__testPreviewSettingImport(JSON.stringify({entries:{0:{uid:0,comment:'核心',constant:true,content:'# 核心\n内容',key:['核心'],disable:false,order:0,unknown:'keep'}}}), {filename:'world.json'});
const result = await mod.__testCommitSettingImport(context, preview, {world_name:'测试世界',revision_label:'v1',activate:true});
const persisted = mod.__testGetSettingStore(context);
assert.equal(Object.keys(persisted.worlds).length, 1);
assert.equal(Object.keys(persisted.sources).length, 1);
assert.equal(Object.keys(persisted.revisions).length, 1);
assert.equal(Object.keys(persisted.entries).length, 1);
assert.equal(persisted.active_world_id, result.world.world_id);
assert.equal(Object.values(persisted.entries)[0].raw_extra.unknown, 'keep');
assert.ok(context.saveSettingsCalls >= 1, 'commit must persist plugin-owned setting store through extension settings');
console.log('PASS setting importer commits through extension settings host boundary');
