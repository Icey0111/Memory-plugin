// Copy this extension into the directory the host actually loads it from.
//
// Why this exists: the repository and the loaded extension are two different directories. On this machine
// the TauriTavern host serves /scripts/extensions/third-party/Memory-plugin/ from
//     %USERPROFILE%\scoop\persist\TauriTavern\data\extensions\third-party\Memory-plugin
// and a full page reload reloads that copy, not the working tree. Editing the working tree and reloading
// therefore verifies nothing, and the failure is silent: the probes keep reporting the OLD behaviour and it
// looks like the fix did not work. Discovering this cost a session, so it is scripted now.
//
// A second trap, also scripted around: several deployed files differ from the repository only by line
// endings (CRLF vs LF). A hash comparison therefore reports them as changed when the content is identical,
// which reads as "the deployment is stale" when it is not. Compare with --check, which normalises.
//
// Usage:
//     node deploy-live.mjs             # compare only, never writes (default)
//     node deploy-live.mjs --apply     # copy the changed files into the live directory
//     node deploy-live.mjs --dir <p>   # override the live directory
//
// Writing to the live directory is outside the project workspace, so --apply may need the sandbox
// escalation its host requires. --check never does.

import { readFileSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dirFlag = args.indexOf('--dir');
const override = dirFlag >= 0 ? args[dirFlag + 1] : '';

/** Where the host looks for this extension, newest guess first. First existing path wins. */
function candidateDirs() {
    const home = os.homedir();
    return [
        override,
        process.env.AETHERIA_LIVE_DIR || '',
        path.join(home, 'scoop', 'persist', 'TauriTavern', 'data', 'extensions', 'third-party', 'Memory-plugin'),
        path.join(home, 'AppData', 'Roaming', 'TauriTavern', 'data', 'extensions', 'third-party', 'Memory-plugin'),
    ].filter(Boolean);
}

/**
 * Everything the host may load. Tests and docs are copied too so the deployed tree matches the repo.
 * `html` is in the list because `manifest.json` declares the settings page and the host fetches it
 * from the same directory; leaving it out silently deployed a settings UI that did not match the repo.
 */
function payload() {
    return readdirSync(HERE).filter(name => /^(.*\.(js|mjs|json|md|html))$/.test(name) && !name.startsWith('.'));
}

/** Compare ignoring line endings, which is how the deployed tree differs without differing. */
function sameContent(a, b) {
    try {
        return readFileSync(a, 'utf8').replace(/\r\n/g, '\n') === readFileSync(b, 'utf8').replace(/\r\n/g, '\n');
    } catch {
        return false;
    }
}

const live = candidateDirs().find(dir => existsSync(dir));
if (!live) {
    console.error('No live extension directory found. Pass --dir <path>. Tried:');
    for (const dir of candidateDirs()) console.error('  ' + dir);
    process.exit(2);
}

const changed = [];
const missing = [];
let identical = 0;
for (const name of payload()) {
    const from = path.join(HERE, name);
    const to = path.join(live, name);
    if (!existsSync(to)) { missing.push(name); continue; }
    if (sameContent(from, to)) identical += 1;
    else changed.push(name);
}

console.log('live directory : ' + live);
console.log('repo files     : ' + payload().length);
console.log('identical      : ' + identical);
console.log('changed        : ' + changed.length + (changed.length ? '  ' + changed.join(', ') : ''));
console.log('missing live   : ' + missing.length + (missing.length ? '  ' + missing.join(', ') : ''));

if (!apply) {
    if (changed.length || missing.length) {
        console.log('');
        console.log('Re-run with --apply to copy them. Until then a reload verifies the OLD code.');
    }
    process.exit(0);
}

const toCopy = [...changed, ...missing];
for (const name of toCopy) copyFileSync(path.join(HERE, name), path.join(live, name));
console.log('');
console.log('copied ' + toCopy.length + ' file(s). Reload the host before measuring.');
