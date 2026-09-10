// Floor folding hides a summarized floor from the model prompt without losing it from the memory
// system. Three properties have to hold or the feature is unsafe:
//   1. a folded row is still dialogue for turn collection, extraction, identity and evidence;
//   2. a row the *host* hid with /hide is not folded and not remembered;
//   3. the newest assistant floor is never folded, and a summary-tree reset always restores the raw
//      text before it drops the tree, so nothing is ever missing from the prompt with no stand-in.
import assert from 'node:assert/strict';

const listeners = new Map();
const chat = [];
// 25 floors: user 0 / assistant 1, user 2 / assistant 3, ...
for (let turn = 0; turn < 25; turn++) {
    chat.push({ is_user: true, mes: `用户第${turn + 1}层输入` });
    chat.push({ is_user: false, mes: `助手第${turn + 1}层回复内容` });
}

const settings = {
    enabled: true, hierarchical_summary_enabled: true, summary_auto_rebuild_on_history_change: true,
    summary_provider_mode: 'current', summary_max_tokens: 2048, summary_injection_depth: 4,
    summary_level1_every_turns: 10, summary_level2_every_l1: 3, summary_level3_every_l2: 3,
    summary_max_context_chars: 9000, summary_source_max_chars: 24000,
    summary_fold_hidden_floors: true, summary_fold_keep_recent_floors: 1,
};
let savedChat = 0;
const ctx = {
    extensionSettings: { aetheriaUnifiedMemoryV54: settings },
    chatMetadata: { aetheriaUnifiedMemoryV54: {} },
    chat,
    eventTypes: {
        MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
        CHAT_CHANGED: 'chat_changed', MESSAGE_SWIPED: 'message_swiped', MESSAGE_EDITED: 'message_edited',
        MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'message_deleted',
    },
    eventSource: {
        on: (event, handler) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(handler); },
        emit: (event, ...args) => (listeners.get(event) || []).forEach(handler => handler(...args)),
    },
    setExtensionPrompt: () => {}, saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {},
    saveChat: () => { savedChat += 1; },
    generateQuietPrompt: async () => '模型总结文本',
};
globalThis.SillyTavern = { getContext: () => ctx };

const runtime = await import('./v55-summary-runtime.js?floor-fold');
const fold = await import('./v55-floor-fold.js?floor-fold');
const core = await import('./memory-core.js?floor-fold');

const turnsBefore = runtime.collectCompletedDialogueTurns(chat);
assert.equal(turnsBefore.length, 25, 'the fixture must contain 25 completed floors');

const store = ctx.chatMetadata.aetheriaUnifiedMemoryV54;
store.hierarchical_summaries = {
    version: 3,
    processed_turn_ids: turnsBefore.map(t => t.id),
    consumed_l1_ids: [], consumed_l2_ids: [],
    level1: [
        { id: 'l1_first', level: 1, source_ids: turnsBefore.slice(0, 10).map(t => t.id), text: '前十个楼层', created_at: 1 },
        { id: 'l1_second', level: 1, source_ids: turnsBefore.slice(10, 20).map(t => t.id), text: '第十一到二十层', created_at: 2 },
    ],
    level2: [], level3: [], dirty: false, last_run_at: 2, last_error: null, visibility_debug: null,
};

// --- 1. fold -----------------------------------------------------------------------------------
const first = fold.foldSummarizedFloors(ctx);
assert.equal(first.floors, 19, 'floors 1-19 are covered and not protected (floor 20 is the newest covered floor)');
assert.equal(first.folded, 38, 'each folded floor hides its user turn and its assistant turn');
assert.equal(savedChat, 1, 'folding persists the chat through the host save path');

// Assistant index of floor N is 2N-1, so floors 1..19 are message indexes 0..37.
assert.equal(chat[0].is_system, true, 'the first user message is folded');
assert.equal(chat[37].is_system, true, 'the assistant reply of floor 19 is folded');
assert.equal(chat[38].is_system, undefined, 'the protected recent floor keeps its user message');
assert.equal(chat[39].is_system, undefined, 'the protected recent floor keeps its assistant message');
assert.equal(chat[49].is_system, undefined, 'the newest floor is never folded');
assert.equal(core.isFoldedRow(chat[0]), true);
assert.equal(core.isPromptHiddenRow(chat[0]), true, 'folded rows are absent from the prompt');
assert.equal(core.isHostHiddenRow(chat[0]), false, 'a folded row is not a host /hide');
assert.equal(core.isDialogueRow(chat[0]), true, 'folded rows are still dialogue');

// --- 2. the memory system must not forget what it folded ---------------------------------------
const turnsAfter = runtime.collectCompletedDialogueTurns(chat);
assert.equal(turnsAfter.length, 25, 'folding must not remove floors from turn collection');
assert.deepEqual(turnsAfter.map(t => t.id), turnsBefore.map(t => t.id),
    'folding must not change any turn id, or every downstream fingerprint would rebind');
assert.equal(store.floor_folds.hidden && Object.keys(store.floor_folds.hidden).length, 38);

// --- 3. idempotency ----------------------------------------------------------------------------
const again = fold.foldSummarizedFloors(ctx);
assert.equal(again.folded, 0, 'folding twice must not re-fold');
assert.equal(savedChat, 1, 'a no-op fold must not save the chat again');

// --- 4. a host /hide is not our fold -----------------------------------------------------------
chat[45].is_system = true; // host-hidden assistant of floor 23: covered by no summary, so unfolded
assert.equal(core.isFoldedRow(chat[45]), false, 'a host /hide must not be mistaken for a plugin fold');
assert.equal(core.isPromptHiddenRow(chat[45]), true);
assert.equal(core.isHostHiddenRow(chat[45]), true);
assert.equal(core.isDialogueRow(chat[45]), false, 'a host /hide is not remembered');
assert.equal(runtime.collectCompletedDialogueTurns(chat).length, 24, 'a host /hide removes its floor from turn collection');
delete chat[45].is_system;

// --- 5. unfold ---------------------------------------------------------------------------------
const undone = fold.unfoldAllFloors(ctx);
assert.equal(undone.restored, 38);
assert.equal(undone.stale, 0);
assert.equal(chat[0].is_system, false);
assert.equal(chat[37].is_system, false);
assert.equal(chat[0].extra.aetheria_v55_folded, undefined);
assert.equal(core.isDialogueRow(chat[0]), true);
assert.equal(Object.keys(store.floor_folds.hidden).length, 0);

// --- 6. an index shift must not unhide someone else's message -----------------------------------
fold.foldSummarizedFloors(ctx);
const victim = chat[10];
victim.is_system = true;             // simulate a host-hidden message that is not a plugin fold
victim.extra = {};
const shifted = fold.unfoldAllFloors(ctx);
assert.equal(shifted.stale, 1, 'a row that is not a plugin fold must be reported as stale');
assert.equal(victim.is_system, true, 'a host-hidden row must survive an unfold untouched');
victim.is_system = false;

// --- 7. a summary-tree reset restores the raw text before dropping the tree ---------------------
fold.foldSummarizedFloors(ctx);
assert.equal(core.isFoldedRow(chat[0]), true);
assert.equal(runtime.installV55HierarchicalSummary(), true);
chat[1].mes = '被编辑过的助手回复';
ctx.eventSource.emit('message_edited');
assert.equal(store.hierarchical_summaries.level1.length, 0, 'an edited summarized floor still invalidates the tree');
assert.equal(core.isFoldedRow(chat[0]), false, 'a tree reset must restore the folded raw text');
assert.equal(chat[0].is_system, false);
assert.equal(Object.keys(store.floor_folds.hidden).length, 0, 'the fold audit must be cleared with the tree');

// --- 8. disabled means untouched ---------------------------------------------------------------
settings.summary_fold_hidden_floors = false;
store.hierarchical_summaries = {
    version: 3, processed_turn_ids: runtime.collectCompletedDialogueTurns(chat).map(t => t.id),
    consumed_l1_ids: [], consumed_l2_ids: [],
    level1: [{ id: 'l1_x', level: 1, source_ids: runtime.collectCompletedDialogueTurns(chat).slice(0, 10).map(t => t.id), text: 'x', created_at: 1 }],
    level2: [], level3: [], dirty: false, last_run_at: 1, last_error: null, visibility_debug: null,
};
assert.equal(fold.foldSummarizedFloors(ctx).skipped, 'fold-disabled');

// --- 9. the injected summary shape has to change once floors are folded -------------------------
// Without folding, a summary a higher level consumed is a duplicate and stays out of the prompt.
// With folding it is the only surviving record of the floor, so it has to come back in.
const l1s = Array.from({ length: 12 }, (_, i) => ({ id: `l1_${i}`, level: 1, source_ids: [`turn_${i}_x`], text: `一级摘要第${i + 1}条`, created_at: i + 1 }));
const l2s = [{ id: 'l2_0', level: 2, source_ids: l1s.slice(0, 6).map(x => x.id), text: '二级阶段摘要甲', created_at: 20 }];
const l3s = [{ id: 'l3_0', level: 3, source_ids: ['l2_0'], text: '三级长期摘要骨架', created_at: 30 }];
const injectCtx = folding => ({
  extensionSettings: { aetheriaUnifiedMemoryV54: { enabled: true, hierarchical_summary_enabled: true, summary_max_context_chars: 8000, summary_fold_hidden_floors: folding } },
  chatMetadata: { aetheriaUnifiedMemoryV54: {
    hierarchical_summaries: {
      version: 3, processed_turn_ids: [], dirty: false,
      consumed_l1_ids: l1s.slice(0, 6).map(x => x.id), consumed_l2_ids: ['l2_0'],
      level1: l1s, level2: l2s, level3: l3s,
    },
  } },
});
const actor = { aliases: [], ids: [] };
const noFold = runtime.getHierarchicalSummaryContext(injectCtx(false), { actor });
assert.match(noFold, /三级长期摘要骨架/);
assert.doesNotMatch(noFold, /二级阶段摘要甲/, 'unfolded: a consumed stage summary is a duplicate and stays out');
assert.doesNotMatch(noFold, /一级摘要第1条/, 'unfolded: consumed level-1 items stay out');
assert.match(noFold, /一级摘要第12条/, 'unfolded: unconsumed level-1 items are still injected');

const withFold = runtime.getHierarchicalSummaryContext(injectCtx(true), { actor });
assert.match(withFold, /三级长期摘要骨架/);
assert.match(withFold, /二级阶段摘要甲/, 'folded: consumed stage summaries stay in, they carry the folded floors');
assert.match(withFold, /一级摘要第1条/, 'folded: consumed level-1 summaries come back in');
assert.match(withFold, /一级摘要第12条/, 'folded: the newest level-1 summary is still there');

// Each level has to survive the sub-budget: a long level-1 list must not crowd the skeleton out.
const longL1 = Array.from({ length: 40 }, (_, i) => ({ id: `L${i}`, level: 1, source_ids: [`turn_${i}_y`], text: `第${i + 1}条${'填'.repeat(120)}`, created_at: i }));
const budgetCtx = injectCtx(true);
budgetCtx.extensionSettings.aetheriaUnifiedMemoryV54.summary_max_context_chars = 1200;
const tree = budgetCtx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries;
tree.level1 = longL1;
tree.consumed_l1_ids = [];
const budgeted = runtime.getHierarchicalSummaryContext(budgetCtx, { actor });
assert.match(budgeted, /三级长期摘要骨架/, 'the long-range skeleton survives a tight budget');
assert.match(budgeted, /二级阶段摘要甲/, 'the stage level survives a tight budget');
assert.match(budgeted, /第40条/, 'the newest level-1 summary is kept');
assert.doesNotMatch(budgeted, /第1条填/, 'the oldest level-1 summaries are dropped first');

console.log('PASS v5.5 floor folding: summarized floors leave the prompt, stay remembered, and restore cleanly');
