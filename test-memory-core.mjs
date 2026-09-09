import assert from 'node:assert/strict';
import {
  applyMemoryOps,
  buildQueryText,
  buildQueryVariants,
  buildRetrievalText,
  collectOpsSources,
  computeVectorHash,
  createEmptyStore,
  diversifyCandidates,
  filterRecalledMemories,
  findEvidenceExcerpt,
  fuseHybridCandidates,
  graphDiffuseCandidates,
  isMemorySettled,
  lexicalSearchMemories,
  parseMemoryOpsBlock,
  parseMemoryOpsFromMessage,
  replayStoreFromChat,
  shouldIndexMemory,
  sourcesArePrefix,
  splitJsonObjects,
  stableStringify,
  tokenizeHybridText,
  formatMemoryContext,
  computeDialoguePairFingerprint,
  collectAutonomousExtractionSources,
  replayStoreFromExtractions,
} from './memory-core.js';

function msg(mes, extra={}) { return { mes, name: extra.name ?? '', is_system: extra.is_system ?? false }; }
function opsMessage(lines, active='无') {
  return `<summary>\n<event>事件</event>\n<active_state>${active}</active_state>\n<memory_ops version="5">\n${lines.join('\n')}\n</memory_ops>\n</summary>`;
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// Parser robustness.
test('splitJsonObjects handles braces inside strings and multiline JSON', () => {
  const block = `noise\n{\n "op":"noop",\n "reason":"contains {braces} and \\\"quotes\\\""\n}\n`;
  const { objects, unclosed } = splitJsonObjects(block);
  assert.equal(unclosed, false);
  assert.equal(objects.length, 1);
  assert.equal(JSON.parse(objects[0]).reason, 'contains {braces} and "quotes"');
});

test('parseMemoryOpsBlock parses one-line and pretty JSON', () => {
  const block = [
    '{"op":"add","kind":"event","text":"平成第一次见到璃月。","status":"closed","indexable":true}',
    '{\n"op":"add",\n"kind":"state",\n"slot":"平成.state.hunger",\n"text":"平成当前饥饿。",\n"status":"active",\n"indexable":false\n}',
  ].join('\n');
  const parsed = parseMemoryOpsBlock(block);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.ops.length, 2);
});

test('invalid operation is diagnosed and rejected', () => {
  const parsed = parseMemoryOpsBlock('{"op":"teleport","kind":"event","text":"x"}');
  assert.equal(parsed.ops.length, 0);
  assert.match(parsed.errors.join('\n'), /invalid op/);
});

test('parseMemoryOpsFromMessage ignores message without block', () => {
  const parsed = parseMemoryOpsFromMessage('plain prose');
  assert.equal(parsed.hasBlock, false);
  assert.deepEqual(parsed.ops, []);
});

// Lifecycle.
test('state add then close by slot ends active status and clears slot', () => {
  let store = createEmptyStore();
  let r = applyMemoryOps(store, [{op:'add', kind:'state', slot:'平成.state.hunger', text:'平成当前饥饿。', status:'active', indexable:false}], {sourceMessageIndex:1, sourceHash:1});
  store = r.store;
  const id = store.slots['平成.state.hunger'];
  assert.ok(id);
  assert.equal(store.memories[id].status, 'active');
  r = applyMemoryOps(store, [{op:'close', target_slot:'平成.state.hunger', reason:'已进食'}], {sourceMessageIndex:3, sourceHash:3});
  store = r.store;
  assert.equal(store.memories[id].status, 'closed');
  assert.equal(store.memories[id].valid_until, 3);
  assert.equal(store.slots['平成.state.hunger'], undefined);
});

test('new add on same slot closes prior state', () => {
  let store = createEmptyStore();
  store = applyMemoryOps(store, [{op:'add', kind:'state', slot:'平成.location.current', text:'平成在宿舍。', status:'active', indexable:false}], {sourceMessageIndex:1, sourceHash:1}).store;
  const oldId = store.slots['平成.location.current'];
  store = applyMemoryOps(store, [{op:'add', kind:'state', slot:'平成.location.current', text:'平成在东街面馆。', status:'active', indexable:false}], {sourceMessageIndex:3, sourceHash:3}).store;
  const newId = store.slots['平成.location.current'];
  assert.notEqual(oldId, newId);
  assert.equal(store.memories[oldId].status, 'closed');
  assert.equal(store.memories[oldId].superseded_by, newId);
  assert.equal(store.memories[newId].status, 'active');
});

test('supersede belief can create new knowledge and link both directions', () => {
  let store = createEmptyStore();
  store = applyMemoryOps(store, [{op:'add', kind:'belief', slot:'平成.belief.A_theft', text:'平成怀疑A偷了物品。', status:'active', indexable:true}], {sourceMessageIndex:1, sourceHash:1}).store;
  const oldId = store.slots['平成.belief.A_theft'];
  const r = applyMemoryOps(store, [{
    op:'supersede', target_slot:'平成.belief.A_theft', kind:'knowledge', slot:'平成.knowledge.A_innocent',
    text:'平成已经确认A没有偷走该物品。', status:'active', epistemic:'fact', indexable:true
  }], {sourceMessageIndex:5, sourceHash:5});
  store = r.store;
  const newId = store.slots['平成.knowledge.A_innocent'];
  assert.ok(newId);
  assert.equal(store.memories[oldId].status, 'superseded');
  assert.equal(store.memories[oldId].superseded_by, newId);
  assert.equal(store.memories[newId].supersedes, oldId);
  assert.equal(store.memories[newId].kind, 'knowledge');
});

test('replaying identical chat is deterministic', () => {
  const chat = [
    msg('用户说话'),
    msg(opsMessage(['{"op":"add","kind":"event","text":"平成与璃月第一次见面。","status":"closed","importance":"high","indexable":true}'], '平成在浮空港。')),
    msg('后续用户'),
    msg(opsMessage(['{"op":"add","kind":"state","slot":"平成.state.hunger","text":"平成当前饥饿。","status":"active","indexable":false}'], '平成在家并感到饥饿。')),
  ];
  const a = replayStoreFromChat(chat).store;
  const b = replayStoreFromChat(chat).store;
  assert.equal(stableStringify(a.memories), stableStringify(b.memories));
  assert.deepEqual(a.slots, b.slots);
});

test('history replacement replay removes discarded swipe memory', () => {
  const oldChat = [msg(opsMessage(['{"op":"add","kind":"event","text":"平成答应与A合作。","status":"closed","indexable":true}']))];
  const newChat = [msg(opsMessage(['{"op":"add","kind":"event","text":"平成拒绝了A的合作邀请。","status":"closed","indexable":true}']))];
  const oldStore = replayStoreFromChat(oldChat).store;
  const newStore = replayStoreFromChat(newChat).store;
  assert.equal(Object.values(oldStore.memories).some(m => m.text.includes('答应')), true);
  assert.equal(Object.values(newStore.memories).some(m => m.text.includes('答应')), false);
  assert.equal(Object.values(newStore.memories).some(m => m.text.includes('拒绝')), true);
});

// Source prefix logic.
test('source fingerprint prefix detects append vs mutation', () => {
  const base = [{index:1,hash:10},{index:3,hash:20}];
  assert.equal(sourcesArePrefix(base, [...base,{index:5,hash:30}]), true);
  assert.equal(sourcesArePrefix(base, [{index:1,hash:10},{index:3,hash:999}]), false);
  assert.equal(sourcesArePrefix(base, [{index:1,hash:10}]), false);
});

test('collectOpsSources only fingerprints messages with memory_ops', () => {
  const chat = [msg('plain'), msg(opsMessage(['{"op":"noop","reason":"none"}'])), msg('<summary><event>x</event></summary>')];
  const sources = collectOpsSources(chat);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].index, 1);
});

// Query and retrieval.
test('buildQueryText strips summary and machine ops', () => {
  const chat = [
    msg('旧文本', {name:'平成'}),
    msg('正文内容\n<summary><event>隐藏摘要</event><memory_ops version="5">{"op":"noop","reason":"x"}</memory_ops></summary>', {name:'璃月'}),
  ];
  const q = buildQueryText(chat, 2);
  assert.match(q, /旧文本/);
  assert.match(q, /正文内容/);
  assert.doesNotMatch(q, /隐藏摘要|memory_ops|noop/);
});

test('retrieval text and vector hash are deterministic', () => {
  const memory = {id:'m1', text:'平成第一次见到璃月。', entities:['平成','璃月'], topics:['初次见面']};
  assert.equal(buildRetrievalText(memory), '[平成, 璃月 — 初次见面] 平成第一次见到璃月。');
  assert.equal(computeVectorHash(memory), computeVectorHash({...memory}));
});

test('recall filtering preserves vector metadata order and excludes recent/superseded', () => {
  const store = createEmptyStore();
  store.memories.a = {id:'a',kind:'event',text:'A',status:'closed',indexable:true,vector_hash:101,source_message:2,importance:'high'};
  store.memories.b = {id:'b',kind:'event',text:'B',status:'closed',indexable:true,vector_hash:102,source_message:20,importance:'high'};
  store.memories.c = {id:'c',kind:'belief',text:'C',status:'superseded',indexable:true,vector_hash:103,source_message:1,importance:'high'};
  store.memories.d = {id:'d',kind:'event',text:'D',status:'closed',indexable:true,vector_hash:104,source_message:4,importance:'high'};
  const recalled = filterRecalledMemories(store, [{hash:104},{hash:103},{hash:102},{hash:101}], {finalCount:3, protectRecent:5, chatLength:23});
  // c excluded as superseded, b excluded because source_message 20 is in protected recent range >=18.
  assert.deepEqual(recalled.map(x => x.id), ['d','a']);
});

// Example from user's problem: baseline facts should not be forced by core; only explicit ops persist.
test('core never invents Persona/worldbook baseline facts', () => {
  const chat = [msg(opsMessage(['{"op":"add","kind":"event","text":"平成今天从工坊回家后浏览了外卖。","status":"closed","indexable":false}']))];
  const store = replayStoreFromChat(chat).store;
  const all = Object.values(store.memories).map(x => x.text).join('\n');
  assert.doesNotMatch(all, /1015|主修辅助魔法|上帝的骰子|宠物家园/);
});


test('repeated identical active slot add does not create historical churn', () => {
  let store = createEmptyStore();
  store = applyMemoryOps(store, [{op:'add', kind:'state', slot:'平成.state.hunger', text:'平成当前饥饿。', status:'active', indexable:false}], {sourceMessageIndex:1, sourceHash:1}).store;
  const originalId = store.slots['平成.state.hunger'];
  const beforeCount = Object.keys(store.memories).length;
  const result = applyMemoryOps(store, [{op:'add', kind:'state', slot:'平成.state.hunger', text:'平成当前饥饿。', status:'active', known_by:['平成'], indexable:false}], {sourceMessageIndex:3, sourceHash:3});
  store = result.store;
  assert.equal(Object.keys(store.memories).length, beforeCount);
  assert.equal(store.slots['平成.state.hunger'], originalId);
  assert.equal(store.memories[originalId].status, 'active');
  assert.equal(store.memories[originalId].last_confirmed_message, 3);
});


test('v5.2 evidence excerpt comes from narrative body, not summary', () => {
  const source = '平成走进星环学盟第三浮空港。她误乘了研究人员接驳艇，因此第一次遇见璃月。两人后来交换联系方式。<summary><event>这段摘要不应成为证据。</event></summary>';
  const excerpt = findEvidenceExcerpt(source, {entities:['平成','璃月'], topics:['误乘接驳艇']}, 180);
  assert.match(excerpt, /璃月|接驳艇/);
  assert.doesNotMatch(excerpt, /这段摘要不应成为证据/);
});

test('v5.2 Chinese tokenizer emits CJK bigrams/trigrams', () => {
  const tokens = tokenizeHybridText('平成在星环学盟浮空港遇见璃月');
  assert.ok(tokens.includes('星环'));
  assert.ok(tokens.includes('星环学'));
  assert.ok(tokens.includes('璃月'));
});

test('v5.2 lexical search protects exact rare entity names', () => {
  const store = createEmptyStore();
  const memories = [
    ['a','平成在第三浮空港第一次结识璃月。',['平成','璃月','第三浮空港'],['初次相识']],
    ['b','平成在大学食堂吃了一顿普通晚饭。',['平成'],['晚饭']],
  ];
  for (const [id,text,entities,topics] of memories) {
    store.memories[id] = {id,kind:'event',text,entities,topics,status:'closed',importance:'medium',epistemic:'fact',known_by:['平成'],indexable:true,source_message:1,vector_hash:id==='a'?11:12};
  }
  const hits = lexicalSearchMemories(store, '璃月是谁？我以前是不是见过她？', {limit:5});
  assert.equal(hits[0].memory.id, 'a');
  assert.deepEqual(hits[0].entityMatches, ['璃月']);
});

test('v5.2 dense gate rejects lexical-only generic noise but exact entity can bypass', () => {
  const store = createEmptyStore();
  const dense = {id:'dense',kind:'event',text:'关于实验室的真实相关事件',entities:['平成'],topics:['实验室'],status:'closed',importance:'medium',indexable:true};
  const noise = {id:'noise',kind:'event',text:'另一个无关的实验室同词事件',entities:['路人'],topics:['实验室'],status:'closed',importance:'medium',indexable:true};
  const entity = {id:'entity',kind:'event',text:'平成曾经见过璃月',entities:['璃月'],topics:['见面'],status:'closed',importance:'medium',indexable:true};
  for (const m of [dense,noise,entity]) store.memories[m.id]=m;
  const fused = fuseHybridCandidates(store, [[dense]], [
    {memory:noise,score:8,entityMatches:[]},
    {memory:entity,score:7,entityMatches:['璃月']},
  ], {currentMessage:20});
  assert.ok(fused.some(x=>x.memory.id==='dense'));
  assert.ok(fused.some(x=>x.memory.id==='entity' && x.entityBypass));
  assert.ok(!fused.some(x=>x.memory.id==='noise'));
});

test('v5.2 graph diffusion does not use ubiquitous protagonist as a universal bridge', () => {
  const store = createEmptyStore();
  const a={id:'a',kind:'event',text:'平成与璃月在港口讨论航线',entities:['平成','璃月'],topics:['航线'],status:'closed',importance:'medium',indexable:true};
  const b={id:'b',kind:'event',text:'平成与璃月后来处理航路许可',entities:['平成','璃月'],topics:['航线许可'],status:'closed',importance:'medium',indexable:true};
  const c={id:'c',kind:'event',text:'平成独自在厨房做饭',entities:['平成'],topics:['做饭'],status:'closed',importance:'medium',indexable:true};
  const d={id:'d',kind:'event',text:'平成在教室上课',entities:['平成'],topics:['课程'],status:'closed',importance:'medium',indexable:true};
  for (const m of [a,b,c,d]) store.memories[m.id]=m;
  const rows=[a,b,c].map((m,i)=>({memory:m,score:[0.03,0.02,0.019][i],channels:['dense1']}));
  const out=graphDiffuseCandidates(store,rows,{damping:0.18,iterations:5});
  const oa=out.find(x=>x.memory.id==='a');
  const ob=out.find(x=>x.memory.id==='b');
  const oc=out.find(x=>x.memory.id==='c');
  assert.ok(oa.graphScore > oc.graphScore || ob.graphScore > oc.graphScore);
});

test('v5.2 MMR-like diversity avoids filling recall with near-duplicate callbacks', () => {
  const rows=[
    {memory:{id:'a',text:'平成和璃月在浮空港第一次见面并交换联系方式',topics:['初次见面','璃月']},score:1.0},
    {memory:{id:'b',text:'平成在浮空港初次遇到璃月并交换了联系方式',topics:['初次见面','璃月']},score:0.98},
    {memory:{id:'c',text:'平成后来在研究所完成了冷却塔实验',topics:['冷却塔','研究所']},score:0.84},
  ];
  const picked=diversifyCandidates(rows,{finalCount:2,lambda:0.62});
  assert.equal(picked[0].memory.id,'a');
  assert.ok(picked.some(x=>x.memory.id==='c'));
});

test('v5.2 buildQueryVariants creates focus plus broader context when useful', () => {
  const chat=[msg('前面在讨论星环学盟。',{name:'平成'}),msg('我是不是以前见过璃月？',{name:'用户'})];
  const variants=buildQueryVariants(chat,3,8000);
  assert.equal(variants[0].name,'focus');
  assert.match(variants[0].text,/璃月/);
  assert.ok(variants.some(v=>v.name==='context' && /星环学盟/.test(v.text)));
});

test('v5.2 prompt budget and high-importance evidence are enforced', () => {
  const recalls=Array.from({length:8},(_,i)=>({memory:{id:`m${i}`,kind:'event',status:'closed',epistemic:'fact',importance:i===0?'high':'medium',known_by:['平成'],text:`记忆${i}`+'内容'.repeat(150),evidence_excerpt:i===0?'原文证据片段':''}}));
  const prompt=formatMemoryContext({activeState:'平成当前在家。',recalledMemories:recalls,maxChars:1800,includeEvidence:true});
  assert.ok(prompt.length <= 1800);
  assert.match(prompt,/原文证据片段/);
  assert.match(prompt,/不要为了展示/);
});


test('v5.2 vector settlement horizon delays fresh memory indexing', () => {
  const m={source_message:10};
  assert.equal(isMemorySettled(m,12,2), false);
  assert.equal(isMemorySettled(m,13,2), true);
  assert.equal(isMemorySettled(m,11,0), true);
});

test('v5.2 Evidence Gate keeps weak summary-only memory out of vector index', () => {
  const weak={kind:'ownership',text:'平成拥有某个既有物品。',status:'active',importance:'medium',indexable:true,quality_flags:['no_source_evidence']};
  assert.equal(shouldIndexMemory(weak), false);
  const high={...weak,importance:'high'};
  assert.equal(shouldIndexMemory(high), true);
});

test('v5.2 replay can use preceding user message as evidence', () => {
  const chat=[
    msg('我刚刚和璃月正式签了合作协议。',{name:'用户'}),
    msg('收到。'+opsMessage(['{"op":"add","kind":"commitment","slot":"平成.commitment.liyue","text":"平成与璃月已经正式签订合作协议。","entities":["平成","璃月"],"topics":["合作协议"],"status":"active","importance":"medium","indexable":true}']),{name:'AI'}),
  ];
  const store=replayStoreFromChat(chat).store;
  const memory=Object.values(store.memories)[0];
  assert.ok(memory.evidence_excerpt);
  assert.ok(!(memory.quality_flags||[]).includes('no_source_evidence'));
  assert.equal(shouldIndexMemory(memory), true);
});


test('v5.3 dialogue pair fingerprint is deterministic and branch-sensitive', () => {
  const chat=[
    {mes:'我饿了。',name:'用户',is_user:true,is_system:false},
    {mes:'平成回到家打开外卖。',name:'平成',is_user:false,is_system:false},
  ];
  const a=computeDialoguePairFingerprint(chat,1);
  const b=computeDialoguePairFingerprint(chat,1);
  assert.equal(a.key,b.key);
  const changed=structuredClone(chat);
  changed[1].mes='平成回到家先喝了水。';
  const c=computeDialoguePairFingerprint(changed,1);
  assert.notEqual(c.key,a.key);
});

test('v5.3 autonomous extraction replay restores canonical state and drops discarded swipe record', () => {
  const chat=[
    {mes:'我饿了。',name:'用户',is_user:true,is_system:false},
    {mes:'平成回到家。',name:'平成',is_user:false,is_system:false},
  ];
  const pair=computeDialoguePairFingerprint(chat,1);
  const records={
    [pair.key]:{version:'5.4',source_hash:pair.hash,event_summary:'平成回家。',active_state:'平成当前饥饿。',operations:[
      {op:'add',kind:'state',slot:'平成.state.hunger',text:'平成当前饥饿。',status:'active',importance:'low',epistemic:'observed',indexable:false},
    ]}
  };
  const replay=replayStoreFromExtractions(chat,records,{includeLegacyMessageOps:false});
  assert.equal(replay.errors.length,0);
  assert.match(replay.store.last_active_state,/饥饿/);
  assert.ok(replay.store.slots['平成.state.hunger']);
  assert.equal(collectAutonomousExtractionSources(chat,records).length,1);

  const swiped=structuredClone(chat);
  swiped[1].mes='平成去了图书馆。';
  const after=replayStoreFromExtractions(swiped,records,{includeLegacyMessageOps:false});
  assert.equal(Object.keys(after.store.memories).length,0);
  assert.equal(collectAutonomousExtractionSources(swiped,records).length,0);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} tests passed.`);
if (passed !== tests.length) process.exit(1);
