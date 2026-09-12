// Build the vector cache recall-baseline.mjs reads for its dense channel.
//
// The ruler measures retrieval, so the vectors it measures with have to be the vectors the plugin
// embeds with: same chunk text, same retrieval task, same model. This script does only that, and it is
// deliberately separate from the ruler because it needs the network and a key and the ruler does not.
//
// Usage:
//     node recall-embed.mjs <chat.jsonl> --questions <set.json> --out <cache.json>
//         [--model jina-embeddings-v5-text-small] [--base https://api.jina.ai/v1]
//         [--key-file <path>] [--batch 24] [--task auto|none] [--merge] [--force]
//
// The key comes from --key-file or EMBEDDINGS_API_KEY and is never printed or written. The cache is
// keyed by the hash the archive already computes, so a re-chunk does not invalidate it and a rerun tops
// it up instead of paying for the same vectors twice.

import fs from 'node:fs';
import { captureHistory, chunkHistory } from './raw-history.js';

const args = process.argv.slice(2);
const word = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at >= 0 ? String(args[at + 1]) : fallback;
};
const seen = new Set();
args.forEach((value, index) => {
    if (value.startsWith('--') && args[index + 1] && !args[index + 1].startsWith('--')) seen.add(index + 1);
});
const chatFile = args.filter((value, index) => !value.startsWith('--') && !seen.has(index))[0];
if (!chatFile) {
    console.log('Usage: node recall-embed.mjs <chat.jsonl> --questions <set.json> --out <cache.json>');
    process.exit(1);
}
const questionsFile = word('questions', null);
const outFile = word('out', 'remove/_embeddings.json');
const model = word('model', 'jina-embeddings-v5-text-small');
let base = word('base', 'https://api.jina.ai/v1');
while (base.endsWith('/')) base = base.slice(0, -1);
const batch = Math.max(1, Math.min(128, Number(word('batch', 24)) || 24));
const taskMode = word('task', 'auto') === 'none' ? 'none' : 'auto';
const keyFile = word('key-file', null);

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

// The plugin sends Jina its retrieval tasks and sends nothing to anyone else; this mirrors that exactly,
// because a measurement taken with different embeddings is not a measurement of this plugin.
function taskFor(role) {
    if (taskMode === 'none') return null;
    let host = '';
    try { host = new URL(base).hostname.toLowerCase(); } catch { host = ''; }
    const jina = host === 'api.jina.ai' || host.endsWith('.jina.ai') || /^jina-/i.test(model);
    if (!jina) return null;
    return role === 'query' ? 'retrieval.query' : 'retrieval.passage';
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

const raw = fs.readFileSync(chatFile, 'utf8').split(String.fromCharCode(10)).filter(line => line.trim());
const messages = [];
for (const line of raw.slice(1)) { try { messages.push(JSON.parse(line)); } catch { /* a torn last line */ } }
const scratch = {};
captureHistory(scratch, messages);
const chunks = chunkHistory(scratch.raw_history);
const questions = questionsFile && fs.existsSync(questionsFile)
    ? JSON.parse(fs.readFileSync(questionsFile, 'utf8')).map(row => String(row.question)).filter(Boolean)
    : [];

const cache = args.includes('--force') || !fs.existsSync(outFile)
    ? { vectors: {} }
    : JSON.parse(fs.readFileSync(outFile, 'utf8'));
cache.model = model;
cache.base = base;
cache.task = taskFor('passage');

const newChunks = chunks.filter(chunk => !cache.vectors['c:' + chunk.hash]);
const newQuestions = [...new Set(questions)].filter(question => !cache.vectors['q:' + question]);
console.log(chunks.length + ' chunks (' + newChunks.length + ' new), ' + questions.length
    + ' questions (' + newQuestions.length + ' new), model ' + model + ', task ' + (cache.task || 'none'));
if (newChunks.length) {
    const vectors = await embed(newChunks.map(chunk => chunk.retrievalText), 'document');
    newChunks.forEach((chunk, i) => { cache.vectors['c:' + chunk.hash] = vectors[i]; });
}
if (newQuestions.length) {
    const vectors = await embed(newQuestions, 'query');
    newQuestions.forEach((question, i) => { cache.vectors['q:' + question] = vectors[i]; });
}
fs.writeFileSync(outFile, JSON.stringify(cache));
console.log('wrote ' + outFile + ' with ' + Object.keys(cache.vectors).length + ' vectors');