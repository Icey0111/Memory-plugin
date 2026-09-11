// The deterministic Level-1 digest. Folding is the only mechanism here that makes the prompt
// cheaper, and it used to be gated on a model summary that was itself gated on a ten-turn clock, so a
// ten-floor chat could never fold and seven of thirteen retained chats had zero folded floors. Level 1
// is now assembled from the extractor's own per-turn event_summary: no model call, no clock, no line
// that is a summary of a summary.
import assert from 'node:assert/strict';
import {
  digestRows, digestToLevel1, digestCoveredIndexes, digestStats, DIGEST_VERSION, DIGEST_LINE_MAX_CHARS,
} from './v55-digest.js';

const turns = [0, 1, 2, 3, 4].map(i => ({ id: 'turn_' + i + '_fp' + i, assistant_index: i }));

function storeWith(entries) {
  const extractions = {};
  for (const [index, summary] of Object.entries(entries)) {
    extractions['x_' + index] = {
      assistant_index_at_creation: Number(index),
      event_summary: summary,
      generated_at: 1000 + Number(index),
    };
  }
  return { extractions };
}

// One line per extracted turn, oldest first.
const store = storeWith({ 0: '开场：两人在旅店壁炉边。', 2: '城门外的贫民区爆发灰咳，今天倒下七人。', 4: '确认主角没有感染。' });
const rows = digestRows(store, turns, { maxRows: 50, maxChars: 5000 });
assert.equal(rows.length, 3, 'one line per extracted turn');
assert.deepEqual(rows.map(r => r.assistant_index), [0, 2, 4], 'ordered by turn');
assert.equal(rows[1].text, '城门外的贫民区爆发灰咳，今天倒下七人。');

// A turn with no extraction has no line, so it is simply not covered. Coverage gaps in extraction
// become coverage gaps in folding instead of raw text hidden with nothing standing in for it.
assert.deepEqual([...digestCoveredIndexes(digestToLevel1(rows))].sort((a, b) => a - b), [0, 2, 4]);
assert.equal(digestCoveredIndexes(digestToLevel1(rows)).has(1), false, 'an unextracted turn is not covered');

// An empty or whitespace-only event_summary is not a stand-in.
const sparse = digestRows(storeWith({ 0: '   ', 1: '有内容。' }), turns, {});
assert.deepEqual(sparse.map(r => r.assistant_index), [1]);

// The row cap keeps the NEWEST lines: an old line is worthless for the floors still in play.
const many = storeWith({ 0: '第0层的事件摘要。', 1: '第1层的事件摘要。', 2: '第2层的事件摘要。', 3: '第3层的事件摘要。', 4: '第4层的事件摘要。' });
const cappedRows = digestRows(many, turns, { maxRows: 3, maxChars: 5000 });
assert.deepEqual(cappedRows.map(r => r.assistant_index), [2, 3, 4], 'the newest window survives');

// The char cap also keeps the newest, and never returns nothing.
const longStore = storeWith({ 0: '长'.repeat(300), 1: '长'.repeat(300), 2: '长'.repeat(300), 3: '长'.repeat(300), 4: '长'.repeat(300) });
const charCapped = digestRows(longStore, turns, { maxRows: 50, maxChars: 700 });
assert.ok(charCapped.length >= 1, 'at least one line always survives');
assert.ok(charCapped.reduce((sum, r) => sum + r.text.length + 10, 0) <= 700, 'the char cap is respected');
assert.equal(charCapped[charCapped.length - 1].assistant_index, 4, 'and the line that survives is the newest');

// A runaway event_summary cannot eat the window.
const runaway = digestRows(storeWith({ 0: 'x'.repeat(5000) }), turns, {});
assert.equal(runaway[0].text.length, DIGEST_LINE_MAX_CHARS, 'a line is capped on its own');
assert.ok(!runaway[0].text.includes('\n'), 'and flattened, so one line stays one line');

// Level-1 rows keep the shape every existing consumer expects, with deterministic ids.
const level1 = digestToLevel1(rows);
assert.equal(level1.length, 3);
for (const row of level1) {
  assert.equal(row.level, 1);
  assert.equal(row.digest, true, 'machine-assembled rows are marked as such');
  assert.equal(row.source_ids.length, 1, 'each line stands for exactly one turn');
  assert.match(row.id, /^summary_l1_[0-9a-z]+$/);
}
const again = digestToLevel1(digestRows(store, turns, {}));
assert.deepEqual(again.map(r => r.id), level1.map(r => r.id), 'ids are deterministic, so a rebuild is stable');

// Diagnostics describe the gap between what was extracted and what is still standing in.
const stats = digestStats(store, turns, {});
assert.equal(stats.version, DIGEST_VERSION);
assert.equal(stats.lines, 3);
assert.equal(stats.extracted_records, 3);
assert.equal(stats.uncovered_records, 0);
assert.equal(stats.oldest_index, 0);
assert.equal(stats.newest_index, 4);

console.log('PASS v5.5 digest: deterministic per-turn Level 1, bounded window, honest coverage');
