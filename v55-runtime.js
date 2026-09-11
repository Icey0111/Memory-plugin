// Aetheria Unified Memory v5.5 — iteration07 runtime hardening layer.
// Host-facing glue that preserves the mature v5.4 runtime while enforcing v5.5
// chat-scoped setting identity, canonical state authority and a combined prompt budget.

import { isDialogueRow } from './memory-core.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const REFERENCE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_reference';
const CURRENT_STATE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_current_state';

function clean(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

export function fnv1a32Runtime(input) {
    const str = String(input ?? '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function clone(value) {
    if (globalThis.structuredClone) return globalThis.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export function normalizeSettingBinding(input) {
    const row = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return {
        world_id: clean(row.world_id) || null,
        baseline_revision_id: clean(row.baseline_revision_id) || null,
        extension_revision_ids: unique(row.extension_revision_ids),
        pinned: row.pinned !== false,
        updated_at: Number.isFinite(Number(row.updated_at)) ? Number(row.updated_at) : null,
    };
}

export function bindingFromSettingStore(storeInput) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const worldId = clean(store.active_world_id) || null;
    const world = worldId ? store.worlds?.[worldId] : null;
    return normalizeSettingBinding({
        world_id: worldId,
        baseline_revision_id: world?.active_baseline_revision_id || null,
        extension_revision_ids: world?.active_extension_revision_ids || [],
        pinned: true,
    });
}

export function validateSettingBinding(storeInput, bindingInput) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const binding = normalizeSettingBinding(bindingInput);
    if (!binding.world_id) return { ok: true, binding };
    const world = store.worlds?.[binding.world_id];
    if (!world) return { ok: false, reason: 'world-not-found', binding };
    const baseline = binding.baseline_revision_id ? store.revisions?.[binding.baseline_revision_id] : null;
    if (binding.baseline_revision_id && (!baseline || baseline.world_id !== binding.world_id || baseline.revision_kind !== 'baseline')) {
        return { ok: false, reason: 'baseline-not-found-or-incompatible', binding };
    }
    const extensions = [];
    for (const id of binding.extension_revision_ids) {
        const revision = store.revisions?.[id];
        if (!revision || revision.world_id !== binding.world_id || revision.revision_kind !== 'extension') {
            return { ok: false, reason: `extension-not-found-or-incompatible:${id}`, binding };
        }
        if (revision.base_revision_id !== binding.baseline_revision_id) {
            return { ok: false, reason: `extension-base-mismatch:${id}`, binding };
        }
        extensions.push(id);
    }
    return { ok: true, binding: { ...binding, extension_revision_ids: extensions } };
}

export function projectSettingStore(storeInput, bindingInput) {
    const original = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const checked = validateSettingBinding(original, bindingInput);
    if (!checked.ok) return { store: original, applied: false, reason: checked.reason, binding: checked.binding };
    const binding = checked.binding;
    if (!binding.world_id) return { store: original, applied: false, reason: 'empty-binding', binding };
    const projected = clone(original);
    projected.active_world_id = binding.world_id;
    const world = projected.worlds?.[binding.world_id];
    if (!world) return { store: original, applied: false, reason: 'world-not-found-after-clone', binding };
    world.active_baseline_revision_id = binding.baseline_revision_id;
    world.active_extension_revision_ids = [...binding.extension_revision_ids];
    return { store: projected, applied: true, reason: null, binding };
}

function getChatStore(ctx) {
    if (!ctx?.chatMetadata) return null;
    const raw = ctx.chatMetadata[METADATA_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) ctx.chatMetadata[METADATA_KEY] = {};
    return ctx.chatMetadata[METADATA_KEY];
}

function getSettingStore(ctx) {
    return ctx?.extensionSettings?.[SETTINGS_KEY]?.setting_store || null;
}

export function ensureChatSettingBinding(ctx) {
    const chatStore = getChatStore(ctx);
    const settingStore = getSettingStore(ctx);
    if (!chatStore || !settingStore) return null;
    const existing = validateSettingBinding(settingStore, chatStore.setting_binding);
    if (existing.ok && existing.binding.world_id) return existing.binding;
    const fallback = bindingFromSettingStore(settingStore);
    chatStore.setting_binding = { ...fallback, updated_at: Date.now() };
    ctx.saveMetadataDebounced?.();
    return chatStore.setting_binding;
}

export function applyChatBindingProjection(ctx) {
    const settingsRoot = ctx?.extensionSettings?.[SETTINGS_KEY];
    if (!settingsRoot || typeof settingsRoot !== 'object') return { applied: false, reason: 'settings-unavailable' };
    const binding = ensureChatSettingBinding(ctx);
    const projected = projectSettingStore(settingsRoot.setting_store, binding);
    if (projected.applied) settingsRoot.setting_store = projected.store;
    return projected;
}

export function pinChatSettingBinding(ctx, input) {
    const chatStore = getChatStore(ctx);
    const settingStore = getSettingStore(ctx);
    if (!chatStore || !settingStore) return { ok: false, reason: 'store-unavailable' };
    const checked = validateSettingBinding(settingStore, input);
    if (!checked.ok) return checked;
    chatStore.setting_binding = { ...checked.binding, pinned: true, updated_at: Date.now() };
    ctx.saveMetadataDebounced?.();
    return { ok: true, binding: chatStore.setting_binding };
}

function currentChatId(ctx) {
    return clean(ctx?.getCurrentChatId?.() ?? ctx?.chatId) || null;
}

export function deriveBranchId(chatInput) {
    const rows = Array.isArray(chatInput) ? chatInput : [];
    const payload = rows.map((row, index) => {
        if (!row || !isDialogueRow(row)) return '';
        const role = row.is_user === true ? 'u' : 'a';
        const mes = clean(row.mes);
        const swipe = row.swipe_id ?? row.swipeId ?? '';
        return `${index}:${role}:${swipe}:${mes.length}:${fnv1a32Runtime(mes).toString(36)}`;
    }).filter(Boolean).join('|');
    return `br_${fnv1a32Runtime(payload).toString(36)}`;
}

function entitySeed(worldId, alias, discriminator = '') {
    return `${worldId || 'no-world'}|${discriminator}|${clean(alias).normalize('NFKC').toLocaleLowerCase()}`;
}

function registerEntity(registry, worldId, alias, discriminator = '', kind = 'unknown') {
    const name = clean(alias);
    if (!name) return null;
    const normalized = name.normalize('NFKC').toLocaleLowerCase();
    const existing = Object.values(registry).find(row => row?.discriminator === discriminator && (row?.aliases || []).some(x => clean(x).normalize('NFKC').toLocaleLowerCase() === normalized));
    if (existing) {
        existing.aliases = unique([...(existing.aliases || []), name]);
        return existing.entity_id;
    }
    const entityId = `ent_${fnv1a32Runtime(entitySeed(worldId, name, discriminator)).toString(36)}`;
    registry[entityId] = {
        entity_id: entityId,
        world_id: worldId || null,
        kind,
        canonical_name: name,
        aliases: [name],
        discriminator: discriminator || null,
    };
    return entityId;
}

function resolveEntityId(registry, alias, preferredDiscriminator = '') {
    const normalized = clean(alias).normalize('NFKC').toLocaleLowerCase();
    if (!normalized) return null;
    const rows = Object.values(registry).filter(row => (row?.aliases || []).some(x => clean(x).normalize('NFKC').toLocaleLowerCase() === normalized));
    if (!rows.length) return null;
    if (preferredDiscriminator) {
        // An explicit discriminator is authoritative: never fall back to a same-name entity that
        // belongs to a different scope, or two same-named characters would silently merge.
        const exact = rows.find(row => row.discriminator === preferredDiscriminator);
        return exact ? exact.entity_id : null;
    }
    return rows.length === 1 ? rows[0].entity_id : null;
}

/** Resolve the active speaking character/user identity for knowledge + secret visibility checks. */
export function deriveActorIdentity(ctx, storeInput = null) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : (getChatStore(ctx) || {});
    const aliases = unique([
        ctx?.name2,
        ctx?.character?.name,
        ctx?.characters?.[ctx?.characterId]?.name,
    ]).map(value => clean(value).normalize('NFKC').toLocaleLowerCase());
    const ids = [];
    const discriminator = ctx?.characterId !== undefined && ctx?.characterId !== null ? `st-character:${ctx.characterId}` : null;
    for (const row of Object.values(store?.entity_registry || {})) {
        if (!row?.entity_id) continue;
        if (discriminator && row.discriminator === discriminator) ids.push(row.entity_id);
        else if (!discriminator && (row.aliases || []).some(alias => aliases.includes(clean(alias).normalize('NFKC').toLocaleLowerCase()))) ids.push(row.entity_id);
    }
    return { aliases, ids: unique(ids) };
}

export function stampRuntimeIdentity(ctx) {
    const chatStore = getChatStore(ctx);
    if (!chatStore) return null;
    const binding = ensureChatSettingBinding(ctx) || normalizeSettingBinding(null);
    const chatId = currentChatId(ctx);
    const branchId = deriveBranchId(ctx?.chat || []);
    chatStore.runtime_identity = {
        world_id: binding.world_id,
        chat_id: chatId,
        branch_id: branchId,
        updated_at: Date.now(),
    };

    const registry = chatStore.entity_registry && typeof chatStore.entity_registry === 'object' && !Array.isArray(chatStore.entity_registry)
        ? chatStore.entity_registry
        : {};
    const charName = clean(ctx?.name2 || ctx?.character?.name || ctx?.characters?.[ctx?.characterId]?.name);
    const charDiscriminator = ctx?.characterId !== undefined && ctx?.characterId !== null ? `st-character:${ctx.characterId}` : '';
    const userName = clean(ctx?.name1);
    if (charName) registerEntity(registry, binding.world_id, charName, charDiscriminator, 'character');
    if (userName) registerEntity(registry, binding.world_id, userName, 'st-user', 'user');

    // Same display name must not imply the same entity. Host characters/users get a host
    // discriminator; story entities may carry an explicit scope/key from extraction so two
    // same-named characters stay separate instead of silently sharing one entity_id.
    const memoryDiscriminator = (memory, alias) => {
        const keyMap = memory && typeof memory.entity_keys === 'object' && !Array.isArray(memory.entity_keys) ? memory.entity_keys : {};
        const explicit = clean(keyMap?.[alias], 120) || clean(memory?.entity_scope, 120);
        return explicit ? `story:${explicit}` : '';
    };

    const memories = chatStore.memories && typeof chatStore.memories === 'object' ? chatStore.memories : {};
    for (const memory of Object.values(memories)) {
        if (!memory || typeof memory !== 'object') continue;
        const entityIds = [];
        for (const alias of unique(memory.entities)) {
            const discriminator = alias === charName ? charDiscriminator : memoryDiscriminator(memory, alias);
            let id = resolveEntityId(registry, alias, discriminator);
            if (!id) id = registerEntity(registry, binding.world_id, alias, discriminator, 'story-entity');
            if (id) entityIds.push(id);
        }
        const knownByIds = [];
        for (const alias of unique(memory.known_by)) {
            const discriminator = alias === charName ? charDiscriminator : (alias === userName ? 'st-user' : memoryDiscriminator(memory, alias));
            let id = resolveEntityId(registry, alias, discriminator);
            if (!id) id = registerEntity(registry, binding.world_id, alias, discriminator, 'story-entity');
            if (id) knownByIds.push(id);
        }
        memory.entity_ids = unique(entityIds);
        memory.known_by_ids = unique(knownByIds);
        memory.world_id = binding.world_id;
        memory.chat_id = chatId;
        memory.branch_id = branchId;
    }

    const extractions = chatStore.extractions && typeof chatStore.extractions === 'object' ? chatStore.extractions : {};
    for (const [sourceKey, record] of Object.entries(extractions)) {
        if (!record || typeof record !== 'object') continue;
        record.world_id = binding.world_id;
        record.chat_id = chatId;
        record.branch_id = branchId;
        record.transaction_id = record.transaction_id || `tx_${fnv1a32Runtime(`${chatId}|${branchId}|${sourceKey}|${record.source_hash ?? ''}`).toString(36)}`;
    }
    chatStore.entity_registry = registry;
    return chatStore.runtime_identity;
}

function canonicalLine(memory) {
    const slot = clean(memory?.slot);
    const label = [clean(memory?.kind) || 'state', slot].filter(Boolean).join(':');
    // The entity and holder attributes were opaque registry hashes ("ent_1h6kygz"), which a reader cannot
    // map to anything. Measured on a 50-floor chat: 62 rows carried 2,842 characters / 709 tokens of them,
    // 5% of the entire injection, for no answerability. Dropped. When the epistemic channel is built it
    // must render holder NAMES, not these ids.
    return `- [${label}] ${clean(memory?.text)}`;
}

const CANONICAL_KIND_WEIGHT = Object.freeze({ state: 7, intention: 6, commitment: 5, relation: 4, ownership: 4, knowledge: 3, belief: 2, world_delta: 1, event: 0 });

/**
 * Every live memory, in the order this file has always rendered canonical state: the most
 * consequential kinds first, then most recent, then a stable id tiebreak.
 *
 * Exported because the generation prompt now renders this exact list once, in topical groups,
 * instead of rendering it once as a flat summary and again as groups. Both renderings wanted the
 * same order, and duplicating the comparator is how the two drift apart.
 */
export function orderCanonicalMemories(storeInput) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const memories = Object.values(store.memories || {}).filter(memory => memory?.status === 'active' && clean(memory?.text));
    memories.sort((a, b) => (CANONICAL_KIND_WEIGHT[b.kind] || 0) - (CANONICAL_KIND_WEIGHT[a.kind] || 0)
        || Number(b.source_message ?? -1) - Number(a.source_message ?? -1)
        || clean(a.id).localeCompare(clean(b.id)));
    return memories;
}

export function buildCanonicalState(storeInput, maxChars = 12_000) {
    const lines = orderCanonicalMemories(storeInput).map(canonicalLine);
    let text = lines.join('\n');
    const cap = Math.max(0, Number(maxChars) || 0);
    if (cap && text.length > cap) text = `${text.slice(0, Math.max(0, cap - 42)).trimEnd()}\n…[canonical state truncated]`;
    return text;
}

export function enforceCanonicalState(ctx) {
    const chatStore = getChatStore(ctx);
    if (!chatStore) return '';
    stampRuntimeIdentity(ctx);
    const canonical = buildCanonicalState(chatStore);
    chatStore.last_active_state_diagnostic = clean(chatStore.last_active_state);
    chatStore.last_active_state = canonical;
    chatStore.last_active_state_source = 'canonical-memory';
    chatStore.current_state_authority = 'structured-memory-v55';
    return canonical;
}

export function computeCombinedPromptBudget({ contextSize, replyReserve, maxReferenceChars, maxCurrentStateChars }) {
    const configured = Math.max(0, Number(maxReferenceChars) || 0) + Math.max(0, Number(maxCurrentStateChars) || 0);
    const tokens = Number(contextSize);
    if (!Number.isFinite(tokens) || tokens <= 0) return configured;
    const reserve = Math.max(0, Number(replyReserve) || 0);
    const availableTokens = Math.max(0, tokens - reserve);
    return Math.min(configured, availableTokens * 2);
}

function truncate(text, cap, marker) {
    const src = String(text ?? '');
    const limit = Math.max(0, Math.floor(Number(cap) || 0));
    if (src.length <= limit) return src;
    if (limit <= marker.length + 2) return '';
    return `${src.slice(0, limit - marker.length - 1).trimEnd()}\n${marker}`;
}

export function budgetPromptPair(referenceBlock, currentStateBlock, options = {}) {
    const totalCap = computeCombinedPromptBudget(options);
    const maxState = Math.min(Math.max(0, Number(options.maxCurrentStateChars) || 0), totalCap);
    // Current state is authoritative and wins budget pressure over history/reference.
    const current = truncate(currentStateBlock, maxState, '…[current state truncated by combined budget]');
    const remaining = Math.max(0, totalCap - current.length);
    const maxReference = Math.min(Math.max(0, Number(options.maxReferenceChars) || 0), remaining);
    const reference = truncate(referenceBlock, maxReference, '…[reference truncated by combined budget]');
    return {
        referenceBlock: reference,
        currentStateBlock: current,
        diagnostics: {
            combined_cap_chars: totalCap,
            combined_used_chars: reference.length + current.length,
            reference_chars: reference.length,
            current_state_chars: current.length,
            reply_reserve_tokens: Math.max(0, Number(options.replyReserve) || 0),
        },
    };
}

export async function runWithV55Runtime(ctx, legacyInterceptor, args) {
    if (!ctx || typeof legacyInterceptor !== 'function') return;
    const settingsRoot = ctx.extensionSettings?.[SETTINGS_KEY];
    if (!settingsRoot || typeof settingsRoot !== 'object') return legacyInterceptor(...args);

    const originalStore = settingsRoot.setting_store;
    const binding = ensureChatSettingBinding(ctx);
    enforceCanonicalState(ctx);
    const projection = projectSettingStore(originalStore, binding);
    if (projection.applied) settingsRoot.setting_store = projection.store;

    const originalSetPrompt = typeof ctx.setExtensionPrompt === 'function' ? ctx.setExtensionPrompt.bind(ctx) : null;
    const captured = new Map();
    if (originalSetPrompt) {
        ctx.setExtensionPrompt = (key, value, ...rest) => {
            if (key === REFERENCE_PROMPT_KEY || key === CURRENT_STATE_PROMPT_KEY) {
                captured.set(key, { key, value: String(value ?? ''), rest });
                return;
            }
            return originalSetPrompt(key, value, ...rest);
        };
    }

    try {
        await legacyInterceptor(...args);
    } finally {
        if (originalSetPrompt) ctx.setExtensionPrompt = originalSetPrompt;
        settingsRoot.setting_store = originalStore;
    }

    if (originalSetPrompt && captured.size) {
        const reference = captured.get(REFERENCE_PROMPT_KEY) || { key: REFERENCE_PROMPT_KEY, value: '', rest: [] };
        const current = captured.get(CURRENT_STATE_PROMPT_KEY) || { key: CURRENT_STATE_PROMPT_KEY, value: '', rest: [] };
        const bounded = budgetPromptPair(reference.value, current.value, {
            contextSize: args?.[1],
            replyReserve: settingsRoot.context_reply_reserve_tokens,
            maxReferenceChars: settingsRoot.reference_context_max_chars,
            maxCurrentStateChars: settingsRoot.current_state_context_max_chars,
        });
        originalSetPrompt(reference.key, bounded.referenceBlock, ...reference.rest);
        originalSetPrompt(current.key, bounded.currentStateBlock, ...current.rest);
        const chatStore = getChatStore(ctx);
        if (chatStore) chatStore.runtime_budget = { ...bounded.diagnostics, at: Date.now() };
    }
}

function revisionRows(store, worldId, kind) {
    return Object.values(store?.revisions || {})
        .filter(row => row?.world_id === worldId && row?.revision_kind === kind)
        .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
}

function option(value, label, selected = false) {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    el.selected = selected;
    return el;
}

export function mountChatBindingUi(ctx) {
    if (typeof document === 'undefined' || document.getElementById('aum-v55-chat-binding')) return false;
    const host = document.getElementById('aum-v54-settings');
    if (!host) return false;
    const root = document.createElement('div');
    root.id = 'aum-v55-chat-binding';
    root.className = 'aum-v54-section';
    root.innerHTML = `
        <h4>v5.5 Chat Setting Binding</h4>
        <div class="flex-container flexFlowColumn">
            <label>World <select id="aum-v55-binding-world"></select></label>
            <label>Baseline revision <select id="aum-v55-binding-baseline"></select></label>
            <label>Extensions <select id="aum-v55-binding-extensions" multiple size="4"></select></label>
            <div class="flex-container">
                <button id="aum-v55-binding-pin" class="menu_button">Pin to current chat</button>
                <span id="aum-v55-binding-status" class="text_muted"></span>
            </div>
        </div>`;
    host.prepend(root);

    const worldEl = root.querySelector('#aum-v55-binding-world');
    const baselineEl = root.querySelector('#aum-v55-binding-baseline');
    const extEl = root.querySelector('#aum-v55-binding-extensions');
    const statusEl = root.querySelector('#aum-v55-binding-status');
    const render = () => {
        const store = getSettingStore(ctx) || {};
        const binding = ensureChatSettingBinding(ctx) || normalizeSettingBinding(null);
        worldEl.replaceChildren(option('', 'No plugin world', !binding.world_id));
        for (const world of Object.values(store.worlds || {})) worldEl.append(option(world.world_id, `${world.name} (${world.world_id})`, world.world_id === binding.world_id));
        const worldId = worldEl.value || binding.world_id || '';
        const baselines = revisionRows(store, worldId, 'baseline');
        baselineEl.replaceChildren(option('', 'No baseline', !binding.baseline_revision_id));
        for (const row of baselines) baselineEl.append(option(row.revision_id, `${row.revision_label} (${row.revision_id})`, row.revision_id === binding.baseline_revision_id));
        const baselineId = baselineEl.value || binding.baseline_revision_id || '';
        extEl.replaceChildren();
        for (const row of revisionRows(store, worldId, 'extension').filter(row => row.base_revision_id === baselineId)) {
            extEl.append(option(row.revision_id, `${row.revision_label} (${row.revision_id})`, binding.extension_revision_ids.includes(row.revision_id)));
        }
        statusEl.textContent = binding.world_id ? `Pinned: ${binding.world_id} / ${binding.baseline_revision_id || 'none'}` : 'No world pinned';
    };
    worldEl.addEventListener('change', () => {
        const store = getSettingStore(ctx) || {};
        const baselines = revisionRows(store, worldEl.value, 'baseline');
        baselineEl.replaceChildren(option('', 'No baseline', true), ...baselines.map(row => option(row.revision_id, `${row.revision_label} (${row.revision_id})`)));
        extEl.replaceChildren();
    });
    baselineEl.addEventListener('change', () => {
        const store = getSettingStore(ctx) || {};
        extEl.replaceChildren(...revisionRows(store, worldEl.value, 'extension')
            .filter(row => row.base_revision_id === baselineEl.value)
            .map(row => option(row.revision_id, `${row.revision_label} (${row.revision_id})`)));
    });
    root.querySelector('#aum-v55-binding-pin').addEventListener('click', () => {
        const result = pinChatSettingBinding(ctx, {
            world_id: worldEl.value || null,
            baseline_revision_id: baselineEl.value || null,
            extension_revision_ids: [...extEl.selectedOptions].map(row => row.value),
        });
        statusEl.textContent = result.ok ? 'Pinned to current chat.' : `Invalid binding: ${result.reason}`;
        if (result.ok) {
            applyChatBindingProjection(ctx);
            enforceCanonicalState(ctx);
        }
    });
    render();
    return true;
}

export function installV55Runtime(getContext, interceptorName) {
    const ctx = getContext?.();
    if (!ctx) return false;
    const legacy = globalThis[interceptorName];
    if (typeof legacy !== 'function' || legacy.__v55Wrapped) return false;
    const wrapped = async (...args) => {
        const current = getContext?.() || ctx;
        return runWithV55Runtime(current, legacy, args);
    };
    wrapped.__v55Wrapped = true;
    wrapped.__legacy = legacy;
    globalThis[interceptorName] = wrapped;

    const sync = () => {
        const current = getContext?.() || ctx;
        if (!current) return;
        ensureChatSettingBinding(current);
        applyChatBindingProjection(current);
        enforceCanonicalState(current);
        mountChatBindingUi(current);
    };
    const eventTypes = ctx.eventTypes || {};
    if (ctx.eventSource?.on && eventTypes.CHAT_CHANGED) ctx.eventSource.on(eventTypes.CHAT_CHANGED, sync);
    if (ctx.eventSource?.on && eventTypes.APP_READY) ctx.eventSource.on(eventTypes.APP_READY, () => setTimeout(sync, 0));
    setTimeout(sync, 900);
    return true;
}
