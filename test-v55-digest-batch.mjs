// Level-1 sealing: narrative coverage is O(chat), not O(window).
//
// Measured on the live acceptance chat's own event summaries with the live caps (120 rows / 8,000
// characters, 164 characters per summary): the digest window saturates at about 45 floors. Because
// reconcileFoldCoverage used to rebuild level1 from that window and discard every digest row it did not
// rebuild, every older floor lost its stand-in and unfoldFloorsNotCovered had to restore it as raw text
// - 56 floors left 12 raw, 120 left 75 raw, and 500 left 456 raw floors, more text than the memory
// system removes. Sealing fixes it: a full batch becomes ONE row with an id derived from its floors, and
// that row is kept.
import assert from 'node:assert/strict';
import { coalesceDigestBatches, digestToLevel1, digestRowFloorIndexes, digestCoveredIndexes, DIGEST_LINE_MAX_CHARS } from './v55-digest.js';
import { reconcileFoldCoverage } from './v55-summary-runtime.js';

const rowsFor = indexes => digestToLevel1(indexes.map(index => ({
  assistant_index: index,
  source_id: 'turn_' + index + '_fp',
  text: '第' + index + '层：' + '情节细节'.repeat(8),
  at: 1000 + index,
})));

// --- the batching contract -----------------------------------------------------------
const ten = coalesceDigestBatches(rowsFor([...Array(10).keys()]), { everyTurns: 10 });
assert.equal(ten.length, 1, 'ten lines become one row');
assert.equal(ten[0].sealed, true);
assert.equal(ten[0].floors, 10);
assert.equal(ten[0].merged, 10);
assert.equal(ten[0].source_ids.length, 10, 'it names every floor it stands in for');
assert.deepEqual([...digestRowFloorIndexes(ten[0])].sort((a, b) => a - b), [...Array(10).keys()]);
assert.ok(ten[0].text.length <= DIGEST_LINE_MAX_CHARS, 'a sealed batch obeys the same per-line cap as every other digest line');
assert.ok(ten[0].text.startsWith('第0层：'), 'the oldest floor keeps its line: the cause survives and the restatement is trimmed');

// The id is a function of the floors, so a later pass reproduces the row instead of duplicating it.
const again = coalesceDigestBatches(rowsFor([...Array(10).keys()]), { everyTurns: 10 });
assert.equal(again[0].id, ten[0].id, 'a sealed batch id is stable across passes');
// An eleventh floor goes to the tail, so batch 0 is byte-identical: a sealed row does not churn as the
// chat grows past it.
assert.equal(coalesceDigestBatches(rowsFor([...Array(11).keys()]), { everyTurns: 10 })[0].id, ten[0].id);
// A different floor set is a different batch.
assert.notEqual(coalesceDigestBatches(rowsFor([...Array(10).keys()]), { everyTurns: 5 })[0].id, ten[0].id);

// A batch that is still filling keeps one row per floor, so folding still starts at the first turn.
const partial = coalesceDigestBatches(rowsFor([...Array(14).keys()]), { everyTurns: 10 });
assert.equal(partial.filter(r => r.sealed).length, 1);
assert.equal(partial.filter(r => !r.sealed).length, 4);
assert.ok(partial.filter(r => !r.sealed).every(r => r.batch === 1 && r.sealed === false));
assert.equal(new Set(partial.flatMap(r => digestRowFloorIndexes(r))).size, 14, 'batching never loses a floor');

// everyTurns = 1 seals every floor on its own: one permanent row per turn, which is the old shape plus
// the permanence.
const singles = coalesceDigestBatches(rowsFor([0, 1, 2]), { everyTurns: 1 });
assert.equal(singles.length, 3);
assert.ok(singles.every(r => r.sealed === true && r.floors === 1));

// An ordinal taken from a supplied map, not from the row index: a sparse floor space still batches by
// floor count rather than by row index.
const sparse = coalesceDigestBatches(rowsFor([10, 30, 50]), { everyTurns: 3, ordinalOf: new Map([[10, 0], [30, 1], [50, 2]]) });
assert.equal(sparse.length, 1);
assert.equal(sparse[0].sealed, true, 'three floors in ordinal order are one full batch however far apart they sit');

// --- the regression: a sealed batch outlives the window and the extraction record -----
function makeCtx(floors, { everyTurns = 5, maxChars = 8000 } = {}) {
  const chat = [];
  const extractions = {};
  for (let i = 0; i < floors; i += 1) {
    chat.push({ is_user: true, mes: '用户第' + i + '句' });
    chat.push({ is_user: false, mes: '助手第' + i + '句正文' });
    extractions['x' + i] = {
      assistant_index_at_creation: i * 2 + 1,
      event_summary: '第' + i + '层纪要：' + '情节细节'.repeat(8),
      generated_at: 1000 + i,
    };
  }
  return {
    chat,
    extractions,
    ctx: {
      extensionSettings: { aetheriaUnifiedMemoryV54: {
        enabled: true, hierarchical_summary_enabled: true,
        summary_level1_every_turns: everyTurns, summary_level2_every_l1: 2, summary_level3_every_l2: 0,
        summary_fold_hidden_floors: false, summary_fold_keep_recent_floors: 1,
        summary_digest_enabled: true, summary_digest_max_rows: 120, summary_digest_max_chars: maxChars,
      } },
      chatMetadata: { aetheriaUnifiedMemoryV54: { extractions, hierarchical_summaries: {
        version: 3, processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [],
        level1: [], level2: [], level3: [], dirty: false,
      } } },
      chat,
      setExtensionPrompt() {}, saveMetadataDebounced() {}, saveSettingsDebounced() {},
      saveChat() {},
      generateQuietPrompt: async () => { throw new Error('the deterministic digest must not call a model'); },
    },
  };
}
const treeOf = ctx => ctx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries;

// Twelve floors, five per batch: two sealed batches covering assistant floors 1..19, plus two rows for
// the batch that is still filling.
const first = makeCtx(12);
await reconcileFoldCoverage(first.ctx);
const stored = treeOf(first.ctx);
const sealed = stored.level1.filter(r => r.sealed === true);
assert.equal(sealed.length, 2, 'twelve floors make two full batches of five');
assert.deepEqual(sealed.map(r => r.floors), [5, 5]);
const coveredFirst = [...digestCoveredIndexes(stored.level1)].sort((a, b) => a - b);
assert.deepEqual(coveredFirst, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);

// The extraction records behind those batches are pruned, exactly as a bounded log would prune them.
// The lines are gone, so the batches cannot be rebuilt - but their rows are stored, and every floor
// they name is still a completed turn. Dropping them would restore all ten floors to the raw prompt.
const pruned = makeCtx(12);
for (const key of Object.keys(pruned.extractions)) {
  if (Number(pruned.extractions[key].assistant_index_at_creation) < 21) delete pruned.extractions[key];
}
pruned.ctx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries = stored;
await reconcileFoldCoverage(pruned.ctx);
const coveredPruned = digestCoveredIndexes(treeOf(pruned.ctx).level1);
for (const index of [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]) {
  assert.equal(coveredPruned.has(index), true, 'floor ' + index + ' must keep its stand-in after its line is gone');
}

// The control: the same pruned chat with no stored tree has no stand-in for those floors at all. This is
// what the carry is for - the difference between "the prompt keeps ten raw floors" and "it does not".
const control = makeCtx(12);
for (const key of Object.keys(control.extractions)) {
  if (Number(control.extractions[key].assistant_index_at_creation) < 21) delete control.extractions[key];
}
await reconcileFoldCoverage(control.ctx);
const coveredControl = digestCoveredIndexes(treeOf(control.ctx).level1);
assert.equal(coveredControl.has(1), false, 'with nothing stored and no line, the floor is genuinely uncovered');

// A carried batch is dropped the moment one of its floors stops being a completed turn.
const truncated = makeCtx(12);
truncated.ctx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries = stored;
truncated.ctx.chat = truncated.ctx.chat.slice(5); // every floor those batches named is gone
await reconcileFoldCoverage(truncated.ctx);
const carriedAway = treeOf(truncated.ctx).level1;
assert.equal(digestCoveredIndexes(carriedAway).has(1), false, 'a stand-in for turns that no longer exist is not kept');
assert.equal(digestCoveredIndexes(carriedAway).has(11), false, 'and neither is the second batch');
assert.equal(carriedAway.length, 0, 'nothing may stand in for a chat that no longer has those turns');

// --- D1: a sealed member that had to be cut carries its cast ----------------------------
//
// The row is one line and each member gets a share of it, so a long member's clause is cut and only its
// head survives - frequently not the part that says who it is about. The extraction records name the
// cast deterministically, so a cut member spends part of its share on that instead of on a fragment.
// Same bytes per member, more of them meaningful, and the cut is marked where the bare join left a
// reader unable to tell a complete clause from a severed one.
const longMembers = [...Array(10).keys()].map(index => ({
    assistant_index: index,
    source_id: 'turn_' + index + '_fp',
    text: '第' + index + '层：' + '情节细节'.repeat(30),
    at: 1000 + index,
    entities: ['弥拉', '井台', '手札'],
}));
const sealedLong = coalesceDigestBatches(digestToLevel1(longMembers), { everyTurns: 10 });
const longText = sealedLong[0].text;
assert.ok(longText.includes('…['), 'a cut member is marked as cut: ' + longText.slice(0, 140));
assert.ok(longText.includes('弥拉'), 'and names its cast, so the row still says who it is about');
assert.ok(longText.length <= DIGEST_LINE_MAX_CHARS, 'while staying one line');
assert.equal((longText.match(/…\[/g) || []).length, 10, 'every member was cut, so every member is marked');

// A member that fits is untouched: no marker, and no characters spent on a cast it does not need.
const shortMembers = [...Array(10).keys()].map(index => ({
    assistant_index: index,
    source_id: 'turn_' + index + '_fp2',
    text: '第' + index + '层：短句。',
    at: 2000 + index,
    entities: ['弥拉'],
}));
const sealedShort = coalesceDigestBatches(digestToLevel1(shortMembers), { everyTurns: 10 });
assert.ok(!sealedShort[0].text.includes('…'), 'an uncut member carries no cut marker');
assert.ok(!sealedShort[0].text.includes('弥拉'), 'and spends nothing on its cast');
assert.ok(sealedShort[0].text.startsWith('第0层：'), 'the oldest member still leads the row');

// A row with no cast at all still truncates rather than throwing, and still marks the cut.
const bareMembers = [...Array(10).keys()].map(index => ({
    assistant_index: index,
    source_id: 'turn_' + index + '_fp3',
    text: '第' + index + '层：' + '无主体细节'.repeat(30),
    at: 3000 + index,
}));
const sealedBare = coalesceDigestBatches(digestToLevel1(bareMembers), { everyTurns: 10 });
assert.ok(sealedBare[0].text.includes('…'), 'a castless cut is still marked');
assert.ok(!sealedBare[0].text.includes('['), 'and invents no cast to fill the space');
console.log('PASS v5.5 digest batch sealing: a full batch becomes one permanent row, so coverage is O(chat)');
