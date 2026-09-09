import assert from 'node:assert/strict';
import { collectCompletedDialogueTurns } from './v55-summary-runtime.js';

const turns = collectCompletedDialogueTurns([
    { is_user: true, mes: '你好' },
    { is_user: false, mes: '你好，有什么事？' },
    { is_user: true, mes: '去图书馆。' },
    { is_user: false, mes: '好，我们出发。' },
]);

assert.equal(turns.length, 2, 'each completed assistant reply should close one dialogue turn');
assert.match(turns[0].text, /用户：你好/);
assert.match(turns[0].text, /助手：你好，有什么事？/);
assert.notEqual(turns[0].id, turns[1].id, 'dialogue turn ids should be stable but distinct');

const systemRows = collectCompletedDialogueTurns([
    { is_system: true, mes: 'system' },
    { is_user: true, mes: 'A' },
    { is_user: false, mes: 'B' },
]);
assert.equal(systemRows.length, 1, 'system rows must not become dialogue turns');

console.log('v5.5 hierarchical summary tests passed');
