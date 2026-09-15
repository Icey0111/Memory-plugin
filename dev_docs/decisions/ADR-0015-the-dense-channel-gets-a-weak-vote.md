# ADR-0015: The dense channel gets a weak vote, not an equal one

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

ADR-0010 justified the dense channel and it was built, but its *weight* was never measured:
rankRawChunks fused the channels as 1/(60+rank+1) each, so a lexical hit at rank 0 and a dense hit at rank
0 counted the same. The offline A/B that ADR-0010 asked for could not be run without a backend; the host
turned out to have one configured (jina-embeddings-v5-text-small, 1024 dimensions, direct API), so it was
run: 52 questions against AetheriaS40.jsonl, the plugin's own chunk text and retrieval task, one cosine
rank per question, the same packer.

Dense alone reached **37%** answer-in-context against the lexical channel's **63%**. Fused at equal weight -
the shipped setting - the hybrid reached **56%**: worse than lexical alone. It raised candidate coverage
from 96% to 98% while *lowering* what survived into the prompt, which is the intervention result in
dev_docs/06_retrieval_research.md section 3B reproduced on our own data. A channel that is 26 points weaker
was being given an equal vote and used it to demote the strong channel's candidates.

Sweeping the weight:

| dense weight | answer-in-context | oblique |
| --- | --- | --- |
| 0 (lexical only) | 60% | 58% |
| **0.1** | **69%** | **69%** |
| 0.2 | 63% | 62% |
| 0.5 | 58% | 56% |
| 1.0 (what shipped) | 58% | 56% |

## Decision

1. **`DENSE_FUSION_WEIGHT = 0.1`, applied to the dense channel's RRF contribution.** `rankRawChunks` now
   takes `denseWeight`, `lexicalWeight` and `rrfK` instead of hardcoding an equal vote, and the default is
   the measured one. Zero still means lexical only, exactly.
2. **The evidence slot floor drops from 400 tokens to 333.** ADR-0014 derived one slot per 400 tokens from a
   measurement taken with the weak ranking this ADR corrects. With the better ranking a third slot earns
   its share at a 1000-token budget - 69% against 65% for two - so the shipped default is now three slots.
3. **Keep both knobs in the library, not in settings.** They are one decision each, measured once; a per-
   install dial would multiply the A/B surface without evidence that the optimum moves between installs.

## Consequences

- The shipped retrieval path, measured end to end: answer-in-context **56% -> 69%** (29 both, 0 lost, 7
  won, p=0.016), oblique **53% -> 69%**, span precision **14% -> 23%**, evidence **930 -> 893** tokens a
  query. The change is cheaper as well as better.
- The five questions the dense channel rescues are all oblique and all of the same shape: the question
  names the category and the passage names the instance ("那件器具的边缘刻着一圈什么" against "那是星辰仪，
  边缘一圈细细的星位刻痕"). That is the lexical gap ADR-0010 predicted, and it is now the only place dense
  earns anything.
- The ruler can reproduce it: `node recall-embed.mjs <chat> --questions <set> --out <cache>` builds the
  vector cache, and `--embeddings <cache> --dense-weight <w>` measures with it. The cache is keyed by the
  hash the archive already computes.

### What this does not fix

- **The 12 answers that are candidates and still lose.** At every budget from 600 to 2400 their span never
  ranks in the selected slots. Sorting out whether that is the ranker or the fusion is the next measurement,
  not this decision.
- **The measurement used the question as the query.** The live path queries with the last three messages of
  the chat. The weight optimises the question-shaped query, which is the dominant part of that tail but not
  all of it, so the live number needs confirming on a real turn.
- **One chat, 52 questions, one embedding model.** A different model with a different quality gap could move
  the optimum. The mechanism - do not give a much weaker channel an equal vote - is the durable part.
- **The first measurement of this was wrong in the other direction.** An earlier script embedded
  symmetrically and reported dense at 25%; the plugin already sends Jina its `retrieval.query` and
  `retrieval.passage` tasks (buildDirectEmbeddingBody), and with the task the channel measures 37%. The
  measurement was fixed, not the plugin.