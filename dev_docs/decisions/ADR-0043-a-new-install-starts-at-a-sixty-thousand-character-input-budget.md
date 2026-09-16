# ADR-0043: A new install starts at a 60,000-character summary input budget

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

`narrative_input_chars` (default 40,000, clamped to 2,000..100,000) is a character budget on the summary
*request text*; a request longer than it is recorded as a `summary_block` with reason `input_budget` and is not
sent (ADR-0024). The 40,000 default was chosen from a 23,742-character batch.

The frozen evidence says that is not enough for a verbose story. The single recorded block needed **43,658
characters** against 40,000 - a ten-turn batch whose replies averaged **3,953** characters (max 5,464), where
the development log had recorded "about 1,800". Only two recorded runs ever ran at the default (`ds-fact` and
`ds-detail`); every other run was raised to the 100,000 cap, so the default was never exercised against the
verbose corpus that broke it. The largest request any run actually sent was 27,846 characters.

## Decision

The default for a **new install** is 60,000 characters. An existing stored value is untouched, and the
low-value notice keeps firing at the legacy 18,000 only - a stored 40,000 is a configured choice, not a
migration bug.

## Consequences

- 60,000 clears the only recorded block by 16,342 characters and the largest request ever sent by 32,154. It is
  an interpolation between the observed failure (40,000) and the working runs (100,000), not a measured A/B;
  the direction is what the evidence supports, and the number is where the curve is still cheap.
- The install that actually blocked keeps its stored 40,000 and needs a setting change; this ADR changes what
  the next install starts with, and the development log now records the 3,953-character reply average instead
  of 1,800.
- A character budget is not the context window. The runtime still reports `context_tokens: null`,
  `context_tokens_status: 'unknown'`, because it cannot read the provider's window; characters are not
  proportional to tokens, so a CJK story can approach that window well under any character budget here.
- A local shortfall stays a record, not a failure, and it still stops the summary from advancing while the raw
  tail grows. Any fixed budget can eventually be exceeded by a very verbose story; the measured options there
  are raising this setting or lowering `narrative_every`.
