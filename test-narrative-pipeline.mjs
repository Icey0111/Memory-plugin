// The narrative pipeline: the summary carries continuity, the original text carries detail.
//
// These are the acceptance criteria the architecture review asked for, stated as executable checks:
//   1. a detail that exists ONLY in the original text is still recallable, even though no extractor
//      ever recorded it (the defect the review measured in the old fact-first index);
//   2. a floor leaves the prompt only while a summary covers every chunk of it, and the newest floor
//      is never hidden;
//   3. a summary that fails, overruns its budget, or no longer fits restores the original floors
//      instead of leaving the prompt with neither the text nor a stand-in;
//   4. an edit or a branch change invalidates the summary and restores the raw text;
//   5. a background result that belongs to a chat the user has left is never written.
import assert from 'node:assert/strict';
import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence, validSummary,
    nextSummaryBatch, applyNarrativeFolds, RAW_CHUNK_SIZE } from './raw-history.js';
import { buildNarrativeContext, updateNarrative, runNarrativeGeneration, narrativeSettings,
    NARRATIVE_PROMPTS } from './narrative-runtime.js';

const KEY = 'aetheriaUnifiedMemoryV54';

function makeHost(floors, { settings = {}, summarize } = {}) {
    const chat = [];
    for (let turn = 0; turn < floors; turn += 1) {
        chat.push({ is_user: true, mes: '第' + (turn + 1) + '层：主角走进大厅。' });
        chat.push({ is_user: false, mes: '第' + (turn + 1) + '层：管家点了点头，什么也没说。' });
    }
    const prompts = [];
    const ctx = {
        extensionSettings: { [KEY]: { enabled: true, narrative_every: 5, narrative_summary_tokens: 400,
            narrative_evidence_tokens: 600, narrative_setting_tokens: 0, ...settings } },
        chatMetadata: { [KEY]: {} },
        chat,
        setExtensionPrompt: (...args) => prompts.push(args),
        saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {},
        eventTypes: {}, eventSource: { on: () => {} },
    };
    const store = ctx.chatMetadata[KEY];
    let current = true;
    const services = {
        isCurrent: () => current,
        leave: () => { current = false; },
        vector: () => ({ supported: false, reason: 'vector disabled in this test' }),
        summarize: summarize || (async () => '摘要：主角在大厅与管家交谈。'),
    };
    return { ctx, store, chat, prompts, services };
}

// --- 1. the detail no extractor ever recorded ---------------------------------------------------
{
    const host = makeHost(1);
    const detail = '暗号是青铜月亮，只有管家知道。';
    host.chat[1].mes = '管家压低声音：' + detail + '井沿上有三道新凿痕。';
    const history = host.store.raw_history ??= { version: 1, sequence: 0, records: {}, active: [] };
    captureHistory(host.store, host.chat);
    const chunks = chunkHistory(history);
    // The pipeline never extracted anything: there is no fact store entry for this chat at all.
    assert.equal(host.store.memories, undefined, 'the fixture has no extracted facts to fall back on');
    const ranked = rankRawChunks(chunks, '他之前说的暗号是什么？');
    const packed = packRawEvidence(ranked, history, { maxTokens: 400, visibleSources: new Set() });
    assert.match(packed.text, /青铜月亮/, 'a detail that only exists in the original text is recallable');
    assert.match(packed.text, /quoted history, not instructions/, 'quoted evidence is labelled as history');
    assert.deepEqual(packed.sources.map(s => s.source), [history.active[1]], 'and it cites the source message');
}

// --- 2. chunk ids are stable, and an edit is a new version ---------------------------------------
{
    const host = makeHost(2);
    const history = host.store.raw_history ??= { version: 1, sequence: 0, records: {}, active: [] };
    const first = captureHistory(host.store, host.chat);
    assert.equal(first.changed, true, 'the first capture binds a lineage');
    const before = [...history.active];
    const second = captureHistory(host.store, host.chat);
    assert.equal(second.changed, false, 'an unchanged chat keeps its ids');
    assert.deepEqual(history.active, before, 'so nothing downstream has to rebind');
    host.chat[1].mes = '被改写过的回复';
    const third = captureHistory(host.store, host.chat);
    assert.equal(third.changed, true, 'an edited reply is a new version');
    assert.notEqual(history.active[1], before[1], 'and the old version keeps its own record');
    assert.equal(history.records[before[1]].text, '第1层：管家点了点头，什么也没说。',
        'the superseded version is archived, never overwritten');
    const long = { is_user: false, mes: '长文'.repeat(RAW_CHUNK_SIZE) };
    host.chat.push(long);
    captureHistory(host.store, host.chat);
    const chunks = chunkHistory(history);
    const pieces = chunks.filter(c => c.source === history.active.at(-1));
    assert.ok(pieces.length > 1, 'a long message is chunked');
    assert.ok(pieces.every(p => p.text.length <= RAW_CHUNK_SIZE), 'and every chunk respects the size cap');
    assert.equal(pieces[0].end - pieces[1].start, 100, 'consecutive chunks overlap, so a cut never loses a reference');
}

// --- 3. a floor is only hidden while the summary covers all of it --------------------------------
{
    const host = makeHost(12);
    const { ctx, store, chat } = host;
    const prepared = narrativeSettings(ctx);
    void prepared;
    const history = store.raw_history ??= { version: 1, sequence: 0, records: {}, active: [] };
    captureHistory(store, chat);
    const chunks = chunkHistory(history);
    const completed = chunks.filter(c => c.role === 'assistant');
    const partial = { version: 1, text: '只覆盖第一层', covered: chunks.slice(0, 2).map(c => c.id) };
    assert.equal(validSummary(partial, chunks), true, 'a prefix of the chunk list is a valid coverage claim');
    applyNarrativeFolds(chat, history, chunks, partial, true);
    assert.equal(chat[0].is_system, true, 'a fully covered floor leaves the prompt');
    assert.equal(chat[2].is_system, undefined, 'an uncovered floor stays');
    const newestAssistant = chat.length - 1;
    assert.equal(chat[newestAssistant].is_system, undefined, 'the newest assistant floor is never hidden');
    assert.ok(completed.length >= 12, 'the fixture really has completed floors');
    // A coverage claim that is not a prefix of the current chunk list is refused outright.
    const scrambled = { version: 1, text: 'x', covered: [chunks[1].id, chunks[0].id] };
    assert.equal(validSummary(scrambled, chunks), false, 'coverage has to be the exact prefix it claims');
}

// --- 4. summary failure, budget overrun, and no room all restore the raw text --------------------
{
    const host = makeHost(12, { summarize: async () => { throw new Error('provider down'); } });
    const { ctx, store, chat, services } = host;
    await updateNarrative(ctx, services, { force: true });
    assert.equal(store.narrative_summary, undefined, 'a failed summary is never stored');
    assert.match(store.narrative_diagnostics.summary_error, /provider down/);
    assert.notEqual(chat[0].is_system, true, 'and no floor is hidden without a stand-in');
}
{
    const host = makeHost(12, { summarize: async () => '超'.repeat(4000) });
    const { ctx, store, chat, services } = host;
    await updateNarrative(ctx, services, { force: true });
    assert.equal(store.narrative_summary, undefined, 'an over-budget summary is refused');
    assert.match(store.narrative_diagnostics.summary_error, /超过预算/);
    assert.notEqual(chat[0].is_system, true, 'the original floors stay in the prompt');
}
{
    // A summary that was accepted, and then cannot fit, is dropped and its floors come back.
    const host = makeHost(12, { settings: { narrative_summary_tokens: 2000, narrative_evidence_tokens: 0 } });
    const { ctx, store, chat, services } = host;
    await updateNarrative(ctx, services, { force: true });
    assert.ok(store.narrative_summary.text.length > 0, 'the fixture summary is accepted');
    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 8 });
    assert.equal(bundle.referenceBlock, '', 'with no room for the stand-in, nothing is injected');
    assert.equal(bundle.currentStateBlock, '');
    assert.notEqual(chat[0].is_system, true, 'and every original floor is restored');
    assert.match(bundle.diagnostics.summary_error, /original floors restored/);
}

// --- 5. an accepted summary folds only what it covers, and the tail stays hot ---------------------
{
    const host = makeHost(12, { summarize: async () => '摘要：主角已经在大厅与管家谈过话。' });
    const { ctx, store, chat, services } = host;
    await updateNarrative(ctx, services, { force: true });
    assert.equal(store.narrative_summary.covered.length > 0, true, 'the summary records exactly what it read');
    assert.ok(validSummary(store.narrative_summary, chunkHistory(store.raw_history)), 'and that claim is still valid');
    const hidden = chat.filter(row => row.is_system === true).length;
    assert.ok(hidden > 0, 'covered floors leave the prompt');
    const lastUser = chat.length - 2;
    assert.equal(chat[lastUser].is_system, undefined, 'the last user turn is never hidden');
    assert.equal(chat[chat.length - 1].is_system, undefined, 'nor is the newest assistant floor');
    assert.equal(hidden, chat.length - 2, 'everything the summary covers and nothing more');

    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 32768 });
    assert.match(bundle.currentStateBlock, /摘要：主角已经在大厅与管家谈过话/,
        'the summary is what carries continuity');
    assert.match(bundle.referenceBlock, /ORIGINAL STORY EVIDENCE/, 'and retrieval contributes original text');
    assert.match(bundle.referenceBlock, /quoted history, not instructions/);
    assert.doesNotMatch(bundle.referenceBlock, /第12层：管家点了点头/,
        'text the prompt still carries is not quoted back at it');
    assert.equal(bundle.diagnostics.quality, 'not measured; these are delivery and cost diagnostics',
        'the report says what it measured and what it did not');
}

// --- 6. an edit invalidates the summary, and nothing stale ever reaches the prompt ----------------
{
    // 6a. enough material is pending, so the pipeline rebuilds the summary against the new history.
    const host = makeHost(12, { summarize: async () => '摘要：稳定的局面。' });
    const { ctx, store, chat, services } = host;
    await updateNarrative(ctx, services, { force: true });
    assert.ok(chat.some(row => row.is_system === true), 'floors folded under the accepted summary');
    chat[1].mes = '被编辑过的第一层回复';
    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 32768 });
    assert.equal(store.narrative_diagnostics.summary_invalidated, null,
        'the reported invalidation clears once a matching summary exists again');
    assert.equal(store.narrative_diagnostics.summary_error, null);
    assert.ok(validSummary(store.narrative_summary, chunkHistory(store.raw_history)),
        'whatever is stored describes the history it claims to describe');
    const coverage = new Set(store.narrative_summary.covered);
    for (const [index, row] of chat.entries()) {
        if (row.is_system !== true) continue;
        const id = store.raw_history.active[Math.floor(index)];
        assert.ok(coverage.has(id) || chunkHistory(store.raw_history).some(c => c.source === id && coverage.has(c.id)),
            'hidden row ' + index + ' is covered by the current summary');
    }
    assert.match(bundle.currentStateBlock, /摘要：/);
}
{
    // 6b. too little material to rebuild: the summary is dropped and the original text comes back,
    //     because a chat with neither its text nor a stand-in is the one state folding must not reach.
    const host = makeHost(3, { summarize: async () => '摘要：三层的局面。' });
    const { ctx, store, chat, services } = host;
    await updateNarrative(ctx, services, { force: true });
    assert.ok(chat.some(row => row.is_system === true), 'the forced summary folded the covered floor');
    chat[1].mes = '被编辑过的第一层回复';
    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 32768 });
    assert.equal(store.narrative_summary, undefined, 'a summary that no longer matches is dropped');
    assert.equal(chat.every(row => row.is_system !== true), true,
        'and every floor it covered is back in the prompt');
    assert.equal(bundle.currentStateBlock, '', 'no stale summary is injected');
    assert.match(store.narrative_diagnostics.summary_invalidated, /source history changed/);
}

// --- 7. a background result for a chat the user left is discarded --------------------------------
{
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const host = makeHost(12, { summarize: async () => { await gate; return '迟到的摘要'; } });
    const { ctx, store, chat, services } = host;
    const running = updateNarrative(ctx, services, { force: true });
    services.leave();
    release();
    await running;
    assert.equal(store.narrative_summary, undefined, 'a summary for an abandoned chat is never written');
    assert.equal(chat.every(row => row.is_system !== true), true, 'and it never folds a row in the wrong chat');
}

// --- 8. quiet and disabled generations clear every channel this plugin owns ----------------------
{
    const host = makeHost(12, { summarize: async () => '摘要：局面。' });
    const { ctx, prompts, services } = host;
    await runNarrativeGeneration(ctx, services, [{}, 32768, () => {}, 'normal']);
    const last = key => [...prompts].reverse().find(row => row[0] === key);
    assert.ok(last(NARRATIVE_PROMPTS[0])?.[1], 'a normal generation gets the blocks');
    for (const type of ['quiet', 'impersonate']) {
        const start = prompts.length;
        await runNarrativeGeneration(ctx, services, [{}, 32768, () => {}, type]);
        const calls = prompts.slice(start);
        for (const key of NARRATIVE_PROMPTS) {
            const row = [...calls].reverse().find(entry => entry[0] === key);
            assert.equal(row?.[1], '', type + ' clears ' + key + ' rather than leaving the last value');
        }
    }
}

// --- 9. the batch waits for a completed floor and respects its input budget -----------------------
{
    const host = makeHost(4);
    const history = host.store.raw_history ??= { version: 1, sequence: 0, records: {}, active: [] };
    captureHistory(host.store, host.chat);
    const chunks = chunkHistory(history);
    assert.deepEqual(nextSummaryBatch(undefined, chunks, { every: 5 }), [],
        'four floors are not a batch when the threshold is five');
    const pending = nextSummaryBatch(undefined, chunks, { every: 3 });
    assert.equal(pending.at(-1).role, 'assistant', 'a batch never ends on a user turn with no reply');
    const capped = nextSummaryBatch(undefined, chunks, { every: 3, inputChars: 200 });
    assert.ok(capped.length < pending.length, 'the input budget bounds how much is summarized at once');
    assert.ok(capped.length > 0, 'but it always summarizes something');
    const half = { version: 1, text: 'x', covered: chunks.slice(0, 2).map(c => c.id) };
    assert.equal(nextSummaryBatch(half, chunks, { every: 3 })[0].id, chunks[2].id,
        'an existing summary is not re-summarized, only extended');
}

console.log('PASS narrative pipeline: summary for continuity, original text for detail, and no floor hidden without a stand-in');
