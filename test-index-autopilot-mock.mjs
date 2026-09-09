import assert from 'node:assert/strict';

const prompts=[];
const requests=[];
let quietCalls=0;
let extractionMode=1;
const context={
  extensionSettings:{
    aetheriaUnifiedMemoryV53:{
      enabled:true, auto_extract:true, extraction_context_messages:3,
      extraction_structured_output:true, extraction_retry_plain_json:true,
      memory_freshness_wait_ms:0, extraction_notifications:false,
      parse_ops:true, inject_current_state:true, vector_recall:true,
      vector_source_mode:'inherit', query_messages:2, candidate_top_k:12,
      lexical_candidate_top_k:20, final_recall_count:4, score_threshold:0.22,
      hybrid_recall:true, lexical_weight:0.9, rrf_k:60, graph_diffusion:true,
      graph_damping:0.18, mmr_lambda:0.78, recall_cooldown_turns:4,
      vector_settle_messages:0, max_memory_context_chars:5000, include_evidence:true,
      injection_depth:4, max_active_items:12, protect_recent_messages:0,
      auto_rebuild_vectors_on_history_change:true, manage_context_window:false,
      keep_recent_messages:12, debug:false,
    },
    vectors:{source:'transformers'},
  },
  chatMetadata:{},
  chat:[
    {name:'用户',mes:'我今天实验做完了，好饿。',is_user:true,is_system:false},
    {name:'平成',mes:'我把工具收好回到家，肚子已经叫起来了。我打开终端看了看东街的晚饭。',is_user:false,is_system:false},
  ],
  chatId:'autopilot-chat',
  getCurrentChatId:()=> 'autopilot-chat',
  getRequestHeaders:()=>({'Content-Type':'application/json'}),
  setExtensionPrompt:(...args)=>prompts.push(args),
  saveMetadataDebounced:()=>{}, saveSettingsDebounced:()=>{},
  chatCompletionSettings:{}, textCompletionSettings:{server_urls:{}},
  generateQuietPrompt:async (options)=>{
    quietCalls++;
    assert.match(options.quietPrompt,/后台记忆抽取器/);
    assert.ok(options.jsonSchema,'structured extraction should pass JSON schema');
    if (extractionMode===2) return JSON.stringify({
      event_summary:'重新审阅后只保留平成结束实验回家的事件。',
      active_state:'平成目前在家。',
      operations:[
        {op:'add',kind:'event',text:'平成结束当天实验后回到家。',entities:['平成'],topics:['实验结束','回家'],status:'closed',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true}
      ]
    });
    return JSON.stringify({
      event_summary:'平成结束实验后回到家，因为饥饿开始查看东街晚饭选择。',
      active_state:'平成目前在家，感到饥饿，正在考虑晚饭。',
      operations:[
        {op:'add',kind:'state',slot:'平成.state.hunger',text:'平成当前感到饥饿。',entities:['平成'],topics:['饥饿'],status:'active',importance:'low',epistemic:'observed',known_by:['平成'],indexable:false},
        {op:'add',kind:'event',text:'平成结束当天实验后回到家，并因饥饿开始查看东街的晚饭选择。',entities:['平成','东街'],topics:['实验结束','晚饭选择'],status:'closed',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true}
      ]
    });
  },
};

globalThis.document={getElementById:()=>null};
globalThis.SillyTavern={getContext:()=>context};
globalThis.fetch=async (url,options)=>{
  const body=JSON.parse(options.body);
  requests.push({url,body});
  if(url==='/api/vector/insert') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  if(url==='/api/vector/delete') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({}),text:async()=>''};
  if(url==='/api/vector/purge') return {ok:true,status:204,headers:{get:()=> ''},json:async()=>({}),text:async()=>''};
  throw new Error('unexpected fetch '+url);
};

const mod=await import('./index.js?autopilot-mock');
const first=await mod.__testExtractMemoryForAssistant(context,1,{force:false});
assert.equal(first.skipped,undefined);
assert.equal(quietCalls,1);
const store=mod.__testGetStore(context);
assert.equal(Object.keys(store.extractions).length,1);
assert.match(store.last_event_summary,/结束实验/);
assert.match(store.last_active_state,/饥饿/);
assert.equal(store.slots['平成.state.hunger'] !== undefined,true);
assert.equal(Object.values(store.memories).some(m=>m.kind==='event' && m.indexable===true),true);
assert.equal(requests.some(r=>r.url==='/api/vector/insert'),true,'indexable memory should vectorize immediately');
const insert=requests.find(r=>r.url==='/api/vector/insert');
assert.equal(insert.body.items.length,1);
assert.match(insert.body.items[0].text,/平成/);

// Same finalized assistant reply must not run a second LLM extraction.
const second=await mod.__testExtractMemoryForAssistant(context,1,{force:false});
assert.equal(second.skipped,'already-extracted');
assert.equal(quietCalls,1);

// Forced manual re-extraction replaces the transaction instead of leaving memories from the old extraction.
extractionMode=2;
const replaced=await mod.__testExtractMemoryForAssistant(context,1,{force:true});
assert.equal(replaced.record.generation_mode,'structured');
assert.equal(quietCalls,2);
const replacedStore=mod.__testGetStore(context);
assert.equal(replacedStore.slots['平成.state.hunger'],undefined,'old extracted hunger state must not survive forced replacement');
assert.match(replacedStore.last_event_summary,/重新审阅/);
assert.equal(requests.some(r=>r.url==='/api/vector/purge'),true,'forced transaction replacement should safely rebuild vectors');

// Legacy inline-memory assistant replies should be replayed, not autonomously re-extracted.
context.chat.push({name:'用户',mes:'继续。',is_user:true,is_system:false});
context.chat.push({name:'平成',mes:'旧版正文。<memory_ops version="5">{"op":"noop","reason":"legacy"}</memory_ops>',is_user:false,is_system:false});
const legacy=await mod.__testExtractMemoryForAssistant(context,3,{force:false});
assert.equal(legacy.skipped,'legacy-inline-ops');
assert.equal(quietCalls,2);

console.log('PASS v5.4 autonomous after-AI extraction + immediate vector sync + dedupe/migration guard');
