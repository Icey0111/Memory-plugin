// The one targeted repair for a refused anchor section.
//
// Review of the first repair implementation found three defects an offline stub could reproduce, and this
// file pins their fixes:
//   1. a repair that answered "无" erased the first answer's valid operations and committed an empty ledger;
//   2. a repair transport failure left only "transport" in the record, with the original anchor errors and
//      the repair attempt both null;
//   3. the plugin could be disabled (or the chat edited or switched) during the repair and the batch still
//      committed, because the post-repair path re-checked less than the first path.
// It also pins the pre-send budget check and the separate cost record.
import assert from 'node:assert/strict';
import { updateNarrative, readNarrativeReport } from './narrative-runtime.js';
import { anchorRepairRequest, summaryRequest } from './raw-history.js';
import { estimateTokens } from './v55-tokenizer.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const pair = n => [{ is_user: true, mes: '第' + n + ' 轮。' }, { is_user: false, mes: '第' + n + ' 轮回复。' }];
function host(summarize, settings = {}) {
    const gate = { current: true };
    const ctx = { extensionSettings: { [KEY]: { enabled: true, narrative_every: 10, narrative_summary_tokens: 400,
            narrative_setting_tokens: 0, narrative_input_chars: 40000, ...settings } },
        chatMetadata: { [KEY]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, setExtensionPrompt() {},
        eventTypes: {}, eventSource: { on() {} } };
    const services = { vector: () => ({ supported: false, reason: 'vector disabled in this test' }),
        isCurrent: () => gate.current, summarize };
    return { ctx, services, gate, store: () => ctx.chatMetadata[KEY] };
}
const src = prompt => (String(prompt).match(/\[(raw_\d+)\]/) || [])[1] || 'raw_1';
const fill = (h, from, to) => { for (let n = from; n <= to; n += 1) h.ctx.chat.push(...pair(n)); };
const invalidLine = prompt => '更新 A9 | 来源 ' + src(prompt) + ' | 钥匙转移。';

// --- 1. a repair that answers 无 must not erase the valid operations the first answer carried ----------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) {
            return '局面：门仍关着，钥匙在甲手里。\n【锚点变更】\n'
                + '- 新增 | 物品状态 | 钥匙 | 来源 ' + src(prompt) + ' | 钥匙在甲手里。\n'
                + '- ' + invalidLine(prompt) + '\n【知情边界】\n- 无';
        }
        return '【锚点变更】\n- 无';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 2, 'exactly one repair call');
    assert.match(calls[1], /【被拒的行】/, 'the repair is shown the rejected line');
    assert.match(calls[1], /【已经通过校验、会被保留的行】/, 'and the valid line it must not repeat');
    assert.match(calls[1], /unknown_alias/, 'and which rule it broke');
    assert.equal(report.summary_failures, 0, 'the repaired batch commits');
    assert.equal(report.anchors_active, 1, 'the valid add survives a repair that answers 无');
    assert.equal(report.anchors_ops.added, 1);
    assert.equal(report.anchors_ops.updated, 0);
    assert.equal(report.anchor_repair.valid_preserved, 1);
    assert.equal(report.anchor_repair.replacement_lines, 0);
    assert.equal(h.store().narrative_summary.text, '局面：门仍关着，钥匙在甲手里。', 'the first summary is what commits');
}

// --- 2. a repair transport failure keeps the attempt and the original refusal ------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) return '局面：门仍关着。\n【锚点变更】\n- ' + invalidLine(prompt) + '\n【知情边界】\n- 无';
        throw new Error('socket closed');
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 2);
    assert.equal(report.summary_failures, 1);
    assert.equal(report.summary_covered_floors, 0, 'nothing was hidden');
    assert.equal(report.anchor_op_errors[0].reason, 'unknown_alias', 'the original refusal survives a repair failure');
    assert.equal(report.anchor_repair.sent, true);
    assert.equal(report.anchor_repair.stage, 'transport');
    assert.match(report.anchor_repair.error, /socket closed/);
    assert.equal(report.anchor_repair.response, null);
    assert.equal(report.anchor_repair.cost.usage_status, 'unknown', 'unavailable usage is unknown, not zero');
    assert.equal(report.anchor_repair.cost.completion_tokens, null);
    assert.equal(report.summary_last_error.repair.attempt, 1);
}

// --- 3. a repair that is still invalid refuses the batch, and both attempts stay readable -------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => { calls.push(prompt);
        return '局面：门仍关着。\n【锚点变更】\n- ' + invalidLine(calls[0]) + '\n【知情边界】\n- 无'; });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 2, 'one repair, never a third call');
    assert.equal(report.summary_failures, 1);
    assert.equal(report.summary_covered_floors, 0);
    assert.equal(report.anchor_op_errors[0].reason, 'unknown_alias');
    assert.equal(report.anchor_repair.errors_after[0].reason, 'unknown_alias');
    assert.equal(report.summary_last_error.repair.attempt, 1);
}

// --- 4. a failure a repair cannot fix is not repaired ------------------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => { calls.push(prompt); return '\n【锚点变更】\n- 无\n【知情边界】\n- 无'; });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 1, 'a missing summary body is not a format problem the anchor repair can fix');
    assert.equal(report.summary_last_error.stage, 'format');
    assert.equal(report.anchor_repair, null);
}

// --- 5. a recoverable heading needs no second call ----------------------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => { calls.push(prompt);
        return '局面：门还关着。\n新增 | 秘密 | 口令 | 来源 ' + src(prompt) + ' | 口令是青铜月亮。\n【知情边界】\n- 无'; });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 1, 'a structurally clear operation is recovered without a repair');
    assert.equal(report.anchor_parse, 'inferred');
    assert.equal(report.anchors_active, 1);
    assert.equal(report.anchor_repaired, false);
}

// --- 6. disabling the plugin during the repair stops the commit --------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) return '局面：门仍关着。\n【锚点变更】\n- ' + invalidLine(prompt) + '\n【知情边界】\n- 无';
        h.ctx.extensionSettings[KEY].enabled = false;
        return '【锚点变更】\n- 新增 | 物品状态 | 钥匙 | 来源 ' + src(calls[0]) + ' | 钥匙在甲手里。';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 0, 'a disabled plugin never commits the repaired batch');
    assert.equal(report.anchors_active, 0);
    assert.equal(report.anchor_repair.stopped, 'disabled');
}

// --- 7. editing a covered row during the repair stops the commit -------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) return '局面：门仍关着。\n【锚点变更】\n- ' + invalidLine(prompt) + '\n【知情边界】\n- 无';
        h.ctx.chat[1].mes = h.ctx.chat[1].mes + '（改）';
        return '【锚点变更】\n- 新增 | 物品状态 | 钥匙 | 来源 ' + src(calls[0]) + ' | 钥匙在甲手里。';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 0, 'an edited covered row blocks the commit');
    // A version-based chunk id makes an in-place edit move the coverage prefix before the text fingerprint;
    // either branch of the shared final check is a stop, and the fingerprint branch keeps its own record.
    assert.ok(['batch', 'coverage'].includes(report.anchor_repair.stopped), 'the edit is caught by the shared final check');
    if (report.anchor_repair.stopped === 'batch') assert.ok(report.diagnostics?.summary_batch_changed, 'and the reason is recorded');
}

// --- 8. switching chat during the repair stops the commit --------------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) return '局面：门仍关着。\n【锚点变更】\n- ' + invalidLine(prompt) + '\n【知情边界】\n- 无';
        h.gate.current = false;
        return '【锚点变更】\n- 新增 | 物品状态 | 钥匙 | 来源 ' + src(calls[0]) + ' | 钥匙在甲手里。';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 0, 'a switched chat never receives the repaired batch');
    assert.equal(report.anchor_repair.stopped, 'chat');
}

// --- 9. an over-budget repair is recorded and never sent ---------------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        const line = '- ' + invalidLine(prompt);
        return '局面：门仍关着。\n【锚点变更】\n' + Array.from({ length: 200 }, () => line).join('\n')
            + '\n【知情边界】\n- 无';
    }, { narrative_input_chars: 3000 });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 1, 'an over-budget repair is never sent');
    assert.ok(report.summary_cost.total_chars <= 3000, 'premise: the original request fit the budget');
    assert.equal(report.anchor_repair.sent, false);
    assert.equal(report.anchor_repair.blocked, true);
    assert.equal(report.anchor_repair.stage, 'input_budget');
    assert.equal(report.anchor_repair.needed_chars, report.anchor_repair.request_chars);
    assert.equal(report.anchor_repair.budget_chars, 3000);
    assert.equal(report.anchor_repair.cost.usage_status, 'unknown');
    assert.equal(report.summary_failures, 1, 'the batch keeps its refusal');
}

// --- 10. the repair's own summary is ignored; the first answer's prose is what commits ----------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) return '首稿局面。\n【锚点变更】\n- ' + invalidLine(prompt) + '\n【知情边界】\n- 无';
        return '修复者改写的局面。\n【锚点变更】\n- 新增 | 物品状态 | 钥匙 | 来源 ' + src(calls[0])
            + ' | 钥匙在甲手里。\n【知情边界】\n- 无';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    assert.equal(h.store().narrative_summary.text, '首稿局面。', 'the host keeps the first summary, not the repair rewrite');
    assert.equal(readNarrativeReport(h.ctx).anchors_active, 1);
}

// --- 11. kept lines and replacements are merged and re-validated as one batch -------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        const s = src(prompt);
        if (calls.length === 1) {
            return '局面。\n【锚点变更】\n- 新增 | 物品状态 | 钥匙 | 来源 ' + s + ' | 钥匙在甲手里。\n'
                + '- 新增 | 承诺 | 归还 | 来源 raw_999 | 甲会归还钥匙。\n【知情边界】\n- 无';
        }
        return '【锚点变更】\n- 新增 | 承诺 | 归还 | 来源 ' + s + ' | 甲会归还钥匙。';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.anchors_active, 2, 'the kept line and the replacement line both apply');
    assert.equal(report.anchor_repair.valid_preserved, 1);
    assert.equal(report.anchor_repair.replacement_lines, 1);
    assert.equal(report.anchors_ops.added, 2);
}

// --- 12. a redundant "结束 A1 旧状态" line is repaired away; the legal update still commits -------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) return '局面。\n【锚点变更】\n- 新增 | 物品状态 | 银钥匙 | 来源 ' + src(prompt)
            + ' | 钥匙在袋中。\n【知情边界】\n- 无';
        if (calls.length === 2) return '局面。\n【锚点变更】\n- 更新 A1 | 来源 ' + src(prompt)
            + ' | 钥匙并未失踪。\n- 结束 A1 旧状态 | 来源 ' + src(prompt) + ' | 旧值已被取代。\n【知情边界】\n- 无';
        return '【锚点变更】\n- 无';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    fill(h, 11, 20);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 3, 'one repair for the second batch');
    assert.equal(report.summary_failures, 0);
    assert.equal(report.anchors_active, 1);
    assert.equal(report.anchors_resolved, 0, 'the redundant end is gone, not applied');
    assert.equal(h.store().narrative_anchors.active[0].text, '钥匙并未失踪。');
    assert.equal(report.anchor_repair.valid_preserved, 1, 'the legal update was host-held');
}

// --- 13. a repair that ends a record this batch already updated is refused -----------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) return '局面。\n【锚点变更】\n- 新增 | 物品状态 | 银钥匙 | 来源 ' + src(prompt)
            + ' | 钥匙在袋中。\n【知情边界】\n- 无';
        if (calls.length === 2) return '局面。\n【锚点变更】\n- 更新 A1 | 来源 ' + src(prompt)
            + ' | 钥匙并未失踪。\n- 结束 A1 旧状态 | 来源 ' + src(prompt) + ' | 旧值已被取代。\n【知情边界】\n- 无';
        return '【锚点变更】\n- 结束 A1 | 来源 ' + src(calls[1]) + ' | 旧值已被取代。';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const before = readNarrativeReport(h.ctx).summary_covered_floors;
    fill(h, 11, 20);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, before, 'the batch is not committed');
    assert.equal(report.anchors_active, 1);
    assert.equal(report.anchor_repair.errors_after[0].reason, 'duplicate_target');
    assert.equal(report.anchor_repair.valid_preserved, 1);
}

// --- 14. the record chain keys on the two prompt signatures --------------------------------------------
{
    // A live acceptance harness records a model call only when its first message carries a known opener. The
    // summary call and its targeted repair have different openers: the repair is not a summary and never
    // carried the summary marker, and the 421757c long-chat run lost the repair's raw request, response and
    // elapsed time because the harness tested for the summary marker alone. These openers are the contract
    // between the host and that harness; if either changes, the harness silently stops recording raw bodies
    // and this test has to fail first.
    const summary = summaryRequest('', [], 600, [], []);
    assert.ok(summary.text.startsWith('你是剧情续接摘要器'), 'the summary request keeps its opener');
    const repair = anchorRepairRequest({ validLines: ['更新 A1 | 来源 raw_1 | 钥匙在袋中。'],
        errors: [{ line: '更新 A9 | 来源 raw_1 | 钥匙转移。', reason: 'unknown_target' }], plan: [], sources: ['raw_1'] });
    assert.ok(repair.text.startsWith('你上一轮答案的'), 'the repair request keeps its own opener');
    assert.ok(!repair.text.startsWith('你是剧情续接摘要器'), 'the repair is a distinct call kind');
    assert.ok(repair.text.includes('【锚点变更】'), 'the repair names the section it is replacing');
    assert.ok(estimateTokens(repair.text) > 0, 'the repair request is nonempty');
}

console.log('anchor-repair: ok');
