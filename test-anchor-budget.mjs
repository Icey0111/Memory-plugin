// The anchor block has a budget, and the ledger does not. These are the rules that reconcile them.
//
// Written before the implementation. The measured problem: 30 live anchors, 10 injected, and the cut kept
// the OLDEST because the block was filled in the order the model emitted lines. Two of the dropped ones
// were the corrected current values of facts whose stale versions stayed. So:
//   A. a retired statement is never injected;
//   B. one label can hold several live records now, and the collision is counted rather than resolved;
//   C. the ledger keeps its history: a replacement moves an entry, it does not delete it;
//   D. when the budget still binds, the cut is by kind round-robin and newest-first, and it is reported.
import assert from 'node:assert/strict';
import { orderAnchors, selectAnchors, mergeAnchors, parseAnchors, parseAnchorChanges, formatAnchors,
    formatAnchorPrompt, planAnchors, anchorSubjectKey, MAX_SUPERSEDED, MAX_RESOLVED } from './raw-history.js';
import { updateNarrative, buildNarrativeContext, readNarrativeReport,
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
        isCurrent: () => true, summarize: summarize || (async () => '局面。\n【锚点变更】\n- 无\n【知情边界】\n- 无') };
    return { ctx, services, store: () => ctx.chatMetadata[KEY] };
}
const anchor = (kind, text, extra = {}) => ({ id: 'a_' + text.slice(0, 6), kind, text, subject: '',
    revision: 1, source: 'raw_1', first_seen: 1000, last_confirmed: 1000, passes: 1, unconfirmed: 0, ...extra });
/** Apply checked operations to a ledger, for the sections that are about the ledger rather than the wire. */
const apply = (active, lines, sources) => {
    const plan = planAnchors(active);
    const { changes, errors } = parseAnchorChanges(lines, { plan, batchSources: new Set(sources) });
    assert.deepEqual(errors, []);
    return { plan, ...mergeAnchors({ version: 1, active, superseded: [], resolved: [] }, changes, { plan, at: 5000 }) };
};
const POISON_OLD = 'Seraphina被黑石刀伤中毒，魔法无法治愈，约不足一日内或及心脏。';
const POISON_DUP = 'Seraphina被黑石刀伤中毒，魔法无法治愈，约一日内或及心脏。';
const KNIFE_HELD = 'Ilyra的长刀现由你持有；它能切割符咒与魔法无法处理之物。';
const KNIFE_SUNK = 'Ilyra长刀已沉入井底根结槽中，被根须合拢锁住，不在你手中。';

// --- 1. an explicit update retires a value; a matching label does not -------------------------------
{
    const held = anchor('所有权', KNIFE_HELD, { id: 'held', subject: 'Ilyra之刀', last_confirmed: 1000 });
    const updated = apply([held], ['更新 A1 | 来源 raw_2 | ' + KNIFE_SUNK], ['raw_2']);
    assert.equal(updated.ledger.active.length, 1, 'the named record is the one that changes');
    assert.equal(updated.ledger.active[0].id, 'held', 'and it keeps its identity while its value moves');
    assert.equal(updated.ledger.active[0].revision, 2);
    assert.equal(updated.ledger.superseded[0].text, KNIFE_HELD, 'the old value is archived, not deleted');
    assert.match(updated.ledger.superseded[0].reason, /update/);
    // Lexically these two are 0.021 apart, which is why a similarity rule could never be the whole rule.
    const added = apply([held], ['新增 | 所有权 | Ilyra之刀 | 来源 raw_2 | ' + KNIFE_SUNK], ['raw_2']);
    assert.equal(added.ledger.active.length, 2, 'an add is not an update, whatever label it carries');
    assert.equal(added.ledger.superseded.length, 0, 'nothing was retired by a label match');
    assert.equal(added.ledger.subject_collisions, 1, 'and the collision is counted, not guessed away');
    assert.ok(MAX_SUPERSEDED > 0 && MAX_RESOLVED > 0);
}

// --- 2. two different facts survive together ------------------------------------------------------
{
    const active = [anchor('承诺', 'Seraphina承诺会保护你、不让你独自面对危险。', { id: 'a' }),
        anchor('承诺', 'Seraphina要求你走山羊小径下到旧火道路，在第三道螺旋刻痕处汇合。', { id: 'b' })];
    const result = apply(active, ['新增 | 承诺 | 护送 | 来源 raw_2 | 管家会护送你到第三道刻痕。'], ['raw_2']);
    assert.equal(result.ledger.active.length, 3, 'unrelated promises are three facts');
    assert.equal(result.ledger.superseded.length, 0);
}

// --- 3. a restatement is one entry, and the record that survives is the existing one ---------------
{
    const older = anchor('生死状态', POISON_OLD, { id: 'old', subject: 'Seraphina的毒', last_confirmed: 1000, passes: 3 });
    const result = apply([older], ['新增 | 生死状态 | Seraphina的毒 | 来源 raw_2 | ' + POISON_OLD], ['raw_2']);
    assert.equal(result.ledger.active.length, 1, 'the same text and label is one record');
    assert.equal(result.ledger.active[0].id, 'old', 'and the record that already exists is the one kept');
    assert.equal(result.ledger.active[0].passes, 4, 'the restatement counts as a confirmation');
    assert.equal(result.stats.restated, 1);
    // A near-verbatim restatement is NOT folded any more: the threshold could not tell it from a new value,
    // and the explicit update is what makes the distinction now.
    const near = apply([anchor('生死状态', POISON_OLD, { id: 'old', subject: 'Seraphina的毒' })],
        ['新增 | 生死状态 | Seraphina的毒 | 来源 raw_2 | ' + POISON_DUP], ['raw_2']);
    assert.equal(near.ledger.active.length, 2, 'the retired similarity threshold no longer folds near matches');
}

// --- 4. the injected block never carries a retired statement --------------------------------------
{
    const held = anchor('所有权', KNIFE_HELD, { id: 'held', subject: 'Ilyra之刀', last_confirmed: 1000 });
    const updated = apply([held], ['更新 A1 | 来源 raw_2 | ' + KNIFE_SUNK], ['raw_2']);
    const selection = selectAnchors(updated.ledger.active, { budget: 600 });
    assert.match(selection.text, /沉入井底/, 'the live value is injected');
    assert.doesNotMatch(selection.text, /现由你持有/, 'the retired one is not');
    assert.equal(selection.parked.length, 0);
}

// --- 5. when the budget binds, the cut is by recency, made fair by kind round-robin ---------------
{
    const active = [
        anchor('状态', '很久以前的一个场景状态，现在早已无关。', { id: 'old-state', last_confirmed: 1000 }),
        anchor('状态', '较新的一个场景状态。', { id: 'new-state', last_confirmed: 3000 }),
        anchor('生死状态', 'Seraphina被黑石刀伤中毒，自估约四小时。', { id: 'death', last_confirmed: 2000 }),
        anchor('所有权', 'Ilyra长刀已沉入井底根结槽中，不在你手中。', { id: 'knife', last_confirmed: 2500 }),
    ];
    const ordered = orderAnchors(active).map(item => item.id);
    // Kind priority is gone (ADR-0027): the taxonomy is the model's, so a hand-written rank table goes
    // stale silently. The rule that survives is recency, made fair by serving one line per kind in turn.
    assert.equal(ordered[0], 'new-state', 'the kind whose newest fact is newest is served first');
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
    h.services.summarize = async () => '局面。\n【锚点变更】\n- 无\n【知情边界】\n- 无';
    await updateNarrative(h.ctx, h.services);
    h.store().narrative_anchors = { version: 2, active: [
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
    const parkedWarning = report.warnings.find(w => /锚点块装不下/.test(w));
    assert.match(parkedWarning, /3 条/);
    // The message has to describe the rule that is actually in force: the rank table was deleted, and a
    // warning that still promised "kind priority" was found live after that deletion.
    assert.doesNotMatch(parkedWarning, /类型优先级/);
    assert.match(parkedWarning, /类型轮流/);
    // And it has to name the operation that really ends an anchor, not the section the old protocol used.
    assert.match(parkedWarning, /结束 A#/);
    assert.doesNotMatch(parkedWarning, /【已解决】/);
}

// --- 7. a legacy ledger is migrated as it stands, and a label collision is reported ---------------
{
    // The fold that used to run here is the rule this protocol removes. Running it on load would leave one
    // place where a label still authorised a replacement, so the restatement survives and is counted.
    const h = host();
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    await updateNarrative(h.ctx, h.services);
    h.store().narrative_anchors = { version: 1, active: [
        anchor('生死状态', POISON_OLD, { id: 'old', subject: 'Seraphina的毒', last_confirmed: 1000 }),
        anchor('生死状态', POISON_DUP, { id: 'new', subject: 'Seraphina的毒', last_confirmed: 2000, revision: undefined }),
    ], superseded: [], resolved: [] };
    const bundle = await buildNarrativeContext(h.ctx, h.services, { contextSize: 32768 });
    const store = h.store().narrative_anchors;
    assert.equal(store.active.length, 2, 'a legacy ledger is migrated exactly as it stands');
    assert.equal(store.superseded.length, 0, 'nothing is folded on load any more');
    assert.equal(bundle.diagnostics.anchors_same_subject, 1,
        'and the collision the old rule would have hidden is reported');
    assert.equal(readNarrativeReport(h.ctx).anchors_same_subject, 1, 'the read-only report derives it too');
    assert.ok(store.active.every(item => item.subject === 'Seraphina的毒'));
}

// --- 8. the summarizer is told the alias table and the operation rules ----------------------------
{
    const active = [anchor('所有权', '已沉入井底，不在你手中。', { id: 'k', subject: 'Ilyra之刀', revision: 3 })];
    const plan = planAnchors(active);
    assert.equal(plan[0].alias, 'A1');
    assert.equal(plan[0].revision, 3, 'the table freezes the version the answer will be checked against');
    const prompt = formatAnchorPrompt(plan);
    assert.match(prompt, /- A1 \| 所有权 \| Ilyra之刀 \| 已沉入井底/, 'the id, the label and the whole old value');
    const { changes, errors } = parseAnchorChanges(
        ['更新 A1 | 来源 raw_9 | 已由乙捞出，放在井边。'], { plan, batchSources: new Set(['raw_9']) });
    assert.deepEqual(errors, []);
    assert.equal(changes[0].id, 'k', 'the alias resolves to the record the host actually sent');
    assert.equal(changes[0].revision, 3, 'and carries the version it was approved against');
}

// --- 9. a slash label keeps the content after the slash ------------------------------------------
{
    // The old rule dropped the suffix to make "心脏石植入者/制造者" equal "心脏石植入者". It made
    // "刀/位置" equal "刀/所有者" too, and there is no reading of the label that separates those two.
    assert.equal(anchorSubjectKey({ subject: '刀/位置' }), '刀/位置');
    assert.notEqual(anchorSubjectKey({ subject: '刀/位置' }), anchorSubjectKey({ subject: '刀/所有者' }));
    assert.equal(anchorSubjectKey({ subject: '  心脏石植入者 / 制造者 ' }), '心脏石植入者 / 制造者',
        'only whitespace is collapsed now');
    const active = [anchor('位置', '刀在井底。', { id: 'pos', subject: '刀/位置' }),
        anchor('所有权', '刀属于甲。', { id: 'own', subject: '刀/所有者' })];
    const result = apply(active, ['更新 A1 | 来源 raw_2 | 刀已被乙捞出。'], ['raw_2']);
    assert.equal(result.ledger.active.length, 2, 'retiring one attribute leaves the other alone');
    assert.equal(result.ledger.superseded.length, 1);
}

// --- 10. a label that merely contains another is a different label --------------------------------
{
    // Measured: containment would merge these five, and every one of them is a different fact - a person
    // and their rope, a place and its barrier, a character and her pouch. So containment is not a rule, and
    // under the change protocol neither is equality: only the id decides what an update replaces.
    for (const [left, right] of [['user', 'user的保护绳'], ['Seraphina', 'Seraphina的额外小袋'],
        ['格莱德', '格莱德结界'], ['Seraphina', 'Seraphina的嗡鸣承诺'], ['Seraphina', 'Seraphina的计数策略']]) {
        assert.notEqual(anchorSubjectKey({ subject: left }), anchorSubjectKey({ subject: right }),
            JSON.stringify(left) + ' and ' + JSON.stringify(right) + ' are two labels');
        const result = apply([anchor('状态', left + '的说明。', { id: 'l', subject: left })],
            ['新增 | 状态 | ' + right + ' | 来源 raw_2 | ' + right + '的说明。'], ['raw_2']);
        assert.equal(result.ledger.active.length, 2, 'and adding one never retires the other');
    }
}

// --- 11. the kind the scene just touched is served first, newest first inside it ------------------
{
    const active = [
        anchor('状态', '很久以前的一个场景状态。', { id: 'old-state', first_seen: 1000, last_confirmed: 1000 }),
        anchor('状态', '刚刚更新的场景状态。', { id: 'new-state', first_seen: 5000, last_confirmed: 5000 }),
        anchor('生死状态', '被黑石刀伤中毒，自估约四小时。', { id: 'death', first_seen: 2000, last_confirmed: 2000 }),
    ];
    const ordered = orderAnchors(active).map(item => item.id);
    assert.equal(ordered[0], 'new-state', 'the kind with the newest fact is served first');
    assert.equal(ordered.indexOf('old-state'), ordered.length - 1, 'its stale sibling is served last');
    const tight = selectAnchors(active, { budget: 35 });
    assert.equal(tight.injected.some(item => item.id === 'old-state'), false, 'a tight budget parks the oldest');
    assert.equal(tight.parked[0].id, 'old-state');
}

// --- 12. no kind starves, whatever taxonomy the model invents -------------------------------------
{
    // The taxonomy in the live run was 保护, 关系, 地点, 威胁, 承诺, 条件/命令, 秘密, 计数, 身份/状态 - none of
    // which a hand-written table can be trusted to keep up with. Round-robin needs no table.
    const active = ['威胁', '计数', '条件/命令', '保护', '地点'].map((kind, i) =>
        anchor(kind, kind + ' 的第一条事实。', { id: 'k' + i, first_seen: 1000 + i }));
    active.push(anchor('威胁', '威胁的第二条事实。', { id: 'threat2', first_seen: 9000 }));
    const ordered = orderAnchors(active);
    const firstRound = ordered.slice(0, 5).map(item => String(item.kind).split('/')[0]);
    assert.equal(new Set(firstRound).size, 5, 'five kinds are all served before any kind is served twice');
    assert.equal(ordered.findIndex(item => item.id === 'k0') >= 5, true,
        'the older threat waits for the second round while the newer one takes the first slot');
    assert.equal(selectAnchors(active, { budget: 600 }).parked.length, 0, 'and all six fit when there is room');
}

// --- 13. the legacy anchor budget is reported, never overwritten ----------------------------------
{
    const h = host({ settings: { narrative_anchor_tokens: 300 } });
    assert.ok(readNarrativeReport(h.ctx).notices.some(n => /300/.test(n) && /旧默认值/.test(n)));
    assert.equal(narrativeSettings(h.ctx).narrative_anchor_tokens, 300);
}

console.log('anchor-budget: ok');
