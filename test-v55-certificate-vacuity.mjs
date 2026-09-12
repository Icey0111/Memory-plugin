// Two of this certificate's six dimensions can be unexercised on real data while still reading as a
// pass, and this file exists because that was observed rather than imagined.
//
// Measured on a live 51-assistant-floor chat (101 rows, 217 active memories): known_by is empty on
// EVERY memory. So the epistemic dimension examined nothing and returned clean: true, and T-Causal -
// which declares four question kinds - generated 40 cases that were all 'why' (9) and 'who_first' (31).
// 'who_unknown' needs a holder set and 'no_stale' needs a supersession, so neither ran.
//
// An instrument that cannot tell 'nothing leaked' from 'nothing was checked' is not measuring. The
// certificate is this project's substitute for a model judge, so the distinction has to survive.
import assert from 'node:assert/strict';
import { applyMemoryOps, createEmptyStore } from './memory-core.js';
import { lengthCertificate, formatCertificate } from './v55-certificate.js';
import { TCAUSAL_KINDS } from './v55-tcausal.js';

function build(ops) {
    let store = createEmptyStore();
    ops.forEach((op, i) => {
        store = applyMemoryOps(store, [op], { sourceMessageIndex: i, sourceMessageText: op.text }).store;
    });
    return store;
}

// 1. Nothing carries a holder set, so nothing can leak and nothing can be checked.
{
    const store = build([
        { op: 'add', kind: 'state', slot: '甲.location.current', text: '甲位于钟楼二层。', entities: ['甲'] },
        { op: 'add', kind: 'commitment', slot: '甲.commitment.wait', text: '甲答应在钟楼等乙。', entities: ['甲', '乙'] },
    ]);
    const cert = lengthCertificate(store, { projection: '', actor: '甲' });
    assert.equal(cert.epistemic.checkable, 0, 'no memory declares a holder set');
    assert.equal(cert.epistemic.checked, false, 'so the dimension is not checked');
    assert.equal(cert.epistemic.clean, null, 'and it must NOT report clean - nothing was examined');
    const line = formatCertificate(cert);
    assert.ok(line.includes('leak=not-checked'), 'the line says so plainly: ' + line);
    assert.ok(!line.includes('leak=0/0'), 'and never renders an unexamined zero as a pass: ' + line);
}

// 2. Once a holder set exists the dimension runs and reports a boolean again.
{
    const store = build([
        { op: 'add', kind: 'knowledge', slot: '乙.knowledge.secret', text: '乙把井沿的凿痕告诉了甲。', entities: ['甲', '乙'], known_by: ['甲'] },
    ]);
    const cert = lengthCertificate(store, { projection: '', actor: '甲' });
    assert.ok(cert.epistemic.checkable >= 1, 'a memory with a holder set is checkable');
    assert.equal(cert.epistemic.checked, true);
    assert.equal(typeof cert.epistemic.clean, 'boolean', 'a checked dimension reports a verdict, not null');
    assert.ok(formatCertificate(cert).includes('leak=' + cert.epistemic.leaks + '/' + cert.epistemic.checkable));
}

// 3. The T-Causal score names the question kinds that produced no cases at all.
{
    const store = build([
        { op: 'add', kind: 'state', slot: '甲.location.current', text: '甲位于钟楼二层。', entities: ['甲'] },
    ]);
    const cert = lengthCertificate(store, { projection: '', actor: '甲' });
    assert.ok(Array.isArray(cert.tcausal.unexercised), 'unexercised kinds are reported');
    for (const kind of cert.tcausal.unexercised) {
        assert.ok(TCAUSAL_KINDS.includes(kind), 'only declared kinds can be unexercised: ' + kind);
        assert.ok(!(cert.tcausal.by_kind || {})[kind], kind + ' produced no case, so it has no tally');
    }
    assert.ok(cert.tcausal.unexercised.includes('who_unknown'),
        'no memory has a holder set, so who-does-not-know cannot be asked');
    assert.ok(formatCertificate(cert).includes('unexercised='), 'and the summary line surfaces it');
}

// 4. A holder set is what puts who_unknown back to work, which is the coupling the live store broke.
{
    const store = build([
        { op: 'add', kind: 'knowledge', slot: '乙.knowledge.secret', text: '乙把井沿的凿痕告诉了甲。', entities: ['甲', '乙'], known_by: ['甲'] },
    ]);
    const cert = lengthCertificate(store, { projection: '', actor: '甲' });
    assert.ok(!cert.tcausal.unexercised.includes('who_unknown'),
        'a memory with a holder set must produce a who-does-not-know case');
    assert.ok((cert.tcausal.by_kind || {}).who_unknown.total >= 1, 'and it must be counted');
}

// 5. Every declared kind is accounted for: either it produced a case or it is named as unexercised.
{
    const store = build([
        { op: 'add', kind: 'state', slot: '甲.location.current', text: '甲位于钟楼二层。', entities: ['甲'] },
        { op: 'add', kind: 'knowledge', slot: '乙.knowledge.secret', text: '乙把井沿的凿痕告诉了甲。', entities: ['甲', '乙'], known_by: ['甲'] },
    ]);
    const cert = lengthCertificate(store, { projection: '', actor: '甲' });
    for (const kind of TCAUSAL_KINDS) {
        const ran = ((cert.tcausal.by_kind || {})[kind] || {}).total > 0;
        const named = cert.tcausal.unexercised.includes(kind);
        assert.ok(ran !== named, kind + ' must be either exercised or named, never both and never neither');
    }
}

console.log('PASS v5.5 certificate vacuity: an unexamined dimension is reported as unchecked, not as clean');
