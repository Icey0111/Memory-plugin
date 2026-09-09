// Aetheria Unified Memory v5.5 — two-phase setting import pipeline.
//
// previewImport() parses and hashes source data without mutating persistent state.
// commitImport() writes Source -> Revision -> Entries only after explicit caller
// confirmation. Imported source content remains data and is never executed.

import { canonicalSettingJson, migrateSettingStore } from './setting-schema.js';
import {
    addEntries,
    addRevision,
    addSource,
    createWorld,
    setActiveBaselineRevision,
    setActiveExtensionRevisions,
    setActiveWorld,
} from './setting-store.js';
import { parseWorldbookJson } from './source-adapters/worldbook-json.js';
import { parseTitledText } from './source-adapters/titled-text.js';

export const IMPORT_PREVIEW_VERSION = 1;

function bytesToHex(buffer) {
    return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fallbackHash(text) {
    // FNV-1a 64-ish composite fallback for non-secure/legacy browser contexts.
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        a ^= code;
        a = Math.imul(a, 0x01000193) >>> 0;
        b ^= (code + i) >>> 0;
        b = Math.imul(b, 0x85ebca6b) >>> 0;
    }
    return `fnv64-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

export async function hashSettingContent(value) {
    const text = String(value ?? '');
    const subtle = globalThis.crypto?.subtle;
    if (subtle?.digest && typeof TextEncoder !== 'undefined') {
        try {
            const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
            return `sha256-${bytesToHex(digest)}`;
        } catch {
            // Fall through to deterministic local hash.
        }
    }
    return fallbackHash(text);
}

function extensionOf(filename) {
    const name = String(filename || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot) : '';
}

async function resolveInput(input, options = {}) {
    if (input && typeof input.text === 'function') {
        return {
            text: await input.text(),
            filename: options.filename ?? input.name ?? null,
            mime_type: options.mime_type ?? input.type ?? null,
        };
    }
    if (typeof input === 'string') {
        return { text: input, filename: options.filename ?? null, mime_type: options.mime_type ?? null };
    }
    if (input && typeof input === 'object') {
        return {
            text: canonicalSettingJson(input),
            filename: options.filename ?? null,
            mime_type: options.mime_type ?? 'application/json',
        };
    }
    throw new Error('Import input must be a File-like object, string, or JSON object.');
}

function chooseAdapter(text, filename, mimeType) {
    const ext = extensionOf(filename);
    const mime = String(mimeType || '').toLowerCase();
    const trimmed = text.trimStart();
    if (ext === '.json' || mime.includes('json')) return 'worldbook_json';
    if (['.txt', '.md', '.markdown'].includes(ext) || mime.startsWith('text/')) return 'titled_txt';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            JSON.parse(text);
            return 'worldbook_json';
        } catch {
            // Unknown text-looking data falls back to conservative TXT import.
        }
    }
    return 'titled_txt';
}

function normalizePreviewEntry(entry) {
    return {
        source_entry_id: entry.source_entry_id ?? null,
        title: entry.title ?? null,
        comment: entry.comment ?? null,
        content: String(entry.content ?? '').replace(/\u0000/g, '').trim(),
        keys: Array.isArray(entry.keys) ? [...entry.keys] : [],
        secondary_keys: Array.isArray(entry.secondary_keys) ? [...entry.secondary_keys] : [],
        constant: Boolean(entry.constant),
        disabled: Boolean(entry.disabled),
        order: entry.order === null || entry.order === undefined || entry.order === '' ? null : Number(entry.order),
        raw_extra: entry.raw_extra && typeof entry.raw_extra === 'object' && !Array.isArray(entry.raw_extra) ? entry.raw_extra : {},
        source_ordinal: Number.isFinite(Number(entry._source_ordinal)) ? Number(entry._source_ordinal) : null,
    };
}

function entryHashPayload(entry) {
    return canonicalSettingJson({
        source_entry_id: entry.source_entry_id,
        title: entry.title,
        comment: entry.comment,
        content: entry.content,
        keys: entry.keys,
        secondary_keys: entry.secondary_keys,
        constant: entry.constant,
        disabled: entry.disabled,
        order: entry.order,
        raw_extra: entry.raw_extra,
    });
}

export function findDuplicateSources(storeInput, contentHash, { world_id = null } = {}) {
    const store = migrateSettingStore(storeInput).store;
    const hash = String(contentHash || '').trim();
    if (!hash) return [];
    return Object.values(store.sources)
        .filter(source => source.content_hash === hash && (!world_id || source.world_id === world_id))
        .sort((a, b) => a.imported_at - b.imported_at || a.source_id.localeCompare(b.source_id));
}

export async function previewImport(input, options = {}) {
    const resolved = await resolveInput(input, options);
    const rawText = String(resolved.text ?? '').replace(/\u0000/g, '');
    if (!rawText.trim()) throw new Error('Import file is empty.');
    const format = chooseAdapter(rawText, resolved.filename, resolved.mime_type);
    const parsed = format === 'worldbook_json'
        ? parseWorldbookJson(rawText)
        : parseTitledText(rawText, { filename: resolved.filename });

    const entries = [];
    for (const candidate of parsed.entries) {
        const normalized = normalizePreviewEntry(candidate);
        normalized.content_hash = await hashSettingContent(entryHashPayload(normalized));
        entries.push(normalized);
    }
    const contentHash = await hashSettingContent(rawText);
    const duplicates = options.store ? findDuplicateSources(options.store, contentHash) : [];
    const emptyCount = entries.filter(entry => !entry.content).length;
    const warnings = [...parsed.warnings];
    if (emptyCount) warnings.push(`${emptyCount} imported entr${emptyCount === 1 ? 'y has' : 'ies have'} empty content; preserved for source fidelity.`);

    return {
        preview_version: IMPORT_PREVIEW_VERSION,
        format: parsed.format,
        filename: resolved.filename,
        mime_type: resolved.mime_type,
        content_hash: contentHash,
        raw_payload: rawText,
        entries,
        warnings,
        duplicate_source_ids: duplicates.map(source => source.source_id),
        metadata: {
            ...parsed.metadata,
            bytes: typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(rawText).length : rawText.length,
            constant_count: entries.filter(entry => entry.constant).length,
            disabled_count: entries.filter(entry => entry.disabled).length,
        },
    };
}

function assertPreview(preview) {
    if (!preview || typeof preview !== 'object') throw new Error('Missing import preview.');
    if (preview.preview_version !== IMPORT_PREVIEW_VERSION) throw new Error(`Unsupported import preview version: ${preview.preview_version}`);
    if (!['worldbook_json', 'titled_txt'].includes(preview.format)) throw new Error(`Unsupported import format: ${preview.format}`);
    if (!Array.isArray(preview.entries)) throw new Error('Import preview entries are missing.');
    if (!String(preview.content_hash || '').trim()) throw new Error('Import preview content hash is missing.');
}

function defaultWorldName(preview) {
    const filename = String(preview.filename || '').replace(/\\/g, '/').split('/').pop() || '';
    const stem = filename.replace(/\.[^.]+$/, '').trim();
    return stem || 'Imported World';
}

export async function commitImport(storeInput, preview, options = {}) {
    assertPreview(preview);
    let store = migrateSettingStore(storeInput).store;
    let world = null;
    let createdWorld = false;
    const requestedWorldId = String(options.world_id || '').trim();

    if (requestedWorldId) {
        world = store.worlds[requestedWorldId];
        if (!world) throw new Error(`Unknown world_id: ${requestedWorldId}`);
    } else {
        const created = createWorld(store, { name: String(options.world_name || '').trim() || defaultWorldName(preview) }, { now: options.now });
        store = created.store;
        world = created.world;
        createdWorld = true;
    }

    const duplicates = findDuplicateSources(store, preview.content_hash, { world_id: world.world_id });
    const duplicatePolicy = options.duplicate_policy || 'reject'; // reject | reuse_source | copy_source
    let source = null;
    let reusedSource = false;

    if (duplicates.length && duplicatePolicy === 'reject') {
        throw new Error(`Identical source content already exists in world ${world.world_id}: ${duplicates.map(row => row.source_id).join(', ')}`);
    }
    if (duplicates.length && duplicatePolicy === 'reuse_source') {
        source = duplicates[0];
        reusedSource = true;
    } else {
        const added = addSource(store, {
            world_id: world.world_id,
            format: preview.format,
            filename: preview.filename,
            content_hash: preview.content_hash,
            raw_payload: preview.raw_payload,
            metadata: {
                ...preview.metadata,
                import_preview_version: preview.preview_version,
            },
        }, { now: options.now });
        store = added.store;
        source = added.source;
    }

    const revisionKind = options.revision_kind === 'extension' ? 'extension' : 'baseline';
    const revisionLabel = String(options.revision_label || '').trim() || String(preview.filename || '').trim() || 'Imported revision';
    const addedRevision = addRevision(store, {
        world_id: world.world_id,
        source_id: source.source_id,
        revision_label: revisionLabel,
        revision_kind: revisionKind,
        parent_revision_id: options.parent_revision_id || null,
        base_revision_id: revisionKind === 'extension' ? (options.base_revision_id || null) : null,
    }, { now: options.now });
    store = addedRevision.store;
    const revision = addedRevision.revision;

    const rows = preview.entries.map(entry => ({
        world_id: world.world_id,
        source_id: source.source_id,
        revision_id: revision.revision_id,
        source_entry_id: entry.source_entry_id,
        title: entry.title,
        comment: entry.comment,
        content: entry.content,
        keys: entry.keys,
        secondary_keys: entry.secondary_keys,
        constant: entry.constant,
        disabled: entry.disabled,
        order: entry.order,
        raw_extra: entry.raw_extra,
        content_hash: entry.content_hash,
    }));
    const addedEntries = addEntries(store, rows, { now: options.now });
    store = addedEntries.store;

    if (options.activate !== false) {
        if (revisionKind === 'baseline') {
            store = setActiveBaselineRevision(store, world.world_id, revision.revision_id, { now: options.now });
        } else {
            const current = store.worlds[world.world_id];
            const nextExtensions = [...current.active_extension_revision_ids, revision.revision_id];
            store = setActiveExtensionRevisions(store, world.world_id, nextExtensions, { now: options.now });
        }
        store = setActiveWorld(store, world.world_id, { now: options.now });
    }

    return {
        store,
        world: store.worlds[world.world_id],
        source,
        revision,
        entries: addedEntries.entries,
        created_world: createdWorld,
        reused_source: reusedSource,
        duplicate_source_ids: duplicates.map(row => row.source_id),
    };
}
