# Memory Thesis, Scoped To The Tavern Plugin

<!-- VERSION 1 -->
## v1 - 2026-09-12 05:08:22 - retrieval is memory, the summary is a situation model, and the index is already half-extracted

### Scope

This supersedes the AIRP-scoped version of the same convergence (written there as
`dev_docs/16_memory_thesis_convergence.md`). **AIRP is a sibling research project: it is not a
tavern scenario, it carries functionality unrelated to memory, and it is not the deployment
target.** Two things transfer from it and nothing else:

1. the memory research conclusions in its `dev_docs/08` and `dev_docs/09`;
2. its experiment discipline — pre-registered thresholds, paired intervals, explicit controls.

**The target is this plugin, inside SillyTavern.** Everything below is scoped to that.

---

### 1. The thesis

The starting formulation was two lines:

1. **记忆是检索** — memory is retrieval.
2. **总结给剧情推进提供基础** — the summary's job is to give plot advancement its footing.

Converged:

> **Memory is a retrieval process over an index of the original, gated by a computed familiarity
> signal. The summary is a continuously maintained situation model over the story's five
> dimensions. The two sit at different points on one compression–fidelity curve; neither
> substitutes for the other.**

In the original voice, repaired: **总结是情境模型，不是记忆；记忆是按需检索原文。**

### 2. Five claims, repaired

| # | Original | Repaired | Evidence |
|---|---|---|---|
| C1 | Memory is two systems | **One continuum, two poles** | FTT "parallel verbatim–gist storage, dissociated verbatim–gist retrieval"; Nested Learning's "Continuum Memory System" |
| C2 | Summaries are not memory | **Gist is memory**, and it is the kind that drives reasoning | Reyna 2012: gist supports "fuzzy (yet advanced) intuition", verbatim supports "precise analysis" |
| C3 | The summary is for plot advancement | A **situation model** over **five dimensions**: time, space, causation, protagonists, **intention** | Zwaan & Radvansky 1998; Baldassano 2017 |
| C4 | Memory is retrieval | A **three-stage process**: indexing, retrieval, reading | LongMemEval (ICLR 2025); 30% accuracy drop for commercial assistants and long-context LLMs |
| C5 | Attention triggers retrieval | Attention must be a **computed signal**, never a model decision — no model holds the veto | AIRP `09`'s own finding; Self-RAG had to *train* reflection tokens to make on-demand retrieval work |

Three defects in the original statement: "not memory" is a definitional move the literature does
not support (gist is memory); "推进得有章法" is unmeasurable until it becomes the five dimensions;
and "attention" is left as an unanalysed primitive, when it decomposes into a cheap **familiarity**
signal that gates and an expensive **recollection** that it gates.

### 3. What this plugin already is

The plugin **is a reading system**. It compiles a prompt from a store under fixed character caps and
certifies the result without a model judge. Measured live on the acceptance chat (28 assistant
floors, 76 memories):

| | |
|---|---|
| `key_retention` | **23/23 = 1.00** (the never-drop set is entirely in the rendered block) |
| `causal_recall` / `causal_injected` | **12/12 / 12/12**, gap 0 |
| certificate | state 12/12, stale 0, commitment 23/23, causal 3/3, violations 0 |

So in LongMemEval's terms, **this plugin implements *reading* and is missing *indexing* and
*retrieval*.** The same diagnosis AIRP gets — but here it is cheap to fix, because of §4.

### 4. The index is already half-extracted, and nothing consumes it

- every memory carries `entities`;
- every memory carries `source_message`, the floor it came from;
- `entity_registry` exists;
- **the original row text is still in `ctx.chat`** — folding only sets `is_system` and a marker, it
  does not touch the content.

So this chain is complete:

```
attention → entity → memory → source_message → floor → original text
```

**except for the last hop.** Nothing turns a floor back into injected text. That single missing hop
is the difference between "this plugin has state" and "this plugin has memory".

### 5. The tavern constraints that shape the design

| constraint (measured) | consequence |
|---|---|
| injected ceiling ~16,000 chars ≈ 11,600 tokens; currently 7,736 tokens spent | retrieval must be **budgeted**, not dumped |
| every model call is billed to the user | **the gate must be deterministic** — no per-turn judge call |
| the host assembles the prompt from `ctx.chat`; the only lever on a row is marking it | retrieval = **selective un-hiding for one turn** |
| hidden rows keep their content | "hidden is not deleted" **is already true** |
| but nothing ever un-hides for a reason | hiding is currently **one-way in practice** |

The last two lines are the whole opportunity: the mechanism to restore a row exists
(`unfoldFloorsNotCovered` uses it), and nothing uses it to answer a question.

### 6. Where the plugin stands, stage by stage

| stage | state |
|---|---|
| **indexing** | **absent** — `entities` and `source_message` are written but never indexed by floor |
| **retrieval** | **absent** — dense recall is off (`vector.stale: true`); only lexical + temporal run |
| **reading** | **present and certified** |
| **the gist pole** | present: slot map with supersession, mandatory baseline (23/24), change chain |
| **abstention** | **absent** — no notion of "I do not know" (LongMemEval's fifth ability) |

### 7. The three layers, for this host

1. **Familiarity gate — deterministic, zero model calls.** Entities in the incoming turn scored by
   **IDF × recency decay** against the registry. Fires generously: a missed retrieval is
   unrecoverable within the turn, a spurious one merely costs tokens.
2. **Recollection — retrieval.** Entity → `source_message` floors → **un-hide those rows for this
   turn**, verbatim, inside a bounded budget. The semantic channel (broken vectors) is an
   *enhancement* for relevance that names nothing, not a prerequisite.
3. **Reranker — model, rank and trim only.** It may choose what to keep, in what order, how long.
   **No model output may mean "do not retrieve".**

### 8. Two defects this thesis exposes in what is already shipped

**D1 — the batch row compresses by truncation.** A sealed batch of ten floors is 400 characters,
spread oldest-first, which keeps ~39 characters of each floor's event summary. That preserves the
*beginning* of each line and nothing else. C3 says the row should carry the five situation
dimensions. The material is already in the extraction records (time, place, entities, causal kind,
commitments). **Compression should select structure, not cut prose.**

**D2 — the fold certificate checks the wrong invariant.** Today: *every hidden floor has a
stand-in.* Under this thesis it should be: *every hidden floor is still retrievable, and the
retrieval path is complete.* The first is satisfied; the second has never been checked, because
nothing reads it.

### 9. The warning that must not be skipped

AIRP's own measurement — a fact in the structured baseline was used **100%** of the time, the same
fact left only in prose was **ignored** — is not about whether a tool existed. Retrieval returns
**prose**. So:

> **If retrieved original text is injected as a bare passage, it may reproduce the ignored
> condition that the baseline exists to escape.**

Retrieved text must arrive **structured, labelled, scoped to the holder and bounded** — the same
shape as the baseline, not a dump.

### 10. Testable without new infrastructure

- **H1** — an IDF gate finds planted long-range detail far better than a frequency gate.
- **H2** — a frequency gate is at least as good at identity ("is this a known character?"). The two
  gates are complementary, not substitutes.
- **H3** — entity-distribution **entropy jumps** align better with real plot turns than the fixed
  `summary_level1_every_turns` boundary. If true, this replaces the fixed batch size *and* the
  compression rate that was derived from it.
- **H4** — retrieved original text is *used* only when injected in structured, scoped form.

Acceptance table, external and ready-made: LongMemEval's five abilities — information extraction,
multi-session reasoning, temporal reasoning, **knowledge updates**, **abstention**. This plugin
already has supersession for the fourth and nothing for the fifth.

### 11. Not claimed

- The brain model is not a blueprint; external, curated, holder-scoped state remains the right form
  for a fixed-weight LLM.
- Retrieval is not sufficient. LongMemEval's 30% drop is the field's measure of how unsolved it is.
- Attention's *encoding* half is out of scope here; only its retrieval-gating half is treated.
- Human retrieval is reconstructive; injecting the original is **better than** human memory, not a
  model of it.

### References

Reyna & Brainerd 2001 · Reyna 2012 · Zwaan & Radvansky 1998 · Baldassano et al. 2017 · Yonelinas
et al. 2010 · Whittlesey & Jacoby 2001 · Nader & Hardt 2009 · Chun & Johnson 2011 · Wu et al. 2025
(*LongMemEval*, ICLR 2025, arXiv 2410.10813) · Gutiérrez et al. 2024 (*HippoRAG*, NeurIPS 2024,
arXiv 2405.14831) · Asai et al. 2023 (*Self-RAG*, arXiv 2310.11511) · Behrouz et al. 2024
(*Titans*, arXiv 2501.00663) · Google Research 2025 (*Nested Learning*, arXiv 2512.24695) ·
DeepSeek-AI 2025 (*DeepSeek-OCR*, arXiv 2510.18234)
