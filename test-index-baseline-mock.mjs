import assert from 'node:assert/strict';

const requests=[];
const prompts=[];
let quietCalls=0;
const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV54:{
      enabled:true,auto_extract:true,extraction_context_messages:2,extraction_structured_output:true,
      extraction_retry_plain_json:true,memory_freshness_wait_ms:0,extraction_notifications:false,parse_ops:true,
      semantic_baseline_gate:true,baseline_use_vector:false,baseline_auto_rebuild:true,
      baseline_include_active_world_info:false,baseline_lexical_threshold:0.70,baseline_similarity_threshold:0.84,
      baseline_semantic_lexical_floor:0.12,baseline_chunk_chars:320,baseline_hint_chars:12000,
      inject_current_state:true,vector_recall:true,vector_source_mode:'inherit',query_messages:2,candidate_top_k:8,
      lexical_candidate_top_k:12,final_recall_count:3,score_threshold:0.22,hybrid_recall:true,lexical_weight:0.9,
      rrf_k:60,graph_diffusion:true,graph_damping:0.18,mmr_lambda:0.78,recall_cooldown_turns:4,
      vector_settle_messages:0,max_memory_context_chars:5000,include_evidence:true,injection_depth:4,
      max_active_items:12,protect_recent_messages:0,auto_rebuild_vectors_on_history_change:true,
      manage_context_window:false,keep_recent_messages:12,debug:false,
    },
    vectors:{source:'transformers'},
  },
  powerUserSettings:{persona_description:'平成拥有位于幸福家园10栋1015室的住宅。平成喜欢植物。'},
  characterId:0,
  characters:[{name:'平成',data:{description:'平成是卢米纳的成年大学生。',personality:'直接、好奇。',scenario:'日常大学生活。'}}],
  chatMetadata:{},
  chat:[
    {name:'用户',mes:'回家以后继续。',is_user:true,is_system:false},
    {name:'平成',mes:'我回到家，把包放在桌边，准备稍微休息一下。',is_user:false,is_system:false},
  ],
  chatId:'baseline-chat',getCurrentChatId:()=> 'baseline-chat',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),
  saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},setExtensionPrompt:(...x)=>prompts.push(x),
  chatCompletionSettings:{},textCompletionSettings:{server_urls:{}},
  generateQuietPrompt:async options=>{
    quietCalls++;
    assert.match(options.quietPrompt,/平成拥有位于幸福家园10栋1015室的住宅/,'real baseline hint should reach extractor');
    return JSON.stringify({
      event_summary:'平成回到家准备休息。',active_state:'平成当前在家。',operations:[
        {op:'add',kind:'ownership',text:'平成拥有位于幸福家园10栋1015室的住宅。',entities:['平成','幸福家园10栋1015室'],topics:['住宅'],status:'active',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true},
        {op:'add',kind:'event',text:'平成回到家后把包放好，准备休息。',entities:['平成'],topics:['回家'],status:'closed',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true},
        {op:'add',kind:'knowledge',text:'平成今天确认了一个原本属于世界设定的重要事实。',entities:['平成'],topics:['新知识'],status:'active',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true}
      ]
    });
  },
};

globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
globalThis.fetch=async (url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body});
  if(url==='/api/vector/insert') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  if(url==='/api/vector/delete') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  if(url==='/api/vector/purge') return {ok:true,status:204,headers:{get:()=> ''},json:async()=>({}),text:async()=>''};
  throw new Error('unexpected fetch '+url);
};

const mod=await import('./index.js?baseline-mock');
const result=await mod.__testExtractMemoryForAssistant(context,1,{force:false});
assert.equal(quietCalls,1);
assert.equal(result.baselineRejections.length,1,'baseline ownership duplicate must be rejected at write-time');
assert.equal(result.baselineRejections[0].op.kind,'ownership');
const store=mod.__testGetStore(context);
assert.equal(Object.values(store.memories).some(m=>m.kind==='ownership'),false,'rejected baseline must never reach Canonical Store');
assert.equal(Object.values(store.memories).some(m=>m.kind==='event'),true,'story event must survive baseline gate');
assert.equal(Object.values(store.memories).some(m=>m.kind==='knowledge'),true,'knowledge acquisition must survive baseline gate');
assert.equal(store.last_extraction_debug.baseline_rejected_count,1);
assert.equal(store.extractions[Object.keys(store.extractions)[0]].baseline_rejections.length,1,'transaction must record rejection for replay/debug');
assert.ok(store.baseline.record_count>0);
assert.ok(store.baseline.fingerprint?.startsWith('baseline54:'));

console.log('PASS v5.4 hard baseline write gate + knowledge/event preservation');
