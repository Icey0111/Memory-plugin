# ADR-0016: The rerank stage is optional, and off until a model is named

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

dev_docs/06_retrieval_research.md section 5 ordered five layers, cheapest first, and put the cross-encoder
last because it is the only one that costs a model call per generation. ADR-0015 shipped the dense fusion
weight and left the 12 remaining losses open: answers that are in the candidate list at every budget and
never rank into the selected slots. The layer list said the rerank was the way to attack exactly that.

The host's provider turned out to offer a rerank endpoint beside the embedding one, so the layer was
measured offline on the same 52 questions, reranking the fused top 24 - the shortlist the dense channel
already returns:

| configuration | answer-in-context | oblique | answer in top-2 | evidence |
| --- | --- | --- | --- | --- |
| weak dense, no rerank | 69% | 69% | 63% | 893 tokens |
| + jina-reranker-v3 | **87%** | 87% | 87% | 871 tokens |
| + jina-reranker-v2-base-multilingual | 81% | 80% | 79% | 890 tokens |

Paired against no rerank: v3 gains 10 questions and loses 1 (p=0.012); v2-multilingual gains 7 and loses 1
(p=0.070). Candidate coverage was already 98%, so the reranker is doing what the layer list predicted -
reordering candidates that retrieval found - and it closes most of the gap to the ceiling of 51 of 52.

## Decision

1. **A rerank stage exists and is switched on by a model name.** `narrative_rerank_model` empty means the
   stage does not run and no call is made, which is what every existing install keeps. Setting it to a
   model turns on one rerank call per generation over the fused shortlist (24 documents by default,
   `narrative_rerank_candidates`).
2. **It reuses the embedding connection's endpoint and key.** A reranker and an embedder behind one
   provider share a base URL and a credential; asking for a second one would be a second thing to keep in
   step with the first.
3. **It is fail-open, and it says so.** No model, no transport, or a failed call leaves the fused order
   exactly as it was and records `rerank_used: false` with `rerank_error` in the diagnostics. The stage sits
   between retrieval and packing, so a stage that can throw is a stage that can empty the prompt.
4. **Only candidates the provider actually scored are reordered.** An out-of-range index, a duplicate, or a
   non-numeric score is dropped rather than trusted, and an answer with no usable row is an error rather
   than an empty order.

## Consequences

- Answer-in-context on the measured set goes from 69% to 87%, at 22 fewer evidence tokens per query because
  the packer now spends its budget on better-ranked spans.
- The cost is one call per generation carrying the shortlist: about 19,000 tokens in the measurement, which
  is enough to hit a provider's per-minute rate limit but not its per-request one.
- The panel reports `rerank_used` and `rerank_error`, so a misconfigured install can be told apart from one
  that is simply not using the stage.
- Two negative results came out of the same round and are recorded rather than shipped: the entropy-adaptive
  half of layer 2 ties the single global weight it would replace, and query expansion loses 2 to 17 points in
  both its forms. dev_docs/06_retrieval_research.md section 14.

### What this does not fix

- **The live query is still not the measured query.** The offline runs ask the question; the live path asks
  with the last three messages. The reranker's gain is the largest measured here and the least verified
  live, so the setting is off by default rather than on.
- **One chat, two sets, one provider.** 52 and 40 questions on two chats, with one vendor's rerankers.
- **The remaining 6 of 52.** Reranking cannot recover an answer that retrieval never returned.