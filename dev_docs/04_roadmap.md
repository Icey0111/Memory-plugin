# Roadmap and Evidence Limits

## Current architecture

The active path uses versioned original text, one rolling continuity summary, continuity anchors,
knowledge records, original-chunk BM25/dense retrieval, optional reranking, and budgeted quotations.
The extracted-fact generation runtime and layered-summary stack are retired.

This iteration separates background summary work from foreground reads, invalidates all continuity
projections together after history changes, and uses request-local summary settings with response
diagnostics. Default cadence is 10 completed user turns, normally 20 message floors. Summary coverage
is source coverage, not proof of semantic fidelity.

Anchors and knowledge boundaries are re-stated by the summary rather than updated between passes, so the
injected block is a snapshot of the last accepted summary (ADR-0017). A fresh knowledge line retires that
subject's carried line, and only a subject the summary did not mention at all survives as unconfirmed -
it does not collapse several lines the summary writes for one subject in a single pass.

## Measured on a 60-turn live run

Sixty user turns (120 floors), one chat, cadence 10, `deepseek-v4-flash`, `jina-reranker-v3`, evidence
budget 1000: six summary passes, no summary failures, no aborted turns. Every active anchor and boundary
was re-stated at every pass - `anchors_unconfirmed` and `knowledge_unconfirmed` were 0 on all 60 turns.
What the run exposed is over-keeping and staleness, not forgetting.

| turn | 10 | 20 | 30 | 40 | 50 | 60 |
| --- | --- | --- | --- | --- | --- | --- |
| anchors | 7 | 9 | 9 | 12 | 16 | 20 |
| knowledge | 6 | 8 | 9 | 14 | 18 | 20 (capped) |
| knowledge lines on the busiest subject | 1 | 2 | 2 | 3 | 4 | 6 |

At turn 60 the knowledge block spends its 20 entries on eight subjects, six of them on one character, and
韩铮 holds both `不知道 账本存在` and `知道 账本在林昭手中`. The prompt asks for one line per statement;
the model is not writing one line per character.

State changes reached the injected block after 7, 6 and 4 turns, and two changes made at turns 52 and 54
never reached a block inside the window. The only contradiction observed was that window: for turns 15-20
the block still said 黄铜钥匙归林昭 after the handover on turn 14. The transcript of the handover was still
visible, and the model used it - the turn-21 probe was answered correctly by noticing the empty belt.

Eleven probes asked about facts established 4 to 59 turns earlier; ten were answered correctly. The one
probe whose answer existed only in the original text (a lamp detail from turn 6, folded since turn 10) was
retrieved and answered from the quotation. Of the eight probes whose source floor was folded, two had that
floor packed into the evidence block; the other six were already carried by the state block, so retrieval
was not what answered them.

## Validation still worth extending

1. Repeat the long run with other summary models and cadences. One model at one cadence cannot separate
   "the model over-keeps" from "the protocol invites it".
2. Measure whether a per-turn state refresh costs less than the contradictions it would remove. The current
   block is free but stale by up to one cadence, and a contradiction inside it is now a known shape.
3. Evaluate live recent-message queries on held-out stories; offline explicit-question recall is a different
   task. Keep optional reranking optional until its latency and cost are justified there.
4. Measure archive growth with edits and branches over hundreds of turns. Earlier near-zero numbers of
   superseded versions are observations from those chats, not a bound on future storage.

## Constraints

- Knowledge boundaries are explicit records, not enforced information-flow restrictions.
- Summary/anchor/knowledge token budgets bound injected blocks, not the host's unsummarized tail.
- Embedding and reranking calls have costs beyond the final LLM context budget.
- The earlier 87% answer-in-context result belongs to its measured question set and provider.
- Source-id coverage verifies provenance alignment, not whether every necessary fact was summarized.
- The state block is stale by up to one cadence by design (ADR-0017); the visible transcript is what covers
  that window.

A measured failure now exists for the state block - over-keeping up to the knowledge cap, and staleness of
up to one cadence. Any fix is expected to be a change to the restatement protocol or to the projection, not
a new memory hierarchy or a per-floor summarizer.
