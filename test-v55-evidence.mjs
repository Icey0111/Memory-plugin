// Iteration 13: cold原文 snapshot, on-demand backlink, lookup text protocol, and metering.
import assert from 'node:assert/strict';
import { computeDialoguePairFingerprint, normalizeStore } from './memory-core.js';
import {
    coldTurnsOf, expandMemoryEvidence, formatEvidenceBlock, getColdTurn,
    parseMemoryLookupRequests, pruneColdTurns, recordColdTurn, resolveMemoryLookupRequests,
} from './v55-evidence.js';
import { formatMetrics, getMetrics, recordEmbeddingCall, recordModelCall, resetMetrics } from './v55-metrics.js';

const chat = [
    { is_user: true, mes: '钥匙交给谁了？' },
    { is_user: false, mes: '地下室钥匙交给苏晚保管了。' },
];
const pair = computeDialoguePairFingerprint(chat, 1);
assert.ok(pair && pair.key, 'dialogue pair fingerprint is required');
const store = normalizeStore({});
store.memories.m1 = { id: 'm1', kind: 'event', status: 'active', text: '地下室钥匙交给苏晚保管', entities: ['苏晚', '地下室钥匙'], indexable: true, source_message: 1, source_hash: pair.hash, source_key: pair.key };

const recorded = recordColdTurn(store, {
    source_key: pair.key, fingerprint: pair.hash, assistantIndex: 1, userIndex: 0,
    userText: chat[0].mes, assistantText: chat[1].mes,
}, { maxChars: 100000 });
assert.equal(recorded.recorded, true);
assert.ok(store.cold_turns && Object.keys(store.cold_turns.turns).length === 1, 'snapshot must land on the caller store');
assert.match(getColdTurn(store, pair.key).assistant_text, /苏晚/);

const live = expandMemoryEvidence(store, chat, { memoryId: 'm1' });
assert.equal(live.source, 'live');
assert.equal(live.turns.length, 2);
assert.equal(live.stale, false);

const edited = [{ is_user: true, mes: '钥匙交给谁了？' }, { is_user: false, mes: '（这一楼被编辑过）' }];
const cold = expandMemoryEvidence(store, edited, { memoryId: 'm1' });
assert.equal(cold.source, 'cold', 'an edited turn must fall back to the cold snapshot');
assert.equal(cold.stale, true);
assert.match(cold.turns[1].text, /苏晚/);

assert.equal(expandMemoryEvidence(normalizeStore({}), chat, { memoryId: 'nope', sourceKey: 'x' }).ok, false);

const big = normalizeStore({});
for (let i = 0; i < 5; i++) {
    recordColdTurn(big, { source_key: 'k' + i, assistantIndex: i, userIndex: i - 1, userText: 'u'.repeat(500), assistantText: 'a'.repeat(500) }, { maxChars: 1500 });
}
const bounded = coldTurnsOf(big);
assert.ok(bounded.chars <= 1500, 'cold snapshot respects its character cap');
assert.equal(bounded.order.length, 1, 'oldest snapshots are pruned first');
assert.deepEqual(pruneColdTurns(big, 1500).removed, 0);

const requests = parseMemoryLookupRequests('前文……\n【查阅记忆】\n对象：苏晚\n事项：钥匙\n\n后文……');
assert.equal(requests.length, 1);
assert.equal(requests[0].object, '苏晚');
assert.equal(requests[0].item, '钥匙');
assert.equal(parseMemoryLookupRequests('没有协议的普通回复').length, 0);

const resolved = resolveMemoryLookupRequests(store, chat, '【查阅记忆】\n对象：钥匙\n事项：交给谁');
assert.equal(resolved.requests.length, 1);
assert.ok(resolved.entries.length >= 1, 'a lookup request must resolve to original text');
const block = formatEvidenceBlock(resolved.entries, { maxChars: 2000 });
assert.match(block, /MEMORY EVIDENCE/);
assert.match(block, /苏晚/);
assert.equal(formatEvidenceBlock([], {}), '');

const ctx = { extensionSettings: { aetheriaUnifiedMemoryV54: {} }, saveSettingsDebounced() {} };
recordModelCall(ctx, { kind: 'extraction', promptChars: 400, completionChars: 100 });
recordModelCall(ctx, { kind: 'summary', promptChars: 200, completionChars: 50 });
recordEmbeddingCall(ctx, { count: 3, chars: 300 });
const metrics = getMetrics(ctx);
assert.equal(metrics.model_calls.extraction, 1);
assert.equal(metrics.model_calls.summary, 1);
assert.equal(metrics.model_calls_total, 2);
assert.equal(metrics.embed_calls, 1);
assert.equal(metrics.embed_items, 3);
// promptChars 400 + 200 with no text: the fallback is the measured whole-request average of
// ~2.2 characters per token, so ceil(600 / 2.2) = 273. The old chars / 4 said 150 and under-reported
// a Chinese prompt by roughly half.
assert.equal(metrics.est_prompt_tokens, 273);
assert.match(formatMetrics(ctx), /抽取 1/);
resetMetrics(ctx);
assert.equal(getMetrics(ctx).model_calls_total, 0);
console.log('PASS cold snapshot + on-demand backlink + lookup protocol + cost metering');