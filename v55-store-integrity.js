// Aetheria Unified Memory v5.5 — chat metadata ownership guard.
// Canonical replay is allowed to replace the fields it owns, but it must not erase
// independently-owned v5.5 runtime state (setting binding, entity registry, summaries, etc.).

const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const MARKER = Symbol.for('aetheria.v55.metadata-integrity');

const CANONICAL_OWNED_KEYS = new Set([
    'version',
    'sequence',
    'memories',
    'slots',
    'source_fingerprints',
    'extractions',
    'last_active_state',
    'last_active_state_source',
    'last_event_summary',
    'last_extraction_debug',
    'last_errors',
    'last_recall_debug',
    'baseline',
    'vector',
]);

// These are intentionally rebuilt from the new Canonical/extraction state rather than
// preserved across a replay assignment.
const DERIVED_DROP_KEYS = new Set([
    'scene_summaries',
    'scene_summary_source',
    'scene_summary_fingerprint',
    'v55_consistency',
    'v55_finalizer_diagnostics',
]);

function clone(value) {
    if (value === undefined) return undefined;
    if (globalThis.structuredClone) return globalThis.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function mergeAuxiliaryChatState(previousInput, nextInput, dropKeysInput = null) {
    const previous = isObject(previousInput) ? previousInput : {};
    const next = isObject(nextInput) ? nextInput : {};
    const dropKeys = dropKeysInput instanceof Set ? dropKeysInput : (Array.isArray(dropKeysInput) ? new Set(dropKeysInput) : null);
    const out = { ...next };

    for (const [key, value] of Object.entries(previous)) {
        if (CANONICAL_OWNED_KEYS.has(key) || DERIVED_DROP_KEYS.has(key)) continue;
        // A key another store owns (the derived record) is never resurrected from the previous value:
        // that store is the authority. It is deliberately NOT deleted from the result. Deleting it
        // looked equivalent but was not: the object returned here is the one runtime readers read, so
        // deleting it made every derived key invisible to the plugin's own fold, cold-snapshot and
        // spine readers while the external record still held a copy. Keeping whatever the writer just
        // produced, and refusing only to resurrect what it did not, is the same guarantee for the
        // chat file (the serialization filter removes them at save time) without blinding the runtime.
        if (dropKeys && dropKeys.has(key)) continue;
        // Explicit null / empty / replacement values in the incoming store are authoritative; a key
        // that is merely absent, or present holding undefined, is not. normalizeStore spreads its
        // input, so an omitted auxiliary field can still arrive as an own property set to undefined,
        // and treating that as authoritative erased independently-owned state such as the summary tree
        // and the floor-fold audit.
        if (next[key] !== undefined) continue;
        out[key] = clone(value);
    }
    return out;
}

/**
 * Write a Canonical store without dropping independently-owned state.
 *
 * The property guard below only exists on the metadata object it was installed on, and SillyTavern
 * loads a chat by *assigning a brand-new* `chat_metadata` object (`chat_metadata = chatHeader.chat_metadata`)
 * — which no plugin can intercept. A store write that runs before the guard is re-installed would then
 * replace the store wholesale and take the summary tree and the floor-fold audit with it. Merging at
 * the write site makes the guarantee independent of whether the guard happens to be installed yet.
 */
export function writeMergedChatStore(chatMetadata, key, store, { dropKeys = null } = {}) {
    if (!isObject(chatMetadata)) return false;
    chatMetadata[key] = mergeAuxiliaryChatState(chatMetadata[key], store, dropKeys);
    applyStoreSerializationFilter(chatMetadata[key]);
    return true;
}

/**
 * The derived store owns the "do not serialise these keys" rule, but it cannot be imported here
 * without a cycle. It registers the rule instead, and every store object this module produces runs it.
 */
let storeSerializationFilter = null;

export function setStoreSerializationFilter(fn) {
    storeSerializationFilter = typeof fn === 'function' ? fn : null;
    return Boolean(storeSerializationFilter);
}

export function applyStoreSerializationFilter(store) {
    if (!storeSerializationFilter || !isObject(store)) return false;
    try { storeSerializationFilter(store); return true; } catch { return false; }
}

/**
 * Keys another store owns, so the property guard must not restore them into chat_metadata.
 *
 * Without this the guard undoes the projection: the derived store writes an already-stripped store,
 * the setter merges it against the previous value with no drop set, and every derived key comes back.
 * Set when a chat's external record is known to exist, cleared when the chat changes.
 */
let externallyOwnedKeys = null;

export function setExternallyOwnedKeys(keys) {
    externallyOwnedKeys = Array.isArray(keys) ? new Set(keys) : null;
    return externallyOwnedKeys ? externallyOwnedKeys.size : 0;
}

export function externallyOwnedKeyCount() {
    return externallyOwnedKeys ? externallyOwnedKeys.size : 0;
}

export function installMetadataIntegrityForContext(ctx) {
    const metadata = ctx?.chatMetadata;
    if (!isObject(metadata)) return false;
    if (metadata[MARKER]) return true;

    const descriptor = Object.getOwnPropertyDescriptor(metadata, METADATA_KEY);
    if (descriptor && descriptor.configurable === false) return false;

    let current = metadata[METADATA_KEY];
    Object.defineProperty(metadata, METADATA_KEY, {
        configurable: true,
        enumerable: true,
        get() {
            return current;
        },
        set(next) {
            current = mergeAuxiliaryChatState(current, next, externallyOwnedKeys);
            applyStoreSerializationFilter(current);
        },
    });
    Object.defineProperty(metadata, MARKER, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: true,
    });
    return true;
}

let eventsInstalled = false;

export function installV55StoreIntegrity(getContext = () => globalThis.SillyTavern?.getContext?.()) {
    const ctx = getContext?.();
    if (!ctx) return false;
    if (!installMetadataIntegrityForContext(ctx)) return false;

    if (!eventsInstalled && ctx.eventSource?.on) {
        const events = ctx.eventTypes || {};
        if (events.CHAT_CHANGED) {
            ctx.eventSource.on(events.CHAT_CHANGED, () => {
                // Synchronous first: a new chat_metadata object is unguarded until this runs, and a
                // store write from another handler in the same tick would otherwise be unguarded too.
                installMetadataIntegrityForContext(getContext?.());
                setTimeout(() => installMetadataIntegrityForContext(getContext?.()), 0);
            });
        }
        eventsInstalled = true;
    }
    return true;
}

// Install as early as module evaluation permits; bootstrap also calls this again after core init.
installV55StoreIntegrity();
