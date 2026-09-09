// Aetheria Unified Memory v5.5 — plugin-owned Setting Index (pure core).
//
// This module is host-agnostic. It projects the immutable Setting Store into
// structured SettingChunk rows, a deterministic world/revision scope, and a
// guaranteed local lexical retrieval path. Dense vector storage is a derived
// projection handled by index.js; this file never performs network I/O.

import { migrateSettingStore } from './setting-schema.js';
import {
    baselineLexicalSimilarity,
    fnv1a32Baseline,
    normalizeBaselineText,
    splitBaselineText,
    tokenizeBaselineText,
} from './baseline-index.js';

export const SETTING_INDEX_VERSION = '5.5-g1';

function cleanString(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

function numericOrder(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function stableSourceEntryId(value) {
    if (value === null || value === undefined) return '';
    return String(value);
}

function orderedEntries(store, revisionIds) {
    const rank = new Map(revisionIds.map((id, index) => [id, index]));
    return Object.values(store.entries)
        .filter(entry => rank.has(entry.revision_id) && !entry.disabled)
        .sort((a, b) => {
            const rr = rank.get(a.revision_id) - rank.get(b.revision_id);
            if (rr) return rr;
            const oo = numericOrder(a.order) - numericOrder(b.order);
            if (Number.isFinite(oo) && oo) return oo;
            const so = stableSourceEntryId(a.source_entry_id).localeCompare(stableSourceEntryId(b.source_entry_id), undefined, { numeric: true });
            if (so) return so;
            return a.entry_id.localeCompare(b.entry_id);
        });
}

function revisionScopeRows(store, world) {
    if (!world) return [];
    const ids = [world.active_baseline_revision_id, ...(world.active_extension_revision_ids || [])].filter(Boolean);
    const baselineId = world.active_baseline_revision_id || null;
    const out = [];
    for (const revisionId of ids) {
        const revision = store.revisions[revisionId];
        if (!revision || revision.world_id !== world.world_id) continue;
        if (revision.revision_kind === 'extension' && revision.base_revision_id !== baselineId) continue;
        out.push(revision);
    }
    return out;
}

export function resolveActiveSettingScope(storeInput, { world_id = null } = {}) {
    const store = migrateSettingStore(storeInput).store;
    const worldId = cleanString(world_id || store.active_world_id);
    const world = worldId ? store.worlds[worldId] || null : null;
    if (!world) {
        return {
            world_id: worldId || null,
            world_name: null,
            baseline_revision_id: null,
            extension_revision_ids: [],
            revision_ids: [],
            revisions: [],
            scope_key: null,
        };
    }
    const revisions = revisionScopeRows(store, world);
    const revisionIds = revisions.map(row => row.revision_id);
    const baselineRevisionId = revisions.find(row => row.revision_kind === 'baseline')?.revision_id || null;
    const extensionRevisionIds = revisions.filter(row => row.revision_kind === 'extension').map(row => row.revision_id);
    const scopeSeed = `${world.world_id}|${revisionIds.join('|')}`;
    const scopeHash = fnv1a32Baseline(scopeSeed).toString(36);
    return {
        world_id: world.world_id,
        world_name: world.name,
        baseline_revision_id: baselineRevisionId,
        extension_revision_ids: extensionRevisionIds,
        revision_ids: revisionIds,
        revisions,
        scope_key: `setting55:${scopeHash}`,
    };
}

const CONDITION_LEADERS = [
    '如果', '若', '假如', '倘若', '除非', '除了', '当', '一旦', '否则', '不然',
    '但是', '但', '不过', '然而', '可是', '例外', '特殊', '只有', '仅在',
    'if', 'unless', 'except', 'otherwise', 'however', 'but',
];

function startsWithCondition(text) {
    const head = String(text || '').trim().toLocaleLowerCase();
    return CONDITION_LEADERS.some(leader => head.startsWith(leader));
}

/**
 * Structure-aware setting splitter (Iteration 08, proposal P1).
 *
 * Wraps the shared sentence splitter and glues a fragment that begins with a conditional or
 * exception marker back onto the rule it qualifies, up to a bounded soft cap. This prevents
 * "规则例外和条件被切离" while still keeping chunks near the configured size.
 */
export function splitSettingText(input, { maxChars = 420, minChars = 18, glueFactor = 1.5 } = {}) {
    const max = Math.max(120, Math.min(1200, Number(maxChars) || 420));
    const glueMax = Math.max(max, Math.floor(max * Math.max(1, Number(glueFactor) || 1.5)));
    const pieces = splitBaselineText(input, { maxChars: max, minChars });
    const out = [];
    for (const piece of pieces) {
        if (out.length && startsWithCondition(piece)) {
            const previous = out[out.length - 1];
            if (previous.length + 1 + piece.length <= glueMax) {
                out[out.length - 1] = `${previous} ${piece}`;
                continue;
            }
        }
        out.push(piece);
    }
    return out;
}

function entryHeader(entry) {
    const labels = [];
    if (entry.title) labels.push(`标题: ${entry.title}`);
    if (entry.comment && entry.comment !== entry.title) labels.push(`备注: ${entry.comment}`);
    if (entry.keys?.length) labels.push(`关键词: ${entry.keys.join(' / ')}`);
    if (entry.secondary_keys?.length) labels.push(`次级关键词: ${entry.secondary_keys.join(' / ')}`);
    return labels.join('\n');
}

function chunkRetrievalText(entry, body) {
    const header = entryHeader(entry);
    return header ? `${header}\n正文: ${body}` : body;
}

export function buildSettingChunks(storeInput, {
    world_id = null,
    maxChars = 420,
    minChars = 18,
} = {}) {
    const store = migrateSettingStore(storeInput).store;
    const scope = resolveActiveSettingScope(store, { world_id });
    if (!scope.world_id || !scope.revision_ids.length) return { scope, chunks: [] };
    const entries = orderedEntries(store, scope.revision_ids);
    const revisionMap = store.revisions;
    const chunks = [];

    for (const entry of entries) {
        const body = cleanString(entry.content);
        if (!body) continue;
        const pieces = splitSettingText(body, { maxChars, minChars });
        const fallbackPieces = pieces.length ? pieces : [body];
        fallbackPieces.forEach((piece, chunkIndex) => {
            const retrievalText = chunkRetrievalText(entry, piece);
            const normalized = normalizeBaselineText(retrievalText);
            if (!normalized) return;
            const revision = revisionMap[entry.revision_id];
            const seed = [
                SETTING_INDEX_VERSION,
                scope.world_id,
                entry.revision_id,
                entry.entry_id,
                chunkIndex,
                entry.content_hash || '',
                normalized,
            ].join('|');
            const hash = fnv1a32Baseline(seed);
            chunks.push({
                chunk_id: `s_${hash.toString(36)}`,
                vector_hash: hash,
                world_id: scope.world_id,
                revision_id: entry.revision_id,
                revision_kind: revision?.revision_kind || 'baseline',
                source_id: entry.source_id,
                entry_id: entry.entry_id,
                source_entry_id: entry.source_entry_id,
                parent_content_hash: entry.content_hash || '',
                title: entry.title,
                comment: entry.comment,
                keys: [...(entry.keys || [])],
                secondary_keys: [...(entry.secondary_keys || [])],
                constant: Boolean(entry.constant),
                secret: Boolean(entry.secret),
                known_by: [...(entry.known_by || [])],
                order: entry.order,
                chunk_index: chunkIndex,
                body_text: piece,
                retrieval_text: retrievalText,
                normalized,
                tokens: tokenizeBaselineText(retrievalText),
            });
        });
    }
    return { scope, chunks };
}

export function computeSettingIndexFingerprint(scopeInput, chunksInput) {
    const scope = scopeInput || {};
    const chunks = Array.isArray(chunksInput) ? chunksInput : [];
    const rows = chunks.map(chunk => [
        chunk.revision_id || '',
        chunk.entry_id || '',
        chunk.chunk_index ?? '',
        chunk.parent_content_hash || '',
        chunk.normalized || normalizeBaselineText(chunk.retrieval_text),
    ].join('|')).sort();
    const seed = `${SETTING_INDEX_VERSION}|${scope.world_id || ''}|${(scope.revision_ids || []).join('|')}\n${rows.join('\n')}`;
    return `setting55:${fnv1a32Baseline(seed).toString(36)}:${chunks.length}`;
}

export function computeSettingEmbeddingProfileHash(profileInput) {
    const raw = typeof profileInput === 'string'
        ? profileInput
        : JSON.stringify(profileInput ?? null);
    const normalized = cleanString(raw) || 'unknown-profile';
    return `ep_${fnv1a32Baseline(normalized).toString(36)}`;
}

export function getSettingCollectionId(scopeInput, embeddingProfileHash = null, generationKey = null) {
    const scope = scopeInput || {};
    if (!scope.world_id || !Array.isArray(scope.revision_ids) || !scope.revision_ids.length) return null;
    const profile = cleanString(embeddingProfileHash || 'logical');
    const seed = `${scope.world_id}|${scope.revision_ids.join('|')}|${profile}`;
    const base = `aetheria_v55_setting_${fnv1a32Baseline(seed).toString(36)}`;
    if (!generationKey) return base;
    const generation = fnv1a32Baseline(`${seed}|${cleanString(generationKey)}`).toString(36);
    return `${base}_g${generation}`;
}

export function buildSettingIndexSnapshot(storeInput, options = {}) {
    const { scope, chunks } = buildSettingChunks(storeInput, options);
    return {
        index_version: SETTING_INDEX_VERSION,
        scope,
        chunks,
        fingerprint: computeSettingIndexFingerprint(scope, chunks),
        collection_id: getSettingCollectionId(scope),
        chunk_count: chunks.length,
    };
}

export function buildSettingVectorItems(snapshotInput, { entryIds = null } = {}) {
    const snapshot = snapshotInput || {};
    const chunks = Array.isArray(snapshot.chunks) ? snapshot.chunks : [];
    const filter = entryIds ? new Set(Array.from(entryIds, value => String(value))) : null;
    return chunks
        .map((chunk, index) => ({ chunk, index }))
        .filter(row => !filter || filter.has(String(row.chunk.entry_id)))
        .map(({ chunk, index }) => ({
            hash: Number(chunk.vector_hash),
            text: chunk.retrieval_text,
            index,
        }));
}

export function buildSettingEntryManifest(snapshotInput) {
    const snapshot = snapshotInput || {};
    const chunks = Array.isArray(snapshot.chunks) ? snapshot.chunks : [];
    const grouped = new Map();
    for (const chunk of chunks) {
        const entryId = String(chunk?.entry_id || '');
        if (!entryId) continue;
        if (!grouped.has(entryId)) grouped.set(entryId, []);
        grouped.get(entryId).push(chunk);
    }
    const entries = {};
    for (const [entryId, rows] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const ordered = rows.slice().sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
        const first = ordered[0] || {};
        const vectorHashes = ordered.map(row => Number(row.vector_hash)).filter(Number.isFinite);
        const signatureSeed = [
            first.revision_id || '',
            entryId,
            first.parent_content_hash || '',
            ...ordered.map(row => `${row.chunk_index}:${row.vector_hash}:${row.normalized || normalizeBaselineText(row.retrieval_text)}`),
        ].join('|');
        entries[entryId] = {
            entry_id: entryId,
            revision_id: first.revision_id || null,
            source_id: first.source_id || null,
            parent_content_hash: first.parent_content_hash || '',
            chunk_count: ordered.length,
            vector_hashes: vectorHashes,
            signature: `se_${fnv1a32Baseline(signatureSeed).toString(36)}`,
        };
    }
    return {
        manifest_version: 1,
        snapshot_fingerprint: snapshot.fingerprint || null,
        entry_count: Object.keys(entries).length,
        chunk_count: chunks.length,
        entries,
    };
}

export function diffSettingEntryManifests(previousInput, nextInput) {
    const previous = previousInput?.entries && typeof previousInput.entries === 'object' ? previousInput.entries : {};
    const next = nextInput?.entries && typeof nextInput.entries === 'object' ? nextInput.entries : {};
    const added = [];
    const changed = [];
    const removed = [];
    const unchanged = [];
    for (const entryId of Object.keys(next).sort()) {
        if (!previous[entryId]) {
            added.push(entryId);
        } else if (previous[entryId].signature === next[entryId].signature) {
            unchanged.push(entryId);
        } else {
            changed.push(entryId);
        }
    }
    for (const entryId of Object.keys(previous).sort()) {
        if (!next[entryId]) removed.push(entryId);
    }
    const oldHashesFor = ids => ids.flatMap(id => previous[id]?.vector_hashes || []).map(Number).filter(Number.isFinite);
    const newHashesFor = ids => ids.flatMap(id => next[id]?.vector_hashes || []).map(Number).filter(Number.isFinite);
    return {
        added,
        changed,
        removed,
        unchanged,
        insert_entry_ids: [...added, ...changed],
        delete_hashes: oldHashesFor([...changed, ...removed]),
        inserted_hashes: newHashesFor([...added, ...changed]),
        has_changes: Boolean(added.length || changed.length || removed.length),
    };
}

function phraseHit(queryNorm, value) {
    const n = normalizeBaselineText(value);
    return n.length >= 2 && queryNorm.includes(n);
}

export function scoreSettingChunk(queryInput, chunk) {
    const query = cleanString(queryInput);
    const queryNorm = normalizeBaselineText(query);
    if (!queryNorm || !chunk) return 0;
    // Parent title/keys are repeated into every child chunk for recallability, but they must not
    // flatten all children to the same score. Body relevance remains the main discriminator.
    const bodyScore = baselineLexicalSimilarity(query, chunk.body_text || '');
    const retrievalScore = baselineLexicalSimilarity(query, chunk.retrieval_text || chunk.body_text || '');
    let score = Math.max(bodyScore, retrievalScore * 0.88);
    if ((chunk.keys || []).some(key => phraseHit(queryNorm, key))) score = Math.max(score, 0.35 + 0.65 * bodyScore);
    if ((chunk.secondary_keys || []).some(key => phraseHit(queryNorm, key))) score = Math.max(score, 0.28 + 0.62 * bodyScore);
    if (chunk.title && phraseHit(queryNorm, chunk.title)) score = Math.max(score, 0.32 + 0.64 * bodyScore);
    if (chunk.comment && phraseHit(queryNorm, chunk.comment)) score = Math.max(score, 0.28 + 0.60 * bodyScore);
    if (chunk.constant && score > 0) score = Math.min(1, score + 0.015);
    return Math.min(1, score);
}

export function lexicalSearchSettingChunks(chunksInput, queryInput, {
    topK = 12,
    minScore = 0.05,
} = {}) {
    const chunks = Array.isArray(chunksInput) ? chunksInput : [];
    const k = Math.max(0, Math.min(200, Number(topK) || 12));
    const floor = Math.max(0, Math.min(1, Number(minScore) || 0));
    if (!k || !cleanString(queryInput)) return [];
    return chunks
        .map((chunk, index) => ({ chunk, index, score: scoreSettingChunk(queryInput, chunk) }))
        .filter(row => row.score >= floor)
        .sort((a, b) => b.score - a.score
            || Number(Boolean(b.chunk.constant)) - Number(Boolean(a.chunk.constant))
            || numericOrder(a.chunk.order) - numericOrder(b.chunk.order)
            || a.index - b.index)
        .slice(0, k);
}

export function summarizeSettingSnapshot(snapshotInput) {
    const snapshot = snapshotInput || {};
    const scope = snapshot.scope || {};
    const chunks = Array.isArray(snapshot.chunks) ? snapshot.chunks : [];
    const entryIds = new Set(chunks.map(chunk => chunk.entry_id));
    return {
        index_version: snapshot.index_version || SETTING_INDEX_VERSION,
        world_id: scope.world_id || null,
        world_name: scope.world_name || null,
        revision_ids: [...(scope.revision_ids || [])],
        scope_key: scope.scope_key || null,
        collection_id: snapshot.collection_id || null,
        fingerprint: snapshot.fingerprint || null,
        entry_count: entryIds.size,
        chunk_count: chunks.length,
        constant_chunk_count: chunks.filter(chunk => chunk.constant).length,
    };
}
