// The ruler for two questions the architecture keeps asking, measured on real chats.
//
//   1. What does the original-text archive cost inside the chat file, and what does the retired fact
//      set still cost there?
//   2. If the model asks about something that happened in a floor the summary already folded, does
//      lexical-only retrieval put the exact original span back in front of it - and at what price?
//
// It is a ruler, not a gate: it needs real chats, so it cannot run in CI. Run it before changing a
// budget, a chunk size or a ranking rule, and put the numbers in the change log.
//
// Usage:
//     node recall-baseline.mjs                       # newest 5 chats under the default host path
//     node recall-baseline.mjs <dir-or-file> [...]    # explicit chat files or directories
//     node recall-baseline.mjs --limit 8 --probes 80
//
// Reading is all it does. Nothing is written, and the plugin is never loaded.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence } from './raw-history.js';
import { DERIVED_KEYS } from './v55-derived-store.js';
import { estimateTokens } from './v55-tokenizer.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at >= 0 ? Number(args[at + 1]) : fallback;
};
const targets = args.filter((value, index) => !value.startsWith('--') && !(index > 0 && args[index - 1] === '--limit') && !(index > 0 && args[index - 1] === '--probes'));
const limit = flag('limit', 5);
const probeBudget = flag('probes', 60);

function defaultRoot() {
    const home = os.homedir();
    return [
        path.join(home, 'scoop', 'persist', 'TauriTavern', 'data', 'default-user', 'chats'),
        path.join(home, 'AppData', 'Roaming', 'TauriTavern', 'data', 'default-user', 'chats'),
    ].find(candidate => fs.existsSync(candidate)) || null;
}

function collect(target, out = []) {
    if (!fs.existsSync(target)) return out;
    const stat = fs.statSync(target);
    if (stat.isFile()) { if (target.endsWith('.jsonl')) out.push({ file: target, size: stat.size }); return out; }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) collect(path.join(target, entry.name), out);
    return out;
}

function load(file) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim());
    const header = JSON.parse(lines[0]);
    const messages = lines.slice(1).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    return { header, messages };
}

const kb = value => Math.round(value / 1024);
const bytes = value => Buffer.byteLength(JSON.stringify(value ?? null));

/** Literal needles a question could plausibly ask for: a quantity, or a rare four-character phrase. */
function needleCounts(messages) {
    const counts = new Map();
    const bump = value => counts.set(value, (counts.get(value) || 0) + 1);
    for (const row of messages) {
        const text = String(row.mes ?? '');
        for (const match of text.matchAll(/([0-9]{1,4}(?:\.[0-9]+)?\s*(?:楼|层|号|点|米|年|月|日|时|分|秒|公里|元|个|次|天|周|%|％|度|枚|把|瓶|封))/g)) bump(match[1].trim());
        for (const match of text.matchAll(/[\u4e00-\u9fa5]{4}/g)) bump(match[0]);
    }
    return counts;
}

function probesFor(messages, budget) {
    const counts = needleCounts(messages);
    const assistants = messages.filter(row => row.is_user !== true && String(row.mes ?? '').trim());
    const covered = assistants.slice(0, Math.max(1, Math.floor(assistants.length * 0.6)));
    const probes = [];
    for (const row of covered) {
        const text = String(row.mes);
        const found = [];
        for (const match of text.matchAll(/([0-9]{1,4}(?:\.[0-9]+)?\s*(?:楼|层|号|点|米|年|月|日|时|分|秒|公里|元|个|次|天|周|%|％|度|枚|把|瓶|封))/g)) found.push(match[1].trim());
        for (const match of text.matchAll(/[\u4e00-\u9fa5]{4}/g)) found.push(match[0]);
        for (const needle of found) {
            if (counts.get(needle) !== 1) continue;   // a needle that occurs twice proves nothing
            const sentence = text.split(/(?<=[。！？!?\n])/).map(part => part.trim()).find(part => part.includes(needle)) || text.slice(0, 80);
            probes.push({ needle, query: (sentence.split(needle).join(' ') + ' 这件事你记得吗').slice(0, 300) });
            break;
        }
        if (probes.length >= budget) break;
    }
    return probes;
}

function measure(chat) {
    const { header, messages } = load(chat.file);
    const metadata = header.chat_metadata || {};
    const store = metadata[KEY] || null;
    const transcriptChars = messages.reduce((sum, row) => sum + String(row.mes ?? '').length, 0);

    // What the archive adds.
    const scratch = {};
    captureHistory(scratch, messages);
    const archiveBytes = bytes(scratch.raw_history);
    const history = scratch.raw_history;
    const chunks = chunkHistory(history);

    // What the retired fact set still costs in the chat file, and what relocating it saves.
    let movedBytes = 0;
    if (store) for (const key of ['memories', 'slots', 'hierarchical_summaries']) {
        if (Object.prototype.hasOwnProperty.call(store, key)) movedBytes += bytes(store[key]);
    }
    const storeBytes = store ? bytes(store) : 0;

    // Recall over the floors a summary would have folded.
    const assistants = messages.filter(row => row.is_user !== true && String(row.mes ?? '').trim());
    const probes = probesFor(messages, probeBudget);
    let found = 0;
    let candidateHit = 0;
    let tokens = 0;
    const ranks = [];
    for (const probe of probes) {
        const ranked = rankRawChunks(chunks, probe.query);
        const packed = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: new Set() });
        if (packed.text.includes(probe.needle)) found += 1;
        const rank = ranked.findIndex(entry => entry.chunk.text.includes(probe.needle));
        if (rank >= 0) { candidateHit += 1; ranks.push(rank); }
        tokens += packed.tokens;
    }
    ranks.sort((a, b) => a - b);
    return {
        file: path.basename(chat.file), fileKb: kb(chat.size), messages: messages.length, floors: assistants.length,
        transcriptKb: kb(transcriptChars * 3), storeKb: kb(storeBytes), derivedMovedKb: kb(movedBytes),
        archiveKb: kb(archiveBytes), chunks: chunks.length, probes: probes.length,
        recall: probes.length ? found / probes.length : null,
        candidateHit: probes.length ? candidateHit / probes.length : null,
        medianRank: ranks.length ? ranks[Math.floor(ranks.length / 2)] : null,
        meanTokens: probes.length ? Math.round(tokens / probes.length) : null,
    };
}

const root = targets.length ? targets : [defaultRoot()].filter(Boolean);
if (!root.length) {
    console.log('No chats found. Pass a chat file or directory: node recall-baseline.mjs <dir>');
    process.exit(1);
}
const chats = root.flatMap(target => collect(target)).sort((a, b) => b.size - a.size).slice(0, limit);
if (!chats.length) {
    console.log('No .jsonl chats under: ' + root.join(', '));
    process.exit(1);
}

const pct = value => value === null ? '  n/a' : (value * 100).toFixed(0).padStart(4) + '%';
console.log('chat'.padEnd(40) + 'fileKB  msgs  floors  storeKB  moved  archive  chunks  probes  recall  cand  rank   tok');
const rows = [];
for (const chat of chats) {
    try {
        const row = measure(chat);
        rows.push(row);
        console.log(row.file.padEnd(40) + String(row.fileKb).padStart(6) + String(row.messages).padStart(6) + String(row.floors).padStart(8)
            + String(row.storeKb).padStart(9) + String(row.derivedMovedKb).padStart(7) + String(row.archiveKb).padStart(8)
            + String(row.chunks).padStart(8) + String(row.probes).padStart(8) + pct(row.recall).padStart(8)
            + pct(row.candidateHit).padStart(6) + String(row.medianRank ?? 'n/a').padStart(6) + String(row.meanTokens ?? 'n/a').padStart(6));
    } catch (error) {
        console.log(path.basename(chat.file).padEnd(40) + 'ERROR ' + String(error.message).slice(0, 60));
    }
}
const median = values => {
    const sorted = values.filter(value => value !== null).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
if (rows.length) {
    console.log('');
    console.log('median file ' + median(rows.map(r => r.fileKb)) + 'KB | transcript text '
        + median(rows.map(r => r.transcriptKb)) + 'KB | archive ' + median(rows.map(r => r.archiveKb))
        + 'KB | retired fact set in the chat file ' + median(rows.map(r => r.storeKb)) + 'KB of which '
        + median(rows.map(r => r.derivedMovedKb)) + 'KB moved out by this version');
    console.log('median recall ' + pct(median(rows.map(r => r.recall))) + ' | candidate hit '
        + pct(median(rows.map(r => r.candidateHit))) + ' | median rank ' + median(rows.map(r => r.medianRank))
        + ' | evidence ' + median(rows.map(r => r.meanTokens)) + ' tokens/query');
    console.log('Derived keys now owned by the external record: ' + DERIVED_KEYS.filter(k => ['memories', 'slots', 'hierarchical_summaries'].includes(k)).join(', '));
}
