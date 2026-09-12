// Syntax gate for every source file in the repository.
//
// This replaces a hand-maintained chain of sixty `node --check` calls in package.json. That chain had
// to be edited every time a module was added or removed, and it silently kept checking six files that
// no longer existed while missing the two newest ones - the failure mode of a list that nobody owns.
//
// Children are spawned with file-backed stdio, for the reason run-tests.mjs documents: capturing a
// child's output through a pipe needs a named pipe, and a confined environment refuses one.
import { openSync, closeSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
/** Checked in this order so the report reads like the runtime's own layering. */
const SOURCE_DIRS = ['.', 'source-adapters'];
/** Never checked: scratch checkouts and superseded documents, none of which ship. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'remove', 'archive', 'change_log', 'dev_docs', '.github']);

function collect() {
    const files = [];
    for (const dir of SOURCE_DIRS) {
        const absolute = path.join(DIR, dir);
        if (!statSync(absolute).isDirectory()) continue;
        for (const name of readdirSync(absolute)) {
            if (SKIP_DIRS.has(name)) continue;
            const relative = dir === '.' ? name : dir + '/' + name;
            const target = path.join(DIR, relative);
            if (!statSync(target).isFile()) continue;
            // Every source file, including the root tools (run-tests, recall-baseline, deploy-live,
            // chat-scan, fx-dump). The first version of this gate checked only .js plus test-*.mjs, so a
            // syntax error in a tool that the repository ships was invisible to it.
            if (name.endsWith('.js') || name.endsWith('.mjs')) files.push(relative);
        }
    }
    return files.sort();
}

function check(relative) {
    const stamp = process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const errPath = path.join(tmpdir(), 'aetheria-check-' + stamp + '.err');
    const errFd = openSync(errPath, 'w');
    return new Promise(resolve => {
        const child = spawn(process.execPath, ['--check', relative], { cwd: DIR, stdio: ['ignore', 'ignore', errFd] });
        child.on('error', error => resolve({ relative, ok: false, detail: String(error?.message || error) }));
        child.on('close', code => {
            closeSync(errFd);
            let detail = '';
            try { detail = readFileSync(errPath, 'utf8'); } catch { /* nothing captured */ }
            try { rmSync(errPath, { force: true }); } catch { /* best effort */ }
            resolve({ relative, ok: code === 0, detail: detail.trim() });
        });
    });
}

const files = collect();
const failed = [];
for (const relative of files) {
    const result = await check(relative);
    if (!result.ok) failed.push(result);
}
if (failed.length) {
    for (const row of failed) console.log('FAIL ' + row.relative + (row.detail ? '\n    ' + row.detail.split('\n').join('\n    ') : ''));
    console.log('\n' + failed.length + '/' + files.length + ' files failed the syntax gate');
    process.exit(1);
}
console.log('syntax ok: ' + files.length + ' files');
