// The anchor block has a budget, and the ledger does not. These are the rules that reconcile them.
//
// Written before the implementation. The measured problem: 30 live anchors, 10 injected, and the cut kept
// the OLDEST because the block was filled in the order the model emitted lines. Two of the dropped ones
// were the corrected current values of facts whose stale versions stayed. So:
//   A. a superseded statement is never injected;
//   B. two statements about the same subject are never injected together;
//   C. the ledger keeps its history: supersession moves an entry, it does not delete it;
//   D. when the budget still binds, the cut is by kind priority and newest-first, and it is reported.
import assert from 'node:assert/strict';
import { supersedeAnchors, orderAnchors, selectAnchors, mergeAnchors, parseAnchors, formatAnchors,
    formatAnchorPrompt, ANCHOR_DUPLICATE_SIMILARITY, MAX_SUPERSEDED } from './raw-history.js';
import { updateNarrative, buildNarrativeContext, runNarrativeGeneration, readNarrativeReport,
    narrativeSettings } from './narrative-runtime.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const pair = n => [{ is_user: true, mes: '第' + n + '轮：主角走进大厅。' },
    { is_user: false, mes: '第' + n + '轮：管家回应，钥匙仍在。' }];
function host({ settings = {}, summarize } = {}) {
    const ctx = { extensionSettings: { [KEY]: { enabled: true, narrative_every: 10, narrative_summary_tokens: 400,
            narrative_setting_tokens: 0, narrative_input_chars: 40000, ...settings } },
        chatMetadata: { [KEY]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, setExtensionPrompt() {},
        eventTypes: {}, eventSource: { on() {} } };
    const services = { vector: () => ({ supported: false, reason: 'vector disabled in this test' }),
        isCurrent: () => true, summarize: summarize || (async () =>
            '局面。\n【锚点】\n- 无\n【已解决】\n- 无\n【知情边界】\n- 无') };
    return { ctx, services, store: () => ctx.chatMetadata[KEY] };
}
const anchor = (kind, text, extra = {}) => ({ id: 'a_' + text.slice(0, 6), kind, text, subject: '',
    first_seen: 1000, last_confirmed: 1000, passes: 1, unconfirmed: 0, ...extra });
const POISON_OLD = 'Seraphina被黑石刀伤中毒，魔法无法治愈，约不足一日内或及心脏。';
const POISON_DUP = 'Seraphina被黑石刀伤中毒，魔法无法治愈，约一日内或及心脏。';
const KNIFE_HELD = 'Ilyra的长刀现由你持有；它能切割符咒与魔法无法处理之物。';
const KNIFE_SUNK = 'Ilyra长刀已沉入井底根结槽中，被根须合拢锁住，不在你手中。';

// --- 1. a restatement is one entry, and the one that is kept is the newer -------------------------
{
    const older = anchor('生死状态', POISON_OLD, { id: 'old', last_confirmed: 1000, passes: 3 });
    const newer = anchor('生死状态', POISON_DUP, { id: 'new', last_confirmed: 2000, passes: 1 });
    const result = supersedeAnchors([older, newer]);
    assert.equal(result.active.length, 1, 'a near-verbatim restatement is not a second fact');
    assert.equal(result.active[0].id, 'new', 'the newer statement is the live value');
    assert.equal(result.superseded.length, 1);
    assert.equal(result.superseded[0].id, 'old', 'and the older one is kept, not deleted');
    assert.match(result.superseded[0].reason, /restatement/);
    assert.ok(ANCHOR_DUPLICATE_SIMILARITY <= 0.775 && ANCHOR_DUPLICATE_SIMILARITY >= 0.1,
        'the threshold sits between the measured restatements (0.775-0.800) and unrelated facts (0.011-0.014)');
    assert.ok(MAX_SUPERSEDED > 0);
}

// --- 2. two different facts survive together ------------------------------------------------------
{
    const a = anchor('承诺', 'Seraphina承诺会保护你、不让你独自面对危险。');
    const b = anchor('承诺', 'Seraphina要求你走山羊小径下到旧火道路，在第三道螺旋刻痕处汇合。');
    const result = supersedeAnchors([a, b]);
    assert.equal(result.active.length, 2, 'unrelated promises are two facts');
    assert.equal(result.superseded.length, 0);
}

// --- 3. the same subject with a new value: invariant B --------------------------------------------
{
    const held = anchor('所有权', KNIFE_HELD, { id: 'held', subject: 'Ilyra之刀', last_confirmed: 1000 });
    const sunk = anchor('所有权', KNIFE_SUNK, { id: 'sunk', subject: 'Ilyra之刀', last_confirmed: 2000 });
    // Lexically these are 0.021 apart, so nothing but an explicit subject can tell they are one fact.
    const result = supersedeAnchors([held, sunk]);
    assert.equal(result.active.length, 1, 'one subject holds one live value');
    assert.equal(result.active[0].id, 'sunk', 'the newer value wins');
    assert.equal(result.superseded[0].id, 'held');
    assert.match(result.superseded[0].reason, /same subject/);
    const both = supersedeAnchors([held, sunk]).active.map(item => item.id);
    assert.equal(both.includes('held') && both.includes('sunk'), false, 'invariant B holds');
}

// --- 4. the injected block never carries a superseded statement, and invariant A holds ------------
{
    const held = anchor('所有权', KNIFE_HELD, { id: 'held', subject: 'Ilyra之刀', last_confirmed: 1000 });
    const sunk = anchor('所有权', KNIFE_SUNK, { id: 'sunk', subject: 'Ilyra之刀', last_confirmed: 2000 });
    const state = supersedeAnchors([held, sunk]);
    const selection = selectAnchors(state.active, { budget: 600 });
    assert.match(selection.text, /沉入井底/, 'the live value is injected');
    assert.doesNotMatch(selection.text, /现由你持有/, 'the superseded one is not');
    assert.equal(selection.parked.length, 0);
}

// --- 5. when the budget binds, the cut is by kind priority and newest first -----------------------
{
    const active = [
        anchor('状态', '很久以前的一个场景状态，现在早已无关。', { id: 'old-state', last_confirmed: 1000 }),
        anchor('状态', '较新的一个场景状态。', { id: 'new-state', last_confirmed: 3000 }),
        anchor('生死状态', 'Seraphina被黑石刀伤中毒，自估约四小时。', { id: 'death', last_confirmed: 2000 }),
        anchor('所有权', 'Ilyra长刀已沉入井底根结槽中，不在你手中。', { id: 'knife', last_confirmed: 2500 }),
    ];
    const ordered = orderAnchors(active).map(item => item.id);
    assert.equal(ordered[0], 'death', 'a life-or-death fact outranks a scene note');
    assert.equal(ordered.indexOf('knife') < ordered.indexOf('old-state'), true);
    assert.equal(ordered.indexOf('new-state') < ordered.indexOf('old-state'), true,
        'within one kind the newest value comes first, so a tight budget drops the oldest');
    const tight = selectAnchors(active, { budget: 35 });
    assert.ok(tight.parked.length > 0, 'a tiny budget parks something');
    assert.equal(tight.injected.some(item => item.id === 'old-state'), false, 'the oldest scene note is the one parked');
    assert.equal(tight.text, formatAnchors(tight.injected), 'the injected text is exactly the selected lines');
    assert.ok(!tight.parked.some(item => tight.injected.includes(item)), 'nothing is both injected and parked');
}

// --- 6. parking is reported, and a parked live value is a warning --------------------------------
{
    const h = host({ settings: { narrative_anchor_tokens: 30 } });
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    h.services.summarize = async () => '局面。\n【锚点】\n- 无\n【已解决】\n- 无\n【知情边界】\n- 无';
    await updateNarrative(h.ctx, h.services);
    h.store().narrative_anchors = { version: 1, active: [
        anchor('生死状态', 'Seraphina被黑石刀伤中毒，自估约四小时。'),
        anchor('秘密', '井底女声是Ilyra反复自语被岩石记住的句子。'),
        anchor('承诺', 'Seraphina要求你见面时不要说出那个名字本身。'),
        anchor('状态', '穹顶南侧缝隙开启低通道。'),
    ], superseded: [], resolved: [] };
    const bundle = await buildNarrativeContext(h.ctx, h.services, { contextSize: 32768 });
    assert.equal(bundle.diagnostics.anchors_injected, 1, 'a 30-token anchor budget holds one line');
    assert.equal(bundle.diagnostics.anchors_parked, 3);
    assert.ok(bundle.diagnostics.anchors_parked_terms.length === 3);
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.anchors_parked, 3, 'the read-only report agrees with the assembly');
    assert.equal(report.anchors_truncated, 3, 'and the old name still means the same thing');
    assert.ok(report.warnings.some(w => /锚点块装不下/.test(w)), 'a parked live value warns');
    assert.match(report.warnings.find(w => /锚点块装不下/.test(w)), /3 条/);
}

// --- 7. a legacy store is normalised on load, and history survives --------------------------------
{
    const h = host();
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    await updateNarrative(h.ctx, h.services);
    h.store().narrative_anchors = { version: 1, active: [
        anchor('生死状态', POISON_OLD, { id: 'old', last_confirmed: 1000 }),
        anchor('生死状态', POISON_DUP, { id: 'new', last_confirmed: 2000 }),
        anchor('承诺', 'Seraphina承诺会保护你、不让你独自面对危险。', { id: 'keep' }),
    ], superseded: [], resolved: [] };
    const bundle = await buildNarrativeContext(h.ctx, h.services, { contextSize: 32768 });
    const store = h.store().narrative_anchors;
    assert.equal(store.active.length, 2, 'the restatement is folded away on load');
    assert.equal(store.superseded.length, 1, 'and it is archived, not dropped');
    assert.equal(store.superseded[0].text, POISON_OLD, 'the older statement is the archive entry');
    assert.match(bundle.currentStateBlock, /救命|不足一日|一日内/, 'the live value is what gets injected');
}

// --- 8. the summarizer is told the subject field and the supersession duty -------------------------
{
    const parsed = parseAnchors('局面。\n【锚点】\n- 所有权 | Ilyra之刀 | 已沉入井底，不在你手中。\n【已解决】\n- 所有权 | 现由你持有。');
    assert.equal(parsed.anchors[0].subject, 'Ilyra之刀', 'a three-field anchor carries an explicit subject');
    assert.equal(parsed.anchors[0].kind, '所有权');
    assert.equal(parsed.anchors[0].text, '已沉入井底，不在你手中。');
    const two = parseAnchors('局面。\n【锚点】\n- 承诺 | 她说：先走 | 后停\n【已解决】\n- 无');
    assert.equal(two.anchors[0].subject, '', 'an old-style line is still one statement, not a subject and a remainder');
    const prompt = formatAnchorPrompt([anchor('所有权', '已沉入井底，不在你手中。', { subject: 'Ilyra之刀' })]);
    assert.match(prompt, /- 所有权 \| Ilyra之刀 \| 已沉入井底/, 'the prompt shows the subject so the model can keep it stable');
    const merged = mergeAnchors({ active: [], superseded: [] }, parseAnchors(
        '局面。\n【锚点】\n- 所有权 | Ilyra之刀 | 现由你持有。\n【已解决】\n- 无'));
    assert.equal(merged.active[0].subject, 'Ilyra之刀');
}

console.log('anchor-budget: ok');
