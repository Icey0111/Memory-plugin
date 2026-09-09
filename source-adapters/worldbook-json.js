// Aetheria Unified Memory v5.5 — SillyTavern World Info JSON import adapter.
//
// This adapter is deliberately data-only. Imported fields are normalized into
// SettingEntry candidates; unknown fields are preserved in raw_extra and are
// never interpreted as extension control instructions.

function cleanText(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

function stringList(value) {
    const source = Array.isArray(value) ? value : (typeof value === 'string' && value.trim() ? [value] : []);
    const out = [];
    const seen = new Set();
    for (const item of source) {
        const text = cleanText(item);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function firstMarkdownHeading(content) {
    const match = String(content ?? '').match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
    return match ? cleanText(match[1]) : null;
}

const KNOWN_ENTRY_FIELDS = new Set([
    'uid', 'id', 'title', 'comment', 'content', 'text',
    'key', 'keys', 'keysecondary', 'secondary_keys',
    'constant', 'disable', 'disabled', 'enabled', 'order',
    'secret', 'known_by', 'known_by_ids', 'visibility',
]);

function unknownFields(entry) {
    const extra = {};
    for (const [key, value] of Object.entries(entry || {})) {
        if (!KNOWN_ENTRY_FIELDS.has(key)) extra[key] = value;
    }
    return extra;
}

function entriesCollection(parsed) {
    if (Array.isArray(parsed)) return parsed.map((entry, index) => [String(index), entry]);
    if (!parsed || typeof parsed !== 'object') throw new Error('Worldbook JSON root must be an object or array.');
    if (Array.isArray(parsed.entries)) return parsed.entries.map((entry, index) => [String(index), entry]);
    if (parsed.entries && typeof parsed.entries === 'object') return Object.entries(parsed.entries);
    throw new Error('Unsupported Worldbook JSON: missing an entries object/array.');
}

export function parseWorldbookJson(rawText) {
    let parsed;
    try {
        parsed = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
    } catch (error) {
        throw new Error(`Invalid JSON: ${error?.message || error}`);
    }

    const rows = entriesCollection(parsed);
    const entries = [];
    const warnings = [];

    rows.forEach(([collectionKey, value], ordinal) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            warnings.push(`Entry ${collectionKey} is not an object and was skipped.`);
            return;
        }
        const content = cleanText(value.content ?? value.text ?? '');
        const comment = cleanText(value.comment ?? '') || null;
        const title = cleanText(value.title ?? '') || firstMarkdownHeading(content) || comment;
        const sourceEntryId = value.uid ?? value.id ?? collectionKey;
        const disabled = value.disable === true || value.disabled === true || value.enabled === false;

        entries.push({
            source_entry_id: typeof sourceEntryId === 'number' ? sourceEntryId : cleanText(sourceEntryId),
            title: title || null,
            comment,
            content,
            keys: stringList(value.key ?? value.keys),
            secondary_keys: stringList(value.keysecondary ?? value.secondary_keys),
            constant: value.constant === true,
            secret: value.secret === true || value.visibility === 'secret' || value.visibility === 'private',
            known_by: stringList(value.known_by ?? value.known_by_ids),
            disabled,
            order: finiteNumber(value.order),
            raw_extra: unknownFields(value),
            _source_ordinal: ordinal,
            _collection_key: collectionKey,
        });
    });

    return {
        format: 'worldbook_json',
        entries,
        warnings,
        metadata: {
            adapter: 'sillytavern-worldbook-json-v1',
            source_entry_count: rows.length,
            parsed_entry_count: entries.length,
            root_kind: Array.isArray(parsed) ? 'array' : 'object',
        },
    };
}
