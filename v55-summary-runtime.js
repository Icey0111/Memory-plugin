// Aetheria v5.5 Iteration 10 — hierarchical summary runtime.
// Summary generation is asynchronous; injection is unified into Reference by v55-consistency.
import { deriveActorIdentity } from './v55-runtime.js';
import { filterSummaryTreeForActor } from './v55-privacy.js';
import { recordModelCall } from './v55-metrics.js';
import { isDialogueRow } from './memory-core.js';
import { floorFoldStatus, foldSummarizedFloors, unfoldAllFloors } from './v55-floor-fold.js';

const SETTINGS_KEY='aetheriaUnifiedMemoryV54';
const METADATA_KEY='aetheriaUnifiedMemoryV54';
const SUMMARY_KEY='aetheria_unified_memory_v5_5_hierarchical_summary';
// summary_level1_every_turns defaults to 10: one Level-1 summary per ten completed floors, which is
// also the granularity at which floors are folded out of the hot prompt. summary_max_tokens is 2048
// because a reasoning model bills its hidden reasoning against the same budget and 600 truncated the
// visible summary mid-sentence in a live session. summary_source_max_chars bounds the summarizer
// input so a ten-floor batch cannot overflow the context window.
const DEFAULTS={hierarchical_summary_enabled:true,summary_provider_mode:'current',summary_connection_profile_id:'',summary_max_tokens:2048,summary_level1_every_turns:10,summary_level2_every_l1:3,summary_level3_every_l2:3,summary_injection_depth:4,summary_max_context_chars:9000,summary_auto_rebuild_on_history_change:true,summary_fold_hidden_floors:true,summary_fold_keep_recent_floors:1,summary_source_max_chars:24000};
let installed=false,queue=Promise.resolve(),timer=null,sharedPromise=null;
const getContext=()=>globalThis.SillyTavern?.getContext?.();
const clean=(v,max=100000)=>String(v??'').replace(/\r\n?/g,'\n').replace(/\u0000/g,'').trim().slice(0,max);
function hash(v){let h=0x811c9dc5;for(const c of String(v??'')){h^=c.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
// A failed host generation comes back as a short error string, not as an exception: SillyTavern
// returns "[API 错误]\nToo many requests: ... status 429 ..." and the quiet-prompt call resolves with it.
// Accepting that as a summary stored the provider's error text in the tree and permanently marked the
// batch as summarized, so the floor was folded with an error message standing in for it. A summary is
// never this short and never starts with the host's error marker.
function looksLikeProviderError(value){
    const text=String(value??'').trim();
    if(!text)return false;
    if(/^\[(?:API\s*(?:错误|error)|error|错误|aetheria\b[^\]]*)\]/i.test(text))return true;
    if(text.length>800)return false;
    return /(?:status|http)\s*[45]\d{2}\b/i.test(text)
        || /quota exhausted|too many requests|rate limit|invalid api key|insufficient quota|unauthorized|forbidden|timed out/i.test(text)
        || /配额|频率限制|请求过于频繁|请求失败|未授权|拒绝访问|接口超时/i.test(text);
}
function count(v,fallback,zero=false){const n=Math.floor(Number(v));return Number.isFinite(n)?Math.max(zero?0:1,Math.min(100,n)):fallback;}
export function normalizeSummaryInjectionDepth(v,fallback=4){if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return Math.max(0,Math.floor(Number(fallback)||0));const n=Number(v);return Number.isFinite(n)&&n>=0?Math.floor(n):Math.max(0,Math.floor(Number(fallback)||0));}
function settings(ctx){if(!ctx?.extensionSettings)return null;const root=ctx.extensionSettings[SETTINGS_KEY]??(ctx.extensionSettings[SETTINGS_KEY]={});for(const[k,v]of Object.entries(DEFAULTS))if(root[k]===undefined)root[k]=v;return root;}
function tree(ctx){if(!ctx?.chatMetadata)return null;const store=ctx.chatMetadata[METADATA_KEY]??(ctx.chatMetadata[METADATA_KEY]={});const t=store.hierarchical_summaries??(store.hierarchical_summaries={version:3,processed_turn_ids:[],consumed_l1_ids:[],consumed_l2_ids:[],level1:[],level2:[],level3:[],dirty:false,last_run_at:null,last_error:null,visibility_debug:null});t.version=3;for(const k of['processed_turn_ids','consumed_l1_ids','consumed_l2_ids','level1','level2','level3'])if(!Array.isArray(t[k]))t[k]=[];return t;}
function reset(t){Object.assign(t,{version:3,processed_turn_ids:[],consumed_l1_ids:[],consumed_l2_ids:[],level1:[],level2:[],level3:[],dirty:false,last_run_at:null,last_error:null,visibility_debug:null});}
export function collectCompletedDialogueTurns(chatInput){const chat=Array.isArray(chatInput)?chatInput:[],out=[];let users=[];for(let i=0;i<chat.length;i++){const r=chat[i];if(!r||!isDialogueRow(r)||!clean(r.mes))continue;if(r.is_user){users.push(clean(r.mes,12000));continue;}const text=`${users.length?`用户：${clean(users.join('\n'),16000)}\n`:''}助手：${clean(r.mes,16000)}`;users=[];const fp=hash(text).toString(36);out.push({id:`turn_${i}_${fp}`,assistant_index:i,fingerprint:fp,text});}return out;}
function prompt(level,rows,s){const budget=Math.max(2000,Math.min(200000,Number(s?.summary_source_max_chars)||24000)),per=Math.max(400,Math.floor(budget/Math.max(1,rows.length)));const src=rows.map((r,i)=>`【${i+1}】${String(r.text??'').slice(0,per)}`).join('\n\n').slice(0,budget);if(level===1)return`你是长期叙事记忆系统的一级总结器。只保留未来连续性需要的事实、状态变化、关系变化、承诺/计划、物品地点变化和明确新信息。不要续写或创造事实。输出简洁中文，不要标题。\n\n${src}`;if(level===2)return`把下面一级摘要去重聚合成阶段摘要，保留顺序、因果、未解决事项和状态变化，不得创造事实。输出简洁中文，不要标题。\n\n${src}`;return`把下面阶段摘要压缩成长期剧情骨架，只保留关键人物、关系、重大事件、长期目标、持续状态和未解决冲突，不得创造事实。\n\n${src}`;}
async function shared(){if(!sharedPromise)sharedPromise=import('/scripts/extensions/shared.js').catch(()=>null);return sharedPromise;}
async function callModel(ctx,level,rows){const s=settings(ctx);if(!s||s.enabled===false||!s.hierarchical_summary_enabled)throw new Error('Aetheria 已关闭，取消后台总结。');const p=prompt(level,rows,s),max=Math.max(128,Math.min(4096,Number(s.summary_max_tokens)||600));if(s.summary_provider_mode==='connection_profile'){if(!s.summary_connection_profile_id)throw new Error('尚未选择独立总结 Connection Profile。');const svc=(await shared())?.ConnectionManagerRequestService;if(!svc)throw new Error('当前宿主未提供 Connection Manager Request Service。');const messages=[{role:'system',content:'只做忠实的长期叙事记忆压缩。不得续写，不得创造新事实。'},{role:'user',content:p}];const result=await svc.sendRequest(s.summary_connection_profile_id,svc.constructPrompt(messages,s.summary_connection_profile_id),max,{stream:false,extractData:true,includePreset:true,includeInstruct:true},{temperature:0.2});const raw=typeof result==='string'?result:result?.content;const out=clean(typeof raw==='string'?raw:'',30000);if(!out)throw new Error('独立总结接口返回空结果。');if(looksLikeProviderError(out))throw new Error(`总结接口返回错误而不是摘要：${out.slice(0,140)}`);recordModelCall(ctx,{kind:'summary',promptChars:String(p||'').length,completionChars:out.length});return out;}if(typeof ctx.generateQuietPrompt!=='function')throw new Error('当前 Context 未提供 generateQuietPrompt。');s.__quiet_extraction_in_progress=true;s.__hierarchical_summary_in_progress=true;refreshSummaryPrompt(ctx);try{const result=await ctx.generateQuietPrompt({quietPrompt:p});const out=clean(typeof result==='string'?result:result?.content,30000);if(!out)throw new Error('当前主 API 返回空总结。');if(looksLikeProviderError(out))throw new Error(`主 API 返回错误而不是摘要：${out.slice(0,140)}`);recordModelCall(ctx,{kind:'summary',promptChars:String(p||'').length,completionChars:out.length});return out;}finally{delete s.__hierarchical_summary_in_progress;delete s.__quiet_extraction_in_progress;refreshSummaryPrompt(ctx);}}
function push(t,level,source_ids,text){const id=`summary_l${level}_${hash(`${source_ids.join('|')}|${text}`).toString(36)}`;const row={id,level,source_ids:[...source_ids],text:clean(text,30000),created_at:Date.now()};t[`level${level}`].push(row);return row;}
export async function processSummaryHierarchy(ctxInput=getContext()){
    const ctx=ctxInput,s=settings(ctx);
    if(!ctx||!s||s.enabled===false||!s.hierarchical_summary_enabled)return{skipped:'disabled'};
    if(s.__hierarchical_summary_in_progress||s.__quiet_extraction_in_progress)return{skipped:'quiet-in-progress'};
    const first=tree(ctx);
    if(!first)return{skipped:'no-store'};
    if(first.dirty)return{skipped:'history-dirty'};
    const l1=count(s.summary_level1_every_turns,1),l2=count(s.summary_level2_every_l1,3,true),l3=count(s.summary_level3_every_l2,3,true);
    let created=0;
    // Every mutation re-reads the tree out of chat metadata instead of holding the reference it read
    // before the model call. A Canonical replay replaces the whole store object, and a summary tree
    // captured across that await receives every subsequent batch while the store that actually reaches
    // disk keeps an empty one — which is exactly how a fully summarized chat came back with l1=0.
    for(;;){
        if(s.enabled===false)return{skipped:'disabled-mid-run',created};
        const t=tree(ctx);
        if(!t)break;
        const processed=new Set(t.processed_turn_ids);
        const pending=collectCompletedDialogueTurns(ctx.chat||[]).filter(x=>!processed.has(x.id));
        if(pending.length<l1)break;
        const batch=pending.slice(0,l1);
        const text=await callModel(ctx,1,batch);
        const live=tree(ctx);
        push(live,1,batch.map(x=>x.id),text);
        live.processed_turn_ids.push(...batch.map(x=>x.id));
        created+=1;
    }
    for(const[level,need,source,consumedKey]of[[2,l2,'level1','consumed_l1_ids'],[3,l3,'level2','consumed_l2_ids']]){
        if(!need)continue;
        for(;;){
            if(s.enabled===false)return{skipped:'disabled-mid-run',created};
            const t=tree(ctx);
            if(!t)break;
            const consumed=new Set(t[consumedKey]);
            const available=t[source].filter(x=>!consumed.has(x.id));
            if(available.length<need)break;
            const batch=available.slice(0,need);
            const text=await callModel(ctx,level,batch);
            const live=tree(ctx);
            push(live,level,batch.map(x=>x.id),text);
            live[consumedKey].push(...batch.map(x=>x.id));
            created+=1;
        }
    }
    const finalTree=tree(ctx)||first;
    finalTree.last_run_at=Date.now();
    finalTree.last_error=null;
    ctx.saveMetadataDebounced?.();
    refreshSummaryPrompt(ctx);
    let fold=null;
    try{fold=foldSummarizedFloors(ctx);}catch(e){finalTree.last_error=String(e?.message||e);}
    render(ctx);
    return{created,level1:finalTree.level1.length,level2:finalTree.level2.length,level3:finalTree.level3.length,fold};
}
// A folded floor is gone from the raw prompt, so the summary tree is the only thing still carrying it.
// The previous shape injected three or five newest items per level and dropped every item a higher
// level had consumed, which on a forty-floor chat with a two-item cadence collapsed the whole
// injection to a single skeleton paragraph. Each level now gets a share of the sub-budget and is
// filled newest-first, and while floors are folded the lower levels stay in even after a higher
// level consumed them — they are load-bearing, not duplicates.
function format(t,v,max,opts={}){
    const folding=opts.folding===true;
    const c1=new Set(t.consumed_l1_ids),c2=new Set(t.consumed_l2_ids);
    const pick=(rows,share)=>{const out=[];let used=0;for(let i=rows.length-1;i>=0;i--){const text=String(rows[i]?.text??'');const cost=text.length+3;if(used+cost>share&&out.length)break;out.unshift(`- ${text}`);used+=cost;}return out;};
    const share=ratio=>Math.max(200,Math.floor(max*ratio));
    const l3=pick(v.level3,share(0.24));
    const l2=pick(folding?v.level2:v.level2.filter(x=>!c2.has(x.id)),share(0.26));
    const l1=pick(folding?v.level1:v.level1.filter(x=>!c1.has(x.id)),share(0.42));
    const blocks=[];
    if(l3.length)blocks.push(`[三级长期摘要]\n${l3.join('\n')}`);
    if(l2.length)blocks.push(`[二级阶段摘要]\n${l2.join('\n')}`);
    if(l1.length)blocks.push(`[一级近期摘要]\n${l1.join('\n')}`);
    const text=blocks.join('\n\n');
    return text.length>max?text.slice(-max):text;
}
export function getHierarchicalSummaryContext(ctxInput=getContext(),opts={}){const ctx=ctxInput,s=settings(ctx),t=tree(ctx),store=ctx?.chatMetadata?.[METADATA_KEY]||{};if(!ctx||!s||!t||s.enabled===false||!s.hierarchical_summary_enabled||t.dirty)return'';const max=Math.max(0,Math.min(20000,Number(opts.maxChars??s.summary_max_context_chars)||0));if(!max)return'';const actor=opts.actor||deriveActorIdentity(ctx,store),v=filterSummaryTreeForActor(t,store,actor);t.visibility_debug={actor_ids:[...(actor?.ids||[])],hidden_summary_ids:v.hidden_summary_ids,unsafe_turn_indexes:v.unsafe_turn_indexes,at:Date.now()};const body=format(t,v,max,{folding:s.summary_fold_hidden_floors===true});return body?`[AETHERIA 分层剧情摘要 — 派生记忆，已按当前角色可见性过滤]\n${body}`:'';}
export function refreshSummaryPrompt(ctxInput=getContext()){const ctx=ctxInput,s=settings(ctx);if(!ctx?.setExtensionPrompt||!s)return false;ctx.setExtensionPrompt(SUMMARY_KEY,'',1,normalizeSummaryInjectionDepth(s.summary_injection_depth,4),false,0);return true;}
function render(ctx){if(typeof document==='undefined')return;const root=document.getElementById('aum-v55-summary-settings'),s=settings(ctx),t=tree(ctx);if(!root||!s||!t)return;const status=root.querySelector?.('#aum-v55-summary-status');if(!status)return;if(t.dirty){status.textContent='总结树已过期：聊天历史发生编辑 / swipe / 删除，请重建。';return;}let fold=null;try{fold=floorFoldStatus(ctx);}catch{/* status is cosmetic */}const foldText=fold?` ｜ 折叠 ${fold.hidden_messages}/${fold.chat_messages} 条（提示词可见 ${fold.prompt_messages}）${fold.last_error?` ｜ ${fold.last_error}`:''}`:'';status.textContent=`一级 ${t.level1.length} ｜ 二级 ${t.level2.length} ｜ 三级 ${t.level3.length}${foldText}${t.last_error?` ｜ ${t.last_error}`:''}`;}
function mount(ctx){if(typeof document==='undefined')return false;const s=settings(ctx),page=document.getElementById('aum-v55-settings-page-memory')||document.querySelector?.('#aum-v54-settings .inline-drawer-content');if(!ctx||!s||!page)return false;let root=document.getElementById('aum-v55-summary-settings');if(!root){root=document.createElement('section');root.id='aum-v55-summary-settings';root.className='aum-v54-section';root.innerHTML=`<h4>分层自动总结与模型接口</h4><p class="aum-v51-muted">Iteration 10：摘要经过角色权限过滤后并入 Reference 的统一预算，不再使用独立第三提示词。</p><label class="checkbox_label"><input id="aum-v55-summary-enabled" type="checkbox"> 启用分层自动总结</label><div class="aum-v51-grid"><label>一级/轮<input id="aum-v55-summary-l1" class="text_pole" type="number" min="1"></label><label>二级/一级<input id="aum-v55-summary-l2" class="text_pole" type="number" min="0"></label><label>三级/二级<input id="aum-v55-summary-l3" class="text_pole" type="number" min="0"></label><label>摘要子预算<input id="aum-v55-summary-max-chars" class="text_pole" type="number" min="0"></label><label>独立总结最大 token<input id="aum-v55-summary-tokens" class="text_pole" type="number" min="128" max="4096"></label><label class="checkbox_label"><input id="aum-v55-summary-auto-rebuild" type="checkbox"> 历史变更时自动重建摘要树</label><label>兼容注入深度（0 合法）<input id="aum-v55-summary-depth" class="text_pole" type="number" min="0"></label><label>总结输入上限（字符）<input id="aum-v55-summary-source-chars" class="text_pole" type="number" min="2000" max="200000"></label><label>保留最近未折叠楼层<input id="aum-v55-summary-fold-keep" class="text_pole" type="number" min="0" max="200"></label></div><label class="checkbox_label"><input id="aum-v55-summary-fold" type="checkbox"> 已总结楼层折叠出提示词（冷原文，原文仍在聊天与冷存中，可随时恢复）</label><div class="aum-v51-buttons"><button id="aum-v55-summary-run" class="menu_button">立即检查并总结</button><button id="aum-v55-summary-fold-now" class="menu_button">立即折叠已总结楼层</button><button id="aum-v55-summary-unfold" class="menu_button">恢复全部已折叠楼层</button><button id="aum-v55-summary-rebuild" class="menu_button">重建总结树</button></div><div id="aum-v55-summary-status" class="aum-v51-status"></div>`;page.prepend(root);const bind=(id,key,parse=x=>x)=>root.querySelector(`#${id}`)?.addEventListener('change',e=>{s[key]=parse(e.currentTarget.type==='checkbox'?e.currentTarget.checked:e.currentTarget.value);ctx.saveSettingsDebounced?.();refreshSummaryPrompt(ctx);});bind('aum-v55-summary-enabled','hierarchical_summary_enabled',Boolean);bind('aum-v55-summary-l1','summary_level1_every_turns',Number);bind('aum-v55-summary-l2','summary_level2_every_l1',Number);bind('aum-v55-summary-l3','summary_level3_every_l2',Number);bind('aum-v55-summary-max-chars','summary_max_context_chars',Number);bind('aum-v55-summary-tokens','summary_max_tokens',Number);bind('aum-v55-summary-auto-rebuild','summary_auto_rebuild_on_history_change',Boolean);bind('aum-v55-summary-depth','summary_injection_depth',Number);bind('aum-v55-summary-source-chars','summary_source_max_chars',Number);bind('aum-v55-summary-fold-keep','summary_fold_keep_recent_floors',Number);bind('aum-v55-summary-fold','summary_fold_hidden_floors',Boolean);
root.querySelector('#aum-v55-summary-run')?.addEventListener('click',()=>schedule(0));
root.querySelector('#aum-v55-summary-fold-now')?.addEventListener('click',()=>{try{foldSummarizedFloors(ctx);}catch(e){const t=tree(ctx);if(t)t.last_error=String(e?.message||e);}render(ctx);});
root.querySelector('#aum-v55-summary-unfold')?.addEventListener('click',()=>{try{unfoldAllFloors(ctx);}catch(e){const t=tree(ctx);if(t)t.last_error=String(e?.message||e);}render(ctx);});
root.querySelector('#aum-v55-summary-rebuild')?.addEventListener('click',()=>{try{unfoldAllFloors(ctx);}catch{/* rebuild still proceeds */}reset(tree(ctx));ctx.saveMetadataDebounced?.();refreshSummaryPrompt(ctx);schedule(0);});}root.querySelector('#aum-v55-summary-enabled').checked=!!s.hierarchical_summary_enabled;root.querySelector('#aum-v55-summary-fold').checked=s.summary_fold_hidden_floors===true;for(const[id,key]of[['aum-v55-summary-l1','summary_level1_every_turns'],['aum-v55-summary-l2','summary_level2_every_l1'],['aum-v55-summary-l3','summary_level3_every_l2'],['aum-v55-summary-max-chars','summary_max_context_chars'],['aum-v55-summary-source-chars','summary_source_max_chars'],['aum-v55-summary-fold-keep','summary_fold_keep_recent_floors']])root.querySelector(`#${id}`).value=s[key];root.querySelector('#aum-v55-summary-depth').value=normalizeSummaryInjectionDepth(s.summary_injection_depth,4);render(ctx);return true;}
function schedule(delay=300){if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;queue=queue.then(async()=>{const ctx=getContext(),s=settings(ctx);if(ctx&&s?.enabled!==false&&s.hierarchical_summary_enabled){const res=await processSummaryHierarchy(ctx);if(res?.skipped==='quiet-in-progress')schedule(1500);}}).catch(e=>{const ctx=getContext(),t=tree(ctx);if(t){t.last_error=String(e?.message||e);ctx?.saveMetadataDebounced?.();}console.error('[Aetheria v5.5 Summary]',e);render(ctx);});},Math.max(0,delay));}
function dirty(){
    const ctx=getContext(),s=settings(ctx),t=tree(ctx);
    if(!ctx||!s||!t)return;
    if(!s.summary_auto_rebuild_on_history_change){t.dirty=true;ctx.saveMetadataDebounced?.();refreshSummaryPrompt(ctx);render(ctx);return;}
    // Only an edit / swipe / delete actually invalidates the tree: those make an already-summarized
    // turn disappear from the current turn-id set. Appending new turns does not, and neither does the
    // host re-emitting its update events while it hydrates the chat at startup. Treating every such
    // event as an edit reset the whole tree and re-summarized every single turn on every launch.
    const current=new Set(collectCompletedDialogueTurns(ctx.chat||[]).map(x=>x.id));
    const orphaned=t.processed_turn_ids.some(id=>!current.has(id));
    if(!orphaned){ctx.saveMetadataDebounced?.();render(ctx);return;}
    // A reset tree means no summary covers the folded floors any more. Restore the raw text first so
    // the prompt is never missing content that nothing stands in for, then summarize again.
    let unfoldError=null;
    try{unfoldAllFloors(ctx);}catch(e){unfoldError=String(e?.message||e);}
    reset(t);if(unfoldError)t.last_error=unfoldError;ctx.saveMetadataDebounced?.();
    if(s.enabled!==false&&s.hierarchical_summary_enabled)schedule(350);
}
export { foldSummarizedFloors, unfoldAllFloors, floorFoldStatus } from './v55-floor-fold.js';
export function installV55HierarchicalSummary(){const ctx=getContext();if(!ctx)return false;settings(ctx);tree(ctx);refreshSummaryPrompt(ctx);mount(ctx);if(!installed){const ev=ctx.eventTypes||{},on=(e,h)=>e&&ctx.eventSource?.on?.(e,h),after=()=>{const c=getContext(),s=settings(c);if(s?.enabled!==false&&s?.hierarchical_summary_enabled)schedule(350);};on(ev.MESSAGE_RECEIVED,after);on(ev.CHARACTER_MESSAGE_RENDERED,after);on(ev.CHAT_CHANGED,()=>setTimeout(()=>{const c=getContext();settings(c);tree(c);refreshSummaryPrompt(c);mount(c);},80));for(const e of[ev.MESSAGE_SWIPED,ev.MESSAGE_EDITED,ev.MESSAGE_UPDATED,ev.MESSAGE_DELETED])on(e,dirty);installed=true;}for(const d of[120,450,1000,1800])setTimeout(()=>mount(getContext()),d);return true;}
