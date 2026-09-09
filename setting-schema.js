// Aetheria Unified Memory v5.5 — plugin-owned setting data schema.
//
// This module is intentionally host-agnostic. It defines the durable JSON shape
// used by the setting store and performs conservative migration/normalization.
// Imported source payloads are treated as data; no field is executed as a prompt.

export const SETTING_STORE_SCHEMA_VERSION = 1;

function nowValue(now) {
    const n = Number(typeof now === 'function' ? now() : now);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Date.now();
}

function cleanString(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    return String(value).replace(/\u0000/g, '').trim();
}

function optionalString(value) {
    const s = cleanString(value, '');
    return s || null;
}

function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function stringArray(value) {
    const rows = Array.isArray(value) ? value : [];
    const out = [];
    const seen = new Set();
    for (const item of rows) {
        const s = cleanString(item, '');
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
    if (value === undefined) return fallback;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

function recordMap(value, idField) {
    if (Array.isArray(value)) {
        const out = {};
        for (const row of value) {
            if (!row || typeof row !== 'object') continue;
            const id = cleanString(row[idField], '');
            if (id) out[id] = row;
        }
        return out;
    }
    return plainObject(value);
}

function sortJson(value) {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = sortJson(value[key]);
        return out;
    }
    return value;
}

export function canonicalSettingJson(value) {
    return JSON.stringify(sortJson(value));
}

export function createEmptySettingStore({ now = Date.now } = {}) {
    const ts = nowValue(now);
    return {
        schema_version: SETTING_STORE_SCHEMA_VERSION,
        active_world_id: null,
        worlds: {},
        sources: {},
        revisions: {},
        entries: {},
        created_at: ts,
        updated_at: ts,
    };
}

export function normalizeWorldRecord(input, { now = Date.now } = {}) {
    const row = plainObject(input);
    const ts = nowValue(now);
    return {
        world_id: cleanString(row.world_id, ''),
        name: cleanString(row.name, 'Untitled World') || 'Untitled World',
        active_baseline_revision_id: optionalString(row.active_baseline_revision_id),
        active_extension_revision_ids: stringArray(row.active_extension_revision_ids),
        created_at: Number.isFinite(Number(row.created_at)) ? Math.floor(Number(row.created_at)) : ts,
        updated_at: Number.isFinite(Number(row.updated_at)) ? Math.floor(Number(row.updated_at)) : ts,
    };
}

export function normalizeSourceRecord(input, { now = Date.now } = {}) {
    const row = plainObject(input);
    const ts = nowValue(now);
    const format = ['worldbook_json', 'titled_txt', 'unknown'].includes(row.format) ? row.format : 'unknown';
    return {
        source_id: cleanString(row.source_id, ''),
        world_id: cleanString(row.world_id, ''),
        format,
        filename: optionalString(row.filename),
        content_hash: cleanString(row.content_hash, ''),
        raw_payload: cloneJson(row.raw_payload, null),
        imported_at: Number.isFinite(Number(row.imported_at)) ? Math.floor(Number(row.imported_at)) : ts,
        metadata: cloneJson(plainObject(row.metadata), {}),
    };
}

export function normalizeSettingRevision(input, { now = Date.now } = {}) {
    const row = plainObject(input);
    const kind = row.revision_kind === 'extension' ? 'extension' : 'baseline';
    return {
        revision_id: cleanString(row.revision_id, ''),
        world_id: cleanString(row.world_id, ''),
        source_id: cleanString(row.source_id, ''),
        revision_label: cleanString(row.revision_label, 'Imported revision') || 'Imported revision',
        revision_kind: kind,
        parent_revision_id: optionalString(row.parent_revision_id),
        base_revision_id: optionalString(row.base_revision_id),
        created_at: Number.isFinite(Number(row.created_at)) ? Math.floor(Number(row.created_at)) : nowValue(now),
    };
}

export function normalizeSettingEntry(input) {
    const row = plainObject(input);
    return {
        entry_id: cleanString(row.entry_id, ''),
        world_id: cleanString(row.world_id, ''),
        source_id: cleanString(row.source_id, ''),
        revision_id: cleanString(row.revision_id, ''),
        source_entry_id: row.source_entry_id === null || row.source_entry_id === undefined
            ? null
            : (typeof row.source_entry_id === 'number' ? row.source_entry_id : cleanString(row.source_entry_id, '')),
        title: optionalString(row.title),
        comment: optionalString(row.comment),
        content: String(row.content ?? '').replace(/\u0000/g, '').trim(),
        keys: stringArray(row.keys),
        secondary_keys: stringArray(row.secondary_keys),
        constant: Boolean(row.constant),
        secret: Boolean(row.secret) || row.visibility === 'secret' || row.visibility === 'private',
        known_by: stringArray(row.known_by ?? row.known_by_ids),
        disabled: Boolean(row.disabled),
        order: optionalNumber(row.order),
        raw_extra: cloneJson(plainObject(row.raw_extra), {}),
        content_hash: cleanString(row.content_hash, ''),
    };
}

function normalizeStoreV1(input, { now = Date.now } = {}) {
    const src = plainObject(input);
    const empty = createEmptySettingStore({ now });
    const worldsIn = recordMap(src.worlds, 'world_id');
    const sourcesIn = recordMap(src.sources, 'source_id');
    const revisionsIn = recordMap(src.revisions, 'revision_id');
    const entriesIn = recordMap(src.entries, 'entry_id');

    const worlds = {};
    for (const [key, value] of Object.entries(worldsIn)) {
        const row = normalizeWorldRecord({ ...value, world_id: value?.world_id ?? key }, { now });
        if (row.world_id) worlds[row.world_id] = row;
    }

    const sources = {};
    for (const [key, value] of Object.entries(sourcesIn)) {
        const row = normalizeSourceRecord({ ...value, source_id: value?.source_id ?? key }, { now });
        if (row.source_id) sources[row.source_id] = row;
    }

    const revisions = {};
    for (const [key, value] of Object.entries(revisionsIn)) {
        const row = normalizeSettingRevision({ ...value, revision_id: value?.revision_id ?? key }, { now });
        if (row.revision_id) revisions[row.revision_id] = row;
    }

    const entries = {};
    for (const [key, value] of Object.entries(entriesIn)) {
        const row = normalizeSettingEntry({ ...value, entry_id: value?.entry_id ?? key });
        if (row.entry_id) entries[row.entry_id] = row;
    }

    const createdAt = Number.isFinite(Number(src.created_at)) ? Math.floor(Number(src.created_at)) : empty.created_at;
    const updatedAt = Number.isFinite(Number(src.updated_at)) ? Math.floor(Number(src.updated_at)) : createdAt;
    const activeWorldId = optionalString(src.active_world_id ?? src.activeWorldId);

    return {
        schema_version: SETTING_STORE_SCHEMA_VERSION,
        active_world_id: activeWorldId && worlds[activeWorldId] ? activeWorldId : null,
        worlds,
        sources,
        revisions,
        entries,
        created_at: createdAt,
        updated_at: updatedAt,
    };
}

export function migrateSettingStore(input, { now = Date.now } = {}) {
    if (!input || typeof input !== 'object') {
        return { store: createEmptySettingStore({ now }), migrated: true, from_version: null };
    }

    const rawVersion = input.schema_version ?? input.version ?? 0;
    const version = Number(rawVersion);
    if (Number.isFinite(version) && version > SETTING_STORE_SCHEMA_VERSION) {
        throw new Error(`Setting Store schema ${version} is newer than supported ${SETTING_STORE_SCHEMA_VERSION}.`);
    }

    // v0 was never released publicly; accepting array-shaped collections here gives us a
    // deterministic migration path for early development snapshots and hand-authored fixtures.
    const normalized = normalizeStoreV1(input, { now });
    const migrated = Number(rawVersion) !== SETTING_STORE_SCHEMA_VERSION
        || canonicalSettingJson(normalized) !== canonicalSettingJson(input);
    return {
        store: normalized,
        migrated,
        from_version: Number.isFinite(version) ? version : 0,
    };
}

export function validateSettingStore(input) {
    const { store } = migrateSettingStore(input);
    const errors = [];
    const warnings = [];

    for (const [id, world] of Object.entries(store.worlds)) {
        if (id !== world.world_id) errors.push(`world key/id mismatch: ${id}`);
        if (!world.name) errors.push(`world ${id} has empty name`);
        if (world.active_baseline_revision_id) {
            const rev = store.revisions[world.active_baseline_revision_id];
            if (!rev) errors.push(`world ${id} points to missing baseline revision ${world.active_baseline_revision_id}`);
            else if (rev.world_id !== id || rev.revision_kind !== 'baseline') errors.push(`world ${id} active baseline is incompatible`);
        }
        for (const revId of world.active_extension_revision_ids) {
            const rev = store.revisions[revId];
            if (!rev) errors.push(`world ${id} points to missing extension revision ${revId}`);
            else if (rev.world_id !== id || rev.revision_kind !== 'extension') errors.push(`world ${id} extension ${revId} is incompatible`);
            else if (world.active_baseline_revision_id && rev.base_revision_id !== world.active_baseline_revision_id) {
                errors.push(`world ${id} extension ${revId} targets baseline ${rev.base_revision_id}, not active baseline ${world.active_baseline_revision_id}`);
            }
        }
    }

    for (const [id, source] of Object.entries(store.sources)) {
        if (id !== source.source_id) errors.push(`source key/id mismatch: ${id}`);
        if (!store.worlds[source.world_id]) errors.push(`source ${id} points to missing world ${source.world_id}`);
        if (!source.content_hash) warnings.push(`source ${id} has no content_hash yet`);
    }

    for (const [id, rev] of Object.entries(store.revisions)) {
        if (id !== rev.revision_id) errors.push(`revision key/id mismatch: ${id}`);
        const world = store.worlds[rev.world_id];
        const source = store.sources[rev.source_id];
        if (!world) errors.push(`revision ${id} points to missing world ${rev.world_id}`);
        if (!source) errors.push(`revision ${id} points to missing source ${rev.source_id}`);
        else if (source.world_id !== rev.world_id) errors.push(`revision ${id} source belongs to another world`);
        if (rev.parent_revision_id) {
            const parent = store.revisions[rev.parent_revision_id];
            if (!parent) errors.push(`revision ${id} points to missing parent ${rev.parent_revision_id}`);
            else if (parent.world_id !== rev.world_id) errors.push(`revision ${id} parent belongs to another world`);
        }
        if (rev.revision_kind === 'baseline' && rev.base_revision_id) errors.push(`baseline revision ${id} must not set base_revision_id`);
        if (rev.revision_kind === 'extension') {
            const base = store.revisions[rev.base_revision_id];
            if (!rev.base_revision_id) errors.push(`extension revision ${id} requires base_revision_id`);
            else if (!base || base.world_id !== rev.world_id || base.revision_kind !== 'baseline') {
                errors.push(`extension revision ${id} has invalid base_revision_id ${rev.base_revision_id}`);
            }
        }
    }

    for (const [id, entry] of Object.entries(store.entries)) {
        if (id !== entry.entry_id) errors.push(`entry key/id mismatch: ${id}`);
        const world = store.worlds[entry.world_id];
        const source = store.sources[entry.source_id];
        const rev = store.revisions[entry.revision_id];
        if (!world) errors.push(`entry ${id} points to missing world ${entry.world_id}`);
        if (!source) errors.push(`entry ${id} points to missing source ${entry.source_id}`);
        if (!rev) errors.push(`entry ${id} points to missing revision ${entry.revision_id}`);
        if (source && source.world_id !== entry.world_id) errors.push(`entry ${id} source belongs to another world`);
        if (rev && (rev.world_id !== entry.world_id || rev.source_id !== entry.source_id)) errors.push(`entry ${id} revision/source/world mismatch`);
        if (!entry.content) warnings.push(`entry ${id} has empty content`);
        if (!entry.content_hash) warnings.push(`entry ${id} has no content_hash yet`);
    }

    if (store.active_world_id && !store.worlds[store.active_world_id]) errors.push(`active_world_id ${store.active_world_id} does not exist`);
    return { ok: errors.length === 0, errors, warnings, store };
}

export function serializeSettingStore(input, space = 2) {
    const result = validateSettingStore(input);
    if (!result.ok) throw new Error(`Invalid Setting Store: ${result.errors.join('; ')}`);
    return JSON.stringify(result.store, null, space);
}

export function deserializeSettingStore(text, options = {}) {
    const parsed = JSON.parse(String(text ?? ''));
    return migrateSettingStore(parsed, options).store;
}
