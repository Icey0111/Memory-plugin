// T-Causal acceptance set: the plan's hard precondition (MEMORY_PLAN_2026.md section 6), executed.
//
// The question types are the plan's own: "why is it like this now?", "who did this first?", "who still
// does not know?" - plus the negative half the old substring probes could not express: a value that was
// superseded or invalidated must not be answerable as the current one, because that is the failure of
// invariant I1 (canonical memory must never be overwritten by a later summary).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMemoryOps, createEmptyStore } from './memory-core.js';
import { buildTcausalCases, formatTcausalReport, runTcausal, scoreTcausal, tcausalCorpus } from './v55-tcausal.js';

const fixture = JSON.parse(readFileSync(new URL('./tcausal-cases.json', import.meta.url), 'utf8'));

function buildStore() {
    let store = createEmptyStore();
    for (const turn of fixture.turns) {
        const result = applyMemoryOps(store, turn.ops, { sourceMessageIndex: turn.sourceMessageIndex });
        assert.deepEqual(result.errors, [], 'fixture turn ' + turn.sourceMessageIndex + ' must apply cleanly');
        store = result.store || store;
    }
    return store;
}

const store = buildStore();

// --- the fixture itself has to be worth something: every slot the cases name must exist -----------
assert.equal(Object.keys(store.slots || {}).length, 7, 'the fixture owns seven occupied slots');
assert.equal(Object.values(store.memories).filter(m => m.status === 'active').length, 7, 'and seven live memories');
assert.equal(Object.values(store.memories).filter(m => m.status === 'superseded').length, 1, 'one superseded belief');
assert.equal(Object.values(store.memories).filter(m => m.status === 'invalid').length, 1, 'one invalidated claim');

// --- canonical scope: every authored case is answerable from memory alone -------------------------
const canonical = runTcausal(store, { authored: fixture.cases, scope: 'canonical' });
assert.equal(canonical.measured, true);
assert.equal(canonical.violations, 0, 'canonical memory must not contradict itself: ' + JSON.stringify(canonical.violation_detail));
assert.equal(canonical.hit, canonical.total, 'every authored case must be answerable from canonical memory:\n' + formatTcausalReport(canonical));
assert.equal(canonical.rate, 1);
assert.equal(canonical.by_kind.why.total, 3, 'three why-cases');
assert.equal(canonical.by_kind.who_first.total, 4, 'four whose-first cases');
assert.equal(canonical.by_kind.who_unknown.total, 1, 'one who-does-not-know case');
assert.equal(canonical.by_kind.no_stale.total, 1, 'one anti-staleness case');

// --- an invalidated claim is gone from the corpus -------------------------------------------------
const corpus = tcausalCorpus(store, { scope: 'canonical' });
assert.equal(corpus.includes('我原以为井底的灰絮是一种毒'), false, 'an invalidated claim must not be answerable as current');
assert.equal(corpus.includes('井底有会呼吸的灰白絮状物'), true, 'an untouched knowledge record stays answerable');

// --- injected scope: score against the block the prompt actually gets -----------------------------
// Built from the two real carriers: the live memory rows and the change chain, which is where a replaced
// value is allowed to appear. A "why" case is only answerable if the chain still names the old endpoint.
const liveRows = Object.values(store.memories)
    .filter(m => m.status === 'active')
    .map(m => '<memory id="' + m.id + '" kind="' + m.kind + '"><summary>' + m.text + '</summary></memory>')
    .join('\n');
const chain = (await import('./v55-spine.js')).spinePromptBlock(store);
assert.ok(chain.includes('曾:'), 'the change chain must name the value it replaced');
const injectedBlock = liveRows + '\n' + chain;
const injectedGood = runTcausal(store, { authored: fixture.cases, scope: 'injected', injectedText: injectedBlock, renderedBlock: injectedBlock, available: true });
assert.equal(injectedGood.violations, 0, 'a rendered block built from live memory plus the change chain must not contradict itself: ' + JSON.stringify(injectedGood.violation_detail));
assert.equal(injectedGood.rate, 1, 'every authored case must be answerable from the injected block:\n' + formatTcausalReport(injectedGood));

// A block that leaks the invalidated claim as a current fact is a violation, not a miss.
const leaked = injectedBlock + '\n<memory id="m_bad"><summary>我原以为井底的灰絮是一种毒</summary></memory>';
const injectedLeak = scoreTcausal(store, [fixture.cases.find(c => c.id === 'no_stale_well')], { scope: 'injected', injectedText: leaked, renderedBlock: leaked, available: true });
assert.equal(injectedLeak.violations, 1, 'an invalidated claim that reaches the prompt is a violation');
assert.equal(injectedLeak.hit, 0);

// The same for a superseded belief rendered as a live memory row: the old endpoint must stay history.
const supersededId = Object.values(store.memories).find(m => m.status === 'superseded').id;
const staleLive = injectedBlock + '\n<memory id="' + supersededId + '" kind="belief"><summary>我认为白鸦想用钥匙换我的沉默</summary></memory>';
const injectedBad = scoreTcausal(store, [fixture.cases.find(c => c.id === 'why_motive')], { scope: 'injected', injectedText: staleLive, renderedBlock: staleLive, available: true });
assert.equal(injectedBad.violations, 1, 'a superseded value rendered as a live row is a violation, not a miss');
assert.equal(injectedBad.hit, 0);

// --- generated cases: the spine must yield all three question types on its own --------------------
const generated = buildTcausalCases(store, { limit: 40 });
assert.ok(generated.length >= 8, 'the spine must generate cases from a 7-turn fixture, got ' + generated.length);
const kinds = new Set(generated.map(item => item.kind));
assert.ok(kinds.has('why'), 'generated cases must cover why');
assert.ok(kinds.has('who_first'), 'generated cases must cover who-first');
assert.ok(kinds.has('who_unknown'), 'generated cases must cover who-does-not-know');
const scored = scoreTcausal(store, generated, { scope: 'canonical' });
assert.equal(scored.violations, 0, 'generated cases must not be violated by the store that generated them');
assert.equal(scored.rate, 1, 'every generated case is answerable by construction:\n' + formatTcausalReport(scored));

// --- an unreadable injected block must be reported as unmeasured, never as a zero -----------------
const unmeasured = scoreTcausal(store, fixture.cases, { scope: 'injected', injectedText: '', available: false });
assert.equal(unmeasured.measured, false);
assert.equal(unmeasured.rate, null, 'an unreadable block is not a zero');
assert.equal(unmeasured.hit, null);

console.log('PASS v5.5 T-Causal: why / who-first / who-does-not-know, with the stale-value negative check');
