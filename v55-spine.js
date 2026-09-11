// Aetheria Unified Memory v5.5 — deterministic memory spine.
//
// S1 / S2 / S5 / S8. The spine is the only memory layer that is never produced by a language
// model. It is appended from the very same operations that already mutate the store, so a replay
// rebuilds it identically and it can never contradict a memory.
//
// It exists to answer one question no summary can answer: why is the world like this now?
// A summary says what happened. The spine says what changed, in what order, and what it replaced.
// Deterministic: no timestamp is stored, so a rebuilt spine is byte-identical to the original.

export const SPINE_VERSION = 1;
export const SPINE_KEY = 'spine';

// The spine is authoritative-but-BOUNDED state. It IS registered in DERIVED_KEYS, which keeps it out
// of the chat file while it remains a readable property on the live store object that
// mandatory-baseline, provenance and the prompt builder read.
//
// An earlier revision of the ownership guard stripped derived keys off the store object runtime
// readers see, which made a derived spine silently invisible. That revision is gone: the guard now
// projects the keys out at serialisation time instead of deleting them
// (installDerivedSerializationFilter in v55-derived-store.js), so the two are compatible.
//
// Measured on the live chat "Seraphina - 2026-09-11@20h22m03s183ms" with the external derived backend
// (tauritavern-extension-store) hydrated and SPINE_KEY present in DERIVED_KEYS: store.spine was an own
// property of the live store, carrying 50 nodes and 10 ledger entries, and spinePromptBlock produced
// 476 characters. The unresolved item in MEMORY_PLAN_2026.md is therefore closed in favour of the
// derived-store registration.
//
// The cost is bounded here rather than by an eviction policy: a recent window of nodes is kept and
// older ones dropped, while the durable per-slot history lives in the memories themselves
// (factHistory reads those, not this window).
const MAX_NODES = 300;
const MAX_LEDGER = 120;
const MAX_INDEX = 24;

/**
 * How irreversible a change of each kind is. This is deliberately not importance:
 * importance is a judgement about the story, irreversibility is a fact about the world.
 * A promise cannot be unmade; a location changes again next turn.
 */
export const IRREVERSIBILITY = Object.freeze({
    commitment: 5,
    relation: 4,
    ownership: 4,
    knowledge: 3,
    intention: 2,
    world_delta: 2,
    state: 1,
    belief: 1,
    event: 1,
});

/** At or above this rank a memory is injected unconditionally, whatever recall decides. */
export const NEVER_DROP_RANK = 4;

export const PROVENANCE_CHANNELS = Object.freeze(['saw', 'heard', 'told', 'inferred']);
const CHANNEL_SET = new Set(PROVENANCE_CHANNELS);

function clean(value, max = 200) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

export function openSpine(store, create = true) {
    if (!store || typeof store !== 'object') return null;
    let spine = store[SPINE_KEY];
    if (!spine || typeof spine !== 'object' || spine.version !== SPINE_VERSION || !Array.isArray(spine.nodes)) {
        if (!create) return null;
        spine = store[SPINE_KEY] = {
            version: SPINE_VERSION,
            seq: 0,
            nodes: [],
            ledger: [],
            by_slot: {},
            by_memory: {},
            first_by_slot: {},
        };
    }
    if (!Array.isArray(spine.nodes)) spine.nodes = [];
    if (!Array.isArray(spine.ledger)) spine.ledger = [];
    if (!spine.by_slot || typeof spine.by_slot !== 'object') spine.by_slot = {};
    if (!spine.by_memory || typeof spine.by_memory !== 'object') spine.by_memory = {};
    if (!spine.first_by_slot || typeof spine.first_by_slot !== 'object') spine.first_by_slot = {};
    if (!Number.isFinite(Number(spine.seq))) spine.seq = spine.nodes.length;
    return spine;
}

export function irreversibilityRank(memory) {
    const explicit = Number(memory?.irreversibility);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return IRREVERSIBILITY[String(memory?.kind || '')] ?? 1;
}

export function isNeverDrop(memory) {
    if (!memory || memory.status !== 'active' || !memory.text) return false;
    if (memory.importance === 'critical') return true;
    return irreversibilityRank(memory) >= NEVER_DROP_RANK;
}

export function mandatoryMemories(store, { limit = 24 } = {}) {
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    const spine = openSpine(store, false);
    const firstIds = spine ? new Set(Object.values(spine.first_by_slot)) : new Set();
    const rows = [];
    for (const memory of Object.values(memories)) {
        if (!memory || memory.status !== 'active' || !memory.text) continue;
        // A first occurrence is NOT itself a mandatory-baseline criterion. In this store almost every
        // fact owns a unique slot, so treating it as one would let the mandatory set grow without
        // bound and would trade invariant I1 for cost constraint C1. It is recorded in the spine, it
        // is exempt from schema merging, and here it only breaks ties.
        if (!isNeverDrop(memory)) continue;
        rows.push({
            memory,
            rank: irreversibilityRank(memory) + (memory.importance === 'critical' ? 1 : 0) + (firstIds.has(memory.id) ? 0.5 : 0),
        });
    }
    rows.sort((a, b) => b.rank - a.rank
        || Number(b.memory.source_message || 0) - Number(a.memory.source_message || 0));
    return rows.slice(0, Math.max(0, Number(limit) || 0)).map(row => row.memory);
}

export function provenanceChannel(op = {}, memoryLike = {}) {
    const explicit = clean(op.channel ?? memoryLike.channel, 16).toLowerCase();
    if (CHANNEL_SET.has(explicit)) return explicit;
    const text = String(memoryLike.text ?? op.text ?? '');
    const epistemic = String(memoryLike.epistemic ?? op.epistemic ?? '').toLowerCase();
    const kind = String(memoryLike.kind ?? op.kind ?? '');
    if (/(?:得知|听说|转述|告诉|告知|透露|提到过)/.test(text)) return 'told';
    if (/(?:推测|推断|怀疑|猜测|认为|觉得|以为|判断)/.test(text)
        || ['belief', 'inference', 'rumor'].includes(epistemic)) return 'inferred';
    if (['state', 'ownership', 'relation', 'commitment', 'world_delta', 'event'].includes(kind)) return 'saw';
    return 'heard';
}

function pushIndex(map, key, id) {
    if (!key) return;
    const list = Array.isArray(map[key]) ? map[key] : (map[key] = []);
    if (!list.includes(id)) list.push(id);
    if (list.length > MAX_INDEX) list.splice(0, list.length - MAX_INDEX);
}

function prune(spine) {
    const overflow = spine.nodes.length - MAX_NODES;
    if (overflow > 0) {
        const dropped = new Set(spine.nodes.splice(0, overflow).map(node => node.id));
        for (const map of [spine.by_slot, spine.by_memory]) {
            for (const key of Object.keys(map)) {
                const kept = map[key].filter(id => !dropped.has(id));
                if (kept.length) map[key] = kept; else delete map[key];
            }
        }
    }
    if (spine.ledger.length > MAX_LEDGER) spine.ledger.splice(0, spine.ledger.length - MAX_LEDGER);
}

export function appendSpine(store, records, context = {}) {
    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (!list.length) return null;
    const spine = openSpine(store, true);
    if (!spine) return null;
    const source = Number(context.sourceMessageIndex);
    const msg = Number.isFinite(source) ? source : null;
    const slots = new Set();
    let created = 0;
    let supersedes = 0;

    for (const record of list) {
        const op = clean(record.op, 24) || 'unknown';
        const slot = clean(record.slot, 160) || null;
        const memoryId = clean(record.memory_id, 80) || null;
        const targetId = clean(record.target_id, 80) || null;
        const kind = clean(record.kind, 32) || null;

        let first = false;
        if (slot && memoryId && !spine.first_by_slot[slot]) {
            spine.first_by_slot[slot] = memoryId;
            first = true;
        }

        const id = 'n_' + (++spine.seq);
        const node = {
            id,
            seq: spine.seq,
            msg,
            op,
            kind,
            slot,
            memory: memoryId,
            target: targetId,
            replaced: clean(record.superseded_by, 80) || null,
            // The value this node replaced. `update` rewrites a record in place, so the previous value
            // has no other carrier anywhere in the store.
            previous: clean(record.prev_text, 240) || null,
            first,
        };
        spine.nodes.push(node);
        pushIndex(spine.by_slot, slot, id);
        pushIndex(spine.by_memory, memoryId, id);
        pushIndex(spine.by_memory, targetId, id);
        if (slot) slots.add(slot);
        if (memoryId) created += 1;
        if (targetId || record.superseded_by) supersedes += 1;
    }

    spine.ledger.push({
        seq: spine.seq,
        msg,
        ops: list.length,
        created,
        supersedes,
        slots: [...slots].slice(0, MAX_INDEX),
    });
    prune(spine);
    return { nodes: list.length, created, supersedes };
}

/** Every node that touched a slot or a memory, expanded transitively along supersede links. */
export function spineTrace(store, { slot, memoryId } = {}) {
    const spine = openSpine(store, false);
    if (!spine) return [];
    const wanted = new Set();
    const slotKey = clean(slot, 160);
    const memoryKey = clean(memoryId, 80);
    if (slotKey) for (const id of spine.by_slot[slotKey] || []) wanted.add(id);
    if (memoryKey) for (const id of spine.by_memory[memoryKey] || []) wanted.add(id);

    for (let round = 0; round < 4; round += 1) {
        let grew = false;
        for (const node of spine.nodes) {
            if (!wanted.has(node.id)) continue;
            const anchors = [node.memory, node.target, node.replaced].filter(Boolean);
            for (const other of spine.nodes) {
                if (wanted.has(other.id)) continue;
                const linked = anchors.some(anchor => other.memory === anchor || other.target === anchor || other.replaced === anchor);
                if (linked) { wanted.add(other.id); grew = true; }
            }
        }
        if (!grew) break;
    }
    return spine.nodes.filter(node => wanted.has(node.id)).sort((a, b) => a.seq - b.seq);
}

/** The full value history of one slot, read from the memories themselves. */
export function factHistory(store, slot) {
    const key = clean(slot, 160);
    if (!key) return [];
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    const spine = openSpine(store, false);
    // Values an in-place `update` overwrote. They are not memory records any more, but they are the only
    // surviving statement of what the slot held before, and "how did it get like this" is unanswerable
    // without them.
    const previous = new Map();
    if (spine) {
        for (const node of spine.nodes) {
            if (node.slot !== key || !node.previous) continue;
            const owner = node.memory || node.target || null;
            const list = previous.get(owner) || [];
            list.push({ seq: node.seq, text: node.previous });
            previous.set(owner, list);
        }
    }
    return Object.values(memories)
        .filter(memory => memory && memory.slot === key)
        .sort((a, b) => Number(a.created_seq || 0) - Number(b.created_seq || 0))
        .map(memory => ({
            id: memory.id,
            text: memory.text,
            status: memory.status,
            supersedes: memory.supersedes || null,
            superseded_by: memory.superseded_by || null,
            at: memory.recorded_at ?? null,
            previous: (previous.get(memory.id) || []).sort((a, b) => a.seq - b.seq).map(entry => entry.text),
        }));
}

export function spineStats(store) {
    const spine = openSpine(store, false);
    if (!spine) return { nodes: 0, ledger: 0, slots: 0, chains: 0, first_occurrences: 0 };
    let chains = 0;
    for (const node of spine.nodes) if (node.target || node.replaced) chains += 1;
    return {
        nodes: spine.nodes.length,
        ledger: spine.ledger.length,
        slots: Object.keys(spine.by_slot).length,
        chains,
        first_occurrences: Object.keys(spine.first_by_slot).length,
    };
}

/**
 * A compact block listing only slots that actually changed, so the model can see that a value was
 * replaced rather than only what the value is now. Bounded by construction.
 */
export function spinePromptBlock(store, { maxChars = 600, maxRows = 10 } = {}) {
    const spine = openSpine(store, false);
    if (!spine || !spine.nodes.length) return '';
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    const bySlot = new Map();
    for (const node of spine.nodes) {
        if (!node.slot) continue;
        const entry = bySlot.get(node.slot) || { slot: node.slot, changes: 0, latest: null, previous: [] };
        entry.changes += 1;
        if (node.previous) entry.previous.push(node.previous);
        entry.latest = node;
        bySlot.set(node.slot, entry);
    }
    const rows = [];
    for (const entry of bySlot.values()) {
        if (entry.changes < 2) continue;
        const owner = store.slots?.[entry.slot];
        const current = owner ? memories[owner] : null;
        if (!current || current.status !== 'active' || !current.text) continue;
        rows.push({ entry, current, rank: irreversibilityRank(current) + (current.importance === 'critical' ? 1 : 0) });
    }
    if (!rows.length) return '';
    rows.sort((a, b) => b.rank - a.rank || Number(b.current.source_message || 0) - Number(a.current.source_message || 0));
    const budget = Math.max(120, Number(maxChars) || 600);
    const header = '[记忆变更链 — 以下是「被替换过」的槽位当前值,不是历史对话]';
    const lines = [header];
    let used = header.length + 2;
    for (const row of rows.slice(0, Math.max(1, Number(maxRows) || 10))) {
        // The replaced values, not just the fact that a change happened. "已变更 2 次" alone cannot answer
        // "how did it get like this". Two carriers, because the store has two ways to replace a value:
        // a retired memory on the same slot (what an `add` over an occupied slot leaves behind) and the
        // `previous` text the spine keeps (what an in-place `update` would otherwise erase). Ordered so
        // the chain reads oldest -> newest, then bounded to three endpoints and 220 characters.
        const retired = Object.values(memories)
            .filter(memory => memory && memory.slot === row.entry.slot && memory.id !== row.current.id && memory.text)
            .sort((a, b) => Number(a.created_seq || 0) - Number(b.created_seq || 0))
            .map(memory => memory.text);
        const replaced = [...retired, ...row.entry.previous]
            .slice(-3).map(value => clean(value, 90)).join(' -> ').slice(0, 220);
        const line = '- [' + (row.current.kind || 'state') + '] ' + row.entry.slot + ' (已变更 ' + row.entry.changes + ' 次)'
            + (replaced ? ' 曾: ' + replaced + ' ->' : '')
            + ' 当前: ' + clean(row.current.text, 160);
        if (used + line.length + 1 > budget && lines.length > 1) break;
        lines.push(line);
        used += line.length + 1;
    }
    return lines.length > 1 ? lines.join('\n') : '';
}

/** Diagnostics only: the traced chain for one slot, rendered for a developer panel. */
export function spineTraceText(store, slot, { maxRows = 6 } = {}) {
    return spineTrace(store, { slot }).slice(-Math.max(1, maxRows)).map(node => {
        const parts = [node.op];
        if (node.kind) parts.push(node.kind);
        if (node.memory) parts.push(node.memory);
        if (node.target) parts.push('<-' + node.target);
        if (node.first) parts.push('first');
        return '#' + node.seq + ' ' + parts.join(' ');
    }).join('\n');
}
