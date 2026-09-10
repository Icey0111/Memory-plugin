// Aetheria Unified Memory v5.5 — offline test runner.
//
// Replaces a three-hundred-line `node a && node b && node c` chain, which reported only the first
// failure and made the suite impossible to filter or time.
//
// Children are spawned with file-backed stdio rather than pipes. That is not a style choice: capturing
// a child's output through a pipe requires a named pipe, which confined environments refuse, and a
// runner that cannot capture output cannot report a failure.

import { openSync, closeSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const filterIndex = args.indexOf('--filter');
const filter = filterIndex >= 0 ? String(args[filterIndex + 1] || '') : '';
const listOnly = args.includes('--list');
const verbose = args.includes('--verbose');

const files = readdirSync(DIR)
    .filter(name => /^test-.*\.mjs$/.test(name))
    .filter(name => !filter || name.includes(filter))
    .sort();

if (listOnly) {
    for (const name of files) console.log(name);
    console.log(files.length + ' test files');
    process.exit(0);
}

function runOne(name) {
    const stamp = process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const outPath = path.join(tmpdir(), 'aetheria-test-' + stamp + '.out');
    const errPath = path.join(tmpdir(), 'aetheria-test-' + stamp + '.err');
    const outFd = openSync(outPath, 'w');
    const errFd = openSync(errPath, 'w');
    return new Promise(resolve => {
        const started = Date.now();
        const child = spawn(process.execPath, [name], { cwd: DIR, stdio: ['ignore', outFd, errFd] });
        child.on('error', error => resolve({ name, ok: false, ms: Date.now() - started, stdout: '', stderr: String(error?.message || error) }));
        child.on('close', code => {
            closeSync(outFd);
            closeSync(errFd);
            let stdout = '';
            let stderr = '';
            try { stdout = readFileSync(outPath, 'utf8'); } catch { /* nothing captured */ }
            try { stderr = readFileSync(errPath, 'utf8'); } catch { /* nothing captured */ }
            try { rmSync(outPath, { force: true }); } catch { /* best effort */ }
            try { rmSync(errPath, { force: true }); } catch { /* best effort */ }
            resolve({ name, ok: code === 0, code, ms: Date.now() - started, stdout, stderr });
        });
    });
}

const results = [];
for (const name of files) {
    const result = await runOne(name);
    results.push(result);
    const mark = result.ok ? 'PASS' : 'FAIL';
    const summary = (result.stdout.match(/^PASS .*$/m) || [''])[0].replace(/\s+/g, ' ').trim();
    console.log(mark.padEnd(4) + String(result.ms + 'ms').padStart(7) + '  ' + name + (summary ? '  ' + summary.slice(0, 110) : ''));
    if (!result.ok) {
        const detail = (result.stderr || result.stdout).split(/\r?\n/).filter(Boolean).slice(-18).join('\n');
        console.log('    ' + detail.split('\n').join('\n    '));
    } else if (verbose && result.stdout.trim()) {
        for (const line of result.stdout.trim().split(/\r?\n/)) console.log('    ' + line);
    }
}

const failed = results.filter(row => !row.ok);
const totalMs = results.reduce((sum, row) => sum + row.ms, 0);
console.log('');
console.log((results.length - failed.length) + '/' + results.length + ' test files passed in ' + (totalMs / 1000).toFixed(1) + 's');
if (failed.length) {
    console.log('failed: ' + failed.map(row => row.name).join(', '));
    process.exit(1);
}