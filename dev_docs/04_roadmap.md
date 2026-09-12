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
injected block is a snapshot of the last accepted summary (ADR-0017), and it states the floor it is current
as of. Knowledge is one line per character, bundling what that character knows and does not know (ADR-0018);
the host counts any character that takes more than one line and warns.

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
韩铮 holds both `不知道 账本存在` and `知道 账本在林昭手中`. The prompt asked for one line per statement;
the model was not writing one line per character.

State changes reached the injected block after 7, 6 and 4 turns, and two changes made at turns 52 and 54
never reached a block inside the window. The only contradiction observed was that window: for turns 15-20
the block still said 黄铜钥匙归林昭 after the handover on turn 14. The transcript of the handover was still
visible, and the model used it - the turn-21 probe was answered correctly by noticing the empty belt.

Eleven probes asked about facts established 4 to 59 turns earlier; ten were answered correctly. The one
probe whose answer existed only in the original text (a lamp detail from turn 6, folded since turn 10) was
retrieved and answered from the quotation. Of the eight probes whose source floor was folded, two had that
floor packed into the evidence block; the other six were already carried by the state block, so retrieval
was not what answered them.

### After the protocol change (ADR-0018)

The knowledge section now asks for one line per character that bundles what that character knows and does
not know, every injected block states the floor it is current as of, and the host counts subjects that took
more than one line. Verified on a fresh 30 user turns (60 floors), same cadence, model and reranker, three
summary passes, 0 summary failures and 3 generator retries:

| observation at turn 30 | 60-turn run | verification |
| --- | --- | --- |
| knowledge entries | 9 | 7 |
| most lines on one subject | 2 | 1 |
| subjects with more than one line | 1 | 0 |
| probes answered | 10 of 11 over the whole run | 6 of 6 |

The verified form keeps one line per character and puts what the character does *not* know in that same
line, which is what the merge rule always assumed. The stale window is unchanged: the key handover on turn
12 stayed wrong in the block until the turn-20 pass, a lag of 9 turns.

### Which layer actually answers (four runs, 114 turns, 27 probes)

Every probe was answered correctly across the four runs. The single exception was a character declining to
assert a death on the strength of one report, which is the answer the scene wanted.

| where the answer already was | probes |
| --- | --- |
| the injected state block (summary + anchors + boundaries) | 24 of 27 |
| the summary alone, on the purpose-written probe set | 10 of 10 |
| **retrieval was the only possible source** | **3 of 27** |

The last row is the finding. Retrieval was the only possible source in 3 of 27 probes, all in the 60-turn run
(turns 40, 51, 59); in the 30-turn run and in both 24-turn probe runs it was never the only source. All three
were answered, and the two whose answer exists as original text had that text quoted. No missed recall was
observed - three cases are not a rate.

The summary is why. On a purpose-written probe set - a meaningless serial `灰鹭17-B`, a door plate
`丙字三号`, a count that fell from seven to five, an `靛蓝` lining - the summary carried all ten details at a
600-token budget, and still carried all ten after the budget was cut to 300 (summaries 344 vs 409 characters
stored). Squeezing the budget shortened the prose and kept the itemised facts.

So the continuity block is the foundation the story leans on, and retrieval is a fallback for what that block
drops. The cost of the arrangement is the prompt budget the block occupies, not the accuracy of the index.

## Validation still worth extending

1. Repeat the long run with other summary models and cadences. One model at one cadence follows the one-line
   instruction, and one model at one cadence is all that has been measured; the host-side counter exists so a
   model that does not follow it is detected rather than argued about.
2. Isolate the effect of the horizon header. Both the 60-turn run and the verification answered the
   stale-window probes correctly, so the header's benefit is unmeasured; it is kept because it removes an
   ambiguity for about a dozen tokens per block, not because a measurement showed a gain.
3. Measure whether a per-turn state refresh costs less than the contradictions it would remove. The current
   block is free but stale by up to one cadence, and a contradiction inside it is now a known shape.
4. Evaluate live recent-message queries on held-out stories. Four runs did that and the question moved: at
   this scale live play almost never makes retrieval the only source, so the same runs cannot justify reranking
   either. Revisit with a corpus the summary cannot hold, or where a whole cadence is summarised into a budget
   far below what it now uses.
5. Measure archive growth with edits and branches over hundreds of turns. Earlier near-zero numbers of
   superseded versions are observations from those chats, not a bound on future storage.

## Constraints

- Knowledge boundaries are explicit records, not enforced information-flow restrictions.
- Summary/anchor/knowledge token budgets bound injected blocks, not the host's unsummarized tail.
- Embedding and reranking calls have costs beyond the final LLM context budget.
- The earlier 87% answer-in-context result belongs to its measured question set and provider.
- Source-id coverage verifies provenance alignment, not whether every necessary fact was summarized.
- Retrieval is a fallback: it was the only possible source in 3 of 27 measured probes, so its precision is not
  established by live play in this architecture, only its absence of observed failure.
- The state block is stale by up to one cadence by design (ADR-0017); the visible transcript is what covers
  that window.

A measured failure exists for the state block - over-keeping and staleness of up to one cadence - and the
first of the two has been fixed by changing the restatement protocol rather than by adding a model call
(ADR-0018). The remaining work is a change to the projection, not a new memory hierarchy or a per-floor
summarizer.
