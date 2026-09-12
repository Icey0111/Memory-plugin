# Retrieval Research: Hybrid Comparison Beyond Entropy

**Status: all five layers are measured. Layers 1, 3 and the rerank ship, the dense half of 2 ships, and the adaptive half of 2 and expansion are rejected on measurement. ADR-0014, ADR-0015 and ADR-0016 record the decisions.** - an ADR is
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

### 8. What the A/B measured (2026-09-12)

The ruler now records, per question, the lexical and the fused entropy and top-1/top-2 margin, the
answer's rank, which rule dropped it and which quoted slot carried it; it can dump a run and compare two
dumps as paired questions with an exact McNemar test. The question set was rebuilt for one chat: 52
countable questions against AetheriaS40.jsonl, 7 entity and 45 oblique, every needle unique **inside that
chat** and contained in a single chunk. The old 12-question denominator is not comparable to this one - it
called a needle ambiguous when the duplicate was in a different chat, which is not what the needle is for.

| scorer / packer | answer-in-context | entity | oblique | span precision | evidence |
| --- | --- | --- | --- | --- | --- |
| idf / greedy (what ships) | 63% | 71% | 62% | 16% | 932 tokens |
| bm25 / greedy | 62% | 71% | 60% | 15% | 932 tokens |
| idf / submodular | 54% | 86% | 49% | 16% | 875 tokens |
| bm25 / submodular | 54% | 86% | 49% | 16% | 880 tokens |
| idf / relevance (regularisers bounded to 0.05) | 54% | 86% | 49% | 16% | 887 tokens |
| bm25 / relevance | 46% | 71% | 42% | 14% | 890 tokens |

**Layer 1, BM25: recall-neutral, cheaper on cut-out queries.** Paired, 32 questions both, 1 only idf, 0
only bm25, p=1.0: the scorer changes nothing about which answers survive. On the probe set, whose queries
are cut out of the answer, it is 100% recall at 737 tokens a query against 904, an 18% saving. That saving
is the entire case for it, and the honest summary is that layer 1 bought cost, not recall.

**Layer 3, submodular packing: does not win.** 54% against 62%, with 7 questions only greedy and 3 only
submodular, p=0.34 - a trend against it that 52 questions cannot resolve either way. It is cheaper (880
against 932 tokens) and it lifts entity questions from 71% to 86% while dropping oblique from 60% to 49%.
Section 6's rule is that a layer must win on recall or precision at equal or lower token cost. This one
loses the headline and trades one question class for another, so it is not the default and no ADR is
written. It stays behind the --pack switch as a measured alternative, because the entity result is real.

**The relevance-led variant is not a safer version of layer 3.** Bounding the three structural terms to
0.05 leaves relevance in charge, which is what section 7 asks for. Under bm25 it is the worst of the six
at 46%, losing 10 oblique questions against 2 (p=0.04); under idf it ties submodular at 54%. A rule the
scorer does not touch should not move nine points between the two scorers, and that spread is the clearest
statement of how much of the ordering below the top two rows is churn at n=52.

### 9. Three implementation faults that looked like the method losing

The first port of the published objective scored 17% against the baseline's 63%. Three of the four causes
were mine, and they are worth knowing before anyone ports this again:

1. **Relevance was fed the fused RRF score.** Every RRF margin measured 0.02, so the relevance term was a
   constant and coverage and diversity decided everything - exactly the failure section 7 warns about.
   Feeding relevance from the channels took it from 17% to 23%.
2. **rel was then still divided by the fused top.** RRF tops out near 1/61, so every relevance came out
   around 61 and the per-token ratio stopped meaning anything: 23% to 38% by removing the division.
3. **Cost was the whole merged envelope.** A per-token rule then rewarded short messages: an answer inside
   a long message was outbid by an 80-token scrap from elsewhere. Charging the minimal quote instead took
   it from 38% to 54%.

The fourth was the method. Cost-scaled greedy is for a knapsack where the budget binds; here the snippet
cap binds first (four slots, about 1000 tokens, about 250 a slot), and selecting by marginal gain with the
budget as a feasibility constraint is what the table above reports.

### 10. What the ruler found on its own

- **A fused RRF distribution cannot carry a confidence signal.** Margin measured 0.02 and entropy 0.99-1.00
  on every question, hits and misses alike. Any entropy or margin rule has to read a channel.
- **The lexical channel does separate hits from misses**: median margin 0.34 against 0.18, entropy 0.91
  against 0.92. Margin moves and entropy barely does, which is TARG's finding reproduced on story text.
- **Two answers are unreachable**: the needle is in the archive but no chunk containing it is ever a
  candidate (not_a_candidate 2).
- **Twelve are candidates the four slots discard** (entry_cap 12) and **six sit inside a quoted span whose
  quoted range stops short** (trimmed_out 6). A member-first absorption rule was written for the second
  group, changed no outcome at all - the outward growth already fills whatever budget it is given, so the
  per-entry share is what binds - and was reverted rather than shipped.

### 11. What is left

Layer 2 (entropy and margin informed fusion) needs a second channel to fuse; the ruler records both
readings now, so it is a before/after once a backend is configured. Layer 4 (capsule-guided expansion) and
layer 5 (cross-encoder rerank) are untouched. The two structural facts are unchanged by everything above:
the answer is almost always in the candidates, and the four slots are the bottleneck.

### 12. The budget sweep, and the slot count it decides (ADR-0014)

The ruler can pin the evidence budget and the slot count separately now, so both were swept on the same 52
questions. Two mechanisms fell out, and together they make the slot count a function of the budget rather
than a constant:

- A share below about 400 tokens cannot cover a merged envelope. Chunks of one message merge into a span of
  900-1500 characters, and a 250-token share quotes a quarter of it.
- A share above about 500 tokens buys nothing: recall stops moving once the share covers the envelope.

With the share pinned at what it needs, recall tracks the slots and precision runs the other way:

| budget | slots | answer-in-context | span precision | evidence |
| --- | --- | --- | --- | --- |
| 1000 | 2 | 63% | 32% | 886 tokens |
| 1200 | 3 | 63% | 21% | 1075 tokens |
| 1600 | 4 | 69% | 17% | 1437 tokens |
| 2000 | 5 | 71% | 14% | 1777 tokens |
| 2400 | 6 | 75% | 13% | 2108 tokens |

The shipped configuration was four slots at 1000 tokens: 62%, 15% precision, 932 tokens. Two slots at the
same budget is better on every axis - 63%, 32%, 886 - and the paired recall difference is not resolvable on
its own (4 against 3, p=1.0), so the case rests on precision and cost. evidenceSlots(maxTokens) now returns
one slot per 400 tokens, minimum one and maximum six, and an explicit slot count still overrides it.
ADR-0014.

Three things this settles. **The slot count had never been measured** - ADR-0006 fixed the merging, the
shares and the trimming and left the number at four. **Raising the budget used to do nothing structural:**
it made the same four quotations longer, and the frontier above is what the setting should have been buying.
**And the 12 remaining losses are not packing losses**: at every budget from 600 to 2400 the answer was in
the candidate list and outside the slots because its span never ranked in the top slots. That is the ranking
problem layers 2, 4 and 5 exist for.

Three allocation rules were also tried inside the old four-slot shape, and all three measured as washes:
absorbing a merged span's other members (no outcome changed), letting a span claim one share per member
(recall 62% -> 63%, but 12 answers moved from entry_cap to unquotable), and adding a minimum-quote guard to
that (63%, precision 20%, +3% tokens). Each repaired the defect it targeted and converted it into another,
because four slots of 250 tokens is the entire budget. They are recorded here so the next session does not
re-derive them: within a fixed four-slot shape the allocation arithmetic has no room to matter.

**Amended by section 13 and ADR-0015:** the 400-token floor above was measured with the weak ranking, and
the floor is 333 now that the fusion weight is corrected.

### 13. The dense A/B, run on the configured backend (ADR-0015)

Section 11 said layer 2 needed a configured backend. The host already had one - jina-embeddings-v5-text-small,
1024 dimensions, direct API - so the A/B ran offline on the same 52 questions, with the plugin's own chunk
text and its own retrieval task. recall-embed.mjs builds the vector cache the ruler reads.

| configuration | answer-in-context | oblique | span precision | evidence |
| --- | --- | --- | --- | --- |
| lexical only | 60% | 58% | 20% | 887 tokens |
| dense only | 37% | 31% | - | 884 tokens |
| equal-weight RRF, four slots (what shipped) | 56% | 53% | 14% | 930 tokens |
| **weak dense (0.1), three slots** | **69%** | **69%** | **23%** | **893 tokens** |

The weight curve is monotone and the shipped setting was its worst point: 0 -> 60%, 0.1 -> 69%, 0.2 -> 63%,
0.5 -> 58%, 1.0 -> 58%. Paired against the shipped configuration the change is 29 both, 0 lost, **7 won,
p=0.016** - the first statistically resolvable retrieval result in this document.

The mechanism is section 3B's intervention result on our own data. Dense alone is 26 points weaker than
lexical, and at equal weight it *raised* candidate coverage from 96% to 98% while *lowering* what survived
into the prompt from 63% to 58%: a weak channel with an equal vote spends it demoting the strong channel's
candidates. Give it a weak vote and the recall it adds survives without the reordering - the five questions
it rescues are all oblique and all of the same shape, a question naming the category against a passage naming
the instance.

**One earlier claim in this project was wrong and is retracted here.** A first pass reported that the plugin
embeds symmetrically and therefore wastes Jina's retrieval tasks. It does not: buildDirectEmbeddingBody has
sent retrieval.query and retrieval.passage for Jina all along. The 25% dense figure came from the measuring
script, not the plugin; with the task it is 37%. Same lesson as section 9, in the other direction - read the
code before believing your own instrument.

The slot floor moves with it. ADR-0014 derived one slot per 400 tokens under the weak ranking; with the
corrected fusion a third slot earns its share at 1000 tokens (69% against 65% for two), so the floor is 333.
What is left is the 12 answers that are candidates at every budget and still lose: their span never ranks in
the selected slots. Whether that is the ranker or the fusion is the next measurement.

### 14. Layers 2, 4 and 5, each measured to a decision (ADR-0016)

**Layer 2's adaptive half: measured and rejected.** The proposal was to set the lexical-to-dense weight per
query from the channels' own margin and entropy. Bucketing the 52 questions by lexical margin (17 / 17 / 18)
the optimum does vary - 0.1 / 0.05 / 0 - but taking each bucket's optimum scores **69%**, exactly what the
single global weight scores. There is nothing for a gate to fix: at 0.1 the dense channel costs zero losses,
so the whole upside is already captured. The dense channel rescues five questions, all in the low and middle
margin halves (median margin 0.206 against 0.271 overall), which is the signal working - it just does not pay
to act on it. The slot half is contradicted as well: widening to six slots at a fixed budget is worse in every
bucket, because the share is what a merged envelope needs, and entropy did not separate the questions that
wanted more room (median 0.947 against a 0.904 mean).

**Layer 4, capsule-guided expansion: measured and rejected, twice.**

| test | set | result |
| --- | --- | --- |
| expand from the first pass' own terms (PRF) | 52 questions | 69% -> **52%**, 9 lost, 0 won, p=0.004 |
| expand only with terms the capsule also knows | 40 questions | 68% -> **63%**, 2 lost, 0 won |
| the same over lexical only | 40 questions | 60% -> **55%**, 2 lost, 0 won |

The reason is measurable rather than mysterious: **none** of the 40 answer chunks has half of its rare terms
already in the capsule. The added terms are the story's own words, but never the answer's, so expansion
dilutes a query that was already carrying enough to find the chunk (candidate hit 96%). A capsule can say
what the story is about; it cannot say what a passage says.

That test needed a chat that has a capsule, and the 52-question set is written against one that has none -
`AetheriaS40` carries the old fact keys and no summary or anchors at all. A second set was written for the
only chat that does, the 40-floor acceptance run: 40 countable questions, every needle unique inside that chat
and inside one chunk, lexical baseline 60% and the shipped weak-dense path 68%. It is in
`remove/_paraphrases3.json` beside the first, and the dense A/B on it agrees with the 52-question result.

**Layer 5, cross-encoder rerank: measured and shipped, behind a model name.**

| configuration | answer-in-context | oblique | answer in top-2 | evidence |
| --- | --- | --- | --- | --- |
| weak dense, no rerank | 69% | 69% | 63% | 893 tokens |
| + jina-reranker-v3 | **87%** | 87% | 87% | 871 tokens |
| + jina-reranker-v2-base-multilingual | 81% | 80% | 79% | 890 tokens |

Paired against no rerank: v3 gains 10 and loses 1 (p=0.012), v2-multilingual gains 7 and loses 1 (p=0.070).
The stage reranks the fused top 24 - the shortlist the dense channel already returns - so it can only reorder
candidates retrieval found, and it is fail-open: no model, no transport or a failed call leaves the fused
order untouched and records why. It is one call per generation over 24 documents, which is what the doc
called the highest cost, and it is off until a model name is configured. v55-rerank.js, ADR-0016.

With that, every layer in section 5 is measured: two shipped, one shipped in half, two rejected. The 12
answers that no budget reaches were the ranking gap, and a cross-encoder closes most of it - 87% is 45 of 52,
against a candidate ceiling of 51 of 52.
