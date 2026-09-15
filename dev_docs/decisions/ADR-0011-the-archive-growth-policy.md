# ADR-0011: The archive growth policy is no pruning

- Status: accepted
- Date: 2026-09-12
- Supersedes: roadmap item 3 of ADR-0004
- Superseded by: -

## Context

ADR-0004 measured the archive against the chat file once and left the growth question open: "bound the
archive only if a long chat shows it dominating". No long chat (300+ floors) exists on this machine, so
the rule was answered on the five real chats by measuring the *rate* instead of the total, and by asking
what could grow faster than the story.

## Measurements

| Quantity | Median over five real chats |
| --- | --- |
| Archive per floor | 3.8 KB |
| Superseded versions kept | **0** (0 KB) |
| Visible transcript per floor | ~1,039 tokens |
| Extrapolated to 500 floors | archive ~1.9 MB, visible transcript ~520k tokens |

## Decision

Keep the archive lossless, and do not add a retention policy.

- The archive grows **linearly with the story**: it is one copy of the text plus one record per
  superseded version, and superseded versions measured zero on every chat examined. There is nothing
  superlinear to bound.
- The number that needs bounding is the *visible transcript*, ~1,039 tokens per floor, which is what
  folding already addresses by removing covered floors from the prompt.
- The size is reported instead: `archive_chars`, `superseded_chars` and `visible_chars` are in the
  settings panel, and the ruler prints the rate, so the claim is checkable rather than asserted.

**The rule, if that ever changes:** prune only *superseded* versions, never the active lineage, and only
when they exceed the live text. Nothing prunes today because nothing measured says it should.

## Consequences

- No data is discarded, so the coverage-prefix check keeps its full meaning: any version a summary read
  can still be compared against.
- A chat that is edited heavily (many versions per floor) will add records at a rate this measurement
  did not observe. That case is named here, and the ruler reports `superseded` per chat, so the first
  chat that breaks the assumption will show it in the panel.
