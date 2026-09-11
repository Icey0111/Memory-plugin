# AI Roleplay Memory Methodology

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

## v1 - 2026-09-11 22:05:00 - derive memory design from the roleplay problem rather than from human memory

### 0. Why this document exists

The project owner concluded that an AI-roleplay memory system must not be modelled on
human memory: human memory is reconstructive, lossy and adaptive, while a roleplay
world must stay consistent. This document checks that claim against the literature and
derives a methodology from the roleplay problem itself.

Evidence is labelled: **[measured]** = a number or result reported in a source,
**[claim]** = a design assertion by an author, **[derived]** = this document's own
reasoning. Nothing here is presented as measured unless a source reports it.

### 1. What the field actually does

The field has already split, and the split runs exactly along the line the owner
identified. Human-memory-inspired designs dominate *agent* memory; designs derived from
the *roleplay* problem are event-, state- and causality-shaped.

| System | Unit of memory | Mechanism | Lineage |
|---|---|---|---|
| Generative Agents (Park et al. 2023) | observation sentence | memory stream scored by recency + importance + relevance, retrieved top-k | human analogy: salience-weighted recall |
| MemGPT / Letta | paged context block | OS-style paging between a main context and external storage | systems analogy |
| Mem0 | extracted fact | LLM writes facts, vector search reads them | engineering |
| A-MEM | linked note | Zettelkasten-style note graph | knowledge-management analogy |
| HippoRAG | passage | hippocampal-index analogy, personalised PageRank over an entity graph | explicitly brain-derived |
| **DREAM** (arXiv 2608.05170) | **event** | Event-aware Memory Graph: temporally ordered, causally linked events; roles and events as nodes; entity resolution consolidates recurring entities | **roleplay-derived** |
| **PHASE-Tree** (arXiv 2608.06975) | **character state** | state tree; intra-scene state tracking; cross-episode persona evolution | **roleplay-derived** |
| **FictionRAG** (Algorithms 19(5):383) | narrative state | "stateful metacognitive framework" for long-narrative roleplay | **roleplay-derived** |
| SillyTavern World Info | lorebook entry | entry = keys + content + configuration; recent chat is scanned, matching entries activate, a token budget is allocated, and each entry is placed at a position/depth | front-end engineering |

Two structural facts from the taxonomy survey (arXiv 2505.00675, **[claim]**):
memory is either **parametric** (implicit in model weights) or **contextual** (explicit
external data), and it is governed by six operations: **Consolidation, Updating,
Indexing, Forgetting, Retrieval, Condensation**.

DREAM's own problem statement is the clearest published statement of the failure mode
this project keeps hitting **[claim]**: prior methods "suffer from fragmented memory
organization, limited interpretability, and a lack of explicit inter-event causal
structure, resulting in largely static character representations".

Evaluation in this sub-field is also not recall-based: DREAM proposes the **Temporal
Causal Memory** benchmark for "temporal consistency and long-range causal narrative
coherence"; **BeliefShift** benchmarks temporal belief consistency and opinion drift;
**CoSER** judges simulated conversations with a model critic across four dimensions;
and ACL 2026 has a paper titled **"Beyond Static Persona Consistency: Dynamic Persona
Coherence in LLM Role-Playing"**.

### 2. Where the human analogy breaks

| Dimension | Human memory | AI roleplay memory |
|---|---|---|
| Substrate | synapses that change with use | **weights are frozen for the whole chat** |
| What memory is | a change in the network | a decision about **what enters the context window** |
| Ground truth | none; reconstruction is all there is | **the transcript exists and is authoritative** |
| Learning | continuous, unsupervised | none inside a session |
| Forgetting | adaptive; necessary | **always a defect** - it breaks canon |
| Error mode | distortion, confabulation | contradiction, omission, persona drift |
| Variability | acceptable | a bug: the same state must yield the same behaviour |
| Cost | free | hard budget: tokens, money, latency |
| Consumer | the same agent | a **persona simulator** that must stay in character |
| Unit | association | **a claim about the world** with a validity interval |

**[derived]** The decisive row is ground truth. Because the transcript is a complete log,
memory does not have to *be* the store of the past - it can be a *projection* of the log.
Human memory has no such option, which is why it must be reconstructive. Copying the
reconstructive design into a system that owns a perfect log imports the loss without
inheriting the reason for it.

**[derived]** The second decisive row is the frozen substrate. The survey's parametric
half does not exist for us: nothing is written into the weights during a chat. RP memory
is therefore *entirely* contextual, and "memory" is not a storage faculty at all. It is
**state reconciliation plus context construction under a hard budget, with a consistency
contract**. The word "memory" is what dragged the brain analogy in.

### 3. What is worth keeping from the brain

Only two ideas survive the transfer test.

1. **Index is not store.** The hippocampal-index account separates a small pointer
   structure from a large distributed store. In RP this becomes the evidence pointer: keep
   compact addresses that can be resolved back into the transcript on demand, instead of
   holding original text in the prompt. Directly useful and cheap.
2. **Consolidation, with a preservation criterion.** Offline consolidation is real, but
   the human version ("replay teaches the cortex") requires plastic weights. In RP the
   only defensible criterion is **information preservation**: a consolidation step may
   replace material with a shorter form *only if* the shorter form answers every future
   query the longer form could answer. **[derived]** That is a testable criterion, whereas
   "condense what matters" is not.

Everything else - reconstructive recall, forgetting as a feature, emotional weighting as
the primary salience signal, distributed traces - does not transfer.

### 4. The methodology

**P1. The transcript is the log of record; memory is a materialised view.**
Nothing may exist only in a summary. Every memory row must be derivable from, and
traceable to, transcript positions. Consequence: replay must reproduce state exactly;
writes must be idempotent; a corrupted projection is always rebuildable.

**P2. Forgetting must be provably lossless for the fiction.**
A row may be dropped only when it cannot be referenced again, i.e. when nothing that
survives depends on it and no replay would resurrect a question it answers. Irreversible
facts (promises, deaths, ownership transfers, first meetings, disclosures) form an
immutable residue that is never compacted away. **[derived]** This is a compaction
correctness rule, not a salience heuristic.

**P3. The unit is an event or a claim, not a text chunk.**
Similarity of prose is the wrong primitive, because the consumer needs validity and
causality, not topical relatedness. Events carry: participants, place, time, the state
delta they caused, and the claims they established or retired.

**P4. Separate the invariant from the evolving.**
Two stores with different laws: **canon** (persona, world rules, established traits) is
append-only and rarely changes; **state** (location, possessions, relationships,
knowledge) is versioned and superseded. DREAM's "dual-granularity" profile says the same
thing **[claim]**. Mixing them is the disease; a character profile that silently mixes
stable traits with recent events drifts.

**P5. The acceptance metric is consistency, not recall.**
Measure: canon-violation rate, temporal-order errors, causal-coherence breaks, persona
drift, epistemic leaks. "Did we retrieve the right chunk" is an implementation detail and
must not be the headline number.

**P6. History is not context.**
Context is a *rendering for one generation*; state is what persists. Conflating "what we
know" with "what fits" is the failure the Mem0 essay calls treating the context window as
storage rather than RAM **[claim]**.

**P7. Determinism is a design requirement.**
A projection that cannot be recomputed identically cannot be tested, diffed, or debugged.
Given a fixed log and version, the projection must be byte-identical.

**P8. Cost is first-class and has no human analogue.**
Budget the projection explicitly by a declared precedence, and make compression
budget-driven rather than salience-driven. **[derived]** A compression step that never
fires because a heuristic threshold is never crossed is a bug, not a saving.

**P9. The consumer is a persona, not an oracle.**
The character may only act on what the character experienced. Epistemic status - who
knows what, who was told, who only suspects - is a first-class field. **[derived]** An
omniscient memory block breaks the fiction even when every statement in it is true. This
requirement has no RAG analogue and no human-memory analogue; it is specific to roleplay,
and it is the one this project currently fails hardest (measured earlier in
`07_functional_check.md`: the who-knows relation is emitted for 0.0% of memories).

**P10. Time is the primary axis.**
"Now" and "then" must be distinct query classes, not different ranks of one similarity
score. Every claim needs a validity interval and a supersession chain; retire, never
overwrite.

### 5. Four query classes, and why similarity serves only one

| The player or character asks | Correct primitive | Similarity retrieval |
|---|---|---|
| What is true now? | keyed lookup on a slot with validity | wrong tool |
| Why is the world like this? | causal chain over events / supersession history | wrong tool |
| What was promised or is irreversible? | typed assertion + irreversibility rank | wrong tool |
| Who knows what? | epistemic scope filter | wrong tool |
| What was it like / remind me of the mood | topical similarity | right tool |

**[derived]** Three of the four questions that matter in long roleplay are not similarity
questions, yet a vector index over prose answers only the fifth. This is the strongest
argument that the current design treats the problem as retrieval when it is state
management.

### 6. The consistency contract

A roleplay memory system is correct when, across a long session:

1. No statement in the projection contradicts the canon or a surviving claim.
2. Every surviving claim has a traceable origin in the transcript.
3. Retired values remain available for "it used to be" questions.
4. A character never acts on knowledge the character did not acquire.
5. Reconstruction from the transcript reproduces the projection exactly.
6. The projection fits the declared budget at every turn.

Items 1-4 are quality; 5-6 are mechanism. Both must be instrumented, because a green
retrieval metric says nothing about any of them.

### 7. What this implies for the current implementation

| Element today | Verdict |
|---|---|
| Deterministic spine of change records | fits P1, P4, P10 - keep and extend |
| Slots with supersession and retained previous values | fits P3, P10 |
| Irreversibility ranking that protects a residue | fits P2 - this is the "generativity" idea, correctly read |
| Reconstructability-driven eviction | fits P2 - and is the one place the generative criterion is already operational |
| Vector space over prose as the primary recall path | fits only query class 5; the other four need keyed, causal and epistemic channels |
| Summaries that are injected but never embedded | fits P6 but leaves them unverifiable against P1 unless every row traces to transcript spans |
| who-knows-what | fails P9 outright; measured at 0.0% emission |
| Consistency instrument as the headline metric | missing; current metrics are coverage and retention |

### 8. What the literature does not settle

- Whether an explicit causal edge is worth its cost versus reconstructing causality from
  the supersession chain at read time. DREAM asserts the graph wins **[claim]**; no
  independent replication was found.
- Whether per-character state trees (PHASE-Tree) beat a flat supersession chain for a
  two-party roleplay, where the tree is nearly a line.
- How to measure persona drift without a model critic, which makes the metric expensive
  and hard to compare across runs.
- No source found that reports a cost-per-turn budget for any of these systems, so the
  economics of RP memory remain unmeasured in the literature.

### Sources

- Rethinking Memory in LLM based Agents: Representations, Operations, and Emerging Topics - <https://arxiv.org/abs/2505.00675>
- DREAM: LLM-based Dynamic Role-playing via Event-Aware Memory Graph - <https://arxiv.org/html/2608.05170v1>, <https://dl.acm.org/doi/10.1145/3770855.3818027>
- PHASE-Tree: Modeling Character-State Evolution in Long-Horizon Role-Playing Dialogue - <https://arxiv.org/html/2608.06975v1>
- FictionRAG: A Stateful Metacognitive Framework for High-Fidelity Long-Narrative Role-Playing - <https://doi.org/10.3390/a19050383>
- Is Agent Memory a Database? Rethinking Data Foundations for Long-Term AI Agent Memory - <https://arxiv.org/abs/2605.26252>
- BeliefShift: Benchmarking Temporal Belief Consistency and Opinion Drift in LLM Agents - <https://www.semanticscholar.org/paper/e5825f8523abd13e93fab0786e5ecdb1a4dc0580>
- Beyond Static Persona Consistency: Dynamic Persona Coherence in LLM Role-Playing - <https://aclanthology.org/2026.acl-long.1336/>
- CoSER: Coordinating LLM-Based Persona Simulation of Established Roles - <https://icml.cc/virtual/2025/poster/46115>
- BRIDGE: Triangular Fixed-Point Refinement for Long-Horizon Persona Consistency - <https://github.com/Sunrich-HT/BRIDGE>
- SillyTavern World Info (keys, content, budget, position) - <https://docs.sillytavern.app/usage/worldinfo> and <https://deepwiki.com/SillyTavern/SillyTavern/6.1-world-info-system>
- Mem0: the context window is RAM, not storage - <https://mem0.ai/blog/context-window-is-ram-not-storage-why-most-agent-failures-happen-how-to-fix-them-in-2026>


<!-- VERSION 2 -->
## v2 - 2026-09-11 21:37:36 - reconcile the derived methodology with the recovered original AIRP design

## v1 - 2026-09-11 22:05:00 - derive memory design from the roleplay problem rather than from human memory

### 0. Why this document exists

The project owner concluded that an AI-roleplay memory system must not be modelled on
human memory: human memory is reconstructive, lossy and adaptive, while a roleplay
world must stay consistent. This document checks that claim against the literature and
derives a methodology from the roleplay problem itself.

Evidence is labelled: **[measured]** = a number or result reported in a source,
**[claim]** = a design assertion by an author, **[derived]** = this document's own
reasoning. Nothing here is presented as measured unless a source reports it.

### 1. What the field actually does

The field has already split, and the split runs exactly along the line the owner
identified. Human-memory-inspired designs dominate *agent* memory; designs derived from
the *roleplay* problem are event-, state- and causality-shaped.

| System | Unit of memory | Mechanism | Lineage |
|---|---|---|---|
| Generative Agents (Park et al. 2023) | observation sentence | memory stream scored by recency + importance + relevance, retrieved top-k | human analogy: salience-weighted recall |
| MemGPT / Letta | paged context block | OS-style paging between a main context and external storage | systems analogy |
| Mem0 | extracted fact | LLM writes facts, vector search reads them | engineering |
| A-MEM | linked note | Zettelkasten-style note graph | knowledge-management analogy |
| HippoRAG | passage | hippocampal-index analogy, personalised PageRank over an entity graph | explicitly brain-derived |
| **DREAM** (arXiv 2608.05170) | **event** | Event-aware Memory Graph: temporally ordered, causally linked events; roles and events as nodes; entity resolution consolidates recurring entities | **roleplay-derived** |
| **PHASE-Tree** (arXiv 2608.06975) | **character state** | state tree; intra-scene state tracking; cross-episode persona evolution | **roleplay-derived** |
| **FictionRAG** (Algorithms 19(5):383) | narrative state | "stateful metacognitive framework" for long-narrative roleplay | **roleplay-derived** |
| SillyTavern World Info | lorebook entry | entry = keys + content + configuration; recent chat is scanned, matching entries activate, a token budget is allocated, and each entry is placed at a position/depth | front-end engineering |

Two structural facts from the taxonomy survey (arXiv 2505.00675, **[claim]**):
memory is either **parametric** (implicit in model weights) or **contextual** (explicit
external data), and it is governed by six operations: **Consolidation, Updating,
Indexing, Forgetting, Retrieval, Condensation**.

DREAM's own problem statement is the clearest published statement of the failure mode
this project keeps hitting **[claim]**: prior methods "suffer from fragmented memory
organization, limited interpretability, and a lack of explicit inter-event causal
structure, resulting in largely static character representations".

Evaluation in this sub-field is also not recall-based: DREAM proposes the **Temporal
Causal Memory** benchmark for "temporal consistency and long-range causal narrative
coherence"; **BeliefShift** benchmarks temporal belief consistency and opinion drift;
**CoSER** judges simulated conversations with a model critic across four dimensions;
and ACL 2026 has a paper titled **"Beyond Static Persona Consistency: Dynamic Persona
Coherence in LLM Role-Playing"**.

### 2. Where the human analogy breaks

| Dimension | Human memory | AI roleplay memory |
|---|---|---|
| Substrate | synapses that change with use | **weights are frozen for the whole chat** |
| What memory is | a change in the network | a decision about **what enters the context window** |
| Ground truth | none; reconstruction is all there is | **the transcript exists and is authoritative** |
| Learning | continuous, unsupervised | none inside a session |
| Forgetting | adaptive; necessary | **always a defect** - it breaks canon |
| Error mode | distortion, confabulation | contradiction, omission, persona drift |
| Variability | acceptable | a bug: the same state must yield the same behaviour |
| Cost | free | hard budget: tokens, money, latency |
| Consumer | the same agent | a **persona simulator** that must stay in character |
| Unit | association | **a claim about the world** with a validity interval |

**[derived]** The decisive row is ground truth. Because the transcript is a complete log,
memory does not have to *be* the store of the past - it can be a *projection* of the log.
Human memory has no such option, which is why it must be reconstructive. Copying the
reconstructive design into a system that owns a perfect log imports the loss without
inheriting the reason for it.

**[derived]** The second decisive row is the frozen substrate. The survey's parametric
half does not exist for us: nothing is written into the weights during a chat. RP memory
is therefore *entirely* contextual, and "memory" is not a storage faculty at all. It is
**state reconciliation plus context construction under a hard budget, with a consistency
contract**. The word "memory" is what dragged the brain analogy in.

### 3. What is worth keeping from the brain

Only two ideas survive the transfer test.

1. **Index is not store.** The hippocampal-index account separates a small pointer
   structure from a large distributed store. In RP this becomes the evidence pointer: keep
   compact addresses that can be resolved back into the transcript on demand, instead of
   holding original text in the prompt. Directly useful and cheap.
2. **Consolidation, with a preservation criterion.** Offline consolidation is real, but
   the human version ("replay teaches the cortex") requires plastic weights. In RP the
   only defensible criterion is **information preservation**: a consolidation step may
   replace material with a shorter form *only if* the shorter form answers every future
   query the longer form could answer. **[derived]** That is a testable criterion, whereas
   "condense what matters" is not.

Everything else - reconstructive recall, forgetting as a feature, emotional weighting as
the primary salience signal, distributed traces - does not transfer.

### 4. The methodology

**P1. The transcript is the log of record; memory is a materialised view.**
Nothing may exist only in a summary. Every memory row must be derivable from, and
traceable to, transcript positions. Consequence: replay must reproduce state exactly;
writes must be idempotent; a corrupted projection is always rebuildable.

**P2. Forgetting must be provably lossless for the fiction.**
A row may be dropped only when it cannot be referenced again, i.e. when nothing that
survives depends on it and no replay would resurrect a question it answers. Irreversible
facts (promises, deaths, ownership transfers, first meetings, disclosures) form an
immutable residue that is never compacted away. **[derived]** This is a compaction
correctness rule, not a salience heuristic.

**P3. The unit is an event or a claim, not a text chunk.**
Similarity of prose is the wrong primitive, because the consumer needs validity and
causality, not topical relatedness. Events carry: participants, place, time, the state
delta they caused, and the claims they established or retired.

**P4. Separate the invariant from the evolving.**
Two stores with different laws: **canon** (persona, world rules, established traits) is
append-only and rarely changes; **state** (location, possessions, relationships,
knowledge) is versioned and superseded. DREAM's "dual-granularity" profile says the same
thing **[claim]**. Mixing them is the disease; a character profile that silently mixes
stable traits with recent events drifts.

**P5. The acceptance metric is consistency, not recall.**
Measure: canon-violation rate, temporal-order errors, causal-coherence breaks, persona
drift, epistemic leaks. "Did we retrieve the right chunk" is an implementation detail and
must not be the headline number.

**P6. History is not context.**
Context is a *rendering for one generation*; state is what persists. Conflating "what we
know" with "what fits" is the failure the Mem0 essay calls treating the context window as
storage rather than RAM **[claim]**.

**P7. Determinism is a design requirement.**
A projection that cannot be recomputed identically cannot be tested, diffed, or debugged.
Given a fixed log and version, the projection must be byte-identical.

**P8. Cost is first-class and has no human analogue.**
Budget the projection explicitly by a declared precedence, and make compression
budget-driven rather than salience-driven. **[derived]** A compression step that never
fires because a heuristic threshold is never crossed is a bug, not a saving.

**P9. The consumer is a persona, not an oracle.**
The character may only act on what the character experienced. Epistemic status - who
knows what, who was told, who only suspects - is a first-class field. **[derived]** An
omniscient memory block breaks the fiction even when every statement in it is true. This
requirement has no RAG analogue and no human-memory analogue; it is specific to roleplay,
and it is the one this project currently fails hardest (measured earlier in
`07_functional_check.md`: the who-knows relation is emitted for 0.0% of memories).

**P10. Time is the primary axis.**
"Now" and "then" must be distinct query classes, not different ranks of one similarity
score. Every claim needs a validity interval and a supersession chain; retire, never
overwrite.

### 5. Four query classes, and why similarity serves only one

| The player or character asks | Correct primitive | Similarity retrieval |
|---|---|---|
| What is true now? | keyed lookup on a slot with validity | wrong tool |
| Why is the world like this? | causal chain over events / supersession history | wrong tool |
| What was promised or is irreversible? | typed assertion + irreversibility rank | wrong tool |
| Who knows what? | epistemic scope filter | wrong tool |
| What was it like / remind me of the mood | topical similarity | right tool |

**[derived]** Three of the four questions that matter in long roleplay are not similarity
questions, yet a vector index over prose answers only the fifth. This is the strongest
argument that the current design treats the problem as retrieval when it is state
management.

### 6. The consistency contract

A roleplay memory system is correct when, across a long session:

1. No statement in the projection contradicts the canon or a surviving claim.
2. Every surviving claim has a traceable origin in the transcript.
3. Retired values remain available for "it used to be" questions.
4. A character never acts on knowledge the character did not acquire.
5. Reconstruction from the transcript reproduces the projection exactly.
6. The projection fits the declared budget at every turn.

Items 1-4 are quality; 5-6 are mechanism. Both must be instrumented, because a green
retrieval metric says nothing about any of them.

### 7. What this implies for the current implementation

| Element today | Verdict |
|---|---|
| Deterministic spine of change records | fits P1, P4, P10 - keep and extend |
| Slots with supersession and retained previous values | fits P3, P10 |
| Irreversibility ranking that protects a residue | fits P2 - this is the "generativity" idea, correctly read |
| Reconstructability-driven eviction | fits P2 - and is the one place the generative criterion is already operational |
| Vector space over prose as the primary recall path | fits only query class 5; the other four need keyed, causal and epistemic channels |
| Summaries that are injected but never embedded | fits P6 but leaves them unverifiable against P1 unless every row traces to transcript spans |
| who-knows-what | fails P9 outright; measured at 0.0% emission |
| Consistency instrument as the headline metric | missing; current metrics are coverage and retention |

### 8. What the literature does not settle

- Whether an explicit causal edge is worth its cost versus reconstructing causality from
  the supersession chain at read time. DREAM asserts the graph wins **[claim]**; no
  independent replication was found.
- Whether per-character state trees (PHASE-Tree) beat a flat supersession chain for a
  two-party roleplay, where the tree is nearly a line.
- How to measure persona drift without a model critic, which makes the metric expensive
  and hard to compare across runs.
- No source found that reports a cost-per-turn budget for any of these systems, so the
  economics of RP memory remain unmeasured in the literature.

### 9. The original design was already derived this way

The methodology above was derived independently, then checked against this project's own
earlier design work. That work already contains most of it, including the decision to stop
treating memory as human-like, and it is recorded in the AIRP project's documents.

**The original direction document** states, in its own words:

| Line | Statement |
|---|---|
| L1473 | "向量不是记忆，它只是寻址方式。" - a vector is not memory, only a way of addressing it |
| L2522, L2530 | "Vector 不是 Memory" / "不要把 embedding 当事实库" |
| L2625 | "原始事件永远不能被后来的摘要覆盖。" - raw events may never be overwritten by later summaries |
| L1671 | "存在于 context ≠ 被有效利用。" - being in context is not the same as being used |
| L3614 | "Memory is layered, not summarized away." |
| L4041 | "不要让模型无限自由决定'要不要检索'" - do not let the model freely decide whether to retrieve |

Its four layers: raw event layer (append-only, preserves evidence, prevents summary
distortion) / semantic memory layer (summaries and facts) / retrieval index layer
(embeddings, to find related content, explicitly "not the fact itself").

**The decisive question was already asked and answered.** The AIRP normative reference
opens with "does a brain-inspired memory method even fit an LLM?" and answers: "The
standing answer here is: **do not** - for the pillars, keep the current human-scoped
structure. This is because (a) the brain method assumes plasticity/priors an LLM does not
have". Its comparison table is the same test section 2 performs here: continuous weight
change vs fixed weights; innate prior vs pretrained prior; generative compression plus
reliable self-retrieval vs unreliable self-retrieval; bounded attention vs bounded token
budget with positional bias; offline replay vs no built-in offline process. Its
conclusion: "the brain analogy is *informative* but **not a blueprint for a fixed LLM**".

**What the AIRP implementation already enforces in code, not prose:**

| Invariant | Mechanism |
|---|---|
| raw events are never overwritten | append-only journal; memory is a derived projection of events |
| supersession is structural | `supersedes` / `supersededBy` edges with retained old values |
| no summary chains | an episode checkpoint requires 2-16 *scene* checkpoints and a raw-evidence union, never another summary |
| hierarchy is structural, not inferred | checkpoint coverage (arc > episode > scene), never inferred from prose or embeddings |
| retrieval is never authority | scoring is "attention only, never authority"; a mandatory baseline carries the state |
| epistemic isolation | a fact is known to a holder only when a knowledge-path record grants a path; there is no global truth dump |
| bounded admission | 4 compiled memories by default (max 16), 8,192 rendered code points, a scene-detail lexical advantage |

**Measured in that project's own runs:** a fact placed only in `recent_evidence` was
ignored (0%); the same fact in the holder-scoped mandatory baseline was answered 50/50
with `recentEvidenceLimit:0`, i.e. with retrieval switched off. Epistemic isolation over
24 turns, 4 holders and 2 secrets: each secret appeared only in its owner's baseline, and
a non-owner received it on none of three channels (0/8). That is direct evidence for P9,
and stronger than anything in section 1.

### 10. Reconciliation: what to keep, what to drop

**Converged.** The independent derivation met the original design on all ten principles.
The original states each in one line; the AIRP implementation enforces six of them in code.

**What the original says better.** Three things section 4 understated:
1. The vector is *addressing*, not memory - a sharper prohibition than "the transcript is
   the log of record".
2. The retrieval penalty is asymmetric: being in context is not being used, so coverage is
   not evidence of use.
3. "Do not put the world in the context. Put an interface to the world in the context."
   And its formulation of the goal: memory should not merely retrieve the past but
   **construct the past as currently accessible to this subject**.

**What to drop** - the parts that are brain framing rather than problem-derived:

| Dropped framing | Why |
|---|---|
| "Summary 应该是'多分辨率记忆'...这个点特别像人类记忆" | the multi-resolution *structure* survives; the justification by analogy does not |
| the working-memory analogy ("人在说话时并不会把自己所有人生经历全部加载到工作记忆") | the hard budget follows from tokens, not from human working memory |
| "人脑记忆可能不是一个统一数据库" | replaced by a stronger reason: the consumer is a fixed model with a token budget |
| five-layer Working/Episodic/State/Schema/Identity, and `Importance ≈ Novelty × StateChange × FuturePredictiveValue` | resolution-layer thinking plus a salience product; the transferable ordering is by *kind* and *irreversibility*, which the spine already implements |

This yields the test for any future claim: **keep every invariant that survives without
the analogy, and when a claim needs the brain to be true, delete the claim and re-derive
it from one of three facts - the weights are frozen, the context is a fixed budget, and
the transcript is ground truth.** Every principle in section 4 passes that test.

### 11. Where the field and this project now agree

The literature arrived at the same place from the roleplay side rather than the memory
side: DREAM builds an event graph with causal edges and scores temporal-causal coherence;
PHASE-Tree models character-state evolution with intra-scene state tracking; ACL 2026 asks
for dynamic persona coherence instead of static consistency; and arXiv 2605.26252 asks
whether long-term agent memory is really a database problem. Three independent lines - the
direction document, the AIRP implementation, and the 2026 roleplay literature - converge
on the same four commitments: **events as the unit, structure over inference, retrieval as
attention rather than authority, and consistency rather than recall as the metric.**

### Primary sources for sections 9 and 10

- Direction document: `D:\all_the_airp\评价新酒馆方向.md` (3,108 lines)
- Normative reference: `D:\all_the_airp\dev_docs\09_llm_memory_normative_reference.md`
- Architecture and data model: `D:\all_the_airp\dev_docs\01_architecture.md`, `03_data_model.md`
- Retrieval baseline: `D:\all_the_airp\dev_docs\07_attention_retrieval_baseline.md`
- Scene/episode/arc consolidation: `D:\all_the_airp\dev_docs\13_scene_memory_consolidation_at_display_floor.md`
- Contracts and compiler: `packages/contracts/src/memory.ts`, `packages/runtime/src/memory/memory-compiler.ts`
- This repository's port plan: `dev_docs/MEMORY_PLAN_2026.md`
- Owner's original compression discussion: `D:\ai_model_training\research\chat_6_memory_compression_full.md`

### Sources

- Rethinking Memory in LLM based Agents: Representations, Operations, and Emerging Topics - <https://arxiv.org/abs/2505.00675>
- DREAM: LLM-based Dynamic Role-playing via Event-Aware Memory Graph - <https://arxiv.org/html/2608.05170v1>, <https://dl.acm.org/doi/10.1145/3770855.3818027>
- PHASE-Tree: Modeling Character-State Evolution in Long-Horizon Role-Playing Dialogue - <https://arxiv.org/html/2608.06975v1>
- FictionRAG: A Stateful Metacognitive Framework for High-Fidelity Long-Narrative Role-Playing - <https://doi.org/10.3390/a19050383>
- Is Agent Memory a Database? Rethinking Data Foundations for Long-Term AI Agent Memory - <https://arxiv.org/abs/2605.26252>
- BeliefShift: Benchmarking Temporal Belief Consistency and Opinion Drift in LLM Agents - <https://www.semanticscholar.org/paper/e5825f8523abd13e93fab0786e5ecdb1a4dc0580>
- Beyond Static Persona Consistency: Dynamic Persona Coherence in LLM Role-Playing - <https://aclanthology.org/2026.acl-long.1336/>
- CoSER: Coordinating LLM-Based Persona Simulation of Established Roles - <https://icml.cc/virtual/2025/poster/46115>
- BRIDGE: Triangular Fixed-Point Refinement for Long-Horizon Persona Consistency - <https://github.com/Sunrich-HT/BRIDGE>
- SillyTavern World Info (keys, content, budget, position) - <https://docs.sillytavern.app/usage/worldinfo> and <https://deepwiki.com/SillyTavern/SillyTavern/6.1-world-info-system>
- Mem0: the context window is RAM, not storage - <https://mem0.ai/blog/context-window-is-ram-not-storage-why-most-agent-failures-happen-how-to-fix-them-in-2026>


<!-- VERSION 3 -->
## v3 - 2026-09-11 21:38:27 - record the dissenting evidence, the measured roleplay failures, and the mechanisms worth copying

## v1 - 2026-09-11 22:05:00 - derive memory design from the roleplay problem rather than from human memory

### 0. Why this document exists

The project owner concluded that an AI-roleplay memory system must not be modelled on
human memory: human memory is reconstructive, lossy and adaptive, while a roleplay
world must stay consistent. This document checks that claim against the literature and
derives a methodology from the roleplay problem itself.

Evidence is labelled: **[measured]** = a number or result reported in a source,
**[claim]** = a design assertion by an author, **[derived]** = this document's own
reasoning. Nothing here is presented as measured unless a source reports it.

### 1. What the field actually does

The field has already split, and the split runs exactly along the line the owner
identified. Human-memory-inspired designs dominate *agent* memory; designs derived from
the *roleplay* problem are event-, state- and causality-shaped.

| System | Unit of memory | Mechanism | Lineage |
|---|---|---|---|
| Generative Agents (Park et al. 2023) | observation sentence | memory stream scored by recency + importance + relevance, retrieved top-k | human analogy: salience-weighted recall |
| MemGPT / Letta | paged context block | OS-style paging between a main context and external storage | systems analogy |
| Mem0 | extracted fact | LLM writes facts, vector search reads them | engineering |
| A-MEM | linked note | Zettelkasten-style note graph | knowledge-management analogy |
| HippoRAG | passage | hippocampal-index analogy, personalised PageRank over an entity graph | explicitly brain-derived |
| **DREAM** (arXiv 2608.05170) | **event** | Event-aware Memory Graph: temporally ordered, causally linked events; roles and events as nodes; entity resolution consolidates recurring entities | **roleplay-derived** |
| **PHASE-Tree** (arXiv 2608.06975) | **character state** | state tree; intra-scene state tracking; cross-episode persona evolution | **roleplay-derived** |
| **FictionRAG** (Algorithms 19(5):383) | narrative state | "stateful metacognitive framework" for long-narrative roleplay | **roleplay-derived** |
| SillyTavern World Info | lorebook entry | entry = keys + content + configuration; recent chat is scanned, matching entries activate, a token budget is allocated, and each entry is placed at a position/depth | front-end engineering |

Two structural facts from the taxonomy survey (arXiv 2505.00675, **[claim]**):
memory is either **parametric** (implicit in model weights) or **contextual** (explicit
external data), and it is governed by six operations: **Consolidation, Updating,
Indexing, Forgetting, Retrieval, Condensation**.

DREAM's own problem statement is the clearest published statement of the failure mode
this project keeps hitting **[claim]**: prior methods "suffer from fragmented memory
organization, limited interpretability, and a lack of explicit inter-event causal
structure, resulting in largely static character representations".

Evaluation in this sub-field is also not recall-based: DREAM proposes the **Temporal
Causal Memory** benchmark for "temporal consistency and long-range causal narrative
coherence"; **BeliefShift** benchmarks temporal belief consistency and opinion drift;
**CoSER** judges simulated conversations with a model critic across four dimensions;
and ACL 2026 has a paper titled **"Beyond Static Persona Consistency: Dynamic Persona
Coherence in LLM Role-Playing"**.

### 2. Where the human analogy breaks

| Dimension | Human memory | AI roleplay memory |
|---|---|---|
| Substrate | synapses that change with use | **weights are frozen for the whole chat** |
| What memory is | a change in the network | a decision about **what enters the context window** |
| Ground truth | none; reconstruction is all there is | **the transcript exists and is authoritative** |
| Learning | continuous, unsupervised | none inside a session |
| Forgetting | adaptive; necessary | **always a defect** - it breaks canon |
| Error mode | distortion, confabulation | contradiction, omission, persona drift |
| Variability | acceptable | a bug: the same state must yield the same behaviour |
| Cost | free | hard budget: tokens, money, latency |
| Consumer | the same agent | a **persona simulator** that must stay in character |
| Unit | association | **a claim about the world** with a validity interval |

**[derived]** The decisive row is ground truth. Because the transcript is a complete log,
memory does not have to *be* the store of the past - it can be a *projection* of the log.
Human memory has no such option, which is why it must be reconstructive. Copying the
reconstructive design into a system that owns a perfect log imports the loss without
inheriting the reason for it.

**[derived]** The second decisive row is the frozen substrate. The survey's parametric
half does not exist for us: nothing is written into the weights during a chat. RP memory
is therefore *entirely* contextual, and "memory" is not a storage faculty at all. It is
**state reconciliation plus context construction under a hard budget, with a consistency
contract**. The word "memory" is what dragged the brain analogy in.

### 3. What is worth keeping from the brain

Only two ideas survive the transfer test.

1. **Index is not store.** The hippocampal-index account separates a small pointer
   structure from a large distributed store. In RP this becomes the evidence pointer: keep
   compact addresses that can be resolved back into the transcript on demand, instead of
   holding original text in the prompt. Directly useful and cheap.
2. **Consolidation, with a preservation criterion.** Offline consolidation is real, but
   the human version ("replay teaches the cortex") requires plastic weights. In RP the
   only defensible criterion is **information preservation**: a consolidation step may
   replace material with a shorter form *only if* the shorter form answers every future
   query the longer form could answer. **[derived]** That is a testable criterion, whereas
   "condense what matters" is not.

Everything else - reconstructive recall, forgetting as a feature, emotional weighting as
the primary salience signal, distributed traces - does not transfer.

### 4. The methodology

**P1. The transcript is the log of record; memory is a materialised view.**
Nothing may exist only in a summary. Every memory row must be derivable from, and
traceable to, transcript positions. Consequence: replay must reproduce state exactly;
writes must be idempotent; a corrupted projection is always rebuildable.

**P2. Forgetting must be provably lossless for the fiction.**
A row may be dropped only when it cannot be referenced again, i.e. when nothing that
survives depends on it and no replay would resurrect a question it answers. Irreversible
facts (promises, deaths, ownership transfers, first meetings, disclosures) form an
immutable residue that is never compacted away. **[derived]** This is a compaction
correctness rule, not a salience heuristic.

**P3. The unit is an event or a claim, not a text chunk.**
Similarity of prose is the wrong primitive, because the consumer needs validity and
causality, not topical relatedness. Events carry: participants, place, time, the state
delta they caused, and the claims they established or retired.

**P4. Separate the invariant from the evolving.**
Two stores with different laws: **canon** (persona, world rules, established traits) is
append-only and rarely changes; **state** (location, possessions, relationships,
knowledge) is versioned and superseded. DREAM's "dual-granularity" profile says the same
thing **[claim]**. Mixing them is the disease; a character profile that silently mixes
stable traits with recent events drifts.

**P5. The acceptance metric is consistency, not recall.**
Measure: canon-violation rate, temporal-order errors, causal-coherence breaks, persona
drift, epistemic leaks. "Did we retrieve the right chunk" is an implementation detail and
must not be the headline number.

**P6. History is not context.**
Context is a *rendering for one generation*; state is what persists. Conflating "what we
know" with "what fits" is the failure the Mem0 essay calls treating the context window as
storage rather than RAM **[claim]**.

**P7. Determinism is a design requirement.**
A projection that cannot be recomputed identically cannot be tested, diffed, or debugged.
Given a fixed log and version, the projection must be byte-identical.

**P8. Cost is first-class and has no human analogue.**
Budget the projection explicitly by a declared precedence, and make compression
budget-driven rather than salience-driven. **[derived]** A compression step that never
fires because a heuristic threshold is never crossed is a bug, not a saving.

**P9. The consumer is a persona, not an oracle.**
The character may only act on what the character experienced. Epistemic status - who
knows what, who was told, who only suspects - is a first-class field. **[derived]** An
omniscient memory block breaks the fiction even when every statement in it is true. This
requirement has no RAG analogue and no human-memory analogue; it is specific to roleplay,
and it is the one this project currently fails hardest (measured earlier in
`07_functional_check.md`: the who-knows relation is emitted for 0.0% of memories).

**P10. Time is the primary axis.**
"Now" and "then" must be distinct query classes, not different ranks of one similarity
score. Every claim needs a validity interval and a supersession chain; retire, never
overwrite.

### 5. Four query classes, and why similarity serves only one

| The player or character asks | Correct primitive | Similarity retrieval |
|---|---|---|
| What is true now? | keyed lookup on a slot with validity | wrong tool |
| Why is the world like this? | causal chain over events / supersession history | wrong tool |
| What was promised or is irreversible? | typed assertion + irreversibility rank | wrong tool |
| Who knows what? | epistemic scope filter | wrong tool |
| What was it like / remind me of the mood | topical similarity | right tool |

**[derived]** Three of the four questions that matter in long roleplay are not similarity
questions, yet a vector index over prose answers only the fifth. This is the strongest
argument that the current design treats the problem as retrieval when it is state
management.

### 6. The consistency contract

A roleplay memory system is correct when, across a long session:

1. No statement in the projection contradicts the canon or a surviving claim.
2. Every surviving claim has a traceable origin in the transcript.
3. Retired values remain available for "it used to be" questions.
4. A character never acts on knowledge the character did not acquire.
5. Reconstruction from the transcript reproduces the projection exactly.
6. The projection fits the declared budget at every turn.

Items 1-4 are quality; 5-6 are mechanism. Both must be instrumented, because a green
retrieval metric says nothing about any of them.

### 7. What this implies for the current implementation

| Element today | Verdict |
|---|---|
| Deterministic spine of change records | fits P1, P4, P10 - keep and extend |
| Slots with supersession and retained previous values | fits P3, P10 |
| Irreversibility ranking that protects a residue | fits P2 - this is the "generativity" idea, correctly read |
| Reconstructability-driven eviction | fits P2 - and is the one place the generative criterion is already operational |
| Vector space over prose as the primary recall path | fits only query class 5; the other four need keyed, causal and epistemic channels |
| Summaries that are injected but never embedded | fits P6 but leaves them unverifiable against P1 unless every row traces to transcript spans |
| who-knows-what | fails P9 outright; measured at 0.0% emission |
| Consistency instrument as the headline metric | missing; current metrics are coverage and retention |

### 8. What the literature does not settle

- Whether an explicit causal edge is worth its cost versus reconstructing causality from
  the supersession chain at read time. DREAM asserts the graph wins **[claim]**; no
  independent replication was found.
- Whether per-character state trees (PHASE-Tree) beat a flat supersession chain for a
  two-party roleplay, where the tree is nearly a line.
- How to measure persona drift without a model critic, which makes the metric expensive
  and hard to compare across runs.
- No source found that reports a cost-per-turn budget for any of these systems, so the
  economics of RP memory remain unmeasured in the literature.

### 9. The original design was already derived this way

The methodology above was derived independently, then checked against this project's own
earlier design work. That work already contains most of it, including the decision to stop
treating memory as human-like, and it is recorded in the AIRP project's documents.

**The original direction document** states, in its own words:

| Line | Statement |
|---|---|
| L1473 | "向量不是记忆，它只是寻址方式。" - a vector is not memory, only a way of addressing it |
| L2522, L2530 | "Vector 不是 Memory" / "不要把 embedding 当事实库" |
| L2625 | "原始事件永远不能被后来的摘要覆盖。" - raw events may never be overwritten by later summaries |
| L1671 | "存在于 context ≠ 被有效利用。" - being in context is not the same as being used |
| L3614 | "Memory is layered, not summarized away." |
| L4041 | "不要让模型无限自由决定'要不要检索'" - do not let the model freely decide whether to retrieve |

Its four layers: raw event layer (append-only, preserves evidence, prevents summary
distortion) / semantic memory layer (summaries and facts) / retrieval index layer
(embeddings, to find related content, explicitly "not the fact itself").

**The decisive question was already asked and answered.** The AIRP normative reference
opens with "does a brain-inspired memory method even fit an LLM?" and answers: "The
standing answer here is: **do not** - for the pillars, keep the current human-scoped
structure. This is because (a) the brain method assumes plasticity/priors an LLM does not
have". Its comparison table is the same test section 2 performs here: continuous weight
change vs fixed weights; innate prior vs pretrained prior; generative compression plus
reliable self-retrieval vs unreliable self-retrieval; bounded attention vs bounded token
budget with positional bias; offline replay vs no built-in offline process. Its
conclusion: "the brain analogy is *informative* but **not a blueprint for a fixed LLM**".

**What the AIRP implementation already enforces in code, not prose:**

| Invariant | Mechanism |
|---|---|
| raw events are never overwritten | append-only journal; memory is a derived projection of events |
| supersession is structural | `supersedes` / `supersededBy` edges with retained old values |
| no summary chains | an episode checkpoint requires 2-16 *scene* checkpoints and a raw-evidence union, never another summary |
| hierarchy is structural, not inferred | checkpoint coverage (arc > episode > scene), never inferred from prose or embeddings |
| retrieval is never authority | scoring is "attention only, never authority"; a mandatory baseline carries the state |
| epistemic isolation | a fact is known to a holder only when a knowledge-path record grants a path; there is no global truth dump |
| bounded admission | 4 compiled memories by default (max 16), 8,192 rendered code points, a scene-detail lexical advantage |

**Measured in that project's own runs:** a fact placed only in `recent_evidence` was
ignored (0%); the same fact in the holder-scoped mandatory baseline was answered 50/50
with `recentEvidenceLimit:0`, i.e. with retrieval switched off. Epistemic isolation over
24 turns, 4 holders and 2 secrets: each secret appeared only in its owner's baseline, and
a non-owner received it on none of three channels (0/8). That is direct evidence for P9,
and stronger than anything in section 1.

### 10. Reconciliation: what to keep, what to drop

**Converged.** The independent derivation met the original design on all ten principles.
The original states each in one line; the AIRP implementation enforces six of them in code.

**What the original says better.** Three things section 4 understated:
1. The vector is *addressing*, not memory - a sharper prohibition than "the transcript is
   the log of record".
2. The retrieval penalty is asymmetric: being in context is not being used, so coverage is
   not evidence of use.
3. "Do not put the world in the context. Put an interface to the world in the context."
   And its formulation of the goal: memory should not merely retrieve the past but
   **construct the past as currently accessible to this subject**.

**What to drop** - the parts that are brain framing rather than problem-derived:

| Dropped framing | Why |
|---|---|
| "Summary 应该是'多分辨率记忆'...这个点特别像人类记忆" | the multi-resolution *structure* survives; the justification by analogy does not |
| the working-memory analogy ("人在说话时并不会把自己所有人生经历全部加载到工作记忆") | the hard budget follows from tokens, not from human working memory |
| "人脑记忆可能不是一个统一数据库" | replaced by a stronger reason: the consumer is a fixed model with a token budget |
| five-layer Working/Episodic/State/Schema/Identity, and `Importance ≈ Novelty × StateChange × FuturePredictiveValue` | resolution-layer thinking plus a salience product; the transferable ordering is by *kind* and *irreversibility*, which the spine already implements |

This yields the test for any future claim: **keep every invariant that survives without
the analogy, and when a claim needs the brain to be true, delete the claim and re-derive
it from one of three facts - the weights are frozen, the context is a fixed budget, and
the transcript is ground truth.** Every principle in section 4 passes that test.

### 11. Where the field and this project now agree

The literature arrived at the same place from the roleplay side rather than the memory
side: DREAM builds an event graph with causal edges and scores temporal-causal coherence;
PHASE-Tree models character-state evolution with intra-scene state tracking; ACL 2026 asks
for dynamic persona coherence instead of static consistency; and arXiv 2605.26252 asks
whether long-term agent memory is really a database problem. Three independent lines - the
direction document, the AIRP implementation, and the 2026 roleplay literature - converge
on the same four commitments: **events as the unit, structure over inference, retrieval as
attention rather than authority, and consistency rather than recall as the metric.**

### Primary sources for sections 9 and 10

- Direction document: `D:\all_the_airp\评价新酒馆方向.md` (3,108 lines)
- Normative reference: `D:\all_the_airp\dev_docs\09_llm_memory_normative_reference.md`
- Architecture and data model: `D:\all_the_airp\dev_docs\01_architecture.md`, `03_data_model.md`
- Retrieval baseline: `D:\all_the_airp\dev_docs\07_attention_retrieval_baseline.md`
- Scene/episode/arc consolidation: `D:\all_the_airp\dev_docs\13_scene_memory_consolidation_at_display_floor.md`
- Contracts and compiler: `packages/contracts/src/memory.ts`, `packages/runtime/src/memory/memory-compiler.ts`
- This repository's port plan: `dev_docs/MEMORY_PLAN_2026.md`
- Owner's original compression discussion: `D:\ai_model_training\research\chat_6_memory_compression_full.md`

### 12. Correction: the premise is only half-supported

v2 said the literature "arrived at the same place from the roleplay side". A dedicated
evidence review found that this overstates the case, and the disagreement is recorded here
rather than smoothed over.

**No source was found that argues human-memory analogies mislead memory design for
fictional worlds.** The explicit critiques target retrieval-as-memory in general. Xu, Dai
& Zhang 2026, *Contextual Agentic Memory is a Memo, Not True Memory*
(<https://arxiv.org/abs/2604.27707>), argues that vector stores, RAG, scratchpads and
context-window management "do not implement memory: they implement lookup", and that
calling this memory is "a category error: treating a memo as a mind".

**But that paper's remedy is MORE biological alignment, not less.** It proposes a
Complementary Learning Systems dual system: hippocampal exemplars plus neocortical
consolidation. That directly contradicts the premise of this document.

The distinction that survives is between **capability** and **continuity**. The critique is
about capability - learning, abstraction, generalisation - where fixed weights are a real
handicap. Roleplay needs continuity, not capability. So:

- "An LLM cannot learn the way a brain does, therefore memory must not be modelled as
  weight change" - **supported**, and it is the argument the AIRP normative reference
  already makes.
- "Human-memory analogies are wrong for agent memory in general" - **contested**; at least
  one strong paper argues the opposite.

The position this document defends is the narrow one. It is not a licence to delete every
structural idea that also happens to appear in neuroscience.

### 13. Failure in fictional worlds is measured, not speculative

| Result | Source |
|---|---|
| The best model reached only **40% survival after 20 turns**; fact-conflict rates 40-68% | *Can LLM Agents Stick to the Script?*, ICML 2026 (NCP-Bench, 100 movie-derived environments) |
| Consistency errors concentrate in the **factual and temporal** dimensions, **peak mid-narrative**, and cluster in high-token-entropy spans | *Lost in Stories* (ConStory-Bench), ACL Findings 2026; 2,000 prompts, 5 categories, 19 subtypes |
| Persona fidelity **degrades** across 100+ round dialogues, converging toward a non-persona baseline | *Persistent Personas?*, EACL 2026 (7 models) |
| A three-layer design (episodic scene memories / semantic facts with **visibility tags** / personality-dependent speech) gave **+34.6 pp knowledge-boundary fidelity** | REVERIEMEM, *Staying In Character* (arXiv 2606.25632) |
| Belief-update prediction under intervention is weak, and the authors attribute it to associative matching rather than context capacity: "better-calibrated change detection, not more context" | HugAgent (arXiv 2510.15144) |

Two of these bear directly on this project. Factual and temporal errors dominating, and
**peaking mid-narrative**, is precisely what validity intervals and a change spine exist to
prevent. And the visibility-tag result is independent confirmation of P9.

### 14. Mechanisms worth copying

| Mechanism | Source | Why it matters here |
|---|---|---|
| Event-sourced log; the working structure is a **deterministic projection**; replay, forking, lineage | *The Log is the Agent* / ActiveGraph (arXiv 2605.21997) | the same shape as P1 and the AIRP journal; the authors state that retrieval-and-summarisation systems do not provide it |
| **Bi-temporal edges** `valid_at` / `invalid_at`; a contradicted edge is invalidated, never deleted | Zep / Graphiti (arXiv 2501.13956) | P10 done properly, and the same idea as supersession-as-first-class-edge |
| **Correctness is a property of the state trajectory, not of the records**; four operators (ingestion, revision, forgetting, retrieval) plus six correctness conditions | Orogat & Mansour, *Is Agent Memory a Database?* (arXiv 2605.26252) | gives P5 a formal shape |
| Working-memory management as **learnable actions** (insert/delete); -51% context length | *Memory as Action*, ACL Findings 2026 | the "do not let the model decide whether to retrieve" rule, applied to what to keep |
| Attention budget, context rot, the smallest high-signal token set | Anthropic, *Effective context engineering for AI agents* | the engineering statement of P6 and P8; a design claim, not a measurement |
| "If you want deterministic and predictable results, stick to keyword matching" | SillyTavern World Info documentation | a front-end stating P7 out loud, and a reason to keep a deterministic channel |

### 15. What is still unmeasured

- No ablation isolates the Generative Agents memory-stream scoring, and no head-to-head
  compares event-sourced memory with vector memory on long roleplay transcripts.
- The replay and forking benefits of event sourcing are author design claims, not
  experiments.
- The consistency benchmarks measure generation-time coherence, not memory-architecture
  causality: none of them establishes that the memory design caused the error.
- Belief revision in *fictional* agents is unmeasured; the closest proxy is in real-person
  policy domains.
- Several 2026 sources are unreplicated preprints, and FictionRAG could not be retrieved
  (HTTP 403), so it is cited at abstract level only.

### Primary sources for sections 12 to 15

- Evidence review: `dev_docs/11_human_memory_analogy_evidence.md`
- Context-length evidence: `dev_docs/12_long_context_evidence.md`
- Xu, Dai & Zhang 2026, *Contextual Agentic Memory is a Memo, Not True Memory* - <https://arxiv.org/abs/2604.27707>
- *The Log is the Agent* / ActiveGraph - <https://arxiv.org/abs/2605.21997>
- Orogat & Mansour, *Is Agent Memory a Database?* - <https://arxiv.org/abs/2605.26252>
- Zep / Graphiti - <https://arxiv.org/abs/2501.13956>
- *Memory as Action* - <https://aclanthology.org/2026.findings-acl.956/>
- *Can LLM Agents Stick to the Script?* - <https://icml.cc/virtual/2026/poster/64786>
- *Lost in Stories* (ConStory-Bench) - <https://aclanthology.org/2026.findings-acl.410/>
- *Persistent Personas?* - <https://aclanthology.org/2026.eacl-long.246/>
- REVERIEMEM, *Staying In Character* - <https://arxiv.org/abs/2606.25632>
- Anthropic, *Effective context engineering for AI agents* - <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- SillyTavern World Info - <https://docs.sillytavern.app/usage/core-concepts/worldinfo/>

### Sources

- Rethinking Memory in LLM based Agents: Representations, Operations, and Emerging Topics - <https://arxiv.org/abs/2505.00675>
- DREAM: LLM-based Dynamic Role-playing via Event-Aware Memory Graph - <https://arxiv.org/html/2608.05170v1>, <https://dl.acm.org/doi/10.1145/3770855.3818027>
- PHASE-Tree: Modeling Character-State Evolution in Long-Horizon Role-Playing Dialogue - <https://arxiv.org/html/2608.06975v1>
- FictionRAG: A Stateful Metacognitive Framework for High-Fidelity Long-Narrative Role-Playing - <https://doi.org/10.3390/a19050383>
- Is Agent Memory a Database? Rethinking Data Foundations for Long-Term AI Agent Memory - <https://arxiv.org/abs/2605.26252>
- BeliefShift: Benchmarking Temporal Belief Consistency and Opinion Drift in LLM Agents - <https://www.semanticscholar.org/paper/e5825f8523abd13e93fab0786e5ecdb1a4dc0580>
- Beyond Static Persona Consistency: Dynamic Persona Coherence in LLM Role-Playing - <https://aclanthology.org/2026.acl-long.1336/>
- CoSER: Coordinating LLM-Based Persona Simulation of Established Roles - <https://icml.cc/virtual/2025/poster/46115>
- BRIDGE: Triangular Fixed-Point Refinement for Long-Horizon Persona Consistency - <https://github.com/Sunrich-HT/BRIDGE>
- SillyTavern World Info (keys, content, budget, position) - <https://docs.sillytavern.app/usage/worldinfo> and <https://deepwiki.com/SillyTavern/SillyTavern/6.1-world-info-system>
- Mem0: the context window is RAM, not storage - <https://mem0.ai/blog/context-window-is-ram-not-storage-why-most-agent-failures-happen-how-to-fix-them-in-2026>
