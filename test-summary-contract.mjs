// The summary contract, stated as executable checks before the implementation that has to satisfy it.
//
// Each block below is one of the four rules the batching rework is measured against:
//   1. the state header counts complete covered turns in floors, and reports the committed coverage
//      separately from the coverage the last injection actually carried;
//   2. the summary input is assembled from original messages, one entry per message, while retrieval
//      keeps its 700/100 chunking - and two genuinely identical messages stay two entries;
//   3. the text that is measured is the text that is sent, part by part, and a character budget is
//      never reported as proof that the model's context window fits;
//   4. a local budget shortfall is a block, not an interface failure: it is counted once, it never
//      hides anything, and it is re-checked when the budget or the batch changes.
import assert from 'node:assert/strict';
import { captureHistory, chunkHistory, nextSummaryBatch, summaryMessages, summaryRequest,
    summaryBlockState, validSummary, completedUserTurns, RAW_CHUNK_SIZE } from './raw-history.js';
import { updateNarrative, buildNarrativeContext, runNarrativeGeneration, readNarrativeReport } from './narrative-runtime.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const SUMMARY_BODY = '局面稳定。\n【锚点】\n- 无\n【已解决】\n- 无\n【知情边界】\n- 无';
const pair = n => [{ is_user: true, mes: '第' + n + '轮：主角走进大厅。' },
    { is_user: false, mes: '第' + n + '轮：管家回应，钥匙仍在。' }];

function host({ settings = {}, summarize } = {}) {
    const ctx = { extensionSettings: { [KEY]: { enabled: true, narrative_every: 10, narrative_summary_tokens: 400,
            narrative_setting_tokens: 0, narrative_input_chars: 40000, ...settings } },
        chatMetadata: { [KEY]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, setExtensionPrompt() {},
        eventTypes: {}, eventSource: { on() {} } };
    let live = true;
    const services = { vector: () => ({ supported: false, reason: 'vector disabled in this test' }),
        isCurrent: () => live, leave: () => { live = false; },
        summarize: summarize || (async () => SUMMARY_BODY) };
    return { ctx, services, store: () => ctx.chatMetadata[KEY] };
}
const add = (h, n) => h.ctx.chat.push(...pair(n));

// --- 1. the cadence is floors of complete turns, and a manual trigger cannot bypass it ------------
{
    const h = host(); let calls = 0;
    h.services.summarize = async () => { calls += 1; return SUMMARY_BODY; };
    for (let n = 1; n <= 9; n += 1) add(h, n);
    await updateNarrative(h.ctx, h.services, { force: true });
    assert.equal(calls, 0, 'nine turns never summarize, even forced');
    assert.equal(readNarrativeReport(h.ctx).completed_floors, 9);
    add(h, 10);
    await updateNarrative(h.ctx, h.services);
    assert.equal(calls, 1, 'ten turns summarize');
    assert.equal(h.ctx.chat.filter(r => r.is_system).length, 20, 'and hide exactly twenty rows');
    assert.equal(h.ctx.chat[0].is_system, undefined, 'the greeting is never one of them');
    for (const n of [11, 12, 13]) add(h, n);
    await updateNarrative(h.ctx, h.services, { force: true });
    assert.equal(calls, 1, 'a three-turn backlog does not start a second batch');
    assert.equal(readNarrativeReport(h.ctx).pending_floors, 3);
    for (let n = 14; n <= 20; n += 1) add(h, n);
    await updateNarrative(h.ctx, h.services);
    assert.equal(calls, 2, 'the backlog is consumed by the next full batch');
    assert.equal(h.ctx.chat.filter(r => r.is_system).length, 40);
}

// --- 2. a backlog is the earliest N turns, never a larger batch -----------------------------------
{
    const h = host(); let prompt = null;
    h.services.summarize = async (_ctx, text) => { prompt = text; return SUMMARY_BODY; };
    for (let n = 1; n <= 13; n += 1) add(h, n);
    await updateNarrative(h.ctx, h.services);
    assert.match(prompt, /第10轮/, 'the tenth turn of the backlog is inside the batch');
    assert.doesNotMatch(prompt, /第11轮|第12轮|第13轮/, 'the backlog past it is not');
    assert.equal(h.ctx.chat.filter(r => r.is_system).length, 20);
    assert.equal(readNarrativeReport(h.ctx).pending_floors, 3);
}

// --- 3. the summary input is original messages: one entry each, full text -------------------------
{
    const h = host();
    const longReply = '长'.repeat(RAW_CHUNK_SIZE * 3);
    for (let n = 1; n <= 10; n += 1) {
        const [user, reply] = pair(n);
        if (n === 4) reply.mes = longReply;
        if (n === 6 || n === 7) reply.mes = '完全相同的回复。';
        h.ctx.chat.push(user, reply);
    }
    let prompt = null;
    h.services.summarize = async (_ctx, text) => { prompt = text; return SUMMARY_BODY; };
    await updateNarrative(h.ctx, h.services);
    const history = h.store().raw_history;
    const longId = history.active.find(id => history.records[id].text.length > RAW_CHUNK_SIZE);
    const pieces = chunkHistory(history).filter(chunk => chunk.source === longId);
    assert.ok(pieces.length > 1, 'the long reply really is more than one retrieval chunk (' + pieces.length + ')');
    assert.equal(prompt.split('[' + longId + ']').length - 1, 1, 'a multi-chunk message appears exactly once');
    assert.ok(prompt.includes(longReply), 'and it appears whole, not truncated to one chunk');
    const twins = history.active.filter(id => history.records[id].text === '完全相同的回复。');
    assert.equal(twins.length, 2, 'the fixture has two byte-identical replies');
    for (const id of twins) assert.equal(prompt.split('[' + id + ']').length - 1, 1, id + ' appears once');
    assert.ok(prompt.indexOf('[' + twins[0] + ']') < prompt.indexOf('[' + twins[1] + ']'),
        'both survive, in order; equal text is not duplicate text');
    const batch = nextSummaryBatch(undefined, chunkHistory(history), { every: 10 });
    const messages = summaryMessages(history, batch);
    // The greeting rides with the first batch as context; it is not one of the counted turns and folding
    // never hides it. Twenty turns plus the greeting is twenty-one entries, not one per retrieval chunk.
    assert.equal(messages.length, 21, 'one entry per message row, not one per retrieval chunk');
    assert.equal(new Set(messages.map(row => row.id)).size, 21);
    assert.ok(messages.every(row => row.text === history.records[row.id].text), 'each entry is the original text');
    assert.deepEqual([...new Set(messages.map(row => row.role))].sort(), ['assistant', 'user']);
}

// --- 4. the request text is measured part by part, before it is sent ------------------------------
{
    const h = host({ settings: { narrative_input_chars: 2000 } }); let calls = 0;
    h.services.summarize = async () => { calls += 1; return SUMMARY_BODY; };
    for (let n = 1; n <= 10; n += 1) add(h, n);
    h.ctx.chat[3].mes += '完整原文'.repeat(400);
    await updateNarrative(h.ctx, h.services);
    assert.equal(calls, 0, 'over the local character budget means zero model calls');
    assert.ok(h.ctx.chat.every(row => !row.is_system), 'and zero new hiding');
    const block = readNarrativeReport(h.ctx).summary_block;
    assert.equal(block.reason, 'input_budget');
    assert.ok(block.needed_chars > block.budget_chars, block.needed_chars + ' > ' + block.budget_chars);
    for (const part of ['instructions_chars', 'previous_chars', 'anchors_chars', 'knowledge_chars', 'batch_chars'])
        assert.ok(Number.isFinite(block.parts[part]), 'the cost report states ' + part);
    assert.equal(block.parts.total_chars, block.needed_chars, 'the measured text is the sent text');
    assert.ok(block.parts.batch_chars < block.parts.total_chars, 'the batch is only part of the request');
    assert.equal(block.context_tokens, null);
    assert.equal(block.context_tokens_status, 'unknown',
        'passing a character budget is not proof the model context window fits');
    // The parts add up to the whole, so the report cannot hide format overhead.
    const sum = block.parts.instructions_chars + block.parts.previous_chars + block.parts.anchors_chars
        + block.parts.knowledge_chars + block.parts.batch_chars;
    assert.ok(sum <= block.parts.total_chars, 'the named parts fit inside the total');
}

// --- 5. one block, re-checked; an interface failure is a different event --------------------------
{
    const h = host({ settings: { narrative_input_chars: 2000 } }); let calls = 0;
    h.services.summarize = async () => { calls += 1; return SUMMARY_BODY; };
    for (let n = 1; n <= 10; n += 1) add(h, n);
    h.ctx.chat[3].mes += '完整原文'.repeat(400);
    for (let i = 0; i < 20; i += 1) await updateNarrative(h.ctx, h.services, { force: true });
    const blocked = readNarrativeReport(h.ctx);
    assert.equal(blocked.summary_block.checks, 20, 'twenty checks of one frozen batch are still one block');
    assert.equal(blocked.summary_failures, 0, 'a local budget shortfall is not counted as an interface failure');
    assert.equal(calls, 0);
    assert.ok(h.ctx.chat.every(row => !row.is_system), 'a block hides nothing');
    h.ctx.extensionSettings[KEY].narrative_input_chars = 40000;
    await updateNarrative(h.ctx, h.services);
    assert.equal(calls, 1, 'raising the budget re-checks the same batch and lets it through');
    const unblocked = readNarrativeReport(h.ctx);
    assert.equal(unblocked.summary_block, null, 'a committed batch clears the block');
    assert.equal(unblocked.summary_covered_floors, 10);
}
{
    const h = host();
    h.services.summarize = async () => { throw new Error('provider down'); };
    for (let n = 1; n <= 10; n += 1) add(h, n);
    await updateNarrative(h.ctx, h.services);
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_failures, 1, 'a real interface error is counted on its own counter');
    assert.equal(report.summary_block, null, 'and is not reported as a budget block');
    assert.match(report.diagnostics.summary_error, /provider down/);
}

// --- 6. the header states floors, and the committed coverage is not the injected one --------------
{
    const h = host();
    for (let n = 1; n <= 10; n += 1) add(h, n);
    await updateNarrative(h.ctx, h.services);
    const first = await runNarrativeGeneration(h.ctx, h.services, [{}, 32768, () => {}, 'normal']);
    assert.match(first.currentStateBlock, /current as of floor 10;/, 'ten turns are floor ten');
    assert.doesNotMatch(first.currentStateBlock, /floor 21/, 'not the twenty-first message row');
    let report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 10);
    assert.equal(report.injected_floors, 10);
    assert.equal(report.injected_stale, false);
    assert.equal(report.state_horizon_floors, 10);
    for (let n = 11; n <= 20; n += 1) add(h, n);
    await updateNarrative(h.ctx, h.services);
    report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 20, 'the committed summary now reaches floor twenty');
    assert.equal(report.injected_floors, 10, 'while the last injection still carried the first batch');
    assert.equal(report.injected_stale, true, 'and the report says which of the two is stale');
    assert.notEqual(report.summary_state_revision, report.injected_state_revision);
    const second = await runNarrativeGeneration(h.ctx, h.services, [{}, 32768, () => {}, 'normal']);
    assert.match(second.currentStateBlock, /current as of floor 20;/);
    report = readNarrativeReport(h.ctx);
    assert.equal(report.injected_floors, 20);
    assert.equal(report.injected_stale, false);
    assert.equal(report.summary_state_revision, report.injected_state_revision,
        'the injected version is the committed one');
}

// --- 7. the batch is frozen against appends and edits ---------------------------------------------
{
    const h = host(); let release = null; let prompt = null;
    for (let n = 1; n <= 10; n += 1) add(h, n);
    h.services.summarize = (_ctx, text) => { prompt = text; return new Promise(resolve => { release = resolve; }); };
    const job = updateNarrative(h.ctx, h.services);
    assert.equal(h.ctx.chat.filter(r => r.is_system).length, 0, 'nothing is hidden while the request runs');
    add(h, 11);
    release(SUMMARY_BODY);
    await job;
    assert.doesNotMatch(prompt, /第11轮/, 'a message appended during the call is not added to the request');
    assert.equal(h.store().narrative_summary.covered.length, 21, 'the committed coverage is the frozen batch');
    assert.equal(h.ctx.chat.at(-2).is_system, undefined, 'and the appended turn stays visible');
}
{
    const h = host(); let release = null;
    for (let n = 1; n <= 10; n += 1) add(h, n);
    h.services.summarize = () => new Promise(resolve => { release = resolve; });
    const job = updateNarrative(h.ctx, h.services);
    h.ctx.chat[2].mes = '钥匙现在属于乙。';
    release(SUMMARY_BODY);
    await job;
    assert.equal(h.store().narrative_summary, undefined, 'an edit inside the batch discards the late result');
    assert.ok(h.ctx.chat.every(row => !row.is_system), 'and hides nothing');
}

// --- 8. the pieces agree with each other without a host -------------------------------------------
{
    const store = {};
    const chat = [{ is_user: false, mes: '开场白。' }];
    for (let n = 1; n <= 10; n += 1) chat.push(...pair(n));
    captureHistory(store, chat);
    const history = store.raw_history;
    const chunks = chunkHistory(history);
    const short = nextSummaryBatch(undefined, chunks.slice(0, 18), { every: 10 });
    assert.equal(short, null, 'nine complete turns are not a batch');
    const batch = nextSummaryBatch(undefined, chunks, { every: 10 });
    assert.equal(batch.turns, 10);
    assert.equal(batch.covered.length, 21, 'the greeting plus twenty rows');
    assert.equal(batch.sources.length, 21);
    assert.equal(completedUserTurns(chunks.slice(0, batch.covered.length)), 10, 'the coverage is ten floors');
    const half = { version: 1, text: 'x', covered: chunks.slice(0, 20).map(c => c.id) };
    const next = nextSummaryBatch(half, chunks, { every: 10 });
    assert.equal(next, null, 'an existing summary is extended, never re-summarized, and needs a full batch');
    const messages = summaryMessages(history, batch);
    const request = summaryRequest('旧摘要', messages, 400, [{ kind: '所有权', text: '钥匙属于甲' }], []);
    assert.match(request.text, /旧摘要/);
    assert.match(request.text, /钥匙属于甲/);
    assert.ok(request.parts.previous_chars > 0 && request.parts.anchors_chars > 0 && request.parts.batch_chars > 0);
    assert.equal(request.parts.total_chars, request.text.length);
    const written = computeBlock(null, 100);
    const again = computeBlock(written, 100);
    assert.equal(again.checks, 2, 'the same batch and budget is one block, re-checked');
    assert.equal(again.first_at, written.first_at);
    const wider = computeBlock(written, 200);
    assert.equal(wider.checks, 1, 'a changed budget is a new check');
    const other = computeBlock(written, 100, 'different text');
    assert.equal(other.checks, 1, 'changed batch text is a new check');
    assert.equal(validSummary(half, chunks), true);
}

function computeBlock(previous, budget, tail = '') {
    const store = {};
    const chat = [{ is_user: false, mes: '开场白。' }];
    for (let n = 1; n <= 10; n += 1) chat.push(...pair(n));
    captureHistory(store, chat);
    const history = store.raw_history;
    const chunks = chunkHistory(history);
    const batch = nextSummaryBatch(undefined, chunks, { every: 10 });
    const messages = summaryMessages(history, batch);
    const request = summaryRequest('旧摘要' + tail, messages, 400, [], []);
    return summaryBlockState(previous, { batch, request, inputChars: budget, summaryTokens: 400 });
}

console.log('summary-contract: ok');
