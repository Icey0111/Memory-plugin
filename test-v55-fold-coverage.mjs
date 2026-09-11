// Fold coverage certificate: a folded row is hidden from the model prompt, so the ONE thing that must
// never happen is a hidden floor whose stand-in is gone. This test pins the two ways that used to be
// possible, both measured live on chat "Seraphina - 2026-09-11@13h37m08s517ms" (9 floors, 12,320
// characters hidden at zero coverage):
//   A. unfoldFloorsNotCovered() iterated the derived fold audit. When floor_folds was absent (the audit
//      lives in the external derived store and had not been hydrated) it returned {restored: 0} and
//      every orphaned floor stayed hidden, even though each row carries its own marker.
//   B. The digest rebuild and the reconciliation sat BEHIND the quiet-in-progress guard, so a chat load
//      during an extraction skipped both for as long as the extraction ran.
import assert from 'node:assert/strict';

const FOLD = 'aetheria_v55_folded';
const KEY = 'aetheriaUnifiedMemoryV54';

function makeCtx({ turns, extracted, folded, folds = null, quiet = false }) {
    const chat = [];
    for (let i = 0; i < turns; i += 1) {
        chat.push({ is_user: true, mes: '用户第' + (i + 1) + '层' });
        chat.push({ is_user: false, mes: '助手第' + (i + 1) + '层正文内容' });
    }
    for (const assistantIndex of folded) {
        const floor = [assistantIndex - 1, assistantIndex].filter(i => i >= 0 && chat[i] && chat[i].is_user !== undefined);
        for (const index of floor) {
            if (chat[index].is_user === undefined) continue;
            chat[index].is_system = true;
            chat[index].extra = { [FOLD]: { summary_id: 'l1_' + assistantIndex, turn_assistant_index: assistantIndex, folded_at: 1, fingerprint: index } };
        }
    }
    const store = {};
    store.hierarchical_summaries = {
        version: 3, processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [],
        level1: [], level2: [], level3: [], dirty: false, last_run_at: null, last_error: null, visibility_debug: null,
    };
    if (folds) store.floor_folds = folds;
    store.extractions = {};
    let seq = 0;
    for (const assistantIndex of extracted) {
        seq += 1;
        store.extractions['x_' + seq + '_' + assistantIndex] = {
            assistant_index_at_creation: assistantIndex,
            event_summary: '第' + assistantIndex + '层发生了什么',
            generated_at: 1000 + assistantIndex,
        };
    }
    const settings = {
        enabled: true, hierarchical_summary_enabled: true, summary_digest_enabled: true,
        summary_level1_every_turns: 10, summary_level2_every_l1: 3, summary_level3_every_l2: 3,
        summary_max_tokens: 300, summary_injection_depth: 4, summary_max_context_chars: 9000,
        summary_source_max_chars: 24000, summary_digest_max_rows: 120, summary_digest_max_chars: 8000,
        summary_fold_hidden_floors: true, summary_fold_keep_recent_floors: 1,
    };
    if (quiet) settings.__quiet_extraction_in_progress = true;
    return {
        chat,
        extensionSettings: { [KEY]: settings },
        chatMetadata: { [KEY]: store },
        setExtensionPrompt: () => {}, saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {},
        saveChat: () => {},
        generateQuietPrompt: async () => { throw new Error('no model call is allowed in this test'); },
    };
}

const foldedAssistantIndexes = (ctx) => {
    const out = [];
    ctx.chat.forEach((row, i) => { if (row && row.extra && row.extra[FOLD] && row.is_user !== true) out.push(i); });
    return out;
};
const hiddenRows = (ctx) => ctx.chat.filter(row => row && row.extra && row.extra[FOLD]).length;

// --- A1. no audit at all, nothing covers anything -> every hidden row comes back -------------------
{
    const ctx = makeCtx({ turns: 6, extracted: [], folded: [1, 3, 5] });
    delete ctx.chatMetadata[KEY].floor_folds;
    globalThis.SillyTavern = { getContext: () => ctx };
    const fold = await import('./v55-floor-fold.js?coverage-a1');
    assert.equal(hiddenRows(ctx), 6, 'fixture hides three floors (user + assistant each)');
    const res = fold.unfoldFloorsNotCovered(ctx, new Set());
    assert.equal(res.restored, 6, 'with no audit and no coverage, the row markers alone must trigger a restore');
    assert.equal(hiddenRows(ctx), 0, 'no row may stay hidden with nothing standing in for it');
    assert.equal(fold.foldStatus === undefined, true);
}

// --- A2. no audit, but the digest covers the floors -> they stay hidden ---------------------------
{
    const ctx = makeCtx({ turns: 6, extracted: [1, 3, 5], folded: [1, 3, 5] });
    delete ctx.chatMetadata[KEY].floor_folds;
    globalThis.SillyTavern = { getContext: () => ctx };
    const fold = await import('./v55-floor-fold.js?coverage-a2');
    const res = fold.unfoldFloorsNotCovered(ctx, new Set([1, 3, 5]));
    assert.equal(res.restored, 0, 'a covered floor is legitimately hidden');
    assert.equal(hiddenRows(ctx), 6, 'covered floors stay folded');
}

// --- A3. no audit, partial coverage -> only the uncovered floor comes back ------------------------
{
    const ctx = makeCtx({ turns: 6, extracted: [1, 5], folded: [1, 3, 5] });
    delete ctx.chatMetadata[KEY].floor_folds;
    globalThis.SillyTavern = { getContext: () => ctx };
    const fold = await import('./v55-floor-fold.js?coverage-a3');
    const res = fold.unfoldFloorsNotCovered(ctx, new Set([1, 5]));
    assert.equal(res.restored, 2, 'floor 3 (user + assistant) has no stand-in and must be restored');
    assert.deepEqual(foldedAssistantIndexes(ctx), [1, 5], 'exactly the covered floors stay hidden');
}

// --- B1. the digest rebuild and reconciliation happen even while an extraction holds the lock ------
// Floor 6 (assistant index 11) is folded but has no extraction record, so nothing can ever stand in for
// it: it must come back. Floors 1/3/5 are extracted and covered, so they stay hidden.
{
    const ctx = makeCtx({ turns: 7, extracted: [1, 3, 5], folded: [1, 3, 5, 11], quiet: true });
    delete ctx.chatMetadata[KEY].floor_folds;
    globalThis.SillyTavern = { getContext: () => ctx };
    const runtime = await import('./v55-summary-runtime.js?coverage-b1');
    const before = foldedAssistantIndexes(ctx).length;
    const res = await runtime.processSummaryHierarchy(ctx);
    assert.equal(res.skipped, 'quiet-in-progress', 'the model half still stands down while an extraction is in flight');
    assert.equal(res.digest_lines, 3, 'the deterministic digest is 3 extracted turns');
    assert.equal(res.unfolded, 2, 'the orphan floor 11 (user + assistant) is restored without a model call');
    assert.equal(hiddenRows(ctx), 6, 'only the three covered floors remain hidden');
    assert.equal(ctx.chatMetadata[KEY].hierarchical_summaries.level1.length, 3, 'the digest rows are the Level-1 layer');
    assert.equal(before, 4, 'the fixture folds four assistant floors');
    assert.deepEqual(foldedAssistantIndexes(ctx), [1, 3, 5]);
}

// --- B2. the same chat, a summary pass that is allowed to run, ends with zero uncovered floors ----
{
    const ctx = makeCtx({ turns: 6, extracted: [1, 3, 5], folded: [1, 3, 5] });
    delete ctx.chatMetadata[KEY].floor_folds;
    globalThis.SillyTavern = { getContext: () => ctx };
    const runtime = await import('./v55-summary-runtime.js?coverage-b2');
    const res = await runtime.processSummaryHierarchy(ctx);
    assert.equal(res.unfolded, 0, 'every hidden floor is covered, so nothing is restored');
    const covered = new Set();
    for (const row of ctx.chatMetadata[KEY].hierarchical_summaries.level1) {
        for (const id of row.source_ids || []) {
            const match = /^turn_(\d+)_/.exec(String(id));
            if (match) covered.add(Number(match[1]));
        }
    }
    for (const index of foldedAssistantIndexes(ctx)) {
        assert.equal(covered.has(index), true, 'hidden assistant floor ' + index + ' must have a Level-1 stand-in');
    }
}

// --- C. the exported model-free reconcile is what CHAT_CHANGED calls, and it repairs on open --------
{
    const ctx = makeCtx({ turns: 7, extracted: [1, 3, 5], folded: [1, 3, 5, 11] });
    delete ctx.chatMetadata[KEY].floor_folds;
    globalThis.SillyTavern = { getContext: () => ctx };
    const runtime = await import('./v55-summary-runtime.js?coverage-c');
    assert.equal(typeof runtime.reconcileFoldCoverage, 'function', 'the model-free reconcile must be callable without a summary pass');
    const res = runtime.reconcileFoldCoverage(ctx);
    assert.equal(res.digest_lines, 3, 'it rebuilds the digest');
    assert.equal(res.unfolded, 2, 'and it restores the orphan floor');
    assert.deepEqual(foldedAssistantIndexes(ctx), [1, 3, 5], 'coverage is exactly the extracted floors');
    const again = runtime.reconcileFoldCoverage(ctx);
    assert.equal(again.unfolded, 0, 'a second call is a no-op, so it is safe on every chat change');
}

// --- D. a model Level-1 row fully covered by the digest is dropped, not injected twice -------------
{
    const ctx = makeCtx({ turns: 6, extracted: [1, 3, 5], folded: [] });
    const store = ctx.chatMetadata[KEY];
    globalThis.SillyTavern = { getContext: () => ctx };
    const runtime = await import('./v55-summary-runtime.js?coverage-d');
    // Turn ids come from the real collector: the digest keys off them, so a hand-written id would make
    // this test pass or fail for the wrong reason.
    const realTurns = runtime.collectCompletedDialogueTurns(ctx.chat);
    const coveredIds = realTurns.filter(turn => [1, 3, 5].includes(turn.assistant_index)).map(turn => turn.id);
    const outsideId = realTurns.find(turn => turn.assistant_index === 7).id;
    assert.equal(coveredIds.length, 3, 'the fixture exposes three extracted turns');
    // One model row covering the three turns the digest will cover, and one covering a turn it will not.
    store.hierarchical_summaries.level1 = [
        { id: 'model_covered', level: 1, source_ids: coveredIds, text: '模型写的一级摘要' },
        { id: 'model_outside', level: 1, source_ids: [outsideId], text: '覆盖窗口之外的一条' },
    ];
    delete store.floor_folds;
    const res = runtime.reconcileFoldCoverage(ctx);
    assert.equal(res.digest_lines, 3, 'the digest covers the three extracted turns');
    assert.equal(res.compression.superseded_model_rows, 1, 'the fully covered model row is dropped');
    const ids = store.hierarchical_summaries.level1.map(row => row.id);
    assert.equal(ids.includes('model_covered'), false, 'and it is gone from the tree');
    assert.equal(ids.includes('model_outside'), true, 'while a row covering a turn the digest does not cover stays');
}

console.log('PASS v5.5 fold coverage: raw text is never hidden without a stand-in, audit or no audit');
