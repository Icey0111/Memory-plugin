// Aetheria Unified Memory v5.5 - the transcript projection of a narrative fold.
//
// This module used to own folding itself: it decided which floors a Level-1 summary covered, wrote its
// own audit table, and could hide or restore rows on its own authority. That made it a second writer of
// the same fact as the summarizer, and the two could disagree. The narrative runtime now owns the
// decision - it folds a row only while the accepted summary covers every chunk of that row - and this
// module keeps exactly one responsibility: making the transcript show what the markers say.
//
// The marker (message.extra.aetheria_v55_folded) and is_system are written by raw-history.js. Nothing
// here writes chat state; a diagnostics or render call must never mutate the chat.

import { isFoldedRow } from './memory-core.js';

/** Class the transcript node carries while its floor is folded, so the UI can collapse it. */
export const FOLD_DOM_CLASS = 'aum-v55-folded';

const getContext = () => globalThis.SillyTavern?.getContext?.();

function nodeAt(index) {
    if (typeof document === 'undefined') return null;
    return document.querySelector('.mes[mesid="' + index + '"]');
}

/** Re-apply one rendered message node. Per node, because a render event fires once per node and a full
 *  sweep inside it would be quadratic on a long chat. */
export function syncFloorFoldRow(ctxInput, messageId) {
    const index = Number(messageId);
    if (!Number.isInteger(index) || index < 0) return false;
    const el = nodeAt(index);
    if (!el) return false;
    const rows = Array.isArray(ctxInput?.chat) ? ctxInput.chat : [];
    el.classList.toggle(FOLD_DOM_CLASS, isFoldedRow(rows[index]));
    return true;
}

/** Re-apply the collapsed styling after the host re-renders a chat it loaded from disk. */
export function syncFloorFoldDom(ctxInput = getContext()) {
    if (typeof document === 'undefined') return 0;
    const rows = Array.isArray(ctxInput?.chat) ? ctxInput.chat : [];
    let marked = 0;
    for (let index = 0; index < rows.length; index++) {
        const folded = isFoldedRow(rows[index]);
        const el = nodeAt(index);
        if (el) el.classList.toggle(FOLD_DOM_CLASS, folded);
        if (folded) marked += 1;
    }
    return marked;
}
