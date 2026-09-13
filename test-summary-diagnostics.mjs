// The summary diagnostics contract: what failed, which version was injected, and which warning means what.
//
// Written before the implementation. Each block states one rule the diagnostics rework has to satisfy:
//   1. a failure is classified and remembered, so "it failed once, then worked" is still answerable;
//   2. a committed state has a version that covers its content, and a prompt that was built but never
//      injected is not reported as the injected state;
//   3. assembling a prompt while a summary commits cannot pair an old summary block with transcript rows
//      hidden by the new one;
//   4. a warning names the condition: accumulating, summarizing, blocked, failing or backlogged.
import assert from 'node:assert/strict';
import { updateNarrative, buildNarrativeContext, runNarrativeGeneration, readNarrativeReport,
    narrativeSettings, generateNarrativeSummary, NARRATIVE_PROMPTS } from './narrative-runtime.js';

const KEY = 'aetheriaUnifiedMemoryV54';
// The anchor section is a change list now, and its source id has to exist in the batch the model was
// given - so the fixture reads the first id out of the request instead of hard-coding one that only
// happens to be right for the first batch.
const anySource = prompt => (String(prompt).match(/\[(raw_\d+)\]/) || [])[1] || 'raw_1';
const SUMMARY_BODY = prompt => '局面稳定。\n【锚点变更】\n- 新增 | 所有权 | 钥匙 | 来源 '
    + anySource(prompt) + ' | 钥匙属于甲\n【知情边界】\n- 乙 | 不知道 | 密码';
const pair = n => [{ is_user: true, mes: '第' + n + '轮：主角走进大厅。' },
    { is_user: false, mes: '第' + n + '轮：管家回应，钥匙仍在甲手里，乙不知道密码。' }];

function host({ settings = {}, summarize } = {}) {
    const ctx = { extensionSettings: { [KEY]: { enabled: true, narrative_every: 10, narrative_summary_tokens: 400,
            narrative_setting_tokens: 400, narrative_input_chars: 40000, ...settings } },
        chatMetadata: { [KEY]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, setExtensionPrompt() {},
        eventTypes: {}, eventSource: { on() {} } };
    let live = true;
    const services = { vector: () => ({ supported: false, reason: 'vector disabled in this test' }),
        isCurrent: () => live, leave: () => { live = false; },
        summarize: summarize || (async (_ctx, prompt) => SUMMARY_BODY(prompt)) };
    return { ctx, services, store: () => ctx.chatMetadata[KEY] };
}
const add = (h, n) => h.ctx.chat.push(...pair(n));
const fill = (h, n) => { for (let i = 1; i <= n; i += 1) add(h, i); };

// --- 1. the failure is classified, bounded and remembered after it recovers -----------------------
{
    // A transport/provider error: the stub throws without any stage, which is what an interface failure
    // looks like from here.
    const h = host({ summarize: async () => { throw new Error('provider down: 503'); } });
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    let report = readNarrativeReport(h.ctx);
    let record = report.summary_last_error;
    assert.equal(record.stage, 'transport');
    assert.match(record.reason, /provider down: 503/, 'the exact reason is kept, not a generic label');
    assert.equal(record.batch.turns, 10);
    assert.equal(record.batch.covered, 21, 'the greeting plus the twenty rows of the first batch');
    assert.ok(record.input_chars > 0, 'the cost of the request that failed is kept');
    assert.equal(record.context_tokens_status, 'unknown');
    assert.equal(record.response, null, 'a request that never returned has no response status');
    assert.equal(record.recovered, false);
    assert.equal(record.attempt, 1);
    assert.equal(report.diagnostics.summary_error !== null, true, 'the current error is also set');

    // A later success clears the current error and keeps the history, marked recovered.
    h.services.summarize = async (_ctx, prompt) => SUMMARY_BODY(prompt);
    await updateNarrative(h.ctx, h.services);
    report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_failures, 0, 'the failure counter resets on success');
    assert.equal(report.diagnostics.summary_error, null, 'the current error clears');
    record = report.summary_last_error;
    assert.equal(record.stage, 'transport', 'the last error survives the recovery');
    assert.match(record.reason, /provider down: 503/);
    assert.equal(record.recovered, true);
    assert.ok(record.recovered_at > 0);
}

// --- 2. the other failure stages are distinguished, and mean different things ---------------------
{
    // Empty body, through the real request path: generateRaw resolves with nothing.
    const h = host(); delete h.services.summarize;
    h.ctx.generateRaw = async () => '';
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    const record = readNarrativeReport(h.ctx).summary_last_error;
    assert.equal(record.stage, 'empty_body', 'an empty body is not a transport error');
    assert.equal(record.response.finish_reason, null);
}
{
    // Truncated body: the transport reports it ran out of room.
    const h = host(); delete h.services.summarize;
    h.ctx.generateRaw = async () => ({ content: '只有一半的正文', stop_reason: 'length' });
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    const record = readNarrativeReport(h.ctx).summary_last_error;
    assert.equal(record.stage, 'truncated');
    assert.equal(record.response.finish_reason, 'length');
    assert.ok(record.summary_tokens > 0, 'the truncated body was measured');
}
{
    // The body came back, but longer than the summary budget accepts.
    const h = host({ summarize: async () => '超'.repeat(4000) });
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    const record = readNarrativeReport(h.ctx).summary_last_error;
    assert.equal(record.stage, 'over_budget');
    assert.equal(record.summary_budget_tokens, 400);
    assert.ok(record.summary_tokens > 400, 'the actual size is recorded, so the 532/600 question is answerable');
}
{
    // Format: anchors but no prose.
    const h = host({ summarize: async () => '【锚点变更】\n- 更新 A1 | 来源 raw_3 | 钥匙属于甲\n【知情边界】\n- 无' });
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    assert.equal(readNarrativeReport(h.ctx).summary_last_error.stage, 'format');
}
{
    // Two failures on the same frozen batch are attempts 1 and 2, not two unrelated events.
    const h = host({ summarize: async () => { throw new Error('flaky'); } });
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    await updateNarrative(h.ctx, h.services);
    const record = readNarrativeReport(h.ctx).summary_last_error;
    assert.equal(record.attempt, 2, 'the same batch increments the attempt count');
}

// --- 3. a committed state has a content version, not only a coverage version ----------------------
{
    const h = host();
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    await runNarrativeGeneration(h.ctx, h.services, [{}, 32768, () => {}, 'normal']);
    let report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 10);
    assert.equal(report.injected_floors, 10);
    assert.equal(report.injected_stale, false);
    assert.equal(report.summary_state_revision, report.injected_state_revision);

    // The same coverage with different content is a different state, and the injection is stale.
    const store = h.store();
    store.narrative_summary = { ...store.narrative_summary, text: '完全改写的局面。' };
    report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_covered_floors, 10, 'the coverage did not change');
    assert.notEqual(report.summary_state_revision, report.injected_state_revision);
    assert.equal(report.injected_stale, true, 'same floors, different content, still stale');
}
{
    // Building the prompt is not injecting it.
    const h = host();
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    const bundle = await buildNarrativeContext(h.ctx, h.services, { contextSize: 32768 });
    assert.ok(bundle.currentStateBlock, 'the block was built');
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.injected_floors, null, 'a built prompt is not an injected prompt');
    assert.equal(report.injected_state_revision, null);
    await runNarrativeGeneration(h.ctx, h.services, [{}, 32768, () => {}, 'normal']);
    const after = readNarrativeReport(h.ctx);
    assert.equal(after.injected_floors, 10, 'setting the prompt records the injection');
    assert.equal(after.injected_state_revision, after.summary_state_revision);
}

// --- 4. assembling across a commit must not pair an old block with newly hidden rows --------------
{
    const h = host();
    fill(h, 20);
    await updateNarrative(h.ctx, h.services);          // batch 1 committed, ten floors hidden
    assert.equal(h.ctx.chat.filter(r => r.is_system).length, 20);

    let release; let entered;
    const gate = new Promise(resolve => { entered = resolve; });
    h.services.settings = async () => { entered(); await new Promise(r => { release = r; }); return { entries: [] }; };
    const building = buildNarrativeContext(h.ctx, h.services, { contextSize: 32768 });
    await gate;                                         // the assembly is parked inside an await
    await updateNarrative(h.ctx, h.services);           // batch 2 commits and hides ten more floors
    assert.equal(h.ctx.chat.filter(r => r.is_system).length, 40);
    release();
    const bundle = await building;
    assert.match(bundle.currentStateBlock, /current as of floor 20/,
        'the injected block must cover every row the transcript hides, even when the commit landed mid-assembly');
}

// --- 5. warnings name the condition instead of leaving a number to be interpreted -----------------
{
    const h = host();
    fill(h, 9);
    await updateNarrative(h.ctx, h.services);
    let report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_state, 'accumulating', 'nine turns is ordinary accumulation');
    assert.deepEqual(report.warnings, [], 'and not a fault, whatever the pending tokens are');
}
{
    const h = host();
    fill(h, 10);
    h.services.summarize = () => new Promise(() => {});          // never resolves: stay summarizing
    void updateNarrative(h.ctx, h.services);
    await new Promise(r => setTimeout(r, 20));
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_state, 'summarizing', 'a running pass is progress, not a fault');
    assert.deepEqual(report.warnings.filter(w => /失败|积压|尚未进入摘要/.test(w)), []);
}
{
    const h = host({ settings: { narrative_input_chars: 2000 } });
    fill(h, 10);
    h.ctx.chat[3].mes += '完整原文'.repeat(400);
    await updateNarrative(h.ctx, h.services);
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_state, 'blocked');
    assert.ok(report.warnings.some(w => /输入预算不足/.test(w)), 'a block warns');
}
{
    const h = host({ summarize: async () => { throw new Error('down'); } });
    fill(h, 10);
    for (let i = 0; i < 3; i += 1) await updateNarrative(h.ctx, h.services);
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_state, 'failing');
    assert.ok(report.warnings.some(w => /连续 3 次失败/.test(w)), 'real repeated failures still warn');
}
{
    // A backlog is a full batch that is neither running nor blocked: thirteen turns, no pass yet.
    const h = host();
    fill(h, 13);
    h.services.summarize = () => new Promise(() => {});
    void updateNarrative(h.ctx, h.services);
    await new Promise(r => setTimeout(r, 20));
    const report = readNarrativeReport(h.ctx);
    assert.equal(report.summary_state, 'summarizing');
    assert.equal(report.pending_floors >= 10, true);
    assert.ok(!report.warnings.some(w => /积压/.test(w)), 'while a pass runs, the backlog is progress');
}

// --- 6. the report shows the warnings the assembly recorded, including a fitted-out anchor block -----
{
    // Twenty genuinely different anchors, added in one batch: this block is about the token budget rather
    // than about the ledger, so nothing here is a restatement of anything else.
    const many = ['Seraphina答应不把钥匙的事说出去', '林舟承诺不再靠近那座井', '苏晚要求把断扣交还',
        '管家知道密道的位置', '守卫不会在夜里开门', '米拉负责保管那盏青铜灯', '老周欠你一次人情',
        '阿七把船停在了南岸', '护符只对持有者生效', '结界在月圆之夜最弱', '井底的根须会移动',
        '穹顶的裂缝每天变宽', '黑石刀不能带入石室', '刻痕必须在日出前描完', '源泉之水只能喝一次',
        '山下的名字不能念出来', '伤口在左臂而不是右臂', '毒发时钟与心跳同步', '长刀沉在井底槽中',
        '灯油只够走到第五道刻痕'].map((s, i) => '- 新增 | 承诺 | 事项' + i + ' | 来源 raw_3 | ' + s).join('\n');
    const h = host({ settings: { narrative_anchor_tokens: 100 } });
    h.services.summarize = async () => '局面。\n【锚点变更】\n' + many + '\n【知情边界】\n- 无';
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    const bundle = await buildNarrativeContext(h.ctx, h.services, { contextSize: 32768 });
    assert.equal(bundle.diagnostics.anchors_active, 20, 'twenty distinct anchors, none of them superseded');
    assert.ok(bundle.diagnostics.anchors_truncated > 0, 'the assembly parked anchors over the budget');
    const report = readNarrativeReport(h.ctx);
    const warning = report.warnings.find(w => /锚点块装不下/.test(w));
    assert.ok(warning, 'and the read-only report shows the same warning, not a hard-coded zero');
    assert.match(warning, new RegExp('搁置 ' + bundle.diagnostics.anchors_truncated + ' 条'),
        'with the same count the assembly reported');
    assert.equal(report.anchors_truncated, bundle.diagnostics.anchors_truncated);
}

// --- 7. the input budget default is set for new installs and never silently overwritten -----------
{
    const fresh = { extensionSettings: { [KEY]: { enabled: true } } };
    assert.equal(narrativeSettings(fresh).narrative_input_chars, 40000, 'a new install gets the measured default');

    const h = host({ settings: { narrative_input_chars: 18000 } });
    fill(h, 10);
    h.ctx.chat[3].mes += '完整原文'.repeat(6000);   // one long reply, like the run that failed
    await updateNarrative(h.ctx, h.services);
    const report = readNarrativeReport(h.ctx);
    assert.equal(h.ctx.extensionSettings[KEY].narrative_input_chars, 18000, 'an existing value is not overwritten');
    assert.equal(report.summary_block.reason, 'input_budget');
    assert.ok(report.notices.some(n => /18000/.test(n) && /旧默认值/.test(n)),
        'an install still on the old default is told, not quietly changed');
    assert.equal(report.summary_cost.context_tokens_status, 'unknown');

    const explicit = host({ settings: { narrative_input_chars: 25000 } });
    assert.equal(readNarrativeReport(explicit.ctx).notices.some(n => /旧默认值/.test(n)), false,
        'a value that is not the old default gets no legacy notice');
}

console.log('summary-diagnostics: ok');
