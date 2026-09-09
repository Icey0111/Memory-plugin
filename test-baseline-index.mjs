import assert from 'node:assert/strict';
import {
  buildBaselineRecords,
  computeBaselineFingerprint,
  evaluateBaselineDuplicate,
  isBaselineGateEligible,
} from './baseline-index.js';
import { collectSemanticBaselineSources } from './baseline-host.js';

const sources=[
  {source_type:'persona',source_id:'p',title:'Persona',text:'平成居住在幸福家园10栋1015室。平成喜欢植物，也喜欢研究魔导机械。'},
  {source_type:'world_info',source_id:'w',title:'世界书',text:'A网络是艾瑟瑞亚世界中的客观规则体系。'},
];
const records=buildBaselineRecords(sources,{maxChars:220});
assert.ok(records.length>=2);
assert.equal(computeBaselineFingerprint(records),computeBaselineFingerprint(buildBaselineRecords(sources,{maxChars:220})),'fingerprint must be deterministic');
const changed=buildBaselineRecords([{...sources[0],text:sources[0].text+' 平成后来增加了新设定。'},sources[1]],{maxChars:220});
assert.notEqual(computeBaselineFingerprint(records),computeBaselineFingerprint(changed),'source change must change fingerprint');

const duplicate={op:'add',kind:'ownership',text:'平成居住在幸福家园10栋1015室。',status:'active',indexable:true};
assert.equal(isBaselineGateEligible(duplicate),true);
const dupDecision=evaluateBaselineDuplicate(duplicate,records,{lexicalThreshold:0.70});
assert.equal(dupDecision.blocked,true,'exact/canonical baseline duplicate should be blocked');

const knowledge={op:'add',kind:'knowledge',text:'平成今天首次确认A网络的某项秘密规则。',status:'active',indexable:true};
assert.equal(isBaselineGateEligible(knowledge),false,'knowledge acquisition is a story delta, not a baseline duplicate');
assert.equal(evaluateBaselineDuplicate(knowledge,records).blocked,false);

const delta={op:'add',kind:'world_delta',text:'平成已经搬离幸福家园10栋1015室。',status:'active',indexable:true};
assert.equal(isBaselineGateEligible(delta),false,'explicit world/story change must survive baseline gate');

const dynamic={op:'add',kind:'state',slot:'平成.state.hunger',text:'平成当前感到饥饿。',status:'active',indexable:false};
assert.equal(isBaselineGateEligible(dynamic),false,'dynamic current state must not be baseline-filtered');

const plantRecord=records.find(r=>r.text.includes('植物'));
const paraphrase={op:'add',kind:'state',text:'平成长期爱好照料盆栽植物。',topics:['植物'],status:'active',indexable:true};
const semantic=evaluateBaselineDuplicate(paraphrase,records,{
  lexicalThreshold:0.99,
  semanticThreshold:0.84,
  semanticLexicalFloor:0.10,
  semanticMatches:[{record:plantRecord,score:0.91}],
});
assert.equal(semantic.blocked,true,'high semantic match + lexical anchor should block paraphrased baseline duplication');

// Host source scoping: only explicitly bound Persona/character/chat books + active WI are loaded.
const loaded=[];
const ctx={
  powerUserSettings:{persona_description:'Persona内容',persona_description_lorebook:'PersonaBook'},
  characterId:0,
  characters:[{name:'平成',data:{description:'角色描述',personality:'角色性格',scenario:'角色场景',extensions:{world:'CharBook'},character_book:{entries:{0:{uid:0,content:'内嵌世界书条目',disable:false}}}}}],
  chatMetadata:{world_info:'ChatBook'},
  chat:[],maxContext:8192,
  loadWorldInfo:async name=>{loaded.push(name);return {entries:{0:{uid:0,content:`${name}内容`,disable:false}}};},
  getWorldInfoNames:()=>['PersonaBook','CharBook','ChatBook','UnrelatedAccountBook'],
  getWorldInfoPrompt:async()=>({worldInfoBefore:'当前激活全局条目',worldInfoAfter:''}),
};
const hostSources=await collectSemanticBaselineSources(ctx,{includeActiveWorldInfo:true});
assert.deepEqual([...new Set(loaded)].sort(),['CharBook','ChatBook','PersonaBook'].sort(),'collector must not enumerate unrelated account lorebooks');
assert.ok(hostSources.some(s=>s.source_type==='active_world_info'));
assert.ok(hostSources.some(s=>s.source_type==='character_worldbook'));
assert.ok(hostSources.some(s=>s.source_type==='persona_worldbook'));
assert.ok(hostSources.some(s=>s.source_type==='chat_worldbook'));

const groupSources=await collectSemanticBaselineSources({
  powerUserSettings:{persona_description:''}, groupId:'g1', groups:[{id:'g1',members:['alice.png']}],
  characters:[{name:'Alice',avatar:'alice.png',description:'Alice角色基线'}], chatMetadata:{}, chat:[],
},{includeActiveWorldInfo:false});
assert.ok(groupSources.some(s=>s.text.includes('Alice角色基线')),'group context should collect known member card without crashing');

console.log('PASS v5.4 semantic baseline pure index + conservative host source scoping');
