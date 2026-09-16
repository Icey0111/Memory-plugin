// A parked active anchor has to keep a route back to the original text it paraphrases.
//
// The anchor block has a budget and the ledger does not, so a live constraint can be parked (not injected).
// Its derived wording may not appear in any original row, so the anchor's words alone are not enough - but
// the original is still reachable through the existing lexical and entity channels. The query therefore
// carries the parked statements, bounded by the query's own 5000-character cap. Measured on the d7eed81
// audit: the base continuation query packed the east-room source row without the span carrying the lock
// constraint, and adding the parked statements recovered the original row (raw_18).
import assert from 'node:assert/strict';
import { parkedAnchorQuery, updateNarrative, buildNarrativeContext } from './narrative-runtime.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const pair = n => [{ is_user: true, mes: '第' + n + '轮：主角走进大厅，管家提到钥匙。' },
    { is_user: false, mes: '第' + n + '轮：管家回应，钥匙仍在甲手里。' }];
const EAST_ROOM = '东端朝东房间为伊尔瓦遗物间，仍锁、积灰，要求旅人不得碰锁。';

// --- 1. the query builder is bounded and only changes when something was parked --------------------
{
    assert.equal(parkedAnchorQuery('base', ''), 'base', 'nothing parked leaves the query untouched');
    assert.equal(parkedAnchorQuery('base', 'A\nB'), 'base\nA\nB');
    assert.ok(parkedAnchorQuery('base', '遗物间').includes('遗物间'));
    assert.equal(parkedAnchorQuery('x'.repeat(6000), 'tail').length, 5000, 'the existing query cap holds');
    assert.ok(parkedAnchorQuery('x'.repeat(6000), 'tail').endsWith('tail'), 'and the parked text survives the cap');
}

// --- 2. a parked ledger records the handoff; a ledger that fits its budget does not ----------------
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
const anchorSummary = async (_ctx, prompt) => {
    const src = (String(prompt).match(/\[(raw_\d+)\]/) || [])[1] || 'raw_1';
    return '局面稳定。\n【锚点变更】\n- 新增 | 条件 | 东房 | 来源 ' + src + ' | ' + EAST_ROOM
        + '\n【知情边界】\n- 无';
};
const fill = (h, n) => { for (let i = 1; i <= n; i += 1) h.ctx.chat.push(...pair(i)); };
{
    const small = host({ settings: { narrative_anchor_tokens: 20 }, summarize: anchorSummary });
    fill(small, 10);
    await updateNarrative(small.ctx, small.services);
    assert.ok(small.store().narrative_summary, 'the summary committed');
    assert.ok((small.store().narrative_anchors?.active || []).length >= 1, 'and the anchor is live');
    await buildNarrativeContext(small.ctx, small.services, { contextSize: 32768 });
    const record = small.store().narrative_diagnostics?.retrieval_parked_anchors;
    assert.ok(record, 'a parked anchor starts a retrieval handoff');
    assert.ok(record.anchors >= 1, 'and the record names how many were parked');
    assert.ok(record.query_chars > 0);

    const roomy = host({ settings: { narrative_anchor_tokens: 4000 }, summarize: anchorSummary });
    fill(roomy, 10);
    await updateNarrative(roomy.ctx, roomy.services);
    await buildNarrativeContext(roomy.ctx, roomy.services, { contextSize: 32768 });
    assert.equal(roomy.store().narrative_diagnostics?.retrieval_parked_anchors, undefined,
        'a ledger that fits its budget leaves the query alone');
}
console.log('anchor-handoff: ok');
