// Measured on the live gateway: attaching every optional context window to the extraction request
// produced "Got response status 502", and a refused request costs that turn its extraction entirely.
// The pair under review is mandatory; the windows are now planned to fit and shed whole.
import assert from 'node:assert/strict';
import {
  planExtractionPromptBudget,
  buildAutonomousExtractionPrompt,
  EXTRACTION_CONTEXT_LAYERS,
} from './memory-extractor.js';

assert.deepEqual(EXTRACTION_CONTEXT_LAYERS, ['canonicalState', 'recentContext', 'relevantSettingContext', 'hostBaselineContext']);

const layerChars = { canonicalState: 4000, recentContext: 3000, relevantSettingContext: 2000, hostBaselineContext: 1500 };

// Everything fits: nothing is shed and every window keeps its full size.
const roomy = planExtractionPromptBudget({ limit: 20000, pairChars: 3000, layerChars });
assert.deepEqual(roomy.dropped, []);
assert.deepEqual(roomy.ceilings, layerChars);
assert.ok(roomy.planned_chars <= roomy.limit);

// Tight: available = 9000 - 3000 pair - 1200 reserve = 4800, spent in usefulness order.
const tight = planExtractionPromptBudget({ limit: 9000, pairChars: 3000, layerChars });
assert.equal(tight.ceilings.canonicalState, 4000, 'the most useful window is kept whole');
assert.equal(tight.ceilings.recentContext, 800, 'the next one takes only what is left');
assert.equal(tight.ceilings.relevantSettingContext, 0, 'the rest are dropped, not sliced');
assert.equal(tight.ceilings.hostBaselineContext, 0);
assert.deepEqual(tight.dropped, ['relevantSettingContext', 'hostBaselineContext']);
assert.ok(tight.planned_chars <= tight.limit, 'the plan never exceeds the budget');

// A pair larger than the whole budget still keeps the pair and sheds every window.
const starved = planExtractionPromptBudget({ limit: 2000, pairChars: 5000, layerChars });
assert.deepEqual(starved.dropped, EXTRACTION_CONTEXT_LAYERS);
assert.equal(starved.planned_chars, 5000 + 1200, 'only the mandatory pair and the reserve remain');

// The builder has to honour the plan instead of its own historical caps.
const prompt = buildAutonomousExtractionPrompt({
  userText: '唯一用户句',
  assistantText: '唯一助手句',
  canonicalState: '甲'.repeat(5000),
  recentContext: '乙'.repeat(5000),
  relevantSettingContext: '丙'.repeat(5000),
  hostBaselineContext: '丁'.repeat(5000),
  optionalCeilings: { canonicalState: 10, recentContext: 0, relevantSettingContext: 0, hostBaselineContext: 0 },
});
assert.ok(prompt.includes('甲'.repeat(10)), 'a kept window appears at its planned size');
assert.equal(prompt.includes('甲'.repeat(11)), false, 'and not one character more');
assert.equal(prompt.includes('乙'.repeat(10)), false, 'a dropped window is absent, not truncated in');
assert.equal(prompt.includes('丙'.repeat(10)), false);
assert.equal(prompt.includes('丁'.repeat(10)), false);
assert.ok(prompt.includes('唯一用户句') && prompt.includes('唯一助手句'), 'the pair is never budgeted away');

// Without a plan the historical defaults still apply, so old callers are unaffected.
const legacy = buildAutonomousExtractionPrompt({ userText: 'u', assistantText: 'a', canonicalState: '戊'.repeat(5000) });
assert.ok(legacy.includes('戊'.repeat(12000 - 1000)) === false);
assert.ok(legacy.includes('戊'.repeat(4000)), 'the 12000 default cap is unchanged');

console.log('PASS v5.5 extraction budget: the pair is mandatory, context windows are shed whole');
