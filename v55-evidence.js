// Aetheria Unified Memory v5.5 — cold turn snapshot + on-demand original-text expansion.
//
// Derived memories keep pointers (source_key / source_message) but the plugin never owned the
// original wording. This module (a) snapshots each extracted turn into chat metadata so an edit
// or delete cannot destroy the only copy, and (b) resolves a memory back to its original text on
// demand, including a text protocol the model may emit:
//
//   【查阅记忆】
//   对象：林舟
//   事项：此前的承诺
//
// The host parses that block, resolves it against the live chat first and the cold snapshot
// second, and returns bounded original-text evidence for the next generation.
//
// Both halves are optional and neither is load-bearing: canonical memory (memory-core.js) does not
// import this module and does not read cold_turns, so with `cold_turn_snapshot_enabled` and
// `memory_evidence_enabled` both off the plugin still extracts, stores, summarizes and recalls. That
// is deliberate — a path that only works when the model chooses to speak is the failure mode this
// project was warned about, so it is allowed to be a supplement and nothing more.

import { computeDialoguePairFingerprint, isDialogueRow, lexicalSearchMemories, normalizeStore } from './memory-core.js';
import { planColdForgetting } from './v55-forget.js';

export const EVIDENCE_VERSION = '5.5-ev1';
export const LOOKUP_MARKER = '【查阅记忆】';
export const DEFAULT_COLD_MAX_CHARS = 200000;

const clean = (value, max = 20000) => String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

export function emptyColdTurns() {
    return { version: 1, turns: {}, order: [], chars: 0 };
}

// Mutates the caller's store in place: callers persist the same object they hand in, and a copy
// (from normalizeStore) would silently drop the snapshot.
export function coldTurnsOf(store) {
    const target = store && typeof store === 'object' ? store : {};
    const cold = target.cold_turns && typeof target.cold_turns === 'object' && !Array.isArray(target.cold_turns)
        ? target.cold_turns
        : emptyColdTurns();
    if (!cold.turns || typeof cold.turns !== 'object' || Array.isArray(cold.turns)) cold.turns = {};
    if (!Array.isArray(cold.order)) cold.order = [];
    if (!Number.isFinite(Number(cold.chars))) cold.chars = 0;
    cold.version = 1;
    target.cold_turns = cold;
    return cold;
}

function coldCost(row) {
    return String(row?.user_text || '').length + String(row?.assistant_text || '').length + 64;
}

/**
 * Trim the cold store to a character budget under the A6 rule: evict what can be rebuilt, never what
 * cannot. Eviction used to be `order.shift()` - pure arrival order - which deleted the opening floors
 * first, and the opening floors are where first occurrences and the first commitments live. A protected
 * entry is never selected: if only protected entries remain, the cap is exceeded on purpose and
 * `over_budget` says so, because a commitment lost to save characters cannot be recovered.
 */
export function pruneColdTurns(store, maxChars = DEFAULT_COLD_MAX_CHARS, { byReconstructability = true } = {}) {
    const cold = coldTurnsOf(store);
    const cap = Math.max(1000, Number(maxChars) || DEFAULT_COLD_MAX_CHARS);
    if (byReconstructability === false) {
        // The previous behaviour, kept switchable: pure arrival order up to the cap.
        let removed = 0;
        while (cold.chars > cap && cold.order.length > 1) {
            const key = cold.order.shift();
            const row = cold.turns[key];
            if (row) cold.chars = Math.max(0, cold.chars - coldCost(row));
            delete cold.turns[key];
            removed += 1;
        }
        return { removed, chars: cold.chars, turns: cold.order.length, pinned: 0, over_budget: false };
    }
    const plan = planColdForgetting(store, { maxChars: cap, cost: coldCost });
    for (const key of plan.drop_keys) delete cold.turns[key];
    if (plan.drop_keys.length) {
        const dropped = new Set(plan.drop_keys);
        cold.order = cold.order.filter(key => !dropped.has(key));
    }
    cold.chars = cold.order.reduce((sum, key) => sum + (cold.turns[key] ? coldCost(cold.turns[key]) : 0), 0);
    return { removed: plan.drop_keys.length, chars: cold.chars, turns: cold.order.length, pinned: plan.pinned, over_budget: plan.over_budget };
}

export function recordColdTurn(store, turn, { maxChars = DEFAULT_COLD_MAX_CHARS } = {}) {
    const key = clean(turn?.source_key, 300);
    if (!key) return { recorded: false, reason: 'no-source-key', chars: 0 };
    const cold = coldTurnsOf(store);
    const row = {
        source_key: key,
        fingerprint: turn?.fingerprint ?? null,
        assistant_index: Number.isFinite(Number(turn?.assistantIndex)) ? Number(turn.assistantIndex) : null,
        user_index: Number.isFinite(Number(turn?.userIndex)) ? Number(turn.userIndex) : null,
        user_text: clean(turn?.userText, 16000),
        assistant_text: clean(turn?.assistantText, 32000),
        recorded_at: Number(turn?.at) || Date.now(),
    };
    const previous = cold.turns[key];
    if (previous) {
        cold.chars = Math.max(0, cold.chars - coldCost(previous));
        cold.order = cold.order.filter(existing => existing !== key);
    }
    cold.turns[key] = row;
    cold.order.push(key);
    cold.chars += coldCost(row);
    const prune = pruneColdTurns(store, maxChars);
    return { recorded: true, key, chars: cold.chars, pruned: prune.removed };
}

export function getColdTurn(storeInput, sourceKey) {
    const cold = storeInput?.cold_turns;
    if (!cold || typeof cold !== 'object' || !cold.turns || typeof cold.turns !== 'object') return null;
    return cold.turns[clean(sourceKey, 300)] || null;
}

function readLivePair(chat, assistantIndex, expectedHash) {
    const rows = Array.isArray(chat) ? chat : [];
    const assistant = rows[assistantIndex];
    if (!assistant || assistant.is_user || !isDialogueRow(assistant)) return null;
    const pair = computeDialoguePairFingerprint(rows, assistantIndex);
    if (!pair) return null;
    if (expectedHash !== null && expectedHash !== undefined && Number(pair.hash) !== Number(expectedHash)) return null;
    const turns = [];
    if (Number.isInteger(pair.userIndex) && pair.userIndex >= 0) {
        turns.push({ role: 'user', index: pair.userIndex, text: clean(rows[pair.userIndex]?.mes, 12000) });
    }
    turns.push({ role: 'assistant', index: assistantIndex, text: clean(assistant.mes, 24000) });
    return turns.filter(turn => turn.text);
}

function findExtractionRecord(store, memory, sourceKey) {
    if (sourceKey && store.extractions?.[sourceKey]) return store.extractions[sourceKey];
    if (!memory) return null;
    for (const row of Object.values(store.extractions || {})) {
        if (!row || typeof row !== 'object') continue;
        const sameHash = row.source_hash !== undefined && memory.source_hash !== undefined
            && Number(row.source_hash) === Number(memory.source_hash);
        const sameIndex = Number(row.assistant_index_at_creation) === Number(memory.source_message);
        if (sameHash && sameIndex) return row;
    }
    return null;
}

export function expandMemoryEvidence(storeInput, chatInput, { memoryId = null, sourceKey = null, maxChars = 4000 } = {}) {
    const store = normalizeStore(storeInput);
    const chat = Array.isArray(chatInput) ? chatInput : [];
    const memory = memoryId ? (store.memories?.[memoryId] || null) : null;
    let key = clean(sourceKey, 300) || clean(memory?.source_key, 300) || null;
    const record = findExtractionRecord(store, memory, key);
    if (!key && record?.source_key) key = record.source_key;
    const assistantIndex = Number(memory?.source_message ?? record?.assistant_index_at_creation);
    const expectedHash = memory?.source_hash ?? record?.source_hash ?? null;
    const limit = Math.max(200, Math.min(24000, Number(maxChars) || 4000));
    const base = {
        key,
        memoryId: memory?.id ?? null,
        assistantIndex: Number.isFinite(assistantIndex) ? assistantIndex : null,
        expectedHash: expectedHash === null || expectedHash === undefined ? null : Number(expectedHash),
        maxChars: limit,
    };
    if (Number.isFinite(assistantIndex)) {
        const live = readLivePair(chat, assistantIndex, expectedHash);
        if (live) return { ...base, ok: true, source: 'live', stale: false, turns: live, chars: live.reduce((n, t) => n + t.text.length, 0) };
    }
    const cold = key ? getColdTurn(store, key) : null;
    if (cold) {
        const turns = [];
        if (cold.user_text) turns.push({ role: 'user', index: cold.user_index, text: cold.user_text });
        if (cold.assistant_text) turns.push({ role: 'assistant', index: cold.assistant_index, text: cold.assistant_text });
        if (turns.length) return { ...base, ok: true, source: 'cold', stale: true, turns, chars: turns.reduce((n, t) => n + t.text.length, 0) };
    }
    return { ...base, ok: false, reason: 'no-evidence', source: 'missing', stale: true, turns: [], chars: 0 };
}

export function parseMemoryLookupRequests(text) {
    const src = String(text ?? '');
    const out = [];
    let at = src.indexOf(LOOKUP_MARKER);
    while (at >= 0 && out.length < 3) {
        const rest = src.slice(at + LOOKUP_MARKER.length);
        const stop = rest.search(/\n\s*\n|【/);
        const body = (stop >= 0 ? rest.slice(0, stop) : rest).slice(0, 600).trim();
        const object = (body.match(/(?:对象|object)\s*[:：]\s*(.+)/i) || [])[1];
        const item = (body.match(/(?:事项|item|query)\s*[:：]\s*(.+)/i) || [])[1];
        const objectText = clean(object, 200);
        const itemText = clean(item, 300);
        if (objectText || itemText) out.push({ object: objectText, item: itemText, raw: body, at });
        at = src.indexOf(LOOKUP_MARKER, at + LOOKUP_MARKER.length);
    }
    return out;
}

export function resolveMemoryLookupRequests(storeInput, chatInput, text, { perRequest = 2, maxChars = 4000, maxEntries = 4 } = {}) {
    const requests = parseMemoryLookupRequests(text);
    if (!requests.length) return { requests: [], entries: [] };
    const store = normalizeStore(storeInput);
    const entries = [];
    const seen = new Set();
    const cap = Math.max(1, Number(maxEntries) || 4);
    for (const request of requests) {
        const query = clean([request.object, request.item].filter(Boolean).join(' '), 500);
        if (!query) continue;
        const hits = lexicalSearchMemories(store, query, { limit: Math.max(1, Math.min(5, Number(perRequest) || 2)) });
        for (const hit of hits) {
            const expanded = expandMemoryEvidence(store, chatInput, { memoryId: hit.memory?.id, maxChars });
            const dedupe = `${expanded.memoryId || ''}|${expanded.source}|${expanded.turns[0]?.index ?? ''}`;
            if (!expanded.ok || seen.has(dedupe)) continue;
            seen.add(dedupe);
            entries.push({ ...expanded, request, score: Number(hit.score) || 0 });
            if (entries.length >= cap) break;
        }
        if (entries.length >= cap) break;
    }
    return { requests, entries };
}


/**
 * Entity names the turn mentions that the registry tracks. Used only to decide whether silence is
 * acceptable: a turn full of tracked names that resolved to nothing is exactly when a model invents.
 */
function unmatchedRegistryNames(store, query) {
    const text = String(query || '').toLowerCase();
    const names = [];
    for (const row of Object.values(store.entity_registry || {})) {
        const name = clean(row?.canonical_name, 60);
        if (!name || name.length < 2) continue;
        if (!text.includes(name.toLowerCase())) continue;
        if (names.includes(name)) continue;
        names.push(name);
        if (names.length >= 6) break;
    }
    return names;
}

/**
 * The deterministic half of the same resolution.
 *
 * `resolveMemoryLookupRequests` answers the model when it asks. THIS asks on the model's behalf, from the
 * turn itself, because a retrieval path whose trigger is the model choosing to speak is the failure mode
 * this project was warned about: a model writes 【查阅记忆】 only when it already suspects it has forgotten
 * something, which is precisely the case it cannot detect. Measured on the live tree, that marker was the
 * only route by which original text ever reached the prompt.
 *
 * The trigger is computed and generous, per the failure asymmetry this system runs on - a missed retrieval
 * is unrecoverable within the turn, a spurious one costs characters. It is deliberately not gated on a
 * score: it takes the turn's own lexical neighbours, drops anything the prompt already shows verbatim,
 * and resolves the rest to original text.
 *
 * Abstention is the other half of the same function. When the turn names entities the registry tracks and
 * not one of them resolves to any memory, the block says so rather than injecting nothing - silence is
 * what leaves the model free to invent, and `abstained` is reported separately so a caller can tell
 * 'nothing found' from 'nothing to find'.
 */
export function resolveTurnEvidence(storeInput, chatInput, { maxEntries = 3, maxChars = 3000, alreadyVisible = '', protectRecent = 0, lookback = 2 } = {}) {
    const store = normalizeStore(storeInput);
    const rows = Array.isArray(chatInput) ? chatInput : [];
    const dialogue = rows.filter(row => isDialogueRow(row) && String(row?.mes || '').trim());
    const query = clean(dialogue.slice(-Math.max(1, lookback)).map(row => String(row.mes)).join('\n'), 4000);
    if (!query) return { query: '', considered: 0, entries: [], abstained: false, unmatched: [] };
    const visible = String(alreadyVisible || '');
    const hits = lexicalSearchMemories(store, query, { limit: 12, protectRecent, chatLength: rows.length });
    const entries = [];
    const seenMemories = new Set();
    const seenTurns = new Set();
    for (const hit of hits) {
        const memory = hit.memory;
        if (!memory?.id || seenMemories.has(memory.id)) continue;
        seenMemories.add(memory.id);
        // What the prompt already carries is a duplicate, not evidence.
        const head = clean(memory.text, 24);
        if (head && visible.includes(head)) continue;
        const expanded = expandMemoryEvidence(store, rows, { memoryId: memory.id, maxChars });
        if (!expanded.ok) continue;
        const dedupe = expanded.source + '|' + String(expanded.turns?.[0]?.index ?? '');
        if (seenTurns.has(dedupe)) continue;
        seenTurns.add(dedupe);
        entries.push({ ...expanded, score: Number(hit.score) || 0 });
        if (entries.length >= Math.max(1, Number(maxEntries) || 3)) break;
    }
    // Read the registry off the caller's store as well as the normalised copy: normalisation is a reader's
    // convenience and the registry is written by stampRuntimeIdentity straight onto the chat store.
    const registry = (storeInput && typeof storeInput === 'object' && storeInput.entity_registry)
        || store.entity_registry
        || {};
    const unmatched = entries.length ? [] : unmatchedRegistryNames({ entity_registry: registry }, query);
    return { query, considered: hits.length, entries, abstained: entries.length === 0 && unmatched.length > 0, unmatched };
}

export function formatEvidenceBlock(entriesInput, { maxChars = 4000, heading = null, abstained = false, unmatched = [], alreadyVisible = '' } = {}) {
    const entries = Array.isArray(entriesInput) ? entriesInput : [];
    const cap = Math.max(400, Math.min(24000, Number(maxChars) || 4000));
    if (!entries.length) {
        // Abstention. Saying nothing is not neutral - it leaves the model free to fill the gap, which is
        // the one outcome the record exists to prevent. Naming what could not be found is the honest
        // answer, and it is bounded to a single line.
        const names = (Array.isArray(unmatched) ? unmatched : []).map(name => clean(name, 40)).filter(Boolean).slice(0, 6);
        if (!abstained || !names.length) return '';
        const note = '[MEMORY ABSTENTION — THE RECORD HAS NOTHING FOR THIS TURN] No stored memory or original '
            + 'text resolved for: ' + names.join('、') + '. Their current state is unknown; say so rather than '
            + 'inventing it.';
        return note.slice(0, Math.max(200, Math.min(1200, cap)));
    }
    const visible = String(alreadyVisible || '');
    const lines = [heading || '[MEMORY EVIDENCE — ORIGINAL TEXT, RESOLVED ON DEMAND]'];
    let used = lines[0].length;
    let dropped = 0;
    for (const entry of entries) {
        const label = `${entry.memoryId || entry.key || 'memory'} · ${entry.source === 'live' ? 'live' : 'cold-snapshot'}`;
        for (const turn of entry.turns || []) {
            const body = clean(turn.text, 24000);
            // resolveTurnEvidence screens candidates by the first 24 characters of the MEMORY text, but what
            // actually reaches the prompt is this expanded TURN text, which the memory summary never
            // contains. Measured over a 20-turn live run: 31,310 evidence characters injected, 8,529 of
            // them (27%) already present verbatim in the reference or state block, and the worst single
            // turn repeating 70% of itself. Comparing the line that is about to be emitted is the only
            // place the two texts can actually be compared.
            if (visible && body.length > 20 && visible.includes(body)) { dropped += 1; continue; }
            const line = `- [${label}] ${turn.role === 'user' ? 'USER' : 'ASSISTANT'}: ${body}`;
            if (used + line.length + 1 > cap) return lines.join('\n');
            lines.push(line);
            used += line.length + 1;
        }
    }
    // Every candidate was already on screen. Emitting the bare heading would advertise evidence that is
    // not there, so this reports nothing at all rather than a label with no content under it.
    if (lines.length === 1 && dropped > 0) return '';
    return lines.join('\n');
}