# ADR-0032: A soft summary target and an emergency ceiling

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

ADR-0031 set the product direction: preserve the continuity the story needs, and treat the summary
length as an information-sensitive resource. The implementation had one number for two jobs.
`narrative_summary_tokens` (default 600) was both the target the request asked the model to aim at
("目标不超过 600 token") and the line the runtime refused a body for crossing
(`acceptedTokens > opts.summaryTokens`). The live run recorded in 04_roadmap.md refused a 610-token
body and a 672-token body, then committed on a later attempt (F-13). A refusal at 1.7% over the target
is a length-only event, and it cost an extra summary call and delayed a batch by one turn.

Equal completed-turn counts do not carry equal information. Twenty repetitive floors may compress to a
few sentences; twenty floors with a reveal, a transfer and a new condition do not.

## Decision

Separate three numbers.

1. **Soft target** - `narrative_summary_tokens` (default 600). The request asks the model to aim at it,
   as before.
2. **Emergency ceiling** - `narrative_summary_ceiling_tokens` (default `0`). `0` derives the ceiling as
   `min(4000, max(target + 100, round(target * 1.5)))`; an explicit value is kept but never below the
   target. A body over the target but within the ceiling is **accepted** and recorded as
   `summary_over_target` with the actual size. Only a body past the ceiling is refused, as
   `over_budget`, and a refusal hides nothing.
3. **Total injection budget** - the worst case the continuity, evidence and setting blocks may occupy:
   the summary at its ceiling plus the anchor, knowledge, evidence and setting budgets, capped by the
   host room the caller reports. `budgetsOf` computes it.

No model-based density classifier and no fitted density heuristic are added. The split is the smallest
policy that lets dense material use more room, and it is compatible with existing installs: a stored
`narrative_summary_tokens` keeps its meaning as the target, and the ceiling is derived.

## Consequences

- A 610/600 or 672/600 body is accepted on its first attempt; a length-only overrun no longer costs an
  extra call or delays a batch by one turn.
- The installed default becomes more permissive: 600 derives a 900-token ceiling. That is a deliberate
  policy change, recorded here rather than silently applied.
- Folding, source/version checks and atomic refusal are unchanged. A length-only change does not weaken
  them.
- The final numeric limits are still to be selected from evidence. Accepting more tokens is a resource
  choice; it does not prove that semantic information is preserved, and the behavior remains to be
  measured on real batches.
