// Offline tests for the versioned acceptance capture boundary.
//
// A live long-chat run is expensive, so the record path is proved here instead: a simulated transport is the
// only model. The two regressions this file exists for are (1) the targeted repair call was classified as a
// story call and lost its raw request, response and elapsed time, and (2) the injected state block was saved
// only at batch and final turns, so a probe turn's block was overwritten before it could be archived.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  META_KEY, classifyModelCall, createCaptureBoundary, collectSettled, awaitJson, installCapture, redact,
  stripReasoning, buildTurnRecord, buildBatchEvidence, deepSnapshot, summarizeCall, splitRequest, promptsOf,
  captureChatRows, resetChatSurface, restoreSnapshot, HOST_SCRIPT_URL, summaryGate,
} from './acceptance-capture.js';

const request = content => ({ messages: [{ role: 'system', content }], max_tokens: 8192 });
const summaryRequest = content => request('你是剧情续接摘要器。' + content);
const repairRequest = content => request('你上一轮答案的【锚点变更】里有不合法的行。' + content);
const reply = content => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

// --- 1. the classifier separates the two evidence-bearing kinds from the story call ---------------------
{
  assert.equal(classifyModelCall(summaryRequest('A')), 'summary');
  assert.equal(classifyModelCall(repairRequest('B')), 'repair');
  assert.equal(classifyModelCall(request('You are a helpful assistant.')), 'main');
  assert.equal(classifyModelCall(null), 'main', 'an empty payload is a story call, not a summary');
  assert.equal(classifyModelCall({ messages: [{ content: 42 }] }), 'main', 'a non-string content never matches');
}

// --- 2. both evidence-bearing kinds record request, response and elapsed; the story call does not -------
{
  let clock = 1000;
  const boundary = createCaptureBoundary({
    now: () => clock,
    transport: async () => { clock += 25; return reply('ok'); },
  });
  await boundary.send(summaryRequest('one'));
  await boundary.send(repairRequest('two'));
  await boundary.send(request('story'));
  const evidence = boundary.modelCalls();
  assert.equal(evidence.length, 2, 'summary and repair are the model calls');
  assert.deepEqual(evidence.map(call => call.kind), ['summary', 'repair']);
  for (const call of evidence) {
    assert.equal(call.ok, true);
    assert.ok(call.request && Array.isArray(call.request.messages), 'the raw request is recorded');
    assert.ok(call.response && call.response.choices, 'the raw response is recorded');
    assert.equal(call.elapsed_ms, 25, 'elapsed time is recorded for the kind');
    assert.ok(call.request_json_chars > 0);
  }
  assert.equal(boundary.calls.length, 3, 'every call is counted');
  assert.equal(boundary.calls[2].kind, 'main');
  assert.ok(!('request' in boundary.calls[2]), 'the story prompt is never captured');
  assert.ok(!('response' in boundary.calls[2]));
}

// --- 3. installCapture patches the host service and keeps the original behaviour ------------------------
{
  const sent = [];
  const ctx = { ChatCompletionService: { sendRequest: async data => { sent.push(data); return reply('from original'); } } };
  const boundary = installCapture(ctx);
  const result = await ctx.ChatCompletionService.sendRequest(summaryRequest('through the patch'));
  assert.equal(result.choices[0].message.content, 'from original', 'the original transport still answers');
  assert.equal(sent.length, 1, 'the original transport is still called once');
  assert.equal(boundary.modelCalls().length, 1);
}

// --- 4. a failed transport is recorded and rethrown -----------------------------------------------------
{
  const boundary = createCaptureBoundary({ now: () => 7, transport: async () => { throw new Error('boom'); } });
  await assert.rejects(() => boundary.send(summaryRequest('fails')), /boom/);
  assert.equal(boundary.calls[0].ok, false);
  assert.equal(boundary.calls[0].error, 'boom');
  assert.equal(boundary.calls[0].elapsed_ms, 0);
}

// --- 5. credentials are redacted, reasoning text is dropped, reasoning usage is kept ---------------------
{
  const redacted = redact({ api_key: 'sk-secret', nested: { authorization: 'Bearer x', keep: 'yes' } });
  assert.equal(redacted.api_key, '[redacted]');
  assert.equal(redacted.nested.authorization, '[redacted]');
  assert.equal(redacted.nested.keep, 'yes');
  const stripped = stripReasoning({ reasoning_content: 'chain of thought', choices: [{ message: { content: 'body' } }], usage: { reasoning_tokens: 7 } });
  assert.equal('reasoning_content' in stripped, false, 'reasoning text is not stored');
  assert.equal(stripped.choices[0].message.content, 'body');
  assert.equal(stripped.usage.reasoning_tokens, 7, 'reasoning usage is part of the cost record');
}

// --- 6. two consecutive turns keep their own injected block, appended rather than overwritten -----------
{
  const snap = (block, revision) => ({
    at: 1, chatId: 'chat', name2: 'name', chatLength: 2, completeTurns: 1, folded: 0,
    anchors: { active: [] }, summary: { covered: [1], text: 'summary', state_revision: revision, source_revision: revision },
    knowledge: null, diagnostics: { injected_chars: block.length, injected_state_revision: revision },
    rawHistory: { active: [], recordCount: 0 },
    prompts: { reference: 'REF', current_state: block },
  });
  const file = path.join(os.tmpdir(), 'acceptance-capture-' + process.pid + '.jsonl');
  fs.rmSync(file, { force: true });
  const first = buildTurnRecord({ turn: 1, userText: 'u1', at: 't1', isBatch: false, pre: snap('BLOCK-ONE', 1), post: snap('BLOCK-ONE', 1), newCalls: [] });
  const second = buildTurnRecord({ turn: 2, userText: 'u2', at: 't2', isBatch: false, pre: snap('BLOCK-ONE', 1), post: snap('BLOCK-TWO', 2), newCalls: [] });
  fs.appendFileSync(file, JSON.stringify(first) + '\n');
  fs.appendFileSync(file, JSON.stringify(second) + '\n');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 2, 'both turns are on disk');
  assert.equal(lines[0].injections.after.current_state, 'BLOCK-ONE', 'the first turn keeps its block');
  assert.equal(lines[1].injections.after.current_state, 'BLOCK-TWO', 'the second turn keeps its block');
  assert.equal(lines[0].injections.before.current_state, 'BLOCK-ONE');
  // The block a turn saw is the one its own generation set. `before` is the previous turn's block, and
  // reading it as this turn's is what made a live probe look like retrieval answered the wrong question.
  assert.equal(lines[1].injections.thisTurn.current_state, 'BLOCK-TWO', 'thisTurn is the block this turn saw');
  assert.equal(lines[1].injections.before.current_state, 'BLOCK-ONE', 'before is the previous turn, not this one');
  assert.equal(lines[0].injectionAfterTurn.state_revision, 1);
  fs.rmSync(file, { force: true });
}

// --- 7. batch evidence names the injected text and both call kinds --------------------------------------
{
  const snap = { at: 1, completeTurns: 1, folded: 0, anchors: { active: [] }, summary: { covered: [1], text: 's' },
    knowledge: null, diagnostics: { pending_floors: 3 }, rawHistory: { active: [], recordCount: 0 },
    prompts: { reference: 'REF', current_state: 'BLOCK' } };
  const evidence = buildBatchEvidence({ batchTurn: 10, at: 't', pre: snap, post: snap, requestText: 'request',
    newCalls: [
      { at: 1, kind: 'summary', ok: true, request: summaryRequest('x'), response: reply('body'), elapsed_ms: 5, request_json_chars: 100 },
      { at: 2, kind: 'repair', ok: true, request: repairRequest('y'), response: reply('body'), elapsed_ms: 9, request_json_chars: 80 },
    ] });
  assert.equal(evidence.unknown.injected_text, null, 'the current-state block is present');
  assert.equal(evidence.unknown.repair_elapsed, null, 'the repair elapsed time is present');
  assert.equal(evidence.calls.map(call => call.kind).join(','), 'summary,repair');
  assert.ok(evidence.calls[1].repair_request_text.startsWith('你上一轮答案的'), 'the repair request text is kept');
  const missing = buildBatchEvidence({ batchTurn: 10, at: 't', pre: snap, post: null });
  assert.equal(missing.unknown.injected_text, 'missing_current_state');
  const noElapsed = buildBatchEvidence({ batchTurn: 10, at: 't', pre: snap, post: snap,
    newCalls: [{ at: 1, kind: 'repair', ok: true, request: repairRequest('z'), response: reply('b'), elapsed_ms: null }] });
  assert.equal(noElapsed.unknown.repair_elapsed, 'repair_elapsed_null');
}

// --- 8. the snapshot carries both prompt channels, and the frozen request still splits ------------------
{
  const ctx = { chatId: 'c', name2: 'n', chat: [{ is_user: true, mes: 'a' }, { is_user: false, mes: 'b' }],
    chatMetadata: { [META_KEY]: { narrative_anchors: { active: [] } } },
    extensionPrompts: { aetheria_unified_memory_v5_4_current_state: { value: 'BLOCK' } } };
  const snapshot = deepSnapshot(ctx, false);
  assert.equal(snapshot.completeTurns, 1);
  assert.equal(snapshot.prompts.current_state, 'BLOCK');
  assert.equal(snapshot.prompts.reference, null);
  assert.deepEqual(promptsOf(ctx), { reference: null, current_state: 'BLOCK' });
  const frozen = '你是剧情续接摘要器。\n\n【旧摘要】\n旧\n\n【当前锚点】\n- A1 | 设定 | x | 事实\n\n【当前知情边界】\n无\n\n【新增原文】\n[raw_1] 甲\n\n[raw_2] 乙';
  const split = splitRequest(frozen);
  assert.ok(split.instructions.startsWith('你是剧情续接摘要器'));
  assert.equal(split.previous.trim(), '旧');
  assert.deepEqual(split.batchEntries.map(entry => entry.id), ['raw_1', 'raw_2']);
  assert.deepEqual(split.plan.map(entry => entry.alias), ['A1']);
}

// --- 9. F-12: the CDP wrapper awaits before stringifying; a promise is never recorded as '{}' ----------
{
  assert.equal(JSON.stringify(eval('Promise.resolve(42)')), '{}', 'the raw bug: a promise stringifies to {}');
  assert.equal(await eval(awaitJson('Promise.resolve(42)')), '42', 'the wrapper awaits the expression');
  assert.equal(await eval(awaitJson('({ a: 1 })')), '{"a":1}', 'a plain value still round-trips');
}

// --- 10. F-17: a started request carries an id and running status, and is never called successful ----
{
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let clock = 500;
  const boundary = createCaptureBoundary({ now: () => clock, transport: () => gate });
  const pending = boundary.send(summaryRequest('slow'));
  const running = boundary.modelCalls();
  assert.equal(running.length, 1, 'a started request is visible before it settles');
  assert.ok(running[0].id, 'a started request has an id');
  assert.equal(running[0].status, 'running');
  assert.equal(summarizeCall(running[0]).status, 'running');
  assert.equal(summarizeCall(running[0]).ok, null, 'an in-flight request is not recorded as failed');
  clock = 525;
  release(reply('late'));
  await pending;
  assert.equal(boundary.modelCalls()[0].status, 'succeeded');
  assert.equal(boundary.modelCalls()[0].ok, true);
}

// --- 11. F-17: a completion between two snapshots is collected once, not lost -------------------------
{
  const collected = new Set();
  const boundary = createCaptureBoundary({ transport: async () => reply('ok') });
  await boundary.send(summaryRequest('one'));
  assert.equal(collectSettled(boundary.modelCalls(), collected).length, 1, 'a settled call is collected');
  assert.equal(collectSettled(boundary.modelCalls(), collected).length, 0, 'a settled call is collected once');

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = createCaptureBoundary({ transport: () => gate });
  const pending = slow.send(summaryRequest('slow'));
  assert.equal(collectSettled(slow.modelCalls(), collected).length, 0, 'a running call is not a completed call');
  release(reply('late'));
  await pending;
  assert.equal(collectSettled(slow.modelCalls(), collected).length, 1, 'its completion is not lost between snapshots');
}

// --- 12. the restore path: reset the host's bounded surface before re-applying fold styling ----------
// The bug this exists for: a harness replaced ctx.chat without rebuilding the bounded ChatSurface, so the
// old message roots stayed in the DOM and the next reconcile threw "ChatSurface projection has 3 ranges;
// maximum is 2". syncFloorFoldDom only toggles a class, so it can neither cause nor cure that; the host has
// to reset its surface epoch and redisplay the canonical array first.
{
  const log = [];
  const makeHost = (sink = log) => ({
    resetChatSurfaceView: options => { sink.push('reset:' + JSON.stringify(options)); },
    redisplayChat: async () => { sink.push('redisplay'); },
    updateViewMessageIds: () => { sink.push('updateView'); },
    withChatSurfaceStructureMutation: async callback => { sink.push('mutate:start'); await callback(); sink.push('mutate:end'); },
  });
  const chat = [{ is_user: true, mes: 'old-a' }, { is_user: false, mes: 'old-b' }];
  const chatMetadata = {};
  const ctx = { chat, chatMetadata, saveChat: async () => { log.push('save'); } };
  const host = makeHost();
  host.chat = chat;
  const syncFold = target => { log.push('fold'); return 3; };
  const snapshot = { chat: [{ is_user: true, mes: 'new-a', extra: { aetheria_v55_folded: true } }, { is_user: false, mes: 'new-b' }],
    summary: { text: 's' }, anchors: { active: [] }, knowledge: null, diagnostics: { stage: 'x' } };

  const result = await restoreSnapshot(ctx, snapshot, { host, syncFold, save: true });
  assert.equal(ctx.chat, chat, 'the canonical chat array identity is preserved for the host redisplay');
  assert.deepEqual(ctx.chat.map(row => row.mes), ['new-a', 'new-b']);
  assert.equal(ctx.chat[0].extra.aetheria_v55_folded, true);
  assert.deepEqual(log, ['mutate:start', 'mutate:end', 'save', 'reset:{"includeAuxiliary":true}', 'redisplay', 'fold'],
    'mutate, persist, reset the epoch, redisplay, then re-apply the fold classes');
  assert.equal(chatMetadata[META_KEY].narrative_summary.text, 's');
  assert.equal(chatMetadata[META_KEY].narrative_diagnostics.stage, 'x');
  assert.equal('narrative_knowledge' in chatMetadata[META_KEY], false, 'a null derived key is removed, not stored as null');
  assert.deepEqual(result, { reset: true, redrawn: true, folded: 3 });

  // Persistence is opt-in: a restore must not overwrite a chat that is not the test one.
  const log3 = [];
  const host3 = makeHost(log3); host3.chat = chat;
  const ctx3 = { chat, chatMetadata: {}, saveChat: async () => { log3.push('save'); } };
  await restoreSnapshot(ctx3, snapshot, { host: host3, syncFold: () => 0 });
  assert.equal(log3.includes('save'), false, 'a restore does not save unless asked');

  // redraw:false reconciles the mounted set instead of a full redisplay.
  const log2 = [];
  const host2 = makeHost(log2); host2.chat = chat;
  const second = await resetChatSurface(ctx, { host: host2, redraw: false,
    syncFold: () => { log2.push('fold'); return 0; } });
  assert.deepEqual(log2, ['reset:{"includeAuxiliary":true}', 'updateView', 'fold']);
  assert.equal(second.redrawn, true);

  // Fail closed: a partial host, a second host instance, and a snapshot without rows are all refused.
  await assert.rejects(() => restoreSnapshot(ctx, snapshot, { host: { resetChatSurfaceView: () => {}, chat }, syncFold }),
    /does not expose redisplayChat/);
  await assert.rejects(() => restoreSnapshot(ctx, snapshot, { host: Object.assign(makeHost(), { chat: [{ mes: 'other' }] }), syncFold }),
    /not the loaded one/);
  await assert.rejects(() => restoreSnapshot(ctx, { summary: {} }, { host, syncFold }), /needs snapshot.chat/);
  assert.equal(HOST_SCRIPT_URL, '/script.js');

  // A full snapshot is a restore point; a reading is not.
  const full = deepSnapshot(ctx, true);
  assert.equal(full.chat.length, ctx.chat.length, 'a full snapshot carries the rows');
  assert.equal(deepSnapshot(ctx, false).chat, null);
  const weird = captureChatRows({ chat: [{ is_user: true, mes: 'z', run() { return 1; } }] });
  assert.equal(typeof weird[0].run, 'undefined', 'a non-serialisable row field is dropped, not fatal');
  assert.equal(weird[0].mes, 'z');
}

// --- 13. the questions wait for the summary: phase 1 summarized and hidden before the first probe ---------
// A probe asks what the memory kept, so asking while the transcript is still visible measures the transcript.
// The driver refuses on a failure; this pins what a failure is.
{
    const ready = { completeTurns: 20, coveredFloors: 20, folded: 40, pendingFloors: 0 };
    const gate = summaryGate(ready, { turns: 20 });
    assert.equal(gate.ok, true, 'a fully summarized and folded phase 1 may be asked about');
    assert.equal(gate.coveredFloors, 20, 'and the readings come back for the run log');
    assert.equal(summaryGate({ ...ready, completeTurns: 15 }, { turns: 20 }).ok, false, 'not enough finished floors');
    assert.ok(summaryGate({ ...ready, coveredFloors: 10 }, { turns: 20 }).reason.includes('摘要只覆盖'),
        'a summary that covers half of phase 1 is refused');
    assert.equal(summaryGate({ ...ready, pendingFloors: 1 }, { turns: 20 }).ok, false, 'a waiting batch is refused');
    assert.ok(summaryGate({ ...ready, folded: 0 }, { turns: 20 }).reason.includes('原文仍在可见区'),
        'a summary nobody hid the text for is refused');
}

console.log('PASS acceptance capture: both call kinds record raw bodies and elapsed, and consecutive turns keep separate injected blocks');
