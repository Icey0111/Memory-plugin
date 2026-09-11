// A-level plan items A2 (scene boundaries), A4 (repetition-driven compression), A6 (forget by
// reconstructability) and A8's fourth metric (injection increment). Every one of them is deterministic
// and offline, which is the plan's own entry criterion for the A list (section 3).
import assert from 'node:assert/strict';
import { applyMemoryOps, createEmptyStore } from './memory-core.js';
import { boundaryStats, detectBoundaries, readTurn, segmentByBoundary } from './v55-boundary.js';
import { compressionPlan, compressionStats, groupDigestRows, repetitionScore } from './v55-compression.js';
import { forgettingStats, planColdForgetting, reconstructibilityOf } from './v55-forget.js';
import { injectionBreakdown, injectionComposition, injectionSectionCost } from './v55-quality-metrics.js';
import { spinePromptBlock } from './v55-spine.js';

function turn(store, sourceMessageIndex, ops) {
    const result = applyMemoryOps(store, ops, { sourceMessageIndex });
    assert.deepEqual(result.errors, [], 'fixture turn ' + sourceMessageIndex + ': ' + JSON.stringify(result.errors));
    return result.store || store;
}

// --- A2: the three verdicts, each from a different signal -----------------------------------------
let store = createEmptyStore();
store = turn(store, 1, [{ op: 'add', kind: 'state', slot: '地点.current', text: '染坊后巷的夜路' }]);
store = turn(store, 3, [{ op: 'add', kind: 'state', slot: '地点.current', text: '钟楼旅店前厅' }]);
store = turn(store, 5, [{ op: 'add', kind: 'commitment', slot: '誓言.一', text: '我答应过白鸦不说出去' }]);
store = turn(store, 7, [{ op: 'add', kind: 'state', slot: '茶.温度', text: '茶还温着' }]);

const turns = [1, 3, 5, 7].map(index => ({ id: 'turn_' + index + '_x', assistant_index: index, text: 't' + index }));
const boundaries = detectBoundaries(store, turns, { beat: 10 });
assert.equal(boundaries.length, 3, 'open + location + (commitment and the beat merge only if nothing fires)');
assert.equal(boundaries[0].reason, 'chat-open', 'the first floor opens the first scene');
assert.equal(boundaries[1].kind, 'hard', 'a location slot change is a hard boundary');
assert.equal(boundaries[1].detail.slot, '地点.current');
assert.equal(boundaries[2].kind, 'soft', 'an irreversible change is a soft boundary');
assert.equal(boundaries[2].reason, 'irreversible-change');
assert.equal(readTurn(store, 5).irreversibles[0].kind, 'commitment', 'a commitment is recognised as irreversible');

// The fallback: with nothing firing, the beat is what eventually opens a segment.
let quiet = createEmptyStore();
for (const index of [1, 3, 5, 7, 9, 11]) quiet = turn(quiet, index, [{ op: 'add', kind: 'event', slot: '琐事.' + index, text: '无事发生 ' + index }]);
const quietTurns = [1, 3, 5, 7, 9, 11].map(index => ({ id: 'turn_' + index + '_x', assistant_index: index, text: 't' + index }));
const quietBoundaries = detectBoundaries(quiet, quietTurns, { beat: 2 });
assert.ok(quietBoundaries.some(entry => entry.kind === 'beat'), 'the floor beat is still the last-resort verdict');
const stats = boundaryStats(quiet, quietTurns, { beat: 2 });
assert.equal(stats.counts.hard, 1, 'only the opening is hard here');
assert.ok(stats.beat_share > 0, 'and the beat share reports how much had to fall back');
assert.equal(segmentByBoundary(store, turns).length, 3, 'segments == boundaries');

// --- A4: repetition drives the compression, and grouping never loses coverage ----------------------
// Realistic Level-1 rows: the extractor's event_summary measures 150-350 characters, so a merge that
// only pays off on short lines would be worthless. Four near-identical paragraphs of that size.
const paragraph = '白鸦把铜钥匙放在井边，说让我自己决定要不要拿；钥匙是铜的，井边很冷，风从北面顺着巷子灌下来，把墙上那层湿灰吹出一道一道的纹路，他没有抬头看我，只把手指按在井沿上，指节发白，像是在等我先开口；井口那圈石头被绳子磨出了槽，槽里存着水，亮得像一层薄冰，我没有立刻去拿，因为拿了就等于应下了他后面那句没说出口的话，而那句话我到现在也没有听他说完。';
const repeated = [
    { assistant_index: 1, id: 'turn_1_a', text: paragraph },
    { assistant_index: 3, id: 'turn_3_a', text: paragraph.replace('很冷', '冷得厉害') },
    { assistant_index: 5, id: 'turn_5_a', text: paragraph.replace('指节发白', '指节泛白') },
    { assistant_index: 7, id: 'turn_7_a', text: paragraph.replace('顺着巷子', '沿着巷子') },
];
const rows = repeated.map((entry, position) => ({ assistant_index: entry.assistant_index, source_id: entry.id, text: entry.text, at: position }));
const repetition = repetitionScore(store, repeated, rows);
assert.ok(repetition.text_reuse > 0.5, 'four near-identical lines must register as reuse, got ' + repetition.text_reuse);
assert.ok(repetition.score > 0.3, 'and the combined score must be high, got ' + repetition.score);
const plan = compressionPlan(repetition);
assert.ok(plan.group_size > 1, 'high repetition must be allowed to merge lines, got group_size ' + plan.group_size);
assert.ok(plan.factor < 1, 'and the budget must shrink, got factor ' + plan.factor);

const grouped = groupDigestRows(rows, { groupSize: plan.group_size, lineChars: plan.line_chars });
assert.ok(grouped.length < rows.length, 'grouping must produce fewer lines');
const coveredBefore = new Set(rows.map(row => row.source_id));
const coveredAfter = new Set(grouped.flatMap(group => group.source_ids));
assert.deepEqual([...coveredAfter].sort(), [...coveredBefore].sort(), 'grouping must not drop a single turn id: the fold coverage certificate depends on it');
assert.ok(grouped.every(group => group.source_ids.length >= 1));
assert.ok(grouped.reduce((sum, group) => sum + group.text.length, 0) <= rows.reduce((sum, row) => sum + row.text.length, 0), 'and it must not make the text longer');

// A novel window must NOT be compressed: that is the whole point of making it a function.
const novel = [
    { assistant_index: 1, id: 'turn_1_b', text: '契约的代价是交出七人份的记忆，且不可撤销；这一条写在铜牌背面，字是后来刻上去的。' },
    { assistant_index: 3, id: 'turn_3_b', text: '地窖第十三级台阶换成了泥土，底下有温风；风向朝北，说明更低的地方有出口。' },
    { assistant_index: 5, id: 'turn_5_b', text: '白鸦的动机是保命，不是和我做交易；他害怕的是名单上的人，而不是我。' },
    { assistant_index: 7, id: 'turn_7_b', text: '灰咳的源头不在井里，井只是一张嘴；真正的载体是水，水把根带进了每一户人家。' },
];
const novelRows = novel.map((entry, position) => ({ assistant_index: entry.assistant_index, source_id: entry.id, text: entry.text, at: position }));
const novelPlan = compressionPlan(repetitionScore(store, novel, novelRows));
assert.equal(novelPlan.group_size, 1, 'a window with no repetition must not be merged at all');
assert.equal(novelPlan.factor, 1, 'and it keeps its full budget');
const summary = compressionStats(store, repeated, rows);
assert.ok(summary.lines_after < summary.lines_before);
assert.ok(summary.ratio < 1, 'the reported ratio must show the saving');

// --- A6: eviction follows reconstructibility, and the budget yields to it --------------------------
let cold = createEmptyStore();
cold = turn(cold, 1, [
    { op: 'add', kind: 'commitment', slot: '誓言.守口', text: '我答应过白鸦不把井的事说出去' },
    { op: 'add', kind: 'state', slot: '茶.温度', text: '茶还温着' },
]);
cold = turn(cold, 3, [{ op: 'add', kind: 'state', slot: '风.方向', text: '风从北边来' }]);
cold.cold_turns = {
    version: 1,
    turns: {
        k1: { source_key: 'k1', assistant_index: 1, user_text: 'u'.repeat(100), assistant_text: 'a'.repeat(100) },
        k3: { source_key: 'k3', assistant_index: 3, user_text: 'u'.repeat(100), assistant_text: 'a'.repeat(100) },
    },
    order: ['k1', 'k3'],
    chars: 0,
};
cold.cold_turns.chars = 2 * (100 + 100 + 64);
const forced = planColdForgetting(cold, { maxChars: 100 });
assert.deepEqual(forced.drop_keys, ['k3'], 'the reconstructible state entry goes first, and the commitment-backed one stays');
assert.equal(forced.pinned, 1, 'the commitment-backed entry is pinned');
assert.equal(forced.over_budget, true, 'and the cap is exceeded on purpose rather than dropping it');

const loose = planColdForgetting(cold, { maxChars: 100000 });
assert.equal(loose.drop_keys.length, 0, 'under budget nothing is dropped');
assert.equal(loose.over_budget, false);
assert.equal(reconstructibilityOf({ kind: 'commitment' }), 0);
assert.equal(reconstructibilityOf({ kind: 'event' }), 4);
assert.equal(reconstructibilityOf({ kind: 'state', importance: 'critical' }), 0, 'critical importance outranks the kind');
const coldStats = forgettingStats(cold);
assert.equal(coldStats.entries, 2);
assert.equal(coldStats.pinned, 1);

// --- A8: the injection increment, per named section ------------------------------------------------
const block = [
    '[PLUGIN REFERENCE DATA — NOT DIALOGUE]',
    'This block contains objective reference material.',
    '[AETHERIA 分层剧情摘要 — 派生记忆]',
    '第一层发生了什么。第二层发生了什么。',
    '[HISTORICAL MEMORY]',
    '<memory id="m1"><summary>契约的代价是七人份记忆</summary></memory>',
    '[记忆变更链]',
    '- [state] 地点 (已变更 2 次) 曾: 夜路 -> 当前: 地窖',
    '[PLUGIN CURRENT STATE]',
    'State summary: 我在地窖第十三级。',
].join('\n');
const composition = injectionComposition(block);
assert.equal(composition.measured, true);
assert.equal(composition.sections.length, 5, 'five named sections, got ' + composition.sections.map(s => s.id).join(','));
assert.deepEqual(composition.sections.map(s => s.id), ['reference_head', 'layered_summary', 'historical_memory', 'spine', 'current_state']);
assert.equal(composition.sections.reduce((sum, s) => sum + s.chars, 0), block.length, 'the sections must tile the block exactly');
const increment = injectionSectionCost(block, 'spine');
assert.equal(increment.found, true);
assert.ok(increment.delta_tokens > 0, 'a section costs something');
assert.equal(increment.delta_tokens, composition.sections.find(s => s.id === 'spine').tokens);
assert.equal(increment.with_tokens - increment.without_tokens, increment.delta_tokens, 'the increment is the difference it makes');
const breakdown = injectionBreakdown({ referenceBlock: 'a'.repeat(100), currentStateBlock: 'b'.repeat(100), fullText: block });
assert.ok(breakdown.composition, 'the existing breakdown exposes the per-section view when the whole block is passed');
assert.equal(injectionComposition('').measured, false, 'an empty block is unmeasured, not zero');

// --- the chain the prompt gets must carry both endpoints -------------------------------------------
const chain = spinePromptBlock(store, { maxChars: 900, maxRows: 6 });
assert.ok(chain.includes('曾:'), 'the change chain names the replaced value');
assert.ok(chain.includes('地点.current'), 'for the slot that changed');

console.log('PASS v5.5 plan A: boundaries (A2), repetition-driven compression (A4), reconstructability forgetting (A6), injection increment (A8)');
