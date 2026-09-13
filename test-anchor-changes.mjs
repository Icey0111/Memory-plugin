// Anchors are now changed by named operations on host-assigned ids, not re-derived by matching a label.
//
// Written before the implementation, from the design that followed the Mem0/Graphiti source review:
//   A. the host gives every live anchor a short id in the frozen request, and the model returns only changes;
//   B. an update names its target, so "the same subject" no longer authorises replacing a value;
//   C. a reference the host cannot check fails the whole batch: nothing is committed and nothing is hidden,
//      and the host never falls back to guessing which record the model meant;
//   D. an anchor nobody mentions is untouched - not deleted, and not relabelled as re-confirmed.
//
// The metrics this file makes checkable: wrong supersession, stale residue, condition retention, protocol
// failure and cost. "Fewer live anchors" and "nothing parked" are outcomes, not evidence of a better rule.
import assert from 'node:assert/strict';
import { planAnchors, formatAnchorPrompt, parseAnchors, parseAnchorChanges, mergeAnchors, summaryRequest,
    anchorSubjectKey, selectAnchors, anchorAliasFor } from './raw-history.js';
import { updateNarrative, buildNarrativeContext, readNarrativeReport } from './narrative-runtime.js';

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
const rec = (id, kind, subject, text, extra = {}) => ({ id, kind, subject, text, revision: 1,
    source: 'raw_10', first_seen: 100, last_confirmed: 100, passes: 1, unconfirmed: 0, ...extra });
/** The first source id the request actually offered, so no fixture depends on the raw_N numbering. */
const anySource = prompt => (String(prompt).match(/\[(raw_\d+)\]/) || [])[1] || 'raw_1';
const changeOf = (reply, plan, sources) => {
    const parsed = parseAnchors(reply);
    return { parsed, ...parseAnchorChanges(parsed.anchorLines, { plan, batchSources: new Set(sources) }) };
};
const POISON = 'Seraphina被黑石刀伤中毒，魔法无法治愈，约不足一日内或及心脏。';
const KNIFE_HELD = 'Ilyra的长刀现由你持有；它能切割符咒与魔法无法处理之物。';
const KNIFE_SUNK = 'Ilyra长刀已沉入井底根结槽中，被根须合拢锁住，不在你手中。';

// --- 1. the frozen request carries a short id, the label and the whole old value --------------------
{
    const active = [rec('a1', '所有权', '刀的所有权', '刀属于甲。', { first_seen: 1000 }),
        rec('a2', '位置', '刀的位置', '刀在井底。', { first_seen: 2000, revision: 3 })];
    const plan = planAnchors(active);
    assert.equal(plan.length, 2);
    const byId = new Map(plan.map(row => [row.id, row]));
    assert.equal(byId.get('a2').alias, 'A1', 'the kind the scene just touched is served first');
    assert.equal(byId.get('a2').revision, 3, 'the plan freezes the version the request was built from');
    assert.equal(byId.get('a1').revision, 1);
    const text = formatAnchorPrompt(plan);
    assert.match(text, /- A1 \| 位置 \| 刀的位置 \| 刀在井底。/, 'the id, the label and the full old value');
    assert.match(text, /- A2 \| 所有权 \| 刀的所有权 \| 刀属于甲。/);
    assert.equal(anchorAliasFor(0), 'A1');
    assert.equal(anchorAliasFor(9), 'A10');
}

// --- 2. the three operations are distinct, and each one does one thing ------------------------------
{
    const active = [rec('k', '位置', '刀的位置', '刀在井底。'), rec('p', '承诺', '归还钥匙',
        '甲承诺天亮前归还钥匙，前提是乙先释放人质。')];
    const plan = planAnchors(active);
    const { changes, errors } = changeOf('局面。\n【锚点变更】\n'
        + '- 更新 A1 | 来源 raw_77 | 刀已被乙捞出，放在井边。\n'
        + '- 新增 | 秘密 | 暗门口令 | 来源 raw_79 | 只有乙知道口令“青铜月亮”。\n'
        + '- 结束 A2 | 来源 raw_80 | 乙已释放人质，甲已归还钥匙。\n'
        + '【知情边界】\n- 无', plan, ['raw_77', 'raw_79', 'raw_80']);
    assert.deepEqual(errors, []);
    assert.deepEqual(changes.map(c => c.op), ['update', 'add', 'end']);
    assert.equal(changes[0].id, 'k');
    assert.equal(changes[0].text, '刀已被乙捞出，放在井边。');
    assert.equal(changes[1].subject, '暗门口令');
    assert.equal(changes[2].id, 'p');
    const applied = mergeAnchors({ version: 1, active, superseded: [], resolved: [] }, changes, { plan, at: 5000 });
    assert.equal(applied.ok, true);
    assert.deepEqual(applied.stats, { total: 3, added: 1, updated: 1, ended: 1, restated: 0,
        reinterpreted: 0, truncated: 0, invalid: 0 });
    const live = applied.ledger.active;
    assert.equal(live.length, 2, 'one record was replaced in place, one was added, one left');
    const knife = live.find(row => row.id === 'k');
    assert.equal(knife.text, '刀已被乙捞出，放在井边。', 'an update changes the value of the named record');
    assert.equal(knife.revision, 2, 'an update is a new version of the same record');
    assert.equal(knife.source, 'raw_77', 'and it records where the new value came from');
    assert.equal(applied.ledger.superseded[0].text, '刀在井底。', 'the old value is archived, not deleted');
    assert.equal(applied.ledger.superseded[0].source, 'raw_10',
        'the retired value keeps the source it came from');
    assert.equal(applied.ledger.superseded[0].replaced_by_source, 'raw_77',
        'and the record says which source replaced it');
    assert.match(applied.ledger.superseded[0].reason, /update/);
    assert.equal(live.some(row => row.id === 'p'), false, 'an ended record leaves the live list');
    assert.equal(applied.ledger.resolved[0].text, '甲承诺天亮前归还钥匙，前提是乙先释放人质。',
        'and it keeps the condition it was made under');
    assert.match(applied.ledger.resolved[0].reason, /释放人质/);
    assert.equal(applied.ledger.version, 2);
}

// --- 3. the same label no longer authorises a replacement -------------------------------------------
{
    // Measured on the old ledger: a label was the whole authority, so any later line about one subject
    // retired the earlier one whatever it said. The pair below is the case where that was right, and the
    // reason it is now the model's explicit job to say so.
    const previous = { version: 1, active: [rec('x', '所有权', 'Ilyra之刀', KNIFE_HELD)], superseded: [], resolved: [] };
    const plan = planAnchors(previous.active);
    const { changes, errors } = changeOf('局面。\n【锚点变更】\n- 新增 | 所有权 | Ilyra之刀 | 来源 raw_5 | ' + KNIFE_SUNK,
        plan, ['raw_5']);
    assert.deepEqual(errors, []);
    const applied = mergeAnchors(previous, changes, { plan, at: 9 });
    assert.equal(applied.ledger.active.length, 2, 'two statements about one label are two facts now');
    assert.equal(applied.ledger.superseded.length, 0, 'nothing was retired because a label matched');
    assert.equal(applied.ledger.subject_collisions, 1, 'the collision is counted so the panel can name it');
    assert.equal(selectAnchors(applied.ledger.active, { budget: 600 }).parked.length, 0);
}

// --- 4. a slash label keeps the content after the slash ---------------------------------------------
{
    assert.equal(anchorSubjectKey({ subject: '心脏石植入者/制造者' }), '心脏石植入者/制造者',
        'the label is a label; identity is the id now, so nothing is normalised away to make a merge possible');
    assert.notEqual(anchorSubjectKey({ subject: '心脏石植入者/制造者' }), anchorSubjectKey({ subject: '心脏石植入者' }));
    const active = [rec('m', '威胁', '心脏石植入者/制造者', '有人在 Eldoria 野兽体内植入心脏石。')];
    const plan = planAnchors(active);
    assert.ok(formatAnchorPrompt(plan).includes('心脏石植入者/制造者'), 'and the model is shown it verbatim');
    const { changes, errors } = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_2 | 有人或某物在野兽与桥上身影体内植入心脏石。',
        plan, ['raw_2']);
    assert.deepEqual(errors, []);
    const applied = mergeAnchors({ version: 1, active, superseded: [], resolved: [] }, changes, { plan });
    assert.equal(applied.ok, true);
    assert.equal(applied.stats.updated, 1);
}

// --- 5. a condition is not shortened away -----------------------------------------------------------
{
    const active = [rec('c', '承诺', '归还钥匙', '甲承诺天亮前归还钥匙，前提是乙先释放人质。')];
    const plan = planAnchors(active);
    const text = '甲承诺天亮前归还钥匙，前提是乙先释放人质且旧城门不再设卡。';
    const { changes } = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_3 | ' + text, plan, ['raw_3']);
    assert.equal(changes[0].text, text, 'the whole statement is kept, condition included');
    assert.match(changes[0].text, /前提/);
}

// --- 6. an unknown id rejects the batch -------------------------------------------------------------
{
    const plan = planAnchors([rec('only', '秘密', '口令', '口令是青铜月亮。')]);
    const { changes, errors } = changeOf('局面。\n【锚点变更】\n- 更新 A7 | 来源 raw_4 | 口令改了。', plan, ['raw_4']);
    assert.equal(changes.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].reason, 'unknown_alias');
    assert.match(errors[0].line, /A7/);
}

// --- 7. a source outside the frozen batch rejects the batch -----------------------------------------
{
    const plan = planAnchors([rec('only', '秘密', '口令', '口令是青铜月亮。')]);
    const outside = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_999 | 口令改了。', plan, ['raw_4']);
    assert.equal(outside.errors[0].reason, 'source_not_in_batch');
    const missing = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 口令改了。', plan, ['raw_4']);
    assert.equal(missing.errors[0].reason, 'missing_source',
        'an unverifiable claim is not a valid operation, so it is rejected rather than guessed at');
    // A bare source token is the same statement, spelled shorter: the batch ids are unambiguous.
    const bare = changeOf('局面。\n【锚点变更】\n- 更新 A1 | raw_4 | 口令改了。', plan, ['raw_4']);
    assert.deepEqual(bare.errors, []);
    assert.equal(bare.changes[0].source, 'raw_4');
}

// --- 8. one record cannot be changed twice in one batch ---------------------------------------------
{
    const plan = planAnchors([rec('one', '秘密', '口令', '口令是青铜月亮。')]);
    const both = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_4 | 口令改了。\n- 结束 A1 | 来源 raw_4 | 已作废。',
        plan, ['raw_4']);
    assert.equal(both.errors.length, 1);
    assert.equal(both.errors[0].reason, 'duplicate_target');
    const twice = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_4 | 甲。\n- 更新 A1 | 来源 raw_4 | 乙。',
        plan, ['raw_4']);
    assert.equal(twice.errors[0].reason, 'duplicate_target', 'two different updates for one record are a conflict');
    const updateOnly = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_4 | 甲。', plan, ['raw_4']);
    assert.deepEqual(updateOnly.errors, []);
}

// --- 8b. the update word without a target is an add, not a refusal ----------------------------------
{
    // Measured on the live 40-turn acceptance: the summarizer wrote nine lines shaped
    // "更新 | 类型 | 主体 | 来源 raw_N | 陈述" - the update word with a type and a label instead of an id -
    // and the run paid three refused batches and three extra model calls before it got the word right.
    // Nothing is named in that line, so nothing can be retired by accepting it.
    const plan = planAnchors([rec('only', '秘密', '口令', '口令是青铜月亮。')]);
    const { changes, errors } = changeOf('局面。\n【锚点变更】\n'
        + '- 更新 | 类型 | Seraphina | 来源 raw_4 | 她赠予的木坠与自己的孪坠相互感应。', plan, ['raw_4']);
    assert.deepEqual(errors, []);
    assert.equal(changes[0].op, 'add', 'an update with no target is an add, whatever it called itself');
    assert.equal(changes[0].reinterpreted, true, 'and the report says the word was reinterpreted');
    assert.equal(changes[0].kind, '类型');
    assert.equal(changes[0].subject, 'Seraphina');
    const applied = mergeAnchors({ version: 1, active: [rec('only', '秘密', '口令', '口令是青铜月亮。')],
        superseded: [], resolved: [] }, changes, { plan });
    assert.equal(applied.ledger.active.length, 2, 'the existing record is not retired');
    assert.equal(applied.ledger.superseded.length, 0);
    assert.equal(applied.stats.added, 1);
    assert.equal(applied.stats.reinterpreted, 1);
    // The dangerous shape is unchanged: a *valid* alias that has moved is still a conflict, and an "结束"
    // with no target is still refused, because there is no record it could mean.
    const named = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_4 | 口令改了。', plan, ['raw_4']);
    const moved = mergeAnchors({ version: 2, active: [rec('only', '秘密', '口令', '换过了。', { revision: 9 })],
        superseded: [], resolved: [] }, named.changes, { plan });
    assert.equal(moved.ok, false);
    const ended = changeOf('局面。\n【锚点变更】\n- 结束 | 来源 raw_4 | 不再生效。', plan, ['raw_4']);
    assert.equal(ended.errors[0].reason, 'alias_required');
}

// --- 9. a record that moved since the freeze is a conflict ------------------------------------------
{
    // The late result: the plan was built from revision 1, and by the time the answer arrives the ledger
    // has moved on. Applying "the value for A1" now would overwrite a newer fact with an older decision.
    const plan = planAnchors([rec('one', '秘密', '口令', '口令是青铜月亮。', { revision: 1 })]);
    const moved = { version: 2, active: [rec('one', '秘密', '口令', '口令已换成铁砧。', { revision: 2 })],
        superseded: [], resolved: [] };
    const { changes } = changeOf('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_4 | 口令是青铜月亮。', plan, ['raw_4']);
    const applied = mergeAnchors(moved, changes, { plan, at: 7 });
    assert.equal(applied.ok, false);
    assert.equal(applied.ledger, null);
    assert.equal(applied.errors[0].reason, 'stale_version');
    assert.equal(applied.errors[0].expected, 1);
    assert.equal(applied.errors[0].found, 2);
    const gone = mergeAnchors({ version: 2, active: [], superseded: [], resolved: [] }, changes, { plan });
    assert.equal(gone.errors[0].reason, 'stale_target', 'a record that was ended meanwhile is no longer a target');
}

// --- 10. the same batch answered twice is applied once ----------------------------------------------
{
    // A rejected or failed pass does not advance coverage, so the next attempt freezes the same batch and
    // the same plan. Re-applying the same operations must not duplicate the record or archive it twice.
    const reply = '局面：大厅。\n【锚点变更】\n- 新增 | 秘密 | 口令 | 来源 raw_3 | 口令是青铜月亮。\n【知情边界】\n- 无';
    const h = host();
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    let call = 0;
    h.services.summarize = async () => {
        call += 1;
        if (call === 1) throw new Error('offline');
        return reply;
    };
    await updateNarrative(h.ctx, h.services, { force: true });
    assert.equal(readNarrativeReport(h.ctx).summary_failures, 1, 'the first attempt failed before it committed');
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_failures, 0, 'the retry committed');
    assert.equal(report.anchors_active, 1, 'and the one fact is one record, not two');
    assert.equal(report.anchors_superseded, 0);
    assert.equal(h.store().narrative_anchors.active[0].text, '口令是青铜月亮。');
}

// --- 11. an exact restatement is the same record, and does not double ---------------------------------
{
    const active = [rec('s', '秘密', '口令', '口令是青铜月亮。')];
    const plan = planAnchors(active);
    const { changes, errors } = changeOf('局面。\n【锚点变更】\n- 新增 | 秘密 | 口令 | 来源 raw_8 | 口令是青铜月亮。',
        plan, ['raw_8']);
    assert.deepEqual(errors, []);
    const applied = mergeAnchors({ version: 1, active, superseded: [], resolved: [] }, changes, { plan, at: 20 });
    assert.equal(applied.ledger.active.length, 1, 'the same statement about the same label is one fact');
    assert.equal(applied.stats.restated, 1);
    assert.equal(applied.stats.added, 0);
    assert.equal(applied.ledger.active[0].id, 's', 'and the existing record is the one that survives');
    assert.equal(applied.ledger.active[0].unconfirmed, 0, 'a restatement is a confirmation');
}

// --- 12. a rejected batch hides nothing and commits nothing -----------------------------------------
{
    const good = prompt => '局面：大厅。\n【锚点变更】\n- 新增 | 秘密 | 口令 | 来源 '
        + anySource(prompt) + ' | 口令是青铜月亮。\n【知情边界】\n- 无';
    const h = host();
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    let refuse = false;
    h.services.summarize = async (ctx, prompt) => refuse
        ? '局面：大厅。\n【锚点变更】\n- 更新 A9 | 来源 ' + anySource(prompt) + ' | 口令改了。\n【知情边界】\n- 无'
        : good(prompt);
    await updateNarrative(h.ctx, h.services, { force: true });
    const before = readNarrativeReport(h.ctx);
    assert.equal(before.anchors_active, 1);
    const coveredBefore = before.summary_covered_floors;
    for (let n = 11; n <= 20; n += 1) h.ctx.chat.push(...pair(n));
    refuse = true;
    await updateNarrative(h.ctx, h.services, { force: true });
    const after = readNarrativeReport(h.ctx);
    assert.equal(after.summary_failures, 1, 'the batch is reported as a failure, not silently skipped');
    assert.equal(after.summary_covered_floors, coveredBefore, 'nothing was hidden: coverage did not advance');
    assert.equal(after.anchors_active, 1, 'and the ledger is exactly what it was');
    assert.equal(after.anchor_parse, 'ok', 'the section was there; the operations in it were not');
    assert.equal(after.anchor_op_errors.length, 1);
    assert.equal(after.anchor_op_errors[0].reason, 'unknown_alias');
    const failure = after.summary_last_error;
    assert.equal(failure.stage, 'anchor_ops', 'the stage names the condition instead of saying "the model failed"');
    assert.match(failure.stage_label, /锚点变更/);
    assert.match(after.warnings.join(' '), /锚点变更/);

    // The refusal outlives the retry that fixes it, the way a classified summary failure does. The live run
    // that first exercised this lost both of its refusals to the next commit, so the lines could no longer
    // be read at all.
    for (let n = 21; n <= 30; n += 1) h.ctx.chat.push(...pair(n));
    refuse = false;
    await updateNarrative(h.ctx, h.services, { force: true });
    const recovered = readNarrativeReport(h.ctx);
    assert.equal(recovered.summary_failures, 0, 'the retry committed');
    assert.equal(recovered.anchor_op_errors.length, 1, 'the refused lines are still readable');
    assert.equal(recovered.anchor_op_errors[0].reason, 'unknown_alias');
    assert.equal(recovered.anchor_op_errors_recovered, true, 'and the record says the condition cleared');
    assert.equal(recovered.warnings.some(w => /锚点变更/.test(w)), false, 'so it is not a standing warning');
}

// --- 13. a missing section refuses coverage and leaves the ledger unchanged -------------------------
{
    const h = host();
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    let reply = '局面：大厅。\n【锚点变更】\n- 新增 | 秘密 | 口令 | 来源 raw_3 | 口令是青铜月亮。\n【知情边界】\n- 无';
    h.services.summarize = async () => reply;
    await updateNarrative(h.ctx, h.services, { force: true });
    const first = { ...h.store().narrative_anchors.active[0] };
    assert.equal(first.passes, 1);
    assert.ok(Number.isFinite(Number(first.last_confirmed)));
    for (let n = 11; n <= 20; n += 1) h.ctx.chat.push(...pair(n));
    reply = '局面：大厅，一切照旧。';
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_failures, 1, 'a missing required section refuses the batch');
    assert.equal(report.summary_covered_floors, 10);
    assert.equal(report.summary_last_error.anchor_errors[0].reason, 'missing_section');
    assert.equal(report.anchors_active, 1, 'silence is not a resolution');
    assert.equal(report.anchors_unconfirmed, 0);
    assert.equal(h.store().narrative_anchors.active[0].passes, 1, 'and it is not counted as re-confirmed');
    assert.equal(h.store().narrative_anchors.active[0].last_confirmed, first.last_confirmed,
        'its confirmation time does not move');
    assert.equal(h.store().narrative_anchors.active[0].first_seen, first.first_seen);
}

// --- 14. the report and the panel expose the batch, its refusals and what was retired ---------------
{
    const reply = '局面：大厅。\n【锚点变更】\n'
        + '- 新增 | 秘密 | 口令 | 来源 raw_3 | 口令是青铜月亮。\n'
        + '- 新增 | 位置 | 刀的位置 | 来源 raw_5 | 刀在井底。\n【知情边界】\n- 无';
    const h = host();
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    h.services.summarize = async () => reply;
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.anchors_ops.total, 2);
    assert.equal(report.anchors_ops.added, 2);
    assert.equal(report.anchors_ops.invalid, 0);
    assert.equal(report.anchors_same_subject, 0);
    assert.equal(report.anchors_superseded_limit >= 40, true, 'the retention window is stated, not implied');
    // The second pass updates one of them, and the retired value keeps its source.
    for (let n = 11; n <= 20; n += 1) h.ctx.chat.push(...pair(n));
    const ledger = h.store().narrative_anchors;
    const target = ledger.active.find(row => row.subject === '口令');
    const alias = planAnchors(ledger.active).find(row => row.id === target.id)?.alias || 'A1';
    h.services.summarize = async (ctx, prompt) => '局面：大厅。\n【锚点变更】\n- 更新 ' + alias
        + ' | 来源 ' + anySource(prompt) + ' | 口令已换成铁砧。\n【知情边界】\n- 无';
    await updateNarrative(h.ctx, h.services, { force: true });
    const after = readNarrativeReport(h.ctx);
    assert.equal(after.summary_failures, 0, 'the update resolved its target through the frozen alias table');
    assert.equal(after.anchors_ops.updated, 1);
    assert.equal(after.anchors_superseded, 1);
    const retired = h.store().narrative_anchors.superseded[0];
    assert.equal(retired.text, '口令是青铜月亮。');
    assert.equal(retired.source, 'raw_3', 'the retired record keeps the source it was created from');
    assert.ok(retired.replaced_by_source, 'and the record names the source that replaced it');
    assert.equal(after.anchors_active, 2, 'the other fact is untouched');
    assert.equal(after.anchors_unconfirmed, 1, 'and it is the one that was not mentioned');
}

// --- 15. anchors are still injected, still ordered and still parked inside their own budget ---------
{
    const h = host({ settings: { narrative_anchor_tokens: 30 } });
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    await updateNarrative(h.ctx, h.services, { force: true });
    h.store().narrative_anchors = { version: 2, active: [
        rec('i1', '生死状态', 'Seraphina的毒', POISON),
        rec('i2', '秘密', '井底女声', '井底女声是Ilyra反复自语被岩石记住的句子。'),
        rec('i3', '承诺', '不要说出名字', 'Seraphina要求你见面时不要说出那个名字本身。'),
        rec('i4', '状态', '南侧缝隙', '穹顶南侧缝隙开启低通道。')], superseded: [], resolved: [] };
    const bundle = await buildNarrativeContext(h.ctx, h.services, { contextSize: 32768 });
    assert.equal(bundle.diagnostics.anchors_injected, 1, 'a 30-token anchor budget holds one line');
    assert.equal(bundle.diagnostics.anchors_parked, 3);
    assert.ok(bundle.diagnostics.anchors_parked_terms.length === 3);
    assert.match(bundle.currentStateBlock, /BINDING CONTINUITY ANCHORS/);
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.anchors_parked, 3, 'the read-only report agrees with the assembly');
    const parkedWarning = report.warnings.find(w => /锚点块装不下/.test(w));
    assert.ok(parkedWarning, 'a parked live value warns');
    assert.match(parkedWarning, /结束 A/,
        'and tells the operator the operation that actually resolves one, not the retired 【已解决】 spelling');
    assert.doesNotMatch(parkedWarning, /【已解决】/);
}

// --- 16. presentation must not turn an operation into zero changes ---------------------------------
{
    const plan = planAnchors([rec('k', '位置', '刀', '刀在井底。')]);
    const operation = '更新 A1 | 来源 raw_77 | 刀已放到井边。';
    for (const body of ['\n' + operation, operation, '：' + operation, '\n- ' + operation]) {
        const parsed = parseAnchors('局面。\n【锚点变更】' + body + '\n【知情边界】\n- 无');
        const checked = parseAnchorChanges(parsed.anchorLines, { plan, batchSources: new Set(['raw_77']) });
        assert.equal(parsed.anchor_section, 'ok');
        assert.deepEqual(checked.errors, []);
        assert.equal(checked.changes[0].id, 'k');
    }
    assert.equal(parseAnchors('局面。').anchor_section, 'missing');
    assert.equal(parseAnchors('局面。\n【锚点变更】\n【知情边界】\n- 无').anchor_section, 'empty');
    assert.equal(parseAnchors('局面。\n【锚点变更】无').anchor_section, 'none');
    const malformed = parseAnchors('局面。\n【锚点变更】\n我改了刀的位置。');
    assert.equal(parseAnchorChanges(malformed.anchorLines).errors[0].reason, 'unknown_op');
    assert.equal(parseAnchorChanges(['无', operation], { plan, batchSources: new Set(['raw_77']) })
        .errors[0].reason, 'mixed_none');
}

// --- 17. labels are display text; complete conditions survive past the former 240-character cap -----
{
    const previous = { active: [rec('k', '承诺', '约定', '旧约定仍有效。')] };
    const plan = planAnchors(previous.active);
    const label = '在北侧旧城门外等待救援的约定：甲、乙与丙的条件';
    const statement = '双方需要遵守约定。'.repeat(35) + '但只有乙释放人质后才交还钥匙，否则不得交付。';
    const checked = parseAnchorChanges(['更新 A1 | 承诺 | ' + label + ' | 来源 raw_7 | ' + statement],
        { plan, batchSources: new Set(['raw_7']) });
    assert.deepEqual(checked.errors, []);
    const applied = mergeAnchors(previous, checked.changes, { plan });
    assert.equal(applied.ledger.active[0].text, statement);
    assert.equal(applied.ledger.active[0].subject, label);
    assert.equal(applied.ledger.superseded[0].text, '旧约定仍有效。');
    const malformed = parseAnchorChanges(['新增 | 承诺 | 多余 | 标签 | 来源 raw_7 | 条件。'],
        { batchSources: new Set(['raw_7']) });
    assert.equal(malformed.errors[0].reason, 'bad_fields');
}

// --- 18. a nonempty unreadable section and an empty section both leave the whole batch visible ------
for (const [body, reason] of [['', 'empty_section'], ['我改了刀的位置。', 'unknown_op']]) {
    const h = host({ summarize: async () => '局面。\n【锚点变更】\n' + body + '\n【知情边界】\n- 无' });
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 0);
    assert.equal(report.folded_floors, 0);
    assert.equal(report.summary_last_error.anchor_errors[0].reason, reason);
    h.services.summarize = async () => '局面。\n【锚点变更】无';
    await updateNarrative(h.ctx, h.services, { force: true });
    assert.equal(readNarrativeReport(h.ctx).summary_covered_floors, 10);
    assert.equal(readNarrativeReport(h.ctx).anchors_ops.section, 'none');
}

// --- 19. a source cell may name several original rows, and one bad row still refuses the batch --------
{
    const previous = { active: [rec('k', '位置', '刀的位置', '刀在井底。')] };
    const plan = planAnchors(previous.active);
    const sources = new Set(['raw_15', 'raw_16', 'raw_17', 'raw_18']);
    const update = parseAnchors('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_15、raw_17 | 刀被捞出，放在井边。\n【知情边界】\n- 无');
    const checked = parseAnchorChanges(update.anchorLines, { plan, batchSources: sources });
    assert.deepEqual(checked.errors, []);
    assert.deepEqual(checked.changes[0].sources, ['raw_15', 'raw_17'], 'every source is kept');
    assert.equal(checked.changes[0].source, 'raw_15、raw_17', 'and the display string keeps both');
    const applied = mergeAnchors(previous, checked.changes, { plan });
    assert.equal(applied.ok, true);
    assert.deepEqual(applied.ledger.active.find(row => row.id === 'k').sources, ['raw_15', 'raw_17']);
    assert.equal(applied.ledger.superseded[0].replaced_by_source, 'raw_15、raw_17');
    // The ASCII comma and a bare source list are the other two shapes the live responses used.
    const comma = parseAnchorChanges(parseAnchors('局面。\n【锚点变更】\n- 新增 | 秘密 | 口令 | 来源 raw_15, raw_18 | 口令是青铜月亮。\n【知情边界】\n- 无').anchorLines,
        { plan, batchSources: sources });
    assert.deepEqual(comma.errors, []);
    assert.deepEqual(comma.changes[0].sources, ['raw_15', 'raw_18']);
    const bare = parseAnchorChanges(['新增 | 秘密 | 口令 | raw_15、raw_16 | 口令是青铜月亮。'],
        { plan, batchSources: sources });
    assert.deepEqual(bare.errors, []);
    assert.deepEqual(bare.changes[0].sources, ['raw_15', 'raw_16']);
    // One token outside the batch refuses the whole batch, exactly as a single bad source does.
    const foreign = parseAnchorChanges(parseAnchors('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_15、raw_99 | 刀被捞出。\n【知情边界】\n- 无').anchorLines,
        { plan, batchSources: sources });
    assert.equal(foreign.changes.length, 0);
    assert.equal(foreign.errors[0].reason, 'source_not_in_batch');
    assert.equal(foreign.errors[0].detail, 'raw_99');
    // A token that is not a raw_N is a malformed field, not a silently dropped head cell.
    const malformed = parseAnchorChanges(parseAnchors('局面。\n【锚点变更】\n- 更新 A1 | 来源 raw_15、不明 | 刀被捞出。\n【知情边界】\n- 无').anchorLines,
        { plan, batchSources: sources });
    assert.equal(malformed.changes.length, 0);
    assert.equal(malformed.errors[0].reason, 'bad_source');
    assert.equal(malformed.errors[0].detail, '不明');
}

// --- 20. an operation without its heading is recovered only when it is unmistakable -------------------
{
    const previous = { active: [rec('p', '承诺', '归还钥匙', '甲承诺天亮前归还钥匙，前提是乙先释放人质。')] };
    const plan = planAnchors(previous.active);
    const probe = '更新 A1 | 来源 raw_79 | 甲承诺明天正午前归还钥匙，前提是乙先释放人质；人质尚未释放，钥匙尚未归还。\n\n【已解决】：无\n【知情边界】：无';
    const parsed = parseAnchors(probe);
    assert.equal(parsed.anchor_section, 'inferred', 'the heading is missing, the operation is not');
    const checked = parseAnchorChanges(parsed.anchorLines, { plan, batchSources: new Set(['raw_79']) });
    assert.deepEqual(checked.errors, []);
    assert.equal(checked.changes[0].op, 'update');
    assert.equal(checked.changes[0].id, 'p');
    assert.match(checked.changes[0].text, /前提是乙先释放人质/, 'the condition survives the recovery');
    // Prose that merely mentions 更新 is not an operation, so the section stays honestly missing.
    const prose = parseAnchors('管家更新了账本。\n队伍更新了装备 | 来源不明\n本次没有变化，不需要更新 A1\n【知情边界】\n- 无');
    assert.equal(prose.anchor_section, 'missing');
    assert.equal(prose.anchorLines.length, 0);
    assert.match(prose.summary, /更新/);
    // And the runtime commits a recovered section instead of refusing it.
    const h = host();
    for (let n = 1; n <= 10; n += 1) h.ctx.chat.push(...pair(n));
    h.services.summarize = async (ctx, prompt) => '局面：门还关着。\n新增 | 秘密 | 口令 | 来源 '
        + anySource(prompt) + ' | 口令是青铜月亮。\n【知情边界】\n- 无';
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.anchor_parse, 'inferred');
    assert.equal(report.anchors_active, 1);
    assert.equal(report.summary_failures, 0);
    assert.equal(report.summary_covered_floors, 10);
}

// --- 21. the ledger-check guidance is in the request, and the host still mandates nothing -------------
{
    const request = summaryRequest('', [{ id: 'raw_1', retrievalText: 'x' }], 600, [], []);
    assert.match(request.text, /【当前锚点】为空，这是初始账本/, 'the empty-ledger initialization guidance is present');
    assert.match(request.text, /其他活值是否与你的新状态矛盾/, 'the contradiction check is present');
    assert.match(request.text, /角色认知与未证猜测/, 'fact, belief and guess are told apart');
    assert.match(request.text, /一条事实依赖多条原文时可以并排写多个来源/, 'the multi-source shape is taught');
    assert.match(request.text, /“更新”会自动归档旧值/, 'an update is told not to end its own number');
    assert.match(request.text, /“结束”表示整条事实不再有效/, 'and end is defined as the whole fact ceasing to hold');
    assert.doesNotMatch(request.text, /空账本必须|必须新增至少|至少新增一条/, 'no non-empty mandate is imposed');
    // An empty ledger that truly has no new fact may still answer none, and the host adds nothing of its own.
    const parsed = parseAnchors('局面。\n【锚点变更】\n- 无');
    assert.equal(parsed.anchor_section, 'none');
    const applied = mergeAnchors({ active: [] }, [], { plan: [] });
    assert.equal(applied.ok, true);
    assert.equal(applied.stats.added, 0);
}

// --- 22. an update and an end may not name the same record in one batch --------------------------------
{
    const previous = { active: [rec('k', '位置', '刀的位置', '刀在井底。')] };
    const plan = planAnchors(previous.active);
    const checked = parseAnchorChanges([
        '更新 A1 | 来源 raw_7 | 刀被捞出，放在井边。',
        '结束 A1 | 来源 raw_8 | 旧状态已被取代。',
    ], { plan, batchSources: new Set(['raw_7', 'raw_8']) });
    assert.equal(checked.errors.length, 1);
    assert.equal(checked.errors[0].reason, 'duplicate_target');
    assert.equal(checked.changes.filter(c => c.op === 'end').length, 0,
        'a later end may not retire a record this batch already updated');
    // The trailing-label spelling the model actually wrote does not parse at all. The repair fixes it; the
    // operator is not relaxed, because stripping "旧状态" would execute the conflicting end it is hiding.
    const trailing = parseAnchorChanges(['结束 A1 旧状态 | 来源 raw_8 | 旧状态已被取代。'],
        { plan, batchSources: new Set(['raw_8']) });
    assert.equal(trailing.errors[0].reason, 'unknown_op');
    assert.equal(trailing.changes.length, 0);
}

// --- 23. an empty ledger asks for initialization, a non-empty one asks for the delta -------------------
{
    const one = [{ id: 'a', kind: '物品状态', subject: '测试', text: '测试事实。' }];
    const empty = summaryRequest('', [{ id: 'raw_1', retrievalText: 'x' }], 600, [], []);
    const full = summaryRequest('', [{ id: 'raw_1', retrievalText: 'x' }], 600, one, []);
    for (const request of [empty, full]) {
        assert.match(request.text, /- 更新 A3 \| 来源 raw_77 \|/);
        assert.match(request.text, /- 新增 \| 类型 \| 主体 \| 来源 raw_79 \|/);
        assert.match(request.text, /- 结束 A5 \| 来源 raw_80 \|/);
        assert.match(request.text, /来源必须是本批【新增原文】里真实出现的编号/);
    }
    assert.match(empty.text, /【当前锚点】为空，这是初始账本/);
    assert.match(empty.text, /判断依据是账本尚未记录它，而不是剧情本轮刚发生变化/);
    assert.match(empty.text, /确实没有需要长期保留的事实时写“无”/);
    assert.doesNotMatch(empty.text, /只写本轮变化的事实/);
    assert.match(full.text, /只写本轮变化的事实。编号只能取自【当前锚点】/);
    assert.doesNotMatch(full.text, /这是初始账本/);
    assert.doesNotMatch(empty.text, /必须新增|至少新增/);
    assert.doesNotMatch(full.text, /必须新增|至少新增/);
}

console.log('anchor-changes: ok');
