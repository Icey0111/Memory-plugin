// Aetheria Unified Memory v5.5 — stable provenance registry.
// Keeps first-observed branch ownership stable even when the compatibility runtime
// recomputes the current branch id. Shared ancestors can be observed on later
// branches without being rewritten as if they were created there.

const METADATA_KEY = 'aetheriaUnifiedMemoryV54';

function clean(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

export function stabilizeProvenanceStore(storeInput, currentBranchId = null) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const branchId = clean(currentBranchId || store.runtime_identity?.branch_id) || null;
    const registry = store.provenance_registry && typeof store.provenance_registry === 'object' && !Array.isArray(store.provenance_registry)
        ? store.provenance_registry
        : { memories: {}, transactions: {} };
    registry.memories ||= {};
    registry.transactions ||= {};

    for (const [memoryId, memory] of Object.entries(store.memories || {})) {
        if (!memory || typeof memory !== 'object') continue;
        const existing = registry.memories[memoryId];
        if (!existing) {
            registry.memories[memoryId] = {
                origin_branch_id: clean(memory.branch_id) || branchId,
                seen_on_branches: unique([clean(memory.branch_id), branchId]),
                world_id: clean(memory.world_id) || null,
                chat_id: clean(memory.chat_id) || null,
            };
        } else {
            existing.seen_on_branches = unique([...(existing.seen_on_branches || []), branchId]);
            if (existing.origin_branch_id) memory.branch_id = existing.origin_branch_id;
        }
        memory.seen_on_branches = [...registry.memories[memoryId].seen_on_branches];
    }

    for (const [sourceKey, record] of Object.entries(store.extractions || {})) {
        if (!record || typeof record !== 'object') continue;
        const txId = clean(record.transaction_id) || `source:${sourceKey}`;
        const existing = registry.transactions[txId];
        if (!existing) {
            registry.transactions[txId] = {
                source_key: sourceKey,
                origin_branch_id: clean(record.branch_id) || branchId,
                seen_on_branches: unique([clean(record.branch_id), branchId]),
                world_id: clean(record.world_id) || null,
                chat_id: clean(record.chat_id) || null,
            };
        } else {
            existing.seen_on_branches = unique([...(existing.seen_on_branches || []), branchId]);
            if (existing.origin_branch_id) record.branch_id = existing.origin_branch_id;
        }
        record.seen_on_branches = [...registry.transactions[txId].seen_on_branches];
    }

    store.provenance_registry = registry;
    return store;
}

export function installV55Provenance(getContext) {
    const first = getContext?.();
    if (!first) return false;
    const stabilize = () => {
        const ctx = getContext?.() || first;
        const store = ctx?.chatMetadata?.[METADATA_KEY];
        if (!store) return;
        stabilizeProvenanceStore(store, store.runtime_identity?.branch_id);
        ctx.saveMetadataDebounced?.();
    };
    const schedule = () => setTimeout(stabilize, 20);
    const events = first.eventTypes || {};
    if (first.eventSource?.on) {
        for (const event of [
            events.APP_READY,
            events.CHAT_CHANGED,
            events.MESSAGE_RECEIVED,
            events.CHARACTER_MESSAGE_RENDERED,
            events.MESSAGE_SWIPED,
            events.MESSAGE_EDITED,
            events.MESSAGE_UPDATED,
            events.MESSAGE_DELETED,
        ]) {
            if (event) first.eventSource.on(event, schedule);
        }
    }
    setTimeout(stabilize, 1100);
    return true;
}
