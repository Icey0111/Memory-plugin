// The length certificate must rule without a model, so it is tested by construction: two projections
// over one store, one faithful and one broken in four specific ways, and the certificate has to name
// each break.
import assert from 'node:assert/strict';
import { lengthCertificate, formatCertificate, CERTIFICATE_PROTECTED_RANK } from './v55-certificate.js';
import { SPINE_VERSION } from './v55-spine.js';

const store = {
    version: '5.4',
    sequence: 4,
    slots: { a: 'm1', b: 'm2', c: 'm3' },
    memories: {
        m1: { id: 'm1', kind: 'commitment', slot: 'a', status: 'active', text: '林昭答应把黄铜怀表交给塞拉菲娜保管。' },
        m2: { id: 'm2', kind: 'knowledge', slot: 'b', status: 'active', text: '古井的毒是有人三天前投下的。', known_by: ['林昭'] },
        m3: { id: 'm3', kind: 'state', slot: 'c', status: 'active', text: '灰咳已经夺走七条性命。' },
        m4: { id: 'm4', kind: 'state', slot: 'c', status: 'superseded', text: '灰咳只在贫民区零星出现。' },
    },
    extractions: {},
    source_fingerprints: [],
    spine: {
        version: SPINE_VERSION,
        nodes: [
            { id: 'n1', seq: 1, slot: 'c', memory: 'm4', first: true },
            { id: 'n2', seq: 2, slot: 'c', memory: 'm3', previous: '灰咳只在贫民区零星出现。' },
        ],
        ledger: [],
        by_slot: { c: ['n1', 'n2'] },
        by_memory: {},
        first_by_slot: { c: 'm4' },
        seq: 2,
    },
};

const ACTOR = '塞拉菲娜';
const GOOD = '承诺：林昭答应把黄铜怀表交给塞拉菲娜保管。 灰咳已经夺走七条性命。 曾：灰咳只在贫民区零星出现。';
const BAD = '灰咳只在贫民区零星出现。 古井的毒是有人三天前投下的。';

const good = lengthCertificate(store, { projection: GOOD, actor: ACTOR });
const bad = lengthCertificate(store, { projection: BAD, actor: ACTOR });

// The faithful projection: everything the character may know is present, nothing false, the replaced
// endpoint is kept for the "why", and the secret she was never told stays out.
assert.equal(good.state.rate, 1, 'every permitted live slot value must be reachable: ' + formatCertificate(good));
assert.equal(good.soundness.violations, 0, 'no retired value may be rendered as live');
assert.equal(good.soundness.clean, true);
assert.equal(good.commitment.rate, 1, 'the irreversible commitment must survive');
assert.equal(good.epistemic.leaks, 0, 'a secret held only by another character must not be shown');
assert.equal(good.epistemic.checkable, 1, 'exactly one memory has an explicit holder set');
assert.equal(good.causal.rate, 1, 'both endpoints of the replaced slot must be present');

// The broken projection breaks four things at once, and each must be named separately rather than
// collapsing into one "bad" number.
assert.equal(bad.soundness.violations, 1, 'the retired value is rendered while the live one is absent');
assert.ok(bad.state.omitted.length >= 1, 'the live slot value is missing');
assert.equal(bad.commitment.missing.length, 1, 'the commitment was dropped');
assert.equal(bad.epistemic.leaks, 1, 'a memory the actor never learned was shown to them');
assert.equal(bad.epistemic.clean, false);

// Determinism: the same store and projection always produce the same ruling, which is the property a
// model judge cannot offer.
assert.deepEqual(lengthCertificate(store, { projection: GOOD, actor: ACTOR }), good);

// Without an actor the audit covers the whole cast, so nothing may be hidden.
const castWide = lengthCertificate(store, { projection: BAD });
assert.equal(castWide.epistemic.checkable, 0, 'no actor means no epistemic claim');

// The threshold is a fact about the spine, not a tolerance.
assert.equal(CERTIFICATE_PROTECTED_RANK, 4);
assert.ok(formatCertificate(bad).includes('stale=1'), formatCertificate(bad));

console.log('PASS v5.5 length certificate: sufficiency, soundness, commitment, epistemic leak and causal coverage ruled without a model');
