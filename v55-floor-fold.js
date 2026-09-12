// Aetheria Unified Memory v5.5 — floor folding ("cold original text").
//
// The design contract is: a floor the hierarchical summarizer has already compressed stops occupying
// the hot prompt, and the summary takes its place. SillyTavern's only prompt-visible lever for that
// is `is_system = true` — the same flag its own /hide command uses — so folding is exactly that plus
// a plugin-owned marker in `message.extra` that lets every other reader in this extension tell a
// plugin fold apart from a user /hide.
//
// Three invariants keep this safe:
//   1. Hide only what a Level-1 summary already covers. A reset tree unfolds everything first, so raw
//      text is never gone from the prompt without a summary standing in for it.
//   1b. A hidden floor must still be REACHABLE, not merely covered. Coverage says something stands in for
//      it; reachability says the original is still there to be produced on demand. Those are different
//      claims and only the first was ever checked - the fold status now reports both, because a floor
//      hidden with its original gone is the one outcome folding must never produce.
//   2. Never fold the newest assistant turn. Swipes and regeneration act on the last message, and
//      SillyTavern's own hide helper refreshes swipe buttons precisely because hiding the tail breaks
//      them. The tail always stays hot.
//
// Folding is reversible at any time (`unfoldAllFloors`) and is audited in chat metadata under
// `store.floor_folds` with a per-row content fingerprint, so a shifted or rewritten chat cannot make
// the plugin unhide the wrong message.

import { FOLD_EXTRA_KEY, fnv1a32, isDialogueRow, isFoldedRow } from './memory-core.js';
import { persistChatStore } from './v55-derived-store.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
export const FOLD_STORE_KEY = 'floor_folds';
/** Class the transcript node carries while its floor is folded, so the UI can collapse it. */
export const FOLD_DOM_CLASS = 'aum-v55-folded';

const getContext = () => globalThis.SillyTavern?.getContext?.();

function clean(value, max = 100000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function settingsOf(ctx) {
    return ctx?.extensionSettings?.[SETTINGS_KEY] || null;
}

function storeOf(ctx) {
    if (!ctx?.chatMetadata) return null;
    return ctx.chatMetadata[METADATA_KEY] ?? (ctx.chatMetadata[METADATA_KEY] = {});
}

/** Fold audit record. `hidden` maps a message index to what was hidden there and why. */
/**
 * The fold audit. `create` must be false for read-only callers: the audit is a derived key owned by the
 * external derived store, and a diagnostics read that lazily created it would put an empty floor_folds
 * back into the chat file on the next save.
 */
function foldsOf(store, create = true) {
    if (!store) return null;
    const existing = store[FOLD_STORE_KEY];
    if (!create && (!existing || typeof existing !== 'object' || Array.isArray(existing))) return null;
    const f = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : (store[FOLD_STORE_KEY] = {});
    if (!f.hidden || typeof f.hidden !== 'object' || Array.isArray(f.hidden)) f.hidden = {};
    if (!Array.isArray(f.runs)) f.runs = [];
    if (f.last_run_at === undefined) f.last_run_at = null;
    if (f.last_error === undefined) f.last_error = null;
    f.version = 2;
    return f;
}

/**
 * Restore any floor whose stand-in is gone. A floor may only stay hidden while something still covers
 * it; the deterministic digest window rolls forward, so the oldest line eventually drops out and its
 * floor has to come back. Without this the plugin would hide raw text that nothing stands in for,
 * which is the one thing folding must never do.
 */
export function unfoldFloorsNotCovered(ctxInput = getContext(), coveredAssistantIndexes = new Set()) {
    const ctx = ctxInput;
    const store = storeOf(ctx);
    const rows = Array.isArray(ctx?.chat) ? ctx.chat : [];
    if (!store || !rows.length) return { restored: 0 };
    // Read-only: the audit is a derived key, and a diagnostics read must not recreate it.
    const folds = foldsOf(store, false);
    const covered = coveredAssistantIndexes instanceof Set ? coveredAssistantIndexes : new Set(coveredAssistantIndexes || []);
    let restored = 0;
    // Driven by the ROW MARKERS, never by the audit. The audit lives in the external derived store and
    // can legitimately be absent - a chat whose derived record predates the key, a lost backend, a read
    // that ran before hydration - while every folded row still carries `aetheria_v55_folded`. Iterating
    // the audit meant this, the one path that stops raw text from being hidden with nothing standing in
    // for it, did nothing in exactly that case. Measured live: a 25-row chat kept 9 floors (12,320
    // characters) hidden at zero coverage while this function returned {restored: 0}, because
    // floor_folds had not been hydrated for that chat.
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!isFoldedRow(row)) continue;
        const marker = row.extra?.[FOLD_EXTRA_KEY];
        const marked = Number(marker?.turn_assistant_index);
        const assistantIndex = Number.isFinite(marked) ? marked : (row.is_user === true ? null : index);
        if (assistantIndex !== null && covered.has(assistantIndex)) continue;
        delete row.extra[FOLD_EXTRA_KEY];
        row.is_system = false;
        syncDom(index, false);
        if (folds) delete folds.hidden[String(index)];
        restored += 1;
    }
    if (restored && folds) folds.last_run_at = Date.now();
    return { restored };
}

/** `turn_<assistantIndex>_<fingerprint>` — the id shape collectCompletedDialogueTurns emits. */
export function parseTurnAssistantIndex(turnId) {
    const match = /^turn_(\d+)_/.exec(String(turnId ?? ''));
    if (!match) return null;
    const index = Number(match[1]);
    return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * Message indexes that make up one floor: the assistant reply plus the user messages that led to it.
 * Walk-back stops at the previous assistant reply, mirroring computeDialoguePairFingerprint.
 */
function floorMessageIndexes(rows, assistantIndex) {
    const out = [];
    for (let i = Number(assistantIndex); i >= 0; i--) {
        const row = rows[i];
        if (!row) continue;
        if (i !== assistantIndex && row.is_user !== true) break;
        if (!isDialogueRow(row)) continue;
        if (i === assistantIndex || row.is_user === true) out.push(i);
    }
    return out.reverse();
}

/** The newest assistant index in the live chat, which is never folded. */
function newestAssistantIndex(rows) {
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row && row.is_user !== true && isDialogueRow(row)) return i;
    }
    return -1;
}

function syncDom(index, hidden) {
    if (typeof document === 'undefined') return;
    const el = document.querySelector(`.mes[mesid="${index}"]`);
    if (!el) return;
    el.setAttribute('is_system', String(Boolean(hidden)));
    el.classList.toggle(FOLD_DOM_CLASS, Boolean(hidden));
}

/** Re-apply the collapsed styling after the host re-renders a chat it loaded from disk. */
export function syncFloorFoldDom(ctxInput = getContext()) {
    if (typeof document === 'undefined') return 0;
    const rows = Array.isArray(ctxInput?.chat) ? ctxInput.chat : [];
    let marked = 0;
    for (let index = 0; index < rows.length; index++) {
        const el = document.querySelector(`.mes[mesid="${index}"]`);
        if (!el) continue;
        const folded = isFoldedRow(rows[index]);
        el.classList.toggle(FOLD_DOM_CLASS, folded);
        if (folded) marked += 1;
    }
    return marked;
}

function rowFingerprint(row) {
    return fnv1a32(String(row?.mes ?? ''));
}

/**
 * Fold every floor covered by a Level-1 summary out of the model prompt.
 * Idempotent: rows already folded are left untouched.
 */
export function foldSummarizedFloors(ctxInput = getContext(), opts = {}) {
    const ctx = ctxInput;
    const settings = settingsOf(ctx);
    const store = storeOf(ctx);
    if (!ctx || !settings || !store) return { skipped: 'no-context' };
    if (settings.enabled === false || !settings.hierarchical_summary_enabled) return { skipped: 'disabled' };
    if (settings.summary_fold_hidden_floors !== true) return { skipped: 'fold-disabled' };

    const tree = store.hierarchical_summaries;
    if (!tree || !Array.isArray(tree.level1)) return { skipped: 'no-summary-tree' };
    if (tree.dirty) return { skipped: 'history-dirty' };

    const rows = Array.isArray(ctx.chat) ? ctx.chat : null;
    if (!rows || !rows.length) return { skipped: 'empty-chat' };

    const folds = foldsOf(store);
    const keepRecent = Math.max(0, Math.min(200, Math.floor(Number(settings.summary_fold_keep_recent_floors)) || 0));
    const newest = newestAssistantIndex(rows);

    // Coverage: assistant index -> the Level-1 summary that stands in for it.
    const covered = new Map();
    for (const summary of tree.level1) {
        if (!summary || !Array.isArray(summary.source_ids)) continue;
        for (const turnId of summary.source_ids) {
            const index = parseTurnAssistantIndex(turnId);
            if (index !== null) covered.set(index, String(summary.id ?? ''));
        }
    }
    if (!covered.size) return { skipped: 'no-covered-floor', hidden: Object.keys(folds.hidden).length };

    const ordered = [...covered.keys()].sort((a, b) => a - b);
    const protectedRecent = new Set(ordered.slice(-keepRecent));
    const limit = Number.isFinite(Number(opts.maxFloors)) ? Math.max(0, Math.floor(Number(opts.maxFloors))) : Infinity;

    let foldedRows = 0;
    let foldedFloors = 0;
    let auditRepaired = 0;
    let skippedTail = 0;
    const now = Date.now();
    const level1ByIndex = opts.level1ByIndex || null;

    for (const assistantIndex of ordered) {
        if (foldedFloors >= limit) break;
        if (assistantIndex === newest || protectedRecent.has(assistantIndex)) { skippedTail += 1; continue; }
        const summaryId = level1ByIndex ? String(level1ByIndex.get(assistantIndex) ?? covered.get(assistantIndex)) : covered.get(assistantIndex);
        const indexes = floorMessageIndexes(rows, assistantIndex);
        let touchedThisFloor = 0;
        for (const index of indexes) {
            const row = rows[index];
            if (!row || !isDialogueRow(row)) continue;
            if (isFoldedRow(row)) {
                // Already folded but with no audit entry (the audit is derived and may have been lost).
                // Rebuild the entry from the row's own marker so the audit self-heals.
                if (folds.hidden[String(index)]) continue;
                const marker = row.extra?.[FOLD_EXTRA_KEY] || {};
                folds.hidden[String(index)] = {
                    summary_id: marker.summary_id ?? summaryId,
                    turn_assistant_index: marker.turn_assistant_index ?? assistantIndex,
                    folded_at: Number(marker.folded_at) || now,
                    fingerprint: Number(marker.fingerprint),
                    is_user: row.is_user === true,
                    recovered_from_row: true,
                };
                auditRepaired += 1;
                continue;
            }
            if (folds.hidden[String(index)]) continue;
            row.is_system = true;
            row.extra = (row.extra && typeof row.extra === 'object') ? row.extra : {};
            row.extra[FOLD_EXTRA_KEY] = {
                summary_id: summaryId,
                turn_assistant_index: assistantIndex,
                folded_at: now,
                fingerprint: rowFingerprint(row),
            };
            folds.hidden[String(index)] = {
                summary_id: summaryId,
                turn_assistant_index: assistantIndex,
                folded_at: now,
                fingerprint: rowFingerprint(row),
                is_user: row.is_user === true,
            };
            syncDom(index, true);
            foldedRows += 1;
            touchedThisFloor += 1;
        }
        if (touchedThisFloor) foldedFloors += 1;
    }

    // Persist when new floors were folded OR when the audit was repaired from row markers: the repair
    // is the only record of what may be unfolded, and skipping it left the audit permanently empty.
    if (foldedRows || auditRepaired) {
        folds.last_run_at = now;
        folds.last_error = null;
        folds.runs.push({ at: now, floors: foldedFloors, messages: foldedRows, keep_recent: keepRecent });
        if (folds.runs.length > 50) folds.runs = folds.runs.slice(-50);
        // Route through the projection, not ctx.saveMetadataDebounced(): floor_folds is derived and
        // would otherwise be written straight into the chat file.
        persistChatStore(ctx);
        // Chat rows are host application data: persist through the host's own save path.
        try { ctx.saveChat?.(); } catch (error) { folds.last_error = String(error?.message || error); }
    }

    return {
        folded: foldedRows,
        floors: foldedFloors,
        audit_repaired: auditRepaired,
        hidden: Object.keys(folds.hidden).length,
        skipped_tail: skippedTail,
        keep_recent: keepRecent,
    };
}

/**
 * Restore every floor this plugin folded. Safe to call from a settings toggle, a chat reset or a
 * summary-tree rebuild; it verifies each row's content fingerprint before it touches it.
 */
export function unfoldAllFloors(ctxInput = getContext(), { save = true } = {}) {
    const ctx = ctxInput;
    const store = storeOf(ctx);
    if (!ctx || !store) return { skipped: 'no-context' };
    const folds = foldsOf(store);
    const rows = Array.isArray(ctx.chat) ? ctx.chat : [];
    let restored = 0;
    let stale = 0;

    // The audit is derived state and can be absent (it lives in the external derived store now, and a
    // fresh install has none). Every folded row carries its own marker, so scan for them rather than
    // leaving a chat permanently folded because the audit was lost.
    if (!Object.keys(folds.hidden).length) {
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            if (!isFoldedRow(row)) continue;
            const marker = row.extra?.[FOLD_EXTRA_KEY] || {};
            folds.hidden[String(index)] = {
                summary_id: marker.summary_id ?? null,
                turn_assistant_index: marker.turn_assistant_index ?? null,
                folded_at: Number(marker.folded_at) || Date.now(),
                fingerprint: Number(marker.fingerprint),
                is_user: row.is_user === true,
                recovered_from_row: true,
            };
        }
    }

    for (const [key, meta] of Object.entries(folds.hidden)) {
        const index = Number(key);
        const row = Number.isInteger(index) ? rows[index] : null;
        if (!row) { stale += 1; continue; }
        // The marker, not the index, is authoritative: a deleted message shifts every later index.
        // If the row at this index is not one we folded, leave it alone and just drop the audit entry.
        if (!isFoldedRow(row)) { stale += 1; continue; }
        // A changed fingerprint means the text was edited while folded. It is still ours to restore.
        const expected = Number(meta?.fingerprint);
        if (Number.isFinite(expected) && expected !== rowFingerprint(row)) stale += 1;
        if (row.extra && typeof row.extra === 'object') delete row.extra[FOLD_EXTRA_KEY];
        row.is_system = false;
        syncDom(index, false);
        restored += 1;
    }

    folds.hidden = {};
    if (restored || stale) {
        folds.last_run_at = Date.now();
        folds.runs.push({ at: folds.last_run_at, unfolded: restored, stale });
        if (folds.runs.length > 50) folds.runs = folds.runs.slice(-50);
    }
    if (save && restored) {
        persistChatStore(ctx, store);
        try { ctx.saveChat?.(); } catch { /* host save is best effort */ }
    }
    return { restored, stale };
}

/** Diagnostics for the settings panel and the recall debug record. */
export function floorFoldStatus(ctxInput = getContext()) {
    const ctx = ctxInput;
    const store = storeOf(ctx);
    const settings = settingsOf(ctx);
    const folds = foldsOf(store, false);
    const hidden = folds?.hidden && typeof folds.hidden === 'object' ? folds.hidden : {};
    const runs = Array.isArray(folds?.runs) ? folds.runs : [];
    const rows = Array.isArray(ctx?.chat) ? ctx.chat : [];
    // A folded floor must still be REACHABLE, not merely covered. Folding only sets is_system, so the
    // original text normally stays in ctx.chat at the same index - but a chat edit, a delete, or a lost
    // marker can break that, and a floor that is hidden with its original gone is the one outcome folding
    // must never produce. unfoldFloorsNotCovered restores for the missing-STAND-IN case; this reports the
    // missing-ORIGINAL case, which until now had no observer at all. Stated as the contract it is: the
    // fold module's first invariant used to be 'hide only what a summary already covers', which is about
    // the stand-in and says nothing about whether the thing being hidden is still there.
    // Driven by the ROW MARKERS first and the audit second, for the reason unfoldFloorsNotCovered gives
    // above: the audit lives in the derived store and can legitimately be absent - a chat whose derived
    // record predates the key, a lost backend, a read before hydration. An audit that iterates only the
    // audit table reports "nothing at risk" in exactly the case where it cannot know, which is the same
    // mistake this module already had to fix once.
    const reach = { hidden: 0, reachable: 0, at_risk: [] };
    const counted = new Set();
    for (let index = 0; index < rows.length; index += 1) {
        if (!isFoldedRow(rows[index])) continue;
        counted.add(index);
        reach.hidden += 1;
        const marker = rows[index].extra?.[FOLD_EXTRA_KEY] || {};
        const expected = Number(hidden[String(index)]?.fingerprint ?? marker.fingerprint);
        if (!Number.isFinite(expected)) {
            // Folded, but with no fingerprint on either carrier. The text is here; nothing can prove it is
            // the text that was folded.
            reach.at_risk.push({ index, reason: 'unverified' });
            continue;
        }
        if (rowFingerprint(rows[index]) !== expected) {
            // The text changed while folded. It is still ours to restore - unfoldAllFloors trusts the
            // marker - but the audit can no longer prove this row is the one it folded.
            reach.at_risk.push({ index, reason: 'content-changed' });
            continue;
        }
        reach.reachable += 1;
    }
    for (const key of Object.keys(hidden)) {
        const index = Number(key);
        if (!Number.isFinite(index) || counted.has(index)) continue;
        reach.hidden += 1;
        reach.at_risk.push({ index, reason: rows[index] ? 'marker-lost' : 'row-missing' });
    }
    return {
        enabled: settings?.summary_fold_hidden_floors === true,
        // D2's invariant, made observable: hidden floors whose original is still present and unchanged,
        // and the ones where it is not.
        reachability: reach,
        keep_recent: Math.max(0, Math.floor(Number(settings?.summary_fold_keep_recent_floors)) || 0),
        hidden_messages: Object.keys(hidden).length,
        chat_messages: rows.length,
        prompt_messages: rows.filter(row => !row?.is_system).length,
        last_run_at: folds?.last_run_at ?? null,
        last_error: folds?.last_error ?? null,
        runs: runs.length,
    };
}

let foldUiInstalled = false;

/**
 * Keep the transcript's collapsed styling in step with the stored fold markers. The host rebuilds
 * message nodes from the saved chat file, so the class has to be re-applied after every chat load.
 */
export function installV55FloorFoldUi(ctxInput = getContext()) {
    const ctx = ctxInput;
    if (!ctx) return false;
    syncFloorFoldDom(ctx);
    if (foldUiInstalled) return true;
    const events = ctx.eventTypes || {};
    const on = (event, handler) => event && ctx.eventSource?.on?.(event, handler);
    on(events.CHAT_CHANGED, () => setTimeout(() => syncFloorFoldDom(getContext()), 120));
    on(events.CHAT_LOADED, () => setTimeout(() => syncFloorFoldDom(getContext()), 120));
    // Per-message, not a full sweep: a render event fires once per node and a full sweep inside it
    // would be quadratic on a long chat.
    on(events.MESSAGE_RENDERED, (messageId) => {
        const index = Number(messageId);
        const live = getContext();
        const rows = Array.isArray(live?.chat) ? live.chat : [];
        if (!Number.isInteger(index) || index < 0) { syncFloorFoldDom(live); return; }
        const el = document.querySelector(`.mes[mesid="${index}"]`);
        if (el) el.classList.toggle(FOLD_DOM_CLASS, isFoldedRow(rows[index]));
    });
    foldUiInstalled = true;
    return true;
}
