import assert from 'node:assert/strict';
import { createWorld } from './setting-store.js';

let saves = 0;
const context = {
  extensionSettings:{aetheriaUnifiedMemoryV54:{enabled:true}},
  chatMetadata:{}, chat:[], chatId:'chat-a', getCurrentChatId:()=> 'chat-a',
  saveSettingsDebounced:()=>{saves++;}, saveMetadataDebounced:()=>{},
  eventSource:{on:()=>{}}, eventTypes:{},
};
globalThis.SillyTavern={getContext:()=>context};
globalThis.document={getElementById:()=>null};

const mod=await import('./index.js?setting-store-host');
const first=mod.__testGetSettingStore(context);
assert.equal(first.schema_version,1);
assert.equal(saves,1,'first access should persist the new empty store once');
assert.equal(context.chatMetadata.setting_store,undefined,'setting library must not live in per-chat metadata');

let result=createWorld(first,{world_id:'world_shared',name:'Shared World'},{now:123});
mod.__testSetSettingStore(context,result.store);
assert.equal(saves,2);
assert.ok(context.extensionSettings.aetheriaUnifiedMemoryV54.setting_store.worlds.world_shared);

// Simulate switching chats while keeping the same extension settings object.
context.chatId='chat-b';
context.chatMetadata={};
const second=mod.__testGetSettingStore(context);
assert.ok(second.worlds.world_shared,'world setting data must be shared across chats');
assert.equal(saves,2,'already normalized v1 store should not schedule another migration save');

console.log('PASS v5.5 Setting Store persists in extension settings and is shared across chats');
