# ADR-0047: A covered greeting is hidden with the batch

- Status: accepted
- Date: 2026-09-15
- Supersedes: the greeting clause of ADR-0023 (the batching and freezing rules still stand)
- Superseded by: -

## Context

A chat opens with the character's greeting: one assistant row before any user turn. The summary's coverage is
a prefix of the chunk list, so the greeting always sits inside the first batch - ADR-0023 nevertheless excluded
it from folding, on the grounds that it is context rather than a counted turn. That left the hidden rows a
prefix beginning at floor 1 while the transcript still showed floor 0 in full.

The host draws one "context starts here" boundary: TauriTavern/SillyTavern's `.lastInContext`, a
`border-top: 3px dotted` line whose id is `chat.length - openai_messages_count`, the first message the last
request sent. One boundary cannot represent a hidden set that is not a contiguous prefix. On the live chat that
prompted this ADR a committed ten-turn batch had folded rows 1-20, and the line sat at row 20 - the last *hidden*
row - instead of row 21: the faded rows appeared to be in context and the fully visible greeting above the line
appeared to be hidden. Folding is also what makes a covered row quotable as evidence (N7), so the greeting was
the one summarized row the retriever was forbidden to quote.

## Decision

1. **The greeting is hidden by the same rule every other row gets**: every one of its chunks is covered by the
   accepted summary, and it is a dialogue row the plugin did not find host-hidden.
2. **Only once a complete turn is covered.** A coverage claim that names nothing but the greeting hides nothing;
   the greeting folds together with the first accepted batch, never alone.
3. **It is still not a counted turn.** The greeting does not change the cadence and does not consume one of the N
   turns of a batch; the summary request still carries it as context, unchanged.

## Measured

- `node run-tests.mjs`: **50/50**. The fold counts in test-summary-contract, test-summary-lifecycle,
  test-summary-budget, test-summary-diagnostics and test-recovery-isolation move by exactly the one greeting row;
  test-narrative-pipeline section 3b pins the greeting-alone case (covered greeting without a covered turn stays
  visible, then folds when the first turn is covered).
- `node check-syntax.mjs`: 99 files.
- The natural track already excluded the greeting from `visible` when it simulates a fold, so the 1,296-turn
  corpus reading is unchanged by construction: this change makes the runtime agree with the instrument, it does
  not move the instrument.
- **Live confirmation after a host reload.** The run-2 acceptance chat ends at `folded 41` (rows 0-40) with the
  greeting hidden and the two probe rows 41-42 visible, so the host's next boundary lands at row 41 - below
  floor 40 - instead of row 40.
- **The precheck could not see this change.** `applyNarrativeFolds` was not in `runtime-precheck.mjs`'s WATCH
  list, so the deploy followed by the already-open page reported PASS while the page still executed the previous
  fold rule: the first live run after the deploy folded 40 rows, not 41. The fold functions (`validSummary`,
  `nextSummaryBatch`, `applyNarrativeFolds`) are now watched; the same precheck reports the stale loaded module
  before a reload and PASS after it. A gate is only as wide as the functions it watches.

## Consequences and limits

- The opening greeting now collapses with the first batch and leaves the model prompt. The summary carries its
  content and retrieval can quote its original text; unfolding or disabling the plugin restores it.
- The host's boundary line is prompt-array arithmetic, not this plugin's marker. It is correct only while the
  hidden rows are a contiguous prefix, so any future rule that hides a row without hiding everything above it
  reintroduces the same visible mismatch.
- The line is now correct in this configuration, but the plugin does not own that line; a host change to how
  `openai_messages_count` is computed can move it again without any change here.
