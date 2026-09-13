// The runtime precheck must fail closed on the stale-module condition this acceptance run recorded.
//
// The 421757c run had a page whose loaded parseAnchorChanges still contained the pre-421757c subject cap
// ("ANCHOR_SUBJECT_MAX" / "bad_subject") while every deployed file matched the repo. The disk check alone
// read clean. These cases pin the comparison that catches it; when the recorded evidence is present they
// also assert the fixture mirrors that run.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fingerprint, diffLoaded, fnv1a } from './runtime-precheck.mjs';

const NAME = 'raw-history.js#parseAnchorChanges';
const match = { [NAME]: 'function parseAnchorChanges(lines, opts){ return []; }' };
assert.deepEqual(diffLoaded(fingerprint(match), fingerprint(match)), [], 'identical sources are not a finding');

// The exact stale signature: a loaded module from before 421757c still carries the subject cap.
const stale = 'function parseAnchorChanges(lines, opts){ const ANCHOR_SUBJECT_MAX = 20;'
    + ' if (subject.length > ANCHOR_SUBJECT_MAX) { fail(line, "bad_subject", subject); continue; } }';
const current = 'function parseAnchorChanges(lines, opts){ /* 421757c removed the subject cap */ }';
const diffs = diffLoaded(fingerprint({ [NAME]: current }), fingerprint({ [NAME]: stale }));
assert.equal(diffs.length, 1, 'the stale loaded module is a finding');
assert.equal(diffs[0].name, NAME);
assert.notEqual(diffs[0].disk, diffs[0].loaded);

// A watched function missing from the loaded module is a mismatch, never a pass.
assert.equal(diffLoaded(fingerprint({ [NAME]: current }), {}).length, 1);
assert.equal(fnv1a('abc'), fnv1a('abc'));

// The local evidence this fixture mirrors. Skipped when the ignored acceptance directory is absent.
const evidence = 'remove/acceptance-anchor-semantics-421757c/raw2/set2.meta.json';
if (existsSync(evidence)) {
    assert.match(readFileSync(evidence, 'utf8'), /bad_subject/,
        'the fixture mirrors the stale runtime this acceptance run recorded');
}

console.log('runtime-precheck: ok');
