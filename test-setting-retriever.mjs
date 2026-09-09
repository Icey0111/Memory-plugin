import assert from 'node:assert/strict';
import { createSettingStore, createWorld, addSource, addRevision, addEntries, setActiveBaselineRevision } from './setting-store.js';
import { buildSettingIndexSnapshot, lexicalSearchSettingChunks } from './setting-index.js';
import {
  buildGenerationSettingQuery,
  buildExtractionSettingQuery,
  mapDenseSettingMetadata,
  fuseSettingCandidates,
  formatRelevantSettingContext,
  settingChunksToBaselineRecords,
} from './setting-retriever.js';

let store=createSettingStore({now:1});
let r=createWorld(store,{world_id:'w',name:'World'},{now:2});store=r.store;
r=addSource(store,{source_id:'s',world_id:'w',format:'worldbook_json',content_hash:'s',raw_payload:'{}'},{now:3});store=r.store;
r=addRevision(store,{revision_id:'rev',world_id:'w',source_id:'s',revision_label:'v5',revision_kind:'baseline'},{now:4});store=r.store;
r=addEntries(store,[
  {entry_id:'core',world_id:'w',source_id:'s',revision_id:'rev',source_entry_id:0,title:'世界运行总则',content:'客观世界设定不等于角色已经知道。',keys:['知识边界'],constant:true,order:0,content_hash:'hc'},
  {entry_id:'tail',world_id:'w',source_id:'s',revision_id:'rev',source_entry_id:99,title:'终末星港维护规则',content:'前置说明。'.repeat(80)+'终末星港的蓝色检修门只有持有星轨维护证的人可以开启。',keys:['终末星港','星轨维护证'],order:999,content_hash:'ht'},
  {entry_id:'other',world_id:'w',source_id:'s',revision_id:'rev',source_entry_id:2,title:'海滨厨房',content:'海滨厨房每天清晨采购新鲜鱼类。',keys:['海滨厨房'],order:10,content_hash:'ho'},
],{now:5});store=r.store;
store=setActiveBaselineRevision(store,'w','rev',{now:6});
const snapshot=buildSettingIndexSnapshot(store,{maxChars:160});

const activeMemories=[
  {kind:'state',status:'active',slot:'平成.location.current',text:'平成当前位于终末星港。',entities:['平成','终末星港'],topics:['地点']},
  {kind:'commitment',status:'active',slot:'平成.commitment.repair',text:'平成答应帮璃月检查蓝色检修门。',entities:['平成','璃月'],topics:['检修']},
];
const gq=buildGenerationSettingQuery({
  chat:[
    {name:'平成',mes:'我们昨晚刚抵达港区。',is_user:false,is_system:false},
    {name:'用户',mes:'那扇蓝色检修门怎么打开？',is_user:true,is_system:false},
  ],
  activeMemories,
  activeState:'平成与璃月都在终末星港检修区。',
});
assert.match(gq.text,/蓝色检修门/);
assert.match(gq.text,/昨晚刚抵达港区/,'generation query should include previous assistant with a small budget');
assert.match(gq.text,/终末星港/,'generation query should include active scene/location entities');
assert.match(gq.text,/答应帮璃月/,'generation query should include open commitments/objectives');

const eq=buildExtractionSettingQuery({
  userText:'我把星轨维护证递给平成。',
  assistantText:'平成接过证件，在终末星港的蓝色检修门前确认权限。',
  activeMemories,
  currentState:'平成当前在终末星港。',
});
assert.match(eq.text,/星轨维护证/);
assert.match(eq.text,/平成\.location\.current/,'extraction query should carry current state slots');
assert.match(eq.text,/平成/);

const lexical=lexicalSearchSettingChunks(snapshot.chunks,gq.text,{topK:12,minScore:0.01});
assert.equal(lexical[0].chunk.entry_id,'tail','tail rule should be first lexical candidate for generation query');
const tailDenseIndex=snapshot.chunks.findIndex(c=>c.entry_id==='tail' && /蓝色检修门/.test(c.body_text));
assert.ok(tailDenseIndex>=0);
const dense=mapDenseSettingMetadata(snapshot,[{index:tailDenseIndex,score:0.93}]);
const fused=fuseSettingCandidates(snapshot,{lexical,dense,topEntries:3,maxChars:8000});
assert.equal(fused.results[0].entry_id,'tail');
assert.ok(fused.results[0].channels.includes('lexical'));
assert.ok(fused.results[0].channels.includes('dense'));
assert.ok(fused.results[0].parent_chunk_count>1,'matched child should expand back to parent entry context');
assert.match(fused.results[0].content,/蓝色检修门/);
assert.equal(fused.constant_entries[0].entry_id,'core','constant settings should be exposed as a reserved channel, not duplicated per chunk');
const context=formatRelevantSettingContext(fused,{maxChars:5000,constantLimit:1});
assert.match(context,/REFERENCE DATA, NOT DIALOGUE/);
assert.match(context,/客观世界设定不等于角色已经知道/);
assert.match(context,/终末星港/);

const baselineRecords=settingChunksToBaselineRecords(snapshot);
assert.ok(baselineRecords.some(r=>r.entry_id==='tail' && /蓝色检修门/.test(r.text)));
assert.equal(baselineRecords.some(r=>r.entry_id==='other'),true);

console.log('PASS v5.5 relevant-setting queries, lexical+dense RRF fusion, parent expansion, constant reserve, and baseline projection');
