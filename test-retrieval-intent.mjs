import assert from 'node:assert/strict';
import { parseAnchors, normalizeKnowledgeEntries, mergeKnowledge, profileRecall, askedThingRecall, captureHistory, chunkHistory, rankRawChunks } from './raw-history.js';
import { planRetrievalQuery } from './retrieval-query.js';
import { buildNarrativeContext } from './narrative-runtime.js';

const a = parseAnchors('局面\n【知情边界】\n- 塞拉菲娜/知道：钥匙在甲手中；不知道乙去了哪里。');
const b = parseAnchors('局面\n【知情边界】\n- [塞拉菲娜/知道] 钥匙在甲手中；不知道乙去了哪里。');
const c = parseAnchors('局面\n【知情边界】\n- 塞拉菲娜 | 知道 | 钥匙在甲手中；不知道乙去了哪里。');
assert.deepEqual(a.knowledge, b.knowledge); assert.deepEqual(b.knowledge, c.knowledge);
const nested = parseAnchors('局面\n【知情边界】\n- [老周/知道] 潮位上涨 | 不知道：渡口何时开放');
assert.equal(nested.knowledge[0].kind, '老周/知道');
assert.match(nested.knowledge[0].text, /潮位上涨.*不知道/);
const repaired = normalizeKnowledgeEntries([
    { kind: '其他', text: '老周/知道：钥匙在甲手中', last_confirmed: 1 },
    { kind: '老周/知道', text: '钥匙已交给乙', last_confirmed: 2 },
]);
assert.equal(repaired.length, 1); assert.equal(repaired[0].text, '钥匙已交给乙');
const conflict = mergeKnowledge(null, { knowledge: [{ kind: '老周/知道', text: '密码' },
    { kind: '老周/不知道', text: '密码' }], resolved: [], sections: 'ok' });
assert.equal(conflict.entries.length, 2, 'different same-pass assertions are not guessed away');
assert.notEqual(conflict.entries[0].id, conflict.entries[1].id, 'knowledge identity includes polarity');
assert.deepEqual(normalizeKnowledgeEntries(repaired), repaired, 'migration is idempotent');

const chat = [{ is_user: true, name: '用户', mes: '桥上有人吗？' },
    { is_user: false, name: '沈宁', mes: '无关前文。'.repeat(150) + '沈宁披着红色斗篷，袖口绣着白鹭，携带青铜钥匙。' },
    { is_user: true, mes: '继续' }];
const store = {}; const { history } = captureHistory(store, chat); const chunks = chunkHistory(history);
const directive = chunks.find(row => row.source === history.active[2]);
assert.ok(!rankRawChunks(chunks, '继续', [{ hash: directive.hash, score: 1 }]).some(row => row.chunk.id === directive.id),
    'continuation commands cannot consume evidence even when the dense provider ranks one first');
assert.equal(history.records[directive.source].text, '继续', 'the original command remains archived');
assert.equal(planRetrievalQuery({ ...history, active: history.active.slice(0, 2) }).mode, 'continuation',
    'an assistant continuation must not recycle an already answered user request');
const partial = [{ source: history.active[1], start: 0, end: 30 }];
const prof = profileRecall(chunks, history, { names: ['沈宁'], packed: partial });
assert.equal(prof[0].quoted, false); assert.equal(prof[0].detailed, false);
const asked = askedThingRecall(chunks, history, { asked: '青铜钥匙', packed: partial });
assert.ok(asked.length); assert.ok(asked.every(row => !row.recalled));
const plan = planRetrievalQuery(history, { strategy: 'adaptive', summary: '沈宁在桥头等候。', names: ['沈宁'] });
assert.equal(plan.mode, 'continuation'); assert.equal(plan.metricsApplicable, false);
assert.doesNotMatch(plan.query, /无关前文/);
assert.equal(planRetrievalQuery(history).query, planRetrievalQuery(history, { strategy: 'legacy' }).query,
    'default continuation keeps the existing query; adaptive summary expansion remains experimental');
chat.at(-1).mes = '青铜钥匙是谁的？'; captureHistory(store, chat);
const focused = planRetrievalQuery(history, { strategy: 'adaptive', names: ['沈宁'] });
assert.equal(focused.query, chat.at(-1).mes); assert.deepEqual(focused.profileNames, ['沈宁']);
assert.equal(planRetrievalQuery(history).query, focused.query, 'default request focuses on the user');

const K = 'aetheriaUnifiedMemoryV54';
const ctx = { extensionSettings: { [K]: { enabled: true, narrative_setting_tokens: 0, narrative_query_strategy: 'adaptive' } },
    chatMetadata: { [K]: store }, chat, saveMetadataDebounced() {} };
const services = { vector: () => ({ supported: false }), isCurrent: () => true };
const result = await buildNarrativeContext(ctx, services);
assert.equal(result.diagnostics.retrieval_mode, 'request');
assert.equal(result.diagnostics.answer_coverage, 'unmeasured_without_labelled_answers');
chat.at(-1).mes = '继续';
const continuation = await buildNarrativeContext(ctx, services);
assert.equal(continuation.diagnostics.asked_status, 'not_applicable');
assert.equal(continuation.diagnostics.asked_targets, 0);
console.log('PASS retrieval intent: knowledge syntax, conflict preservation, exact-span metrics and independent user targets');
