# ADR-0008: Knowledge boundaries as an explicit section of the summary

- Status: accepted
- Date: 2026-09-12
- Supersedes: the "what this gave up" answer in ADR-0002
- Superseded by: -

## Context

ADR-0002 retired the per-actor knowledge filter with the fact path: `known_by` used to hide a line of
fact text from a character who should not know it, and once facts stopped reaching the prompt there was
nothing left to filter per line. The answer at the time was "the boundary is text inside the summary",
which is honest but unverifiable: nothing recorded which boundary was supposed to hold, so nothing could
notice that a character had started acting on a secret.

## Decision

Make the boundary an explicit, inspectable part of the summary protocol, carried exactly like the
anchors:

- The summarizer emits a third section listing who knows what and who explicitly does not, in the form
  `- 角色 | 知道或不知道 | 事实`.
- The plugin stores the list, feeds it back verbatim on the next pass, and re-injects it every
  generation as its own block with its own token budget.
- A boundary the model stops restating is **kept and flagged as unrepeated**, never dropped. A missing
  section leaves the list untouched. The list is bounded, and the overflow is reported.

## Consequences

- The boundary is now a record rather than a hope: it can be read in the panel, asserted in a test, and
  diffed between passes.
- The block is bounded and deterministic, so the summary budget cannot evict it.
- It covers the case ADR-0002 could not: "this character must not act on this" is stated where the model
  reads it every turn, instead of being left to the summary's prose quality.

### What this is not

- **It is not enforcement.** The model is told the boundary; it is not prevented from violating it. Real
  enforcement would need a per-entity knowledge ledger and a filter over generated text, which is a
  different feature with a different failure mode (a wrong ledger hides true things).
- **It is not the retired filter restored.** That filter operated on injected facts; there are none.
- **It does not verify truth**, only that a boundary was stated and not retracted.
