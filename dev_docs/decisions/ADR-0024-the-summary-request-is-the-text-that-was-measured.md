# ADR-0024: The summary request is the text that was measured

- Status: accepted
- Date: 2026-09-13
- Supersedes: the input-budget failure behaviour of ADR-0023, and the message-row horizon of ADR-0018

## Decision

Four rules, each one a defect a 40-floor acceptance run exposed.

1. **The horizon counts floors.** The injected header says "current as of floor N" where N is the number
   of complete turns the accepted summary covers, computed from the covered chunk prefix. It used the
   covered message-row index plus one, so a first batch of ten turns claimed floor 21 and the number did
   not move after the second batch.
2. **Committed coverage and injected coverage are separate numbers.** The panel reports the coverage the
   stored summary has now and the coverage the last injection actually carried, each with its revision.
   They differ between a commit and the next generation, and `injected_stale` says which one a reader is
   looking at instead of pairing a new summary with an old floor.
3. **The request is assembled from original messages.** Retrieval keeps its 700/100 chunking. The summary
   request carries one entry per source message, whole text, in batch order. Deduplication is by source
   id, never by text: two messages that happen to be identical are two events and both belong in the
   request.
4. **The text that is measured is the text that is sent.** The request is built once by `summaryRequest`,
   its parts are reported, and the character budget applies to that exact string. Nothing is appended
   after the check.

A local input-budget shortfall is a block, not a model failure. It is recorded once per frozen batch and
budget (`summary_block.checks` counts the re-checks), it never increments `summary_failures`, it never
calls the model, and it never hides a floor. A changed budget or changed batch text is a new check. A real
interface error keeps its own counter and its own message. The frozen batch is still frozen: the coverage
claim comes from the selection, never from the chat length at the end of the call.

The character budget is not the model context window. The plugin cannot read the provider's window, so the
report says `context_tokens: null` with `context_tokens_status: 'unknown'` rather than implying that a
request which fits the budget will be accepted.

## Consequences

Selection, assembly and measurement are three separate steps: `nextSummaryBatch` returns the earliest N
complete turns as a chunk-id prefix plus the source ids they came from, `summaryMessages` turns those ids
into original messages, and `summaryRequest` builds the single string that is then checked and sent.

Measured by rebuilding the request from the chat that actually failed (41 rows, 43,352 characters of
character text): the batch is 53 retrieval chunks and 21 original messages; the parts are instructions
556, carried summary 1, anchors 1, knowledge 1, batch 23,148, total 23,742 characters. The old per-chunk
accounting demanded 30,300 characters for the same batch - a 1.28x inflation, paid again at every 100-char
overlap - which is why it threw against the 18,000 default. Twenty forced triggers at an 18,000-character
budget produce one block with `checks: 20`, zero model calls, zero failures and zero hidden rows; raising
the budget to 40,000 lets the same frozen batch through, commits ten floors and hides exactly twenty rows.

## Validation

`test-summary-contract.mjs` covers the 9/10/13/20 boundaries and the manual trigger, earliest-N backlog
selection, a multi-chunk message appearing once and two identical messages both surviving, the per-part
cost report, twenty re-checks of one block, unblocking after a budget change, separation from a real
interface failure, the committed/injected lag across two batches, and appends and in-batch edits during a
request. The batch and lifecycle suites were moved to the same contract.
