/**
 * Aetheria Unified Memory v5.4 - autonomous extraction + hybrid retrieval memory core.
 * No SillyTavern globals are used in this file so it can be unit-tested in Node.
 */

import {
    SPINE_KEY,
    appendSpine,
    mandatoryMemories,
    provenanceChannel,
} from './v55-spine.js';

export const MEMORY_VERSION = '5.4';
export const MEMORY_KINDS = new Set([
    'event', 'state', 'knowledge', 'belief', 'relation',
    'commitment', 'ownership', 'intention', 'world_delta',
]);
export const MEMORY_STATUSES = new Set(['active', 'closed', 'superseded', 'invalid']);
export const MEMORY_IMPORTANCE = new Set(['low', 'medium', 'high', 'critical']);
export const MEMORY_EPISTEMIC = new Set(['fact', 'observed', 'reported', 'rumor', 'belief', 'inference', 'plan']);
export const MEMORY_OPS = new Set(['add', 'update', 'close', 'supersede', 'reinforce', 'invalidate', 'noop']);

/**
 * How a memory's holder came to know something and how strong the claim is are two different axes, and
 * the extractor prompt asks for both. Measured over 844 real operations, the model wrote `channel`
 * (saw 316 / heard 145 / inferred 120 / told 26) every time and `epistemic` never. The old default
 * (`op.kind === 'intention' ? 'plan' : 'fact'`) therefore published every belief and every inference to
 * the prompt as `epistemic="fact"` - the injection literal said a guess was a fact, which is the one
 * upgrade the extraction rules forbid. The channel vocabulary leaked in as a second source of the same
 * mistake, so it is accepted as an alias rather than allowed to invalidate the whole operation.
 */
const EPISTEMIC_ALIASES = Object.freeze({
    saw: 'observed', seen: 'observed', witnessed: 'observed',
    heard: 'reported', told: 'reported', reported: 'reported',
    inferred: 'inference', inference: 'inference', deduced: 'inference',
    guessed: 'belief', guess: 'belief', suspected: 'belief',
});

/** Resolve what the model meant, then fall back to the record's own kind. Never returns undefined. */
export function normalizeEpistemic(value, kind = '') {
    const raw = String(value ?? '').trim().toLowerCase();
    if (MEMORY_EPISTEMIC.has(raw)) return raw;
    if (EPISTEMIC_ALIASES[raw]) return EPISTEMIC_ALIASES[raw];
    // No usable value from the model: the kind is the only honest source. A belief is not a fact.
    if (kind === 'belief') return 'belief';
    if (kind === 'intention') return 'plan';
    return 'fact';
}

const ACTIVE_EXACT_KINDS = new Set(['state', 'intention', 'commitment']);
const ACTIVE_CONTEXTUAL_KINDS = new Set(['relation', 'ownership', 'knowledge', 'belief']);
const IMPORTANCE_WEIGHT = { low: 0, medium: 1, high: 2, critical: 3 };

/** FNV-1a 32-bit unsigned hash. Safe as a JS integer and accepted by ST vector metadata. */
export function fnv1a32(input) {
    const str = String(input ?? '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function stripSummaryForQuery(text) {
    return String(text ?? '')
        .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '')
        .replace(/<memory_ops\b[^>]*>[\s\S]*?<\/memory_ops>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function extractTagContent(text, tag) {
    const safeTag = String(tag).replace(/[^a-z0-9_-]/gi, '');
    const re = new RegExp(`<${safeTag}\\b[^>]*>([\\s\\S]*?)<\\/${safeTag}>`, 'i');
    const match = re.exec(String(text ?? ''));
    return match ? match[1].trim() : '';
}

/**
 * Extracts top-level JSON objects from a block. Supports one-line JSON and accidental pretty-printed JSON.
 * Text outside JSON objects is ignored and reported as a parse warning by parseMemoryOpsBlock.
 */
export function splitJsonObjects(block) {
    const src = String(block ?? '');
    const objects = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            if (depth > 0) depth--;
            if (depth === 0 && start >= 0) {
                objects.push(src.slice(start, i + 1));
                start = -1;
            }
        }
    }
    return { objects, unclosed: depth !== 0 || inString };
}

export function validateMemoryOp(op) {
    const errors = [];
    if (!op || typeof op !== 'object' || Array.isArray(op)) return ['operation must be a JSON object'];
    if (!MEMORY_OPS.has(op.op)) errors.push(`invalid op: ${String(op.op)}`);
    if (op.op === 'noop') {
        if (typeof op.reason !== 'string' || !op.reason.trim()) errors.push('noop requires reason');
        return errors;
    }
    if (op.op === 'add') {
        if (!MEMORY_KINDS.has(op.kind)) errors.push(`invalid kind: ${String(op.kind)}`);
        if (typeof op.text !== 'string' || !op.text.trim()) errors.push('add requires text');
    } else if (!op.target_id && !op.target_slot) {
        errors.push(`${op.op} requires target_id or target_slot`);
    }
    if (op.kind !== undefined && !MEMORY_KINDS.has(op.kind)) errors.push(`invalid kind: ${String(op.kind)}`);
    if (op.status !== undefined && !MEMORY_STATUSES.has(op.status)) errors.push(`invalid status: ${String(op.status)}`);
    if (op.importance !== undefined && !MEMORY_IMPORTANCE.has(op.importance)) errors.push(`invalid importance: ${String(op.importance)}`);
    // A value in the channel vocabulary is a wrong field name, not a wrong operation: dropping the op
    // loses a memory, so it is accepted here and resolved by normalizeEpistemic().
    if (op.epistemic !== undefined && !MEMORY_EPISTEMIC.has(op.epistemic)
        && !Object.prototype.hasOwnProperty.call(EPISTEMIC_ALIASES, String(op.epistemic ?? '').trim().toLowerCase())) {
        errors.push(`invalid epistemic: ${String(op.epistemic)}`);
    }
    if (op.scope !== undefined && op.scope !== null && (typeof op.scope !== 'string' || op.scope.length > 200)) errors.push('scope must be a string of at most 200 characters');
    if (typeof op.text === 'string' && op.text.length > 1200) errors.push('text exceeds 1200 characters');
    for (const key of ['entities', 'topics', 'known_by']) {
        if (op[key] !== undefined && (!Array.isArray(op[key]) || op[key].some(x => typeof x !== 'string'))) {
            errors.push(`${key} must be an array of strings`);
        } else if (Array.isArray(op[key]) && op[key].length > 20) {
            errors.push(`${key} must contain at most 20 items`);
        }
    }
    if (op.indexable !== undefined && typeof op.indexable !== 'boolean') errors.push('indexable must be boolean');
    return errors;
}

export function parseMemoryOpsBlock(block) {
    const { objects, unclosed } = splitJsonObjects(block);
    const ops = [];
    const errors = [];
    if (unclosed) errors.push('memory_ops contains an unclosed JSON object/string');
    if (!objects.length && String(block ?? '').trim()) errors.push('memory_ops contains no JSON object');
    objects.forEach((raw, index) => {
        try {
            const op = JSON.parse(raw);
            const validation = validateMemoryOp(op);
            if (validation.length) {
                errors.push(...validation.map(e => `op ${index}: ${e}`));
            } else {
                ops.push(op);
            }
        } catch (error) {
            errors.push(`op ${index}: invalid JSON: ${error.message}`);
        }
    });
    return { ops, errors };
}

export function parseMemoryOpsFromMessage(text) {
    const block = extractTagContent(text, 'memory_ops');
    if (!block) return { ops: [], errors: [], hasBlock: false };
    const parsed = parseMemoryOpsBlock(block);
    return { ...parsed, hasBlock: true };
}

export function extractSummarySections(text) {
    return {
        event: extractTagContent(text, 'event'),
        activeState: extractTagContent(text, 'active_state'),
        memoryOps: extractTagContent(text, 'memory_ops'),
    };
}

/**
 * The compact record-map encoding used in the chat file, and its decoder.
 *
 * The chat file writes one column per field instead of one key per field per record: the repeated key
 * names were 24,620 bytes of a 74-record store, more than the memory text they wrapped. The shape lives
 * HERE, next to the record definition, because decoding has to happen inside `normalizeStore` - the one
 * function every reader obtains a store through - and this module deliberately depends on nothing but
 * the deterministic spine. `v55-store-compact.js` imports these constants to build the same shape.
 */
export const STORE_COLUMNS_VERSION = 1;
export const STORE_COLUMNS_MARKER = '__columns';

export function decodeRecordMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    if (value[STORE_COLUMNS_MARKER] === undefined) return value;
    const keys = Array.isArray(value.keys) ? value.keys : [];
    const fields = Array.isArray(value.fields) ? value.fields : [];
    const rows = Array.isArray(value.rows) ? value.rows : [];
    const out = {};
    for (let i = 0; i < keys.length; i += 1) {
        const row = Array.isArray(rows[i]) ? rows[i] : [];
        const record = {};
        for (let j = 0; j < fields.length; j += 1) {
            const cell = row[j];
            // An empty cell is how the encoder writes every value no reader can tell apart from an
            // absent one: null, undefined, '' , false and []. A 0 survives as 0.
            if (cell === null || cell === undefined) continue;
            record[fields[j]] = cell;
        }
        out[keys[i]] = record;
    }
    return out;
}

export function createEmptyStore() {
    return {
        version: MEMORY_VERSION,
        sequence: 0,
        memories: {},
        slots: {},
        source_fingerprints: [],
        // v5.4 autonomous extraction records are stored by pair fingerprint.
        // They are the replayable machine transcript; Canonical memories are derived from them.
        extractions: {},
        last_active_state: '',
        last_active_state_source: null,
        last_event_summary: '',
        last_extraction_debug: null,
        last_errors: [],
        last_recall_debug: null,
        // Baseline metadata is derived from Persona / character card / bound+active World Info.
        // Baseline text itself is NOT copied into chat metadata; it is regenerated from host sources.
        baseline: {
            fingerprint: null,
            record_count: 0,
            vector_record_count: 0,
            source_count: 0,
            source_labels: [],
            last_built_at: null,
            last_gate_debug: null,
            vector: {
                collection_id: null,
                fingerprint: null,
                provider_fingerprint: null,
                stale: true,
                last_error: null,
                last_sync_at: null,
            },
        },
        vector: {
            collection_id: null,
            fingerprint: null,
            stale: true,
            last_error: null,
            last_sync_at: null,
        },
    };
}

export function normalizeStore(store) {
    const base = createEmptyStore();
    if (!store || typeof store !== 'object') return base;
    const out = { ...base, ...store };
    // The chat file stores these two maps column-encoded - one copy of each field name per map instead of
    // one per record (see v55-store-compact.js). Decoding at the single normalisation point is what keeps
    // every reader in the codebase seeing the plain object map it has always seen.
    out.memories = decodeRecordMap(store.memories);
    out.slots = store.slots && typeof store.slots === 'object' && !Array.isArray(store.slots) ? store.slots : {};
    out.source_fingerprints = Array.isArray(store.source_fingerprints) ? store.source_fingerprints : [];
    out.extractions = decodeRecordMap(store.extractions);
    out.last_event_summary = typeof store.last_event_summary === 'string' ? store.last_event_summary : '';
    out.last_extraction_debug = store.last_extraction_debug && typeof store.last_extraction_debug === 'object' ? store.last_extraction_debug : null;
    out.last_errors = Array.isArray(store.last_errors) ? store.last_errors : [];
    out.last_recall_debug = store.last_recall_debug && typeof store.last_recall_debug === 'object' ? store.last_recall_debug : null;
    const baselineInput = store.baseline && typeof store.baseline === 'object' ? store.baseline : {};
    out.baseline = {
        ...base.baseline,
        ...baselineInput,
        source_labels: Array.isArray(baselineInput.source_labels) ? baselineInput.source_labels : [],
        vector: { ...base.baseline.vector, ...(baselineInput.vector || {}) },
    };
    out.vector = { ...base.vector, ...(store.vector || {}) };
    out.version = MEMORY_VERSION;
    return out;
}

export function getDefaultStatus(kind) {
    return kind === 'event' ? 'closed' : 'active';
}

export function deriveMemoryId(sourceMessageIndex, opIndex, op) {
    const hash = fnv1a32(stableStringify(op)).toString(36);
    const source = Number(sourceMessageIndex);
    const index = Number(opIndex);
    return `m_${Number.isFinite(source) ? source : -1}_${Number.isFinite(index) ? index : -1}_${hash}`;
}

function uniqueStrings(input) {
    return [...new Set((Array.isArray(input) ? input : []).map(x => String(x).trim()).filter(Boolean))];
}

function resolveTarget(store, op) {
    if (op.target_id && store.memories[op.target_id]) return store.memories[op.target_id];
    if (op.target_slot) {
        const id = store.slots[op.target_slot];
        if (id && store.memories[id]) return store.memories[id];
        // Fallback for rebuilt stores where an old slot map was missing.
        const candidate = Object.values(store.memories).find(m => m.slot === op.target_slot && m.status === 'active');
        if (candidate) return candidate;
    }
    return null;
}

function removeSlotIfOwned(store, memory) {
    if (memory?.slot && store.slots[memory.slot] === memory.id) delete store.slots[memory.slot];
}

function activateSlot(store, memory, changedIds, sourceMessageIndex) {
    if (!memory.slot || memory.status !== 'active') return;
    const previousId = store.slots[memory.slot];
    if (previousId && previousId !== memory.id && store.memories[previousId]) {
        const previous = store.memories[previousId];
        // Same semantic slot means the previous current state is historical now.
        previous.status = ['belief', 'knowledge'].includes(memory.kind) ? 'superseded' : 'closed';
        previous.valid_until = sourceMessageIndex;
        previous.effective_until = sourceMessageIndex;
        previous.superseded_by = memory.id;
        changedIds.add(previous.id);
    }
    store.slots[memory.slot] = memory.id;
}

function sameText(a, b) {
    return String(a ?? '').trim().replace(/\s+/g, ' ') === String(b ?? '').trim().replace(/\s+/g, ' ');
}

function mergeRepeatedSlotAdd(store, op, context, changedIds) {
    if (!op.slot) return null;
    const existing = resolveTarget(store, { target_slot: op.slot });
    const incomingStatus = op.status || getDefaultStatus(op.kind);
    if (!existing || existing.status !== 'active' || incomingStatus !== 'active') return null;
    if (existing.kind !== op.kind || !sameText(existing.text, op.text)) return null;

    let changed = false;
    for (const key of ['entities', 'topics', 'known_by']) {
        if (op[key] === undefined) continue;
        const merged = uniqueStrings([...(existing[key] || []), ...op[key]]);
        if (stableStringify(merged) !== stableStringify(existing[key] || [])) {
            existing[key] = merged;
            changed = true;
        }
    }
    for (const key of ['importance', 'epistemic', 'indexable']) {
        if (op[key] !== undefined && existing[key] !== op[key]) {
            existing[key] = op[key];
            changed = true;
        }
    }
    existing.last_confirmed_message = context.sourceMessageIndex;
    if (changed) changedIds.add(existing.id);
    return existing;
}


/**
 * Extracts a small source-text evidence excerpt for an episodic memory.
 * It intentionally ignores <summary> so the evidence comes from narrative prose, not the model's own summary.
 */
export function findEvidenceExcerpt(sourceText, memoryLike, maxChars = 360) {
    const clean = stripSummaryForQuery(sourceText);
    if (!clean) return '';
    const needles = uniqueStrings([...(memoryLike?.entities || []), ...(memoryLike?.topics || [])])
        .map(x => x.toLocaleLowerCase())
        .filter(x => x.length >= 2);
    if (!needles.length) return '';
    const pieces = clean.split(/(?<=[。！？!?；;\n])/u).map(x => x.trim()).filter(Boolean);
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < pieces.length; i++) {
        const lower = pieces[i].toLocaleLowerCase();
        let score = 0;
        for (const needle of needles) if (lower.includes(needle)) score += Math.max(1, Math.min(4, needle.length / 2));
        if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    if (bestIndex < 0) return '';
    const selected = [pieces[bestIndex]];
    if (bestIndex + 1 < pieces.length) selected.push(pieces[bestIndex + 1]);
    if (bestIndex > 0 && selected.join('').length < maxChars * 0.6) selected.unshift(pieces[bestIndex - 1]);
    const joined = selected.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length <= maxChars) return joined;
    return `${joined.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function memoryFromAdd(store, op, context) {
    const id = deriveMemoryId(context.sourceMessageIndex, context.opIndex, op);
    if (store.memories[id]) return store.memories[id];
    const status = op.status || getDefaultStatus(op.kind);
    const memory = {
        id,
        kind: op.kind,
        slot: typeof op.slot === 'string' && op.slot.trim() ? op.slot.trim() : null,
        text: String(op.text).trim(),
        entities: uniqueStrings(op.entities),
        topics: uniqueStrings(op.topics),
        status,
        importance: op.importance || 'medium',
        epistemic: normalizeEpistemic(op.epistemic, op.kind),
        known_by: uniqueStrings(op.known_by),
        indexable: op.indexable === true,
        source_message: context.sourceMessageIndex,
        source_op_index: context.opIndex,
        source_hash: context.sourceHash ?? null,
        evidence_excerpt: findEvidenceExcerpt(context.sourceMessageText || '', op),
        // S6: how this holder came to know it. Deterministic, with an explicit op.channel override.
        channel: provenanceChannel(op, { kind: op.kind, text: op.text, epistemic: op.epistemic }),
        // Three separate time/scope notions: when it was said (recorded_at), the interval it
        // applies to (effective_*), and the situation it applies in (scope).
        recorded_at: context.sourceMessageIndex,
        scope: typeof op.scope === 'string' && op.scope.trim() ? op.scope.trim().slice(0, 200) : null,
        valid_from: context.sourceMessageIndex,
        valid_until: ['closed', 'superseded', 'invalid'].includes(status) ? context.sourceMessageIndex : null,
        effective_from: context.sourceMessageIndex,
        effective_until: ['closed', 'superseded', 'invalid'].includes(status) ? context.sourceMessageIndex : null,
        created_seq: ++store.sequence,
        reinforcement: 0,
        recalled_count: 0,
        last_recalled_message: null,
        supersedes: null,
        superseded_by: null,
        close_reason: null,
        invalid_reason: null,
        vector_hash: null,
        quality_flags: [],
    };
    if (!memory.evidence_excerpt && ['event', 'knowledge', 'belief', 'relation', 'commitment', 'ownership', 'world_delta'].includes(memory.kind)) {
        memory.quality_flags.push('no_source_evidence');
    }
    store.memories[id] = memory;
    return memory;
}

/**
 * Applies parsed memory operations in order. Mutates store.
 * Returns changed memory ids and semantic errors that should be shown in diagnostics.
 */
export function applyMemoryOps(storeInput, ops, context = {}) {
    const store = normalizeStore(storeInput);
    const changedIds = new Set();
    const spineRecords = [];
    const errors = [];
    const sourceMessageIndex = Number(context.sourceMessageIndex ?? -1);
    const sourceHash = context.sourceHash ?? null;
    const sourceMessageText = String(context.sourceMessageText ?? '');

    ops.forEach((op, opIndex) => {
        const opContext = { sourceMessageIndex, sourceHash, sourceMessageText, opIndex };
        const validation = validateMemoryOp(op);
        if (validation.length) {
            errors.push(...validation.map(e => `op ${opIndex}: ${e}`));
            return;
        }
        if (op.op === 'noop') return;

        // S1/S2: every applied operation becomes exactly one spine node. Recording happens here, in
        // the single place that already mutates memory, so the spine can never disagree with the
        // memories it describes, and a replay rebuilds it identically.
        const spineRecord = {
            op: op.op,
            kind: op.kind || null,
            slot: op.slot || null,
            memory_id: null,
            target_id: op.target_id || null,
            superseded_by: null,
        };

        if (op.op === 'add') {
            const repeated = mergeRepeatedSlotAdd(store, op, opContext, changedIds);
            if (repeated) {
                // A repeated identical add is a confirmation, not a new fact: the spine records the
                // confirmation against the memory that already exists.
                spineRecord.memory_id = repeated.id;
                spineRecord.kind = repeated.kind;
                spineRecord.slot = repeated.slot;
                spineRecords.push(spineRecord);
                return;
            }
            const memory = memoryFromAdd(store, op, opContext);
            activateSlot(store, memory, changedIds, sourceMessageIndex);
            changedIds.add(memory.id);
            spineRecord.memory_id = memory.id;
            spineRecord.kind = memory.kind;
            spineRecord.slot = memory.slot;
            spineRecords.push(spineRecord);
            return;
        }

        const target = resolveTarget(store, op);
        if (!target) {
            errors.push(`op ${opIndex}: target not found (${op.target_id || op.target_slot})`);
            return;
        }

        if (op.op === 'update') {
            const oldSlot = target.slot;
            // The value this update is about to overwrite. `update` rewrites the record in place, so
            // without this the previous value exists nowhere at all - the spine node names the slot but
            // not what it held - and the plan's S2 acceptance ("any slot enumerates its full history")
            // silently held only for `supersede`. Measured on the extractor's own output, `update` is
            // used 56 times against `supersede`'s 20, so this is the common path, not the corner.
            const previousText = typeof target.text === 'string' ? target.text : null;
            const editable = ['kind', 'slot', 'text', 'status', 'importance', 'epistemic', 'indexable'];
            for (const key of editable) {
                if (op[key] !== undefined) target[key] = key === 'slot' ? (String(op[key]).trim() || null) : op[key];
            }
            // `epistemic` is derived from `kind` when the model does not state it, so a kind change has to
            // re-derive it or an event stays labelled with the belief it used to be.
            if (op.kind !== undefined && op.epistemic === undefined) target.epistemic = normalizeEpistemic(undefined, target.kind);
            for (const key of ['entities', 'topics', 'known_by']) {
                if (op[key] !== undefined) target[key] = uniqueStrings(op[key]);
            }
            if (sourceMessageText && (op.text !== undefined || op.entities !== undefined || op.topics !== undefined)) {
                const evidence = findEvidenceExcerpt(sourceMessageText, target);
                if (evidence) {
                    target.evidence_excerpt = evidence;
                    target.quality_flags = (target.quality_flags || []).filter(x => x !== 'no_source_evidence');
                }
            }
            if (oldSlot && oldSlot !== target.slot && store.slots[oldSlot] === target.id) delete store.slots[oldSlot];
            if (['closed', 'superseded', 'invalid'].includes(target.status)) {
                target.valid_until = sourceMessageIndex;
                target.effective_until = sourceMessageIndex;
                removeSlotIfOwned(store, target);
            } else {
                target.valid_until = null;
                target.effective_until = null;
                activateSlot(store, target, changedIds, sourceMessageIndex);
            }
            changedIds.add(target.id);
            spineRecord.target_id = target.id;
            spineRecord.kind = target.kind;
            spineRecord.slot = target.slot;
            if (previousText && previousText !== target.text) spineRecord.prev_text = previousText;
            spineRecords.push(spineRecord);
            return;
        }

        if (op.op === 'close') {
            target.status = 'closed';
            target.valid_until = sourceMessageIndex;
            target.effective_until = sourceMessageIndex;
            target.close_reason = typeof op.reason === 'string' ? op.reason.trim() : null;
            removeSlotIfOwned(store, target);
            changedIds.add(target.id);
            spineRecord.target_id = target.id;
            spineRecord.kind = target.kind;
            spineRecord.slot = target.slot;
            spineRecords.push(spineRecord);
            return;
        }

        if (op.op === 'invalidate') {
            target.status = 'invalid';
            target.valid_until = sourceMessageIndex;
            target.effective_until = sourceMessageIndex;
            target.invalid_reason = typeof op.reason === 'string' ? op.reason.trim() : null;
            removeSlotIfOwned(store, target);
            changedIds.add(target.id);
            spineRecord.target_id = target.id;
            spineRecord.kind = target.kind;
            spineRecord.slot = target.slot;
            spineRecords.push(spineRecord);
            return;
        }

        if (op.op === 'reinforce') {
            target.reinforcement = Number(target.reinforcement || 0) + 1;
            if (op.importance !== undefined) target.importance = op.importance;
            target.last_reinforced_at = sourceMessageIndex;
            changedIds.add(target.id);
            spineRecord.target_id = target.id;
            spineRecord.kind = target.kind;
            spineRecord.slot = target.slot;
            spineRecords.push(spineRecord);
            return;
        }

        if (op.op === 'supersede') {
            target.status = 'superseded';
            target.valid_until = sourceMessageIndex;
            target.effective_until = sourceMessageIndex;
            removeSlotIfOwned(store, target);
            changedIds.add(target.id);
            if (op.kind && op.text) {
                // A supersede that names a target_slot but omits `slot` is replacing that slot's value, so
                // the replacement has to inherit the slot. Without this the new record is created with
                // `slot: null`, the old one has already released the slot, and the slot map ends up with
                // NO current value at all - so the change chain renders nothing for a slot that visibly
                // changed, and the next turn's extraction sees the state as unknown. Measured: the
                // extractor writes `supersede` + `target_slot` and no `slot` as its normal shape.
                const inheritedSlot = typeof op.slot === 'string' && op.slot.trim() ? op.slot : (target.slot || null);
                const addLike = {
                    op: 'add',
                    kind: op.kind,
                    slot: inheritedSlot,
                    text: op.text,
                    entities: op.entities,
                    topics: op.topics,
                    status: op.status || 'active',
                    importance: op.importance,
                    epistemic: op.epistemic,
                    known_by: op.known_by,
                    indexable: op.indexable,
                };
                const memory = memoryFromAdd(store, addLike, opContext);
                memory.supersedes = target.id;
                target.superseded_by = memory.id;
                activateSlot(store, memory, changedIds, sourceMessageIndex);
                changedIds.add(memory.id);
                spineRecord.memory_id = memory.id;
                spineRecord.superseded_by = memory.id;
                spineRecord.kind = memory.kind;
                spineRecord.slot = memory.slot;
            }
            spineRecord.target_id = target.id;
            spineRecords.push(spineRecord);
        }
    });

    appendSpine(store, spineRecords, { sourceMessageIndex });
    // normalizeStore copies the store, so a caller still holding the input object would otherwise
    // never see the spine it just produced.
    if (storeInput && typeof storeInput === 'object' && !storeInput[SPINE_KEY]) storeInput[SPINE_KEY] = store[SPINE_KEY];

    return { store, changedIds: [...changedIds], errors };
}

export function buildRetrievalText(memory) {
    if (!memory) return '';
    const entities = uniqueStrings(memory.entities);
    const topics = uniqueStrings(memory.topics);
    const scope = typeof memory.scope === 'string' && memory.scope.trim() ? `{${memory.scope.trim()}}` : '';
    const left = [entities.join(', '), topics.join(', ')].filter(Boolean).join(' — ');
    return `${scope ? `${scope} ` : ''}${left ? `[${left}] ` : ''}${String(memory.text ?? '').trim()}`.trim();
}

export function shouldIndexMemory(memory) {
    if (!Boolean(memory?.indexable)
        || !['active', 'closed'].includes(memory.status)
        || typeof memory.text !== 'string'
        || !memory.text.trim()) return false;
    // Evidence Gate: weak, summary-only memories remain in the canonical store for audit,
    // but are not allowed to become self-reinforcing vector memories unless explicitly high-value.
    if ((memory.quality_flags || []).includes('no_source_evidence')
        && ['low', 'medium'].includes(memory.importance || 'medium')
        && !['state', 'intention'].includes(memory.kind)) return false;
    return true;
}


export function isMemorySettled(memory, chatLength, settleMessages = 0) {
    const settle = Math.max(0, Number(settleMessages) || 0);
    if (settle === 0) return true;
    const source = Number(memory?.source_message);
    const length = Math.max(0, Number(chatLength) || 0);
    if (!Number.isFinite(source)) return false;
    return source <= length - 1 - settle;
}

export function computeVectorHash(memory) {
    return fnv1a32(`${memory.id}|${buildRetrievalText(memory)}`);
}

export function getIndexableMemories(storeInput) {
    const store = normalizeStore(storeInput);
    return Object.values(store.memories).filter(shouldIndexMemory);
}

export function collectOpsSources(chat) {
    const sources = [];
    (Array.isArray(chat) ? chat : []).forEach((message, index) => {
        const mes = String(message?.mes ?? '');
        if (!/<memory_ops\b[^>]*>/i.test(mes)) return;
        sources.push({ index, hash: fnv1a32(mes) });
    });
    return sources;
}

export function sourcesArePrefix(previous, current) {
    if (!Array.isArray(previous) || !Array.isArray(current) || previous.length > current.length) return false;
    for (let i = 0; i < previous.length; i++) {
        if (Number(previous[i]?.index) !== Number(current[i]?.index) || Number(previous[i]?.hash) !== Number(current[i]?.hash)) return false;
    }
    return true;
}

export function findLatestActiveState(chat) {
    for (let i = (Array.isArray(chat) ? chat.length : 0) - 1; i >= 0; i--) {
        const mes = String(chat[i]?.mes ?? '');
        const active = extractTagContent(mes, 'active_state');
        if (active) return { text: active, source: i, hash: fnv1a32(active) };
    }
    return { text: '', source: null, hash: 0 };
}

export function replayStoreFromChat(chat) {
    let store = createEmptyStore();
    const errors = [];
    const sources = collectOpsSources(chat);
    for (const source of sources) {
        const mes = String(chat[source.index]?.mes ?? '');
        const parsed = parseMemoryOpsFromMessage(mes);
        errors.push(...parsed.errors.map(e => `message ${source.index}: ${e}`));
        const previousMes = source.index > 0 ? String(chat[source.index - 1]?.mes ?? '') : '';
        const sourceEvidenceText = `${previousMes}\n${mes}`;
        const applied = applyMemoryOps(store, parsed.ops, { sourceMessageIndex: source.index, sourceHash: source.hash, sourceMessageText: sourceEvidenceText });
        store = applied.store;
        errors.push(...applied.errors.map(e => `message ${source.index}: ${e}`));
    }
    const active = findLatestActiveState(chat);
    store.source_fingerprints = sources;
    store.last_active_state = active.text;
    store.last_active_state_source = active.source;
    store.last_errors = errors.slice(-100);
    return { store, errors };
}


/**
 * Extra flag this plugin stamps on a chat row it folded into a hierarchical summary.
 *
 * Folding marks the row `is_system = true` so SillyTavern drops it from the model prompt, which is
 * the only prompt-visible effect the host offers. That flag is simultaneously how the host expresses
 * "the user hid this with /hide", so every plugin-side reader of chat history has to tell the two
 * apart: a folded row is still real dialogue for extraction, identity and evidence purposes, it is
 * only gone from the prompt. Without this distinction the memory system would forget the very turns
 * it just summarized.
 */
export const FOLD_EXTRA_KEY = 'aetheria_v55_folded';

/** True only for rows this plugin folded out of the prompt (as opposed to a host /hide). */
export function isFoldedRow(row) {
    return Boolean(row && row.is_system === true && row.extra && typeof row.extra === 'object' && row.extra[FOLD_EXTRA_KEY]);
}

/** True when a row is absent from the model prompt for any reason, ours or the host's. */
export function isPromptHiddenRow(row) {
    return Boolean(row && row.is_system === true);
}

/**
 * True when the *host* hid a row and this plugin did not — SillyTavern's own /hide, or an inserted
 * system note. Those rows are absent from the prompt and were never meant to be remembered.
 */
export function isHostHiddenRow(row) {
    return Boolean(row && row.is_system === true && !isFoldedRow(row));
}

/**
 * True when a row still counts as dialogue for the memory system. Folded rows do; rows the user hid
 * with the host's own /hide command do not, because the user never meant those to be remembered.
 */
export function isDialogueRow(row) {
    return Boolean(row && !isHostHiddenRow(row));
}

/** Return the nearest preceding user message for an assistant message index. */
export function findPrecedingUserMessage(chat, assistantIndex) {
    const rows = Array.isArray(chat) ? chat : [];
    for (let i = Number(assistantIndex) - 1; i >= 0; i--) {
        const msg = rows[i];
        if (!msg || !isDialogueRow(msg)) continue;
        if (msg.is_user === true) return { index: i, text: String(msg.mes ?? '') };
        // Stop at another assistant message: this keeps the source pair local and deterministic.
        if (msg.is_user === false) break;
    }
    return { index: null, text: '' };
}

/**
 * Fingerprint one assistant turn and its closest preceding user turn.
 * Includes role markers and lengths to make accidental FNV collisions less likely in practice.
 */
export function computeDialoguePairFingerprint(chat, assistantIndex) {
    const rows = Array.isArray(chat) ? chat : [];
    const assistant = rows[assistantIndex];
    if (!assistant || assistant.is_user === true || !isDialogueRow(assistant)) return null;
    const user = findPrecedingUserMessage(rows, assistantIndex);
    const userText = stripSummaryForQuery(user.text);
    const assistantText = stripSummaryForQuery(String(assistant.mes ?? ''));
    const payload = `u:${userText.length}:${userText}\u0000a:${assistantText.length}:${assistantText}`;
    const hash = fnv1a32(payload);
    return {
        key: `x_${hash.toString(36)}_${userText.length}_${assistantText.length}`,
        hash,
        assistantIndex: Number(assistantIndex),
        userIndex: user.index,
        userText,
        assistantText,
    };
}

export function collectAutonomousExtractionSources(chat, extractionsInput = {}) {
    const extractions = extractionsInput && typeof extractionsInput === 'object' ? extractionsInput : {};
    const rows = Array.isArray(chat) ? chat : [];
    const out = [];
    for (let i = 0; i < rows.length; i++) {
        const pair = computeDialoguePairFingerprint(rows, i);
        if (!pair) continue;
        const record = extractions[pair.key];
        if (!record || Number(record.source_hash) !== Number(pair.hash)) continue;
        out.push({ ...pair, record });
    }
    return out;
}

/**
 * Rebuild Canonical Memory from v5.4 autonomous extraction records.
 * Legacy <memory_ops> messages can optionally be replayed for migration when no autonomous
 * record exists for that assistant turn.
 */
export function replayStoreFromExtractions(chat, extractionInput = {}, { includeLegacyMessageOps = true } = {}) {
    const extractionMap = extractionInput && typeof extractionInput === 'object' ? extractionInput : {};
    let store = createEmptyStore();
    store.extractions = { ...extractionMap };
    const errors = [];
    const usedLegacy = new Set();
    const rows = Array.isArray(chat) ? chat : [];
    let latestActive = { text: '', source: null };
    let latestEvent = '';

    for (let i = 0; i < rows.length; i++) {
        const pair = computeDialoguePairFingerprint(rows, i);
        if (!pair) continue;
        const record = extractionMap[pair.key];
        if (record && Number(record.source_hash) === Number(pair.hash)) {
            const ops = Array.isArray(record.operations) ? record.operations : [];
            const applied = applyMemoryOps(store, ops, {
                sourceMessageIndex: i,
                sourceHash: pair.hash,
                sourceMessageText: `${pair.userText}\n${pair.assistantText}`,
            });
            store = applied.store;
            store.extractions = { ...extractionMap };
            errors.push(...applied.errors.map(e => `autonomous message ${i}: ${e}`));
            if (String(record.active_state || '').trim()) latestActive = { text: String(record.active_state).trim(), source: i };
            if (String(record.event_summary || '').trim()) latestEvent = String(record.event_summary).trim();
            continue;
        }
        if (includeLegacyMessageOps && /<memory_ops\b[^>]*>/i.test(String(rows[i]?.mes ?? ''))) {
            const parsed = parseMemoryOpsFromMessage(rows[i].mes);
            const applied = applyMemoryOps(store, parsed.ops, {
                sourceMessageIndex: i,
                sourceHash: fnv1a32(String(rows[i].mes ?? '')),
                sourceMessageText: `${pair.userText}\n${pair.assistantText}`,
            });
            store = applied.store;
            store.extractions = { ...extractionMap };
            usedLegacy.add(i);
            errors.push(...parsed.errors.map(e => `legacy message ${i}: ${e}`));
            errors.push(...applied.errors.map(e => `legacy message ${i}: ${e}`));
            const sections = extractSummarySections(rows[i].mes);
            if (sections.activeState) latestActive = { text: sections.activeState, source: i };
            if (sections.event) latestEvent = sections.event;
        }
    }

    store.source_fingerprints = collectAutonomousExtractionSources(rows, extractionMap)
        .map(x => ({ index: x.assistantIndex, hash: x.hash }));
    store.last_active_state = latestActive.text;
    store.last_active_state_source = latestActive.source;
    store.last_event_summary = latestEvent;
    store.last_errors = errors.slice(-100);
    return { store, errors, usedLegacy: [...usedLegacy] };
}

/**
 * S4: the mandatory baseline. These are injected whatever recall decides, so an irreversible change
 * can never be missed merely because the current query did not look similar to it.
 */
export function getMandatoryMemories(storeInput, limit = 24) {
    return mandatoryMemories(normalizeStore(storeInput), { limit });
}

export function getActiveMemories(storeInput, queryText = '', maxItems = 12) {
    const store = normalizeStore(storeInput);
    const query = String(queryText ?? '').toLowerCase();
    const candidates = Object.values(store.memories).filter(m => {
        if (m.status !== 'active') return false;
        if ((m.quality_flags || []).includes('no_source_evidence')
            && ['low', 'medium'].includes(m.importance || 'medium')
            && !['state', 'intention'].includes(m.kind)) return false;
        if (ACTIVE_EXACT_KINDS.has(m.kind)) return true;
        if (!ACTIVE_CONTEXTUAL_KINDS.has(m.kind)) return false;
        const entityMatch = (m.entities || []).some(e => e && query.includes(String(e).toLowerCase()));
        return entityMatch || IMPORTANCE_WEIGHT[m.importance] >= IMPORTANCE_WEIGHT.high;
    });
    const kindWeight = { state: 6, intention: 5, commitment: 4, relation: 3, ownership: 2, knowledge: 1, belief: 1 };
    candidates.sort((a, b) =>
        (kindWeight[b.kind] || 0) - (kindWeight[a.kind] || 0)
        || (IMPORTANCE_WEIGHT[b.importance] || 0) - (IMPORTANCE_WEIGHT[a.importance] || 0)
        || Number(b.source_message || 0) - Number(a.source_message || 0));
    return candidates.slice(0, Math.max(0, Number(maxItems) || 0));
}

export function buildQueryText(chat, queryMessages = 3, maxChars = 8000) {
    const messages = (Array.isArray(chat) ? chat : [])
        .filter(m => isDialogueRow(m))
        .map(m => ({ ...m, clean: stripSummaryForQuery(m?.mes) }))
        .filter(m => m.clean)
        .slice(-Math.max(1, Number(queryMessages) || 1));
    const joined = messages.map(m => `${m.name ? `${m.name}: ` : ''}${m.clean}`).join('\n');
    return joined.slice(-Math.max(500, Number(maxChars) || 8000)).trim();
}


function xmlEscape(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Normalize text for local lexical matching. */
export function normalizeHybridText(text) {
    return String(text ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Chinese-friendly lightweight tokenizer.
 * - Latin/digit words are preserved.
 * - CJK runs emit 2- and 3-grams (plus single char for one-char runs).
 * This is intentionally dependency-free so the extension can run offline.
 */
export function tokenizeHybridText(text) {
    const normalized = normalizeHybridText(text);
    const out = [];
    for (const match of normalized.matchAll(/[a-z0-9_]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
        const token = match[0];
        if (/^[a-z0-9_]+$/u.test(token)) {
            if (token.length >= 2) out.push(token);
            continue;
        }
        const chars = Array.from(token);
        if (chars.length === 1) out.push(chars[0]);
        for (const n of [2, 3]) {
            if (chars.length < n) continue;
            for (let i = 0; i <= chars.length - n; i++) out.push(chars.slice(i, i + n).join(''));
        }
    }
    return out;
}

function countTokens(tokens) {
    const map = new Map();
    for (const t of tokens) map.set(t, (map.get(t) || 0) + 1);
    return map;
}

function memorySearchText(memory) {
    return [memory?.text, ...(memory?.entities || []), ...(memory?.topics || [])].filter(Boolean).join(' ');
}

function exactEntityMatches(query, memory) {
    const q = normalizeHybridText(query).replace(/\s+/g, '');
    return uniqueStrings(memory?.entities).filter(entity => {
        const e = normalizeHybridText(entity).replace(/\s+/g, '');
        return e.length >= 2 && q.includes(e);
    });
}

/**
 * Local BM25-like lexical retrieval. Exact entities receive a protected bonus,
 * which is our lightweight equivalent of an entity shield.
 */
export function lexicalSearchMemories(storeInput, queryText, options = {}) {
    const store = normalizeStore(storeInput);
    const limit = Math.max(1, Number(options.limit ?? 24));
    const protectRecent = Math.max(0, Number(options.protectRecent ?? 0));
    const chatLength = Math.max(0, Number(options.chatLength ?? 0));
    const docs = Object.values(store.memories).filter(m => {
        if (!shouldIndexMemory(m)) return false;
        if (protectRecent > 0 && chatLength > 0 && Number(m.source_message) >= chatLength - protectRecent) return false;
        return true;
    });
    if (!docs.length) return [];
    const queryTokens = tokenizeHybridText(queryText);
    if (!queryTokens.length) return [];
    const qtf = countTokens(queryTokens);
    const tokenized = docs.map(memory => {
        const tokens = tokenizeHybridText(memorySearchText(memory));
        return { memory, tokens, tf: countTokens(tokens), length: Math.max(1, tokens.length) };
    });
    const avgLen = tokenized.reduce((sum, d) => sum + d.length, 0) / tokenized.length;
    const df = new Map();
    for (const doc of tokenized) {
        for (const token of new Set(doc.tokens)) df.set(token, (df.get(token) || 0) + 1);
    }
    const N = tokenized.length;
    const k1 = 1.2, b = 0.75;
    const results = [];
    for (const doc of tokenized) {
        let score = 0;
        for (const [token, qCount] of qtf.entries()) {
            const tf = doc.tf.get(token) || 0;
            if (!tf) continue;
            const dfi = df.get(token) || 0;
            const idf = Math.log(1 + (N - dfi + 0.5) / (dfi + 0.5));
            const denom = tf + k1 * (1 - b + b * doc.length / Math.max(1, avgLen));
            score += idf * (tf * (k1 + 1) / denom) * Math.min(2, qCount);
        }
        const entityMatches = exactEntityMatches(queryText, doc.memory);
        if (entityMatches.length) score += 3.2 + Math.min(3, entityMatches.length - 1) * 0.8;
        const qNorm = normalizeHybridText(queryText);
        const topicMatches = uniqueStrings(doc.memory.topics).filter(t => {
            const n = normalizeHybridText(t);
            return n.length >= 2 && qNorm.includes(n);
        });
        if (topicMatches.length) score += Math.min(2.4, topicMatches.length * 0.8);
        if (score > 0) results.push({ memory: doc.memory, score, entityMatches, topicMatches });
    }
    results.sort((a, b) => b.score - a.score || Number(b.memory.source_message || 0) - Number(a.memory.source_message || 0));
    return results.slice(0, limit);
}

function vectorMetadataToMemories(storeInput, metadata, options = {}) {
    const store = normalizeStore(storeInput);
    const protectRecent = Math.max(0, Number(options.protectRecent ?? 0));
    const chatLength = Math.max(0, Number(options.chatLength ?? 0));
    const hashMap = new Map();
    for (const m of Object.values(store.memories)) {
        if (m.vector_hash != null) hashMap.set(Number(m.vector_hash), m);
    }
    const out = [];
    const seen = new Set();
    for (const meta of Array.isArray(metadata) ? metadata : []) {
        const memory = hashMap.get(Number(meta?.hash));
        if (!memory || seen.has(memory.id) || !shouldIndexMemory(memory)) continue;
        if (protectRecent > 0 && chatLength > 0 && Number(memory.source_message) >= chatLength - protectRecent) continue;
        seen.add(memory.id);
        out.push(memory);
    }
    return out;
}

/** Backward-compatible dense-only helper used by old tests and diagnostics. */
export function filterRecalledMemories(storeInput, vectorMetadata, options = {}) {
    const finalCount = Math.max(0, Number(options.finalCount ?? 6));
    return vectorMetadataToMemories(storeInput, vectorMetadata, options).slice(0, finalCount);
}

/** Build two dense query views: immediate focus and broader recent context. */
export function buildQueryVariants(chat, queryMessages = 3, maxChars = 8000) {
    const clean = (Array.isArray(chat) ? chat : [])
        .filter(m => isDialogueRow(m))
        .map(m => ({ ...m, clean: stripSummaryForQuery(m?.mes) }))
        .filter(m => m.clean);
    if (!clean.length) return [];
    const last = clean[clean.length - 1];
    const focus = `${last.name ? `${last.name}: ` : ''}${last.clean}`.slice(-Math.min(3200, maxChars)).trim();
    const context = buildQueryText(clean, queryMessages, maxChars);
    const variants = [];
    if (focus) variants.push({ name: 'focus', text: focus, weight: 1.0 });
    if (context && context !== focus) variants.push({ name: 'context', text: context, weight: 0.82 });
    return variants;
}

/**
 * Weighted reciprocal-rank fusion with dense-gated lexical candidates.
 * Lexical-only memories are accepted only when they contain an exact entity mention,
 * preventing homonym/keyword noise while retaining rare-name recall.
 */
export function fuseHybridCandidates(storeInput, denseLists, lexicalList, options = {}) {
    const store = normalizeStore(storeInput);
    const rrfK = Math.max(1, Number(options.rrfK ?? 60));
    const denseWeights = Array.isArray(options.denseWeights) ? options.denseWeights : [];
    const lexicalWeight = Number(options.lexicalWeight ?? 0.9);
    const denseGate = options.denseGate !== false;
    const importanceBonus = { low: 0, medium: 0.012, high: 0.026, critical: 0.045 };
    const currentMessage = Number(options.currentMessage ?? 0);
    const cooldownTurns = Math.max(0, Number(options.cooldownTurns ?? 4));
    const byId = new Map();
    const denseIds = new Set();
    const add = (memory) => {
        if (!memory) return null;
        if (!byId.has(memory.id)) byId.set(memory.id, { memory, score: 0, channels: [], entityBypass: false });
        return byId.get(memory.id);
    };
    (Array.isArray(denseLists) ? denseLists : []).forEach((list, listIndex) => {
        const weight = Number(denseWeights[listIndex] ?? (listIndex === 0 ? 1 : 0.82));
        (Array.isArray(list) ? list : []).forEach((memory, rankIndex) => {
            if (!memory?.id) return;
            denseIds.add(memory.id);
            const row = add(memory);
            row.score += weight / (rrfK + rankIndex + 1);
            row.channels.push(`dense${listIndex + 1}`);
        });
    });
    // Structured channel: precise candidates selected by effective-time window / scope rather than
    // semantic similarity. They bypass the Dense Gate because they are not lexical guesses.
    const structuredLists = Array.isArray(options.structuredLists) ? options.structuredLists : [];
    const structuredWeight = Number(options.structuredWeight ?? 0.8);
    structuredLists.forEach((list, listIndex) => {
        (Array.isArray(list) ? list : []).forEach((entry, rankIndex) => {
            const memory = entry?.memory || entry;
            if (!memory?.id) return;
            const row = add(memory);
            row.score += structuredWeight / (rrfK + rankIndex + 1);
            row.channels.push(`structured${listIndex + 1}`);
        });
    });
    (Array.isArray(lexicalList) ? lexicalList : []).forEach((item, rankIndex) => {
        const memory = item?.memory || item;
        if (!memory) return;
        const bypass = Array.isArray(item?.entityMatches) && item.entityMatches.length > 0;
        if (denseGate && !denseIds.has(memory.id) && !bypass) return; // Dense Gate
        const row = add(memory);
        row.score += lexicalWeight / (rrfK + rankIndex + 1);
        row.channels.push('lexical');
        if (bypass && !denseIds.has(memory.id)) {
            row.entityBypass = true;
            row.score += 0.006;
        }
    });
    for (const row of byId.values()) {
        row.score += importanceBonus[row.memory.importance] || 0;
        row.score += Math.min(0.025, Number(row.memory.reinforcement || 0) * 0.003);
        if ((row.memory.quality_flags || []).includes('no_source_evidence')) {
            row.score *= 0.82;
            row.evidencePenalty = 0.82;
        }
        // Never-recalled and recalled-at-message-0 are not the same thing, and `Number(null)` is 0 - so the
        // old guard treated a memory that had never been recalled as recalled at the very start of the chat
        // and penalised it hardest exactly when the chat was short enough for that stamp to fall inside the
        // cooldown window. Requiring a positive value is what the cooldown always meant.
        const last = Number(row.memory.last_recalled_message);
        if (cooldownTurns > 0 && Number.isFinite(last) && last > 0 && currentMessage > last) {
            const age = currentMessage - last;
            if (age <= cooldownTurns) {
                const penalty = 0.42 + 0.58 * (age / (cooldownTurns + 1));
                row.score *= penalty;
                row.cooldownPenalty = penalty;
            }
        }
    }
    return [...byId.values()].sort((a, b) => b.score - a.score);
}

function importanceBonusOf(memory) {
    return { low: 0, medium: 0.012, high: 0.026, critical: 0.045 }[memory?.importance] || 0;
}

/**
 * Query-time temporal channel. `recorded_at` is when it was said (immutable), `effective_from` /
 * `effective_until` is the interval the assertion applies to, and `scope` is the situation it
 * applies in. Returns active memories whose effective window covers `asOfIndex`.
 */
export function selectTemporalCandidates(storeInput, { asOfIndex = null, scope = null, limit = 8, protectRecent = 0, chatLength = 0 } = {}) {
    const store = normalizeStore(storeInput);
    const asOf = Number.isFinite(Number(asOfIndex)) ? Number(asOfIndex) : Number.MAX_SAFE_INTEGER;
    const cap = Math.max(1, Math.min(100, Number(limit) || 8));
    const scopeKey = typeof scope === 'string' && scope.trim() ? scope.trim().toLowerCase() : null;
    const protect = Math.max(0, Number(protectRecent) || 0);
    const length = Math.max(0, Number(chatLength) || 0);
    const rows = [];
    for (const memory of Object.values(store.memories || {})) {
        if (!memory || memory.status !== 'active' || !String(memory.text || '').trim()) continue;
        if (protect > 0 && length > 0 && Number(memory.source_message) >= length - protect) continue;
        const from = Number.isFinite(Number(memory.effective_from))
            ? Number(memory.effective_from)
            : Number(memory.recorded_at ?? memory.source_message ?? 0);
        const untilRaw = memory.effective_until;
        const until = untilRaw === null || untilRaw === undefined ? null : Number(untilRaw);
        if (Number.isFinite(from) && from > asOf) continue;
        if (until !== null && Number.isFinite(until) && until < asOf) continue;
        const memoryScope = String(memory.scope || '').trim().toLowerCase();
        const scopeMatch = Boolean(scopeKey && memoryScope
            && (memoryScope === scopeKey || memoryScope.startsWith(scopeKey) || scopeKey.startsWith(memoryScope)));
        if (scopeKey && memoryScope && !scopeMatch) continue;
        const recency = Number.isFinite(from) ? Math.max(0, 1 - (asOf - from) / 512) : 0;
        const score = 0.3 + recency * 0.5 + (scopeMatch ? 0.3 : 0) + importanceBonusOf(memory);
        rows.push({ memory, score, reason: scopeMatch ? 'scope' : 'effective-window' });
    }
    rows.sort((a, b) => b.score - a.score || Number(b.memory.source_message ?? -1) - Number(a.memory.source_message ?? -1));
    return rows.slice(0, cap);
}

function rarityMap(memories, selector) {
    const df = new Map();
    for (const memory of memories) {
        for (const value of new Set(uniqueStrings(selector(memory)).map(normalizeHybridText))) {
            if (value) df.set(value, (df.get(value) || 0) + 1);
        }
    }
    return df;
}

function memoryGraphTerms(memory, entityDf, topicDf, total) {
    const terms = new Map();
    for (const e of uniqueStrings(memory.entities)) {
        const key = normalizeHybridText(e);
        const d = entityDf.get(key) || 1;
        if (!key || d / Math.max(1, total) > 0.45) continue; // suppress ubiquitous protagonist/entity hubs
        terms.set(`e:${key}`, Math.log(1 + total / d) * 1.25);
    }
    for (const t of uniqueStrings(memory.topics)) {
        const key = normalizeHybridText(t);
        const d = topicDf.get(key) || 1;
        if (!key || d / Math.max(1, total) > 0.60) continue;
        terms.set(`t:${key}`, Math.log(1 + total / d));
    }
    return terms;
}

/** Lightweight PPR-like diffusion over shared rare entities/topics. */
export function graphDiffuseCandidates(storeInput, candidates, options = {}) {
    const store = normalizeStore(storeInput);
    const rows = (Array.isArray(candidates) ? candidates : []).map(x => ({ ...x }));
    if (rows.length < 2) return rows;
    const all = Object.values(store.memories).filter(shouldIndexMemory);
    const entityDf = rarityMap(all, m => m.entities || []);
    const topicDf = rarityMap(all, m => m.topics || []);
    const total = Math.max(1, all.length);
    const termMaps = rows.map(r => memoryGraphTerms(r.memory, entityDf, topicDf, total));
    const adj = rows.map(() => []);
    for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
            let w = 0;
            for (const [term, wi] of termMaps[i]) if (termMaps[j].has(term)) w += Math.min(wi, termMaps[j].get(term));
            if (rows[i].memory.supersedes === rows[j].memory.id || rows[j].memory.supersedes === rows[i].memory.id) w += 1.5;
            if (w > 0) { adj[i].push([j, w]); adj[j].push([i, w]); }
        }
    }
    const baseSum = rows.reduce((s, r) => s + Math.max(0, r.score), 0) || 1;
    const base = rows.map(r => Math.max(0, r.score) / baseSum);
    let p = [...base];
    const damping = Math.min(0.35, Math.max(0, Number(options.damping ?? 0.18)));
    const iterations = Math.max(1, Math.min(12, Number(options.iterations ?? 5)));
    for (let it = 0; it < iterations; it++) {
        const next = base.map(x => (1 - damping) * x);
        for (let i = 0; i < rows.length; i++) {
            const denom = adj[i].reduce((s, [, w]) => s + w, 0);
            if (!denom) { next[i] += damping * p[i]; continue; }
            for (const [j, w] of adj[i]) next[j] += damping * p[i] * w / denom;
        }
        p = next;
    }
    const maxBaseScore = Math.max(...rows.map(r => Math.max(0, r.score)), 1e-9);
    const maxP = Math.max(...p, 1e-9);
    rows.forEach((row, i) => {
        row.graphScore = p[i] / maxP;
        row.score = row.score * 0.88 + maxBaseScore * 0.12 * row.graphScore;
    });
    return rows.sort((a, b) => b.score - a.score);
}

function similarityTerms(memory) {
    const values = [
        ...uniqueStrings(memory?.topics).map(x => `t:${normalizeHybridText(x)}`),
        ...tokenizeHybridText(memory?.text).filter(x => x.length >= 2).map(x => `x:${x}`),
    ];
    return new Set(values);
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}

/** MMR-like final selection to reduce repetitive callbacks. */
export function diversifyCandidates(candidates, options = {}) {
    const rows = (Array.isArray(candidates) ? candidates : []).filter(row => row && row.memory && row.memory.id);
    const finalCount = Math.max(0, Number(options.finalCount ?? 6));
    const lambda = Math.min(1, Math.max(0, Number(options.lambda ?? 0.78)));
    if (!finalCount || !rows.length) return [];
    const maxScore = Math.max(...rows.map(r => r.score), 1e-9);
    const sig = new Map(rows.map(r => [r.memory.id, similarityTerms(r.memory)]));
    const remaining = [...rows];
    const selected = [];
    while (remaining.length && selected.length < finalCount) {
        let bestIndex = 0;
        let bestValue = -Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const row = remaining[i];
            const relevance = row.score / maxScore;
            let redundancy = 0;
            for (const chosen of selected) redundancy = Math.max(redundancy, jaccard(sig.get(row.memory.id), sig.get(chosen.memory.id)));
            const value = lambda * relevance - (1 - lambda) * redundancy;
            if (value > bestValue) { bestValue = value; bestIndex = i; }
        }
        const [picked] = remaining.splice(bestIndex, 1);
        picked.mmrScore = bestValue;
        selected.push(picked);
    }
    return selected;
}

/**
 * Builds the injected prompt with a real character budget. High-value memories may carry
 * a short source evidence excerpt; lower-value memories stay summary-only.
 */
export function formatMemoryContext({ activeState = '', activeMemories = [], recalledMemories = [], maxChars = 7000, includeEvidence = true } = {}) {
    const stateLines = [];
    if (String(activeState).trim()) stateLines.push(String(activeState).trim());
    for (const m of activeMemories) {
        if (!m?.text) continue;
        const prefixText = m.kind ? `[${m.kind}${m.slot ? `:${m.slot}` : ''}] ` : '';
        const line = `${prefixText}${m.text}`;
        if (!stateLines.includes(line)) stateLines.push(line);
    }
    const rules = [
        '<rules>',
        '- current_state来自上一已完成回合；若更近的原始用户/角色文本与之冲突，以更近文本为准。',
        '- recalled_memories只是可能相关的过去经历，不等于当前状态；closed只表示过去发生过。',
        '- superseded/invalid不得覆盖更新后的事实；rumor/belief/inference不得自动升级为客观事实。',
        '- known_by是认知边界：模型看到记忆不代表所有角色都知道。',
        '- 不要为了展示“记得很多”而连续列举旧事；只有当旧记忆对当前行动、判断、情绪或因果真正有用时才自然调用。',
        '- Persona与世界书仍是稳定基线；这里主要提供剧情形成的动态状态与经历。',
        '</rules>',
    ].join('\n');
    const stateBlock = stateLines.length
        ? '<current_state source="last_completed_turn">\n' + stateLines.map(xmlEscape).join('\n') + '\n</current_state>'
        : '';
    const header = ['<aetheria_memory_context>', stateBlock, '<recalled_memories>'].filter(Boolean).join('\n');
    const footer = '</recalled_memories>\n' + rules + '\n</aetheria_memory_context>';
    let used = header.length + footer.length + 2;
    const budget = Math.max(1200, Number(maxChars) || 7000);
    const recallLines = [];
    for (const entry of recalledMemories) {
        const m = entry?.memory || entry;
        if (!m?.text) continue;
        const attrs = [
            `id="${xmlEscape(m.id || '')}"`,
            `kind="${xmlEscape(m.kind || '')}"`,
            `status="${xmlEscape(m.status || '')}"`,
            `epistemic="${xmlEscape(m.epistemic || '')}"`,
            `importance="${xmlEscape(m.importance || '')}"`,
            `known_by="${xmlEscape((m.known_by || []).join(','))}"`,
        ].join(' ');
        let body = `<summary>${xmlEscape(m.text || '')}</summary>`;
        if (includeEvidence && ['high', 'critical'].includes(m.importance) && String(m.evidence_excerpt || '').trim()) {
            body += `<evidence>${xmlEscape(m.evidence_excerpt)}</evidence>`;
        }
        const line = `<memory ${attrs}>${body}</memory>`;
        if (used + line.length + 1 > budget) break;
        recallLines.push(line);
        used += line.length + 1;
    }
    if (!stateLines.length && !recallLines.length) return '';
    return [
        '<aetheria_memory_context>',
        stateBlock,
        recallLines.length ? '<recalled_memories>\n' + recallLines.join('\n') + '\n</recalled_memories>' : '',
        rules,
        '</aetheria_memory_context>',
    ].filter(Boolean).join('\n');
}
