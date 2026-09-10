// The self-check floor was already saturated before the reranker existed, so it cannot show what the
// reranker buys. These cases do: fusion scores channels and can rank a channel-heavy but irrelevant
// memory above the one that actually answers the query, and the reranker has to fix that.
import assert from 'node:assert/strict';
import { DEFAULT_RERANK_WEIGHT, RERANK_VERSION, rerankCandidates } from './v55-rerank.js';

assert.ok(DEFAULT_RERANK_WEIGHT > 0.5, 'the reranker must be able to outvote the fusion prior when the query evidence is decisive');

function row(id, score, memory, extra = {}) {
  return { memory: { id, text: memory, importance: 'medium', source_message: 100, ...extra }, score, channels: ['lexical'] };
}

// Fusion ranks "channel breadth + raw score" first; only the reranker reads the query.
const fused = [
  row('noise', 0.90, '平成把地下室的灯换成了新的。', { importance: 'high' }),
  row('answer', 0.80, '苏晚保管着地下室钥匙，钥匙不在平成身上。', { entities: ['苏晚', '地下室钥匙'], slot: 'item.key.holder' }),
  row('other', 0.70, '璃月喜欢在窗边喝茶。'),
];
const query = '地下室钥匙现在在谁那里';

const ranked = rerankCandidates(fused, query, { currentMessage: 120, halfLifeTurns: 120 });
assert.equal(ranked.rows[0].memory.id, 'answer', 'the query-matching candidate must be promoted above the channel-heavy one');
assert.equal(ranked.rows[0].rerank_score >= ranked.rows[1].rerank_score, true);
assert.equal(ranked.debug.version, RERANK_VERSION);
assert.ok(ranked.debug.query_words >= 3);
assert.equal(ranked.rows[0].rerank_features.coverage, 1, 'the promoted candidate has the best query coverage in the set');
assert.equal(ranked.rows[0].rerank_features.phrase, 1, 'and the only adjacent query phrase');
// A feature with no spread across the set must contribute exactly nothing, or a constant term such as
// recency would dilute the discriminating ones.
assert.equal(ranked.rows[0].rerank_features.recency, 0.5);
assert.equal(ranked.rows[0].rerank_features.breadth, 0.5);
assert.equal(ranked.rows[0].rerank_features.entity_bypass, false, 'entity bypass was not set on this row');

// weight 0 is a pure pass-through of the fusion ordering.
const neutral = rerankCandidates(fused, query, { weight: 0, currentMessage: 120 });
assert.equal(neutral.rows[0].memory.id, 'noise', 'weight 0 must not reorder');

// An entity-protected candidate gets its bonus regardless of the blend weight.
const withEntity = rerankCandidates([
  row('plain', 0.5, '一些无关的话。'),
  { ...row('entity', 0.5, '一句无关的话。', { entities: ['张三'] }), entityBypass: true },
], '张三', { weight: 0 });
assert.equal(withEntity.rows[0].memory.id, 'entity', 'the entity bypass bonus survives weight 0');

// Phrase adjacency is a real signal: a memory containing both query words apart scores below one
// containing them as a phrase.
const phrase = rerankCandidates([
  row('apart', 0.5, '钥匙是黄铜的，放在地下室的架子上。'),
  row('phrase', 0.5, '地下室的黄铜钥匙在这里。'),
], '黄铜钥匙', { weight: 1, currentMessage: 100, halfLifeTurns: 120 });
assert.equal(phrase.rows[0].memory.id, 'phrase', 'adjacent query words must outrank the same words apart');

// Recency decays: the same content nearer the present wins when everything else is equal.
const recency = rerankCandidates([
  row('old', 0.5, '钥匙在苏晚那里。', { source_message: 1 }),
  row('new', 0.5, '钥匙在苏晚那里。', { source_message: 99 }),
], '钥匙在苏晚那里', { weight: 1, currentMessage: 100, halfLifeTurns: 20 });
assert.equal(recency.rows[0].memory.id, 'new', 'a fresher memory wins when content is identical');

// Degenerate inputs must not throw or reorder.
assert.deepEqual(rerankCandidates([], 'x').rows, []);
const single = [row('only', 0.4, '文本')];
assert.equal(rerankCandidates(single, '文本').rows.length, 1);
assert.deepEqual(rerankCandidates(fused, '').rows.map(r => r.memory.id), fused.map(r => r.memory.id), 'an empty query leaves the order alone');
assert.deepEqual(rerankCandidates(fused, '   ').rows.map(r => r.memory.id), fused.map(r => r.memory.id));

// The pool bound keeps the reranker from returning more than the caller can diversify.
const many = Array.from({ length: 80 }, (_, i) => row('m' + i, 1 - i / 100, '记忆序号 ' + i + ' 钥匙'));
assert.equal(rerankCandidates(many, '钥匙', { maxPool: 12 }).rows.length, 12);
console.log('PASS v5.5 reranker: query-aware features reorder a channel-ranked list without a model call');
