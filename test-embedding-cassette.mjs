// A cassette's contract is that a recorded vector can be replayed or refused, never guessed at.
//
// The keys below are the whole point. If the key stops naming the request, the cassette silently
// replays a vector computed from something else, which is the failure the old c:hash / q:question cache
// had: it survived a changed retrieval prefix, a changed model and a changed task without a word.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASSETTE_FORMAT, CASSETTE_REQUESTS_FORMAT, CASSETTE_ROLES, CASSETTE_PROVENANCE,
    cassetteEntryKey, embeddingTaskFor, cassetteFingerprint, createCassette, recordVector,
    readCassette, writeCassette, cassetteIndex, describeCassette } from './embedding-cassette.mjs';
import { buildDirectEmbeddingBody } from './v55-tauri-vector-backend.js';

const tmp = name => path.join(os.tmpdir(), 'aetheria-cassette-' + process.pid + '-' + name);
const JINA = { model: 'jina-embeddings-v5-text-small', base: 'https://api.jina.ai/v1' };
const document = { ...JINA, role: 'document', text: 'speaker: Seraphina (assistant)\nthe west road' };

// --- 1. the key names the request, not the chunk it happens to sit in ---------------------------------
{
    assert.equal(CASSETTE_FORMAT, 'aetheria-embedding-cassette/2');
    assert.equal(CASSETTE_REQUESTS_FORMAT, 'aetheria-cassette-requests/1');
    assert.deepEqual([...CASSETTE_ROLES], ['document', 'query']);
    assert.deepEqual([...CASSETTE_PROVENANCE], ['recorded', 'legacy-unverified']);
    const key = cassetteEntryKey(document);
    assert.equal(cassetteEntryKey({ ...document }), key, 'the same request keys the same entry');
    assert.match(key, /^e2:[0-9a-f]{40}$/);
    for (const [field, value] of [['model', 'other-model'], ['base', 'https://example.test/v1'],
        ['role', 'query'], ['text', 'the west road']]) {
        assert.notEqual(cassetteEntryKey({ ...document, [field]: value }), key, field + ' is part of the key');
    }
    // The retrieval prefix is the text that was embedded, so a changed header is a different input. This
    // is exactly the field the old c:hash key did not cover.
    assert.notEqual(cassetteEntryKey({ ...document, text: 'speaker: Seraphina (user)\nthe west road' }), key);
    assert.throws(() => cassetteEntryKey({ ...document, model: '' }), /model/);
    assert.throws(() => cassetteEntryKey({ ...document, text: '' }), /text/);
    assert.throws(() => cassetteEntryKey({ ...document, role: 'passage' }), /role/);
}

// --- 2. the task in the key is the task the plugin actually sends --------------------------------------
{
    // The ruler imports the plugin's own body builder for this, and this is the assertion that keeps the
    // two from drifting apart: a second copy of the Jina rule would keep the key matching a changed body.
    for (const role of ['document', 'query']) {
        const body = buildDirectEmbeddingBody({ model: JINA.model, texts: ['x'], apiUrl: JINA.base, role });
        assert.equal(embeddingTaskFor({ ...JINA, role }), body.task || '', role + ' task matches the plugin');
    }
    assert.equal(embeddingTaskFor({ ...JINA, role: 'document' }), 'retrieval.passage');
    assert.equal(embeddingTaskFor({ ...JINA, role: 'query' }), 'retrieval.query');
    // A non-Jina provider carries no task on either side.
    const plain = { model: 'text-embedding-3-small', base: 'https://api.openai.com/v1' };
    assert.equal(buildDirectEmbeddingBody({ model: plain.model, texts: ['x'], apiUrl: plain.base, role: 'document' }).task, undefined);
    assert.equal(embeddingTaskFor({ ...plain, role: 'document' }), '');
    // A Jina-shaped model carries one on any base, which is the plugin's rule too (it keys off the host
    // or the model name).
    assert.equal(embeddingTaskFor({ model: 'jina-embeddings-v5-text-small', base: 'https://proxy.test/v1', role: 'query' }), 'retrieval.query');
    // The task is cached, so asking twice cannot answer differently.
    assert.equal(embeddingTaskFor({ ...JINA, role: 'query' }), embeddingTaskFor({ ...JINA, role: 'query' }));
}

// --- 3. a cassette round-trips, and its vector sets have a stable name ---------------------------------
{
    assert.throws(() => createCassette({ model: '' }), /model/);
    assert.throws(() => createCassette({ ...JINA, provenance: 'hopeful' }), /provenance/);
    const cassette = createCassette(JINA);
    assert.equal(cassette.format, CASSETTE_FORMAT);
    assert.equal(cassette.manifest.task.document, 'retrieval.passage');
    assert.equal(cassette.manifest.dim, null);
    recordVector(cassette, { ...JINA, role: 'document', text: 'chunk one' }, [0.5, 0.25, 0]);
    recordVector(cassette, { ...JINA, role: 'query', text: 'where is the west road' }, [0.1, 0.2, 0.3]);
    assert.equal(cassette.manifest.dim, 3);
    // A second dimension cannot enter the same cassette: mixing them is a cosine of -1 and a silent drop.
    assert.throws(() => recordVector(cassette, { ...JINA, role: 'document', text: 'chunk two' }, [1, 2]), /维度/);
    assert.throws(() => recordVector(cassette, { ...JINA, role: 'document', text: 'chunk two' }, []), /无效/);
    const file = tmp('roundtrip.json');
    const written = writeCassette(file, cassette);
    assert.equal(written.entries, 2);
    const back = readCassette(file);
    assert.equal(back.format, CASSETTE_FORMAT);
    assert.equal(back.legacy, false);
    assert.equal(back.manifest.dim, 3);
    assert.equal(back.manifest.provenance, 'recorded');
    assert.equal(back.fingerprint, written.fingerprint);
    assert.deepEqual(back.vectors[cassetteEntryKey({ ...JINA, role: 'document', text: 'chunk one' })], [0.5, 0.25, 0]);
    assert.match(describeCassette(back), /provenance recorded/);
    fs.rmSync(file, { force: true });
    // Key order is not content; a changed number and an extra entry both are.
    assert.equal(cassetteFingerprint({ a: [1, 2], b: [3] }), cassetteFingerprint({ b: [3], a: [1, 2] }));
    assert.notEqual(cassetteFingerprint({ a: [1, 2] }), cassetteFingerprint({ a: [1, 3] }));
    assert.notEqual(cassetteFingerprint({ a: [1, 2] }), cassetteFingerprint({ a: [1, 2], b: [3] }));
}

// --- 4. a miss is collected, and it is the caller who decides what a miss means ------------------------
{
    const cassette = createCassette(JINA);
    recordVector(cassette, { ...JINA, role: 'document', text: 'alpha' }, [1, 0]);
    const index = cassetteIndex(cassette);
    assert.deepEqual(index.lookup({ ...JINA, role: 'document', text: 'alpha' }), [1, 0]);
    // The recording decides the request. A caller that names a different model or base is ignored, and a
    // caller that names neither is fine, because the ruler only knows the text it wants.
    assert.deepEqual(index.lookup({ model: 'other-model', base: 'https://elsewhere.test/v1',
        role: 'document', text: 'alpha' }), [1, 0]);
    assert.deepEqual(cassetteIndex(cassette).lookup({ role: 'document', text: 'alpha' }), [1, 0]);
    assert.equal(index.lookup({ ...JINA, role: 'document', text: 'beta' }), null, 'a miss answers null, not a zero vector');
    assert.equal(index.misses.length, 1);
    assert.deepEqual({ role: index.misses[0].role, text: index.misses[0].text }, { role: 'document', text: 'beta' });
    assert.match(index.misses[0].key, /^e2:/);
    // Asking twice does not report the same missing input twice, because the report lists what to fill.
    index.lookup({ ...JINA, role: 'document', text: 'beta' });
    assert.equal(index.misses.length, 1);
    assert.equal(index.recordedCount, 1);
    // A vector at the wrong dimension is a named problem, not a score that quietly disappears.
    const odd = { ...cassette, vectors: { ...cassette.vectors,
        [cassetteEntryKey({ ...JINA, role: 'query', text: 'q' })]: [1, 0, 0] } };
    const mixed = cassetteIndex(odd);
    assert.equal(mixed.lookup({ ...JINA, role: 'query', text: 'q' }), null);
    assert.equal(mixed.misses.length, 0, 'it was recorded, so it is not a miss');
    assert.deepEqual(mixed.dimensionMismatches.map(row => ({ role: row.role, dim: row.dim, expected: row.expected })),
        [{ role: 'query', dim: 3, expected: 2 }]);
}

// --- 5. a legacy cache is readable, visibly unverified, and never silently promoted ---------------------
{
    const file = tmp('legacy.json');
    fs.writeFileSync(file, JSON.stringify({ model: JINA.model, base: JINA.base, task: 'retrieval.passage',
        vectors: { 'c:12345': [1, 0, 1], 'q:where' : [0, 1] } }));
    const legacy = readCassette(file);
    assert.equal(legacy.legacy, true);
    assert.equal(legacy.format, 'legacy/1');
    assert.equal(legacy.manifest.provenance, 'legacy-unverified');
    assert.equal(legacy.manifest.task.document, 'retrieval.passage');
    assert.match(describeCassette(legacy), /provenance legacy-unverified/);
    // Its keys do not name the request, so a request-keyed lookup misses even though the old key is there.
    const strict = cassetteIndex(legacy);
    assert.equal(strict.lookup({ ...JINA, role: 'query', text: 'where', legacyKey: 'q:where' }), null);
    assert.equal(strict.misses.length, 1);
    // Adoption is explicit, and the provenance still says the entry cannot vouch for its own request.
    const adopted = cassetteIndex(legacy, { adoptLegacy: true });
    assert.deepEqual(adopted.lookup({ ...JINA, role: 'query', text: 'where', legacyKey: 'q:where' }), [0, 1]);
    assert.equal(adopted.legacyCount, 1);
    assert.equal(adopted.provenance, 'legacy-unverified');
    assert.ok(adopted.vectorsFingerprint);
    assert.equal(cassetteIndex(legacy, { adoptLegacy: true }).lookup({ ...JINA, role: 'query', text: 'nowhere', legacyKey: 'q:nowhere' }), null);
    fs.rmSync(file, { force: true });
}

// --- 6. the identity of a measurement is the vectors it read, not the file it read them from -----------
{
    const a = createCassette(JINA);
    recordVector(a, { ...JINA, role: 'query', text: 'q' }, [1, 0]);
    const b = createCassette(JINA);
    recordVector(b, { ...JINA, role: 'query', text: 'q' }, [1, 0]);
    recordVector(b, { ...JINA, role: 'query', text: 'unused' }, [0, 1]);
    const ia = cassetteIndex(a), ib = cassetteIndex(b);
    ia.lookup({ ...JINA, role: 'query', text: 'q' });
    ib.lookup({ ...JINA, role: 'query', text: 'q' });
    assert.equal(ia.vectorsFingerprint, ib.vectorsFingerprint, 'a topped-up file with an unused entry is the same measurement');
    assert.notEqual(cassetteFingerprint(a.vectors), cassetteFingerprint(b.vectors), 'but the two files are not the same recording');
    const other = createCassette(JINA);
    recordVector(other, { ...JINA, role: 'query', text: 'q' }, [1, 0.5]);
    const io = cassetteIndex(other);
    io.lookup({ ...JINA, role: 'query', text: 'q' });
    assert.notEqual(ia.vectorsFingerprint, io.vectorsFingerprint, 'a changed vector is a changed measurement');
    assert.equal(cassetteIndex(a).vectorsFingerprint, null, 'a run that resolved nothing has no vector identity to compare');
}

console.log('PASS embedding cassette: entries keyed by the request, misses reported rather than degraded, legacy visible');
