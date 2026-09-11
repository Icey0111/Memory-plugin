// Aetheria Unified Memory v5.5 — the length certificate.
//
// The research conclusion this implements (dev_docs/15_innovation_path.md): the field cannot rule on
// its own memory designs because its only measuring device is a model judge, and model judges are
// unreliable. This instrument rules without a judge. Every number below is derived by string and
// identifier comparison over the store and the injected projection; no model is called, so the same
// store and projection always produce the same certificate.
//
// It answers six questions about one generation's projection:
//
//   state       - is every live slot value reachable from the projection?       (sufficiency)
//   soundness   - is a retired value rendered as if it were live?              (soundness)
//   commitment  - did an irreversible claim survive?                            (safety)
//   epistemic   - was the character told something they never learned?           (fiction)
//   causal      - does a replaced slot keep both endpoints?                      (explainability)
//   cost        - how many tokens did the projection spend?                      (economy)
//
// "Sufficiency" is deliberately defined over a finite, checkable question set built from the store
// itself. Free-form character behaviour has no deterministic check, so the certificate does not claim
// to cover it; that limit is stated rather than hidden.

import { buildTcausalCases, scoreTcausal } from './v55-tcausal.js';
import { openSpine } from './v55-spine.js';
import { estimateTokens } from './v55-tokenizer.js';

export const CERTIFICATE_VERSION = 1;
export const CERTIFICATE_QUESTIONS = Object.freeze(['state', 'soundness', 'commitment', 'epistemic', 'causal', 'cost']);
/** The fragment length used to decide whether a memory is reachable from a projection. */
export const CERTIFICATE_MATCH_CHARS = 24;
/** The irreversibility rank at or above which a claim may never be dropped. Mirrors the spine's NEVER_DROP_RANK. */
export const CERTIFICATE_PROTECTED_RANK = 4;

const IRREVERSIBILITY = Object.freeze({
    commitment: 5, relation: 4, ownership: 4, knowledge: 3,
    intention: 2, world_delta: 2, state: 1, belief: 1, event: 1,
});

function collapse(value) {
    return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function fragment(text) {
    const flat = collapse(text);
    return flat.slice(0, Math.min(CERTIFICATE_MATCH_CHARS, flat.length));
}

function memoriesOf(store) {
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    return Object.values(memories).filter(memory => memory && memory.text);
}

function contains(haystack, needle) {
    return Boolean(needle) && haystack.includes(needle);
}

/**
 * Build the certificate for one projection.
 *
 * @param store      the canonical store (ground truth for what the architecture knows)
 * @param projection the exact text that was injected into the model this generation
 * @param actor      the character whose knowledge bounds the projection (optional)
 * @param cases      pre-built T-Causal cases; built from the store when omitted
 */
export function lengthCertificate(store, { projection = '', actor = null, cases = null, limit = 40 } = {}) {
    const text = collapse(projection);
    const list = memoriesOf(store);
    const live = list.filter(memory => memory.status === 'active');
    const spine = openSpine(store, false);

    // Sufficiency and safety are judged against what THIS character is permitted to know. A secret
    // correctly withheld from the actor would otherwise be scored as an omission, which would reward
    // leaking it. Auditing the whole cast is a different question, asked by omitting `actor`.
    const permitted = live.filter(memory => !actor
        || !Array.isArray(memory.known_by) || !memory.known_by.length
        || memory.known_by.includes(actor));

    // state — sufficiency. A live slot value that the projection does not carry is an omission: the
    // model cannot use what it was never given.
    const liveSlots = permitted.filter(memory => memory.slot);
    const omitted = liveSlots.filter(memory => !contains(text, fragment(memory.text)));

    // soundness — a retired value presented as current. Only counted when the projection carries the
    // retired text AND does not carry the live text for the same slot, which is the actual failure.
    const liveBySlot = new Map(liveSlots.map(memory => [memory.slot, memory]));
    const staleRendered = [];
    for (const memory of list) {
        if (memory.status === 'active' || !memory.slot) continue;
        if (!contains(text, fragment(memory.text))) continue;
        const current = liveBySlot.get(memory.slot);
        if (current && contains(text, fragment(current.text))) continue;
        staleRendered.push(memory.id);
    }

    // commitment — irreversible claims must survive the projection.
    const protectedRows = permitted.filter(memory => (IRREVERSIBILITY[memory.kind] || 0) >= CERTIFICATE_PROTECTED_RANK
        || (Array.isArray(memory.known_by) && memory.known_by.length));
    const commitmentMissing = protectedRows.filter(memory => !contains(text, fragment(memory.text)));

    // epistemic — a memory whose holder set is explicit and excludes the actor must not be shown to it.
    const epistemicCheckable = actor
        ? live.filter(memory => Array.isArray(memory.known_by) && memory.known_by.length)
        : [];
    const leaks = actor
        ? epistemicCheckable.filter(memory => !memory.known_by.includes(actor) && contains(text, fragment(memory.text)))
        : [];

    // causal — a slot with a replaced value must keep both endpoints to answer "why is it now like this".
    let causalTotal = 0;
    let causalComplete = 0;
    if (spine) {
        for (const [slot, nodeIds] of Object.entries(spine.by_slot || {})) {
            if (nodeIds.length < 2) continue;
            causalTotal += 1;
            const current = liveBySlot.get(slot);
            if (!current || !contains(text, fragment(current.text))) continue;
            const prior = spine.nodes.filter(node => node.slot === slot && node.previous)
                .map(node => fragment(node.previous)).filter(Boolean);
            if (prior.some(frag => contains(text, frag))) causalComplete += 1;
        }
    }

    const scored = scoreTcausal(store, cases || buildTcausalCases(store, { limit }), {
        scope: 'injected', injectedText: text, available: true,
    });

    const rate = (good, total) => (total ? Number((good / total).toFixed(4)) : null);
    return {
        version: CERTIFICATE_VERSION,
        actor,
        tokens: estimateTokens(text),
        chars: text.length,
        memories: { total: list.length, live: live.length },
        state: { total: liveSlots.length, reachable: liveSlots.length - omitted.length, omitted: omitted.map(m => m.id), rate: rate(liveSlots.length - omitted.length, liveSlots.length) },
        soundness: { violations: staleRendered.length, ids: staleRendered, clean: staleRendered.length === 0 },
        commitment: { total: protectedRows.length, retained: protectedRows.length - commitmentMissing.length, missing: commitmentMissing.map(m => m.id), rate: rate(protectedRows.length - commitmentMissing.length, protectedRows.length) },
        epistemic: { checkable: epistemicCheckable.length, leaks: leaks.length, ids: leaks.map(m => m.id), clean: leaks.length === 0 },
        causal: { total: causalTotal, complete: causalComplete, rate: rate(causalComplete, causalTotal) },
        tcausal: { total: scored.total, hit: scored.hit, violations: scored.violations, rate: scored.rate },
    };
}

/** One line per certificate, for the run log. Plain words, no identifiers. */
export function formatCertificate(row) {
    if (!row) return 'certificate: none';
    const pct = value => (value === null ? 'n/a' : Math.round(value * 100) + '%');
    return [
        'certificate v' + row.version,
        'tokens=' + row.tokens,
        'state=' + row.state.reachable + '/' + row.state.total + ' (' + pct(row.state.rate) + ')',
        'stale=' + row.soundness.violations,
        'commitment=' + row.commitment.retained + '/' + row.commitment.total + ' (' + pct(row.commitment.rate) + ')',
        'leak=' + row.epistemic.leaks + '/' + row.epistemic.checkable,
        'causal=' + row.causal.complete + '/' + row.causal.total,
        'tcausal=' + (row.tcausal.hit === null ? 'n/a' : row.tcausal.hit + '/' + row.tcausal.total) + ' violations=' + row.tcausal.violations,
    ].join(' ');
}
