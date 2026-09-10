// Aetheria Unified Memory v5.5 — derived chat state store.
//
// Principle: authoritative data stays portable with the chat; indices, caches, audits and
// diagnostics do not. Everything in DERIVED_KEYS is one of those four and now lives outside the chat
// file, in the TauriTavern host extension store when the host offers one and in IndexedDB otherwise.
// The chat still travels with the canonical memory, the extraction transactions, the slots, the
// hierarchical summaries, the entity registry, the runtime identity and the setting binding.
//
// Losing the derived store costs a rebuild, never a fact — with one exception that is handled here:
// the floor-fold audit. It is reproducible because every folded row carries its own marker, so
// unfoldAllFloors() falls back to scanning the chat when the audit is missing.
//
// Two safety rules, both learned the hard way:
//   1. Never write derived keys for a chat before hydration for that chat has finished. An
//      unhydrated store looks exactly like an empty one, and writing it would erase the real one.
//   2. Strip derived keys from chat_metadata only after hydration succeeded. If no backend is
//      reachable the keys simply stay in the chat file, which is the previous behaviour.

import { normalizeStore } from './memory-core.js';
import { setExternallyOwnedKeys, setStoreSerializationFilter, writeMergedChatStore } from './v55-store-integrity.js';

const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const NAMESPACE = 'aetheria-unified-memory-v55';
const TABLE = 'derived';
const RECORD_VERSION = 1;
const POINTER_KEY = 'derived_store';
const WRITE_DEBOUNCE_MS = 900;

/**
 * Keys that are an index, a cache, an audit or a diagnostic rather than a fact.
 *
 * Deliberately NOT here:
 *   vector, baseline      - tiny (a few hundred bytes) and a stripped copy would read as stale and
 *                           trigger a full rebuild before hydration lands;
 *   entity_registry       - losing it fragments entity identity for every later mention;
 *   runtime_identity      - the identity assignment itself is authoritative.
 */
export const DERIVED_KEYS = Object.freeze([
    'cold_turns',
    'scene_summaries',
    'scene_summary_source',
    'scene_summary_fingerprint',
    'floor_folds',
    'summary_history',
    'provenance_registry',
    'last_extraction_debug',
    'last_recall_debug',
    'last_errors',
    'v55_consistency',
    'v55_finalizer_diagnostics',
    'current_state_authority',
    'last_active_state_diagnostic',
    'v55_inner_bundle',
    // Iteration 14 S1/S2: the deterministic memory spine. It belongs here (it is an index over
    // operations that are themselves replayable) and can be, now that the ownership guard no longer
    // deletes externally-owned keys from the object runtime readers see.
    'spine',
]);

const DERIVED_SET = new Set(DERIVED_KEYS);

const getContext = () => globalThis.SillyTavern?.getContext?.();
const clean = (value, max = 400) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

let debounceTimer = null;
// The last derived keys known per chat. A write MERGES over this instead of replacing the record,
// because a store that has been reloaded without the external record yet carries fewer keys, and a
// wholesale replace would erase everything it does not happen to hold.
const recordCache = new Map();
let state = {
    backend: null,
    backendName: 'none',
    hydratedChat: null,
    hydration: null,
    migratedFromChat: false,
    lastWriteAt: null,
    lastReadAt: null,
    lastError: null,
    writes: 0,
    reads: 0,
    skippedUnhydrated: 0,
};

function chatIdentity(ctx) {
    const raw = clean(ctx?.getCurrentChatId?.() ?? ctx?.chatId, 400);
    if (!raw) return null;
    return raw.replace(/\.jsonl$/i, '');
}

function recordKey(chatId) {
    // The host store and IndexedDB both accept long keys, but hashing keeps a user-visible chat
    // name out of the persisted key space and makes the key stable across renames of the file suffix.
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    const text = String(chatId ?? '');
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    }
    return 'd_' + h1.toString(36) + '_' + h2.toString(36) + '_' + text.length.toString(36);
}

/** The key this chat's derived record is stored under. Exported for diagnostics and tests. */
export function derivedRecordKey(chatId) {
    return recordKey(chatId);
}

function hostBackend() {
    const host = globalThis.__TAURITAVERN__ || globalThis.window?.__TAURITAVERN__ || null;
    const store = host?.api?.extension?.store;
    if (!store || typeof store.setJson !== 'function' || typeof store.tryGetJson !== 'function') return null;
    const ready = async () => { try { await (host.ready ?? Promise.resolve()); } catch { /* the store still works before ready in practice */ } };
    return {
        name: 'tauritavern-extension-store',
        durable: true,
        async read(key) {
            await ready();
            const probe = await store.tryGetJson({ namespace: NAMESPACE, table: TABLE, key });
            if (probe && typeof probe === 'object' && 'found' in probe) return probe.found ? probe.value : null;
            return probe ?? null;
        },
        async write(key, value) {
            await ready();
            await store.setJson({ namespace: NAMESPACE, table: TABLE, key, value });
        },
        async remove(key) {
            await ready();
            if (typeof store.deleteJson !== 'function') { await store.setJson({ namespace: NAMESPACE, table: TABLE, key, value: null }); return; }
            try { await store.deleteJson({ namespace: NAMESPACE, table: TABLE, key }); } catch (error) {
                const text = String(error?.message ?? error ?? '').toLowerCase();
                if (!text.includes('not found') && !text.includes('notfound')) throw error;
            }
        },
    };
}

function indexedDbBackend() {
    if (typeof indexedDB === 'undefined') return null;
    const DB = 'aetheria_v55_derived';
    const STORE = 'chats';
    let dbPromise = null;
    const open = () => {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            let request;
            try { request = indexedDB.open(DB, 1); } catch (error) { reject(error); return; }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return dbPromise;
    };
    const run = async (mode, action) => {
        const db = await open();
        return new Promise((resolve, reject) => {
            let transaction;
            try { transaction = db.transaction(STORE, mode); } catch (error) { reject(error); return; }
            const request = action(transaction.objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    };
    return {
        name: 'indexeddb',
        durable: true,
        read: key => run('readonly', store => store.get(key)),
        write: (key, value) => run('readwrite', store => store.put(value, key)),
        remove: key => run('readwrite', store => store.delete(key)),
    };
}

const hydrationListeners = new Set();
let installed = false;

/** Called after a chat's derived keys land, so the prompt, fold styling and status can refresh. */
export function onDerivedHydrated(listener) {
    if (typeof listener === 'function') hydrationListeners.add(listener);
    return () => hydrationListeners.delete(listener);
}

function notifyHydrated(ctx, chatId) {
    for (const listener of [...hydrationListeners]) {
        try { listener(ctx, chatId); } catch { /* a listener must not break hydration */ }
    }
}

export function installV55DerivedStore(ctx = getContext()) {
    if (!state.backend) {
        state.backend = hostBackend() || indexedDbBackend();
        state.backendName = state.backend?.name || 'none';
    }
    if (!installed && ctx?.eventSource?.on) {
        const events = ctx.eventTypes || {};
        const on = (event, handler) => { if (event) ctx.eventSource.on(event, handler); };
        on(events.CHAT_CHANGED, () => {
            // A different chat owns a different derived record. Drop the claim, then hydrate the new
            // one on the next tick so the host has finished assigning its chat_metadata object.
            resetDerivedHydration();
            setTimeout(() => {
                const live = getContext();
                ensureDerivedHydrated(live).then(ok => { if (ok) notifyHydrated(live, chatIdentity(live)); }).catch(() => {});
            }, 0);
        });
        installed = true;
    }
    if (chatIdentity(ctx)) {
        ensureDerivedHydrated(ctx).then(ok => { if (ok) notifyHydrated(ctx, chatIdentity(ctx)); }).catch(() => {});
    }
    return Boolean(state.backend);
}

export function __resetDerivedInstallForTests() {
    installed = false;
    hydrationListeners.clear();
}

/**
 * True only when an external record owns this chat's derived keys. Without a durable backend this is
 * always false, which is what keeps the chat file the owner — the previous behaviour rather than a
 * silent data loss.
 */
export function derivedReady(ctx = getContext()) {
    if (!state.backend) return false;
    const chatId = chatIdentity(ctx);
    return Boolean(chatId) && state.hydratedChat === chatId;
}

export function hasDerivedBackend() {
    return Boolean(state.backend);
}

export function derivedBackendName() {
    return state.backendName;
}

export function derivedStoreStatus(ctx = getContext()) {
    const chatId = chatIdentity(ctx);
    const store = ctx?.chatMetadata?.[METADATA_KEY];
    const pointer = store?.[POINTER_KEY] || null;
    return {
        backend: state.backendName,
        durable: state.backend?.durable === true,
        chat_id: chatId,
        hydrated: Boolean(chatId) && state.hydratedChat === chatId,
        hydrated_at: null,
        migrated_from_chat: state.migratedFromChat,
        pointer,
        present_keys: DERIVED_KEYS.filter(key => store && Object.prototype.hasOwnProperty.call(store, key)),
        reads: state.reads,
        writes: state.writes,
        skipped_unhydrated: state.skippedUnhydrated,
        last_write_at: state.lastWriteAt,
        last_error: state.lastError,
        cached_keys: Object.keys(recordCache.get(chatId) || {}),
    };
}

/** Read one object with only the derived keys of a store. */
export function extractDerived(store) {
    const out = {};
    let count = 0;
    for (const key of DERIVED_KEYS) {
        if (!store || !Object.prototype.hasOwnProperty.call(store, key)) continue;
        out[key] = store[key];
        count += 1;
    }
    return { keys: out, count };
}

/**
 * Keep derived keys OUT OF THE CHAT FILE without removing them from memory.
 *
 * Stripping them from the live store looked simpler and was wrong: every runtime reader
 * (`store.cold_turns`, `store.floor_folds`, `store.scene_summaries`) reads the store object, so a
 * stripped store silently disabled the fold audit and the cold snapshot. SillyTavern serialises a chat
 * with `JSON.stringify` (`script.js` saveChat builds `{ chat_metadata: {...chat_metadata} }` and
 * stringifies that), and `JSON.stringify` honours a `toJSON` method — so the store keeps its derived
 * keys as ordinary readable properties and simply reports a projection when it is serialised.
 *
 * `toJSON` is installed non-enumerably so it never becomes chat data itself, and re-installed whenever
 * the store object is replaced (normalizeStore and the ownership merge both build a fresh object).
 */
export function installDerivedSerializationFilter(store, ctx = getContext()) {
    if (!store || typeof store !== 'object') return store;
    const ready = derivedReady(ctx);
    try {
        Object.defineProperty(store, 'toJSON', {
            configurable: true,
            enumerable: false,
            writable: true,
            value: function derivedProjection() {
                const out = {};
                for (const key of Object.keys(this)) {
                    if (DERIVED_SET.has(key) || key === 'toJSON') continue;
                    out[key] = this[key];
                }
                // Before hydration the chat file owns the derived keys, so it keeps them.
                if (!ready) {
                    for (const key of DERIVED_KEYS) {
                        if (Object.prototype.hasOwnProperty.call(this, key)) out[key] = this[key];
                    }
                    return out;
                }
                out[POINTER_KEY] = {
                    version: RECORD_VERSION,
                    backend: state.backendName,
                    chat_id: chatIdentity(ctx),
                    updated_at: state.lastWriteAt || Date.now(),
                };
                return out;
            },
        });
    } catch { /* a frozen store cannot be filtered; the chat file keeps the keys */ }
    return store;
}

// Every store object the ownership guard produces must carry the projection, not only the ones
// persistChatStore happens to rewrite: a module that assigns chat_metadata directly would otherwise
// put the derived keys into the chat file.
setStoreSerializationFilter(store => installDerivedSerializationFilter(store, getContext()));

function assignDerived(store, keys) {
    let applied = 0;
    for (const key of DERIVED_KEYS) {
        if (!keys || !Object.prototype.hasOwnProperty.call(keys, key)) continue;
        store[key] = keys[key];
        applied += 1;
    }
    return applied;
}

/**
 * Bring the derived keys for the current chat into the live store. Resolves true when the store is
 * usable (including the no-backend case, where the chat file remains the owner).
 */
export function ensureDerivedHydrated(ctx = getContext()) {
    const chatId = chatIdentity(ctx);
    if (!chatId) return Promise.resolve(false);
    const backend = state.backend;
    // No backend means no external owner: the chat file keeps the derived keys and nothing waits.
    if (!backend) return Promise.resolve(false);
    if (state.hydratedChat === chatId) return Promise.resolve(true);
    if (state.hydration && state.hydration.chatId === chatId) return state.hydration.promise;
    const promise = (async () => {
        const store = ctx?.chatMetadata?.[METADATA_KEY];
        let record = null;
        try {
            record = await backend.read(recordKey(chatId));
            state.reads += 1;
            state.lastReadAt = Date.now();
        } catch (error) {
            state.lastError = String(error?.message || error).slice(0, 240);
        }
        const fromBackend = record && record.chat_id === chatId && record.keys && typeof record.keys === 'object' ? record.keys : null;
        const inChat = extractDerived(store);
        if (fromBackend) {
            // Anything still in the chat but missing from the record is newer than the record (for
            // example the first launch after this feature shipped); take it as an overlay.
            const merged = { ...inChat.keys, ...fromBackend };
            recordCache.set(chatId, merged);
            if (store) assignDerived(store, merged);
            state.migratedFromChat = inChat.count > 0;
        } else if (inChat.count > 0) {
            // No record yet: migrate the chat-embedded copy out before anything strips it.
            try {
                await backend.write(recordKey(chatId), { version: RECORD_VERSION, chat_id: chatId, updated_at: Date.now(), keys: inChat.keys });
                state.writes += 1;
                state.lastWriteAt = Date.now();
                state.migratedFromChat = true;
            } catch (error) {
                state.lastError = String(error?.message || error).slice(0, 240);
                // Migration failed: leave the keys in the chat and do NOT claim the chat is hydrated,
                // so the projection keeps them and nothing is lost.
                return false;
            }
        } else {
            try { await backend.write(recordKey(chatId), { version: RECORD_VERSION, chat_id: chatId, updated_at: Date.now(), keys: {} }); state.writes += 1; state.lastWriteAt = Date.now(); } catch { /* a chat with nothing derived yet */ }
        }
        state.hydratedChat = chatId;
        // From here the external record owns the derived keys: the metadata guard must stop restoring
        // them into the chat store, and the store must stop serialising them into the chat file.
        setExternallyOwnedKeys(DERIVED_KEYS);
        installDerivedSerializationFilter(store, ctx);
        return true;
    })();
    state.hydration = { chatId, promise };
    return promise;
}

/**
 * Persist the derived keys. Skipped while unhydrated: an unhydrated store reads as empty, and
 * writing it would erase the stored copy.
 */
export function queueDerivedWrite(ctx = getContext(), store, { immediate = false } = {}) {
    const chatId = chatIdentity(ctx);
    if (!chatId || !store) return false;
    if (state.hydratedChat !== chatId) { state.skippedUnhydrated += 1; return false; }
    if (!state.backend) return false;
    const { keys, count } = extractDerived(store);
    // Monotonic: a key this store does not carry is taken from what was last written, never dropped.
    const merged = { ...(recordCache.get(chatId) || {}), ...keys };
    recordCache.set(chatId, merged);
    const payload = { version: RECORD_VERSION, chat_id: chatId, updated_at: Date.now(), keys: merged, count };
    const flush = async () => {
        debounceTimer = null;
        try {
            await state.backend.write(recordKey(chatId), payload);
            state.writes += 1;
            state.lastWriteAt = Date.now();
            state.lastError = null;
        } catch (error) {
            state.lastError = String(error?.message || error).slice(0, 240);
        }
    };
    if (debounceTimer) clearTimeout(debounceTimer);
    if (immediate) { void flush(); return true; }
    debounceTimer = setTimeout(() => { void flush(); }, WRITE_DEBOUNCE_MS);
    return true;
}

/**
 * Persist the live chat store through the projection. This is the ONLY place chat state should be
 * written: a module that mutates the store in place and then calls ctx.saveMetadataDebounced() puts its
 * derived keys straight into the chat file, where nothing will ever move them out. That is exactly what
 * happened to floor_folds and summary_history on the first live run of this feature.
 *
 * The derived write is debounced, so a hard crash can lose the last moments of derived state. That is
 * affordable by construction: every key in DERIVED_KEYS is either rebuildable from the chat (the fold
 * audit rebuilds from the per-row markers) or bounded and disposable (cold snapshots, diagnostics).
 */
export function persistChatStore(ctx = getContext(), store = null, { save = true } = {}) {
    if (!ctx?.chatMetadata) return null;
    const source = store || ctx.chatMetadata?.[METADATA_KEY];
    if (!source || typeof source !== 'object') return null;
    const normalized = normalizeStore(source);
    writeMergedChatStore(ctx.chatMetadata, METADATA_KEY, normalized);
    // The merge builds a fresh object, so the serialization filter has to be re-installed on it.
    installDerivedSerializationFilter(ctx.chatMetadata?.[METADATA_KEY], ctx);
    queueDerivedWrite(ctx, normalized);
    if (save) ctx.saveMetadataDebounced?.();
    return normalized;
}

export async function flushDerivedWrites() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    return true;
}

/** Forget the hydration claim (chat switch, tests). */
export function resetDerivedHydration() {
    setExternallyOwnedKeys(null);
    // The cache is per chat and must survive a chat switch, or switching back would start from an
    // empty record and the next write would erase it.
    state.hydratedChat = null;
    state.hydration = null;
    state.migratedFromChat = false;
}

/**
 * Bounded wait for hydration at prompt-assembly time. The generation interceptor is the one place
 * that must see the derived state, and it must never hang on a slow backend.
 */
export async function awaitDerivedReady(ctx = getContext(), budgetMs = 1500) {
    if (!state.backend || !chatIdentity(ctx)) return false;
    if (derivedReady(ctx)) return true;
    const timeout = new Promise(resolve => { setTimeout(() => resolve(false), Math.max(0, Number(budgetMs) || 0)); });
    return Promise.race([ensureDerivedHydrated(ctx).catch(() => false), timeout]);
}

export function __resetDerivedStateForTests() {
    setExternallyOwnedKeys(null);
    recordCache.clear();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    state = { backend: null, backendName: 'none', hydratedChat: null, hydration: null, migratedFromChat: false, lastWriteAt: null, lastReadAt: null, lastError: null, writes: 0, reads: 0, skippedUnhydrated: 0 };
}

export function __setDerivedBackendForTests(backend) {
    state.backend = backend;
    state.backendName = backend?.name || 'none';
}
