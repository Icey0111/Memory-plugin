// The one repair request a refused anchor section earns.
//
// The live 421757c acceptance run showed the failure this replaces: a batch whose first answer was refused
// for a formatting error came back as a bare "无" on the retry, and the valid facts in the first answer were
// lost. The host now makes one targeted repair call that shows the model its own answer and the exact
// errors, and re-checks the repaired answer atomically. These tests cover: valid content survives, exactly
// one extra call is made, a failed repair still refuses the batch, a non-format failure is not repaired, and
// the repair cost is reported apart from the batch cost.
import assert from 'node:assert/strict';
import { updateNarrative, readNarrativeReport } from './narrative-runtime.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const pair = n => [{ is_user: true, mes: '第' + n + '轮。' }, { is_user: false, mes: '第' + n + '轮回复。' }];
function host(summarize) {
    const ctx = { extensionSettings: { [KEY]: { enabled: true, narrative_every: 10, narrative_summary_tokens: 400,
            narrative_setting_tokens: 0, narrative_input_chars: 40000 } },
        chatMetadata: { [KEY]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, setExtensionPrompt() {},
        eventTypes: {}, eventSource: { on() {} } };
    const services = { vector: () => ({ supported: false, reason: 'vector disabled in this test' }),
        isCurrent: () => true, summarize };
    return { ctx, services };
}
const src = prompt => (String(prompt).match(/\[(raw_\d+)\]/) || [])[1] || 'raw_1';
const fill = (h, from, to) => { for (let n = from; n <= to; n += 1) h.ctx.chat.push(...pair(n)); };

// --- 1. a repair keeps the valid content the first answer carried ------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        if (calls.length === 1) {
            return '局面：门仍关着，钥匙在甲手里。\n【锚点变更】\n- 更新 A9 | 来源 ' + src(prompt)
                + ' | 钥匙转移。\n【知情边界】\n- 无';
        }
        return '局面：门仍关着，钥匙在甲手里。\n【锚点变更】\n- 新增 | 物品状态 | 钥匙 | 来源 ' + src(calls[0])
            + ' | 钥匙在甲手里。\n【知情边界】\n- 无';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 2, 'exactly one repair call');
    assert.match(calls[1], /【上一轮答案】/, 'the model is shown what it wrote');
    assert.match(calls[1], /【错误】/);
    assert.match(calls[1], /unknown_alias/, 'and which rule it broke');
    assert.match(calls[1], /门仍关着/, 'the valid content is named as content to keep');
    assert.equal(report.summary_failures, 0, 'the repaired batch commits');
    assert.equal(report.anchors_active, 1);
    assert.equal(report.anchor_repaired, true);
    assert.equal(report.anchor_parse, 'ok');
    assert.equal(report.anchors_ops.repaired, true);
    assert.ok(report.anchor_repair.cost.prompt_chars > 0, 'the repair cost is reported');
    assert.equal(report.anchor_repair.errors[0].reason, 'unknown_alias');
    // A later healthy batch marks the repair recovered instead of erasing what it cost.
    h.services.summarize = async () => '局面：门仍关着。\n【锚点变更】\n- 无\n【知情边界】\n- 无';
    fill(h, 11, 20);
    await updateNarrative(h.ctx, h.services, { force: true });
    assert.equal(readNarrativeReport(h.ctx).anchor_repair.recovered, true);
}

// --- 2. a failed repair still refuses the batch, and both attempts stay readable ----------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => {
        calls.push(prompt);
        return '局面：门仍关着。\n【锚点变更】\n- 更新 A9 | 来源 ' + src(calls[0])
            + ' | 钥匙转移。\n【知情边界】\n- 无';
    });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 2, 'one repair, never a third call');
    assert.equal(report.summary_failures, 1);
    assert.equal(report.summary_covered_floors, 0, 'nothing was hidden');
    assert.equal(report.anchor_op_errors[0].reason, 'unknown_alias', 'the original refusal is what is reported');
    assert.equal(report.anchor_repair.errors_after[0].reason, 'unknown_alias', 'and the repair own errors are kept');
    assert.equal(report.summary_last_error.repair.attempt, 1);
}

// --- 3. a failure a repair cannot fix is not repaired ------------------------------------------------
{
    const calls = [];
    const h = host(async (ctx, prompt) => { calls.push(prompt); return '\n【锚点变更】\n- 无\n【知情边界】\n- 无'; });
    fill(h, 1, 10);
    await updateNarrative(h.ctx, h.services, { force: true });
    const report = readNarrativeReport(h.ctx);
    assert.equal(calls.length, 1, 'a missing summary body is not a format problem the anchor repair can fix');
    assert.equal(report.summary_last_error.stage, 'format');
    assert.equal(report.summary_failures, 1);
}

// --- 4. a recoverable heading needs no second call ----------------------------------------------------
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

console.log('anchor-repair: ok');
