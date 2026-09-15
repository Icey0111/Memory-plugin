# ADR-0022: The packer never quotes the same text twice

- Status: accepted
- Date: 2026-09-13
- Supersedes: -
- Superseded by: -

## Context

A 100-floor live run in which the user's turn was always `继续。` - the character drives, the user only
signals "go on". At floor 51 the evidence block held five verbatim copies of that fifty-character row and
nothing else: the block spent its whole allowance quoting filler the prompt had just stopped showing, while
the story sat in the replies beside it.

Replayed offline in the state the prompt is really built in - the chat ending at the user's row, not at the
assistant's reply - the cause is neither the reranker nor the vector channel: it reproduces on the lexical
path alone, because the query's newest row is the filler and the archive holds forty-nine more copies of it.
An earlier version of the replay read the saved file as it stands *after* the reply and could not reproduce
the block at all; the query it rebuilt was a different one. The state a prompt is assembled from ends at the
user's message.

| replay at floor 50, 1000-token budget | packed spans | tokens | copies of the user's row |
| --- | --- | --- | --- |
| before | one reply and four copies | 366 | 4 of 5 |
| after | five replies | 920 | 0 of 5 |

## Decision

1. **N7 is about text, not row identity.** A candidate whose text the prompt still carries - verbatim,
   ignoring whitespace, under any row id - is not quoted.
2. **One slot per distinct text.** A candidate whose text has already been packed in the same call is
   reported with the outcome `same-text` and skipped. The rule is settled in the packer because it does not
   require judging relevance, which is what the channels and the optional reranker are for.
3. **Whole-row comparison, so it stays conservative.** Only a verbatim repeat is dropped; nothing is scored
   for similarity. A user who repeats a line loses nothing, because the prompt already shows the newest copy.
4. **The trace names the rule.** `same-text` is separate from `same-message`, so a measurement can tell "the
   prompt already had it" from "this message already contributed a span".

## Consequences

- On a chat whose rows do not repeat, the output is byte-identical: the recorded scripted user chat packs the
  same five spans for the same 644 tokens before and after.
- The budget is spent on content rather than copies: 366 to 920 of 1000 tokens in the measurement above, and
  the live block at floor 51 of the run went from five copies of `继续。` to five story passages (floors 80,
  56, 72, 88, 48).
- The test fixture in section 18 of `test-narrative-pipeline.mjs` had five identical rows; it is five
  distinct rows now, because otherwise it would have been testing this rule instead of slot allocation.
