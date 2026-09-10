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

export function mergeAuxiliaryChatState(previousInput, nextInput) {
    const previous = isObject(previousInput) ? previousInput : {};
    const next = isObject(nextInput) ? nextInput : {};
    const out = { ...next };

    for (const [key, value] of Object.entries(previous)) {
        if (CANONICAL_OWNED_KEYS.has(key) || DERIVED_DROP_KEYS.has(key)) continue;
        // Explicit null / empty / replacement values in the incoming store are authoritative.
        // We only restore fields that a Canonical replay omitted entirely.
        if (Object.prototype.hasOwnProperty.call(next, key)) continue;
        out[key] = clone(value);
    }
    return out;
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
            current = mergeAuxiliaryChatState(current, next);
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
                setTimeout(() => installMetadataIntegrityForContext(getContext?.()), 0);
            });
        }
        eventsInstalled = true;
    }
    return true;
}

// Install as early as module evaluation permits; bootstrap also calls this again after core init.
installV55StoreIntegrity();
