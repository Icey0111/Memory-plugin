# ADR-0025: Diagnostics name the condition and the version

- Status: accepted
- Date: 2026-09-13
- Extends: ADR-0023, ADR-0024

## Decision

The batching was correct and the reporting was not. Four rules, each one a gap a live acceptance run
exposed.

1. **A failed summary is classified, and the classification is kept.** "The summary failed" was covering
   five different problems then (`FAILURE_STAGES` has two more now: `input_budget` and `anchor_ops`, added by
   ADR-0024 and ADR-0029): a transport or provider error, an empty body, a truncated body, a summary that
   exceeded its own accept budget, and a reply that carried anchors but no prose. The stage is attached
   where the evidence still exists and recorded in a bounded `summary_last_error`: time, stage and its
   label, a 300-character reason, the batch identity, the input cost, the accept budget, the actual summary
   token count, the transport response status when there was one, and an attempt counter that only counts
   repeats of the same frozen batch. A success clears `summary_error` and the counter and marks the record
   `recovered: true`; it does not erase it.

2. **Two versions, because coverage and content answer different questions.** `source_revision` is the
   hash of the covered chunk ids - which sources this state read. `state_revision` (raw-history.js,
   `stateRevisionOf`) hashes the coverage, the prose, the anchors and the knowledge boundaries together -
   what this state says. Coverage is part of the state version deliberately: the hidden range is decided by
   coverage, so the same prose over more floors is a different state. `injected_stale` compares the
   injected state version with the committed one, so the same floor count with different prose is still an
   old injection.

3. **A build is not an injection.** `buildNarrativeContext` composes and returns an `injection`
   descriptor. Only `runNarrativeGeneration` writes `state_horizon_floors`, `injected_source_revision`,
   `injected_state_revision`, `injected_chars` and `injected_at`, and it does so after
   `setExtensionPrompt` has been called. A prompt that was built and then dropped - a quiet generation, a
   chat switch, a thrown host call - leaves the last real injection as the answer to "what did the model
   see".

4. **Assembly and folding describe one version.** A background summary can commit while a prompt is being
   assembled, because that path waits on the vector collection, the reranker and the setting plane. The
   committed state is therefore re-read after the last await, and once more synchronously immediately
   before the prompt is set; if it moved, the continuity blocks are composed again. Reproduced before the
   fix with a controllable pause: a commit hid 40 rows while the block still said "current as of floor 10",
   which leaves the floors between the two coverages neither summarized nor visible.

5. **Warnings name the condition, not just the number.** `summary_state` is one of `idle`,
   `accumulating`, `summarizing`, `failing`, `blocked` or `backlog`. An accumulating tail never warns,
   however large it is: it is exactly the material the next batch reads. A local budget block warns. Real
   consecutive failures warn at the threshold. A backlog warns only when a whole batch is waiting with no
   pass running *and* the tail is past `narrative_pending_warn_tokens`; the size alone no longer raises
   anything, which is what made every batch cycle look like a fault.

6. **The measured input budget is the new-install default, and an existing value is never overwritten.**
   `narrative_input_chars` now defaults to 40000 - the measured 23,742-character ten-turn request - instead
   of the 18000 that could not hold it. An install that stored 18000 keeps it, because that value may be a
   deliberate choice and the plugin cannot tell, and is told about the discrepancy through the report's
   `notices`, which the panel shows apart from the warnings. Guessing would be a configuration change
   nobody asked for.

## Consequences

`summary_last_error` is one bounded object, not a log: it rides in the chat file and is replaced by the
next failure. Nothing here decides whether to raise the 600-token summary budget. Summaries in the live
runs landed at 532 of 600 tokens, which is close enough to the ceiling to be a plausible cause of the
three unexplained single failures, and far enough from proof that acting on it first would be covering an
unknown with a bigger context bill.

## Measured

Rebuilt from the chat that actually failed (41 rows, 22 recorded failures). With the old default of 18000
the state is `blocked`, the block needs 23,742 characters, and `summary_last_error` is null - a local
block never was a failure. After a simulated transport failure followed by a success: `summary_failures:
0`, `summary_error: null`, and `summary_last_error = {stage: 'transport', reason: 'offline audit: no
provider', recovered: true, attempt: 1}`. The committed state version is `1uy2g53` and nothing has been
injected, so the report says stale rather than pairing a new state with an old injection.

## Validation

`test-summary-diagnostics.mjs` (new) covers the failure stages through the real request path where
possible, the recovered-and-retained record, the attempt counter, the same-coverage-different-content
staleness, build-without-inject, the assembly-across-a-commit case, the five warning conditions, and the
new default with the legacy notice. `test-narrative-pipeline.mjs`, `test-summary-contract.mjs` and
`test-summary-lifecycle.mjs` were moved to the same contract.
