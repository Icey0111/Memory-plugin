// List every chat this host owns, with its memory store, so "we need a longer corpus" can be checked
// instead of asserted.
//
// Why this exists: three plan revisions in a row deferred a question with "this needs a corpus where the
// state cap binds", while a 51-assistant-floor chat with 197 slot-bearing memories was already sitting in
// the host's chat directory. Scanning takes under a second, needs no browser, and reads the store straight
// out of each chat file, so it should always be cheaper than the sentence it replaces.
//
// Usage:
//     node chat-scan.mjs                  # every chat, largest store first
//     node chat-scan.mjs --min-active 100 # only chats whose active-memory count clears a floor
//     node chat-scan.mjs --dir <path>     # override the chat directory

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const override = dirFlag >= 0 ? args[dirFlag + 1] : '';
const minFlag = args.indexOf('--min-active');
const minActive = minFlag >= 0 ? Number(args[minFlag + 1]) || 0 : 0;

function candidateRoots() {
    const home = os.homedir();
    return [
        override,
        process.env.AETHERIA_CHATS_DIR || '',
        path.join(home, 'scoop', 'persist', 'TauriTavern', 'data', 'default-user', 'chats'),
        path.join(home, 'AppData', 'Roaming', 'TauriTavern', 'data', 'default-user', 'chats'),
    ].filter(Boolean);
}

const root = candidateRoots().find(dir => existsSync(dir));
if (!root) {
    console.error('No chat directory found. Pass --dir <path>. Tried:');
    for (const dir of candidateRoots()) console.error('  ' + dir);
    process.exit(2);
}

const files = [];
for (const entry of readdirSync(root)) {
    const dir = path.join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) if (name.endsWith('.jsonl')) files.push(path.join(dir, name));
}

/**
 * The store is serialised COLUMNAR on disk (`v55-store-compact.js`): `memories` is
 * `{__columns, keys, fields, rows}`, not a map of records. Reading it as a map yields the four
 * structural keys and a memory count of 4 - which is exactly what this script did before it was
 * checked against a chat whose live store was known to hold 224. Both shapes are handled here so a
 * chat written by an older build still scans.
 */
function expandMemories(raw) {
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw.rows) && Array.isArray(raw.fields) && Array.isArray(raw.keys)) {
        const index = Object.fromEntries(raw.fields.map((name, i) => [name, i]));
        return raw.rows.map((row, i) => {
            const record = { id: raw.keys[i] };
            for (const [name, at] of Object.entries(index)) record[name] = row[at];
            return record;
        });
    }
    return Object.values(raw).filter(value => value && typeof value === 'object');
}

const rows = [];
for (const file of files) {
    let meta = null;
    let messages = 0;
    let assistant = 0;
    let folded = 0;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj && obj.chat_metadata) { meta = obj.chat_metadata; continue; }
        if (obj && (obj.mes !== undefined || obj.is_user !== undefined)) {
            messages += 1;
            if (obj.is_user !== true) assistant += 1;
            if (obj.is_system === true) folded += 1;
        }
    }
    const store = meta?.aetheriaUnifiedMemoryV54 || meta?.aetheriaUnifiedMemoryV53 || null;
    const memories = expandMemories(store?.memories);
    const active = memories.filter(m => m.status === 'active' && m.text);
    rows.push({
        file: path.basename(file),
        kb: Math.round(statSync(file).size / 1024),
        rows: messages,
        assistant,
        folded,
        memories: memories.length,
        active: active.length,
        slot: active.filter(m => m.slot).length,
        storeKey: store ? (meta.aetheriaUnifiedMemoryV54 ? 'v54' : 'v53') : '-',
    });
}

const kept = rows.filter(r => r.active >= minActive).sort((a, b) => b.slot - a.slot || b.active - a.active);
const head = ['chat', 'kb', 'rows', 'asst', 'fold', 'store', 'mem', 'active', 'slot'];
const width = [43, 5, 5, 5, 5, 5, 5, 6, 5];
console.log(head.map((h, i) => h.padEnd(width[i])).join(' '));
for (const r of kept.slice(0, 30)) {
    console.log([
        r.file.slice(0, 43).padEnd(43), String(r.kb).padStart(5), String(r.rows).padStart(5),
        String(r.assistant).padStart(5), String(r.folded).padStart(5), r.storeKey.padStart(5),
        String(r.memories).padStart(5), String(r.active).padStart(6), String(r.slot).padStart(5),
    ].join(' '));
}
console.log(kept.length + ' of ' + rows.length + ' chats' + (minActive ? ' with active >= ' + minActive : ''));
console.log('slot-bearing memories need roughly 139 characters each to render; the default state cap is 12000.');
