# ADR-0014: The evidence slot count follows the evidence budget

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

ADR-0006 fixed the packing rules that were losing answers: overlapping candidates merge, every entry gets
a share of the budget, an over-long span is trimmed rather than skipped. It left one number unmeasured -
the number of slots, which was four because four is what the packer had always used.

Answer-in-context over the 52-question set was 62% at four slots and a 1000-token budget, with span
precision 15%. The ruler can now pin the budget and the slot count separately, so both were swept. Two
facts came out of the sweep, and they are the reason this ADR exists:

- **A share below about 400 tokens cannot cover a merged envelope.** Chunks of one message merge into a
  span that runs 900-1500 characters, and a 250-token share quotes a quarter of it. Every one of the six
  answers that sat inside a quoted span and outside its quoted range was in a span that had merged two or
  three candidates.
- **A share above about 500 tokens buys nothing.** Recall stops moving once the share covers the envelope.

With the share pinned at what it needs, recall tracks the number of slots and precision runs the other way:

| budget | slots | answer-in-context | span precision | evidence |
| --- | --- | --- | --- | --- |
| 1000 | 2 | 63% | 32% | 886 tokens |
| 1200 | 3 | 63% | 21% | 1075 tokens |
| 1600 | 4 | 69% | 17% | 1437 tokens |
| 2000 | 5 | 71% | 14% | 1777 tokens |
| 2400 | 6 | 75% | 13% | 2108 tokens |

## Decision

1. **Derive the slot count from the budget: one slot per 400 tokens, minimum one, maximum six.**
   `evidenceSlots(maxTokens)` in raw-history.js. The budget is the single knob; raising it raises coverage
   instead of shrinking every share, which is what a fixed slot count did.
2. **An explicit `maxEntries` still wins.** The derivation is the default, not a policy: the ruler and the
   tests pin the slot count when they are measuring something else.
3. **Keep the shipped budget at 1000 tokens.** At that budget the derivation selects two slots, which
   measures 63% against the old 62% at fewer tokens and twice the precision. Nothing about the setting
   changes; only what the packer does with it.

## Consequences

- The default improves on all three measured axes at once: answer-in-context 62% -> 63%, evidence 932 ->
  886 tokens a query, span precision 15% -> 32%. The paired difference in recall is not resolvable on its
  own (4 against 3 discordant, p=1.0); the precision and the cost are.
- Raising `narrative_evidence_tokens` now has a proportional effect: 1600 buys four slots and 69%, 2400 buys
  six and 75%. Before this, raising the budget only made each of the four quotations longer.
- Fewer spans carry the same answers, so the prompt carries less text that has nothing to do with the
  question - which is the point of quoting evidence rather than pasting history.

### What this does not fix

- **The 12 losses that no budget reaches.** At every budget from 600 to 2400 the answer sat in the
  candidate list and outside the slots, because its span never ranked in the top four. That is a ranking
  problem, not a packing one, and it is what layers 2, 4 and 5 of dev_docs/06_retrieval_research.md are for.
- **Two questions whose answer is in the archive and in no candidate chunk at all.**
- **The measurement is one chat and 52 questions.** The 400-token share floor is a mechanism, not a fitted
  constant, but the frontier above is one story long.
- **Precision falls as slots rise.** Six slots quote more than twice the spans of two for 12 more points of
  recall. The cap of six is where that trade stops being worth measuring, not where it becomes bad.