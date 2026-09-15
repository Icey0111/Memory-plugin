# ADR-0012: Knowledge boundaries are a record, not a filter

- Status: accepted
- Date: 2026-09-12
- Supersedes: the open question at the end of ADR-0008
- Superseded by: -

## Context

ADR-0008 made knowledge boundaries an explicit section of the summary protocol and left one thing
undecided: whether they should be *enforced* - that is, whether the plugin should prevent a character
from acting on something they do not know. Before deciding, the question is what enforcement would
actually be built on.

## Decision

Do not enforce. Keep the boundary as a record that is stated, carried, injected and reported.

Reasons, in order of weight:

1. **The retired filter cannot be reinstated and should not be.** `known_by` filtered *facts out of a
   prompt*. There are no injected facts now; the text the model reads is the narrative itself, quoted
   from the story the user wrote. Filtering that would mean hiding the user's own prose from the model,
   which changes what the story is rather than what a character knows.
2. **A ledger's failure mode is worse than its absence.** Enforcement needs a per-entity knowledge
   ledger plus a filter over generated text. A wrong ledger entry hides something true from the
   narrator, and the user cannot see why the character suddenly forgot. An unenforced boundary that is
   stated every turn fails visibly: the character says something they should not, and the reader
   notices.
3. **The record now survives what it has to survive.** The ten-rewrite experiment in
   test-narrative-pipeline.mjs shows a boundary carried through ten passes whose prose is deliberately
   lossy, and the panel reports boundaries the summarizer stopped repeating.

## Consequences

- The boundary is visible in the panel, assertable in a test, and re-injected every generation.
- An unconfirmed boundary is now announced with the same threshold as an unconfirmed anchor, so a
  summarizer that stops restating it is noticed rather than silently trusted.
- If enforcement is ever wanted, it needs its own design with its own failure analysis. This ADR says
  what it would have to beat: a stated boundary that fails in the open.
