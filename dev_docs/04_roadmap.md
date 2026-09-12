# Roadmap and Evidence Limits

## Current architecture

The active path uses versioned original text, one rolling continuity summary, continuity anchors,
knowledge records, original-chunk BM25/dense retrieval, optional reranking, and budgeted quotations.
The extracted-fact generation runtime and layered-summary stack are retired.

This iteration separates background summary work from foreground reads, invalidates all continuity
projections together after history changes, keeps freshly updated knowledge ahead of old overflow,
and uses request-local summary settings with response diagnostics. Default cadence is 10 completed
user turns, normally 20 message floors. Summary coverage is source coverage, not proof of semantic fidelity.

## Validation still worth extending

1. Repeat the live continuity test across longer stories and different summary models. Three accepted
   summaries exercise the lifecycle but cannot establish long-horizon drift rates.
2. Evaluate live recent-message queries on held-out stories; offline explicit-question recall is a
   different task. Keep optional reranking optional until its latency and cost are justified there.
3. Measure archive growth with edits and branches over hundreds of turns. Earlier near-zero numbers
   of superseded versions are observations from those chats, not a bound on future storage.

## Constraints

- Knowledge boundaries are explicit records, not enforced information-flow restrictions.
- Summary/anchor/knowledge token budgets bound injected blocks, not the host's unsummarized tail.
- Embedding and reranking calls have costs beyond the final LLM context budget.
- The earlier 87% answer-in-context result belongs to its measured question set and provider.
- Source-id coverage verifies provenance alignment, not whether every necessary fact was summarized.

No new memory hierarchy, per-floor summarizer, human-memory simulation or retrieval algorithm is
planned without a measured failure that calls for it.
