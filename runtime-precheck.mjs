// Preflight for a live acceptance run: the repository, the deployed directory and the running page have to
// be the same code, and only the loaded module proves the last one.
//
// Why this exists: deploy-live.mjs --check compares the repo with the deployed DISK, and a page loaded
// before the deploy keeps serving the previous module. On the 421757c acceptance run that trap fired: every
// production .js on disk matched the repo, the disk check read clean, and the already-loaded
// parseAnchorChanges still contained the pre-421757c "bad_subject" check that the requested revision had
// removed. Reading the served file again would not have caught it either - the wrong copy was in memory.
// So this script answers both questions, compares the LOADED function sources with the deployed disk, and
// fails closed instead of letting a run start on the wrong code.
//
// Usage:
//   node runtime-precheck.mjs                 # repo vs disk vs loaded page (default CDP 127.0.0.1:9222)
//   node runtime-precheck.mjs --json
//   node runtime-precheck.mjs --cdp http://127.0.0.1:9222 --url-prefix /scripts/extensions/third-party/Memory-plugin/
// Exit: 0 all three agree; 1 the disk is stale or the loaded module differs; 2 the page or the live
// directory could not be reached, which is "unknown", never a pass.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The functions that carry the anchor protocol and the summary commit path. */
export const WATCH = {
    'raw-history.js': ['parseAnchors', 'parseAnchorChanges', 'mergeAnchors', 'looksLikeAnchorOperation',
        'summaryRequest', 'anchorRepairRequest', 'planAnchors', 'formatAnchorPrompt', 'stateRevisionOf'],
    'narrative-runtime.js': ['updateNarrative', 'readNarrativeReport', 'generateNarrativeSummary'],
};

/** A fast content hash. Exact equality of the function source is what matters, not collision resistance. */
export function fnv1a(value) {
    let hash = 0x811c9dc5;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** name -> hash, for a map of function source strings. */
export function fingerprint(functions) {
    const out = {};
    for (const name of Object.keys(functions || {}).sort()) out[name] = fnv1a(functions[name]);
    return out;
}

/** Every watched function whose hash differs, including one missing on either side. */
export function diffLoaded(disk, loaded) {
    const names = [...new Set([...Object.keys(disk || {}), ...Object.keys(loaded || {})])].sort();
    return names.filter(name => (disk || {})[name] !== (loaded || {})[name])
        .map(name => ({ name, disk: (disk || {})[name] ?? null, loaded: (loaded || {})[name] ?? null }));
}

function candidateDirs(override) {
    const home = os.homedir();
    return [override, process.env.AETHERIA_LIVE_DIR || '',
        path.join(home, 'scoop', 'persist', 'TauriTavern', 'data', 'extensions', 'third-party', 'Memory-plugin'),
        path.join(home, 'AppData', 'Roaming', 'TauriTavern', 'data', 'extensions', 'third-party', 'Memory-plugin'),
    ].filter(Boolean);
}

const sameContent = (a, b) => {
    try { return readFileSync(a, 'utf8').replace(/\r\n/g, '\n') === readFileSync(b, 'utf8').replace(/\r\n/g, '\n'); }
    catch { return false; }
};

/** Repo .js vs live .js, CRLF-normalised, exactly the disk half of deploy-live.mjs --check. */
export function diskDiff(repoDir, liveDir) {
    const files = readdirSync(repoDir).filter(name => name.endsWith('.js'));
    const changed = [];
    let identical = 0;
    for (const name of files) {
        if (!existsSync(path.join(liveDir, name))) { changed.push(name + ' (missing)'); continue; }
        if (sameContent(path.join(repoDir, name), path.join(liveDir, name))) identical += 1;
        else changed.push(name);
    }
    return { total: files.length, identical, changed };
}

/** The watched function sources as the deployed disk has them, imported in this Node process. */
export async function diskFingerprint(liveDir) {
    const out = {};
    for (const [mod, fns] of Object.entries(WATCH)) {
        const url = pathToFileURL(path.join(liveDir, mod)).href + '?precheck=' + Date.now() + Math.random();
        const imported = await import(url);
        for (const fn of fns) out[mod + '#' + fn] = imported[fn] ? fnv1a(String(imported[fn])) : null;
    }
    return out;
}

async function loadedFingerprint(cdp, urlPrefix) {
    const targets = await (await fetch(cdp + '/json/list')).json();
    const target = targets.find(row => row.type === 'page');
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    try {
        const expression = `(async () => {
            const watch = ${JSON.stringify(WATCH)};
            const out = {};
            for (const [mod, fns] of Object.entries(watch)) {
                const imported = await import(${JSON.stringify(urlPrefix)} + mod);
                for (const fn of fns) out[mod + '#' + fn] = imported[fn] ? String(imported[fn]) : null;
            }
            return JSON.stringify(out);
        })()`;
        const reply = await new Promise((resolve, reject) => {
            ws.addEventListener('message', event => resolve(JSON.parse(event.data)), { once: true });
            ws.addEventListener('error', reject, { once: true });
            ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
                params: { expression, awaitPromise: true, returnByValue: true, timeout: 60000 } }));
        });
        if (reply.error || reply.result?.exceptionDetails) throw new Error('host evaluation failed');
        const sources = JSON.parse(reply.result.result.value || '{}');
        return fingerprint(sources);
    } finally { ws.close(); }
}

async function main() {
    const args = process.argv.slice(2);
    const option = (name, fallback) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
    const json = args.includes('--json');
    const page = !args.includes('--no-page');
    const repoDir = path.dirname(fileURLToPath(import.meta.url));
    const liveDir = candidateDirs(option('--dir', '')).find(dir => existsSync(dir));
    const cdp = option('--cdp', 'http://127.0.0.1:9222');
    const prefix = option('--url-prefix', '/scripts/extensions/third-party/Memory-plugin/');
    const report = { repoDir, liveDir: liveDir || null, disk: null, loaded: null, stale: [], verdict: 'unknown' };
    if (!liveDir) report.reason = 'no live extension directory';
    else report.disk = diskDiff(repoDir, liveDir);
    if (page && liveDir) {
        try {
            const [disk, loaded] = [await diskFingerprint(liveDir), await loadedFingerprint(cdp, prefix)];
            report.stale = diffLoaded(disk, loaded);
        } catch (error) { report.reason = 'page or module import failed: ' + String(error?.message || error); }
    } else if (!page) report.reason = 'loaded-module check skipped (--no-page)';
    const diskClean = report.disk && !report.disk.changed.length;
    report.verdict = report.stale ? (report.stale.length ? 'stale' : (diskClean ? 'pass' : 'stale')) : 'unknown';
    if (json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('repo          : ' + report.repoDir);
        console.log('live directory: ' + (report.liveDir || '(not found)'));
        if (report.disk) console.log('disk check    : ' + report.disk.identical + '/' + report.disk.total
            + ' identical' + (report.disk.changed.length ? '; changed: ' + report.disk.changed.join(', ') : ''));
        console.log('loaded check  : ' + (report.stale ? (report.stale.length
            ? report.stale.map(row => row.name).join(', ') : 'matches the deployed disk')
            : 'UNKNOWN (' + report.reason + ')'));
        console.log('verdict       : ' + (report.verdict === 'pass' ? 'PASS - safe to start'
            : report.verdict === 'stale' ? 'FAIL - reload the host before any acceptance run (a served-file '
                + 're-read is not enough; the loaded module is the one that answers)'
            : 'UNKNOWN - ' + report.reason));
    }
    process.exit(report.verdict === 'pass' ? 0 : report.verdict === 'stale' ? 1 : 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
