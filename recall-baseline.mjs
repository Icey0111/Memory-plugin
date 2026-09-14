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
//     node recall-baseline.mjs --scorer bm25 --pack submodular --paraphrases <file>
//     node recall-baseline.mjs --span-cost --paraphrases <file>
//     node recall-baseline.mjs <chat> --embeddings <cassette.json> --paraphrases <file>
//     node recall-baseline.mjs <chat> --cassette-requests req.json --model <m> --base <u>   # declare inputs
//     node recall-baseline.mjs <chat> --embeddings <legacy.json> --adopt-legacy             # unverified
//
// The --scorer and --pack switches exist so a retrieval change can be attributed to the rule that
// changed rather than to the version that shipped it: idf and greedy reproduce the old behaviour.
// --span-cost is the same kind of switch for the evidence budget: it charges a span its own cost
// instead of the fair share, which keeps the tail of an anchor that slightly overruns its share and
// reaches fewer messages when anchors routinely overrun it. Off is what ships (raw-history.js).
//
// The dense channel is replayed from a cassette recorded by recall-embed.mjs, never fetched here, and a
// vector the cassette cannot supply is fatal: the run refuses to print a table rather than print a
// lexical result under a dense header. --cassette-requests writes the inputs this run would need, which
// is how the builder is told what to embed.
//
// It reads and measures. The only file it writes is the one named by --dump or --cassette-requests, and
// no plugin code runs: the one module it shares with the plugin is the request builder the cassette key
// is derived from.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence, evidenceSlots,
    DENSE_FUSION_WEIGHT } from './raw-history.js';
import { readCassette, cassetteIndex, describeCassette, CASSETTE_REQUESTS_FORMAT } from './embedding-cassette.mjs';
import { DERIVED_KEYS } from './v55-derived-store.js';
import { estimateTokens } from './v55-tokenizer.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at >= 0 ? Number(args[at + 1]) : fallback;
};
const word = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at >= 0 ? String(args[at + 1]) : fallback;
};
/** Positional arguments are chat paths; everything else is a flag or a flag's value. */
const flagValues = new Set();
args.forEach((value, index) => {
    if (['--limit', '--probes', '--paraphrases', '--scorer', '--pack', '--dump', '--against',
        '--evidence', '--entries', '--embeddings', '--dense-weight', '--embed-top',
        '--cassette-requests', '--model', '--base'].includes(value)) {
        flagValues.add(index + 1);
    }
});
const targets = args.filter((value, index) => !value.startsWith('--') && !flagValues.has(index));
const limit = flag('limit', 5);
const probeBudget = flag('probes', 60);
const paraphraseFile = word('paraphrases', null);
const dumpFile = word('dump', null);
const againstFile = word('against', null);
const SCORER = word('scorer', 'bm25') === 'idf' ? 'idf' : 'bm25';
const PACK = word('pack', 'greedy');
const POLICY = ['submodular', 'relevance'].includes(PACK) ? PACK : 'greedy';
const SPAN_COST = args.includes('--span-cost');
const EVIDENCE_TOKENS = flag('evidence', 1000);
// Zero means the slot count the budget pays for, which is what the plugin uses when nobody overrides it.
const EVIDENCE_ENTRIES = flag('entries', 0) || evidenceSlots(EVIDENCE_TOKENS);
// Zero is passed through so the library default - the slot count the budget pays for - is what gets tested.
const SLOTS = flag('entries', 0) || undefined;
const DENSE_WEIGHT = flag('dense-weight', DENSE_FUSION_WEIGHT);
const EMBED_TOP = flag('embed-top', 24);
const embeddingFile = word('embeddings', null);
const requestsFile = word('cassette-requests', null);
const ADOPT_LEGACY = args.includes('--adopt-legacy');
const MODEL = word('model', null);
const BASE = word('base', null);

// A requested cassette that is absent is not "dense off". Silently dropping to lexical under a dense
// header is the failure this whole switch exists to prevent, so a missing or unreadable file is fatal.
let CASSETTE = null;
if (embeddingFile) {
    if (!fs.existsSync(embeddingFile)) {
        console.log('No cassette at ' + embeddingFile + '. Build one with recall-embed.mjs, or drop --embeddings to measure lexical only.');
        process.exit(1);
    }
    try { CASSETTE = readCassette(embeddingFile); } catch (error) {
        console.log('Unreadable cassette ' + embeddingFile + ': ' + String(error?.message || error));
        process.exit(1);
    }
    for (const [name, given, recorded] of [['model', MODEL, CASSETTE.manifest.model], ['base', BASE, CASSETTE.manifest.base]]) {
        if (given && recorded && String(given).replace(/\/+$/, '') !== String(recorded).replace(/\/+$/, '')) {
            console.log('--' + name + ' ' + given + ' does not match the cassette, which was recorded for ' + recorded
                + '. The entries are keyed per request, so this would just find nothing.');
            process.exit(1);
        }
    }
}
// Weight 0 means the dense channel contributes nothing, so there is nothing to replay and nothing to miss.
const DENSE = CASSETTE && DENSE_WEIGHT > 0 ? cassetteIndex(CASSETTE, { adoptLegacy: ADOPT_LEGACY }) : null;

/**
 * The dense channel for one query, read from a vector cache built by recall-embed.mjs.
 *
 * The cache holds one vector per chunk under c:<hash> and one per question under q:<question>, and the
 * chunks are matched back by the hash the archive already computes - the same key the plugin's vector
 * store returns. Without a cache the ruler is lexical only, which is what it was before.
 */
function denseFor(chunks, question) {
    if (!DENSE) return [];
    const query = DENSE.lookup({ role: 'query', text: question, legacyKey: 'q:' + question });
    if (!query) return [];
    const dot = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; };
    const norm = value => Math.sqrt(dot(value, value)) || 1;
    const queryNorm = norm(query);
    return chunks.map(chunk => {
        // The document key names the text that was embedded, which is retrievalText and not the raw chunk.
        const vector = DENSE.lookup({ role: 'document', text: chunk.retrievalText, legacyKey: 'c:' + chunk.hash });
        return vector ? { hash: chunk.hash, score: dot(query, vector) / (queryNorm * norm(vector)) } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, EMBED_TOP);
}

/**
 * Every vector this run would read, named before it reads one.
 *
 * Declaring the inputs up front is what turns a cassette from a cache into a proof: the run can be told
 * that it cannot replay its own vectors before it prints a number, and the same list is what
 * --cassette-requests writes for recall-embed.mjs to fill.
 */
function collectRequests(targets) {
    const requests = [];
    const seen = new Set();
    const push = (role, text, legacyKey) => {
        const identity = role + '\u0000' + text;
        if (seen.has(identity)) return;
        seen.add(identity);
        requests.push({ role, text, legacyKey });
    };
    for (const target of targets) {
        for (const question of target.questions) push('query', question, 'q:' + question);
        for (const chunk of target.chunks) push('document', chunk.retrievalText, 'c:' + chunk.hash);
    }
    return requests;
}

/**
 * Refuse to measure when the cassette cannot answer for an input.
 *
 * The alternative is the behaviour this replaces: a missing vector quietly removed the dense channel
 * for that question and the table printed the lexical result under a dense header. A number that was
 * measured with fewer vectors than it claims is worse than no number.
 */
function preflight(requests) {
    for (const request of requests) DENSE.lookup(request);
    if (!DENSE.misses.length && !DENSE.dimensionMismatches.length) return;
    console.log('');
    console.log('cassette INVALID: this run would measure with vectors it cannot replay.');
    console.log('  ' + describeCassette(CASSETTE, { provenance: DENSE.provenance }));
    console.log('  declared ' + requests.length + ' inputs: ' + DENSE.misses.length + ' missing'
        + (DENSE.dimensionMismatches.length ? ', ' + DENSE.dimensionMismatches.length + ' at the wrong dimension' : ''));
    for (const miss of DENSE.misses.slice(0, 20)) {
        console.log('  MISS ' + miss.role.padEnd(8) + ' ' + JSON.stringify(String(miss.text).slice(0, 70)));
    }
    if (DENSE.misses.length > 20) console.log('  ... and ' + (DENSE.misses.length - 20) + ' more');
    for (const bad of DENSE.dimensionMismatches.slice(0, 10)) {
        console.log('  DIM  ' + bad.role + ' expected ' + bad.expected + ', recorded ' + bad.dim + ' (' + bad.key + ')');
    }
    console.log('  Refusing to print a table: a lexical result under a dense header is read as a dense result.');
    console.log('  Fill it with: node recall-baseline.mjs <same arguments> --cassette-requests req.json');
    console.log('               node recall-embed.mjs --requests req.json --out ' + embeddingFile);
    process.exit(1);
}

/**
 * A question set written by hand against a real chat, in two kinds:
 *
 *   entity   - the question names the person, place or object the answer is about. This is what a
 *              player asks when they remember the scene but not the wording.
 *   oblique  - the question describes the situation without naming it. This is the case dense
 *              retrieval exists for, and the case the lexical generator cannot fake.
 *
 * Each entry is {question, needle, kind, chat}: the needle is the literal substring the answer has to
 * carry, and chat is optional. The runner checks the needle's occurrence count first, because a needle
 * that appears twice proves nothing about which span was found.
 *
 * Naming a chat makes the check the right one rather than the strictest one: the needle only has to be
 * unique in the chat that gets searched, and a second copy in some other chat says nothing about which
 * span this one found. Entries without a chat keep the global check.
 */
function loadParaphrases(file) {
    if (!file || !fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8').trim();
    const rows = raw.startsWith('[') ? JSON.parse(raw)
        : raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    return rows.filter(row => row && row.question && row.needle)
        .map(row => ({ question: String(row.question), needle: String(row.needle),
            kind: row.kind === 'oblique' ? 'oblique' : 'entity', chat: row.chat ? String(row.chat) : null }));
}

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

/**
 * Entropy and margin of one score distribution.
 *
 * Entropy says how flat the distribution is: a vague question spreads its mass, a question naming one
 * thing concentrates it. Margin says how far the leader is ahead of the runner-up. TARG's finding is
 * that margin is the more discriminative of the two under instruction-tuned models, so both are
 * recorded per question and reported for hits against misses.
 *
 * They are computed per channel, because the fused RRF distribution is nearly flat by construction -
 * rank 0 scores 1/61 and rank 1 scores 1/62 - so its margin is 0.02 for every question. A rule that
 * reads confidence has to read a channel that carries magnitude, not the fusion of it.
 */
function distributionSignals(scores) {
    const values = scores.map(Number).filter(value => value > 0).sort((a, b) => b - a);
    if (values.length < 2) return { entropy: null, margin: null };
    const total = values.reduce((sum, value) => sum + value, 0);
    const entropy = -values.reduce((sum, value) => { const p = value / total; return sum + p * Math.log(p); }, 0)
        / Math.log(values.length);
    return { entropy, margin: (values[0] - values[1]) / values[0] };
}

function rankingSignals(ranked) {
    const lexical = distributionSignals(ranked.map(row => row.lexical));
    const fused = distributionSignals(ranked.map(row => row.score));
    return { candidates: ranked.length, entropy: lexical.entropy, margin: lexical.margin,
        fusedEntropy: fused.entropy, fusedMargin: fused.margin };
}

/**
 * Where the answer went.
 *
 * "The answer was never a candidate" and "the answer was a candidate and the budget kept the wrong
 * four" are different defects with different fixes, so a measurement records which rule dropped it and
 * which quoted slot carried it. The outcome comes from the packer's own trace, not from a guess made
 * after the fact.
 */
function attribute(ranked, packed, needle, records, chunks) {
    const rank = ranked.findIndex(entry => entry.chunk.text.includes(needle));
    const chunk = rank >= 0 ? ranked[rank].chunk : null;
    const spanOf = span => String(records[span.source]?.text || '').slice(span.start, span.end);
    const row = { rank, slot: packed.sources.findIndex(span => spanOf(span).includes(needle)), found: false,
        lexical: null, lexicalRank: null, drop: 'no_chunk_carries_it' };
    row.found = row.slot >= 0;
    // Three different failures: no chunk holds the needle at all (the needle straddles a chunk boundary,
    // so the question is not measurable this way), a chunk holds it but scored nothing, or it was a
    // candidate and the packing rules discarded it. Only the last two are retrieval defects.
    if (!chunks.some(item => item.text.includes(needle))) return row;
    row.drop = 'not_a_candidate';
    if (!chunk) return row;
    const entry = (packed.trace || []).find(item => item.chunks.includes(chunk.id));
    row.drop = entry ? entry.outcome : 'out_of_scope';
    if (row.drop === 'included' && !row.found) row.drop = 'trimmed_out';
    row.lexical = ranked[rank].lexical ?? null;
    const byLexical = ranked.filter(item => (item.lexical || 0) > 0)
        .sort((a, b) => b.lexical - a.lexical || a.chunk.index - b.chunk.index);
    const lexicalRank = byLexical.findIndex(item => item.chunk === chunk);
    row.lexicalRank = lexicalRank >= 0 ? lexicalRank : null;
    return row;
}

const fixed = (value, digits) => value === null || value === undefined ? ' n/a' : value.toFixed(digits);

/**
 * Everything one chat contributes, computed before a single vector is resolved.
 *
 * The split from the scoring below exists so the run can name its inputs, and be told what is missing,
 * before it prints a number. A cassette miss discovered halfway through a table is a table the reader
 * has already believed.
 */
function prepare(chat) {
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

    // Growth: the archive is one copy of the text plus one record per superseded version, so the
    // question a policy has to answer is whether superseded versions stay negligible.
    const live = new Set(history.active);
    const superseded = Object.entries(history.records).filter(([id]) => !live.has(id));
    const supersededChars = superseded.reduce((sum, [, row]) => sum + String(row.text || '').length, 0);
    const visibleText = messages.map(row => String(row.mes ?? '')).join('\n');

    // Recall over the floors a summary would have folded.
    const assistants = messages.filter(row => row.is_user !== true && String(row.mes ?? '').trim());
    const probes = probesFor(messages, probeBudget);
    return { chat, messages, store, transcriptChars, archiveBytes, history, chunks, movedBytes, storeBytes,
        superseded, supersededChars, visibleText, assistants, probes };
}

function measure(row) {
    const { chat, messages, chunks, history, superseded, supersededChars, storeBytes, movedBytes, archiveBytes,
        visibleText, assistants, probes, transcriptChars } = row;
    let found = 0;
    let candidateHit = 0;
    let tokens = 0;
    const ranks = [];
    const entropies = [];
    const margins = [];
    for (const probe of probes) {
        const ranked = rankRawChunks(chunks, probe.query, denseFor(chunks, probe.query),
            { scorer: SCORER, denseWeight: DENSE_WEIGHT });
        const packed = packRawEvidence(ranked, history, { maxTokens: EVIDENCE_TOKENS,
            maxEntries: SLOTS, visibleSources: new Set(), policy: POLICY, query: probe.query, spanCost: SPAN_COST });
        if (packed.text.includes(probe.needle)) found += 1;
        const rank = ranked.findIndex(entry => entry.chunk.text.includes(probe.needle));
        if (rank >= 0) { candidateHit += 1; ranks.push(rank); }
        const signals = rankingSignals(ranked);
        if (signals.entropy !== null) { entropies.push(signals.entropy); margins.push(signals.margin); }
        tokens += packed.tokens;
    }
    ranks.sort((a, b) => a - b);
    return {
        file: path.basename(chat.file), fileKb: kb(chat.size), messages: messages.length, floors: assistants.length,
        transcriptKb: kb(transcriptChars * 3), storeKb: kb(storeBytes), derivedMovedKb: kb(movedBytes),
        archiveKb: kb(archiveBytes), chunks: chunks.length, probes: probes.length,
        superseded: superseded.length, supersededKb: kb(supersededChars * 3),
        visibleTokens: estimateTokens(visibleText),
        recall: probes.length ? found / probes.length : null,
        candidateHit: probes.length ? candidateHit / probes.length : null,
        medianRank: ranks.length ? ranks[Math.floor(ranks.length / 2)] : null,
        meanTokens: probes.length ? Math.round(tokens / probes.length) : null,
        entropy: median(entropies), margin: median(margins),
    };
}

/**
 * The paraphrase measurement. It runs the same ranking and packing as the probe set, but the question
 * is written by a person rather than cut out of the answer, which is the only way to see the lexical
 * floor for the question a player actually types.
 *
 * An entry may name the chat it was written against. The needle is then checked for uniqueness inside
 * that chat, which is the condition that actually matters - the needle exists to prove which span was
 * found there. A needle that also occurs in a different chat says nothing about this one. Chats named
 * by an entry are loaded even when the --limit cut left them out.
 */
function resolveParaphrases(chats, entries) {
    const every = root.flatMap(target => collect(target)).sort((a, b) => b.size - a.size);
    const seen = new Set(chats.map(chat => chat.file));
    const wanted = [...new Set(entries.map(entry => entry.chat).filter(Boolean))];
    const scope = [...chats];
    for (const name of wanted) {
        for (const chat of every) {
            if (seen.has(chat.file) || !path.basename(chat.file).includes(name)) continue;
            seen.add(chat.file);
            scope.push(chat);
        }
    }
    const loaded = scope.map(chat => {
        const { messages } = load(chat.file);
        const scratch = {};
        captureHistory(scratch, messages);
        return { file: path.basename(chat.file), messages, history: scratch.raw_history,
            chunks: chunkHistory(scratch.raw_history) };
    });
    const rows = [];
    for (const entry of entries) {
        const named = entry.chat ? loaded.filter(chat => chat.file.includes(entry.chat)) : [];
        const searched = named.length ? named : loaded;
        const occurrences = searched.reduce((sum, chat) => sum + chat.messages
            .filter(row => String(row.mes ?? '').includes(entry.needle)).length, 0);
        const row = { ...entry, occurrences, found: false, rank: null, slot: null, drop: null, tokens: null,
            entropy: null, margin: null, fusedEntropy: null, fusedMargin: null, lexical: null, lexicalRank: null,
            spans: 0, spansWithNeedle: 0, found_in_candidates: false, chatRef: null };
        // Choosing the chat here rather than during scoring is what lets the run name the vectors it needs.
        if (occurrences === 1) {
            // Measure in the chat that carries the needle, not merely the first one searched.
            row.chatRef = searched.find(item => item.chunks.some(chunk => chunk.text.includes(entry.needle)))
                || searched[0];
        }
        rows.push(row);
    }
    return { rows };
}

/** Score the resolved entries. Runs only after the cassette has proved it can replay every input. */
function scoreParaphrases(resolved) {
    const rows = resolved.rows;
    for (const row of rows) {
        if (row.occurrences !== 1 || !row.chatRef) continue;
        const chat = row.chatRef;
        const entry = row;
        const ranked = rankRawChunks(chat.chunks, entry.question, denseFor(chat.chunks, entry.question),
            { scorer: SCORER, denseWeight: DENSE_WEIGHT });
        const packed = packRawEvidence(ranked, chat.history, { maxTokens: EVIDENCE_TOKENS,
            maxEntries: SLOTS, visibleSources: new Set(), policy: POLICY, query: entry.question, spanCost: SPAN_COST });
        const where = attribute(ranked, packed, entry.needle, chat.history.records, chat.chunks);
        const signals = rankingSignals(ranked);
        row.rank = where.rank;
        row.slot = where.slot;
        row.found = where.found;
        row.drop = where.drop;
        row.lexical = where.lexical;
        row.lexicalRank = where.lexicalRank;
        row.entropy = signals.entropy;
        row.margin = signals.margin;
        row.fusedEntropy = signals.fusedEntropy;
        row.fusedMargin = signals.fusedMargin;
        row.tokens = packed.tokens;
        row.found_in_candidates = where.rank >= 0;
        // Precision proxy: of the spans that were quoted, how many carry the answer.
        row.spans = packed.sources.length;
        row.spansWithNeedle = packed.sources.filter(span => String(chat.history.records[span.source]?.text || '')
            .slice(span.start, span.end).includes(entry.needle)).length;
    }
    const counted = rows.filter(row => row.occurrences === 1);
    const kind = name => counted.filter(row => row.kind === name);
    const rate = rows => rows.length ? rows.filter(row => row.found).length / rows.length : null;
    const entity = kind('entity');
    const oblique = kind('oblique');
    const hits = counted.filter(row => row.found);
    const misses = counted.filter(row => !row.found);
    const byRule = new Map();
    for (const row of counted) byRule.set(row.drop, (byRule.get(row.drop) || 0) + 1);
    console.log('');
    console.log('paraphrase set: ' + rows.length + ' entries, ' + counted.length + ' countable (entity '
        + entity.length + ', oblique ' + oblique.length + ')');
    for (const row of rows) {
        const mark = row.occurrences !== 1 ? '  --' : row.found ? 'HIT ' : 'MISS';
        const detail = row.occurrences === 0 ? 'needle not in the searched chats'
            : row.occurrences > 1 ? 'needle appears ' + row.occurrences + 'x, excluded'
            : (row.found ? 'slot ' + row.slot : 'lost ') + ' rank ' + row.rank + ' ent ' + fixed(row.entropy, 2)
                + ' mar ' + fixed(row.margin, 2) + ' ' + row.drop + ' ' + row.tokens + ' tok';
        console.log('  ' + mark + ' [' + row.kind.padEnd(7) + '] ' + detail.padEnd(52) + row.question);
    }
    console.log('');
    const quoted = counted.filter(row => row.spans);
    const spans = quoted.reduce((sum, row) => sum + row.spans, 0);
    const carrying = quoted.reduce((sum, row) => sum + (row.spansWithNeedle || 0), 0);
    console.log('entity recall ' + pct(rate(entity)) + ' | oblique recall ' + pct(rate(oblique))
        + ' | all ' + pct(rate(counted)) + ' (n=' + counted.length + ', oblique n=' + oblique.length + ')');
    console.log('evidence precision proxy: ' + (spans ? Math.round(carrying / spans * 100) + '%' : 'n/a')
        + ' of quoted spans carry the answer (' + carrying + '/' + spans + ')');
    console.log('evidence ' + median(counted.map(row => row.tokens)) + ' tokens/query | where the answer went: '
        + [...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([rule, count]) => rule + ' ' + count).join(', '));
    console.log('lexical signal: hits median entropy ' + fixed(median(hits.map(row => row.entropy)), 2)
        + ' margin ' + fixed(median(hits.map(row => row.margin)), 2) + ' | misses median entropy '
        + fixed(median(misses.map(row => row.entropy)), 2) + ' margin ' + fixed(median(misses.map(row => row.margin)), 2));
    console.log('fused (RRF) signal: hits entropy ' + fixed(median(hits.map(row => row.fusedEntropy)), 2)
        + ' margin ' + fixed(median(hits.map(row => row.fusedMargin)), 2) + ' | misses entropy '
        + fixed(median(misses.map(row => row.fusedEntropy)), 2) + ' margin '
        + fixed(median(misses.map(row => row.fusedMargin)), 2));
    const summary = { entries: rows.length, countable: counted.length, entity: rate(entity), oblique: rate(oblique),
        all: rate(counted), precision: spans ? carrying / spans : null, tokens: median(counted.map(row => row.tokens)),
        drops: Object.fromEntries(byRule) };
    if (dumpFile) {
        fs.writeFileSync(dumpFile, JSON.stringify({ scorer: SCORER, pack: POLICY, spanCost: SPAN_COST,
            evidenceTokens: EVIDENCE_TOKENS, entries: EVIDENCE_ENTRIES, pinnedEntries: Boolean(SLOTS), summary,
            cassette: cassetteRecord(), dense: Boolean(DENSE), denseWeight: DENSE_WEIGHT, embedTop: EMBED_TOP,
            rows: rows.map(row => ({ question: row.question, kind: row.kind, chat: row.chat,
                occurrences: row.occurrences, found: row.found, rank: row.rank, slot: row.slot, drop: row.drop,
                tokens: row.tokens, entropy: row.entropy, margin: row.margin, lexical: row.lexical,
                lexicalRank: row.lexicalRank, spans: row.spans, spansWithNeedle: row.spansWithNeedle })) }, null, 2));
        console.log('wrote ' + dumpFile);
    }
    return summary;
}

/**
 * Paired comparison against an earlier dump.
 *
 * Two percentages hide the only thing that matters for a decision: whether the questions that changed
 * are the same questions. n=52 resolves about a 7-point difference on its own, so the discordant pairs
 * are counted directly and tested with an exact McNemar (two-sided binomial on the pairs that moved).
 */
function mcnemar(both, onlyA, onlyB, neither) {
    const discordant = onlyA + onlyB;
    if (!discordant) return { p: 1, discordant };
    const smaller = Math.min(onlyA, onlyB);
    let tail = 0;
    let choose = 1;
    for (let k = 0; k <= smaller; k++) {
        if (k > 0) choose = choose * (discordant - k + 1) / k;
        tail += choose * Math.pow(0.5, discordant);
    }
    return { p: Math.min(1, 2 * tail), discordant };
}

function reportComparison(a, b) {
    const left = JSON.parse(fs.readFileSync(a, 'utf8'));
    const right = JSON.parse(fs.readFileSync(b, 'utf8'));
    // A difference between two runs can only be attributed to the rule that changed if both ran against
    // the same vectors. Two lexical runs have no vectors to disagree about, and a lexical run against a
    // dense one is the experiment itself, so this refuses only the case that is actually confounded.
    const vectorsOf = dump => dump?.cassette?.vectors_fingerprint || null;
    const leftVectors = vectorsOf(left);
    const rightVectors = vectorsOf(right);
    if (leftVectors && rightVectors && leftVectors !== rightVectors) {
        console.log('');
        console.log('refusing the paired comparison: A and B were measured against different vector sets ('
            + leftVectors + ' vs ' + rightVectors + '). The ranking rule cannot be separated from the embeddings.');
        return;
    }
    if (Boolean(leftVectors) !== Boolean(rightVectors)) {
        console.log('note: only one side used a dense channel (' + (leftVectors ? 'A' : 'B')
            + '), so part of the difference is the channel being on rather than the rule that changed.');
    }
    const key = row => row.question;
    const map = new Map(right.rows.map(row => [key(row), row]));
    const pairs = left.rows.filter(row => map.has(key(row)) && row.occurrences === 1 && map.get(key(row)).occurrences === 1)
        .map(row => ({ kind: row.kind, question: row.question, a: row.found, b: map.get(key(row)).found }));
    const count = rows => rows.length;
    const tally = kind => {
        const rows = kind ? pairs.filter(row => row.kind === kind) : pairs;
        return { n: count(rows), both: rows.filter(row => row.a && row.b).length,
            onlyA: rows.filter(row => row.a && !row.b).length, onlyB: rows.filter(row => !row.a && row.b).length,
            neither: rows.filter(row => !row.a && !row.b).length };
    };
    const line = (label, t) => {
        const test = mcnemar(t.both, t.onlyA, t.onlyB, t.neither);
        console.log('  ' + label.padEnd(9) + ' n=' + String(t.n).padStart(3)
            + '  A ' + String(Math.round((t.both + t.onlyA) / Math.max(1, t.n) * 100)).padStart(3) + '%'
            + '  B ' + String(Math.round((t.both + t.onlyB) / Math.max(1, t.n) * 100)).padStart(3) + '%'
            + '  both ' + String(t.both).padStart(3) + '  A only ' + String(t.onlyA).padStart(2)
            + '  B only ' + String(t.onlyB).padStart(2) + '  neither ' + String(t.neither).padStart(3)
            + '  p=' + (test.discordant ? test.p.toFixed(3) : 'n/a'));
    };
    console.log('');
    console.log('paired comparison: A = ' + left.scorer + '/' + left.pack + '  B = ' + right.scorer + '/' + right.pack);
    line('all', tally(null));
    line('entity', tally('entity'));
    line('oblique', tally('oblique'));
}

/** What the dump records about where its vectors came from, so a later comparison can refuse a confound. */
function cassetteRecord() {
    if (!CASSETTE) return null;
    return { file: path.basename(CASSETTE.file), format: CASSETTE.format, model: CASSETTE.manifest.model,
        base: CASSETTE.manifest.base, dim: CASSETTE.manifest.dim,
        entries: Object.keys(CASSETTE.vectors).length, file_fingerprint: CASSETTE.fingerprint,
        vectors_fingerprint: DENSE ? DENSE.vectorsFingerprint : null,
        provenance: DENSE ? DENSE.provenance : CASSETTE.manifest.provenance };
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
console.log('scorer ' + SCORER + ' | pack ' + POLICY + ' | evidence budget ' + EVIDENCE_TOKENS
    + ' tokens in ' + EVIDENCE_ENTRIES + ' slots' + (SLOTS ? ' (pinned)' : ' (derived from the budget)')
    + ' | top ' + limit + ' chats by size');
if (CASSETTE) {
    console.log('cassette ' + CASSETTE.file + ' [' + CASSETTE.format + '] '
        + describeCassette(CASSETTE, { provenance: DENSE ? DENSE.provenance : CASSETTE.manifest.provenance }));
    console.log(DENSE ? 'dense weight ' + DENSE_WEIGHT + ' of top ' + EMBED_TOP + ', replayed from the cassette'
        : 'dense off: a cassette was loaded, but the fusion weight is 0, so this run is lexical');
} else {
    console.log('dense off (lexical only: pass --embeddings <cassette> to measure the dense channel)');
}

// Resolve every input before printing anything. This is the order that makes a cassette a proof rather
// than a cache: the run is told it cannot replay its own vectors while there is still nothing to un-read.
const prepared = [];
for (const chat of chats) {
    try { prepared.push(prepare(chat)); } catch (error) {
        console.log(path.basename(chat.file).padEnd(40) + 'ERROR ' + String(error.message).slice(0, 60));
    }
}
const paraphrases = loadParaphrases(paraphraseFile);
const resolved = paraphrases ? resolveParaphrases(chats, paraphrases) : null;
const declaredTargets = prepared.map(row => ({ chunks: row.chunks, questions: row.probes.map(probe => probe.query) }));
if (resolved) for (const row of resolved.rows) {
    if (row.occurrences === 1 && row.chatRef) declaredTargets.push({ chunks: row.chatRef.chunks, questions: [row.question] });
}
const requests = collectRequests(declaredTargets);

// The other half of the contract: the run says what it needs, so the builder can be told to embed exactly
// that instead of being handed a chat and hoped for.
if (requestsFile) {
    const declaredModel = MODEL || CASSETTE?.manifest.model || null;
    const declaredBase = BASE || CASSETTE?.manifest.base || null;
    // The base belongs in the file because it is part of the request the key names: the builder must use
    // this string, and defaulting it here would let the two sides key the same text differently.
    if (!declaredModel || !declaredBase) {
        console.log('--cassette-requests needs --model and --base (or a loaded --embeddings cassette) to name the requests.');
        process.exit(1);
    }
    // legacy_key is written out because it is the only name an older cache entry has, which is what makes
    // the legacy file readable at all; the run itself uses legacyKey.
    fs.writeFileSync(requestsFile, JSON.stringify({ format: CASSETTE_REQUESTS_FORMAT,
        model: declaredModel, base: declaredBase,
        requests: requests.map(request => ({ role: request.role, text: request.text, legacy_key: request.legacyKey })) }, null, 2));
    const documents = requests.filter(request => request.role === 'document').length;
    console.log('wrote ' + requestsFile + ': ' + requests.length + ' inputs (' + documents + ' document, '
        + (requests.length - documents) + ' query) for model ' + declaredModel);
    console.log('fill it with: node recall-embed.mjs --requests ' + requestsFile + ' --out <cassette>');
    process.exit(0);
}

if (DENSE) preflight(requests);

console.log('chat'.padEnd(40) + 'fileKB  msgs  floors  storeKB  moved  archive  chunks  probes  recall  cand  rank   tok');
const rows = [];
for (const row of prepared) {
    try {
        const measured = measure(row);
        rows.push(measured);
        console.log(measured.file.padEnd(40) + String(measured.fileKb).padStart(6) + String(measured.messages).padStart(6) + String(measured.floors).padStart(8)
            + String(measured.storeKb).padStart(9) + String(measured.derivedMovedKb).padStart(7) + String(measured.archiveKb).padStart(8)
            + String(measured.chunks).padStart(8) + String(measured.probes).padStart(8) + pct(measured.recall).padStart(8)
            + pct(measured.candidateHit).padStart(6) + String(measured.medianRank ?? 'n/a').padStart(6) + String(measured.meanTokens ?? 'n/a').padStart(6));
    } catch (error) {
        console.log(path.basename(row.chat.file).padEnd(40) + 'ERROR ' + String(error.message).slice(0, 60));
    }
}
function median(values) {
    const sorted = values.filter(value => value !== null && value !== undefined).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}
if (rows.length) {
    console.log('');
    console.log('median file ' + median(rows.map(r => r.fileKb)) + 'KB | transcript text '
        + median(rows.map(r => r.transcriptKb)) + 'KB | archive ' + median(rows.map(r => r.archiveKb))
        + 'KB | retired fact set in the chat file ' + median(rows.map(r => r.storeKb)) + 'KB of which '
        + median(rows.map(r => r.derivedMovedKb)) + 'KB moved out by this version');
    console.log('median recall ' + pct(median(rows.map(r => r.recall))) + ' | candidate hit '
        + pct(median(rows.map(r => r.candidateHit))) + ' | median rank ' + median(rows.map(r => r.medianRank))
        + ' | evidence ' + median(rows.map(r => r.meanTokens)) + ' tokens/query'
        + ' | lexical entropy ' + fixed(median(rows.map(r => r.entropy)), 2)
        + ' margin ' + fixed(median(rows.map(r => r.margin)), 2));
    const perFloorKb = rows.map(r => r.floors ? r.archiveKb / r.floors : null);
    const perFloorTokens = rows.map(r => r.floors ? Math.round(r.visibleTokens / r.floors) : null);
    console.log('growth: median archive ' + median(perFloorKb.map(v => v === null ? null : Math.round(v * 100) / 100))
        + ' KB/floor | superseded versions ' + median(rows.map(r => r.superseded))
        + ' (' + median(rows.map(r => r.supersededKb)) + ' KB) | transcript ' + median(perFloorTokens) + ' tokens/floor');
    console.log('at 500 floors that is an archive of about '
        + Math.round((median(perFloorKb) || 0) * 500) + ' KB, and a visible transcript of about '
        + Math.round((median(perFloorTokens) || 0) * 500 / 1000) + 'k tokens before any summary folds it');
    console.log('Derived keys now owned by the external record: ' + DERIVED_KEYS.filter(k => ['memories', 'slots', 'hierarchical_summaries'].includes(k)).join(', '));
}
if (resolved) scoreParaphrases(resolved);
if (againstFile && dumpFile) reportComparison(againstFile, dumpFile);
if (againstFile && !dumpFile) console.log('--against needs --dump in the same run: it compares that dump against this run');
