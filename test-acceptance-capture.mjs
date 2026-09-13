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
  META_KEY, classifyModelCall, createCaptureBoundary, installCapture, redact, stripReasoning,
  buildTurnRecord, buildBatchEvidence, deepSnapshot, summarizeCall, splitRequest, promptsOf,
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

console.log('PASS acceptance capture: both call kinds record raw bodies and elapsed, and consecutive turns keep separate injected blocks');
