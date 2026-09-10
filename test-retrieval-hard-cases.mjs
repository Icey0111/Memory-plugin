// Iteration 13: the six hard retrieval cases run against the real fusion path.
import assert from 'node:assert/strict';
import { buildSelfCheckStore, formatSelfCheck, runRetrievalSelfCheck } from './v55-selfcheck.js';

const report = runRetrievalSelfCheck();
console.log(formatSelfCheck(report));
assert.equal(report.total, 6);
assert.equal(report.ok, true, '数字/否定/条件/承诺/偏好变化/跨轮 must all be retrievable');
assert.equal(report.metrics.hit_rate, 1, 'every hard case must be found within top-k');
// Regression floor for the dense-free fusion path (production adds a dense channel on top).
assert.ok(report.metrics.mrr >= 0.7, 'mean reciprocal rank must not regress below the recorded floor');

const store = buildSelfCheckStore();
const rows = Object.values(store.memories);
assert.ok(rows.filter(memory => memory.status === 'active').length >= 6);
const superseded = rows.find(memory => /以前喜欢简短回答/.test(memory.text));
assert.equal(superseded.status, 'superseded', 'a preference change must retire the old preference');
assert.ok(rows.some(memory => /没有在平成身上/.test(memory.text)), 'negation fixtures are stored verbatim');
console.log('PASS retrieval self-check: six hard cases through the production fusion path');