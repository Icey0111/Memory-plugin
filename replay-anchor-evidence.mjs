// Fixed replay of the 421757c acceptance evidence through the fixed protocol.
//
// The point of a replay is to separate what the code change did from what a new story would have done. It
// reads the frozen summary requests and responses that the acceptance run captured, runs the CURRENT
// parser and merge over them, and reports the difference. No model is called, no chat state is touched.
//
// Usage:
//   node replay-anchor-evidence.mjs [--evidence remove/acceptance-anchor-semantics-421757c]
//                                   [--out <report.json>]
// Exits non-zero when a target assertion fails; exits 0 with a note when the evidence directory is absent
// (so a machine without the local acceptance corpus does not fail the syntax gate).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAnchors, parseAnchorChanges, mergeAnchors } from './raw-history.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const dir = path.resolve(HERE, option('--evidence', 'remove/acceptance-anchor-semantics-421757c'));
const outPath = option('--out', path.join(dir, 'replay', 'replay-report.json'));
if (!existsSync(dir)) { console.log('replay: evidence directory absent (' + dir + '); nothing to replay'); process.exit(0); }

const readJson = file => { try { return JSON.parse(readFileSync(path.join(dir, file), 'utf8')); } catch { return null; } };
const section = (prompt, head, next) => {
    const start = String(prompt).indexOf(head);
    if (start < 0) return '';
    const from = start + head.length;
    const end = next ? String(prompt).indexOf(next, from) : -1;
    return String(prompt).slice(from, end < 0 ? undefined : end);
};
const planFromPrompt = prompt => section(prompt, '【当前锚点】', '【当前知情边界】').trim().split('\n')
    .map(line => line.replace(/^[-*·・]\s*/, '').trim()).filter(Boolean)
    .map(line => {
        const cells = line.split('|').map(cell => cell.trim());
        if (!/^A\d+$/.test(cells[0] || '')) return null;
        return { alias: cells[0], id: 'replay_' + cells[0], revision: 1, kind: cells[1] || '其他',
            subject: cells.length > 3 ? cells[2] : '', text: cells.length > 3 ? cells.slice(3).join(' | ') : cells.slice(2).join(' | ') };
    }).filter(Boolean);
const sourcesFromPrompt = prompt => [...new Set([...section(prompt, '【新增原文】', '').matchAll(/\[(raw_\d+)\]/g)].map(m => m[1]))];
const responseText = call => call?.response?.choices?.[0]?.message?.content
    ?? call?.response?.text ?? (typeof call?.response === 'string' ? call.response : '');
const requestText = call => call?.request?.messages?.[0]?.content ?? call?.request?.text ?? '';
const MULTI = /来源\s*([^|\n]*raw_\d+\s*[,，、;；/]\s*raw_\d+[^|\n]*)/;

const report = { at: new Date().toISOString(), evidence: dir, probe: [], calls: [], findings: {}, targets: [] };
const check = (name, ok, detail) => { report.targets.push({ name, ok: Boolean(ok), detail: detail || '' });
    if (!ok) console.log('ASSERT FAIL: ' + name + (detail ? ' - ' + detail : '')); };

// --- 1. the five frozen probe cases, including the missing-heading one -------------------------------
const probe = readJson('run1/eval-anchor-protocol.json');
if (probe) {
    const EXPECT = { 'empty-ledger-add': 'add', 'named-update': 'update', 'conditional-update': 'update',
        'named-end': 'end', unchanged: 'none' };
    for (const item of probe.cases) {
        const name = item.fixture.name;
        const parsed = parseAnchors(item.response.text);
        const checked = parseAnchorChanges(parsed.anchorLines, { plan: item.request.anchors,
            batchSources: new Set([item.fixture.source]) });
        const applied = mergeAnchors({ active: item.fixture.anchors }, checked.changes, { plan: item.request.anchors });
        const expected = EXPECT[name];
        const pass = expected === 'none' ? parsed.anchor_section === 'none'
            : checked.errors.length === 0 && checked.changes.length > 0
                && checked.changes.every(c => c.op === expected && (!item.fixture.target || c.id === item.fixture.target));
        report.probe.push({ name, expected, section: parsed.anchor_section, errors: checked.errors,
            ops: checked.changes.map(c => ({ op: c.op, id: c.id, sources: c.sources })), applied: applied.ok, pass });
        check('probe:' + name, pass, 'section=' + parsed.anchor_section + ' errors=' + JSON.stringify(checked.errors));
    }
}

// --- 2. every captured live response, replayed through the fixed parser ------------------------------
const dirs = [['run1', 'set1'], ['run2', 'set2'], ['raw', 'set1(stale runtime)'], ['raw2', 'set2(stale runtime)']];
for (const [runDir, label] of dirs) {
    for (const file of ['set1.summary-calls-all.json', 'set2.summary-calls-all.json']) {
        const calls = readJson(path.join(runDir, file));
        if (!Array.isArray(calls)) continue;
        for (const call of calls) {
            const prompt = requestText(call);
            const text = responseText(call);
            if (!prompt || !text) continue;
            const plan = planFromPrompt(prompt);
            const batchSources = new Set(sourcesFromPrompt(prompt));
            const parsed = parseAnchors(text);
            const checked = parseAnchorChanges(parsed.anchorLines, { plan, batchSources });
            const multi = checked.changes.filter(change => (change.sources || []).length > 1);
            const multiLines = [...String(text).matchAll(new RegExp(MULTI, 'g'))].length;
            const badMulti = checked.errors.filter(error => MULTI.test(error.line || '')
                && ['missing_source', 'bad_source'].includes(error.reason));
            const foreignMulti = checked.errors.filter(error => (error.line || '').includes('raw_')
                && error.reason === 'missing_source');
            report.calls.push({ run: runDir + '/' + file, label, at: call.at, section: parsed.anchor_section,
                lines: parsed.anchorLines.length, errors: checked.errors.map(e => e.reason),
                changes: checked.changes.length, multiSourceChanges: multi.length, multiLines });
            if (multi.length) report.findings.multiSourceRecovered = (report.findings.multiSourceRecovered || 0) + multi.length;
            if (multiLines && badMulti.length) report.findings.multiSourceStillRefused = (report.findings.multiSourceStillRefused || 0) + badMulti.length;
            if (foreignMulti.length) report.findings.foreignMultiRefused = (report.findings.foreignMultiRefused || 0) + foreignMulti.length;
        }
    }
}
const withMultiLines = report.calls.filter(row => row.multiLines > 0);
check('replay:multi-source-material-present', withMultiLines.length > 0,
    'captured responses containing a source list: ' + withMultiLines.length);
check('replay:multi-source-parses', (report.findings.multiSourceRecovered || 0) > 0,
    'multi-source changes recovered: ' + (report.findings.multiSourceRecovered || 0));
check('replay:no-multi-source-still-refused', !report.findings.multiSourceStillRefused,
    'still refused: ' + (report.findings.multiSourceStillRefused || 0));

// --- 3. a prose mention of 更新 is not hijacked -------------------------------------------------------
{
    const prose = parseAnchors('管家更新了账本。\n队伍更新了装备 | 来源不明\n本次没有变化，不需要更新 A1\n【知情边界】\n- 无');
    check('replay:prose-is-not-an-operation', prose.anchor_section === 'missing' && prose.anchorLines.length === 0,
        'section=' + prose.anchor_section + ' lines=' + prose.anchorLines.length);
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1));
const failed = report.targets.filter(row => !row.ok);
console.log('evidence       : ' + dir);
console.log('probe cases    : ' + report.probe.map(row => row.name + '=' + (row.pass ? 'PASS' : 'FAIL')).join(', '));
console.log('captured calls : ' + report.calls.length + ' (' + withMultiLines.length + ' with a source list)');
console.log('multi-source   : recovered ' + (report.findings.multiSourceRecovered || 0)
    + ', still refused ' + (report.findings.multiSourceStillRefused || 0));
console.log('report         : ' + outPath);
console.log(failed.length ? 'REPLAY FAILED: ' + failed.map(row => row.name).join(', ') : 'replay: ok');
if (failed.length) process.exit(1);
