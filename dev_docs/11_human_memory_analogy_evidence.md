# Human-memory analogies for AI-roleplay memory: evidence review

## Findings

1. **No source found argues "human-memory analogies are wrong for *fictional-world* agents" in those terms.** Explicit critiques target *retrieval-as-memory* generally, not roleplay. Closest: Xu, Dai & Zhang (2026), *Contextual Agentic Memory is a Memo, Not True Memory*, calls conflating lookup with memory a **category error** ("treating a memo as a mind"): vector stores, RAG, scratchpads and context management "do not implement memory: they implement lookup"; retrieval generalizes by similarity, parametric state by abstract rules; under a bounded-contextual-accuracy condition they derive a compositional sample-complexity gap, and automatic memory writes make prompt injections persistent. Notably this paper **uses human memory positively** — Complementary Learning Systems (hippocampal exemplars + neocortical consolidation) is its proposed remedy, the opposite of the designer's premise.
2. **Critique of the memory-stream abstraction is narrow.** Park et al.'s stream is scored by relevance (embedding cosine similarity), recency (exponential decay **0.995** per sandbox game hour since last retrieval) and importance (LLM integer **1–10** poignancy, assigned at write time), min–max normalised to [0,1] and summed. *Memo* names it the canonical "remember by writing" case; Nakajima (2026), *The Log is the Agent*, contrasts "retrieval-and-summarization memory systems" with event sourcing. No ablation isolates the stream.
3. **Alternative framings are mechanism-bearing** (table): OS paging (MemGPT), temporal knowledge graph (Zep/Graphiti), event-sourced log (ActiveGraph), state-trajectory database correctness (GEM/MemState), learnable control policy (Memory-as-Action), context engineering (Anthropic), roleplay-structured memory (REVERIEMEM, DREAM, SillyTavern World Info).
4. **Determinism/replayability has a published design argument, not roleplay measurements.** ActiveGraph makes an append-only event log the source of truth and the working graph a *deterministic projection* of it under a "determinism contract", yielding replay, forking at any event and lineage; it claims retrieval/summarisation systems lack these and states it does not demonstrate the self-improvement case. SillyTavern's docs already encode the trade-off: vector/keyword activation "depends entirely on the outputs of the embedding model… If you want deterministic and predictable results, stick to keyword matching."
5. **Fictional-world consistency failure is measured.** Lost in Stories (ConStory-Bench, 2,000 prompts, 5 categories/19 subtypes) finds errors cluster in **factual and temporal** dimensions, peak **mid-narrative** and concentrate in **high token-entropy** spans. NCP-Bench reports GPT-5.2 at only **40% survival after 20 turns**, conflict rates **40–68%**. Persistent Personas finds persona **fidelity degrades** over 100+ rounds, converging toward non-persona baselines. REVERIEMEM reports **+34.6 pp** knowledge-boundary fidelity, ~79% win on BOOKWORLD.
6. **Belief revision in simulated agents is largely *unmeasured* in roleplay.** HugAgent: models recover a person's belief *state* from context but **struggle to predict belief updates under intervention**, traced to associative matching rather than context capacity. DREAM imports the ABC (Activating Event–Belief–Consequence) model into an event graph for temporal/causal coherence, but no roleplay system here reports belief-revision accuracy against a ground-truth belief trace.

## Claim | Evidence | Source

| Claim | Evidence | Source |
|---|---|---|
| Retrieval-as-memory is a category error with theoretical limits | Theory claim + theorems; "lookup" vs "true memory"; security argument; no roleplay validation | https://arxiv.org/abs/2604.27707 |
| Memory stream = relevance × recency × importance | Cosine similarity; decay 0.995/hour; LLM 1–10 poignancy; min–max [0,1] | https://arxiv.org/abs/2304.03442 |
| Event log as source of truth beats retrieval/summarisation on replay | Design claim; determinism contract, forking, lineage; author states not demonstrated | https://arxiv.org/abs/2605.21997 |
| Memory correctness belongs to the *state trajectory*, not records | Four failure modes; GEM operators (ingestion/revision/forgetting/retrieval); six correctness conditions; MemState prototype | https://arxiv.org/abs/2605.26252 |
| Temporal KG invalidates edges, not deletes them | Bi-temporal `valid_at`/`invalid_at`; Graphiti; DMR 94.8% vs MemGPT 93.4% | https://arxiv.org/abs/2501.13956 · https://github.com/getzep/graphiti · https://deepwiki.com/getzep/graphiti/3.2-temporal-awareness-and-bi-temporal-model |
| Context management is a learnable control policy | In-place insert/delete actions, end-to-end RL; −51% context, matches 16× larger model | https://aclanthology.org/2026.findings-acl.956/ |
| Context engineering framing (attention budget, context rot) | Anthropic design claim; cites needle-in-haystack degradation; n² attention | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| Roleplay practitioners prefer determinism | Docs: "stick to keyword matching"; sticky/cooldown/delay in messages; scan depth; recursion | https://docs.sillytavern.app/usage/core-concepts/worldinfo/ |
| Narrative consistency degrades measurably | 2,000 prompts; errors factual/temporal, mid-narrative, high-entropy | https://aclanthology.org/2026.findings-acl.410/ |
| Interactive-narrative commitments break under pressure | NCP-Bench, 100 environments; GPT-5.2 40% survival @20 turns | https://icml.cc/virtual/2026/poster/64786 |
| Persona fidelity fades over long dialogues | 7 LLMs, 100+ rounds; fidelity/instruction-following trade-off | https://aclanthology.org/2026.eacl-long.246/ |
| Perspective-bounded, visibility-tagged memory helps | Episodic / visibility-tagged semantic / personality layers; +34.6 pp, ~79% win | https://arxiv.org/abs/2606.25632 |
| Event-graph memory for roleplay | ABC-model Event-aware Memory Graph, dual-granularity profiles, TCM benchmark (KDD 2026) | https://arxiv.org/abs/2608.05170 |
| Belief-update prediction is the weak point | HugAgent: state recovery ok, update prediction fails; cause = associative matching | https://arxiv.org/abs/2510.15144 |

## What this does NOT establish

- **No source asserts human-memory analogies are unsuitable specifically for persistent fictional worlds.** Strongest critiques concern *capability/learning*, not *continuity*; one (Memo) argues for **more** biological alignment.
- No ablation isolating the memory-stream scoring function; no head-to-head of event-sourced vs vector memory on long roleplay transcripts. Replay/forking benefits are **author design claims, unmeasured**.
- Consistency benchmarks measure generation-time coherence, not memory-architecture causality.
- **Belief revision in simulated fictional agents is unmeasured.** HugAgent covers real humans in policy domains, not characters in worlds.
- Several 2026 sources are unreplicated preprints; FictionRAG (https://www.mdpi.com/1999-4893/19/5/383) returned HTTP 403, cited at abstract level only.
- Zep's 94.8% vs 93.4% is a 1.4 pp margin on a near-saturated benchmark, reported by the system's authors (marketing-adjacent).
