# Retrieval Evidence and Decisions

## What is measured

Two instruments answer different questions:

- **Prefix replay:** user-target and character-description coverage of the actual quoted span.
  Targets are derived independently of the chosen retrieval query, but remain heuristics.
- **Labelled retrieval:** a pre-annotated answer string must survive into packed original-text evidence.
  This measures answer-in-context, not whether a generated reply is correct.

Neither instrument accepts a summary or measures narrative drift. Those are separate acceptance work.

## Query comparison

On 2026-09-13, retrieval-audit.mjs replayed 62 chat files from the Seraphina corpus. Each generation
uses only its historical prefix. Folding is simulated every ten completed turns with the newest pair
visible; final summaries and final knowledge records are never borrowed from the future. Sorted file
indices divisible by three form the holdout. Related chats may still share content, so this is a file
holdout, not an independent-story generalization claim.

All strategies share scene-derived profile names, a 1000-token budget and lexical retrieval.
The controlled legacy query includes the previous two messages' final 80 characters plus the newest
message; focused requests use the pending user's text and add known scene names for pronouns.

| Set | Query | User-target coverage | Descriptive profile coverage | Mean evidence tokens |
| --- | --- | --- | --- | --- |
| Comparison, 328 request turns | legacy | 572/1582 | 56/58 | 688 |
| Comparison, 328 request turns | focused | 728/1582 | 50/58 | 431 |
| Holdout, 254 request turns | legacy | 455/1421 | 13/17 | 666 |
| Holdout, 254 request turns | focused | 773/1421 | 11/17 | 381 |

The 44 continuation turns are all in the comparison set. Both production query forms preserve
3/3 descriptive profiles there. Excluding continuation commands changes mean evidence tokens from
780 to 771 but changes no measured targets. The replay counted zero pure-command quotation slots
both before and after: it does not reproduce or validate a fix for the earlier reported 43 filler slots.

Decision: focused pending requests become the default; character descriptions remain a separate
channel, with the measured regression disclosed. Continuation retains the legacy query. An adaptive
summary-based continuation query remains an explicit experiment, not the default.

## Real vector and rerank comparison

A fixed 103-row archived chat snapshot was evaluated against twelve historical questions whose answer
needles were selected before model calls. Questions were appended virtually to the snapshot, without
changing the chat or generating replies. These are counterfactual questions on one story, not twelve
observed live user answers. Some needles occur more than once.

The installed host services supplied real jina-embeddings-v5-text-small query results and real
jina-reranker-v3 orders. The repository's final ranker, shortlist and packer consumed those responses.
Candidate input hashes ensure that a changed shortlist gets a fresh rerank call.

| Query | Dense | Rerank | Answer in evidence | Mean rerank latency |
| --- | --- | --- | --- | --- |
| legacy | off | off | 4/12 | — |
| legacy | off | on | 4/12 | 818 ms |
| legacy | on | off | 4/12 | — |
| legacy | on | on | 4/12 | 818 ms |
| focused | off | off | 5/12 | — |
| focused | off | on | 5/12 | 736 ms |
| focused | on | off | 5/12 | — |
| focused | on | on | 6/12 | 736 ms |

The harness calls the focused request branch "adaptive"; on these twelve pending requests it is
identical to the shipped focused branch. With focused+dense retrieval, reranking gains the mark-spacing
answer and loses none. Mean final evidence is 900 tokens with reranking versus 903 without.

Cost matters: focused+dense rerank inputs average 9821 estimated tokens, with a maximum observed request
latency of 857 ms. Provider-billed units were not returned by the installed adapter, so these estimates
are not a monetary bill. Across the original and final candidate experiments there were 24 vector calls
and 92 rerank attempts: 77 successful calls and 15 HTTP 429 failures. Only those fifteen failed requests
were retried; the final changed shortlists were separately measured. Seven-second spacing avoided further
failures. A runtime turn makes one eligible rerank attempt, not this evaluation matrix.

Decision: retain weak dense fusion and optional reranking, preserve the user's configured model, and expose
elapsed time/input estimates/provider usage in diagnostics. This sample does not justify forcing reranking
on or replacing the original-text retrieval architecture.

Local evidence: retrieval-gold.json, retrieval-final-candidates.json, retrieval-final-result.json and
the service caches under ignored remove/. Label spec SHA-256:
609ede1395a89f84ba9ad7b7466751db419459785859cddc67d9a21a53608f3e.
The scripts are committed; private source text and full responses are not.

## Earlier architecture experiments

The previous research diary mixed obsolete parameters with current facts. Git retains its complete text.
Use the durable decisions for earlier measurements:

- [ADR-0014](decisions/ADR-0014-the-slot-count-follows-the-budget.md) and
  [ADR-0021](decisions/ADR-0021-the-evidence-budget-reaches-more-messages.md): evidence slot budget.
- [ADR-0015](decisions/ADR-0015-the-dense-channel-gets-a-weak-vote.md): dense fusion weight.
- [ADR-0016](decisions/ADR-0016-the-rerank-stage-is-optional.md): the earlier 52-question rerank study,
  including its 87% result. That number is not the current story's acceptance result.
- [ADR-0019](decisions/ADR-0019-the-situation-gets-a-retrieval-channel.md) and
  [ADR-0020](decisions/ADR-0020-a-named-character-gets-their-description.md): situation and profile channels.
- [ADR-0022](decisions/ADR-0022-the-packer-never-quotes-the-same-text-twice.md): quotation deduplication.

Further ranking changes need fixed query classes and independent answer labels. More summaries or
more retrieval channels do not by themselves demonstrate improvement.
