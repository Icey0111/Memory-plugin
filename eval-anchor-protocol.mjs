// Opt-in fixed-material model evaluation. Uses the host's summary connection, never its chat/store.
// node eval-anchor-protocol.mjs --out <report.json> [--cdp http://127.0.0.1:9222]
import fs from 'node:fs';
import { summaryRequest, parseAnchors, parseAnchorChanges, mergeAnchors } from './raw-history.js';
import { estimateTokens } from './v55-tokenizer.js';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--out')) throw new Error('Explicit --out required; this evaluation makes five model calls.');
const base = { id: 'knife', revision: 1, kind: '位置', subject: '刀的位置', text: '刀在井底。' };
const promise = { id: 'promise', revision: 1, kind: '承诺', subject: '归还钥匙',
    text: '甲承诺天亮前归还钥匙，前提是乙先释放人质。' };
const cases = [
    { name: 'empty-ledger-add', anchors: [], expected: 'add', source: 'raw_77',
        text: '甲郑重承诺：明天天亮前，我一定把唯一的铜钥匙还给乙，但前提是乙先释放人质。乙答应了，人质尚未释放，钥匙仍在甲手里。' },
    { name: 'named-update', anchors: [base], expected: 'update', target: 'knife', source: 'raw_78',
        text: '乙把那把刀从井底捞了出来，放在井边。刀已经不在井底，现在就在井边。' },
    { name: 'conditional-update', anchors: [promise], expected: 'update', target: 'promise', source: 'raw_79',
        text: '甲和乙一致同意，归还钥匙的期限改成明天正午；乙先释放人质这个前提不变。人质还没释放，钥匙也尚未归还。' },
    { name: 'named-end', anchors: [promise], expected: 'end', target: 'promise', source: 'raw_80',
        text: '乙已经释放人质。甲在天亮前将钥匙交还给乙，乙验收并确认归还钥匙的约定已经履行完毕，双方再无这项待办。' },
    { name: 'unchanged', anchors: [base], expected: 'none', source: 'raw_81',
        text: '甲站在井旁休息。刀依旧在井底，谁也没有移动它，没有新增约定或其他变化。' },
];
const targets = await (await fetch((args.includes('--cdp') ? option('--cdp') : 'http://127.0.0.1:9222') + '/json/list')).json();
const target = targets.find(t => t.type === 'page');
if (!target) throw new Error('No host page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    if (pending.has(reply.id)) { pending.get(reply.id)(reply); pending.delete(reply.id); }
});
const evaluate = async expression => {
    const id = ++sequence;
    const response = new Promise(resolve => pending.set(id, resolve));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true,
        returnByValue: true, timeout: 190000 } }));
    const reply = await response;
    if (reply.error || reply.result?.exceptionDetails) throw new Error('Host evaluation failed');
    return reply.result.result.value;
};
const report = { at: new Date().toISOString(), cases: [] };
try {
    for (const fixture of cases) {
        const request = summaryRequest('', [{ id: fixture.source, retrievalText: fixture.text }], 600, fixture.anchors, []);
        const response = await evaluate(`(async () => {
            const ctx = SillyTavern.getContext();
            const {requestSummary} = await import('/scripts/extensions/third-party/Memory-plugin/summary-transport.js');
            return await requestSummary(ctx, ${JSON.stringify(request.text)},
                structuredClone(ctx.extensionSettings.aetheriaUnifiedMemoryV54 || {}));
        })()`);
        const parsed = parseAnchors(response.text);
        const checked = parseAnchorChanges(parsed.anchorLines, { plan: request.anchors, batchSources: new Set([fixture.source]) });
        const applied = mergeAnchors({ active: fixture.anchors }, checked.changes, { plan: request.anchors });
        const structuralPass = !!parsed.summary && !checked.errors.length && applied.ok && estimateTokens(parsed.summary) <= 600
            && (fixture.expected === 'none' ? parsed.anchor_section === 'none'
                : checked.changes.length > 0 && checked.changes.every(c => c.op === fixture.expected
                    && !c.reinterpreted && (!fixture.target || c.id === fixture.target)));
        report.cases.push({ fixture, request, response, parsed, checked, applied, structuralPass });
        fs.writeFileSync(option('--out'), JSON.stringify(report, null, 2));
        console.log(fixture.name + ': ' + (structuralPass ? 'PASS' : 'FAIL') + ' (meaning requires review)');
    }
} finally { ws.close(); }
if (report.cases.some(c => !c.structuralPass)) process.exitCode = 1;
