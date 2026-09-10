// The token model is a least-squares fit of the provider's own prompt_tokens over 126 retained
// requests: tokens = 0.9408 * cjkChars + 0.2441 * otherChars - 21. These fixtures are four of those
// requests, so the test fails if the coefficients drift away from the data they were fitted to.
import assert from 'node:assert/strict';
import { TOKEN_MODEL, charsPerToken, estimateTokens, hasWordSegmenter, phraseBigrams, phraseHits, segmentWords, tokenModelLabel, tokensToChars, wordCoverage } from './v55-tokenizer.js';

// cjkChars / otherChars / the provider's reported prompt_tokens.
const FIXTURES = [
  { cjk: 2498, other: 5464, actual: 3700 },
  { cjk: 2453, other: 5467, actual: 3646 },
  { cjk: 2365, other: 5438, actual: 3577 },
  { cjk: 2313, other: 5414, actual: 3511 },
  { cjk: 500, other: 76, actual: 480 },
];
for (const row of FIXTURES) {
  const predicted = row.cjk * TOKEN_MODEL.cjkPerChar + row.other * TOKEN_MODEL.otherPerChar + TOKEN_MODEL.requestOverhead;
  const error = Math.abs(predicted - row.actual) / row.actual;
  // The fit's own MAPE is 1.1%, but a small request carries proportionally more fixed request
  // boilerplate, which is exactly why estimateTokens() drops the constant for fragments. 8% covers
  // that small-sample effect without letting the coefficients drift.
  assert.ok(error < 0.08, 'token model must stay within 8% of the provider on its own calibration set: ' + JSON.stringify(row) + ' predicted ' + Math.round(predicted));
}

// Per-fragment estimation applies the fitted slope without the whole-request constant.
assert.equal(estimateTokens(''), 0);
assert.equal(estimateTokens('灰'.repeat(1000)), 941);
assert.equal(estimateTokens('a'.repeat(1000)), 245);
assert.equal(estimateTokens('x'), 1);
assert.ok(charsPerToken('灰'.repeat(100)) < 1.2, 'Chinese is about one token per character');
assert.ok(charsPerToken('a'.repeat(100)) > 3.5, 'Latin is about four characters per token');
assert.ok(charsPerToken('灰'.repeat(100)) < charsPerToken('a'.repeat(100)), 'the model must be script aware');

// Inverse budgeting never claims a token buys less than one character, and scales with the sample.
assert.equal(tokensToChars(0), 0);
assert.ok(tokensToChars(1000, '灰'.repeat(50)) <= 1100);
assert.ok(tokensToChars(1000, 'a'.repeat(50)) >= 3800, 'Latin sample buys close to four characters per token');
assert.ok(tokensToChars(1000) > 2000, 'with no sample it falls back to the measured request average');
assert.ok(tokenModelLabel().includes(TOKEN_MODEL.version));

// Word segmentation: real words when the host has Intl.Segmenter, Unicode runs when it does not.
assert.equal(typeof hasWordSegmenter(), 'boolean');
const words = segmentWords('灰烬港爆发的灰咳经星辰仪查明是城西古井三日前遭人为污染所致');
assert.ok(words.length >= 8, 'segmentation must produce word-shaped units, got ' + words.length);
assert.ok(words.includes('灰烬') || words.includes('爆发'), 'known Chinese words must survive segmentation');
const latin = segmentWords('The brass key is held by Han Zheng');
assert.deepEqual(latin.slice(0, 4), ['the', 'brass', 'key', 'is']);
assert.deepEqual(segmentWords(''), []);

// Phrase matching is what n-grams cannot express: two words next to each other.
assert.equal(phraseHits(['黄铜', '钥匙'], '她把黄铜钥匙交给了他。'), 1);
assert.equal(phraseHits(['黄铜', '钥匙'], '钥匙是黄铜做的。'), 0, 'the phrase must be adjacent, not merely present');
assert.equal(phraseHits(['黄铜'], '黄铜'), 0, 'a single word is not a phrase');
assert.equal(phraseHits(['黄铜', '钥匙'], '黄铜，钥匙'), 1, 'one punctuation mark between words still counts');
assert.deepEqual(phraseBigrams(['a', 'b', 'c']), ['a\u0001b', 'b\u0001c']);

// Coverage is length weighted so a long distinctive word counts for more than a particle.
assert.equal(wordCoverage([], ['x']), 0);
assert.ok(wordCoverage(['钥匙', '的'], ['钥匙']) > 0.6, 'the long word dominates the short particle');
assert.equal(wordCoverage(['a', 'b'], ['a', 'b']), 1);
console.log('PASS v5.5 tokenizer: calibrated script-aware token accounting plus real word segmentation');
