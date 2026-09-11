# AI-roleplay memory: what production/research LLM-agent memory is actually built from

## Findings
1. **A write-pipeline / read-pipeline split is universal.** Every system separates an ingestion/consolidation stage from query-time retrieval (the canonical survey literally names *Memory Writing, Memory Management, Memory Reading*). Retrieval is a scoring/fusion function, not a model of recollection.
2. **Human/neuroscience borrowing is mostly framing; implemented mechanisms are IR/database mechanisms.** Only HippoRAG operationalizes a neuroscience theory (hippocampal indexing → Personalized PageRank) and Generative Agents implements cognitive constructs (memory stream, reflection, importance). MemGPT explicitly uses an **OS** metaphor; Mem0, A-MEM and Zep are database/IR designs.
3. **Contradiction handling exists but is shallow and unevenly evaluated.** Mem0 uses LLM-chosen ADD/UPDATE/DELETE/NOOP; Zep invalidates graph edges with bi-temporal validity. MemGPT and Generative Agents have *no* conflict mechanism. No standard metric measures supersession correctness.
4. **Almost all headline numbers are author-run.** LOCOMO, MuSiQue and LongMemEval are independent datasets, but each team evaluated itself, and there is a documented Zep-vs-Mem0 benchmark dispute.

## Mechanism and evaluation table

| Claim | Evidence (mechanism / result) | Source |
|---|---|---|
| MemGPT storage + schedule | Main context = system instructions + editable "working context" + FIFO queue; external = **recall storage** (full searchable log) and **archival storage** (read/write text objects). Retrieval is agent function calls with paginated search. Queue manager warns at **~70%** of context, flushes at **100%**, evicting **~50%** and writing a new recursive summary; evicted messages persist in recall storage. | arxiv.org/abs/2310.08560 |
| MemGPT design basis | Explicitly "drawing inspiration from hierarchical memory systems in traditional operating systems" — virtual-memory paging, **not** the brain. | arxiv.org/abs/2310.08560 |
| MemGPT evaluation | DMR: MemGPT **93.4%** vs GPT-4-Turbo 35.3%. DMR was created by the MemGPT authors → **not independent**. | arxiv.org/abs/2310.08560 |
| Mem0 write pipeline | Extraction on pair (m₍t₋₁₎, mₜ) → candidate facts Ω; update retrieves top-*s* embedding neighbours and an LLM issues a tool call: **ADD** (no equivalent), **UPDATE** (complementary), **DELETE** (contradicted), **NOOP**. Reading is vector retrieval; Mem0ᵍ adds entity–relation triplets with conflict detection. | arxiv.org/abs/2504.19413 |
| Mem0 evaluation | LOCOMO (independent dataset, Maharana et al.), **author-run**, 10 runs: single-hop J 67.13, multi-hop 51.15, open-domain 72.93, temporal 55.51 vs OpenAI full-context 63.79/42.92/62.29/21.71; claims 91% lower p95 latency, >90% token savings. | arxiv.org/abs/2504.19413 |
| A-MEM schema + linking | Note mᵢ = {content, timestamp, LLM keywords Kᵢ, tags Gᵢ, context Xᵢ, embedding eᵢ, links Lᵢ}; link if cosine(eₙ,eⱼ) is top-*k* (k=10) **and** the LLM approves; "boxes" = link clusters. | arxiv.org/abs/2502.12110 |
| A-MEM "memory evolution" | For each neighbour mⱼ, LLM(mₙ ‖ neighbours\mⱼ ‖ mⱼ) rewrites mⱼ's context/keywords/tags — refinement, **no deletion or invalidation**. | arxiv.org/abs/2502.12110 |
| A-MEM evaluation | LoCoMo F1/BLEU, author-run; GPT-4o-mini multi-hop F1 45.85 vs MemGPT 25.52. Mem0's re-run puts A-Mem single-hop LLM-judge at 39.79. | arxiv.org/abs/2502.12110 · arxiv.org/abs/2504.19413 |
| Zep/Graphiti storage | Three-tier temporal KG: **episode** (raw), **semantic entity** (entities + relation edges), **community** (cluster summaries); facts carry validity intervals; contradictory facts **invalidate** edges. | arxiv.org/abs/2501.13956 |
| Zep retrieval | Hybrid cosine + Okapi **BM25** + breadth-first graph search over Neo4j/Lucene, reranked by RRF, MMR, or episode-mention frequency. | arxiv.org/abs/2501.13956 |
| Zep evaluation | DMR 94.8% vs MemGPT 93.4% (DMR author-defined by the MemGPT team); LongMemEval (independent, Wu et al.) up to **+18.5%** accuracy, **−90%** latency — author-run. | arxiv.org/abs/2501.13956 · arxiv.org/abs/2410.10813 |
| Zep–Mem0 disagreement | Zep's blog claimed **84%** LoCoMo; Mem0's co-founder reran and reported **58.44% ±0.20**, citing an adversarial-category denominator error plus changed prompt/retrieval template in a single run. Unresolved. | github.com/getzep/zep-papers/issues/5 |
| Generative Agents | Append-only natural-language **memory stream**; score = α·recency + α·relevance + α·importance, min-max normalized to [0,1]; recency = **0.995^hours**; importance = LLM integer **1–10**; relevance = cosine. Reflection fires when the **sum of recent importance scores exceeds 150** and writes reflections back into the stream. | arxiv.org/abs/2304.03442 |
| Generative Agents evaluation | Controlled human believability evaluation + ablation; abstract states observation, planning and reflection "each contribute critically". Exact per-condition scores not extracted here. | arxiv.org/abs/2304.03442 |
| HippoRAG | OpenIE builds a schemaless KG; synonymy edges E′ added when entity-embedding cosine > τ. Query → LLM extracts entities → linked to nodes → **Personalized PageRank** seeded on query nodes; explicitly the **hippocampal indexing theory** (neocortex = LLM+KG, hippocampus = PPR). | arxiv.org/abs/2405.14831 |
| HippoRAG evaluation | Independent multi-hop QA (MuSiQue, 2WikiMultiHopQA, HotpotQA), author-run: R@5 **51.9** (MuSiQue) and **89.1** (2Wiki) vs ColBERTv2 49.2/68.2. | arxiv.org/abs/2405.14831 |
| Canonical survey taxonomy | "we discuss previous works from three dimensions, that is, **memory sources, memory forms, and memory operations**"; operations = **Memory Writing / Management / Reading**. Engineering taxonomy; cognitive psychology is only motivation. | arxiv.org/abs/2404.13501 |
| 2025 surveys | 2504.15965 organizes by **human** memory (object/form/time, 8 quadrants); 2505.00675 uses parametric-vs-contextual forms and six operations (Consolidation, Updating, Indexing, Forgetting, Retrieval, Condensation). | arxiv.org/abs/2504.15965 · arxiv.org/abs/2505.00675 |
| Independent benchmarks | LongMemEval includes a **knowledge-updates** category; MemoryAgentBench evaluates incremental multi-turn memory. | arxiv.org/abs/2410.10813 · arxiv.org/abs/2507.05257 |

## What this does NOT establish
- **Nothing roleplay-specific.** Every benchmark is QA over user–assistant chat or documents; none measures persona fidelity, narrative continuity, world-state consistency, or stale-fact suppression over a fictional timeline.
- **No evidence for or against the "not-brain" premise.** These systems target QA; their success says nothing about which storage model fits a consistent fictional world.
- **Comparability is weak.** Independent datasets, but self-run prompts/models/k/judges; the Zep–Mem0 dispute shows prompt and template choices alone can swing scores.
- **Conflict/supersession accuracy is unmeasured** — no cited work reports precision/recall on contradiction detection.
- **Cost/latency claims are author-measured** on unpublished hardware/configurations.
- **Human-memory language is a design claim, not a result** (e.g. Mem0's "mirroring human cognitive processes" is one framing sentence with no memory-science evaluation).
