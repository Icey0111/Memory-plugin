// A dense measurement is only a measurement if its vectors can be replayed. This module is the
// transport cassette for the ruler: it records which provider request produced which vector, so a run
// either replays the exact vectors it measured with or refuses to run at all.
//
// Two silent failures it exists to stop:
//
//   1. The old cache was keyed by the archive's hash of the chunk id and its *raw* text
//      (c:fnv1a32(chunkId + '|' + text)), while the vector was embedded from `retrievalText`, which is
//      that text plus a "speaker: name (role)" header. Changing that header kept the key and served a
//      vector computed from different input. So did changing the embedding model, the base URL, the
//      provider task, or the question text. A measurement would have gone on "working" against the
//      wrong vectors forever, because nothing in the file said what had been asked.
//   2. A missing vector made dense recall silently vanish for that query: the lookup returned an empty
//      list and the run still printed a header saying dense was on. A table printed under a dense
//      header is read as a dense table, so a miss has to invalidate the run, not degrade it.
//
// The key covers every field of the request that changes the response. Nothing here decides policy:
// whether a miss is fatal belongs to the caller, because only the caller knows whether dense was asked
// for at all.

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildDirectEmbeddingBody } from './v55-tauri-vector-backend.js';

export const CASSETTE_FORMAT = 'aetheria-embedding-cassette/2';
/** What a ruler writes so the builder can embed exactly the inputs that run declared. */
export const CASSETTE_REQUESTS_FORMAT = 'aetheria-cassette-requests/1';
export const CASSETTE_ROLES = Object.freeze(['document', 'query']);
/** A recorded cassette answers for itself; a legacy one cannot say what it was built from. */
export const CASSETTE_PROVENANCE = Object.freeze(['recorded', 'legacy-unverified']);

const clean = value => String(value ?? '').replace(/\u0000/g, '').trim();

/**
 * The provider task for one role, read from the plugin's own request builder.
 *
 * This is deliberately not a second copy of the Jina rule. A copy would drift, and the drift would be
 * invisible in exactly the wrong direction: the key would keep matching while the request changed, so
 * the cassette would replay vectors that the plugin would no longer ask for. Reading the rule from the
 * function that builds the body makes the key and the body the same decision.
 */
const taskCache = new Map();
export function embeddingTaskFor({ model, base = '', role }) {
    if (!CASSETTE_ROLES.includes(role)) throw new Error('cassette role 无效：' + String(role));
    const name = clean(model);
    if (!name) throw new Error('cassette task 需要 model。');
    const cacheKey = name + '\u0000' + clean(base) + '\u0000' + role;
    if (taskCache.has(cacheKey)) return taskCache.get(cacheKey);
    // buildDirectEmbeddingBody rejects an empty model or input, so the placeholder input carries the
    // call; only `task` is read back. The body it returns is the body the plugin would send.
    const body = buildDirectEmbeddingBody({ model: name, texts: ['x'], apiUrl: clean(base), role });
    const task = typeof body.task === 'string' ? body.task : '';
    taskCache.set(cacheKey, task);
    return task;
}

/** The request-derived identity of one vector: model + base + role + task + the exact input text. */
export function cassetteEntryKey({ model, base = '', role, text }) {
    const name = clean(model); if (!name) throw new Error('cassette entry 缺少 model。');
    if (!CASSETTE_ROLES.includes(role)) throw new Error('cassette entry role 无效：' + String(role));
    const input = String(text ?? ''); if (!input) throw new Error('cassette entry 缺少 text。');
    const task = embeddingTaskFor({ model: name, base, role });
    const hash = createHash('sha256');
    hash.update([CASSETTE_FORMAT, name, clean(base), role, task, input].join('\u0000'));
    return 'e2:' + hash.digest('hex').slice(0, 40);
}

/**
 * A stable name for the vector set itself.
 *
 * Two runs whose dumps differ can only be compared as a ranking-rule change if they were measured
 * against the same vectors, and the dump is the only place that outlives the cassette file. Hashing the
 * recorded numbers, not the request texts, makes a changed model, a re-embedded chunk or a rounding
 * change show up as a different fingerprint.
 */
export function cassetteFingerprint(vectors) {
    const hash = createHash('sha256');
    for (const key of Object.keys(vectors || {}).sort()) {
        const vector = vectors[key];
        hash.update(key + '\u0000' + (Array.isArray(vector) ? vector.length + ':' + vector.join(',') : 'none') + '\u0001');
    }
    return hash.digest('hex').slice(0, 16);
}

export function createCassette({ model, base = '', provenance = 'recorded' } = {}) {
    const name = clean(model); if (!name) throw new Error('cassette 需要 model。');
    if (!CASSETTE_PROVENANCE.includes(provenance)) throw new Error('cassette provenance 无效：' + String(provenance));
    return {
        format: CASSETTE_FORMAT,
        manifest: { model: name, base: clean(base),
            task: { document: embeddingTaskFor({ model: name, base, role: 'document' }),
                query: embeddingTaskFor({ model: name, base, role: 'query' }) },
            dim: null, created_at: new Date().toISOString(), provenance },
        vectors: {},
    };
}

/** Store one provider response under the key of the request that produced it. */
export function recordVector(cassette, request, vector) {
    const values = Array.from(vector || [], Number);
    if (!values.length || values.some(value => !Number.isFinite(value))) {
        throw new Error('cassette vector 无效：空向量或含非数值。');
    }
    // Stored at 1e-5 like the cache this replaces. The rounding is part of the format: the fingerprint
    // hashes the stored numbers, so a run that rounded differently is a different recording.
    const rounded = values.map(value => Math.round(value * 1e5) / 1e5);
    if (cassette.manifest.dim && cassette.manifest.dim !== rounded.length) {
        throw new Error('cassette 维度不一致：manifest=' + cassette.manifest.dim + '，新向量=' + rounded.length + '。');
    }
    cassette.manifest.dim = rounded.length;
    cassette.vectors[cassetteEntryKey(request)] = rounded;
    return cassette;
}

/**
 * Read a cassette, in this format or the legacy one.
 *
 * A legacy cache is not migrated. Its keys do not name the request, so there is no way to tell whether
 * an entry describes the input this run would embed; re-keying it would launder exactly the hazard the
 * cassette exists to expose. It is read only under an explicit `adoptLegacy`, and the provenance it
 * carries says so, on every line of the report and in the dump.
 */
export function readCassette(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const vectors = raw && typeof raw.vectors === 'object' && raw.vectors ? raw.vectors : {};
    const legacy = raw?.format !== CASSETTE_FORMAT;
    const manifest = legacy
        ? { model: clean(raw?.model), base: clean(raw?.base), task: { document: clean(raw?.task), query: '' },
            dim: null, created_at: null, provenance: 'legacy-unverified' }
        : { model: clean(raw?.manifest?.model), base: clean(raw?.manifest?.base),
            task: { document: clean(raw?.manifest?.task?.document), query: clean(raw?.manifest?.task?.query) },
            dim: Number(raw?.manifest?.dim) > 0 ? Number(raw.manifest.dim) : null,
            created_at: raw?.manifest?.created_at || null,
            provenance: CASSETTE_PROVENANCE.includes(raw?.manifest?.provenance) ? raw.manifest.provenance : 'recorded' };
    return { file, format: legacy ? 'legacy/1' : CASSETTE_FORMAT, legacy, manifest, vectors,
        fingerprint: cassetteFingerprint(vectors) };
}

export function writeCassette(file, cassette) {
    const payload = { format: CASSETTE_FORMAT, manifest: cassette.manifest, vectors: cassette.vectors };
    fs.writeFileSync(file, JSON.stringify(payload));
    return { file, fingerprint: cassetteFingerprint(cassette.vectors), entries: Object.keys(cassette.vectors).length };
}

/**
 * Resolve the vectors one run needs, collecting what is missing instead of deciding what to do about it.
 *
 * `lookup` answers with a vector or null, keyed by the manifest's model and base plus the requested role
 * and text. A null is recorded once per distinct request, so a report can list everything the run would
 * have to embed rather than the first thing it tripped over.
 */
export function cassetteIndex(cassette, { adoptLegacy = false } = {}) {
    const vectors = cassette.vectors || {};
    const recorded = new Set();
    const used = new Map();
    const legacy = new Set();
    const misses = [];
    const missKeys = new Set();
    const dimensionMismatches = [];
    // The recording's model and base are bound here, not taken from the caller. The ruler knows the text
    // it wants; only the cassette knows what the provider was actually asked for, and a caller-supplied
    // model would let a lookup key against a request that was never made.
    function lookup(request) {
        const key = cassetteEntryKey({ model: cassette.manifest.model, base: cassette.manifest.base,
            role: request.role, text: request.text });
        const has = Object.prototype.hasOwnProperty.call(vectors, key) ? vectors[key] : null;
        if (Array.isArray(has) && cassette.manifest.dim && has.length !== cassette.manifest.dim) {
            dimensionMismatches.push({ key, role: request.role, dim: has.length, expected: cassette.manifest.dim });
            return null;
        }
        if (Array.isArray(has)) { recorded.add(key); used.set(key, has); return has; }
        const legacyKey = request.legacyKey ? String(request.legacyKey) : '';
        const adopt = adoptLegacy && legacyKey && Array.isArray(vectors[legacyKey]) ? vectors[legacyKey] : null;
        if (adopt) { legacy.add(legacyKey); used.set(legacyKey, adopt); return adopt; }
        if (!missKeys.has(key)) {
            missKeys.add(key);
            misses.push({ key, role: request.role, legacy_key: legacyKey, text: String(request.text ?? '') });
        }
        return null;
    }
    return {
        lookup, misses, dimensionMismatches,
        get recordedCount() { return recorded.size; },
        get legacyCount() { return legacy.size; },
        get provenance() {
            if (cassette.manifest.provenance === 'legacy-unverified' || legacy.size) return 'legacy-unverified';
            return cassette.manifest.provenance;
        },
        // The identity of the vectors this run actually read, not of the file it read them from. Two runs
        // that used the same vectors from differently topped-up files are comparable; two that used
        // different vectors are not, and this is the field that says which happened.
        get vectorsFingerprint() { return used.size ? cassetteFingerprint(Object.fromEntries(used)) : null; },
    };
}

/** The one line a report can print about where its vectors came from. */
export function describeCassette(cassette, { provenance = cassette.manifest.provenance } = {}) {
    const task = cassette.manifest.task || {};
    return ['model ' + (cassette.manifest.model || 'unknown'), 'base ' + (cassette.manifest.base || 'none'),
        'task ' + (task.document || 'none') + '/' + (task.query || 'none'),
        'dim ' + (cassette.manifest.dim || 'unknown'),
        'entries ' + Object.keys(cassette.vectors || {}).length,
        'fingerprint ' + cassette.fingerprint, 'provenance ' + provenance].join(' | ');
}
