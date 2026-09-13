// Acceptance capture for the narrative summary protocol.
//
// A live acceptance run has to keep three things the ordinary diagnostics do not carry: the raw request and
// response of every summary call, the raw request and response of the one targeted repair that follows a
// refused anchor section, and the exact state block injected at every turn. The repair prompt does not carry
// the summary opener, so a marker-only classifier silently drops it - the 421757c long-chat run lost the
// repair's request, response and elapsed time that way - and the injected text was written only at batch and
// final turns, so a probe turn lost its block to the next generation.
//
// This module is the single source of truth for that boundary. acceptance-longchat.mjs imports it inside the
// host page, and test-acceptance-capture.mjs imports it in Node against a simulated transport, so the
// classifier and the record shape are the same code in both places. It has no Node imports, so it can run in
// the page; the driver keeps the file I/O and the caller supplies the output directory.

export const SUMMARY_OPENER = '你是剧情续接摘要器';
export const REPAIR_OPENER = '你上一轮答案的';
export const META_KEY = 'aetheriaUnifiedMemoryV54';

/** Which of the three call kinds a request is. Only the first two carry acceptance evidence. */
export function classifyModelCall(data) {
  const messages = Array.isArray(data && data.messages) ? data.messages : [];
  const startsWith = opener => messages.some(m => m && typeof m.content === 'string' && m.content.startsWith(opener));
  if (startsWith(SUMMARY_OPENER)) return 'summary';
  if (startsWith(REPAIR_OPENER)) return 'repair';
  return 'main';
}

const SECRET_KEY = /^(api_?key|key|secret|token|authorization|password|.*_secret|.*_key|.*_token)$/i;

/** Redact credentials and truncate an accidental whole-chat payload. Never called on the story prompt. */
export function redact(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) { out[key] = '[redacted]'; continue; }
      out[key] = redact(inner);
    }
    return out;
  }
  // The largest summary request measured here is under 60000 characters; this is a guard, not a limit.
  return typeof value === 'string' && value.length > 400000 ? value.slice(0, 400000) + '...[truncated]' : value;
}

// Reasoning *text* is never stored. Reasoning *usage* is, because it is part of the cost record.
const REASONING_TEXT_KEYS = new Set(['reasoning', 'reasoning_content', 'reasoning_text', 'reasoning_details']);

export function stripReasoning(result) {
  try {
    const copy = JSON.parse(JSON.stringify(result));
    const walk = object => {
      if (!object || typeof object !== 'object') return;
      for (const key of Object.keys(object)) {
        if (REASONING_TEXT_KEYS.has(key.toLowerCase())) delete object[key];
        else walk(object[key]);
      }
    };
    walk(copy);
    return copy;
  } catch (error) { return { unserializable: String(error) }; }
}

/**
 * The transport boundary. Wrap one raw send and keep the evidence for the two evidence-bearing kinds.
 * The story prompt ('main') is counted but never captured.
 */
export function createCaptureBoundary({ transport, now = Date.now }) {
  if (typeof transport !== 'function') throw new Error('createCaptureBoundary needs a transport function');
  const calls = [];
  const send = async (data, extractData = true, signal = null) => {
    const kind = classifyModelCall(data);
    const record = { at: now(), kind };
    if (kind !== 'main') { record.request = redact(data); record.request_json_chars = JSON.stringify(data).length; }
    calls.push(record);
    try {
      const result = await transport(data, extractData, signal);
      record.ok = true;
      if (kind !== 'main') record.response = stripReasoning(result);
      record.elapsed_ms = now() - record.at;
      return result;
    } catch (error) {
      record.ok = false;
      record.error = String((error && error.message) || error);
      record.elapsed_ms = now() - record.at;
      throw error;
    }
  };
  return {
    send,
    calls,
    modelCalls: () => calls.filter(call => call.kind === 'summary' || call.kind === 'repair'),
  };
}

/** Install the boundary on a host context and return it. */
export function installCapture(ctx, options = {}) {
  const service = ctx.ChatCompletionService;
  const original = service.sendRequest.bind(service);
  const boundary = createCaptureBoundary({
    now: options.now || Date.now,
    transport: (data, extractData, signal) => original(data, extractData, signal),
  });
  service.sendRequest = (data, extractData = true, signal = null) => boundary.send(data, extractData, signal);
  return boundary;
}

export function completeTurnsOf(rows) {
  let completeTurns = 0;
  let lastRole = null;
  for (const row of rows) {
    if (row && row.is_user === true) lastRole = 'user';
    else if (row && row.is_user !== true && lastRole === 'user') { completeTurns += 1; lastRole = 'assistant'; }
  }
  return completeTurns;
}

/** The two prompt channels the plugin owns. Both are carried on every snapshot, so every turn keeps its own. */
export function promptsOf(ctx) {
  const prompts = (ctx && ctx.extensionPrompts) || {};
  const value = key => {
    const entry = prompts[key];
    if (!entry) return null;
    return typeof entry === 'string' ? entry : (entry.value != null ? String(entry.value) : null);
  };
  return { reference: value('aetheria_unified_memory_v5_4_reference'), current_state: value('aetheria_unified_memory_v5_4_current_state') };
}

/** The host's own injection bookkeeping, separate from the injected text itself. */
export function injectionOf(state) {
  const diag = (state && state.diagnostics) || {};
  return {
    chars: diag.injected_chars != null ? diag.injected_chars : null,
    state_revision: diag.injected_state_revision != null ? diag.injected_state_revision : null,
    source_revision: diag.injected_source_revision != null ? diag.injected_source_revision : null,
    floors: diag.state_horizon_floors != null ? diag.state_horizon_floors : null,
    parked: diag.anchors_parked != null ? diag.anchors_parked : null,
    injected: diag.anchors_injected != null ? diag.anchors_injected : null,
    active: diag.anchors_active != null ? diag.anchors_active : null,
    parked_terms: diag.anchors_parked_terms != null ? diag.anchors_parked_terms : null,
    at: diag.injected_at != null ? diag.injected_at : null,
  };
}

/** A plain-data snapshot of one turn, including both prompt channels. */
export function deepSnapshot(ctx, full = false) {
  const store = (ctx && ctx.chatMetadata && ctx.chatMetadata[META_KEY]) || {};
  const history = store.raw_history || {};
  const records = history.records || {};
  const rows = Array.isArray(ctx && ctx.chat) ? ctx.chat : [];
  const recordOut = {};
  if (full) for (const id of Object.keys(records)) {
    const row = records[id] || {};
    recordOut[id] = { index: row.index, role: row.role, name: row.name, text: String(row.text || '') };
  }
  return {
    at: Date.now(), chatId: ctx.chatId, name2: ctx.name2, chatLength: rows.length,
    completeTurns: completeTurnsOf(rows), folded: rows.filter(row => row && row.is_system === true).length,
    anchors: store.narrative_anchors || null, summary: store.narrative_summary || null,
    knowledge: store.narrative_knowledge || null, diagnostics: store.narrative_diagnostics || null,
    rawHistory: { active: history.active || [], recordIds: Object.keys(records).sort(), recordCount: Object.keys(records).length, records: recordOut },
    prompts: promptsOf(ctx),
  };
}

/** Add one user turn, generate one normal reply, and retry a blank reply at most twice. */
export async function submitTurn(ctx, text) {
  const beforeLen = ctx.chat.length;
  const message = { name: ctx.name1, is_user: true, mes: text, send_date: Date.now(), extra: {} };
  ctx.chat.push(message);
  ctx.addOneMessage(message);
  await ctx.saveChat();
  const started = Date.now();
  let genError = null;
  const isBlank = () => {
    const last = ctx.chat[ctx.chat.length - 1];
    return !last || last.is_user === true || !String(last.mes || '').trim();
  };
  const attempt = async () => {
    try { await ctx.generate('normal'); }
    catch (error) { genError = String((error && error.message) || error); }
  };
  await attempt();
  let retries = 0;
  let blanks = 0;
  while (isBlank() && retries < 2) {
    retries += 1;
    blanks += 1;
    if (ctx.chat.length > beforeLen + 1 && ctx.chat[ctx.chat.length - 1].is_user !== true) ctx.chat.pop();
    try { await ctx.saveChat(); } catch (error) { genError = genError || String((error && error.message) || error); }
    await attempt();
  }
  const last = ctx.chat[ctx.chat.length - 1];
  return {
    beforeLen, afterLen: ctx.chat.length, elapsed_ms: Date.now() - started, genError, retries, blanks,
    reply: last && last.is_user !== true ? { is_user: last.is_user, name: last.name, mes: last.mes } : null,
  };
}

/** Wait for the background summary at a batch boundary without forcing one. */
export async function waitForSummary(ctx, { prevCovered, prevErrorAt, timeoutMs, calls }) {
  const started = Date.now();
  const modelCalls = () => (calls || []).filter(call => call.kind === 'summary' || call.kind === 'repair');
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const store = (ctx.chatMetadata && ctx.chatMetadata[META_KEY]) || {};
    const diag = store.narrative_diagnostics || {};
    const covered = (store.narrative_summary && store.narrative_summary.covered.length) || 0;
    const summaryCalls = modelCalls();
    const settled = summaryCalls.length ? summaryCalls[summaryCalls.length - 1] : null;
    const errorAt = diag.summary_last_error ? diag.summary_last_error.at : 0;
    last = {
      covered, blocked: !!diag.summary_block, lastErrorAt: errorAt, calls: summaryCalls.length,
      lastError: diag.summary_last_error
        ? { stage: diag.summary_last_error.stage, recovered: diag.summary_last_error.recovered, attempt: diag.summary_last_error.attempt }
        : null,
    };
    if (covered > prevCovered) return Object.assign({ settled: true, reason: 'committed', ms: Date.now() - started }, last);
    if (diag.summary_block) return Object.assign({ settled: true, reason: 'blocked', ms: Date.now() - started }, last);
    if (errorAt && errorAt > (Number(prevErrorAt) || 0) && diag.summary_last_error && !diag.summary_last_error.recovered) {
      return Object.assign({ settled: true, reason: 'failed', ms: Date.now() - started }, last);
    }
    if (settled && settled.ok === false && diag.summary_last_error && !diag.summary_last_error.recovered) {
      return Object.assign({ settled: true, reason: 'failed', ms: Date.now() - started }, last);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return Object.assign({ settled: false, reason: 'timeout', ms: Date.now() - started }, last || {});
}

/** The bounded per-turn state summary. */
export function summarizeState(state) {
  if (!state) return null;
  const diag = state.diagnostics || {};
  return {
    at: state.at, chatId: state.chatId, name2: state.name2, chatLength: state.chatLength,
    completeTurns: state.completeTurns, folded: state.folded,
    covered: state.summary && Array.isArray(state.summary.covered) ? state.summary.covered.length : 0,
    summaryStateRevision: state.summary ? state.summary.state_revision : null,
    summarySourceRevision: state.summary ? state.summary.source_revision : null,
    summaryChars: state.summary ? String(state.summary.text || '').length : 0,
    anchorsActive: state.anchors && state.anchors.active ? state.anchors.active.length : 0,
    anchorsSuperseded: state.anchors && state.anchors.superseded ? state.anchors.superseded.length : 0,
    anchorsResolved: state.anchors && state.anchors.resolved ? state.anchors.resolved.length : 0,
    pendingFloors: diag.pending_floors != null ? diag.pending_floors : null,
    pendingTokens: diag.pending_tokens != null ? diag.pending_tokens : null,
    summaryFailures: diag.summary_failures != null ? diag.summary_failures : null,
    summaryError: diag.summary_error != null ? diag.summary_error : null,
    summaryBlock: diag.summary_block != null ? diag.summary_block : null,
    summaryLastError: diag.summary_last_error != null ? diag.summary_last_error : null,
    anchorOps: diag.anchor_ops != null ? diag.anchor_ops : null,
    anchorParse: diag.anchor_parse != null ? diag.anchor_parse : null,
    anchorOpErrors: diag.anchor_op_errors != null ? diag.anchor_op_errors : null,
    anchorRepair: diag.anchor_repair != null ? diag.anchor_repair : null,
    coveredFloors: diag.summary_covered_floors != null ? diag.summary_covered_floors : null,
    injected: injectionOf(state),
    promptChars: {
      reference: state.prompts && state.prompts.reference ? state.prompts.reference.length : 0,
      current_state: state.prompts && state.prompts.current_state ? state.prompts.current_state.length : 0,
    },
    rawActive: state.rawHistory ? state.rawHistory.active.length : null,
    rawRecords: state.rawHistory ? state.rawHistory.recordCount : null,
  };
}

/** One captured call as a record: request, response and elapsed for both evidence-bearing kinds. */
export function summarizeCall(call) {
  const response = call.response || null;
  const choice = (() => { try { return response.choices[0]; } catch (error) { return null; } })();
  const request = call.request || null;
  const messages = request && Array.isArray(request.messages) ? request.messages : [];
  const repairMessage = messages.find(m => m && typeof m.content === 'string' && m.content.startsWith(REPAIR_OPENER));
  return {
    at: call.at, kind: call.kind || 'summary', ok: call.ok === true, error: call.error || null,
    elapsed_ms: call.elapsed_ms != null ? call.elapsed_ms : null,
    request_json_chars: call.request_json_chars != null ? call.request_json_chars : null,
    requested_output_cap: request ? (request.max_tokens != null ? request.max_tokens : (request.max_completion_tokens != null ? request.max_completion_tokens : (request.maxTokens != null ? request.maxTokens : null))) : null,
    finish_reason: choice ? (choice.finish_reason != null ? choice.finish_reason : null) : null,
    usage: response && response.usage ? response.usage : null,
    content_chars: choice && choice.message ? String(choice.message.content || '').length : null,
    response_content: choice && choice.message ? String(choice.message.content || '') : null,
    repair_request_text: repairMessage ? repairMessage.content : null,
    request,
    response,
  };
}

/** One turn's record. The injected block is carried for every turn, not only the batch and final turns. */
export function buildTurnRecord({ turn, userText, at, isBatch, error = null, turnRes = null, pre = null, post = null, wait = null, newCalls = [] }) {
  return {
    turn, userText, at, isBatch, error,
    turnRes: turnRes ? {
      beforeLen: turnRes.beforeLen, afterLen: turnRes.afterLen, elapsed_ms: turnRes.elapsed_ms,
      genError: turnRes.genError || null, retries: turnRes.retries, blanks: turnRes.blanks,
      replyChars: turnRes.reply ? String(turnRes.reply.mes || '').length : null,
      reply: turnRes.reply ? String(turnRes.reply.mes || '') : null,
    } : null,
    pre: summarizeState(pre), post: summarizeState(post), wait: wait || null,
    injections: {
      before: pre ? (pre.prompts || null) : null,
      after: post ? (post.prompts || null) : null,
    },
    injectionAfterTurn: post ? injectionOf(post) : null,
    newCallCount: newCalls.length,
    newCalls: newCalls.map(summarizeCall),
  };
}

/** Split a frozen summary request into its named parts. Pure, so the driver can call it in Node. */
export function splitRequest(text) {
  const marks = ['【旧摘要】\n', '【当前锚点】\n', '【当前知情边界】\n', '【新增原文】\n'];
  const positions = marks.map(mark => text.indexOf(mark));
  const names = ['previous', 'anchors', 'knowledge', 'batch'];
  const out = {};
  for (let index = 0; index < marks.length; index += 1) {
    if (positions[index] < 0) { out[names[index]] = null; continue; }
    const from = positions[index] + marks[index].length;
    const next = index + 1 < marks.length && positions[index + 1] >= 0 ? positions[index + 1] - 2 : text.length;
    out[names[index]] = text.slice(from, next);
  }
  out.instructions = positions[0] >= 0 ? text.slice(0, positions[0]) : text;
  const batchEntries = [];
  if (out.batch) for (const block of out.batch.split('\n\n')) {
    const match = /^\[([^\]]+)\]\s*(.*)$/s.exec(block);
    if (match) batchEntries.push({ id: match[1], text: match[2] });
  }
  out.batchEntries = batchEntries;
  const plan = [];
  if (out.anchors) for (const line of out.anchors.split('\n')) {
    const match = /^-\s*(A\d+)\s*\|\s*(.*)$/.exec(line.trim());
    if (match) plan.push({ alias: match[1], rest: match[2], line: line.trim() });
  }
  out.plan = plan;
  return out;
}

/** One batch's evidence, including the injected text and the two call kinds. */
export function buildBatchEvidence({ batchTurn, at, pre = null, post = null, newCalls = [], wait = null, requestText = null, requestParts = null, frozenBatch = null, previousSummary = null, numberedAnchorTable = null }) {
  const calls = (newCalls || []).map(summarizeCall);
  return {
    batchTurn, at, frozenBatch: frozenBatch || null, previousSummary: previousSummary || null,
    numberedAnchorTable: numberedAnchorTable || null, requestText: requestText || null, requestParts: requestParts || null,
    calls,
    counts: {
      completeTurnsBefore: pre ? pre.completeTurns : null,
      completeTurnsAfter: post ? post.completeTurns : null,
      foldedBefore: pre ? pre.folded : null,
      foldedAfter: post ? post.folded : null,
      coveredBefore: pre && pre.summary && pre.summary.covered ? pre.summary.covered.length : 0,
      coveredAfter: post && post.summary && post.summary.covered ? post.summary.covered.length : null,
      pendingFloorsBefore: pre && pre.diagnostics ? pre.diagnostics.pending_floors : null,
      pendingFloorsAfter: post && post.diagnostics ? post.diagnostics.pending_floors : null,
      pendingTokensBefore: pre && pre.diagnostics ? pre.diagnostics.pending_tokens : null,
      pendingTokensAfter: post && post.diagnostics ? post.diagnostics.pending_tokens : null,
    },
    ledger: { before: pre ? pre.anchors : null, after: post ? post.anchors : null },
    summaryBefore: pre ? pre.summary : null, summaryAfter: post ? post.summary : null,
    knowledgeBefore: pre ? pre.knowledge : null, knowledgeAfter: post ? post.knowledge : null,
    diagnosticsBefore: pre ? pre.diagnostics : null, diagnosticsAfter: post ? post.diagnostics : null,
    injectionAfter: post ? injectionOf(post) : null,
    promptsAfter: post ? (post.prompts || null) : null,
    wait: wait || null,
    unknown: {
      finish_reason: calls.length === 0 ? 'no_call' : calls.some(call => call.finish_reason == null) ? 'at_least_one_null' : null,
      requested_output_cap: calls.length === 0 ? 'no_call' : calls.some(call => call.requested_output_cap == null) ? 'null_in_request' : null,
      usage: calls.length === 0 ? 'no_call' : calls.some(call => !call.usage) ? 'missing_usage' : null,
      request_text: requestText ? null : 'request_text_not_found',
      injection: post && post.diagnostics ? null : 'no_injection_diagnostics',
      injected_text: post && post.prompts && post.prompts.current_state ? null : 'missing_current_state',
      repair_elapsed: calls.some(call => call.kind === 'repair' && call.elapsed_ms == null) ? 'repair_elapsed_null' : null,
    },
  };
}
