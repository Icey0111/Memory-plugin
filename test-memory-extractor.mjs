import assert from 'node:assert/strict';
import {
  EXTRACTION_JSON_SCHEMA,
  buildAutonomousExtractionPrompt,
  normalizeExtractionOperation,
  parseExtractionResult,
} from './memory-extractor.js';

assert.equal(EXTRACTION_JSON_SCHEMA.name, 'AetheriaMemoryExtractionV54');
assert.equal(EXTRACTION_JSON_SCHEMA.value.required.includes('operations'), true);

const raw = JSON.stringify({
  event_summary: '平成吃完晚饭。',
  active_state: '平成已经不再饥饿。',
  operations: [
    {op:'close', target_slot:'平成.state.hunger', reason:'已经进食'},
    {op:'add', kind:'event', text:'平成在东街吃完晚饭。', entities:['平成','东街'], topics:['晚饭'], status:'closed', importance:'low', epistemic:'fact', known_by:['平成'], indexable:false},
  ],
});
const parsed = parseExtractionResult(raw);
assert.equal(parsed.ok, true);
assert.equal(parsed.operations.length, 2);
assert.equal(parsed.operations[0].op, 'close');

const fenced = parseExtractionResult('```json\n'+raw+'\n```');
assert.equal(fenced.ok, true);
assert.equal(fenced.eventSummary, '平成吃完晚饭。');

const normalized = normalizeExtractionOperation({
  op:'add', kind:'event', text:' x ', entities:['平成','平成','璃月'], topics:['相识'], status:'closed', importance:'high', epistemic:'fact', known_by:['平成'], indexable:true, garbage:'drop'
});
assert.deepEqual(normalized.entities, ['平成','璃月']);
assert.equal('garbage' in normalized, false);

const prompt = buildAutonomousExtractionPrompt({
  userText:'我去看看骰子。', assistantText:'平成拿起上帝的骰子看了看。',
  canonicalState:'- [state slot=平成.state.hunger] 平成当前饥饿。',
  relevantSettingContext:'[PLUGIN RELEVANT SETTING]\n上帝的骰子属于既有世界设定。',
  hostBaselineContext:'[RELEVANT HOST BASELINE]\n平成喜欢植物。'
});
assert.match(prompt, /不区分短期记忆\/长期记忆/);
assert.match(prompt, /角色卡、Persona、World Info\/世界书/);
assert.match(prompt, /某角色现在知道\/确认了 X/);
assert.match(prompt, /indexable=true/);
assert.match(prompt, /不要把模型因为看到系统提示\/世界书而知道的事情/);
assert.match(prompt, /与本轮变化相关的插件世界设定/);
assert.match(prompt, /上帝的骰子属于既有世界设定/);
assert.match(prompt, /客观参考数据，不等于场景中每个角色都知道/);
console.log('PASS v5.4 autonomous extractor parser/schema/prompt');
