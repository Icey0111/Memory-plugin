// Iteration 08: rule exceptions/conditions must not be split away from their rule (proposal P1).
import assert from 'node:assert/strict';
import { splitSettingText } from './setting-index.js';

const rule = '进入档案馆必须持有王室签发的正式许可，并在守卫处登记姓名与来意，否则守卫有权当场扣留来人并上报。';
const exception = '除非持有临时通行证，临时通行证由守备队长签发，有效期只有一天。';
const text = rule + exception;

const glued = splitSettingText(text, { maxChars: 120, minChars: 1 });
assert.ok(glued.length >= 1);
assert.ok(!glued.slice(1).some(piece => piece.startsWith('除非')), 'exception must not start its own chunk when it can stay with the rule');
assert.ok(glued.some(piece => piece.includes('除非')), 'exception text is still present');

// Two unrelated long sentences must still split.
const a = '甲'.repeat(100);
const b = '乙'.repeat(100);
const split = splitSettingText(a + '。' + b + '。', { maxChars: 120, minChars: 1 });
assert.equal(split.length, 2, 'unrelated long sentences still split');

console.log('PASS setting chunking keeps conditional/exception clauses with their rule');
