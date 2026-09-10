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

export function pruneColdTurns(store, maxChars = DEFAULT_COLD_MAX_CHARS) {
    const cold = coldTurnsOf(store);
    const cap = Math.max(1000, Number(maxChars) || DEFAULT_COLD_MAX_CHARS);
    let removed = 0;
    while (cold.chars > cap && cold.order.length > 1) {
        const key = cold.order.shift();
        const row = cold.turns[key];
        if (row) cold.chars = Math.max(0, cold.chars - coldCost(row));
        delete cold.turns[key];
        removed += 1;
    }
    return { removed, chars: cold.chars, turns: cold.order.length };
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

export function formatEvidenceBlock(entriesInput, { maxChars = 4000 } = {}) {
    const entries = Array.isArray(entriesInput) ? entriesInput : [];
    if (!entries.length) return '';
    const cap = Math.max(400, Math.min(24000, Number(maxChars) || 4000));
    const lines = ['[MEMORY EVIDENCE — ORIGINAL TEXT, RESOLVED ON DEMAND]'];
    let used = lines[0].length;
    for (const entry of entries) {
        const label = `${entry.memoryId || entry.key || 'memory'} · ${entry.source === 'live' ? 'live' : 'cold-snapshot'}`;
        for (const turn of entry.turns || []) {
            const line = `- [${label}] ${turn.role === 'user' ? 'USER' : 'ASSISTANT'}: ${turn.text}`;
            if (used + line.length + 1 > cap) return lines.join('\n');
            lines.push(line);
            used += line.length + 1;
        }
    }
    return lines.join('\n');
}