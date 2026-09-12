// The extraction model fills the fields the prompt asks for in prose, and only those.
//
// This was learned once already and applied to one field. memory-core.js records it for epistemic:
//   'Measured over 844 real operations, the model wrote channel ... every time and epistemic never.'
// The fix then was to make the prompt require epistemic, and it worked - on the live 51-floor chat
// 245 of 246 stored operations now carry an epistemic value spread across seven distinct words.
//
// importance and known_by were left in the JSON schema with no prose instruction, and the same
// measurement on the same chat:
//   importance  - 246 of 246 operations UNSET. memory-core's 'op.importance || medium' default is what
//                 fills the field, so no memory in a 224-record store has ever been anything but
//                 'medium'. Twelve call sites across seven files special-case 'high' or 'critical' and
//                 can never fire.
//   known_by    - 0 of 246 operations, 0 of 224 memories. The certificate's epistemic dimension
//                 therefore examines nothing, and T-Causal's who_unknown question kind generates no
//                 cases at all. Both used to report success anyway.
//
// So the invariant is not 'the schema declares the field'. It is that a field the memory system ranks,
// gates or certifies on must be asked for in prose, because the schema alone is not an instruction.
import assert from 'node:assert/strict';
import { buildAutonomousExtractionPrompt, EXTRACTION_JSON_SCHEMA, normalizeExtractionOperation } from './memory-extractor.js';

const prompt = buildAutonomousExtractionPrompt({
    userText: '甲把钥匙交给了乙。',
    assistantText: '甲把黄铜钥匙放在乙手心里，说等封城结束再取。',
});

// 1. Every field a downstream system ranks, gates or certifies on is named in the prose.
const PROSE_REQUIRED = ['epistemic', 'channel', 'importance', 'known_by'];
for (const field of PROSE_REQUIRED) {
    assert.ok(prompt.includes('op.' + field), 'the prompt must ask for op.' + field + ' in prose, not only in the schema');
}

// 2. The prompt states the consequence of getting known_by wrong, because a bare field name is what
//    produced an empty field for the whole life of the store this was measured on.
assert.ok(/known_by[^\n]*认知边界/.test(prompt), 'known_by is explained as a cognitive boundary');
assert.ok(/importance[^\n]*medium/.test(prompt), 'importance explains what medium means and when not to use it');

// 3. Both fields are still declared by the schema, and still survive normalisation - asking for a field
//    the pipeline then drops would be worse than not asking.
const props = EXTRACTION_JSON_SCHEMA.value.properties.operations.items.properties;
for (const field of PROSE_REQUIRED) assert.ok(field in props, 'the schema still declares ' + field);
const kept = normalizeExtractionOperation({ op: 'add', kind: 'knowledge', text: '甲知道钥匙在乙手里。', importance: 'high', known_by: ['甲'] });
assert.equal(kept.importance, 'high', 'a stated importance survives normalisation');
assert.deepEqual(kept.known_by, ['甲'], 'a stated holder set survives normalisation');

// 4. An operation that omits them still defaults safely, so the instruction is an improvement and not a
//    new requirement that can fail an extraction.
const bare = normalizeExtractionOperation({ op: 'add', kind: 'state', text: '甲在钟楼。' });
assert.equal(bare.importance, undefined, 'omitting importance is accepted here');
assert.equal(bare.known_by, undefined, 'omitting known_by is accepted here');

console.log('PASS v5.5 extractor fields: every field the memory system ranks on is asked for in prose');
