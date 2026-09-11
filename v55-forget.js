// Aetheria Unified Memory v5.5 — A6: forget by reconstructability, never by arrival order.
//
// The plan (section 3, A6) states the rule in one line:
//
//   anything that can be rebuilt from the spine (plus a schema) may be dropped;
//   anything that cannot - commitments, puzzles, identity, first occurrences - is never dropped.
//
// What the plugin actually did was a character cap with FIFO eviction: `cold_turns` was pruned by
// `maxChars` in arrival order, so the entry that got destroyed was simply the oldest one, regardless of
// whether anything else could still tell that part of the story. On a long chat the first floors - which
// is where first occurrences and the opening commitments live - were the first to go.
//
// This module makes the rule executable and gives the decision a name. It is deliberately conservative:
// when nothing can be rebuilt the budget loses, because a fact that is gone cannot be recovered while a
// cache that is too large only costs memory.
//
// It is also the other half of A2/A4: a boundary marks where the story stops being continuous, and a
// reconstructibility rank says which records the boundaries and the digest cannot rebuild.

export const FORGET_VERSION = 1;

/**
 * How rebuildable a record of this kind is, 0 = cannot be rebuilt at all, 4 = trivially rebuilt.
 *
 * The order follows the plan's own irreversible list (commitment > relation/ownership > knowledge) and
 * adds the observation that a `state` or `event` is the most rebuildable thing in the store: its
 * current value is in the slot map and its history is in the spine change chain, so the record itself is
 * a convenience. A `commitment` has no other carrier anywhere.
 */
export const RECONSTRUCTIBILITY = Object.freeze({
    commitment: 0,
    relation: 1,
    ownership: 1,
    knowledge: 2,
    intention: 2,
    belief: 3,
    world_delta: 3,
    state: 4,
    event: 4,
});

/** Above this rank a record may be evicted to satisfy a budget; at or below it, the budget yields. */
export const PROTECTED_RANK = 2;

function clean(value, max = 200) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * The rank of one memory. `critical` importance is never dropped, whatever its kind.
 *
 * A first occurrence is deliberately NOT pinned here, for the reason the plan itself recorded in
 * section 8.1 about S5: "first occurrence" is computed per slot, and in this store almost every record
 * owns a unique slot - measured 41 of 43 - so pinning every first occurrence pins everything and the
 * budget becomes unenforceable. The same trap, one layer down. `first` is therefore a tie-breaker
 * inside a rank (evict a repeat before a first), never a protection on its own.
 */
export function reconstructibilityOf(memory) {
    if (!memory) return 4;
    if (memory.importance === 'critical') return 0;
    const rank = RECONSTRUCTIBILITY[String(memory.kind || '')];
    return Number.isFinite(rank) ? rank : 2;
}

export function isProtected(store, memory, { first = false } = {}) {
    void store;
    return reconstructibilityOf(memory, { first }) <= PROTECTED_RANK;
}

function spineFirstIds(store) {
    const spine = store?.spine;
    if (!spine || typeof spine !== 'object' || !spine.first_by_slot) return new Set();
    return new Set(Object.values(spine.first_by_slot));
}

/**
 * What still depends on one cold-store entry. A cold entry is keyed by `source_key`; the memories it
 * backs are the ones whose `source_message` is the same assistant index. No dependent memory means
 * nothing is lost when the entry goes, which is the cheapest thing to evict.
 */
export function evidenceDependents(store, coldRow) {
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    const index = Number(coldRow?.assistant_index);
    if (!Number.isFinite(index)) return [];
    return Object.values(memories).filter(memory => memory && Number(memory.source_message) === index);
}

export function evidenceReconstructibility(store, coldRow) {
    const dependents = evidenceDependents(store, coldRow);
    if (!dependents.length) return { rank: 4, dependents: 0, protected: false, first: false, reason: 'no-dependent-memory' };
    const firstIds = spineFirstIds(store);
    let rank = 4;
    let protectedBy = null;
    let first = false;
    for (const memory of dependents) {
        const value = reconstructibilityOf(memory);
        if (value < rank) rank = value;
        if (value <= PROTECTED_RANK && !protectedBy) protectedBy = memory.kind + (memory.importance === 'critical' ? '/critical' : '');
        if (firstIds.has(memory.id)) first = true;
    }
    return { rank, dependents: dependents.length, protected: rank <= PROTECTED_RANK, first, reason: protectedBy || 'rebuildable-from-spine' };
}

/**
 * Choose what to drop from the cold store.
 *
 * Eviction order: most reconstructible first (rank 4 before rank 3 ...), and within a rank the oldest
 * first, so the choice is deterministic and a re-run makes the same decision. Protected entries are
 * never selected; if only protected entries remain the cap is exceeded on purpose and `over_budget` is
 * reported, because losing a commitment to save characters is the trade this project refuses to make.
 */
export function planColdForgetting(store, { maxChars = 0, cost = null } = {}) {
    const cold = store?.cold_turns;
    const rows = cold && typeof cold === 'object' && !Array.isArray(cold) ? cold : null;
    const order = Array.isArray(rows?.order) ? rows.order : [];
    const turns = rows?.turns && typeof rows.turns === 'object' ? rows.turns : {};
    const weigh = typeof cost === 'function'
        ? cost
        : row => String(row?.user_text || '').length + String(row?.assistant_text || '').length + 64;
    const cap = Math.max(0, Number(maxChars) || 0);
    let chars = order.reduce((sum, key) => sum + (turns[key] ? weigh(turns[key]) : 0), 0);
    const candidates = [];
    let pinned = 0;
    order.forEach((key, position) => {
        const row = turns[key];
        if (!row) return;
        const verdict = evidenceReconstructibility(store, row);
        if (verdict.protected) { pinned += 1; return; }
        // `first` only breaks a tie inside a rank: a repeat of a known situation goes before the one
        // that introduced it, but neither is protected by that fact alone.
        candidates.push({ key, position, rank: verdict.rank, first: verdict.first, size: weigh(row) });
    });
    // Most reconstructible first, then a repeat before a first occurrence, then oldest first.
    candidates.sort((a, b) => b.rank - a.rank || Number(a.first) - Number(b.first) || a.position - b.position);
    const dropped = [];
    for (const candidate of candidates) {
        if (chars <= cap) break;
        dropped.push(candidate);
        chars -= candidate.size;
    }
    return {
        version: FORGET_VERSION,
        cap,
        chars_before: order.reduce((sum, key) => sum + (turns[key] ? weigh(turns[key]) : 0), 0),
        chars_after: Math.max(0, chars),
        over_budget: Math.max(0, chars - cap) > 0,
        total: order.length,
        pinned,
        droppable: candidates.length,
        drop_keys: dropped.map(entry => entry.key),
        drop_ranks: dropped.map(entry => entry.rank),
    };
}

/** Diagnostics: how the cold store is distributed across reconstructibility ranks. */
export function forgettingStats(store) {
    const cold = store?.cold_turns;
    const order = Array.isArray(cold?.order) ? cold.order : [];
    const turns = cold?.turns && typeof cold.turns === 'object' ? cold.turns : {};
    const histogram = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    let pinned = 0;
    for (const key of order) {
        const row = turns[key];
        if (!row) continue;
        const verdict = evidenceReconstructibility(store, row);
        histogram[verdict.rank] = (histogram[verdict.rank] || 0) + 1;
        if (verdict.protected) pinned += 1;
    }
    return { version: FORGET_VERSION, entries: order.length, chars: Number(cold?.chars) || 0, pinned, histogram };
}
