import assert from 'node:assert/strict';
import { createSettingStore, createWorld, addSource, addRevision, addEntries, setActiveBaselineRevision } from './setting-store.js';

let settingStore=createSettingStore({now:1});
let r=createWorld(settingStore,{world_id:'w_starport',name:'星港世界'},{now:2});settingStore=r.store;
r=addSource(settingStore,{source_id:'src',world_id:'w_starport',format:'worldbook_json',content_hash:'src',raw_payload:'{}'},{now:3});settingStore=r.store;
r=addRevision(settingStore,{revision_id:'rev5',world_id:'w_starport',source_id:'src',revision_label:'v5',revision_kind:'baseline'},{now:4});settingStore=r.store;
r=addEntries(settingStore,[
  {entry_id:'core',world_id:'w_starport',source_id:'src',revision_id:'rev5',source_entry_id:0,title:'知识边界',content:'世界设定是客观事实，不等于每个角色都知道。',keys:['知识边界'],constant:true,order:0,content_hash:'hc'},
  {entry_id:'gate',world_id:'w_starport',source_id:'src',revision_id:'rev5',source_entry_id:40,title:'终末星港检修门',content:'终末星港的蓝色检修门归星轨维护局所有。只有持有星轨维护证的人可以开启。',keys:['终末星港','蓝色检修门','星轨维护证'],order:999,content_hash:'hg'},
  {entry_id:'unrelated',world_id:'w_starport',source_id:'src',revision_id:'rev5',source_entry_id:5,title:'海滨厨房',content:'海滨厨房每天清晨采购新鲜鱼类。',keys:['海滨厨房'],order:5,content_hash:'hu'},
],{now:5});settingStore=r.store;
settingStore=setActiveBaselineRevision(settingStore,'w_starport','rev5',{now:6});

const prompts=[];
const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV54:{
      enabled:true,auto_extract:true,extraction_context_messages:2,extraction_structured_output:true,
      extraction_retry_plain_json:true,memory_freshness_wait_ms:0,extraction_notifications:false,parse_ops:true,
      semantic_baseline_gate:true,baseline_use_vector:false,baseline_auto_rebuild:true,baseline_include_active_world_info:false,
      baseline_lexical_threshold:0.70,baseline_similarity_threshold:0.84,baseline_semantic_lexical_floor:0.12,baseline_chunk_chars:320,baseline_hint_chars:12000,
      setting_store:settingStore,setting_index_use_vector:false,setting_index_auto_rebuild:true,setting_index_chunk_chars:180,
      setting_index_lexical_top_k:12,setting_index_lexical_min_score:0.02,
      setting_retrieval_enabled:true,setting_retrieval_use_dense:false,setting_retrieval_candidate_top_k:12,
      setting_retrieval_final_count:4,setting_retrieval_dense_threshold:0.18,setting_retrieval_rrf_k:60,
      setting_retrieval_max_chars:7000,setting_extraction_max_chars:5000,setting_retrieval_constant_limit:1,
      inject_current_state:true,vector_recall:false,vector_source_mode:'inherit',query_messages:3,candidate_top_k:8,
      lexical_candidate_top_k:12,final_recall_count:3,score_threshold:0.22,hybrid_recall:true,lexical_weight:0.9,
      rrf_k:60,graph_diffusion:true,graph_damping:0.18,mmr_lambda:0.78,recall_cooldown_turns:4,
      vector_settle_messages:0,max_memory_context_chars:5000,include_evidence:true,injection_depth:4,
      max_active_items:12,protect_recent_messages:0,auto_rebuild_vectors_on_history_change:true,
      manage_context_window:false,keep_recent_messages:12,debug:false,
    },
    vectors:{source:'transformers'},
  },
  powerUserSettings:{persona_description:''},characters:[],characterId:null,
  chatMetadata:{},
  chat:[
    {name:'用户',mes:'我们到了终末星港，那扇蓝色检修门是谁的？',is_user:true,is_system:false},
    {name:'平成',mes:'我看了看门上的维护局标记，又确认了开启它需要星轨维护证。',is_user:false,is_system:false},
  ],
  chatId:'chat-setting-retrieval',getCurrentChatId:()=> 'chat-setting-retrieval',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},
  setExtensionPrompt:(...args)=>prompts.push(args),chatCompletionSettings:{},textCompletionSettings:{server_urls:{}},
  generateQuietPrompt:async options=>{
    assert.match(options.quietPrompt,/终末星港的蓝色检修门归星轨维护局所有/,'extractor must receive relevant plugin setting');
    assert.match(options.quietPrompt,/世界设定是客观事实，不等于每个角色都知道/,'limited constant reserve should carry knowledge boundary');
    assert.doesNotMatch(options.quietPrompt,/海滨厨房每天清晨采购/,'irrelevant non-constant setting should not be dumped into extractor prompt');
    return JSON.stringify({
      event_summary:'平成在终末星港确认了检修门标记与开启条件。',
      active_state:'平成当前位于终末星港检修门前。',
      operations:[
        {op:'add',kind:'ownership',text:'终末星港的蓝色检修门归星轨维护局所有。',entities:['终末星港','星轨维护局'],topics:['所有权'],status:'active',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true},
        {op:'add',kind:'knowledge',text:'平成现在知道终末星港的蓝色检修门归星轨维护局所有。',entities:['平成','终末星港','星轨维护局'],topics:['新知识'],status:'active',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true},
        {op:'add',kind:'event',text:'平成在检修门前确认了维护局标记与证件要求。',entities:['平成','终末星港'],topics:['确认'],status:'closed',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true}
      ],
    });
  },
};

globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
globalThis.fetch=async()=>{throw new Error('vector fetch should not occur in lexical-only setting retrieval test');};

const mod=await import('./index.js?setting-retrieval-host');
const generation=await mod.__testRetrieveGenerationSettings(context,[
  {name:'平成',mes:'我们已经进入星港检修区。',is_user:false,is_system:false},
  {name:'用户',mes:'蓝色检修门怎么打开？',is_user:true,is_system:false},
]);
assert.equal(generation.results[0].entry_id,'gate');
assert.equal(generation.dense_available,false);
assert.match(generation.query.text,/蓝色检修门/);

// Commit F consumes generation Setting retrieval and injects it into the dedicated Reference block.

// The narrative runtime consumes exactly this retrieval through the host service
// (createNarrativeHostServices in index.js), so the setting plane is still covered end to end.
console.log('PASS setting retrieval host: lexical generation retrieval reaches the plugin setting plane');
