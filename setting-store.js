// Aetheria Unified Memory v5.5 — immutable Setting Store operations.
//
// The store is global to the extension (persisted through SillyTavern extension settings),
// while chat memories remain in chat metadata. Revisions and their entries are append-only:
// changing imported world data creates a new revision instead of mutating an old one.

import {
    canonicalSettingJson,
    createEmptySettingStore,
    migrateSettingStore,
    normalizeSettingEntry,
    normalizeSettingRevision,
    normalizeSourceRecord,
    normalizeWorldRecord,
    validateSettingStore,
} from './setting-schema.js';

function timestamp(now = Date.now) {
    const n = Number(typeof now === 'function' ? now() : now);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Date.now();
}

function generateId(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `${prefix}_${uuid}`;
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function requireId(value, prefix) {
    const id = String(value ?? '').trim();
    return id || generateId(prefix);
}

function baseStore(input) {
    return migrateSettingStore(input).store;
}

function nextStore(store, patch, now = Date.now) {
    return { ...store, ...patch, schema_version: store.schema_version, updated_at: timestamp(now) };
}

function assertWorld(store, worldId) {
    const world = store.worlds[worldId];
    if (!world) throw new Error(`Unknown world_id: ${worldId}`);
    return world;
}

function assertUnique(map, id, kind) {
    if (map[id]) throw new Error(`${kind} already exists: ${id}`);
}

function assertJsonEqual(a, b, message) {
    if (canonicalSettingJson(a) !== canonicalSettingJson(b)) throw new Error(message);
}

export function createSettingStore(options = {}) {
    return createEmptySettingStore(options);
}

export function createWorld(input, data = {}, { now = Date.now } = {}) {
    const store = baseStore(input);
    const worldId = requireId(data.world_id, 'world');
    assertUnique(store.worlds, worldId, 'world');
    const ts = timestamp(now);
    const world = normalizeWorldRecord({
        world_id: worldId,
        name: data.name,
        active_baseline_revision_id: null,
        active_extension_revision_ids: [],
        created_at: ts,
        updated_at: ts,
    }, { now: ts });
    const worlds = { ...store.worlds, [worldId]: world };
    return {
        store: nextStore(store, {
            worlds,
            active_world_id: store.active_world_id || worldId,
        }, ts),
        world,
    };
}

export function renameWorld(input, worldId, name, { now = Date.now } = {}) {
    const store = baseStore(input);
    const world = assertWorld(store, worldId);
    const nextName = String(name ?? '').replace(/\u0000/g, '').trim();
    if (!nextName) throw new Error('World name cannot be empty.');
    const ts = timestamp(now);
    const updated = { ...world, name: nextName, updated_at: ts };
    return { ...nextStore(store, { worlds: { ...store.worlds, [worldId]: updated } }, ts), active_world_id: store.active_world_id };
}

export function setActiveWorld(input, worldId, { now = Date.now } = {}) {
    const store = baseStore(input);
    if (worldId !== null) assertWorld(store, worldId);
    return nextStore(store, { active_world_id: worldId || null }, now);
}

export function addSource(input, data = {}, { now = Date.now } = {}) {
    const store = baseStore(input);
    const sourceId = requireId(data.source_id, 'source');
    assertUnique(store.sources, sourceId, 'source');
    const worldId = String(data.world_id ?? '').trim();
    assertWorld(store, worldId);
    const source = normalizeSourceRecord({ ...data, source_id: sourceId, world_id: worldId }, { now });
    const next = nextStore(store, { sources: { ...store.sources, [sourceId]: source } }, now);
    return { store: next, source };
}

export function addRevision(input, data = {}, { now = Date.now } = {}) {
    const store = baseStore(input);
    const revisionId = requireId(data.revision_id, 'revision');
    assertUnique(store.revisions, revisionId, 'revision');
    const worldId = String(data.world_id ?? '').trim();
    const sourceId = String(data.source_id ?? '').trim();
    assertWorld(store, worldId);
    const source = store.sources[sourceId];
    if (!source) throw new Error(`Unknown source_id: ${sourceId}`);
    if (source.world_id !== worldId) throw new Error('Revision source belongs to another world.');

    const revision = normalizeSettingRevision({ ...data, revision_id: revisionId, world_id: worldId, source_id: sourceId }, { now });
    if (revision.parent_revision_id) {
        const parent = store.revisions[revision.parent_revision_id];
        if (!parent) throw new Error(`Unknown parent_revision_id: ${revision.parent_revision_id}`);
        if (parent.world_id !== worldId) throw new Error('Parent revision belongs to another world.');
    }
    if (revision.revision_kind === 'baseline') {
        if (revision.base_revision_id) throw new Error('Baseline revision cannot set base_revision_id.');
    } else {
        if (!revision.base_revision_id) throw new Error('Extension revision requires base_revision_id.');
        const base = store.revisions[revision.base_revision_id];
        if (!base || base.world_id !== worldId || base.revision_kind !== 'baseline') {
            throw new Error(`Invalid extension base_revision_id: ${revision.base_revision_id}`);
        }
    }

    const next = nextStore(store, { revisions: { ...store.revisions, [revisionId]: revision } }, now);
    return { store: next, revision };
}

export function addEntry(input, data = {}, { now = Date.now } = {}) {
    const store = baseStore(input);
    const entryId = requireId(data.entry_id, 'entry');
    assertUnique(store.entries, entryId, 'entry');
    const worldId = String(data.world_id ?? '').trim();
    const sourceId = String(data.source_id ?? '').trim();
    const revisionId = String(data.revision_id ?? '').trim();
    assertWorld(store, worldId);
    const source = store.sources[sourceId];
    const revision = store.revisions[revisionId];
    if (!source) throw new Error(`Unknown source_id: ${sourceId}`);
    if (!revision) throw new Error(`Unknown revision_id: ${revisionId}`);
    if (source.world_id !== worldId || revision.world_id !== worldId || revision.source_id !== sourceId) {
        throw new Error('Entry world/source/revision relationship is inconsistent.');
    }
    const entry = normalizeSettingEntry({ ...data, entry_id: entryId, world_id: worldId, source_id: sourceId, revision_id: revisionId });
    const next = nextStore(store, { entries: { ...store.entries, [entryId]: entry } }, now);
    return { store: next, entry };
}

export function addEntries(input, rows = [], options = {}) {
    let store = baseStore(input);
    const entries = [];
    for (const row of rows) {
        const result = addEntry(store, row, options);
        store = result.store;
        entries.push(result.entry);
    }
    return { store, entries };
}

export function setActiveBaselineRevision(input, worldId, revisionId, { now = Date.now } = {}) {
    const store = baseStore(input);
    const world = assertWorld(store, worldId);
    if (revisionId === null) {
        const updated = { ...world, active_baseline_revision_id: null, active_extension_revision_ids: [], updated_at: timestamp(now) };
        return nextStore(store, { worlds: { ...store.worlds, [worldId]: updated } }, now);
    }
    const revision = store.revisions[revisionId];
    if (!revision || revision.world_id !== worldId || revision.revision_kind !== 'baseline') {
        throw new Error(`Invalid baseline revision for world ${worldId}: ${revisionId}`);
    }
    const extensions = world.active_extension_revision_ids.filter(id => store.revisions[id]?.base_revision_id === revisionId);
    const updated = {
        ...world,
        active_baseline_revision_id: revisionId,
        active_extension_revision_ids: extensions,
        updated_at: timestamp(now),
    };
    return nextStore(store, { worlds: { ...store.worlds, [worldId]: updated } }, now);
}

export function setActiveExtensionRevisions(input, worldId, revisionIds = [], { now = Date.now } = {}) {
    const store = baseStore(input);
    const world = assertWorld(store, worldId);
    if (!world.active_baseline_revision_id && revisionIds.length) throw new Error('Activate a baseline revision before extensions.');
    const clean = [];
    const seen = new Set();
    for (const raw of revisionIds) {
        const id = String(raw ?? '').trim();
        if (!id || seen.has(id)) continue;
        const revision = store.revisions[id];
        if (!revision || revision.world_id !== worldId || revision.revision_kind !== 'extension') {
            throw new Error(`Invalid extension revision for world ${worldId}: ${id}`);
        }
        if (revision.base_revision_id !== world.active_baseline_revision_id) {
            throw new Error(`Extension ${id} targets baseline ${revision.base_revision_id}, not active baseline ${world.active_baseline_revision_id}.`);
        }
        seen.add(id);
        clean.push(id);
    }
    const updated = { ...world, active_extension_revision_ids: clean, updated_at: timestamp(now) };
    return nextStore(store, { worlds: { ...store.worlds, [worldId]: updated } }, now);
}

export function deleteRevision(input, revisionId, { cascade = false, now = Date.now } = {}) {
    const store = baseStore(input);
    const revision = store.revisions[revisionId];
    if (!revision) return store;
    const childIds = Object.values(store.revisions).filter(row => row.parent_revision_id === revisionId || row.base_revision_id === revisionId).map(row => row.revision_id);
    const entryIds = Object.values(store.entries).filter(row => row.revision_id === revisionId).map(row => row.entry_id);
    if (!cascade && (childIds.length || entryIds.length)) throw new Error(`Revision ${revisionId} still has dependent entries/revisions.`);

    let next = store;
    if (cascade) {
        for (const childId of childIds) next = deleteRevision(next, childId, { cascade: true, now });
    }
    const revisions = { ...next.revisions };
    delete revisions[revisionId];
    const entries = { ...next.entries };
    for (const entryId of entryIds) delete entries[entryId];
    const worlds = { ...next.worlds };
    const world = worlds[revision.world_id];
    if (world) {
        worlds[revision.world_id] = {
            ...world,
            active_baseline_revision_id: world.active_baseline_revision_id === revisionId ? null : world.active_baseline_revision_id,
            active_extension_revision_ids: world.active_extension_revision_ids.filter(id => id !== revisionId),
            updated_at: timestamp(now),
        };
        if (world.active_baseline_revision_id === revisionId) worlds[revision.world_id].active_extension_revision_ids = [];
    }
    return nextStore(next, { revisions, entries, worlds }, now);
}

export function deleteSource(input, sourceId, { cascade = false, now = Date.now } = {}) {
    let store = baseStore(input);
    const source = store.sources[sourceId];
    if (!source) return store;
    const revisionIds = Object.values(store.revisions).filter(row => row.source_id === sourceId).map(row => row.revision_id);
    if (!cascade && revisionIds.length) throw new Error(`Source ${sourceId} still has revisions.`);
    for (const revisionId of revisionIds) store = deleteRevision(store, revisionId, { cascade: true, now });
    const sources = { ...store.sources };
    delete sources[sourceId];
    return nextStore(store, { sources }, now);
}

export function deleteWorld(input, worldId, { cascade = false, now = Date.now } = {}) {
    let store = baseStore(input);
    if (!store.worlds[worldId]) return store;
    const sourceIds = Object.values(store.sources).filter(row => row.world_id === worldId).map(row => row.source_id);
    const revisionIds = Object.values(store.revisions).filter(row => row.world_id === worldId).map(row => row.revision_id);
    const entryIds = Object.values(store.entries).filter(row => row.world_id === worldId).map(row => row.entry_id);
    if (!cascade && (sourceIds.length || revisionIds.length || entryIds.length)) throw new Error(`World ${worldId} still has dependent setting data.`);
    for (const sourceId of sourceIds) store = deleteSource(store, sourceId, { cascade: true, now });
    const worlds = { ...store.worlds };
    delete worlds[worldId];
    const remaining = Object.keys(worlds);
    return nextStore(store, {
        worlds,
        active_world_id: store.active_world_id === worldId ? (remaining[0] || null) : store.active_world_id,
    }, now);
}

export function getWorld(input, worldId) {
    return baseStore(input).worlds[worldId] || null;
}

export function listWorlds(input) {
    return Object.values(baseStore(input).worlds).sort((a, b) => a.created_at - b.created_at || a.name.localeCompare(b.name));
}

export function listRevisionsForWorld(input, worldId) {
    return Object.values(baseStore(input).revisions)
        .filter(row => row.world_id === worldId)
        .sort((a, b) => a.created_at - b.created_at || a.revision_id.localeCompare(b.revision_id));
}

export function listEntriesForRevision(input, revisionId, { includeDisabled = true } = {}) {
    return Object.values(baseStore(input).entries)
        .filter(row => row.revision_id === revisionId && (includeDisabled || !row.disabled))
        .sort((a, b) => {
            const ao = a.order === null ? Number.MAX_SAFE_INTEGER : a.order;
            const bo = b.order === null ? Number.MAX_SAFE_INTEGER : b.order;
            return ao - bo || a.entry_id.localeCompare(b.entry_id);
        });
}

export function assertSettingStoreValid(input) {
    const result = validateSettingStore(input);
    if (!result.ok) throw new Error(`Invalid Setting Store: ${result.errors.join('; ')}`);
    return result.store;
}

// Internal invariant helper used by tests: immutable records with the same id must compare identically.
export function assertSameImmutableRecord(a, b, label = 'record') {
    assertJsonEqual(a, b, `${label} is immutable and cannot be changed in place.`);
    return true;
}
