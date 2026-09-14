// Recovery and isolation, from the audit's failure list.
//
// F-1: the host metadata write can fail after the committed state is already on the store. That is a
// persistence problem, not a model failure - it must not increment summary_failures or claim stage
// 'transport'. A write that fails before the commit still rejects and hides nothing.
// F-8: the original-text vector collection is a raw-history kind, not the memory kind; before this it
// matched the memory pattern, so a raw query read the memory index state and could take the memory score
// policy or be marked stale against a fingerprint it does not share.
import assert from 'node:assert/strict';
import { updateNarrative, readNarrativeReport } from './narrative-runtime.js';
import { classifyAetheriaCollection, normalizeEmbeddingProfile, resolveCalibratedThreshold } from './embedding-profile.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const SUMMARY_BODY = '局面稳定。\n【锚点】\n- 无\n【已解决】\n- 无\n【知情边界】\n- 无';
const pair = n => [{ is_user: true, mes: '第' + n + '轮：主角走进大厅。' },
    { is_user: false, mes: '第' + n + '轮：管家回应，钥匙仍在。' }];
function host(saveMetadata) {
    const ctx = { extensionSettings: { [KEY]: { enabled: true, narrative_every: 10, narrative_summary_tokens: 400,
            narrative_setting_tokens: 0, narrative_input_chars: 40000 } },
        chatMetadata: { [KEY]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced: saveMetadata, saveSettingsDebounced() {}, setExtensionPrompt() {},
        eventTypes: {}, eventSource: { on() {} } };
    const services = { vector: () => ({ supported: false, reason: 'disabled in this test' }),
        isCurrent: () => true, summarize: async () => SUMMARY_BODY };
    return { ctx, services, store: () => ctx.chatMetadata[KEY] };
}
const fill = (h, n) => { for (let i = 1; i <= n; i += 1) h.ctx.chat.push(...pair(i)); };

// --- F-1(a): the write fails before anything commits -> reject, nothing committed, nothing hidden ---
{
    const h = host(() => { throw new Error('disk full: metadata write failed'); });
    fill(h, 10);
    let rejected = null;
    try { await updateNarrative(h.ctx, h.services); } catch (error) { rejected = String(error?.message || error); }
    assert.match(String(rejected), /disk full/, 'a write that fails before the commit rejects the pass');
    assert.equal(h.store().narrative_summary, undefined, 'nothing commits when the first persist fails');
    assert.equal(h.ctx.chat.filter(r => r.is_system === true).length, 0, 'and no floor is hidden');
}

// --- F-1(b): the write fails once, after the state is on the store -> committed, not a model failure -
{
    let threw = false;
    const h = host(() => {
        if (!threw && h.store().narrative_summary) { threw = true; throw new Error('disk full: metadata write failed'); }
    });
    fill(h, 10);
    await updateNarrative(h.ctx, h.services);
    const report = readNarrativeReport(h.ctx);
    assert.ok(h.store().narrative_summary, 'the summary is on the store');
    assert.equal(report.summary_covered_floors, 10);
    assert.equal(report.summary_failures, 0, 'a committed summary is not also a failed model call');
    assert.notEqual(report.summary_last_error?.stage, 'transport', 'a local write error is not a transport error');
    assert.ok(report.persist_error, 'the write failure is recorded as a persistence problem');
    assert.equal(report.persist_error.stage, 'metadata_write');
    assert.match(report.persist_error.reason, /disk full/);
    assert.equal(h.ctx.chat.filter(r => r.is_system === true).length, 20, 'the commit and its fold stand');
}

// --- F-8: the raw original index is its own kind, not the memory index ------------------------------
{
    assert.equal(classifyAetheriaCollection('aetheria_v54_raw_deadbeef'), 'raw');
    assert.equal(classifyAetheriaCollection('aetheria_v54_baseline_x'), 'baseline');
    assert.equal(classifyAetheriaCollection('aetheria_v55_setting_x'), 'setting');
    const profile = normalizeEmbeddingProfile({ model: 'm', score_policy: { memory: 0.31 } });
    assert.equal(resolveCalibratedThreshold(profile, 'memory', 0.22), 0.31,
        'the memory policy still calibrates memory');
    assert.equal(resolveCalibratedThreshold(profile, classifyAetheriaCollection('aetheria_v54_raw_deadbeef'), 0.7), 0.7,
        'a raw query keeps its requested threshold instead of the memory policy');
}
console.log('recovery-isolation: ok');
