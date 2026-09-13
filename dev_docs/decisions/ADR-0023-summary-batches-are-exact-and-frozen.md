# ADR-0023: Summary batches are exact and frozen

- Status: accepted
- Date: 2026-09-13
- Supersedes: the newest-turn hiding exception in ADR-0001

## Decision

The configured N counts complete user turns, normally N user messages and N replies. A greeting is
context but does not count toward N and is never hidden by summary folding.

Wait for N unsummarized completed turns, then take exactly the earliest N. Manual invocation follows
the same rule. Freeze the selected source ids and request text before dispatch. New messages and edits
outside the selected prefix do not change that request; edits inside it invalidate the late result.

After successful acceptance, hide only complete covered turns, including the batch's final turn.
No temporary fold is created while the request runs. The foreground can still read new dialogue.
An input budget that cannot hold the entire batch reports failure and keeps the raw text visible.
It does not silently shorten the batch. The live-chat quiet fallback is excluded because it does not
guarantee a fixed input; raw generation and explicit message requests remain supported.

Legacy coverage ending mid-message or outside a multiple of the configured N is invalidated. Aligned
legacy coverage is retained. New fixed batches remain valid when N changes for subsequent batches.

## Consequences

One accepted default batch hides exactly 20 ordinary message rows. A backlog is handled in separate
N-turn calls, never as one oversized summary. Large batches may require a higher input budget. This
replaces the former newest-turn exemption and character-budget-driven partial coverage.

Validation uses deterministic transport doubles for batching, concurrent reads, append/edit handling,
budget rejection and legacy migration. Live semantic summary acceptance is a separate task.
