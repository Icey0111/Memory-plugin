// Aetheria Unified Memory v5.5 — visibility propagation for derived records.
// Privacy is enforced on source operations before scene/hierarchical summaries are injected.

function clean(value, max = 30_000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizedName(value) {
    return clean(value, 500).normalize('NFKC').toLocaleLowerCase();
}

function unique(values, max = 100) {
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const text = clean(value, 500);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
        if (out.length >= max) break;
    }
    return out;
}

function normalizeActor(actorInput) {
    return {
        aliases: unique(actorInput?.aliases, 30).map(normalizedName),
        ids: unique(actorInput?.ids, 30),
    };
}

export function isOperationVisibleToActor(operation, actorInput) {
    const actor = normalizeActor(actorInput);
    const knownBy = unique(operation?.known_by, 50).map(normalizedName);
    const knownByIds = unique(operation?.known_by_ids, 50);
    if (!knownBy.length && !knownByIds.length) return true;
    if (knownByIds.some(id => actor.ids.includes(id))) return true;
    return knownBy.some(name => actor.aliases.includes(name));
}

export function analyzeExtractionVisibility(recordInput, actorInput) {
    const record = recordInput && typeof recordInput === 'object' ? recordInput : {};
    const operations = Array.isArray(record.operations) ? record.operations : [];
    const visibleOperations = [];
    const hiddenOperations = [];
    for (const operation of operations) {
        if (isOperationVisibleToActor(operation, actorInput)) visibleOperations.push(operation);
        else hiddenOperations.push(operation);
    }
    return {
        visibleOperations,
        hiddenOperations,
        hasHidden: hiddenOperations.length > 0,
        fullyHidden: operations.length > 0 && visibleOperations.length === 0,
    };
}

export function sanitizeExtractionRecordForActor(recordInput, actorInput) {
    const record = recordInput && typeof recordInput === 'object' ? recordInput : {};
    const visibility = analyzeExtractionVisibility(record, actorInput);
    if (!visibility.hasHidden) return { ...record, operations: [...visibility.visibleOperations] };

    // event_summary is free-form model text and may combine public + private operations.
    // Once any source operation is hidden, never reuse the original summary. Re-derive only
    // from visible source texts; if nothing visible remains the transaction disappears from
    // derived scene locators entirely.
    const visibleTexts = unique(
        visibility.visibleOperations
            .filter(operation => operation && operation.op !== 'noop')
            .map(operation => clean(operation.text, 1200))
            .filter(Boolean),
        12,
    );
    return {
        ...record,
        operations: [...visibility.visibleOperations],
        event_summary: visibleTexts.join('；'),
        active_state: '',
        __v55_visibility_redacted: true,
    };
}

export function sanitizeStoreForActor(storeInput, actorInput) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const extractions = {};
    const hiddenSourceKeys = [];
    let hiddenOperationCount = 0;

    for (const [key, record] of Object.entries(store.extractions || {})) {
        const visibility = analyzeExtractionVisibility(record, actorInput);
        hiddenOperationCount += visibility.hiddenOperations.length;
        if (visibility.hasHidden) hiddenSourceKeys.push(key);
        const sanitized = sanitizeExtractionRecordForActor(record, actorInput);
        // buildSceneSummaries already requires an event_summary; dropping an empty redacted
        // record guarantees that a fully private transaction cannot become a locator.
        if (clean(sanitized.event_summary, 5000)) extractions[key] = sanitized;
    }

    return {
        store: { ...store, extractions },
        hiddenSourceKeys,
        hiddenOperationCount,
    };
}

function turnIndexFromId(id) {
    const match = String(id || '').match(/^turn_(\d+)_/);
    return match ? Number(match[1]) : null;
}

function unsafeTurnIndexes(storeInput, actorInput) {
    const unsafe = new Set();
    for (const record of Object.values(storeInput?.extractions || {})) {
        const index = Number(record?.assistant_index_at_creation ?? record?.source_message);
        if (!Number.isFinite(index)) continue;
        if (analyzeExtractionVisibility(record, actorInput).hasHidden) unsafe.add(index);
    }
    return unsafe;
}

export function filterSummaryTreeForActor(treeInput, storeInput, actorInput) {
    const tree = treeInput && typeof treeInput === 'object' ? treeInput : {};
    const levels = {
        level1: Array.isArray(tree.level1) ? tree.level1 : [],
        level2: Array.isArray(tree.level2) ? tree.level2 : [],
        level3: Array.isArray(tree.level3) ? tree.level3 : [],
    };
    const byId = new Map([...levels.level1, ...levels.level2, ...levels.level3].map(row => [row.id, row]));
    const unsafeTurns = unsafeTurnIndexes(storeInput, actorInput);
    const memo = new Map();

    const visible = row => {
        if (!row?.id) return false;
        if (memo.has(row.id)) return memo.get(row.id);
        // Set pessimistically first to break malformed cycles.
        memo.set(row.id, false);
        const sources = Array.isArray(row.source_ids) ? row.source_ids : [];
        let ok = true;
        for (const sourceId of sources) {
            const turnIndex = turnIndexFromId(sourceId);
            if (Number.isFinite(turnIndex)) {
                if (unsafeTurns.has(turnIndex)) { ok = false; break; }
                continue;
            }
            const parent = byId.get(sourceId);
            if (parent && !visible(parent)) { ok = false; break; }
        }
        memo.set(row.id, ok);
        return ok;
    };

    return {
        level1: levels.level1.filter(visible),
        level2: levels.level2.filter(visible),
        level3: levels.level3.filter(visible),
        hidden_summary_ids: [...memo.entries()].filter(([, ok]) => !ok).map(([id]) => id),
        unsafe_turn_indexes: [...unsafeTurns],
    };
}
