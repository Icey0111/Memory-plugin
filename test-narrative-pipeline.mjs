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
    nextSummaryBatch, applyNarrativeFolds, parseAnchors, mergeAnchors, mergeKnowledge, formatAnchors,
    RAW_CHUNK_SIZE, evidenceSlots, DENSE_FUSION_WEIGHT, entityTargets, entityRecall,
    profileTargets, profileRecall } from './raw-history.js';
import { baselineTermCounts, tokenizeBaselineText } from './baseline-index.js';
import { buildRerankRequest, parseRerankResponse, requestRerank } from './v55-rerank.js';
import { buildNarrativeContext, updateNarrative, runNarrativeGeneration, narrativeSettings,
    readNarrativeReport, NARRATIVE_PROMPTS } from './narrative-runtime.js';

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
    await updateNarrative(ctx, services); // Background event commits the replacement; reads never summarize.
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
    await updateNarrative(ctx, services);
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

// --- 10. the chat store object is replaced on every persist --------------------------------------
// The store projection replaces ctx.chatMetadata[KEY] when it writes, so any reference captured before
// a persist points at a retired object and writes through it disappear. That is how the reason
// original-text vectors were unavailable went missing while the failure itself was still reported.
{
    let summarizerCalls = 0;
    const host = makeHost(12, { summarize: async () => { summarizerCalls += 1; return '摘要：稳定的局面。'; } });
    const { ctx, chat, services } = host;
    ctx.saveMetadataDebounced = () => { ctx.chatMetadata[KEY] = { ...ctx.chatMetadata[KEY] }; };

    // Two concurrent passes for one chat must share one job, or the chat is summarized twice over.
    const first = updateNarrative(ctx, services, { force: true });
    const second = updateNarrative(ctx, services, { force: true });
    await Promise.all([first, second]);
    assert.equal(summarizerCalls, 1, 'concurrent passes for one chat share a single summary job');

    const live = ctx.chatMetadata[KEY];
    assert.ok(live.narrative_summary, 'the summary lands in the live store, not in the object it replaced');
    assert.equal(live.narrative_diagnostics.vector_available, false);
    assert.match(live.narrative_diagnostics.vector_reason, /vector disabled in this test/,
        'the reason the index is unavailable survives the store swap');
    assert.ok(chat.some(row => row.is_system === true), 'and folding still happened');

    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 32768 });
    assert.match(bundle.currentStateBlock, /摘要：稳定的局面/);
    assert.equal(ctx.chatMetadata[KEY].narrative_diagnostics.quality,
        'not measured; these are delivery and cost diagnostics',
        'the delivery report lands in the live store too');
}

// --- 11. the two quiet failures are reported, not discovered later --------------------------------
{
    // A summary job that keeps failing does not break the story - the floors stay visible, which is the
    // safe direction - so nothing throws and nobody notices. It is counted and it is announced.
    const host = makeHost(12, { settings: { narrative_summary_failure_warn: 2 },
        summarize: async () => { throw new Error('provider down'); } });
    const { ctx, services } = host;
    await updateNarrative(ctx, services, { force: true });
    await updateNarrative(ctx, services, { force: true });
    let report = readNarrativeReport(ctx);
    assert.equal(report.summary_failures, 2, 'consecutive failures are counted');
    assert.equal(report.warnings.length, 1, 'and announced once the threshold is reached');
    assert.match(report.warnings[0], /连续 2 次失败/);
    assert.match(report.warnings[0], /provider down/, 'the warning carries the last error');
    services.summarize = async () => '摘要：恢复了。';
    await updateNarrative(ctx, services, { force: true });
    report = readNarrativeReport(ctx);
    assert.equal(report.summary_failures, 0, 'a success clears the run');
    assert.deepEqual(report.warnings, [], 'and the warning with it');
    assert.equal(report.pending_tokens, 0, 'nothing is left unsummarized');
}
{
    // The other quiet failure: the tail grows because the threshold is never reached.
    // Long enough floors that the tail crosses the threshold the settings clamp allows (200 tokens).
    const host = makeHost(3, { settings: { narrative_every: 20, narrative_pending_warn_tokens: 200 } });
    host.chat.forEach(row => { row.mes += '填充'.repeat(80); });
    const { ctx, services } = host;
    await updateNarrative(ctx, services);
    const report = readNarrativeReport(ctx);
    assert.equal(report.summary_valid, false, 'the fixture has no summary yet');
    assert.equal(report.pending_floors, 3, 'the tail is counted in floors');
    assert.ok(report.pending_tokens > 200, 'and in tokens: ' + report.pending_tokens);
    assert.match(report.warnings[0], /尚未进入摘要/, 'and it is announced with its size');
    const quiet = makeHost(3, { settings: { narrative_every: 20, narrative_pending_warn_tokens: 200000 } });
    assert.deepEqual(readNarrativeReport(quiet.ctx).warnings, [], 'a threshold above the tail stays quiet');
}

// --- 12. continuity anchors survive rewrites, and silence is not a resolution ---------------------
{
    const PROSE = '局面：主角在大厅与管家交谈。';
    const replies = [
        PROSE + '\n【锚点】\n- 承诺 | 林舟答应苏晚不把钥匙的事说出去\n- 秘密 | 钥匙来自林舟\n【已解决】\n无',
        PROSE + '\n【锚点】\n- 承诺 | 林舟答应苏晚不把钥匙的事说出去\n- 秘密 | 钥匙来自林舟\n- 所有权 | 钥匙现在在苏晚手里\n【已解决】\n无',
        PROSE + '\n【锚点】\n- 秘密 | 钥匙来自林舟\n- 所有权 | 钥匙现在在苏晚手里\n【已解决】\n- 承诺 | 林舟答应苏晚不把钥匙的事说出去',
        PROSE,   // the model stops emitting the sections altogether
    ];
    const prompts = [];
    let call = 0;
    const host = makeHost(12, { summarize: async (ctx, prompt) => { prompts.push(prompt); return replies[Math.min(call++, replies.length - 1)]; } });
    const { ctx, services } = host;
    const addFloor = n => {
        host.chat.push({ name: 'User', is_user: true, mes: '第' + n + '层：主角走回大厅。' });
        host.chat.push({ name: 'Seraphina', is_user: false, mes: '第' + n + '层：管家把钥匙递过来。' });
    };

    await updateNarrative(ctx, services, { force: true });
    let report = readNarrativeReport(ctx);
    assert.equal(report.anchors_active, 2, 'the anchors the summarizer listed are recorded');
    assert.match(prompts[0], /【当前锚点】/, 'the summarizer is given the anchors it must carry forward');

    addFloor(13); addFloor(14);
    await updateNarrative(ctx, services, { force: true });
    report = readNarrativeReport(ctx);
    assert.equal(report.anchors_active, 3, 'a new anchor is added while the others carry forward');
    assert.match(prompts[1], /林舟答应苏晚不把钥匙的事说出去/, 'and the carrying list is fed back verbatim');

    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 32768 });
    assert.match(bundle.currentStateBlock, /BINDING CONTINUITY ANCHORS/,
        'anchors are injected with the summary, not left to the prose');
    assert.match(bundle.currentStateBlock, /\[承诺\] 林舟答应苏晚不把钥匙的事说出去/);

    addFloor(15); addFloor(16);
    await updateNarrative(ctx, services, { force: true });
    report = readNarrativeReport(ctx);
    assert.equal(report.anchors_active, 2, 'an explicitly resolved anchor leaves the active list');
    assert.equal(report.anchors_resolved, 1, 'and is recorded as resolved rather than forgotten');

    addFloor(17); addFloor(18);
    await updateNarrative(ctx, services, { force: true });
    report = readNarrativeReport(ctx);
    assert.equal(report.anchor_parse, 'missing', 'the format slip is recorded');
    assert.equal(report.anchors_active, 2, 'a missing section changes nothing: silence is not a resolution');
    assert.equal(report.warnings.some(text => /锚点已连续多轮/.test(text)), true,
        'but the anchors the model stopped repeating are announced');

    // The injection budget is separate from the summary budget, and it never sends half a line.
    const tight = makeHost(12, { settings: { narrative_anchor_tokens: 0 },
        summarize: async () => replies[1] });
    await updateNarrative(tight.ctx, tight.services, { force: true });
    const clipped = await buildNarrativeContext(tight.ctx, tight.services, { contextSize: 32768 });
    assert.doesNotMatch(clipped.currentStateBlock, /\[承诺\]/, 'no anchor is injected without budget for it');
    assert.equal(clipped.diagnostics.anchors_truncated, 3, 'and the omission is counted');
    assert.equal(clipped.diagnostics.warnings.some(text => /锚点超出注入预算/.test(text)), true);
}

// --- 13. evidence packing merges, shares and trims instead of dropping ---------------------------------
// Found by measuring a hand-written question set: the answer was in the candidate list at rank 2 and
// never reached the prompt. Three separate ways the packer threw it away, each pinned here.
{
    const rowOf = (id, text, index) => ({ id, index, role: 'assistant', name: 'A', text });
    const chunkOf = (source, start, end, index) => ({ id: source + ':' + start + ':' + end, source, start, end,
        index, role: 'assistant', name: 'A', text: '', hash: 1, retrievalText: '' });
    const historyOf = records => ({ version: 1, sequence: Object.keys(records).length,
        active: Object.keys(records), records });

    // 13a. a long first candidate must not spend the whole allowance.
    const long = historyOf({ raw_1: rowOf('raw_1', '甲'.repeat(400), 1),
        raw_2: rowOf('raw_2', '乙'.repeat(100) + '针' + '乙'.repeat(200), 2) });
    const shared = packRawEvidence([{ chunk: chunkOf('raw_1', 0, 400, 1) }, { chunk: chunkOf('raw_2', 0, 300, 2) }],
        long, { maxTokens: 600, maxEntries: 4, visibleSources: new Set() });
    assert.match(shared.text, /针/, 'the second candidate is quoted even though the first wanted the whole budget');
    assert.ok(shared.tokens <= 600, 'and the budget holds: ' + shared.tokens);

    // 13b. two hits on one message merge; the second one is not a duplicate to discard.
    const merged = historyOf({ raw_1: rowOf('raw_1', '甲'.repeat(180) + '针', 1) });
    const overlapping = packRawEvidence([{ chunk: chunkOf('raw_1', 0, 40, 1) }, { chunk: chunkOf('raw_1', 30, 181, 1) }],
        merged, { maxTokens: 1200, maxEntries: 4, visibleSources: new Set() });
    assert.match(overlapping.text, /针/, 'an overlapping second hit extends the first span instead of being dropped');

    // 13c. a candidate too long for its share is trimmed, not skipped.
    const huge = historyOf({ raw_1: rowOf('raw_1', '丙'.repeat(2000), 1) });
    const trimmed = packRawEvidence([{ chunk: chunkOf('raw_1', 0, 2000, 1) }], huge,
        { maxTokens: 200, maxEntries: 4, visibleSources: new Set() });
    assert.ok(trimmed.text.length > 0, 'a span longer than its share is trimmed, not dropped');
    assert.ok(trimmed.tokens <= 200, 'and it fits the budget: ' + trimmed.tokens);
    assert.ok(trimmed.sources[0].end < 2000, 'the quoted range is the trimmed one');

    // 13d/13e. The same text is never quoted twice, and never at all when the prompt already shows it.
    // Found on a 100-floor live run whose user turn was always "继续。": all five slots went to five
    // verbatim copies of that same short row, so the evidence block carried the user's filler five times
    // and the story not once. Whether the copies come from the vector channel, the reranker or the fusion,
    // a repeated row is worth nothing to quote, and the packer can settle that without judging relevance.
    const filler = '继续。[导演：请写一段 300 到 400 字的回复，包含环境描写、动作细节、内心独白与对白。]';
    const informative = '针在这里：一只停在四点一刻的黄铜潮标，底座刻着庚子年重修。';
    const rows13 = historyOf({ raw_0: rowOf('raw_0', filler, 0), raw_1: rowOf('raw_1', filler, 1),
        raw_2: rowOf('raw_2', filler, 2), raw_3: rowOf('raw_3', filler, 3),
        raw_4: rowOf('raw_4', informative, 4) });
    // chunkOf takes (source, start, end, index); the end is the row's own length so nothing is trimmed.
    const ranked13b = ['raw_1', 'raw_2', 'raw_3', 'raw_4'].map((source, i) => ({
        chunk: chunkOf(source, 0, rows13.records[source].text.length, i + 1) }));
    const dedup = packRawEvidence(ranked13b, rows13, { maxTokens: 1000, maxEntries: 5, visibleSources: new Set() });
    assert.equal(dedup.sources.filter(source => source.source !== 'raw_4').length, 1,
        'a repeated row is quoted once, not once per copy');
    assert.match(dedup.text, /针在这里/, 'and the slot that frees goes to the message that says something');
    // The copies are different rows, so the row-level skip cannot catch them: the visible row they copy is.
    const carried = packRawEvidence(ranked13b, rows13, { maxTokens: 1000, maxEntries: 5,
        visibleSources: new Set(['raw_0']) });
    assert.doesNotMatch(carried.text, /继续/, 'text the prompt already carries is not quoted back under another id');
    assert.match(carried.text, /针在这里/, 'while the informative row is still quoted');
}

// --- 14. knowledge boundaries are carried, not re-derived -----------------------------------------
// The retired fact path filtered by known_by: it could hide a line from a character who should not
// know it. With facts out of the prompt there is nothing left to filter per line, so the boundary
// becomes an explicit, inspectable part of the summary instead of an implicit one - and it is carried
// the same way the anchors are, because a character silently learning a secret is a story change.
{
    const PROSE = '局面：两人在地窖里。';
    const withBoundaries = PROSE
        + '\n【锚点】\n- 秘密 | 钥匙来自林舟\n【已解决】\n无'
        + '\n【知情边界】\n- 苏晚 | 不知道 | 钥匙来自林舟\n- 林舟 | 知道 | 钥匙现在在苏晚手里';
    let reply = withBoundaries;
    const host = makeHost(12, { summarize: async () => reply });
    const { ctx, services } = host;
    const addFloor = n => {
        host.chat.push({ name: 'User', is_user: true, mes: '第' + n + '层：两人继续说话。' });
        host.chat.push({ name: 'Seraphina', is_user: false, mes: '第' + n + '层：灯芯烧短了一截。' });
    };

    await updateNarrative(ctx, services, { force: true });
    let report = readNarrativeReport(ctx);
    assert.equal(report.knowledge_entries, 2, 'the boundaries the summarizer listed are recorded');
    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 32768 });
    assert.match(bundle.currentStateBlock, /KNOWLEDGE BOUNDARIES/,
        'boundaries are injected as their own block, not left inside the prose');
    assert.ok(bundle.currentStateBlock.includes('苏晚/不知道] 钥匙来自林舟'),
        'including what a character must not act on, with the state in the label');

    // The format slips: the boundaries stay, and they are reported as unrepeated.
    reply = PROSE;
    addFloor(13); addFloor(14);
    await updateNarrative(ctx, services, { force: true });
    report = readNarrativeReport(ctx);
    assert.equal(report.knowledge_entries, 2, 'a missing section does not delete a boundary');
    assert.equal(report.knowledge_unconfirmed, 2, 'it flags them as unrepeated instead');

    // And the block has its own budget: it sends whole lines or none.
    const tight = makeHost(12, { settings: { narrative_knowledge_tokens: 0 }, summarize: async () => withBoundaries });
    await updateNarrative(tight.ctx, tight.services, { force: true });
    const clipped = await buildNarrativeContext(tight.ctx, tight.services, { contextSize: 32768 });
    assert.doesNotMatch(clipped.currentStateBlock, /KNOWLEDGE BOUNDARIES/, 'no budget, no block');
    assert.equal(clipped.diagnostics.knowledge_entries, 2, 'but the entries are still recorded');
}

// --- 15. ten rewrites: continuity survives, and the resident cost does not drift ------------------
// The end-to-end question the roadmap asked for: after many regenerations, is the thing the story
// depends on still there? The summarizer here is deliberately lossy in prose - it keeps one sentence -
// and faithful only to the two structured sections, which is exactly the drift the anchors exist to
// survive. A model that also drops the sections is covered by section 12.
{
    const ANCHOR = '- 承诺 | 林舟答应苏晚不把钥匙的事说出去';
    const BOUNDARY = '- 苏晚 | 不知道 | 钥匙来自林舟';
    let pass = 0;
    const host = makeHost(12, { summarize: async () => {
        pass += 1;
        return '局面：第' + pass + '次重写之后的场景。\n【锚点】\n' + ANCHOR + '\n【已解决】\n无'
            + '\n【知情边界】\n' + BOUNDARY;
    } });
    const { ctx, chat, services } = host;
    const addFloor = n => {
        chat.push({ name: 'User', is_user: true, mes: '第' + n + '层：两人继续上路。' });
        chat.push({ name: 'Seraphina', is_user: false, mes: '第' + n + '层：风把火吹歪了一下。' });
    };
    for (let round = 1; round <= 10; round += 1) {
        addFloor(12 + round);
        await updateNarrative(ctx, services, { force: true });
    }
    const report = readNarrativeReport(ctx);
    assert.equal(pass, 10, 'the fixture really ran ten summary passes');
    assert.equal(report.summary_failures, 0);
    assert.equal(report.anchors_active, 1, 'the promise survived ten rewrites that dropped every prose detail');
    assert.equal(report.anchors_resolved, 0);
    assert.equal(report.knowledge_entries, 1, 'and so did the knowledge boundary');
    assert.equal(report.summary_valid, true, 'while coverage stayed valid against the growing history');
    const bundle = await buildNarrativeContext(ctx, services, { contextSize: 32768 });
    assert.match(bundle.currentStateBlock, /钥匙的事说出去/, 'and it is still injected');
    assert.match(bundle.currentStateBlock, /KNOWLEDGE BOUNDARIES/);
    // The resident cost is the configured budget, not a function of how many times the summary was
    // rewritten: the failure mode this pins is a summary that grows by accretion across passes.
    const resident = bundle.diagnostics.summary_tokens + bundle.diagnostics.anchors_active * 20;
    assert.ok(resident <= 900, 'the resident block stays inside its budget after ten rewrites: ' + resident);
    assert.equal(chat.filter(row => row.is_system === true).length > 0, true, 'and covered floors are still folded');
}

// --- 16. the same anchor spelled two ways is one anchor ------------------------------------------
// Found on a live 40-floor run: the model wrote "- 身份 | ..." on one pass and "- [身份] ..." on the
// next. The second parsed as kind "其他" with the bracket inside the text, so the two spellings
// coexisted, the list grew from 11 real entries to 19, and the panel warned that eight anchors "had not
// been repeated" - they were duplicates of the ones that had.
{
    const first = parseAnchors('局面。\n【锚点】\n- 身份 | Seraphina 自称森林守护者。\n【已解决】\n无');
    const second = parseAnchors('局面。\n【锚点】\n- [身份] Seraphina 自称森林守护者。\n【已解决】\n无');
    assert.deepEqual(first.anchors[0], second.anchors[0], 'both spellings parse to the same entry');
    let state = mergeAnchors(undefined, first, 1);
    state = mergeAnchors(state, second, 2);
    assert.equal(state.active.length, 1, 'so a rewrite that changes the spelling does not duplicate it');
    assert.equal(state.active[0].passes, 2, 'and it counts as confirmed twice, not as one unconfirmed');
    assert.equal(state.active[0].unconfirmed, 0);

    // A boundary the model states with and without its state word is also one boundary.
    const withState = parseAnchors('局面。\n【知情边界】\n- 苏晚 | 不知道 | 钥匙来自林舟');
    const without = parseAnchors('局面。\n【知情边界】\n- [苏晚] | 钥匙来自林舟');
    let knowledge = mergeKnowledge(undefined, withState, 1);
    knowledge = mergeKnowledge(knowledge, without, 2);
    assert.equal(knowledge.entries.length, 1, 'the state word does not fork the boundary');
    assert.equal(knowledge.entries[0].kind, '苏晚', 'the newest spelling wins the label');
}

// --- 17. the lexical score saturates and normalises, and both channels stay readable ---------------
// The old score was presence only: no term frequency, no length. It cost no recall - on 52 hand-written
// questions one question moved and none were won - but it spent 904 tokens a query on the probe set
// where a score that saturates spends 737. Both properties are pinned, because 'it did not lose recall'
// is only a fair report while the arithmetic really is BM25.
{
    const chunkOf = (text, index) => ({ id: 'raw_' + index + ':0:' + text.length, source: 'raw_' + index,
        start: 0, end: text.length, index, role: 'assistant', name: 'A', text, hash: index, retrievalText: text });
    // Same length, one mention against ten.
    const repeated = chunkOf('银针'.repeat(10) + '布'.repeat(90), 1);
    const once = chunkOf('银针' + '布'.repeat(108), 2);
    assert.equal(repeated.text.length, once.text.length, 'the pair differs only in how often the term appears');
    const flat = rankRawChunks([repeated, once], '银针', [], { scorer: 'idf' });
    assert.equal(flat[0].lexical, flat[1].lexical, 'the old score could not see ten mentions');
    const bm25 = rankRawChunks([repeated, once], '银针');
    assert.ok(bm25[0].lexical > bm25[1].lexical, 'BM25 sees them');
    assert.ok(bm25[0].lexical < 10 * bm25[1].lexical,
        'and saturates rather than scaling with them: ' + bm25[0].lexical.toFixed(3) + ' against ' + bm25[1].lexical.toFixed(3));

    // Same single mention, different length.
    const short = chunkOf('银针' + '布'.repeat(9), 3);
    const long = chunkOf('银针' + '布'.repeat(399), 4);
    const unnormalised = rankRawChunks([long, short], '银针', [], { scorer: 'idf' });
    assert.equal(unnormalised[0].lexical, unnormalised[1].lexical, 'the old score had no length term');
    assert.equal(rankRawChunks([long, short], '银针')[0].chunk.id, short.id, 'BM25 ranks the short chunk first');

    // Both channel readings survive fusion, which is what an entropy or margin rule has to read: a
    // fused RRF distribution has a margin of 0.02 for every question and cannot support one.
    const fused = rankRawChunks([short, long], '银针', [{ hash: 4, score: 0.9 }]);
    const dense = fused.find(row => row.chunk.id === long.id);
    assert.equal(dense.vector.rank, 0, 'the dense channel records its rank');
    assert.equal(dense.vector.score, 0.9, 'and its score, not only its rank');
    assert.equal(fused.find(row => row.chunk.id === short.id).vector, null,
        'a chunk the channel never returned stays null rather than zero');
    assert.ok(fused.every(row => row.lexical > 0), 'and the lexical reading is on every row');

    // The dense channel gets a weak vote, not an equal one. Measured with the Jina retrieval-task vectors
    // the plugin embeds with: dense alone scored 37% against the lexical channel's 63%, and at equal
    // weight the hybrid lost five points against lexical alone while raising candidate coverage. Sweeping
    // the weight gave 63% at 0, 65% at 0.1, 62% at 0.2, 58% at 0.35 and 58% at 1.0 - the shipped setting.
    const denseInput = [{ hash: 4, score: 0.9 }];
    const scoreOf = (rows, id) => rows.find(row => row.chunk.id === id).score;
    const weak = rankRawChunks([short, long], '银针', denseInput, { denseWeight: DENSE_FUSION_WEIGHT });
    const equal = rankRawChunks([short, long], '银针', denseInput, { denseWeight: 1 });
    const silent = rankRawChunks([short, long], '银针', denseInput, { denseWeight: 0 });
    assert.equal(DENSE_FUSION_WEIGHT < 0.5, true, 'the shipped default is a weak vote: ' + DENSE_FUSION_WEIGHT);
    assert.ok(scoreOf(weak, long.id) < scoreOf(equal, long.id), 'a weak weight moves the fused rank score less');
    assert.deepEqual(silent.map(row => [row.chunk.id, row.score]), rankRawChunks([short, long], '银针').map(row => [row.chunk.id, row.score]),
        'weight zero ranks exactly as lexical-only does, whatever the dense channel returned');
    assert.equal(rankRawChunks([short, long], '银针', [], { denseWeight: 1 }).length, 2, 'and no dense rows is still lexical only');

    // The scorer tokenizes exactly as the index does. Two tokenizers would rank different documents.
    const counts = baselineTermCounts('Seraphina 走进钟楼旅店');
    assert.deepEqual([...counts.keys()], tokenizeBaselineText('Seraphina 走进钟楼旅店'));
    assert.equal(counts.get('旅店'), 1, 'and it counts rather than deduplicates');
}

// --- 18. the packer says why it dropped something, and both policies keep the shared rules ----------
// The ruler has to separate 'the answer was never a candidate' from 'the answer was a candidate the
// budget discarded', so the packer reports one outcome per candidate. The submodular policy lost its
// A/B against the greedy one - 54% against 62% answer-in-context on 52 hand-written questions, with the
// difference unresolvable at that n (7 against 3 discordant, p=0.34) - so it is not the default. Losing
// an A/B is a reason not to ship a policy, not a reason to leave it untested; the entity-versus-oblique
// split it produced (86% against 71% on entity, 49% against 60% on oblique) is why it is still here.
{
    const rowOf = (id, text, index) => ({ id, index, role: 'assistant', name: 'A', text });
    const chunkOf = source => ({ id: source + ':0:300', source, start: 0, end: 300, index: Number(source.slice(4)),
        role: 'assistant', name: 'A', text: '甲'.repeat(300), hash: Number(source.slice(4)), retrievalText: '甲'.repeat(300) });
    const ids = ['raw_1', 'raw_2', 'raw_3', 'raw_4', 'raw_5'];
    // Five interchangeable rows, but not five copies of one string: the packer now refuses to quote the
    // same text twice, so a fixture of identical rows would test the repeat rule instead of the slot
    // allocation and the trace outcomes this section is about. The marker keeps each row distinct and
    // the same length.
    const history = { version: 1, sequence: 5, active: [...ids],
        records: Object.fromEntries(ids.map((id, i) => [id, rowOf(id, '甲'.repeat(298) + '乙' + (i + 1), i + 1)])) };
    const ranked = ids.map((id, i) => ({ chunk: chunkOf(id), score: 1 / (i + 1), lexical: 1 / (i + 1) }));
    const known = new Set(['included', 'entry_cap', 'budget', 'too_long', 'not_selected']);

    const greedy = packRawEvidence(ranked, history, { maxTokens: 600, maxEntries: 2, visibleSources: new Set() });
    assert.equal(greedy.policy, 'greedy', 'the default is the policy the runtime uses');
    assert.equal(greedy.sources.length, 2, 'two slots, two spans');
    assert.equal(greedy.trace.length, 5, 'and every candidate is accounted for');
    assert.deepEqual(greedy.trace.filter(row => row.outcome === 'included').map(row => row.slot), [0, 1]);
    assert.equal(greedy.trace.filter(row => row.outcome === 'entry_cap').length, 3,
        'the rest name the rule that stopped them');
    for (const row of greedy.trace) assert.equal(known.has(row.outcome), true, 'unknown outcome ' + row.outcome);
    assert.ok(greedy.tokens <= 600, 'and the budget holds: ' + greedy.tokens);

    // Submodular obeys the same budget and the same one-outcome-per-candidate contract, and it is
    // deterministic: a selection that changed between two identical runs could not be A/B tested.
    const ask = '甲乙丙丁戊分别在哪里？';
    const select = () => packRawEvidence(ranked, history, { maxTokens: 600, maxEntries: 2,
        visibleSources: new Set(), policy: 'submodular', query: ask });
    const first = select();
    const second = select();
    assert.equal(first.policy, 'submodular');
    assert.ok(first.sources.length >= 1 && first.sources.length <= 2, 'the snippet cap holds: ' + first.sources.length);
    assert.ok(first.tokens <= 600, 'and so does the budget: ' + first.tokens);
    assert.deepEqual(first.sources, second.sources, 'the same input selects the same spans');
    assert.equal(first.trace.length, 5);
    for (const row of first.trace) assert.equal(known.has(row.outcome), true, 'unknown outcome ' + row.outcome);
    assert.equal(first.trace.filter(row => row.outcome === 'included').length, first.sources.length,
        'the trace and the quoted spans agree on what was included');

    // The slot count follows the budget, one slot per 200 tokens, capped at eight. A share below about 160
    // cannot cover a merged envelope, which is what fixes the floor; above that the divisor is not a price,
    // because the packer spends only what its candidates need. Measured by replaying a recorded 26-turn chat
    // at a fixed 1000-token budget: 3 slots spent 611 tokens a turn and 6 slots spent 604, while
    // situation-term recall went from 62% to 94%. The offline question set agrees that more slots do not
    // hurt: 97% answer-in-context at 3 and 4, 100% at 5 and 6.
    assert.deepEqual([100, 600, 1000, 1599, 1600, 2400, 9000].map(evidenceSlots), [1, 3, 5, 7, 8, 8, 8]);
    const derived = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: new Set() });
    assert.equal(derived.sources.length, 5, 'a 1000-token budget reaches five of the candidates');
    const wide = packRawEvidence(ranked, history, { maxTokens: 2400, visibleSources: new Set() });
    assert.equal(wide.sources.length, 5, 'a wider budget is capped by the candidates it has');
    const pinned = packRawEvidence(ranked, history, { maxTokens: 1000, maxEntries: 4, visibleSources: new Set() });
    assert.equal(pinned.sources.length, 4, 'an explicit slot count still overrides the derivation');

    // A policy nobody implements falls back to the one the runtime uses, not to nothing.
    const unknown = packRawEvidence(ranked, history, { maxTokens: 600, maxEntries: 2,
        visibleSources: new Set(), policy: 'magic', query: ask });
    assert.equal(unknown.policy, 'greedy');
    assert.equal(unknown.sources.length, 2);
}

// --- 19. the rerank stage reorders the shortlist, and fails open when it cannot --------------------
// Measured offline: reranking the fused shortlist with a cross-encoder raised answer-in-context from 69% to
// 87% at 52 questions (dev_docs/06_retrieval_research.md section 14). It is also the one stage that can lose
// the prompt entirely, because it happens after retrieval and before packing, so the contract is that it
// either reorders real candidates or does nothing at all.
{
    const body = buildRerankRequest({ model: 'jina-reranker-v3', query: '问', documents: ['甲', '乙', '丙'], topN: 2 });
    assert.deepEqual(body, { model: 'jina-reranker-v3', query: '问', documents: ['甲', '乙', '丙'], top_n: 2 });
    assert.throws(() => buildRerankRequest({ model: '', query: 'q', documents: ['a'] }), /重排模型/);
    assert.throws(() => buildRerankRequest({ model: 'm', query: '', documents: ['a'] }), /重排查询/);
    assert.throws(() => buildRerankRequest({ model: 'm', query: 'q', documents: [] }), /重排候选/);
    assert.throws(() => buildRerankRequest({ model: 'm', query: 'q', documents: [''] }), /重排候选/);

    const order = parseRerankResponse({ results: [{ index: 2, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.2 }, { index: 1, relevance_score: 0.5 }] }, 3);
    assert.deepEqual(order.map(row => row.index), [2, 1, 0], 'the order is the score order');
    // A provider that answers with an index it was never given, the same index twice, or a score that is not
    // a number would reorder the prompt around nothing. Those rows are dropped instead of trusted.
    const cleaned = parseRerankResponse({ results: [{ index: 9, relevance_score: 1 }, { index: -1, relevance_score: 1 },
        { index: 0, relevance_score: 0.4 }, { index: 0, relevance_score: 0.9 }, { index: 1, relevance_score: '快' },
        { index: 2, relevance_score: 0.3 }] }, 4);
    assert.deepEqual(cleaned.map(row => row.index), [0, 2], 'out-of-range, duplicate and non-numeric rows are dropped');
    assert.throws(() => parseRerankResponse({}, 2), /results/);
    assert.throws(() => parseRerankResponse({ results: [{ index: 7, relevance_score: 1 }] }, 2), /可用候选/);

    const calls = [];
    const ok = await requestRerank({ baseUrl: 'https://api.jina.ai', apiKey: 'k', model: 'm', query: 'q',
        documents: ['甲', '乙'],
        fetchImpl: async (url, init) => { calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
            return { ok: true, json: async () => ({ results: [{ index: 1, relevance_score: 0.8 },
                { index: 0, relevance_score: 0.1 }] }) }; } });
    assert.equal(calls[0].url, 'https://api.jina.ai/v1/rerank', 'the base URL is normalised the same way embeddings are');
    assert.equal(calls[0].auth, 'Bearer k');
    assert.equal(calls[0].body.documents.length, 2);
    assert.deepEqual(ok.map(row => row.index), [1, 0]);
    await assert.rejects(() => requestRerank({ baseUrl: '', apiKey: 'k', model: 'm', query: 'q', documents: ['a'] }), /重排地址/);
    await assert.rejects(() => requestRerank({ baseUrl: 'https://x', apiKey: '', model: 'm', query: 'q', documents: ['a'] }), /API Key/);
    await assert.rejects(() => requestRerank({ baseUrl: 'https://x', apiKey: 'k', model: 'm', query: 'q', documents: ['a'],
        fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'slow down' }) }), /HTTP 429/);

    // Through the pipeline: a failing reranker must leave the fused order, and it must say so.
    const host = makeHost(12, { settings: { narrative_rerank_model: 'test-rerank', narrative_evidence_tokens: 600 } });
    const broken = { ...host.services, rerank: () => ({ supported: true, model: 'test-rerank',
        rerank: async () => { throw new Error('boom'); } }) };
    await updateNarrative(host.ctx, host.services);
    const failed = await buildNarrativeContext(host.ctx, broken, { contextSize: 32768 });
    assert.equal(failed.diagnostics.rerank_used, false, 'a failing reranker leaves the fused order alone');
    assert.match(String(failed.diagnostics.rerank_error), /boom/, 'and the reason is reported, not swallowed');
    const working = { ...host.services, rerank: () => ({ supported: true, model: 'test-rerank',
        rerank: async (query, documents) => documents.map((_, index) => ({ index, score: 1 - index * 0.01 })) }) };
    const used = await buildNarrativeContext(host.ctx, working, { contextSize: 32768 });
    assert.equal(used.diagnostics.rerank_used, true, 'a working reranker is used');
    assert.equal(used.diagnostics.rerank_error, null);
    assert.equal(used.diagnostics.rerank_model, 'test-rerank');
    const off = await buildNarrativeContext(host.ctx, host.services, { contextSize: 32768 });
    assert.equal(off.diagnostics.rerank_used, false, 'and an install with no model never calls one');
    // A live run spent one rerank call per turn while every floor was still unfolded, which is a call
    // that cannot change anything: no floor is hidden, so no candidate can become evidence. Count the
    // calls instead of trusting the flag.
    const unfolded = makeHost(4, { settings: { narrative_rerank_model: 'test-rerank', narrative_fold: false,
        narrative_evidence_tokens: 600 } });
    let rerankCalls = 0;
    const counted = { ...unfolded.services, rerank: () => ({ supported: true, model: 'test-rerank',
        rerank: async (query, documents) => { rerankCalls += 1; return documents.map((_, index) => ({ index, score: 1 })); } }) };
    await buildNarrativeContext(unfolded.ctx, counted, { contextSize: 32768 });
    assert.equal(rerankCalls, 0, 'an all-visible shortlist is not reranked');
}

// --- 20. recall is triggered by the situation, and a slot is spent once per message ------------------
// A 30-turn run written for the moment a past person, place or object comes back measured this: six such
// moments, every relevant floor already folded, and the earlier floors came back with only three of them.
// The lamp named again on floor 27 was introduced on floor 4, and the evidence quoted floors 20, 10 and 10
// instead. Two defects came out of the same table, and both are pinned here.
{
    const makeChunk = (id, source, index, text) => ({ id, source, start: 0, end: text.length, index,
        role: 'assistant', name: 'A', text, hash: id, retrievalText: 'speaker: A (assistant)\n' + text });

    // (a) one slot per message. A row longer than a chunk yields chunks that do not overlap, and two of
    // them can both rank: 10 to 15 percent of the three evidence slots went that way on both live runs.
    const body = '甲'.repeat(400) + '关键词' + '乙'.repeat(1600) + '关键词' + '丙'.repeat(400);
    const history = { version: 1, sequence: 1, records: { raw_1: { id: 'raw_1', index: 1, role: 'assistant',
        name: 'A', text: body } }, active: ['raw_1'] };
    const chunks = chunkHistory(history);
    assert.ok(chunks.length >= 3, 'the long row really is several chunks');
    const ranked = rankRawChunks(chunks, '关键词', [], { entity: false });
    const packed = packRawEvidence(ranked, history, { maxTokens: 4000 });
    assert.equal(packed.sources.length, 1, 'a message occupies one slot however many of its chunks ranked');
    assert.ok(packed.trace.some(row => row.outcome === 'same-message'), 'and the dropped span says why');

    // (b) the situation channel. A term of the recent messages that only lives in hidden floors claims the
    // chunk where the thing was introduced, which is the one a score-ordered shortlist drops.
    const scene = [makeChunk('c1', 'raw_1', 1, '柜台上放着一盏铜灯，灯身刻着丙字三号。'),
        makeChunk('c2', 'raw_2', 3, '雨一直下，雨一直下，我们看着窗外的雨。'),
        makeChunk('c3', 'raw_3', 5, '雨一直下，雨一直下，屋里很安静。')];
    const targets = entityTargets(scene, '老周问起那盏铜灯', { visibleSources: new Set(['raw_2', 'raw_3']) });
    const hiddenFirst = targets.filter(row => row.earliest_hidden).length;
    assert.ok(hiddenFirst > 0, 'a term from the hidden past is a target');
    assert.ok(targets.slice(0, hiddenFirst).every(row => row.earliest_hidden),
        'a term that also lives in a hidden floor is chosen before one that only lives in the newest message');
    const lamp = targets.find(row => row.term.includes('铜') && row.earliest_hidden);
    assert.ok(lamp, 'the object named in the query is a situation term');
    assert.equal(lamp.earliest.source, 'raw_1', 'and its introduction is the earliest hidden holder');
    assert.equal(targets.some(row => row !== lamp && lamp.term.includes(row.term)), false,
        'only the longest spelling of it is kept, so one piece of evidence is not two candidates');
    assert.equal(lamp.earliest_hidden, true);
    const claimed = rankRawChunks(scene, '老周问起那盏铜灯', [], { visibleSources: new Set(['raw_2', 'raw_3']) });
    const introduction = claimed.find(row => row.chunk.id === 'c1');
    assert.ok(introduction.channels.includes('entity'), 'the introduction is a candidate even when it ranks late');

    // (c) the metric that replaces the hand-written probes: of the situation terms that exist only in
    // hidden floors, how many came back with the evidence that was packed.
    const sceneHistory = { version: 1, sequence: 3, active: ['raw_1', 'raw_2', 'raw_3'], records: {
        raw_1: { id: 'raw_1', index: 1, role: 'assistant', name: 'A', text: '柜台上放着一盏铜灯，灯身刻着丙字三号。' },
        raw_2: { id: 'raw_2', index: 3, role: 'assistant', name: 'A', text: '雨一直下，雨一直下，我们看着窗外的雨。' },
        raw_3: { id: 'raw_3', index: 5, role: 'assistant', name: 'A', text: '雨一直下，雨一直下，屋里很安静。' } } };
    const recall = entityRecall(scene, sceneHistory, { query: '老周问起那盏铜灯', packed: [] });
    const missed = recall.find(row => row.term.includes('铜'));
    assert.ok(missed, 'a hidden situation term is counted');
    assert.equal(missed.recalled, false, 'and it is reported as missed when the evidence does not quote it');
    assert.equal(missed.first_floor, 1);
    const hit = entityRecall(scene, sceneHistory, { query: '老周问起那盏铜灯', packed: [{ source: 'raw_1' }] });
    assert.equal(hit.find(row => row.term.includes('铜')).recalled, true, 'quoting the floor counts as recalled');
    const visible = entityRecall(scene, sceneHistory, { query: '老周问起那盏铜灯',
        visibleSources: new Set(['raw_1', 'raw_2', 'raw_3']), packed: [] });
    assert.equal(visible.length, 0, 'a term the transcript still shows is not something to recall');
}


// --- 21. a named character in the situation gets the passage that describes them -------------------
// The split this serves: the summary carries the logic - who these people are and what they want - and
// retrieval carries the concrete detail. So the passage worth a slot when a character is in the scene is
// the one that describes them, not the one that happens to match the last three messages.
{
    const makeChunk = (id, source, index, text) => ({ id, source, start: 0, end: text.length, index,
        role: 'assistant', name: 'A', text, hash: id, retrievalText: 'speaker: A (assistant)\n' + text });
    const described = '老周左手小指缺了一节，穿灰布褂子，说话总先咳嗽一声。';
    const scene = [makeChunk('c1', 'raw_1', 1, described),
        makeChunk('c2', 'raw_2', 3, '老周说药铺后门有一道铁环，敲门要先两下再一下。'),
        makeChunk('c3', 'raw_3', 5, '雨一直下，雨一直下，我们看着窗外的雨。')];
    const targets = profileTargets(scene, ['老周'], { visibleSources: new Set(['raw_3']) });
    assert.equal(targets.length, 1);
    assert.equal(targets[0].chunk.source, 'raw_1', 'the chunk that describes him beats the one that only mentions him');
    assert.ok(targets[0].descriptors >= 3, 'and the descriptor words near the name are what decided it');
    assert.equal(profileTargets(scene, ['老周'], { visibleSources: new Set(['raw_1', 'raw_2', 'raw_3']) }).length, 0,
        'a character with nothing hidden is not a recall target');
    const history = { records: { raw_1: { id: 'raw_1', text: described } } };
    assert.equal(profileRecall(scene, history, { names: ['老周'], packed: [] })[0].detailed, false,
        'quoting nothing about him is not a description');
    assert.equal(profileRecall(scene, history, { names: ['老周'], packed: [{ source: 'raw_3' }] })[0].quoted, false,
        'a quoted scene that never mentions him does not count');
    const hit = profileRecall(scene, history, { names: ['老周'], packed: [{ source: 'raw_1' }] })[0];
    assert.equal(hit.quoted, true);
    assert.equal(hit.detailed, true, 'the describing passage counts as described, not merely mentioned');
}

console.log('PASS narrative pipeline: summary for continuity, original text for detail, and no floor hidden without a stand-in');
