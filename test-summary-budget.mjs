// The budget policy, stated as executable checks before the implementation that has to satisfy it.
//
// Three numbers used to be one: the instruction's "target", the runtime's acceptance line, and the
// injection budget all moved together, so a 610-token body was refused against the target it was told to
// aim at. They are now separate: a soft target the model aims at, an emergency ceiling the runtime
// enforces, and a total injection budget the host room can cap. Equal completed-turn counts can carry
// different amounts of information, so a dense batch is allowed up to the ceiling; only a body past the
// ceiling is refused, and a refusal hides nothing. Offline fixtures establish the deterministic policy,
// not model fidelity.
import assert from 'node:assert/strict';
import { summaryLengthVerdict } from './raw-history.js';
import { updateNarrative, readNarrativeReport, budgetsOf } from './narrative-runtime.js';
import { estimateTokens } from './v55-tokenizer.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const pair = n => [{ is_user: true, mes: '第' + n + '轮：主角走进大厅，管家提到钥匙。' },
    { is_user: false, mes: '第' + n + '轮：管家回应，钥匙仍在甲手里。' }];
const body = extra => '局面稳定，钥匙仍在甲手里。' + '补'.repeat(extra)
    + '\n【锚点变更】\n- 无\n【已解决】\n- 无\n【知情边界】\n- 无';
const extraFor = want => {
    let lo = 0, hi = 8000;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (estimateTokens(body(mid)) < want) lo = mid + 1; else hi = mid; }
    return lo;
};
function host({ settings = {}, summarize } = {}) {
    const ctx = { extensionSettings: { [KEY]: { enabled: true, narrative_every: 10, narrative_summary_tokens: 400,
            narrative_setting_tokens: 0, narrative_input_chars: 40000, ...settings } },
        chatMetadata: { [KEY]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, setExtensionPrompt() {},
        eventTypes: {}, eventSource: { on() {} } };
    const services = { vector: () => ({ supported: false, reason: 'vector disabled' }),
        isCurrent: () => true, summarize: summarize || (async () => body(0)) };
    return { ctx, services, store: () => ctx.chatMetadata[KEY] };
}
const fill = (h, n) => { for (let i = 1; i <= n; i += 1) h.ctx.chat.push(...pair(i)); };

// --- 1. the verdict separates the soft target from the emergency ceiling ---------------------------
{
    assert.deepEqual(summaryLengthVerdict(590, { target: 600, ceiling: 900 }),
        { accepted: true, over_target: false, reason: 'within_target' });
    assert.deepEqual(summaryLengthVerdict(610, { target: 600, ceiling: 900 }),
        { accepted: true, over_target: true, reason: 'over_target' });
    assert.deepEqual(summaryLengthVerdict(910, { target: 600, ceiling: 900 }),
        { accepted: false, over_target: true, reason: 'over_ceiling' });
    assert.equal(summaryLengthVerdict(610, { target: 600 }).accepted, false,
        'with no ceiling configured, the target is the ceiling');
    assert.equal(summaryLengthVerdict(900, { target: 600, ceiling: 900 }).accepted, true,
        'the ceiling itself is accepted');
}

// --- 2. the injection budget is the ceiling plus the other blocks, capped by the host room ---------
{
    const opts = { summaryCeiling: 900, anchorTokens: 600, knowledgeTokens: 200,
        evidenceTokens: 1000, settingTokens: 400 };
    assert.equal(budgetsOf(opts).configured, 900 + 600 + 200 + 1000 + 400 + 100,
        'the configured budget is the worst case, not the target');
    const tight = budgetsOf(opts, { contextSize: 5000, rawTokens: 4000, replyReserve: 1000 });
    assert.equal(tight.hostRoom, 0, 'the visible transcript and reply reserve can leave no room');
    assert.equal(tight.totalBudget, 0);
    const roomy = budgetsOf(opts, { contextSize: 40000, rawTokens: 3000, replyReserve: 1000 });
    assert.equal(roomy.totalBudget, roomy.configured, 'the configured budget caps when the host has room');
}

// --- 3. equal turn counts: a dense batch is accepted up to the ceiling, a sparse one under target --
{
    const denseExtra = extraFor(500);
    const denseTokens = estimateTokens(body(denseExtra));
    assert.ok(denseTokens > 400 && denseTokens <= 900,
        'the dense fixture lands between target and ceiling: ' + denseTokens);
    const dense = host({ settings: { narrative_summary_ceiling_tokens: 900 }, summarize: async () => body(denseExtra) });
    fill(dense, 10);
    await updateNarrative(dense.ctx, dense.services);
    const denseReport = readNarrativeReport(dense.ctx);
    assert.ok(dense.store().narrative_summary, 'a body over the soft target but within the ceiling commits');
    assert.equal(denseReport.summary_target_tokens, 400);
    assert.equal(denseReport.summary_ceiling_tokens, 900);
    assert.ok(denseReport.summary_over_target, 'and the excess over the target is recorded, not hidden');
    assert.equal(denseReport.summary_failures, 0);
    assert.equal(dense.ctx.chat.filter(r => r.is_system).length, 20, 'the dense batch still hides its covered rows');

    const sparse = host({ settings: { narrative_summary_ceiling_tokens: 900 }, summarize: async () => body(0) });
    fill(sparse, 10);
    await updateNarrative(sparse.ctx, sparse.services);
    assert.ok(sparse.store().narrative_summary, 'the sparse batch commits');
    assert.equal(readNarrativeReport(sparse.ctx).summary_over_target, null, 'and reports no excess');
    assert.equal(sparse.ctx.chat.filter(r => r.is_system).length, 20, 'equal completed turns, equal coverage');
}

// --- 4. a body past the ceiling is refused, and the refusal hides nothing --------------------------
{
    const huge = host({ settings: { narrative_summary_ceiling_tokens: 900 }, summarize: async () => body(extraFor(1200)) });
    fill(huge, 10);
    await updateNarrative(huge.ctx, huge.services);
    const report = readNarrativeReport(huge.ctx);
    assert.equal(huge.store().narrative_summary, undefined, 'a body past the ceiling is never stored');
    assert.equal(report.summary_last_error.stage, 'over_budget');
    assert.equal(report.summary_last_error.summary_target_tokens, 400);
    assert.equal(report.summary_last_error.summary_ceiling_tokens, 900);
    assert.ok(report.summary_last_error.summary_tokens > 900, 'the actual size is recorded');
    assert.equal(huge.ctx.chat.filter(r => r.is_system).length, 0, 'no floor is hidden without an accepted stand-in');
}

console.log('summary-budget: ok');
