import assert from 'node:assert/strict';
import { createSettingStore, createWorld, addSource, addRevision, addEntries, setActiveBaselineRevision } from './setting-store.js';

let store = createSettingStore({ now: 2000 });
let r = createWorld(store, { world_id:'shared_world', name:'共享世界' }, { now:2001 }); store = r.store;
r = addSource(store, { source_id:'shared_source', world_id:'shared_world', format:'titled_txt', content_hash:'source-hash', raw_payload:'x' }, { now:2002 }); store = r.store;
r = addRevision(store, { revision_id:'shared_rev', world_id:'shared_world', source_id:'shared_source', revision_label:'v1', revision_kind:'baseline' }, { now:2003 }); store = r.store;
r = addEntries(store, [
  { entry_id:'shared_entry', world_id:'shared_world', source_id:'shared_source', revision_id:'shared_rev', source_entry_id:1, title:'边境门禁', content:'北方边境门只接受银色通行证。', keys:['北方边境门','银色通行证'], order:1, content_hash:'entry-hash' },
], { now:2004 }); store = r.store;
store = setActiveBaselineRevision(store, 'shared_world', 'shared_rev', { now:2005 });

const sharedExtensionSettings = {
  aetheriaUnifiedMemoryV54: {
    enabled:true,
    setting_store: store,
    setting_index_use_vector:true,
    setting_index_auto_rebuild:true,
    setting_index_chunk_chars:180,
    setting_index_lexical_top_k:12,
    setting_index_lexical_min_score:0.05,
    vector_source_mode:'inherit',
    debug:false,
  },
  vectors:{ source:'transformers' },
};
function makeContext(chatId) {
  return {
    extensionSettings: sharedExtensionSettings,
    chatMetadata:{}, chat:[], chatId, getCurrentChatId:()=>chatId,
    getRequestHeaders:()=>({'Content-Type':'application/json'}),
    saveSettingsDebounced:()=>{}, saveMetadataDebounced:()=>{},
    chatCompletionSettings:{}, textCompletionSettings:{server_urls:{}},
    setExtensionPrompt:()=>{},
  };
}
const ctxA=makeContext('chat-A');
const ctxB=makeContext('chat-B');
let current=ctxA;
globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>current};
const requests=[];
const insertedByCollection=new Map();
globalThis.fetch=async (url,options)=>{
  const body=JSON.parse(options.body); requests.push({url,body});
  if(url==='/api/vector/purge') { insertedByCollection.set(body.collectionId,[]); return {ok:true,status:204,headers:{get:()=>''},text:async()=>''}; }
  if(url==='/api/vector/insert') {
    const rows=insertedByCollection.get(body.collectionId)||[]; rows.push(...(body.items||[])); insertedByCollection.set(body.collectionId,rows);
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  }
  if(url==='/api/vector/query') {
    const row=(insertedByCollection.get(body.collectionId)||[])[0];
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({metadata:row?[{hash:row.hash,index:row.index}]:[]}),text:async()=>''};
  }
  if(url==='/api/vector/delete') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  throw new Error(`unexpected ${url}`);
};

const mod=await import('./index.js?setting-index-host');
const first=await mod.__testEnsurePluginSettingIndex(ctxA,{force:true,silent:true});
assert.equal(first.lexicalReady,true);
assert.equal(first.vectorReady,true);
assert.ok(first.collection_id.startsWith('aetheria_v55_setting_'));
assert.ok(!first.collection_id.includes('chat-A'));
assert.ok(requests.some(r=>r.url==='/api/vector/purge' && r.body.collectionId===first.collection_id));
assert.ok(requests.some(r=>r.url==='/api/vector/insert' && r.body.collectionId===first.collection_id));
const afterFirst=requests.length;

current=ctxB;
const second=await mod.__testEnsurePluginSettingIndex(ctxB,{force:false,silent:true});
assert.equal(second.collection_id,first.collection_id,'same world+revision scope must share collection across chats');
assert.equal(second.vectorReady,true);
assert.equal(requests.length,afterFirst,'second chat must reuse already-synced global Setting Index instead of rebuilding');
assert.equal(ctxA.chatMetadata.aetheriaUnifiedMemoryV54,undefined,'Setting Index metadata must not be stored in chat metadata');
assert.ok(sharedExtensionSettings.aetheriaUnifiedMemoryV54.setting_index_state.scopes[first.scope.scope_key]);

const lexical=mod.__testSearchPluginSettingsLexical(ctxB,'北方边境门要什么通行证？');
assert.equal(lexical.results[0].chunk.entry_id,'shared_entry');

sharedExtensionSettings.aetheriaUnifiedMemoryV54.setting_index_use_vector=false;
const beforeDisabled=requests.length;
const disabled=await mod.__testEnsurePluginSettingIndex(ctxB,{force:false,silent:true});
assert.equal(disabled.vectorReady,false);
assert.equal(disabled.lexicalReady,true);
assert.equal(requests.length,beforeDisabled);
sharedExtensionSettings.aetheriaUnifiedMemoryV54.setting_index_use_vector=true;
const reenabled=await mod.__testEnsurePluginSettingIndex(ctxB,{force:false,silent:true});
assert.equal(reenabled.vectorReady,true,'re-enabling vector projection after lexical-only mode must rebuild it');
assert.equal(requests.length,beforeDisabled,'re-enabling should reuse the still-valid profile collection without rebuilding');

sharedExtensionSettings.vectors.source='webllm';
const beforeFallback=requests.length;
const fallback=await mod.__testEnsurePluginSettingIndex(ctxB,{force:false,silent:true});
assert.equal(fallback.lexicalReady,true,'local lexical setting index must survive unavailable embedding provider');
assert.equal(fallback.vectorReady,false);
assert.equal(requests.length,beforeFallback,'unsupported client embedding source must not attempt server vector calls');
assert.match(fallback.state.last_error,/词法索引/);

console.log('PASS plugin Setting Index is world/revision shared across chats with lexical fallback');
