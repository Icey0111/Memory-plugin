import assert from 'node:assert/strict';

globalThis.SillyTavern = { getContext: () => null };
const mod = await import('./index.js?depth-normalization');

const cases = [
  [0, 0],
  [1, 1],
  [4, 4],
  ['0', 0],
  [3.9, 3],
  [-1, 4],
  [Number.NaN, 4],
  [undefined, 4],
  ['nope', 4],
  [null, 4],
  ['', 4],
  ['   ', 4],
];

for (const [input, expected] of cases) {
  assert.equal(mod.__testNormalizeDepth(input), expected, `normalizeDepth(${String(input)})`);
}

assert.equal(mod.__testNormalizeDepth(-1, 0), 0, 'fallback depth 0 must also be preserved');

console.log('PASS injection depth normalization preserves legal depth=0, falls back for null/blank/garbage');
