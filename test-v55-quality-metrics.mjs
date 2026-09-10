// A8: the quality side of measurement. v55-metrics.js meters cost; this meters whether memory
// stayed good — and, crucially, whether what memory owns actually reached the prompt.
import assert from 'node:assert/strict';
import { createEmptyStore, applyMemoryOps, getMandatoryMemories } from './memory-core.js';
import {
  buildCausalProbes,
  scoreCausalProbes,
  mandatoryRetention,
  injectionBreakdown,
  compressionPoint,
  compressionSeries,
  qualityReport,
} from './v55-quality-metrics.js';

// A store with a real supersede chain: an ownership transfer plus one plain state.
let store = applyMemoryOps(createEmptyStore(), [
  { op: 'add', kind: 'ownership', slot: 'k.ownership.holder', text: '塞拉菲娜持有黄铜钥匙，钥匙侧面刻着第三纪的铭文。', entities: ['黄铜钥匙'] },
  { op: 'add', kind: 'state', slot: 'z.location.current', text: '林昭位于钟楼旅店二层的长廊尽头。', entities: ['林昭'] },
], { sourceMessageIndex: 2, sourceMessageText: '塞拉菲娜把钥匙收进怀里。' }).store;
store = applyMemoryOps(store, [
  { op: 'supersede', target_slot: 'k.ownership.holder', kind: 'ownership', slot: 'k.ownership.holder', text: '黄铜钥匙已由韩铮收进舵轮暗格保管。', entities: ['黄铜钥匙', '韩铮'] },
], { sourceMessageIndex: 10, sourceMessageText: '韩铮把钥匙放进舵轮暗格。' }).store;

// Probes are generated from the spine, never hand-written.
const probes = buildCausalProbes(store, { limit: 20 });
assert.ok(probes.some(probe => probe.kind === 'current' && probe.slot === 'k.ownership.holder'), 'the current value of a changed slot is a probe');
assert.ok(probes.some(probe => probe.kind === 'superseded' && probe.slot === 'k.ownership.holder'), 'the replaced value is a probe');
assert.ok(probes.every(probe => probe.expected && probe.question), 'every probe carries a question and an expected answer');

// Canonical memory owns the whole chain, so nothing is lost there.
const canonical = scoreCausalProbes(store, probes, { scope: 'canonical' });
assert.equal(canonical.rate, 1, 'memory itself still holds every answer');
assert.equal(canonical.misses.length, 0);

// A view that carries only the CURRENT value cannot answer "what did it replace".
const currentOnlyText = Object.values(store.memories)
  .filter(memory => memory.status === 'active')
  .map(memory => memory.text)
  .join('\n');
const injected = scoreCausalProbes(store, probes, { scope: 'injected', injectedText: currentOnlyText });
assert.ok(injected.rate < 1, 'a current-value-only view must lose the change chain');
assert.ok(injected.misses.some(miss => miss.kind === 'superseded'), 'the lost probe is exactly the superseded one');
assert.ok(injected.hit < canonical.hit, 'the gap between the two scores is the injection loss');

// Key retention: the same test the live run uses to prove the never-drop set survived the trim.
const mandatory = getMandatoryMemories(store, 24);
assert.ok(mandatory.length >= 1, 'the ownership transfer is mandatory');
const rendered = mandatory.map(memory => '- ' + memory.text).join('\n');
assert.equal(mandatoryRetention(rendered, mandatory).rate, 1, 'a block carrying every row keeps all of them');
const dropped = mandatoryRetention('状态摘要，但没有那几条不可逆记录。', mandatory);
assert.ok(dropped.rate < 1, 'a block that lost them reports the loss');
assert.equal(dropped.missing.length, mandatory.length);

// Injection accounting: the spine rides on top of the other two blocks.
const breakdown = injectionBreakdown({ referenceBlock: 'a'.repeat(400), currentStateBlock: 'b'.repeat(200), spineBlock: 'c'.repeat(100) });
assert.equal(breakdown.combined_tokens, breakdown.reference_tokens + breakdown.current_state_tokens + breakdown.spine_tokens);
assert.ok(breakdown.injected_tokens < breakdown.combined_tokens, 'the spine is counted separately from what recall injected');
assert.ok(breakdown.reference_tokens > breakdown.spine_tokens, 'the reference block dominates the cost');

// Compression: the ratio must fall as more raw dialogue folds into the same resident memory.
const floors = Array.from({ length: 40 }, (_, i) => '第' + (i + 1) + '层：' + '很长的对话内容。'.repeat(8));
const series = compressionSeries({ memories: Object.values(store.memories), dialogueTextsPerFloor: floors, everyFloors: 10 });
assert.equal(series.length, 4, 'one point per ten floors');
assert.ok(series[3].raw_tokens > series[0].raw_tokens, 'the denominator grows');
assert.equal(series[3].memory_tokens, series[0].memory_tokens, 'the numerator is the resident memory, which did not grow');
assert.ok(series[3].ratio < series[0].ratio, 'so the compression ratio improves with length');
assert.equal(compressionPoint({ memories: [], dialogueTexts: [], floors: 0 }).ratio, 0, 'an empty denominator is not a division by zero');

// One call answers all four A8 numbers for a turn.
const report = qualityReport({
  store, rendered, injectedText: currentOnlyText, mandatory,
  dialogueTextsPerFloor: floors, everyFloors: 10, probeLimit: 20,
});
assert.equal(report.version, 1);
assert.equal(report.key_retention.rate, 1);
assert.ok(report.causal_recall.rate > report.causal_injected.rate, 'the report separates "owned" from "reached the model"');
assert.equal(report.causal_gap, report.causal_recall.hit - report.causal_injected.hit);
assert.ok(report.compression_latest.ratio < report.compression[0].ratio);

console.log('PASS v5.5 quality metrics (A8): key retention, causal recall vs injected, compression curve');
