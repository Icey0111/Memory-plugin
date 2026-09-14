// Reusable long-chat acceptance driver for the narrative summary protocol.
//
//   node acceptance-longchat.mjs --turns <turns.json> --out <directory> [--cdp <url>] [--start 1]
//        [--batches 10,20,30,40] [--summary-timeout 420000] [--max N]
//   node acceptance-longchat.mjs --turns <turns.json> --out <directory> --detail-survival
//   node acceptance-longchat.mjs --out <directory> --restore-snapshot <full-snapshot.json> [--restore-persist]
//        # put a saved transcript back and rebuild the host surface; no turns file, no model call
//
// --restore-snapshot is the harness step a restored chat needs. Replacing ctx.chat without rebuilding the
// host's bounded ChatSurface leaves the old message roots mounted, and the next reconcile refuses the
// surviving set ("ChatSurface projection has 3 ranges; maximum is 2"). The restore resets the surface epoch,
// re-renders the canonical chat through the host, and only then re-applies the plugin's fold classes; a
// class-only pass such as syncFloorFoldDom cannot do it. It never saves unless --restore-persist is given.
//
// --detail-survival is the reproducible form of the detail-survival baseline. Phase 1 plays a turns file
// whose details each declare a needle and the question to ask about it. After the phase-1 batches commit,
// the mode reads the committed summary - prose, active anchors and knowledge - and asks only the details it
// actually dropped, plus one retained positive control and every declared negative control, all in one
// probe turn. It reports the channel each needle was found in, read from the probe turn's own
// injections.thisTurn, and hands every item to answer-adjudication.mjs. The needles are data in the turns
// file; nothing is picked by hand at scoring time. See detail-survival.mjs for the schema.
//
// Every run that plays a turns file freezes the input it actually used into <out>/turns.fixture.json before
// the first model call, with the source path, byte count and sha256. The recorded chat can always be
// replayed, but only the frozen fixture can be re-run as the same fixture - and the file the run was given is
// not committed and may be gone by the time a later change wants to be compared against it. Replay with the
// ordinary command, --turns <out>/turns.fixture.json; the meta file names the fixture and its source hash.
//
// Both --turns and --out are required, and --out must stay outside the repository: the turns file and the
// evidence hold real chat text and raw model responses, which are not committed. The capture module is
// versioned; the data it records is not, and there is no repository-local vault for it. Run
// 'node runtime-precheck.mjs' first so the page and the repository are the same code - this driver imports
// the deployed acceptance-capture.js from the page, so a stale page would record with stale logic.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { awaitJson, collectSettled, buildTurnRecord, buildBatchEvidence, splitRequest } from './acceptance-capture.js';
import { parseTurnsFile, continuityBag, splitDetailsByRetention, choosePositive, buildProbeItems,
  buildProbeQuestion, gradeProbeItem, summarizeDetailSurvival, formatDetailReport, buildDetailEvidence,
  summarizeFactSurvival, formatFactSurvival, freezeTurnsFixture } from './detail-survival.mjs';
import { parseAdjudicationJsonl, summarizeAdjudication } from './answer-adjudication.mjs';

const args = process.argv.slice(2);
const valueOf = (name, fallback = null) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const detailMode = args.includes('--detail-survival');
const restoreFile = valueOf('--restore-snapshot', null);
const restorePersist = args.includes('--restore-persist');
if (!args.includes('--out')) throw new Error('Explicit --out required; acceptance evidence must not be written into the repository.');
if (!args.includes('--turns') && !restoreFile) {
  throw new Error('Explicit --turns required (or --restore-snapshot); chat text is not committed.');
}
const outDir = valueOf('--out');
const turnsPath = valueOf('--turns');
const cdpBase = valueOf('--cdp', 'http://127.0.0.1:9222');
const startAt = Number(valueOf('--start', '1'));
const summaryTimeout = Number(valueOf('--summary-timeout', '420000'));
let batches = String(valueOf('--batches', detailMode ? '10,20' : '10,20,30,40')).split(',').map(Number).filter(Boolean);
const maxTurn = Number(valueOf('--max', '0')) || null;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const resolvedOut = path.resolve(outDir);
if (resolvedOut === HERE || resolvedOut.startsWith(HERE + path.sep)) {
  throw new Error('--out must stay outside the repository: ' + resolvedOut);
}

// A restore point is read instead of a turns file: --restore-snapshot only puts a saved transcript back.
let parsedTurns = { legacy: false, cadence: 10, phase1Turns: null, probeMode: 'single',
  turns: [], details: [], negatives: [], errors: [] };
let turns = [];
let turnsBytes = null;
let restorePoint = null;
if (restoreFile) {
  if (!fs.existsSync(restoreFile)) throw new Error('--restore-snapshot file not found: ' + restoreFile);
  if (detailMode) throw new Error('--restore-snapshot and --detail-survival are separate actions; run them as separate processes');
  // Parse and validate before the CDP connection: a bad restore point must not patch a live host.
  restorePoint = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
  if (!Array.isArray(restorePoint.chat)) {
    throw new Error('--restore-snapshot needs a full snapshot with a chat array (deepSnapshot(ctx, true)): ' + restoreFile);
  }
} else {
  turnsBytes = fs.readFileSync(turnsPath);
  const rawTurns = JSON.parse(turnsBytes.toString('utf8'));
  parsedTurns = parseTurnsFile(rawTurns);
  if (parsedTurns.errors.length) throw new Error('turns file: ' + parsedTurns.errors.join('; '));
  if (detailMode && parsedTurns.legacy) {
    throw new Error('--detail-survival needs a detailed turns file: a bare array of turn strings carries no needles. See detail-survival.mjs for the schema.');
  }
  turns = parsedTurns.turns;
}
// Fail before a paid run: a question that gives its own answer away is a fixture defect, and the whole
// declared set is checked here because a single probe turn may carry every dropped item at once.
if (detailMode && !restoreFile) {
  const declared = parsedTurns.details.concat(parsedTurns.negatives)
    .map(item => ({ id: item.id, needle: item.needle, question: item.question }));
  const preflight = buildProbeQuestion(declared);
  if (preflight.leaks.length) {
    throw new Error('turns file: these questions contain their own needle and would give the answer away: '
      + preflight.leaks.join(', '));
  }
}
fs.mkdirSync(outDir, { recursive: true });
// Freeze the input before a single model call is spent. The recorded chat can always be replayed, but only
// a frozen fixture can be *re-run* as the same fixture, and the file this run was given may be gone by
// then (it is not committed). The frozen file is a turns file itself, so the replay is the ordinary
// command with --turns pointing at it; the sha256 records which original it came from.
let turnsFixture = null;
if (!restoreFile) {
  const fixturePath = path.join(outDir, 'turns.fixture.json');
  const frozen = freezeTurnsFixture(parsedTurns, {
    sourcePath: path.resolve(turnsPath), sha256: createHash('sha256').update(turnsBytes).digest('hex'),
    bytes: turnsBytes.length, startAt, playedTurns: turns.length, batches });
  fs.writeFileSync(fixturePath, JSON.stringify(frozen, null, 2));
  turnsFixture = { file: fixturePath, source: frozen.source, playedTurns: frozen.run.playedTurns,
    declaredDetails: parsedTurns.details.length, negativeControls: parsedTurns.negatives.length };
  console.log('frozen fixture: ' + fixturePath + ' sha256=' + frozen.source.sha256.slice(0, 16)
    + ' turns=' + frozen.run.playedTurns + ' details=' + parsedTurns.details.length);
}
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

// A restore does not spend a model call, so it does not patch the host's transport: importing the module
// is enough. The long-chat runner installs the capture boundary.
const installExpression = "(async () => {"
  + " const module = await import('/scripts/extensions/third-party/Memory-plugin/acceptance-capture.js');"
  + " if (" + JSON.stringify(Boolean(restoreFile)) + ") { window.__acceptance = { module: module };"
  + " return JSON.stringify({ installed: true, capture: false }); }"
  + " const ctx = SillyTavern.getContext();"
  + " window.__acceptance = { module: module, boundary: module.installCapture(ctx) };"
  + " return JSON.stringify({ installed: true, capture: true, modelCalls: window.__acceptance.boundary.modelCalls().length });"
  + " })()";
console.log('capture installed: ' + (await evaluate(installExpression)));

// The restore action: put a full snapshot's transcript and derived state back, then rebuild the host's
// bounded surface through its own reset entry points (see acceptance-capture.js). Everything below this
// branch is the long-chat runner, which a restore does not use.
if (restorePoint) {
  const restored = await asJson("(async () => { const result = await window.__acceptance.module.restoreSnapshot("
    + "SillyTavern.getContext(), " + JSON.stringify(restorePoint) + ", " + JSON.stringify({ save: restorePersist }) + ");"
    + " return JSON.stringify(result); })()");
  const restorePath = path.join(outDir, 'restore.json');
  fs.writeFileSync(restorePath, JSON.stringify({ at: nowIso(), snapshot: restoreFile,
    rows: restorePoint.chat.length, persisted: restorePersist, result: restored }, null, 2));
  console.log('restored ' + restorePoint.chat.length + ' rows (persisted=' + restorePersist + '): '
    + JSON.stringify(restored) + ' -> ' + restorePath);
  socket.close();
  process.exit(0);
}

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
  detailMode, legacyTurns: parsedTurns.legacy, probeMode: parsedTurns.probeMode, cadence: parsedTurns.cadence,
  turnsFixture,
  declaredDetails: parsedTurns.details.length, negativeControls: parsedTurns.negatives.length,
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
if (detailMode && startAt !== 1) {
  throw new Error('--detail-survival runs the whole phase-1 sequence: the adaptive selection needs one committed summary, not a resumed count.');
}
if (detailMode && last % parsedTurns.cadence !== 0) {
  throw new Error('--detail-survival needs phase 1 to end on a cadence boundary: ' + last + ' turns at cadence ' + parsedTurns.cadence);
}
if (detailMode && parsedTurns.phase1Turns && parsedTurns.phase1Turns !== turns.length) {
  throw new Error('phase1Turns (' + parsedTurns.phase1Turns + ') does not match the ' + turns.length
    + ' turns in the file; the phase-1 file must carry exactly the turns it plays');
}
if (detailMode && !batches.includes(last)) batches = batches.concat(last).sort((a, b) => a - b);
const collected = new Set();
// One committed-summary reading per batch, so a fact can be seen crossing more than one merge.
const factObservations = [];

// One turn: snapshot, generate, wait for a batch summary, capture and append. The plain loop and the
// detail-survival probe turns both run through here, so a probe turn is recorded exactly like any other.
const runTurn = async (turnNo, text, { isBatch, deep }) => {
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
  return { record, pre, post, waitRes, newCalls, error };
};

for (let turnNo = startAt; turnNo <= last; turnNo += 1) {
  const text = turns[turnNo - 1].text;
  const isBatch = batches.includes(turnNo);
  const deep = isBatch || turnNo === last;
  const { record, post, newCalls, waitRes, error } = await runTurn(turnNo, text, { isBatch, deep });
  const state = record.post || {};
  console.log('turn ' + turnNo + '/' + last + (error ? ' ERROR=' + error : '')
    + ' len=' + (state.chatLength != null ? state.chatLength : '?') + ' completed=' + (state.completeTurns != null ? state.completeTurns : '?')
    + ' covered=' + (state.covered != null ? state.covered : '?') + ' folded=' + (state.folded != null ? state.folded : '?')
    + ' anchors=' + (state.anchorsActive != null ? state.anchorsActive : '?') + ' pending=' + (state.pendingFloors != null ? state.pendingFloors : '?')
    + ' fails=' + (state.summaryFailures != null ? state.summaryFailures : '?') + ' injRev=' + (state.injected ? state.injected.state_revision : '?'));
  if (detailMode && isBatch && parsedTurns.details.length) {
    const split = splitDetailsByRetention(parsedTurns.details, continuityBag(post));
    // The raw summary output, so a loss can be attributed to the model or to the pipeline.
    const rawResponse = (newCalls || []).map(call => {
      try { return call.response.choices[0].message.content || ''; } catch (error) { return ''; }
    }).join('\n');
    factObservations.push({ batchTurn: turnNo, retained: split.retained.map(item => item.id),
      dropped: split.dropped.map(item => item.id), rawResponse,
      committed: Boolean(waitRes && waitRes.reason === 'committed') });
    console.log('FACT-SURVIVAL batch ' + turnNo + ': kept ' + split.retained.length + '/' + parsedTurns.details.length
      + (split.dropped.length ? ' dropped ' + split.dropped.map(item => item.id).join(',') : ''));
  }
}

// Detail survival: turn the manual baseline into a repeatable mode. Phase 1 has played the turns file and
// the phase-1 batches have committed; the committed summary decides which details to ask about, so the
// author's expectation never selects anything. Only the probe turn's own block (injections.thisTurn) is
// graded - reading the previous turn's block is what once made retrieval look a turn late.
if (detailMode) {
  const phase1Last = last;
  const committed = await snapshot(true);
  const bag = continuityBag(committed);
  const retention = splitDetailsByRetention(parsedTurns.details, bag);
  const positive = choosePositive(retention.retained);
  const items = buildProbeItems({ dropped: retention.dropped, positive, negatives: parsedTurns.negatives });
  console.log('DETAIL-SURVIVAL retention: 已声明 ' + retention.total + ' 个细节，摘要保留 ' + retention.retained.length
    + ' 个，丢弃 ' + retention.dropped.length + ' 个；预期不符 ' + retention.expectationMismatches.length
    + (retention.expectationMismatches.length ? '（' + retention.expectationMismatches.join(', ') + '）' : ''));
  if (factObservations.length) {
    const factSurvival = summarizeFactSurvival(parsedTurns.details, factObservations);
    console.log('');
    console.log(formatFactSurvival(factSurvival));
    fs.writeFileSync(path.join(outDir, 'fact-survival.json'),
      JSON.stringify({ at: nowIso(), observations: factObservations, summary: factSurvival }, null, 2));
  }
  if (!retention.dropped.length) {
    console.log('DETAIL-SURVIVAL notice: 摘要没有丢掉任何已声明细节，本次运行只测到 continuity 通道，不能证明检索。');
  }
  if (!items.length) {
    console.log('DETAIL-SURVIVAL: 没有可提问的条目（无 dropped、无正控、无负控），跳过阶段二。');
  } else {
    const perTurn = parsedTurns.probeMode === 'perTurn';
    const groups = perTurn ? items.map(item => [item]) : [items];
    if (perTurn) {
      console.log('DETAIL-SURVIVAL notice: perTurn 每条问题一个回合，回合之间把阶段一状态还原回去，'
        + '所以每条都是同一起点的独立样本；single 模式（默认）把全部问题放进一个回合，共用一份证据预算。');
    }
    const probes = [];
    const graded = [];
    let probeTurnNo = phase1Last;
    for (const [groupIndex, group] of groups.entries()) {
      // A later question must not read an earlier reply: without this restore the second probe is a follow-up
      // to the first, not a second sample of the same state, and the two are indistinguishable in the reply.
      // The restore is the harness step ADR-0034 already describes - reset the surface epoch, redisplay the
      // canonical chat, re-apply the fold classes - and it does not save the chat file.
      let restored = false;
      if (perTurn && groupIndex > 0) {
        const restoreResult = await asJson('window.__acceptance.module.restoreSnapshot(SillyTavern.getContext(), '
          + JSON.stringify(committed) + ', ' + JSON.stringify({ save: false }) + ')');
        restored = true;
        console.log('DETAIL-SURVIVAL restore before probe ' + (probeTurnNo + 1) + ': ' + JSON.stringify(restoreResult));
      }
      probeTurnNo += 1;
      const question = buildProbeQuestion(group);
      if (question.leaks.length) {
        throw new Error('probe question leaks the needle for ' + question.leaks.join(', ')
          + '; a question must name the subject, never the value it is testing');
      }
      const { record, error: probeError } = await runTurn(probeTurnNo, question.text, { isBatch: false, deep: true });
      const injection = record.injections && record.injections.thisTurn ? record.injections.thisTurn : null;
      const replyText = record.turnRes && record.turnRes.reply ? record.turnRes.reply : '';
      const probeFailed = Boolean(probeError) || !replyText;
      if (probeFailed) {
        console.log('DETAIL-SURVIVAL notice: probe turn ' + probeTurnNo + ' produced no reply'
          + (probeError ? ' (error: ' + probeError + ')' : '') + '; its items are recorded as fixture-defect, not as model misses.');
      }
      const rows = group.map(item => gradeProbeItem(item, { injection, replyText, questionText: question.text, probeFailed }));
      graded.push(...rows);
      probes.push({ turn: probeTurnNo, question: question.text, leaks: question.leaks, replyText, injection,
        items: group.map(item => item.id), restored, error: probeError || null, graded: rows });
    }
    const adjudication = parseAdjudicationJsonl(graded.map(row => JSON.stringify(row.mechanical)).join('\n'));
    const adjudicationSummary = summarizeAdjudication(adjudication.rows);
    const survival = summarizeDetailSurvival({ rows: adjudication.rows, retention, items });
    const detailEvidence = buildDetailEvidence({ at: nowIso(), probeTurns: probes.map(probe => probe.turn),
      phase1Last, retention, positive, items, probes, adjudicationErrors: adjudication.errors,
      adjudicationSummary, survival, probeMode: parsedTurns.probeMode,
      foldedRows: Array.isArray(committed.folded) ? committed.folded : Number(committed.folded) || 0,
      summaryCommitted: Boolean(committed.summary && committed.summary.text) });
    fs.writeFileSync(path.join(outDir, 'detail-survival.json'), JSON.stringify(detailEvidence, null, 2));
    fs.writeFileSync(path.join(outDir, 'detail-survival.adjudication.jsonl'),
      adjudication.rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    console.log('DETAIL-SURVIVAL samples: ' + JSON.stringify(detailEvidence.independence));
    if (!detailEvidence.attribution.meaningful) {
      console.log('DETAIL-SURVIVAL notice: ' + detailEvidence.attribution.note + '（folded='
        + detailEvidence.attribution.foldedRows + ', summary=' + detailEvidence.attribution.summaryCommitted
        + '）；本轮的 channel/编造 读数不作结论。');
    }
    console.log(formatDetailReport(survival));
    for (const outcome of survival.outcomes) {
      console.log('  probe ' + outcome.id + ' kind=' + outcome.kind + ' fact=' + outcome.factKind + ' channel=' + outcome.channel
        + ' conveys=' + outcome.conveys + ' -> ' + outcome.outcome
        + (outcome.fixtureDefect ? ' [fixture-defect]' : ''));
    }
    console.log('DETAIL-SURVIVAL evidence: ' + path.join(outDir, 'detail-survival.json'));
  }
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
