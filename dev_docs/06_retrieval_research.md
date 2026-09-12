# Retrieval Research: Hybrid Comparison Beyond Entropy

<!-- Versioned & append-only: never edit past versions; newest is last. -->

<!-- VERSION 1 -->
## v1 - 2026-09-12 20:12:52 - survey what pairs with entropy in hybrid retrieval, and the plan that follows

**Status: research note + proposed plan. Nothing here is implemented, and no ADR exists yet** - an ADR is
written when a layer wins its A/B (section 6). This file exists so the next session starts from the
conclusion instead of re-reading the discussion.

### 1. What our own measurements already settle

| Fact | Number | Source |
| --- | --- | --- |
| The answer is in the candidate list | candidate hit ~100% on measurable probes | ADR-0006, ADR-0010 |
| The answer survives into the packed context | **45%** oblique (offline, n=11); **42%** (live, 12 questions on the 40-floor acceptance run) | ADR-0006, change log 2026-09-12 |
| Quoted spans that carry the answer (precision proxy) | **15%** (6/40) | ADR-0010 |
| Evidence budget | 4 spans, ~890 tokens per turn | narrative defaults |
| Candidates per turn (live) | 39 lexical + 24 dense | acceptance run |
| Failure shape | answer at rank 2/3/5/8/10/24, or never a candidate; the four-slot budget keeps the wrong four | acceptance run |

Three defects in the current scorer and packer, read off the source (raw-history.js):

1. The lexical score is a plain binary IDF sum - sum over query terms of log(1 + N/(1+df)) - with **no
   length normalisation and no term-frequency saturation**, so long chunks win by accumulation.
2. Fusion is **pure RRF** (1/(60+rank+1)), which throws away score magnitude: a confident channel and a
   weak one rank equally.
3. Packing is **greedy with an equal per-entry share** (~250 tokens each), which is the paper's own
   baseline heuristic ("Rel only").

### 2. What the earlier in-project work settled (do not redo it)

From the retired 21_memory_thesis.md (now under remove/remove_2026_09_12_18_11_39_consolidate_the_dev_docs_set/):

- **H1 refuted by measurement**: an IDF gate does *not* find long-range detail better than a frequency
  gate (n=19 attention events; frequency at least as good at every budget, clearly better at B=2/B=4).
- The role split that survived: **frequency answers "who will matter again" (salience); IDF answers
  "which token is a distinctive key" (matching)**. Design: frequency for the gate, IDF for the key.
- **IDF's failure mode, measured**: it promotes imported setting vocabulary (road permits, ash-fever
  terms, the pocket watch, Eldoria). Any IDF-as-key design needs a relevance filter.
- **H3 (entity-distribution entropy jumps as plot boundaries) is still untested.** It is a write-side
  question (when to summarise), not a retrieval one - keep it out of retrieval A/Bs.

### 3. What the literature offers (four families)

**A. Entropy as a channel/budget regulator, beside the hybrid scores.**

- *Entropy-Based Dynamic Hybrid Retrieval for Adaptive Query Weighting in RAG Pipelines* (Perez & Zhou,
  OpenReview): query-side entropy sets the sparse/dense weights per query instead of globally.
  (PDF sits behind Cloudflare; title and abstract only were verifiable.)
- *L-RAG: Balancing Context and Retrieval with Entropy-Based Lazy Loading* (arXiv 2601.06551): two tiers -
  a compact summary first, expensive chunk retrieval only when the model's predictive entropy crosses a
  calibrated threshold. tau=0.5 gives 78.2% against 77.8% for standard RAG at 8% fewer retrievals;
  tau=1.0 gives 26% fewer at 76.0%; saves 80-210 ms per query.
- *TARG: Retrieval as a Decision* (TMLR 2026): a training-free gate from the no-context draft's prefix
  logits - mean token entropy, the top-1/top-2 margin, or small-N variance. Cuts retrieval 70-90% at
  equal or better EM/F1. **Its central finding: under instruction-tuned models the margin signal is more
  discriminative than entropy.**

**B. Information-theoretic set selection under a budget - the strict form of "entropy + hybrid".**

*Recall Is Not Enough / What Survives Into Context* (arXiv 2607.00725; code at
github.com/nayanananto/Diagnostic-for-Budget-Constrained-Multi-Hop-RAG):

- The diagnostic is **answer-in-context** - does the gold answer survive into the *packed* context. It
  carries an extra R^2 of 0.17-0.27 beyond recall@k, and among questions where all gold was retrieved,
  whether packing keeps the answer separates exact match by **4.6x**.
- Two interventions: raising document coverage **without** raising answer-in-context leaves accuracy
  flat; prompt compression that destroys the answer span lowers both.
- Method - budgeted submodular evidence packing. Maximise

      F(S) = w_rel*Rel(S) + w_qry*QueryCov(S) + w_cov*Repr(S) + w_div*Div(S),  cost(S) <= B, snippet cap

  where Rel is per-snippet relevance (modular), QueryCov is a set cover over distinct query content
  terms, Repr is a **saturated facility location** (sum over candidates i of min(sum over chosen j of
  sim(i,j), alpha*deg_i)), and Div is concave over documents (sum over documents d of the square root of
  the relevance mass of S in d). Weights 1.0 / 0.5 / 0.4 / 0.3, alpha = 0.3. Algorithm: **cost-scaled
  greedy** (largest marginal gain per token) plus the Lin-Bilmes singleton fallback. The contribution is
  the objective and the controlled evaluation, not the optimiser.
- Same family: InSQuAD (submodular mutual information for quality and diversity), DRAG.

**C. Production two-stage.** ZeroEntropy with turbopuffer: BM25 + ANN + RRF to retrieve, a cross-encoder
to rerank. Fusion practice: normalised weighted sum, union, or RRF; RRF is rank-only and scale-free and
is the safe default; **tune fusion per query class and score it per class**, because a global average
hides a class that regressed.

**D. Compression side.** LLMLingua prunes tokens by perplexity with a budget controller; ConStory-Bench
finds consistency errors concentrate in high token-entropy spans. Relevant to the summary/evidence
budget split, not to ranking.

### 4. Symptom to mechanism

| Our measured symptom | The literature's term |
| --- | --- |
| Candidate hit ~100% but packed recall 45% | the recall versus answer-in-context gap (B) |
| Four slots, ~250 tokens each, chosen greedily | the "focused heuristic" baseline that (B) beats |
| Span precision 15% | (B)'s warning: coverage up without answer-in-context up changes nothing |
| No k1/b, no saturation | BM25's length normalisation and saturation |
| Pure RRF | the fusion taxonomy in (C): rank-only is a default, not a policy |
| Questions that do not contain the story's names | QueryCov / capsule-guided expansion |
| Answer at rank 10-24 | Repr's saturated coverage is what pulls candidate mass into the budget |

### 5. Proposed layers (each testable alone, cheapest first)

1. **Score quality.** Replace the lexical score with BM25 (k1 = 1.2, b = 0.75); keep both channels' raw
   scores, not only their ranks.
2. **Entropy-informed fusion.** Per query compute each channel's normalised score entropy and the
   top-1/top-2 margin, then set the lexical-to-dense weight from **margin first, entropy second**
   (TARG's finding). High entropy (a flat distribution) means a vague question: widen candidates and
   slots. Low entropy means take the few top spans.
3. **Submodular packing.** Replace greedy plus equal share with F(S) above, cost-scaled greedy,
   singleton fallback. Highest expected value: it optimises answer-in-context directly, offline, with no
   model call.
4. **Capsule-guided expansion.** When the question names none of the story's entities, expand or filter
   with the summary's and anchors' entities. Expressible as an entity term inside QueryCov.
5. **Cross-encoder rerank.** Only after 1-4; one model call per turn, the highest cost.

### 6. How to decide

Extend the ruler before changing any behaviour:

1. Per question, record **entropy / margin / both channel scores / the answer's rank / which rule dropped
   it / which of the four slots carried it**.
2. A/B each layer on the same question set, comparing **answer-in-context recall, span precision (15%
   today) and tokens per turn**. A layer must win on recall or precision at equal or lower token cost.
3. **Grow the countable set from 12 to 30-50 before believing any comparison**: going from 6 to 12 moved
   oblique recall from 67% to 45%.

### 7. Two warnings to carry into the work

- **Coverage alone does not help** - only answer-in-context does (B's intervention). Diversity and
  coverage are regularisers; relevance leads.
- **Entropy alone is weaker than margin** under instruction-tuned models (TARG). Use the pair.
