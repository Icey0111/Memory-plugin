// Reusable long-chat acceptance driver for the narrative summary protocol.
//
//   node acceptance-longchat.mjs --turns <turns.json> --out <directory> [--cdp <url>] [--start 1]
//        [--batches 10,20,30,40] [--summary-timeout 420000] [--max N]
//
// Both --turns and --out are required, and --out must stay outside the repository (or under the ignored
// remove/ directory): the turns file and the evidence hold real chat text and raw model responses, which are
// not committed. The capture module is versioned; the data it records is not. Run
// 'node runtime-precheck.mjs' first so the page and the repository are the same code - this driver imports
// the deployed acceptance-capture.js from the page, so a stale page would record with stale logic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { awaitJson, collectSettled, buildTurnRecord, buildBatchEvidence, splitRequest } from './acceptance-capture.js';

const args = process.argv.slice(2);
const valueOf = (name, fallback = null) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
if (!args.includes('--out')) throw new Error('Explicit --out required; acceptance evidence must not be written into the repository.');
if (!args.includes('--turns')) throw new Error('Explicit --turns required; chat text is not committed.');
const outDir = valueOf('--out');
const turnsPath = valueOf('--turns');
const cdpBase = valueOf('--cdp', 'http://127.0.0.1:9222');
const startAt = Number(valueOf('--start', '1'));
const summaryTimeout = Number(valueOf('--summary-timeout', '420000'));
const batches = String(valueOf('--batches', '10,20,30,40')).split(',').map(Number).filter(Boolean);
const maxTurn = Number(valueOf('--max', '0')) || null;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const resolvedOut = path.resolve(outDir);
const removeDir = path.join(HERE, 'remove');
if ((resolvedOut === HERE || resolvedOut.startsWith(HERE + path.sep)) && resolvedOut !== removeDir && !resolvedOut.startsWith(removeDir + path.sep)) {
  throw new Error('--out must stay outside the repository, or under the ignored remove/ directory: ' + resolvedOut);
}

const turns = JSON.parse(fs.readFileSync(turnsPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const jsonlPath = path.join(outDir, 'longchat.turns.jsonl');
const metaPath = path.join(outDir, 'longchat.meta.json');
const evidencePath = path.join(outDir, 'longchat.summary-evidence.json');
const callsPath = path.join(outDir, 'longchat.summary-calls-all.json');
const snapDir = path.join(outDir, 'snapshots');
fs.mkdirSync(snapDir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

const targets = await (await fetch(cdpBase + '/json/list')).json();
const target = targets.find(entry => entry.type === 'page');
if (!target) throw new Error('No host page at ' + cdpBase);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const reply = JSON.parse(event.data);
  if (pending.has(reply.id)) { pending.get(reply.id)(reply); pending.delete(reply.id); }
});
const evaluate = async (expression, timeout = 900000) => {
  const id = ++sequence;
  const answer = new Promise(resolve => pending.set(id, resolve));
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, timeout } }));
  const reply = await answer;
  if (reply.error || reply.result?.exceptionDetails) throw new Error('Host evaluation failed: ' + JSON.stringify(reply.result?.exceptionDetails || reply.error));
  return reply.result.result.value;
};
// Await the page expression before stringifying it (F-12): submitTurn and waitForSummary are async, and
// JSON.stringify(promise) is the string '{}', which is how a live run silently recorded empty turn results.
const asJson = async (expression, timeout) => JSON.parse(await evaluate(awaitJson(expression), timeout));

const installExpression = "(async () => {"
  + " const module = await import('/scripts/extensions/third-party/Memory-plugin/acceptance-capture.js');"
  + " const ctx = SillyTavern.getContext();"
  + " window.__acceptance = { module: module, boundary: module.installCapture(ctx) };"
  + " return JSON.stringify({ installed: true, modelCalls: window.__acceptance.boundary.modelCalls().length });"
  + " })()";
console.log('capture installed: ' + (await evaluate(installExpression)));

const snapshot = full => asJson('window.__acceptance.module.deepSnapshot(SillyTavern.getContext(), ' + (full ? 'true' : 'false') + ')');
const modelCalls = () => asJson('window.__acceptance.boundary.modelCalls()');
const submitTurn = text => asJson('window.__acceptance.module.submitTurn(SillyTavern.getContext(), ' + JSON.stringify(text) + ')');
const waitForSummary = (prevCovered, prevErrorAt) => asJson('window.__acceptance.module.waitForSummary(SillyTavern.getContext(), { prevCovered: '
  + Number(prevCovered) + ', prevErrorAt: ' + Number(prevErrorAt) + ', timeoutMs: ' + summaryTimeout
  + ', calls: window.__acceptance.boundary.calls })', summaryTimeout + 180000);

const settings = await asJson('window.__acceptance.module.deepSnapshot(SillyTavern.getContext(), false)');
const startSnap = await snapshot(true);
const meta = {
  startedAt: nowIso(), target: { url: target.url, id: target.id }, turnsPath, outDir, startAt, batches,
  startSnapshot: { chatId: startSnap.chatId, name2: startSnap.name2, chatLength: startSnap.chatLength,
    completeTurns: startSnap.completeTurns, anchorsActive: startSnap.anchors && startSnap.anchors.active ? startSnap.anchors.active.length : 0 },
  startPrompts: startSnap.prompts,
};
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
fs.writeFileSync(path.join(snapDir, 'start.json'), JSON.stringify(startSnap, null, 2));
console.log('chat: ' + startSnap.chatId + ' name2=' + startSnap.name2 + ' len=' + startSnap.chatLength + ' settings=' + JSON.stringify(settings.diagnostics ? 'present' : 'absent'));

let summaryEvidence = [];
if (fs.existsSync(evidencePath)) { try { summaryEvidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')); } catch (error) { summaryEvidence = []; } }

const last = Math.min(turns.length, maxTurn || turns.length);
const collected = new Set();
for (let turnNo = startAt; turnNo <= last; turnNo += 1) {
  const text = turns[turnNo - 1];
  const isBatch = batches.includes(turnNo);
  const deep = isBatch || turnNo === last;
  const pre = await snapshot(deep);
  const prevCovered = pre.summary && Array.isArray(pre.summary.covered) ? pre.summary.covered.length : 0;
  const prevErrorAt = (pre.diagnostics && pre.diagnostics.summary_last_error && pre.diagnostics.summary_last_error.at) || 0;
  let turnRes = null;
  let waitRes = null;
  let post = null;
  let error = null;
  try {
    turnRes = await submitTurn(text);
    await sleep(2500);
    if (isBatch) waitRes = await waitForSummary(prevCovered, prevErrorAt);
    post = await snapshot(deep);
  } catch (caught) {
    error = String((caught && caught.message) || caught);
    try { post = await snapshot(deep); } catch (ignored) { /* keep what we have */ }
  }
  const allCalls = await modelCalls();
  const newCalls = collectSettled(allCalls, collected);
  const inFlight = allCalls.filter(call => call.status === 'running');
  const record = buildTurnRecord({ turn: turnNo, userText: text, at: nowIso(), isBatch, error, turnRes, pre, post, wait: waitRes, newCalls, inFlight });
  fs.appendFileSync(jsonlPath, JSON.stringify(record) + '\n');
  fs.writeFileSync(callsPath, JSON.stringify(allCalls, null, 2));
  if (deep) fs.writeFileSync(path.join(snapDir, 'turn' + String(turnNo).padStart(2, '0') + '.json'), JSON.stringify({ pre, post, wait: waitRes }, null, 2));
  if (isBatch) {
    const summaryMessage = newCalls
      .map(call => (call.request && Array.isArray(call.request.messages) ? call.request.messages : [])
        .find(message => message && typeof message.content === 'string' && message.content.startsWith('你是剧情续接摘要器')))
      .find(Boolean);
    const requestText = summaryMessage ? summaryMessage.content : null;
    const parts = requestText ? splitRequest(requestText) : null;
    summaryEvidence.push(buildBatchEvidence({
      batchTurn: turnNo, at: nowIso(), pre, post, newCalls, wait: waitRes, requestText, requestParts: parts,
      frozenBatch: parts ? parts.batchEntries : null, previousSummary: parts ? parts.previous : null,
      numberedAnchorTable: parts ? parts.anchors : null,
    }));
    fs.writeFileSync(evidencePath, JSON.stringify(summaryEvidence, null, 2));
    console.log('=== BATCH turn ' + turnNo + ' ' + JSON.stringify(waitRes) + ' calls=' + newCalls.length + ' ===');
  }
  const state = record.post || {};
  console.log('turn ' + turnNo + '/' + last + (error ? ' ERROR=' + error : '')
    + ' len=' + (state.chatLength != null ? state.chatLength : '?') + ' completed=' + (state.completeTurns != null ? state.completeTurns : '?')
    + ' covered=' + (state.covered != null ? state.covered : '?') + ' folded=' + (state.folded != null ? state.folded : '?')
    + ' anchors=' + (state.anchorsActive != null ? state.anchorsActive : '?') + ' pending=' + (state.pendingFloors != null ? state.pendingFloors : '?')
    + ' fails=' + (state.summaryFailures != null ? state.summaryFailures : '?') + ' injRev=' + (state.injected ? state.injected.state_revision : '?'));
}

const unfinished = (await modelCalls()).filter(call => call.status === 'running');
if (unfinished.length) console.log('WARNING: ' + unfinished.length + ' request(s) started but never settled (incomplete capture): '
  + unfinished.map(call => call.id).join(', '));
const finalSnap = await snapshot(true);
fs.writeFileSync(path.join(snapDir, 'final.json'), JSON.stringify(finalSnap, null, 2));
try { fs.writeFileSync(callsPath, JSON.stringify(await modelCalls(), null, 2)); } catch (error) { /* keep the last full list */ }
fs.writeFileSync(metaPath, JSON.stringify(Object.assign({}, meta, { finishedAt: nowIso(), unfinishedCalls: unfinished.map(call => call.id) }), null, 2));
console.log('DONE');
socket.close();
