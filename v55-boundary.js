// Aetheria Unified Memory v5.5 — A2: deterministic scene-boundary detection.
//
// The plan (dev_docs/MEMORY_PLAN_2026.md section 3, A2) asks for a replacement for AIRP's `scene/ended`
// event, because SillyTavern has no director and never emits one. Hard constraint 2 forbids depending on
// an explicit boundary, so it has to be inferred from what the memory system already holds:
//
//   1. hard boundary  - the location changed, or the participant set changed completely. Pure
//                       determinism over slot names and the participants the turn's memories name.
//   2. soft boundary  - the turn made an irreversible change (a commitment, a relation, an ownership, a
//                       knowledge record). The world can no longer be put back, so it is a new scene
//                       even if everyone stayed in the same room.
//   3. floor beat     - the fallback the plan insists on keeping. It is deliberately the LAST resort:
//                       a detector that never fires must degrade to today's behaviour, never below it.
//
// Nothing here calls a model, reads a clock, or mutates the store. The output is an ordered list of
// boundaries; every consumer (the digest, the compression budget, the diagnostics panel) treats a
// missing boundary as "beat", so a detector failure is indistinguishable from the old behaviour.

import { NEVER_DROP_RANK, irreversibilityRank, openSpine } from './v55-spine.js';

export const BOUNDARY_VERSION = 1;
export const BOUNDARY_KINDS = Object.freeze(['hard', 'soft', 'beat']);
export const DEFAULT_BEAT = 10;

/** A slot whose value answers "where are we", so a change of it is a change of scene. */
const LOCATION_SLOT = /(?:^|[._-])(?:location|place|scene|where|position)(?:$|[._-])|地点|位置|场所|所在|当前地点|场景/i;

/** Slots that enumerate who is present. A change here is a change of cast. */
const PARTICIPANT_SLOT = /(?:^|[._-])(?:participants?|cast|present|company)(?:$|[._-])|参与者|在场|同行/i;

function clean(value, max = 200) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

function memoryOf(store, id) {
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    return id ? memories[id] || null : null;
}

/**
 * Everything the spine recorded for one assistant turn, resolved against the memory records.
 * `msg` on a spine node is the assistant index the extraction ran for, so this is a direct join and
 * never a heuristic. A turn with no extraction simply yields an empty reading.
 */
export function readTurn(store, assistantIndex) {
    const spine = openSpine(store, false);
    const index = Number(assistantIndex);
    const reading = { assistant_index: index, slots: [], irreversibles: [], participants: new Set(), worldDelta: false };
    if (!spine || !Number.isFinite(index)) return reading;
    for (const node of spine.nodes) {
        if (Number(node.msg) !== index) continue;
        const memory = memoryOf(store, node.memory) || memoryOf(store, node.target);
        reading.slots.push({
            slot: clean(node.slot, 160) || null,
            op: node.op,
            kind: clean(node.kind, 32) || clean(memory?.kind, 32) || null,
            memory: node.memory || null,
            supersedes: Boolean(node.target || node.replaced),
            text: clean(memory?.text, 200),
        });
        if (node.kind === 'world_delta' || memory?.kind === 'world_delta') reading.worldDelta = true;
        if (memory) {
            for (const who of Array.isArray(memory.known_by) ? memory.known_by : []) {
                const name = clean(who, 60);
                if (name) reading.participants.add(name);
            }
            const rank = irreversibilityRank(memory);
            if (rank >= NEVER_DROP_RANK || memory.importance === 'critical') {
                reading.irreversibles.push({ slot: clean(memory.slot, 160) || null, kind: clean(memory.kind, 32) || null, rank, importance: clean(memory.importance, 16) || null });
            }
        }
    }
    return reading;
}

function disjoint(a, b) {
    if (!a.size || !b.size) return false;
    for (const value of a) if (b.has(value)) return false;
    return true;
}

function locationChanged(prev, next) {
    const locationOps = next.slots.filter(entry => entry.slot && LOCATION_SLOT.test(entry.slot));
    if (!locationOps.length) return null;
    const before = new Map();
    for (const entry of prev.slots) if (entry.slot && LOCATION_SLOT.test(entry.slot)) before.set(entry.slot, entry.text);
    for (const entry of locationOps) {
        const previous = before.get(entry.slot);
        if (previous === undefined || previous !== entry.text) return { slot: entry.slot, from: previous ?? null, to: entry.text };
    }
    return null;
}

function participantChanged(prev, next) {
    const explicit = next.slots.some(entry => entry.slot && PARTICIPANT_SLOT.test(entry.slot)) && next.slots.length > 0;
    if (explicit) return { reason: 'participant-slot', added: [...next.participants].slice(0, 6) };
    if (disjoint(prev.participants, next.participants)) {
        return { reason: 'participant-set', from: [...prev.participants].slice(0, 6), to: [...next.participants].slice(0, 6) };
    }
    return null;
}

/**
 * One boundary per turn that starts a new scene, oldest first.
 *
 * `turns` is what collectCompletedDialogueTurns() returns. The first turn is always a boundary: a chat
 * opens somewhere, and its opening floor is the start of the first scene by definition.
 */
export function detectBoundaries(store, turns, { beat = DEFAULT_BEAT } = {}) {
    const rows = Array.isArray(turns) ? turns : [];
    const step = Math.max(1, Math.floor(Number(beat) || DEFAULT_BEAT));
    const out = [];
    let previous = { slots: [], participants: new Set(), irreversibles: [] };
    let sinceBoundary = 0;
    rows.forEach((turn, position) => {
        const index = Number(turn?.assistant_index);
        const reading = readTurn(store, index);
        if (position === 0) {
            out.push({ turn: index, position, kind: 'hard', reason: 'chat-open', detail: null });
            previous = reading;
            sinceBoundary = 0;
            return;
        }
        sinceBoundary += 1;
        const location = locationChanged(previous, reading);
        if (location) {
            out.push({ turn: index, position, kind: 'hard', reason: 'location-changed', detail: location });
            previous = reading;
            sinceBoundary = 0;
            return;
        }
        const participants = participantChanged(previous, reading);
        if (participants) {
            out.push({ turn: index, position, kind: 'hard', reason: 'participants-changed', detail: participants });
            previous = reading;
            sinceBoundary = 0;
            return;
        }
        if (reading.irreversibles.length) {
            out.push({ turn: index, position, kind: 'soft', reason: 'irreversible-change', detail: { changes: reading.irreversibles.slice(0, 4) } });
            previous = reading;
            sinceBoundary = 0;
            return;
        }
        if (reading.worldDelta) {
            out.push({ turn: index, position, kind: 'soft', reason: 'world-delta', detail: null });
            previous = reading;
            sinceBoundary = 0;
            return;
        }
        if (sinceBoundary >= step) {
            out.push({ turn: index, position, kind: 'beat', reason: 'floor-beat', detail: { floors: sinceBoundary } });
            previous = reading;
            sinceBoundary = 0;
            return;
        }
        previous = reading;
    });
    return out;
}

/** Scene segments: every turn with the boundary that opened its segment. */
export function segmentByBoundary(store, turns, options = {}) {
    const rows = Array.isArray(turns) ? turns : [];
    const boundaries = detectBoundaries(store, rows, options);
    const byPosition = new Map(boundaries.map(entry => [entry.position, entry]));
    const segments = [];
    rows.forEach((turn, position) => {
        const opener = byPosition.get(position);
        if (opener || !segments.length) {
            segments.push({ opener: opener || { turn: Number(turn?.assistant_index), position, kind: 'hard', reason: 'chat-open', detail: null }, turns: [] });
        }
        segments[segments.length - 1].turns.push(turn);
    });
    return segments;
}

export function boundaryStats(store, turns, options = {}) {
    const boundaries = detectBoundaries(store, turns, options);
    const counts = { hard: 0, soft: 0, beat: 0 };
    for (const entry of boundaries) counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    const segments = segmentByBoundary(store, turns, options);
    const sizes = segments.map(segment => segment.turns.length);
    return {
        version: BOUNDARY_VERSION,
        turns: Array.isArray(turns) ? turns.length : 0,
        boundaries: boundaries.length,
        counts,
        // The share of boundaries that had to fall back to the floor beat. The plan's degradation rule
        // is "a failed detector is never worse than the beat", so this number is the honest measure of
        // how much the detectors actually bought.
        beat_share: boundaries.length ? counts.beat / boundaries.length : null,
        segments: segments.length,
        largest_segment: sizes.length ? Math.max(...sizes) : 0,
        mean_segment: sizes.length ? Number((sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2)) : 0,
        reasons: boundaries.reduce((acc, entry) => { acc[entry.reason] = (acc[entry.reason] || 0) + 1; return acc; }, {}),
    };
}
