# ADR-0039: A build records the ranking it was given, not only what it quoted

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

The recorded FactSurvival3 turn quoted five original rows and none carried the place name the probe asked for,
while a 75-character message containing all three of the question's own words was not quoted at all. The
store recorded only `sources` - what was quoted, 289 bytes for that turn - so "ranked ninth and lost to the
entry cap" and "never ranked at all" were the same observation, and telling them apart needed another live
run. Without the fixture that produced it (ADR-0038) that run was not even repeatable, and after ADR-0037
changed which part of a long message is quoted, the two loss stages had to be separable offline.

## Decision

Every build records two bounded, complete-in-count structures beside the quoted rows:

- `evidence_candidates`: the order the packer was given, per ranked chunk - source, chunk id, row index,
  span, fused score, lexical / dense / entity score, and the channels that produced it.
- `evidence_trace`: one outcome per ranked candidate - `included`, `budget`, `too_long`, `entry_cap`,
  `not_selected`, `same-text`, `same-message` - with the slot it was given, what it cost, and whether an
  included quote had to be shortened to fit.

Both are pure functions in `raw-history.js`, capped at 40 rows, and the counts cover the whole record: a
candidate past the row bound is still counted, so the record stays small without lying about the shape.

## Consequences

- Measured on the frozen FactSurvival3 chat: 30 ranked candidates -> 4.7 KB and 20 outcomes -> 2.1 KB, against
  289 bytes for the quoted rows alone; about 10 KB at the 40-row bound. That is the same order as the
  diagnostics already persisted (`required_uncarried`, the warning block, the parked-term lists), so it does
  not change what a chat file costs.
- The question that motivated it is answerable offline now. Ranking that chat lexically puts the 75-character
  message at rank 9 of 30 with `entry_cap`, so it was ranked out and not unrankable - a selection defect, not
  a scoring failure - and the live fused ranking that actually ran had 77 candidates from the dense, situation
  and character channels. The recorded turn itself predates this record.
- Selection and packing are now different outcomes in one record, which is the distinction the contract asks
  for: a fact being selected, injected and used are not the same event. A quote that was *shortened* is
  recorded as such (`trimmed`), rather than left to be inferred by comparing the emitted span with the
  candidate's - which is the reading ADR-0037 changed.
- Nothing here changes ranking, packing or what is injected. The records are diagnostics, and the packer's
  behaviour is unchanged.
