import assert from 'node:assert/strict';
import { createSettingStore, createWorld, addSource, addRevision, addEntries, setActiveBaselineRevision } from './setting-store.js';

let store=createSettingStore({now:1000});
let r=createWorld(store,{world_id:'world_g',name:'G World'},{now:1001}); store=r.store;
r=addSource(store,{source_id:'source_g',world_id:'world_g',format:'titled_txt',content_hash:'source-g',raw_payload:'x'},{now:1002}); store=r.store;
r=addRevision(store,{revision_id:'rev_g',world_id:'world_g',source_id:'source_g',revision_label:'v1',revision_kind:'baseline'},{now:1003}); store=r.store;
r=addEntries(store,[
  {entry_id:'e1',world_id:'world_g',source_id:'source_g',revision_id:'rev_g',source_entry_id:1,title:'Gate',content:'The north gate accepts a silver pass.',keys:['north gate','silver pass'],order:1,content_hash:'h1'},
  {entry_id:'e2',world_id:'world_g',source_id:'source_g',revision_id:'rev_g',source_entry_id:2,title:'Law',content:'Private panels require judicial authorization.',keys:['privacy','authorization'],order:2,content_hash:'h2-old'},
],{now:1004}); store=r.store;
store=setActiveBaselineRevision(store,'world_g','rev_g',{now:1005});

const settings={
  enabled:true,
  setting_store:store,
  setting_index_use_vector:true,
  setting_index_auto_rebuild:true,
  setting_index_verify_build:true,
  setting_index_chunk_chars:180,
  setting_index_lexical_top_k:12,
  setting_index_lexical_min_score:0.05,
  vector_source_mode:'inherit',
  debug:false,
};
const context={
  extensionSettings:{aetheriaUnifiedMemoryV54:settings,vectors:{source:'transformers'}},
  chatMetadata:{},chat:[],chatId:'chat-g',getCurrentChatId:()=> 'chat-g',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},
  chatCompletionSettings:{},textCompletionSettings:{server_urls:{}},setExtensionPrompt:()=>{},
};
globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};

const requests=[];
const collections=new Map();
let failVerification=false;
function collectionRows(id){ if(!collections.has(id)) collections.set(id,new Map()); return collections.get(id); }
globalThis.fetch=async (url,options)=>{
  const body=JSON.parse(options.body); requests.push({url,body});
  if(url==='/api/vector/purge') { collections.set(body.collectionId,new Map()); return {ok:true,status:204,headers:{get:()=>''},text:async()=>''}; }
  if(url==='/api/vector/insert') {
    const rows=collectionRows(body.collectionId);
    for(const item of body.items||[]) rows.set(Number(item.hash),structuredClone(item));
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  }
  if(url==='/api/vector/delete') {
    const rows=collectionRows(body.collectionId);
    for(const hash of body.hashes||[]) rows.delete(Number(hash));
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  }
  if(url==='/api/vector/query') {
    if(failVerification) return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({metadata:[]}),text:async()=>''};
    const rows=[...collectionRows(body.collectionId).values()];
    const exact=rows.find(item=>String(item.text)===String(body.searchText));
    const item=exact||rows[0];
    return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({metadata:item?[{hash:item.hash,index:item.index}]:[]}),text:async()=>''};
  }
  throw new Error('unexpected '+url);
};

const mod=await import('./index.js?setting-index-lifecycle-host');
const legacyContext={...context,extensionSettings:{...context.extensionSettings,aetheriaUnifiedMemoryV54:{...settings,setting_index_state:{state_version:1,active_scope_key:'legacy-scope',scopes:{'legacy-scope':{collection_id:'legacy-no-profile',provider_fingerprint:'transformers:old',fingerprint:'old-fp',stale:false}}}}}};
const migratedLegacy=mod.__testGetSettingIndexState(legacyContext);
assert.equal(migratedLegacy.state_version,2);
assert.equal(migratedLegacy.scopes['legacy-scope'].active_collection_id,null,'v1 collection without embedding profile must not be silently trusted as active');
assert.equal(migratedLegacy.scopes['legacy-scope'].legacy_v1.collection_id,'legacy-no-profile','v1 collection metadata should be retained for diagnostics/optional later GC');
const initial=await mod.__testEnsurePluginSettingIndex(context,{force:true,silent:true});
assert.equal(initial.vectorReady,true);
assert.equal(initial.vector_degraded,false);
const collectionA=initial.collection_id;
assert.ok(collectionA);
assert.equal(collections.get(collectionA).size,initial.chunks.length);
const stateA=mod.__testGetSettingIndexState(context);
assert.equal(stateA.state_version,2);
const scopeKey=initial.scope.scope_key;
assert.equal(stateA.scopes[scopeKey].active_collection_id,collectionA);
assert.ok(stateA.scopes[scopeKey].active_profile_hash);

// Same scope + same embedding profile + one changed entry => targeted insert/delete, no purge.
settings.setting_store.entries.e2={
  ...settings.setting_store.entries.e2,
  content:'Private panels require a judicial warrant and logged authorization.',
  content_hash:'h2-new',
};
const beforeIncrement=requests.length;
const incremental=await mod.__testEnsurePluginSettingIndex(context,{force:false,silent:true});
assert.equal(incremental.vectorReady,true);
assert.equal(incremental.collection_id,collectionA,'incremental update must retain the active physical collection');
const incRequests=requests.slice(beforeIncrement);
assert.equal(incRequests.some(r=>r.url==='/api/vector/purge'),false,'single-entry update must never purge the whole active collection');
assert.ok(incRequests.some(r=>r.url==='/api/vector/insert'));
assert.ok(incRequests.some(r=>r.url==='/api/vector/delete'));
const stateAfterIncrement=mod.__testGetSettingIndexState(context).scopes[scopeKey];
const profileAfterIncrement=stateAfterIncrement.profiles[stateAfterIncrement.active_profile_hash];
assert.equal(profileAfterIncrement.last_diff.mode,'incremental');
assert.deepEqual(profileAfterIncrement.last_diff.changed,['e2']);
assert.equal(collections.get(collectionA).size,incremental.chunks.length);

// New embedding profile => build/verify a fresh staging collection, then switch pointer; old remains intact.
context.extensionSettings.vectors.source='openai';
context.extensionSettings.vectors.openai_model='text-embedding-3-small';
const oldSize=collections.get(collectionA).size;
const beforeProfileSwitch=requests.length;
const switched=await mod.__testEnsurePluginSettingIndex(context,{force:false,silent:true});
assert.equal(switched.vectorReady,true);
assert.notEqual(switched.collection_id,collectionA);
const collectionB=switched.collection_id;
const switchRequests=requests.slice(beforeProfileSwitch);
assert.ok(switchRequests.some(r=>r.url==='/api/vector/purge' && r.body.collectionId===collectionB),'only the inactive staging collection may be purged before build');
assert.equal(switchRequests.some(r=>r.url==='/api/vector/purge' && r.body.collectionId===collectionA),false,'previous active collection must not be purged during profile switch');
assert.equal(collections.get(collectionA).size,oldSize,'previous active collection must remain available after atomic switch');
let stateB=mod.__testGetSettingIndexState(context).scopes[scopeKey];
assert.equal(stateB.active_collection_id,collectionB);
assert.ok(stateB.retired_collection_ids.includes(collectionA));

// Failed third profile verification: keep current pointer + collection and degrade to lexical.
context.extensionSettings.vectors.openai_model='text-embedding-3-large';
failVerification=true;
const beforeFailedSwitch=requests.length;
const failed=await mod.__testEnsurePluginSettingIndex(context,{force:false,silent:true});
failVerification=false;
assert.equal(failed.vectorReady,false);
assert.equal(failed.vector_degraded,true);
stateB=mod.__testGetSettingIndexState(context).scopes[scopeKey];
assert.equal(stateB.active_collection_id,collectionB,'failed staging build must not move active pointer');
assert.equal(collections.get(collectionB).size,switched.chunks.length,'failed replacement must leave previous active index untouched');
const failedRequests=requests.slice(beforeFailedSwitch);
assert.equal(failedRequests.some(r=>r.url==='/api/vector/purge' && r.body.collectionId===collectionB),false,'failed replacement must never purge active collection');
assert.match(stateB.last_error,/保留既有索引并降级词法/);

console.log('PASS Commit G host lifecycle: incremental diff, safe profile switch, failed-build preservation, no active purge window');
