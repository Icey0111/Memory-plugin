# Long-context LLM behaviour and memory/retrieval evaluation: evidence for AI-roleplay memory design

Tags: [measured] = reported experiment; [design claim] = author recommendation; [vendor claim] = provider capability claim. Nothing here tests the human-brain analogy; that is a separate design question.

## Findings

1. **LongMemEval** [measured]: 500 human-written questions over 5 abilities (information extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention). Settings: S = ~115k tokens (~50 sessions); M = 500 sessions ~1.5M tokens. QA scored by an LLM judge; retrieval by Recall@k / NDCG@k. Offline reading of the full history with GPT-4o scores 0.9184; commercial assistants using GPT-4o score 0.5773 (ChatGPT, -37%) and 0.3299 (Coze, -64%). Long-context LLMs drop 30-60% vs an oracle-evidence context (Llama 3.1 8B 0.710->0.420; Phi-3-128k 0.722->0.344).
2. **LoCoMo** [measured]: 50 dialogues, avg 300 turns / 9k tokens / up to 35 sessions, human-verified. QA uses partial-match F1; summarization uses FactScore (atomic facts). Human 87.9 vs GPT-4-turbo 32.1, GPT-3.5 22.4. Long-context GPT-3.5-16K improves with more history (4K 24.1 -> 16K 37.8) but adversarial-answer accuracy collapses (13.1 -> 2.1). RAG/long-context improve over base 22-66% yet stay ~56% below human, 73% below on temporal reasoning.
3. **RULER** [measured]: 17 LMs x 13 tasks in 4 categories (NIAH variants; multi-hop variable tracking; aggregation; QA with distractors), 4K-128K. Near-perfect on vanilla NIAH, sharp degradation with length. Repo "Effective Length" (threshold-based; the paper calls it a "qualitative threshold", no numeric fraction published): GPT-4-1106 claimed 128K/effective 64K; Llama 3.1 70B 128K/64K; 8B 128K/32K; Qwen2-72B 128K/32K.
4. **Needle-in-a-Haystack (original)** [measured]: one fact at varying depth in Paul Graham essays; near-saturated. RULER calls NIAH "a superficial form of long-context understanding".
5. **Lost in the Middle** [measured]: multi-document QA and JSON key-value retrieval. Performance is U-shaped in answer position (primacy/recency); mid-context GPT-3.5 falls below closed-book 56.1%. 20->50 retrieved docs adds only ~1.5% (GPT-3.5) / ~1% (Claude-1.3); extended-context models match non-extended counterparts.
6. **"Context rot"** = Chroma technical report [measured, coined name]: 18 models (GPT-4.1, Claude 4, Gemini 2.5, Qwen3). Non-uniform performance with length even on repeated words; worse as needle-question cosine similarity (avg of 5 embedding models) drops; 0/1/4 distractors compound it; shuffled haystacks beat structured ones.
7. **Retrieval vs long context - sources disagree.** Self-Route [measured]: on 9 datasets (LongBench + InfinityBench, ~100k tokens), full context beats Contriever top-k RAG by +7.6 (Gemini-1.5-Pro), +13.1 (GPT-4o), +3.6 (GPT-3.5) points; cost favours RAG, and its router [design claim] cuts cost 65%/39%. Databricks [measured]: 20 models, 2k->128k (2M) tokens, 512-token chunks, text-embedding-3-large, FAISS IndexFlatL2 - most models peak then decline, only a few hold past 64k, most open models effective to 16k-32k. Long-Context LLMs Meet RAG [measured]: generation rises then falls with passage count because "hard negatives" (often from stronger retrievers) poison context; reordering is a training-free mitigation. Reconciliation: "more context" is not monotone; the winner depends on model class and on feeding everything vs adding chunks.
8. **NoLiMa** [measured]: 12 models claiming >=128K, needles with minimal lexical overlap. At 32K, 10/12 fall below 50% of short-context baseline; GPT-4o 99.3% -> 69.7%.
9. **Persona persistence** [measured]: 100+ round persona dialogues, 7 models; fidelity (knowledge, style, in-character consistency) degrades and reverts toward default, with a fidelity/instruction-following trade-off. Nearest roleplay-relevant measurement found.

## Claim | Evidence | Source

| Claim | Evidence | Source |
|---|---|---|
| Long histories degrade recall vs oracle | 30-60% drop at 115k; GPT-4o 0.918->0.577 | [LongMemEval](https://arxiv.org/abs/2410.10813) |
| Design: round-level granularity + fact-expanded keys | +9.4% Recall@k, +5.4% accuracy [design claim] | [LongMemEval](https://arxiv.org/abs/2410.10813) |
| Very-long dialogue QA far below human | Human 87.9 vs GPT-4-turbo 32.1; still 56% behind | [LoCoMo](https://arxiv.org/abs/2402.17753) |
| Longer context helps some metrics, hurts adversarial | 4K 24.1 -> 16K 37.8; adversarial 13.1 -> 2.1 | [LoCoMo](https://arxiv.org/abs/2402.17753) |
| Claimed context > effective context | GPT-4 128K/64K; Llama 3.1 70B 128K/64K | [RULER repo](https://github.com/NVIDIA/RULER), [RULER](https://arxiv.org/abs/2404.06654) |
| Vanilla NIAH is saturated/superficial | Models pass NIAH, fail complex tasks | [RULER](https://arxiv.org/abs/2404.06654), [NIAH](https://github.com/gkamradt/needle-in-a-haystack) |
| Position matters (U-shaped) | Mid-context GPT-3.5 below closed-book 56.1% | [Lost in the Middle, TACL](https://aclanthology.org/2024.tacl-1.9/) |
| Extra retrieved docs saturate | +1.5% / +1% from 20->50 docs | [Lost in the Middle](https://arxiv.org/abs/2307.03172) |
| Length alone degrades performance | 18 models; repeated-words and low-similarity NIAH | [Chroma Context Rot](https://www.trychroma.com/research/context-rot) |
| Full context beats top-k RAG on 9 datasets | +7.6/+13.1/+3.6 points | [Self-Route](https://arxiv.org/abs/2407.16833) |
| RAG improves then declines with more chunks | 20 models, 2k-128k, peak then fall | [Databricks](https://arxiv.org/abs/2411.03538) |
| Hard negatives poison long-context RAG | Rise-then-fall with passage count | [arXiv 2410.05983](https://arxiv.org/abs/2410.05983) |
| Literal matching inflates NIAH scores | 10/12 models <50% baseline at 32K | [NoLiMa](https://arxiv.org/abs/2502.05167) |
| Effective length often <50% of training length | Llama 3.1 70B RULER effective 64K | [STRING](https://arxiv.org/abs/2410.18745) |
| Persona fidelity fades over 100+ rounds | 7 models; revert to default | [Persistent Personas](https://arxiv.org/abs/2512.12775) |
| "1M-token context" is a vendor capability claim | Marketing, not effective-context measurement | [RULER](https://arxiv.org/abs/2404.06654), [NoLiMa](https://arxiv.org/abs/2502.05167) |

## What this does NOT establish

- **Fictional-world consistency / contradiction avoidance: unmeasured.** LongMemEval's "knowledge updates"/"abstention" and LoCoMo's "adversarial" category test user facts and refusal-to-answer, not whether a scene contradicts established world state. No cited benchmark scores cross-entity world-state consistency.
- **Persona fidelity is not world consistency.** The only long-roleplay measurement (2512.12775) tracks persona-vs-system-prompt drift, not contradictions among many fictional facts.
- **Cost is barely measured.** Only Self-Route (percent cost) and Databricks (qualitative) report it; core benchmarks are accuracy-only, with no $/turn or latency budget.
- **Determinism: unmeasured.** No benchmark reports run-to-run variance; LongMemEval/LoCoMo scoring are LLM-based (judge / FactScore), adding stochasticity.
- **Retrieval on roleplay registers is unmeasured.** LoCoMo notes semantic-similarity retrievers fail on dialogue with anaphora; NoLiMa shows literal-match shortcuts inflate scores. Jargon-heavy fictional lore is untested.
- **The central design premise is untested here.** Nothing in this literature shows non-brain-like (lossless, append-only, consistency-first) memory is better for roleplay. That remains a design claim.
