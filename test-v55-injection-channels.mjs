import assert from 'node:assert/strict';
import { assembleGenerationContext } from './context-assembler.js';
import { applyMemoryOps, createEmptyStore, getActiveMemories, getMandatoryMemories } from './memory-core.js';

// sourceMessageText must contain the entities: without an evidence excerpt a low-importance knowledge
// memory carries the no_source_evidence flag and is filtered out of active state before the query is
// even considered. The plugin always passes the real dialogue pair here.
const build = (ops) => applyMemoryOps(createEmptyStore(), ops, { sourceMessageIndex: 0, sourceMessageText: ops.map(o => o.text || '').join('\n') }).store;
const assemble = (store, query, mandatory) => {
    const ids = new Set(mandatory.map(m => m.id));
    const active = [...mandatory, ...getActiveMemories(store, query, 12).filter(m => !ids.has(m.id))];
    return assembleGenerationContext({
        currentState: '', activeMemories: active, mandatoryIds: ids,
        historyResults: [], settingResults: null,
        maxCurrentStateChars: 5000, maxReferenceChars: 12000,
    });
};

const FACT = '林昭把刻着「渡鸦七号」的铜牌缝进了左边靴子的夹层。';
const QUESTION = '我把那块刻着「渡鸦七号」的铜牌藏在什么地方了？只回答位置，一句话。';

// S4: an irreversible change is mandatory, and the block says so before anything else.
const a = build([{ op: 'add', kind: 'commitment', slot: '林昭.commitment.raven', text: FACT, entities: ['林昭', '铜牌'], importance: 'critical' }]);
const mustA = getMandatoryMemories(a);
assert.equal(mustA.length, 1, 'a critical commitment is mandatory');
const bundleA = assemble(a, QUESTION, mustA);
assert.ok(bundleA.currentStateBlock.includes(FACT), 'the mandatory memory reaches the model');
assert.match(bundleA.currentStateBlock, /Must-remember/, 'and is marked as such');
assert.equal(bundleA.diagnostics.mandatoryCount, 1);

// The same fact, low importance, is NOT mandatory ...
const b = build([{ op: 'add', kind: 'knowledge', slot: '林昭.knowledge.raven', text: FACT, entities: ['林昭', '铜牌'], importance: 'low', indexable: false }]);
assert.equal(getMandatoryMemories(b).length, 0, 'a low-importance knowledge memory is not mandatory');
// ... and yet it is still injected, because the current-state block is not a top-k retrieval: every
// active memory whose entity the query names goes in. That is exactly why the live control experiment
// could not produce a clean contrast - the ordinary groups are already a second, wider baseline.
assert.equal(getActiveMemories(b, QUESTION, 12).length, 1, 'the query names one of its entities');
const bundleB = assemble(b, QUESTION, []);
assert.ok(bundleB.currentStateBlock.includes(FACT), 'an entity-matched active memory is injected without being mandatory');
assert.doesNotMatch(bundleB.currentStateBlock, /Must-remember/);
assert.equal(bundleB.diagnostics.mandatoryCount, 0);

// The real negative case: nothing matches the query, so nothing is injected at all.
const c = build([{ op: 'add', kind: 'knowledge', slot: '灰烬港.knowledge.weather', text: '灰烬港今夜有雾。', entities: ['灰烬港'], topics: ['天气'], importance: 'low' }]);
assert.equal(getActiveMemories(c, QUESTION, 12).length, 0, 'no entity match and low importance');
assert.equal(assemble(c, QUESTION, []).currentStateBlock, '', 'nothing matches, so nothing is injected');
console.log('PASS v5.5 injection channels: a guaranteed mandatory baseline sits inside a wider, entity-matched active-state baseline');
