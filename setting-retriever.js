// Aetheria Unified Memory v5.5 — Relevant Setting Retrieval (pure core).
//
// This module builds generation/extraction queries and fuses local lexical +
// dense SettingChunk candidates. It is host-agnostic: SillyTavern network I/O
// remains in index.js. Setting data and story history are deliberately kept in
// separate retrieval channels.

import { normalizeBaselineText } from './baseline-index.js';

export const SETTING_RETRIEVER_VERSION = '5.5-e1';

function cleanText(value, maxChars = 8000) {
    const text = String(value ?? '')
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!text) return '';
    const max = Math.max(1, Number(maxChars) || 8000);
    return text.length > max ? text.slice(-max) : text;
}

function uniqueStrings(values, limit = 24) {
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const text = cleanText(value, 240);
        if (!text) continue;
        const key = normalizeBaselineText(text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= limit) break;
    }
    return out;
}

function isAssistantRow(row) {
    return Boolean(row && row.is_user !== true && !row.is_system && cleanText(row.mes, 10_000));
}

function isUserRow(row) {
    return Boolean(row && row.is_user === true && !row.is_system && cleanText(row.mes, 10_000));
}

function latestIndex(rows, predicate, before = Infinity) {
    for (let i = Math.min(rows.length - 1, Number.isFinite(before) ? before - 1 : rows.length - 1); i >= 0; i--) {
        if (predicate(rows[i])) return i;
    }
    return -1;
}

function collectActiveEntities(activeMemories, querySeed = '') {
    const seed = normalizeBaselineText(querySeed).replace(/\s+/g, '');
    const preferred = [];
    const fallback = [];
    for (const memory of Array.isArray(activeMemories) ? activeMemories : []) {
        for (const entity of Array.isArray(memory?.entities) ? memory.entities : []) {
            const value = cleanText(entity, 160);
            if (!value) continue;
            const norm = normalizeBaselineText(value).replace(/\s+/g, '');
            if (norm.length >= 2 && seed.includes(norm)) preferred.push(value);
            else if (['state', 'commitment', 'intention', 'relation', 'knowledge'].includes(memory?.kind)) fallback.push(value);
        }
    }
    return uniqueStrings([...preferred, ...fallback], 14);
}

function activeLocations(activeMemories) {
    const rows = [];
    for (const memory of Array.isArray(activeMemories) ? activeMemories : []) {
        const slot = String(memory?.slot || '').toLowerCase();
        const topics = (memory?.topics || []).map(x => String(x).toLowerCase());
        if (/\.location\.(?:current|active)|location\.current|\.travel\.(?:destination|current)/.test(slot)
            || topics.some(topic => /地点|位置|location|场所|区域/.test(topic))) {
            rows.push(memory.text);
        }
    }
    return uniqueStrings(rows, 4);
}

function activeObjectives(activeMemories) {
    return uniqueStrings(
        (Array.isArray(activeMemories) ? activeMemories : [])
            .filter(memory => memory?.status === 'active' && ['commitment', 'intention'].includes(memory?.kind))
            .map(memory => memory.text),
        8,
    );
}

function activeSlots(activeMemories) {
    return uniqueStrings(
        (Array.isArray(activeMemories) ? activeMemories : [])
            .filter(memory => memory?.status === 'active' && memory?.slot)
            .map(memory => `${memory.slot}: ${memory.text}`),
        12,
    );
}

function joinSections(sections, maxChars = 10_000) {
    const rows = sections
        .filter(section => section && cleanText(section.text, maxChars))
        .map(section => `[${section.label}]\n${cleanText(section.text, maxChars)}`);
    return cleanText(rows.join('\n\n'), maxChars);
}

export function buildGenerationSettingQuery({
    chat = [],
    activeMemories = [],
    activeState = '',
    maxChars = 10_000,
} = {}) {
    const rows = Array.isArray(chat) ? chat : [];
    const lastUserIndex = latestIndex(rows, isUserRow);
    const lastUser = lastUserIndex >= 0 ? cleanText(rows[lastUserIndex]?.mes, 4200) : '';
    const previousAssistantIndex = lastUserIndex >= 0
        ? latestIndex(rows, isAssistantRow, lastUserIndex)
        : latestIndex(rows, isAssistantRow);
    const previousAssistant = previousAssistantIndex >= 0 ? cleanText(rows[previousAssistantIndex]?.mes, 1800) : '';
    const seed = `${lastUser}\n${previousAssistant}`;
    const entities = collectActiveEntities(activeMemories, seed);
    const locations = activeLocations(activeMemories);
    const objectives = activeObjectives(activeMemories);
    const state = cleanText(activeState, 1800);
    const text = joinSections([
        { label: 'LAST USER', text: lastUser },
        { label: 'PREVIOUS ASSISTANT', text: previousAssistant },
        { label: 'CURRENT SCENE ENTITIES', text: entities.join(' / ') },
        { label: 'ACTIVE LOCATION', text: locations.join('\n') },
        { label: 'OPEN COMMITMENTS / OBJECTIVES', text: objectives.join('\n') },
        { label: 'CURRENT STATE HINT', text: state },
    ], maxChars);
    return {
        mode: 'generation',
        text,
        components: {
            last_user: lastUser,
            previous_assistant: previousAssistant,
            scene_entities: entities,
            active_locations: locations,
            open_objectives: objectives,
            current_state_hint: state,
        },
    };
}

export function buildExtractionSettingQuery({
    userText = '',
    assistantText = '',
    activeMemories = [],
    currentState = '',
    maxChars = 12_000,
} = {}) {
    const user = cleanText(userText, 5000);
    const assistant = cleanText(assistantText, 7000);
    const pair = `${user}\n${assistant}`;
    const entities = collectActiveEntities(activeMemories, pair);
    const slots = activeSlots(activeMemories);
    const state = cleanText(currentState, 1800);
    const text = joinSections([
        { label: 'CURRENT USER', text: user },
        { label: 'CURRENT ASSISTANT', text: assistant },
        { label: 'AFFECTED / CURRENT ENTITIES', text: entities.join(' / ') },
        { label: 'CURRENT STATE SLOTS', text: slots.join('\n') },
        { label: 'CURRENT STATE HINT', text: state },
    ], maxChars);
    return {
        mode: 'extraction',
        text,
        components: {
            user,
            assistant,
            affected_entities: entities,
            current_slots: slots,
            current_state_hint: state,
        },
    };
}

export function mapDenseSettingMetadata(snapshotInput, metadataInput) {
    const snapshot = snapshotInput || {};
    const chunks = Array.isArray(snapshot.chunks) ? snapshot.chunks : [];
    const byHash = new Map(chunks.map((chunk, index) => [Number(chunk.vector_hash), { chunk, index }]));
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(metadataInput) ? metadataInput : []) {
        const index = Number(row?.index);
        let hit = Number.isInteger(index) && index >= 0 && index < chunks.length
            ? { chunk: chunks[index], index }
            : null;
        if (!hit && Number.isFinite(Number(row?.hash))) hit = byHash.get(Number(row.hash)) || null;
        if (!hit || seen.has(hit.chunk.chunk_id)) continue;
        seen.add(hit.chunk.chunk_id);
        out.push({
            chunk: hit.chunk,
            index: hit.index,
            score: Number.isFinite(Number(row?.score)) ? Number(row.score) : null,
            metadata: row,
        });
    }
    return out;
}

function reconstructParentContent(chunks) {
    return (Array.isArray(chunks) ? chunks : [])
        .slice()
        .sort((a, b) => Number(a.chunk_index || 0) - Number(b.chunk_index || 0))
        .map(chunk => cleanText(chunk.body_text, 100_000))
        .filter(Boolean)
        .join('\n')
        .trim();
}

function parentRows(snapshotInput) {
    const chunks = Array.isArray(snapshotInput?.chunks) ? snapshotInput.chunks : [];
    const map = new Map();
    for (const chunk of chunks) {
        if (!map.has(chunk.entry_id)) map.set(chunk.entry_id, []);
        map.get(chunk.entry_id).push(chunk);
    }
    return map;
}

export function fuseSettingCandidates(snapshotInput, {
    lexical = [],
    dense = [],
    rrfK = 60,
    lexicalWeight = 1,
    denseWeight = 1,
    topEntries = 8,
    maxChars = 12_000,
} = {}) {
    const snapshot = snapshotInput || {};
    const allParents = parentRows(snapshot);
    const byChunk = new Map();
    const k = Math.max(1, Number(rrfK) || 60);
    const add = (row, channel, rank, weight) => {
        const chunk = row?.chunk;
        if (!chunk?.chunk_id) return;
        const current = byChunk.get(chunk.chunk_id) || {
            chunk,
            score: 0,
            channels: [],
            channel_scores: {},
        };
        current.score += Math.max(0, Number(weight) || 0) / (k + rank + 1);
        if (!current.channels.includes(channel)) current.channels.push(channel);
        current.channel_scores[channel] = Number.isFinite(Number(row?.score)) ? Number(row.score) : null;
        byChunk.set(chunk.chunk_id, current);
    };
    (Array.isArray(lexical) ? lexical : []).forEach((row, rank) => add(row, 'lexical', rank, lexicalWeight));
    (Array.isArray(dense) ? dense : []).forEach((row, rank) => add(row, 'dense', rank, denseWeight));

    const byEntry = new Map();
    for (const row of byChunk.values()) {
        const id = row.chunk.entry_id;
        const current = byEntry.get(id) || {
            entry_id: id,
            revision_id: row.chunk.revision_id,
            revision_kind: row.chunk.revision_kind,
            source_id: row.chunk.source_id,
            source_entry_id: row.chunk.source_entry_id,
            title: row.chunk.title,
            comment: row.chunk.comment,
            keys: [...(row.chunk.keys || [])],
            secondary_keys: [...(row.chunk.secondary_keys || [])],
            constant: Boolean(row.chunk.constant),
            order: row.chunk.order,
            score: 0,
            chunk_scores: [],
            channels: [],
            matched_chunks: [],
        };
        current.chunk_scores.push(row.score);
        for (const channel of row.channels) if (!current.channels.includes(channel)) current.channels.push(channel);
        current.matched_chunks.push({
            chunk_id: row.chunk.chunk_id,
            chunk_index: row.chunk.chunk_index,
            body_text: row.chunk.body_text,
            retrieval_text: row.chunk.retrieval_text,
            score: row.score,
            channels: [...row.channels],
        });
        byEntry.set(id, current);
    }

    const ranked = [...byEntry.values()]
        .map(row => {
            row.matched_chunks.sort((a, b) => b.score - a.score || a.chunk_index - b.chunk_index);
            const support = row.chunk_scores.slice().sort((a, b) => b - a);
            // Parent entries with many chunks must not win merely by accumulating many weak hits.
            // Use the best child as the main signal and only small, capped support from the next two.
            row.score = (support[0] || 0) + (support[1] || 0) * 0.25 + (support[2] || 0) * 0.10;
            delete row.chunk_scores;
            const parentChunks = allParents.get(row.entry_id) || [];
            row.content = reconstructParentContent(parentChunks);
            row.parent_chunk_count = parentChunks.length;
            return row;
        })
        .sort((a, b) => b.score - a.score
            || Number(Boolean(b.constant)) - Number(Boolean(a.constant))
            || Number(a.order ?? Number.POSITIVE_INFINITY) - Number(b.order ?? Number.POSITIVE_INFINITY)
            || String(a.entry_id).localeCompare(String(b.entry_id)));

    const limit = Math.max(0, Math.min(100, Number(topEntries) || 8));
    const charCap = Math.max(1000, Math.min(100_000, Number(maxChars) || 12_000));
    const selected = [];
    const dropped = [];
    let used = 0;
    for (const row of ranked) {
        if (selected.length >= limit) {
            dropped.push(row.entry_id);
            continue;
        }
        const estimate = cleanText(row.content, 100_000).length + cleanText(row.title, 500).length + 80;
        if (selected.length && used + estimate > charCap) {
            dropped.push(row.entry_id);
            continue;
        }
        selected.push(row);
        used += estimate;
    }

    const constantEntries = [];
    const seenConstants = new Set();
    for (const chunk of Array.isArray(snapshot.chunks) ? snapshot.chunks : []) {
        if (!chunk.constant || seenConstants.has(chunk.entry_id)) continue;
        seenConstants.add(chunk.entry_id);
        const parentChunks = allParents.get(chunk.entry_id) || [];
        constantEntries.push({
            entry_id: chunk.entry_id,
            revision_id: chunk.revision_id,
            revision_kind: chunk.revision_kind,
            title: chunk.title,
            comment: chunk.comment,
            keys: [...(chunk.keys || [])],
            constant: true,
            order: chunk.order,
            content: reconstructParentContent(parentChunks),
        });
    }
    constantEntries.sort((a, b) => Number(a.order ?? Number.POSITIVE_INFINITY) - Number(b.order ?? Number.POSITIVE_INFINITY));

    return {
        results: selected,
        constant_entries: constantEntries,
        dropped_entry_ids: dropped,
        candidate_entry_count: ranked.length,
        used_chars: used,
    };
}

function rowContext(row, maxBodyChars = 3200) {
    const title = cleanText(row?.title || row?.comment || row?.entry_id, 500) || '未命名设定';
    const keys = uniqueStrings([...(row?.keys || []), ...(row?.secondary_keys || [])], 16);
    const body = cleanText(row?.content || row?.matched_chunks?.[0]?.body_text || '', maxBodyChars);
    return `- [${row?.revision_kind || 'baseline'}:${title}${row?.constant ? ':constant' : ''}]${keys.length ? ` keys=${keys.join('/')}` : ''}\n${body}`;
}

export function formatRelevantSettingContext(retrievalInput, {
    maxChars = 7000,
    constantLimit = 2,
    includeConstants = true,
} = {}) {
    const retrieval = retrievalInput || {};
    const relevant = Array.isArray(retrieval.results) ? retrieval.results : [];
    const constants = includeConstants
        ? (Array.isArray(retrieval.constant_entries) ? retrieval.constant_entries : []).slice(0, Math.max(0, Number(constantLimit) || 0))
        : [];
    const rows = [];
    const seen = new Set();
    for (const row of [...constants, ...relevant]) {
        if (!row?.entry_id || seen.has(row.entry_id)) continue;
        seen.add(row.entry_id);
        rows.push(rowContext(row));
    }
    if (!rows.length) return '';
    const header = '[PLUGIN RELEVANT SETTING — REFERENCE DATA, NOT DIALOGUE]\nWorld setting is objective reference data. It does not mean every character knows it.';
    const cap = Math.max(1000, Math.min(30_000, Number(maxChars) || 7000));
    let out = header;
    for (const row of rows) {
        if (out.length + row.length + 2 > cap) break;
        out += `\n\n${row}`;
    }
    return out;
}

export function settingChunksToBaselineRecords(snapshotInput) {
    return (Array.isArray(snapshotInput?.chunks) ? snapshotInput.chunks : []).map((chunk, index) => ({
        id: `plugin-setting:${chunk.chunk_id}`,
        chunk_index: index,
        source_type: 'plugin_setting',
        source_id: chunk.source_id,
        title: chunk.title || chunk.comment || String(chunk.entry_id),
        text: chunk.body_text || chunk.retrieval_text || '',
        entry_id: chunk.entry_id,
        revision_id: chunk.revision_id,
        revision_kind: chunk.revision_kind,
        vector_hash: chunk.vector_hash,
    }));
}
