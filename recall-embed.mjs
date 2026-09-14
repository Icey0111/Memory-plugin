// Build the vector cassette recall-baseline.mjs replays for its dense channel.
//
// The ruler measures retrieval, so the vectors it measures with have to be the vectors the plugin
// embeds with: same input text, same retrieval task, same model. This script does only that, and it is
// deliberately separate from the ruler because it needs the network and a key and the ruler does not.
//
// It writes a cassette, not a cache. Every entry is keyed by the request that produced it - model, base,
// role, provider task and the exact input text - so a rerun re-embeds only what actually changed, and a
// run that cannot find an entry is told so instead of silently measuring with fewer vectors. A legacy
// cache (entries keyed c:<hash> / q:<question>) cannot be reused: those keys do not name the request,
// so re-keying them would assert provenance that was never recorded.
//
// Usage:
//     node recall-embed.mjs --requests <requests.json> --out <cassette.json>
//         [--model ...] [--base https://api.jina.ai/v1] [--key-file <path>] [--batch 24] [--force]
//     node recall-embed.mjs <chat.jsonl> --questions <set.json> --out <cassette.json> [same options]
//
// The first form embeds exactly the inputs a ruler run declared with --cassette-requests, which is the
// direct way to make that run reproducible. The second is for building a cassette by hand.
//
// The key comes from --key-file or EMBEDDINGS_API_KEY and is never printed or written.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureHistory, chunkHistory } from './raw-history.js';
import { createCassette, recordVector, writeCassette, readCassette, embeddingTaskFor,
    cassetteEntryKey, CASSETTE_FORMAT, CASSETTE_REQUESTS_FORMAT } from './embedding-cassette.mjs';

const args = process.argv.slice(2);
/** Flags that consume the next argument. A boolean flag followed by a path must not eat the path. */
const VALUE_FLAGS = new Set(['--questions', '--out', '--model', '--base', '--key-file', '--batch', '--task', '--requests']);
const valueIndexes = new Set();
args.forEach((value, index) => { if (VALUE_FLAGS.has(value)) valueIndexes.add(index + 1); });
const positional = args.filter((value, index) => !value.startsWith('--') && !valueIndexes.has(index));
const word = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at >= 0 && args[at + 1] !== undefined ? String(args[at + 1]) : fallback;
};
const cleanBase = value => String(value || '').replace(/\/+$/, '');
const force = args.includes('--force');
const chatFile = positional[0] || null;
const requestsFile = word('requests', null);

if (!chatFile && !requestsFile) {
    console.log('Usage: node recall-embed.mjs --requests <requests.json> --out <cassette.json>');
    console.log('       node recall-embed.mjs <chat.jsonl> --questions <set.json> --out <cassette.json>');
    process.exit(1);
}
if (chatFile && requestsFile) {
    console.log('Pass either --requests or a chat file, not both: the two describe different input sets.');
    process.exit(1);
}

// A cassette is a recording of a dated, paid provider response, so the default keeps it outside the
// repository: it is evidence, not source.
const outFile = word('out', path.join(os.tmpdir(), 'aetheria-embeddings-cassette.json'));
const questionsFile = word('questions', null);
if (chatFile && !questionsFile) console.log('note: no --questions, so only the chunk vectors will be embedded');
let model = word('model', null);
let base = word('base', null);
const batch = Math.max(1, Math.min(128, Number(word('batch', 24)) || 24));
if (args.includes('--task')) {
    // There is deliberately no task switch. The provider task is part of the request the plugin sends,
    // so it is part of what an entry's key names; a switch would let the recording claim a task that the
    // request did not carry, and the ruler would replay it as if it had.
    console.log('--task is not a switch here: the recording is keyed by the task the plugin derives from the model and base.');
    process.exit(1);
}
const keyFile = word('key-file', null);
let declared = null;

if (requestsFile) {
    if (!fs.existsSync(requestsFile)) { console.log('No requests file at ' + requestsFile); process.exit(1); }
    declared = JSON.parse(fs.readFileSync(requestsFile, 'utf8'));
    if (declared.format && declared.format !== CASSETTE_REQUESTS_FORMAT) {
        console.log('Requests file ' + requestsFile + ' is ' + declared.format + ', not ' + CASSETTE_REQUESTS_FORMAT + '.');
        process.exit(1);
    }
    if (!Array.isArray(declared.requests) || !declared.requests.length) {
        console.log('Requests file ' + requestsFile + ' carries no requests.');
        process.exit(1);
    }
    // The declared model and base are what the requesting run used to name its inputs. An override is
    // allowed only when it agrees, because a different model would produce keys that run cannot resolve.
    for (const [name, given, from] of [['model', model, declared.model], ['base', base, declared.base]]) {
        if (given && from && String(given).replace(/\/+$/, '') !== String(from).replace(/\/+$/, '')) {
            console.log('--' + name + ' ' + given + ' disagrees with the requests file (' + from + '); the run that wrote it would not resolve these keys.');
            process.exit(1);
        }
    }
    if (!declared.model || !declared.base) {
        console.log('Requests file ' + requestsFile + ' does not name the model and base it was written for, so its keys cannot be reproduced.');
        process.exit(1);
    }
    model = model || declared.model;
    base = base || declared.base;
} else if (!model) {
    model = 'jina-embeddings-v5-text-small';
}
if (!base) base = 'https://api.jina.ai/v1';
base = cleanBase(base);

function readKey() {
    if (keyFile && fs.existsSync(keyFile)) {
        const raw = fs.readFileSync(keyFile, 'utf8');
        // A secrets file holds several providers' keys, and the first match wins, so the provider's own
        // prefix is tried first: matching a generic sk- key here sent the Jina endpoint another service's
        // credential and came back 401.
        const jina = raw.match(/jina_[A-Za-z0-9]{40,}/);
        if (jina) return jina[0];
        const generic = raw.match(/sk-[A-Za-z0-9_\-]{16,}/);
        if (generic) return generic[0];
    }
    return process.env.EMBEDDINGS_API_KEY || '';
}
const key = readKey();
if (!key) {
    console.log('No key. Pass --key-file <path> or set EMBEDDINGS_API_KEY.');
    process.exit(1);
}

/**
 * The provider task for one role comes from the cassette module, which reads it from the plugin's own
 * request builder. The key of an entry is computed from that same decision, so the recording and the
 * request cannot describe different bodies.
 */
function taskFor(role) {
    return embeddingTaskFor({ model, base, role });
}

async function embed(texts, role) {
    const out = [];
    for (let i = 0; i < texts.length; i += batch) {
        const slice = texts.slice(i, i + batch);
        const body = { model, input: slice };
        const task = taskFor(role);
        if (task) body.task = task;
        const response = await fetch(base + '/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + (await response.text()).slice(0, 300));
        const json = await response.json();
        if (!Array.isArray(json.data) || json.data.length !== slice.length) {
            throw new Error('the provider returned ' + (json.data ? json.data.length : 0) + ' vectors for ' + slice.length + ' inputs');
        }
        for (const row of json.data) out.push(row.embedding.map(value => Math.round(value * 1e5) / 1e5));
    }
    return out;
}

/** What this run will embed, as {role, text} pairs, from the declared set or from a chat plus questions. */
function wantedInputs() {
    if (declared) {
        const seen = new Set();
        return declared.requests.map(row => ({ role: row.role === 'query' ? 'query' : 'document',
            text: String(row.text) })).filter(row => {
            const identity = row.role + '\u0000' + row.text;
            if (seen.has(identity)) return false;
            seen.add(identity);
            return true;
        });
    }
    const raw = fs.readFileSync(chatFile, 'utf8').split('\n').filter(line => line.trim());
    const messages = [];
    for (const line of raw.slice(1)) { try { messages.push(JSON.parse(line)); } catch { /* a torn last line */ } }
    const scratch = {};
    captureHistory(scratch, messages);
    const chunks = chunkHistory(scratch.raw_history);
    const questions = questionsFile && fs.existsSync(questionsFile)
        ? JSON.parse(fs.readFileSync(questionsFile, 'utf8')).map(row => String(row.question)).filter(Boolean)
        : [];
    const out = chunks.map(chunk => ({ role: 'document', text: chunk.retrievalText }));
    for (const question of [...new Set(questions)]) out.push({ role: 'query', text: question });
    return out;
}

const inputs = wantedInputs();
if (!inputs.length) { console.log('Nothing to embed.'); process.exit(1); }

// A legacy file cannot contribute: its keys do not name the request. Say so once, with the count, so the
// cost of re-embedding everything is visible before it is paid.
let cassette = null;
if (!force && fs.existsSync(outFile)) {
    let previous = null;
    try { previous = readCassette(outFile); } catch (error) {
        console.log('Ignoring unreadable cassette ' + outFile + ': ' + String(error?.message || error));
    }
    if (previous?.legacy) {
        console.log('Found a legacy cache at ' + outFile + ' with ' + Object.keys(previous.vectors).length
            + ' entries. Its keys do not name the request, so none of them can be reused and every input below is re-embedded.');
    } else if (previous) {
        cassette = { format: CASSETTE_FORMAT, manifest: previous.manifest, vectors: previous.vectors };
        if (previous.manifest.model !== model || cleanBase(previous.manifest.base) !== base) {
            console.log('Cassette was recorded with model ' + previous.manifest.model + ' at ' + previous.manifest.base
                + '; this run uses ' + model + ' at ' + base + '. Entries are keyed per request, so the file ends up holding both sets.');
        }
    }
}
if (!cassette) cassette = createCassette({ model, base });

// Keying before embedding is what makes a rerun cheap, and what makes a changed input impossible to
// miss: the key names the request, so re-embedding is exactly the set whose request changed.
const keyOf = row => cassetteEntryKey({ model, base, role: row.role, text: row.text });
const missing = inputs.filter(row => !Object.prototype.hasOwnProperty.call(cassette.vectors, keyOf(row)));

console.log(inputs.length + ' inputs (' + missing.length + ' new), model ' + model + ', base ' + base
    + ', task ' + (taskFor('document') || 'none') + '/' + (taskFor('query') || 'none'));

for (const role of ['document', 'query']) {
    const rows = missing.filter(row => row.role === role);
    if (!rows.length) continue;
    const vectors = await embed(rows.map(row => row.text), role);
    rows.forEach((row, index) => recordVector(cassette, { model, base, role, text: row.text }, vectors[index]));
}

const written = writeCassette(outFile, cassette);
console.log('wrote ' + written.file + ' with ' + written.entries + ' vectors, fingerprint ' + written.fingerprint
    + ', dim ' + cassette.manifest.dim + ', task ' + JSON.stringify(cassette.manifest.task));
