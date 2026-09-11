// The extraction prompt is the only lever that bounds how fast the state pool grows, and the 100-floor
// measurement (dev_docs/16) showed what happens without it: 223 adds, 200 of them creating a brand-new
// slot, a 190-entry state pool, and an injected budget that covered 18% of it. These assertions exist so
// that discipline cannot be quietly dropped from the prompt again.
import assert from 'node:assert/strict';
import { buildAutonomousExtractionPrompt } from './memory-extractor.js';

const prompt = buildAutonomousExtractionPrompt({
    userText: '我们在井边站了一会儿。',
    assistantText: '我没有说话。',
    canonicalState: '- [belief slot=Seraphina.belief.fear_line] 她认为那句话指向她。',
});

assert.match(prompt, /slot 复用/, 'the prompt must ask for slot reuse');
assert.match(prompt, /不得新建 slot/, 'creating a parallel slot must be forbidden');
assert.match(prompt, /update \/ supersede \/ close/, 'the reuse must name the operations that reuse it');
assert.match(prompt, /写入门槛/, 'the prompt must carry an admission test');
assert.match(prompt, /三天后/, 'durability must be part of the test');
assert.match(prompt, /会影响角色之后的行动/, 'consequence must be part of the test');
assert.match(prompt, /绝对不要写/, 'the ban on commentary must be explicit');
assert.match(prompt, /第 21 句|句子编号/, 'sentence-count commentaries must be named as forbidden');
assert.match(prompt, /不超过 6 条/, 'the per-turn operation count must be bounded');
assert.match(prompt, /Seraphina\.belief\.fear_line/, 'the existing slots must be shown to the extractor');

console.log('PASS v5.5 extraction discipline: slot reuse, admission test, commentary ban, bounded operations');
