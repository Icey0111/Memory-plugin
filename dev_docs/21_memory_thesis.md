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

<!-- VERSION 2 -->
## v2 - 2026-09-12 05:16:15 - H1 is refuted, H2 is undecidable here, and the gate's job was mis-stated

### What was run

**Zero model calls.** Live acceptance chat (55 rows, 28 assistant floors, 76 memories). Entity groups built
from `entities` on every memory plus `entity_registry`, then canonicalised by collapsing names that
contain one another. Two gates compared: **frequency** (total mentions across the transcript) and **IDF**
(`log(rows / df)`).

An **attention event** is a floor where an entity returns after a gap of at least 8 rows. The ground truth
is that entity's own earlier floors, older than the gap — defined **without reference to either gate's
score**. The metric is whether the gate's top-B floors contain a ground-truth floor.

### Result 1 — H1 is refuted

| budget B | frequency | IDF |
|---|---|---|
| 1 | 0.368 | 0.368 |
| 2 | **0.632** | 0.526 |
| 4 | **0.842** | 0.579 |
| 8 | 0.842 | 0.789 |
| 16 | 0.947 | 0.947 |

n = 19 events. At B=8 the paired difference was −0.053 with a 95% interval of [−0.332, +0.227], crossing
zero, and IDF won only 3 of 19 events. **The frequency gate is at least as good at every budget and clearly
better at B=2 and B=4.** The prediction in v1 §10 — *"an IDF gate finds planted long-range detail far
better than a frequency gate"* — is **not supported**.

**A control that did pass**: at B=8, taking simply the *most recent* floors scores **0.474**. Both gates
beat that, so entity-based retrieval carries real signal. It is the choice *between the two scores* that
the data does not support.

### Result 2 — H2 is undecidable here, for a structural reason

Fraction of entity groups already present in the rendered state block, against how many memories the block
carries:

| memories carried | 10 | 25 | 50 | 76 (live) |
|---|---|---|---|---|
| entities already carried | 0.40 | 0.60 | 0.85 | **1.00** |

**At the live block size every entity group is already in the prompt.** There is nothing for a retrieval
gate to add, so "which gate is better" has no discriminating power. H2 is not refuted; it is unmeasurable
until the state block is forced to drop things.

### Result 3 — the gate's job was mis-stated, and this is the real finding

Results 1 and 2 are the same result. Retrieval does not exist to find what the state block *missed* — at
these lengths it misses nothing.

> **Retrieval is the overflow mechanism of a bounded state block.** It exists to recover what the budget had
> to drop, and its work begins where the carried fraction falls below 1 — which the sweep puts between 50
> and 76 memories carried, i.e. exactly where the 12,000-character state cap binds.

That reframes the gate: it should aim at **the memories that fell outside the budget**, not at "surprising
entities" in general. It also explains the failed prediction: *long-range detail* in the original phrasing
meant **rare** detail, while what actually returns after a gap is disproportionately the **frequent** cast.
The two hypotheses were about different jobs and had been conflated:

- **frequency** answers *who or what is going to matter again* (salience);
- **IDF** answers *which token is a distinctive key* (matching).

They are not competing scores for one gate. The likely design is **frequency for the gate, IDF for the
key** — which preserves the spirit of H2 (two readouts from one distribution) with the roles **swapped**
from what v1 proposed.

### Result 4 — an A1 defect and an IDF failure mode

- **89 raw entity names collapse to 20 groups** — roughly 4.5 names per thing. Any index built on the
  registry as-is is noisy, and canonicalisation is a *prerequisite* for the gate, not a detail.
- **IDF promotes imported setting vocabulary.** Its top five are 路引, 灰絮之症, 怀表, **eldoria**,
  **shadowfang** — the last two are English world-book names inside an otherwise Chinese transcript.
  Rarity alone rewards any rare token, including irrelevant imported ones, so a relevance filter is needed
  before IDF can be trusted.

### What this changes

H1 is dropped as stated. A2 is re-scoped to the budget-overflow question, which cannot be measured until a
corpus exists where the state block is saturated. Entity canonicalisation is promoted to a prerequisite.
See `22_plan_after_compression.md` v2.

<!-- VERSION 3 -->
## v3 - 2026-09-12 05:40:01 - v2's entity number was an artifact, A0 would make matching worse, and the gate does not beat recency

Everything below is measured on the same live acceptance chat (55 rows, **53 of them folded**, 28 assistant
floors, 76 memories, 73 active). **Zero model calls.** Probes:
`remove/.audit-v55/live-check/expr-a1-entities.js`, `expr-a2-breakdown.js`, `expr-a2-gate.js`,
`expr-a2-diag.js`, `expr-a2-compose.js`, `expr-a2-spine.js`.

### Correction — v2 Result 4's entity count was a measurement artifact

v2 reported "**89 raw entity names collapse to 20 groups**". That is wrong on both numbers and on the
conclusion. The probe counted `entity_registry` **keys** as names (they are `ent_<hash>` identifiers), never
read the rows' `canonical_name` or `aliases`, and grouped names by **substring containment**.

| | v2 claimed | measured |
|---|---|---|
| raw names | 89 | **44** from `memory.entities`; **46** registry rows (a superset) |
| "groups" | 20 | **25** containment clusters — but containment is not co-reference |
| registry merging | implied | **46 of 46 rows are trivial**: `aliases.length <= 1` |

`registerEntity` merges only on **exact normalised name equality**, so the registry has never canonicalised
anything. That much of v2 stands, and it is the real defect.

**What does not stand** is the fix v2 derived from it. The containment cluster that produced the "20" is:

> 灰烬港贫民区井巷 · 灰烬港贫民区水井 · 灰烬港贫民区 · 灰烬港药铺 · 贫民区药铺 · 井水样瓶 · 井巷水井 ·
> 药铺后巷 · 药铺掌柜 · 灰烬港 · 贫民区 · 井水 · 井台 · 井巷 · 药铺 · 井

That is not one thing. It is a port city, its slum district, an alley, a well platform, the water, a sample
bottle, a shop, and a shopkeeper — a **place–object–person hierarchy whose names happen to nest**. Collapsing
them would merge a city with a water bottle. The same holds for 弥拉 / 弥拉的手札 / 师父手札 (a person and her
notebook) and 钟楼 / 钟楼旅店 / 钟楼钥匙 (a tower, an inn, a key).

### A0 as specified would make matching worse, not better

Measured, not argued. Replacing every entity name with its containment-group head (the longest name in the
group) — which is what v2's A0 amounts to — **reduces** the number of memories that entity-match the
production query from **12 to 8** out of 500 scored rows. Collapsing to the longest surface form makes the
key *rarer in the query*, so it matches less.

> **The transform the index needs is the opposite of canonicalisation: expand each name to its head
> morpheme, so a turn mentioning 井台 still reaches a memory tagged 井水样瓶. Identity stays strict;
> matching gets permissive.**

The registry's exact-match rule is *correct for identity* (holders, discriminators, `known_by`) and should
not be relaxed. The two layers want opposite things and must stay separate.

### A2, answered: the gate does not beat recency

v2 re-scoped A2 to "when the state block drops memories, does a gate recover them better than taking the most
recent floors?" The state cap is a **setting**, so the overflow regime can be induced on the existing chat
instead of waiting for a 46-floor corpus. Ground truth is free and machine-generated: the certificate names
the memories it requires (`state.omitted` ∪ `commitment.missing`), and the gate is ranked **only inside the
dropped set**.

v2's probe had a second defect worth recording: it built the query from non-`is_system` rows, which on this
chat is **2 rows of 55**, because folding marks 53 rows `is_system`. `isDialogueRow` deliberately counts
folded rows as dialogue; the probe did not. The corrected query is production's own
`buildQueryVariants(chat, 3)` — focus 473 chars, context 872 chars.

| state cap | dropped active | required | gate@3 | recency@3 | gate@8 | recency@8 |
|---|---|---|---|---|---|---|
| 4500 | 20 | 2 | 1 | 1 | 1 | 1 |
| 3500 | 32 | 2 | 1 | 1 | 1 | 1 |
| 2500 | 44 | 6 | 2 | 2 | 3 | **4** |
| 1200 | 62 | 21 | 2 | 2 | **4** | 3 |

**No advantage for the gate at any budget, and recency wins the one cell with enough positives to matter
(cap 2500, B=8).** H1's refutation therefore generalises from "frequency vs IDF" to **"any lexical gate vs
recency"** on this corpus.

**And there is a structural reason, which is the useful part.** Only **12 of 500** scored memories receive
an entity match on the production query. The query is built from recent dialogue, and the recency arm already
prefers recent memories — so *relevant* and *recent* coincide **by construction**. A gate can only beat
recency if its query carries something recency does not, and a window of recent turns does not.

### New — where the budget actually breaks

Sweeping `current_state_context_max_chars` and running the production assembler and certificate at each
budget:

| state cap | tokens | state | commitment | causal | tcausal | active dropped |
|---|---|---|---|---|---|---|
| 12000 (live) | 7735 | 12/12 | 23/23 | 3/3 | 14/16 | **0** |
| 7000 | 7635 | 12/12 | 23/23 | 3/3 | 14/16 | 0 |
| 6000 | 6888 | 12/12 | 23/23 | **1/3** | 12/16 | 11 |
| 5500 | 6504 | 12/12 | 23/23 | 1/3 | 12/16 | 11 |
| 4500 | 5763 | 10/12 | 23/23 | 1/3 | 10/16 | 20 |
| 2500 | 4263 | 6/12 | 23/23 | **0/3** | 6/16 | 44 |
| 1800 | 3761 | 6/12 | **17/23** | 0/3 | 6/16 | 53 |
| 1200 | 3349 | 4/12 | **8/23** | 0/3 | 4/16 | 62 |

Three facts the curve establishes:

1. **The drop rule prioritises correctly.** Commitment holds at 23/23 down to a 2,500-character cap and only
   breaks below 1,800 — **last**, which is exactly the promised ordering. `stale` and `leaks` are 0 at every
   budget: soundness is budget-independent.
2. **Causation fails first.** `causal` collapses from 3/3 to 1/3 at a 6,000-character cap **while state is
   still perfect**. It is the only dimension that fails before any state omission.
3. **The certificate under-reports loss by roughly 8×.** `state` is defined over **slot-bearing** memories:
   12 of 73 active. At a 2,500-character cap **44 active memories are dropped and the certificate flags 6**.
   `state 6/12` is not a statement about the store; it is a statement about a twelfth of it.

### New — the change chain was the first casualty, for want of 694 characters

The chain renders at **90.2%** of the state block, i.e. last. It was appended **after** the assembler had
already spent the whole cap, so `budgetPromptPair` removed it wholesale the moment the budget bound:

| state cap | chain present | chain chars | causal |
|---|---|---|---|
| 12000 / 8000 | yes | 694 | 3/3 |
| 7000 | yes, truncated | 606 | 3/3 |
| **6000** | **no** | 0 | **1/3** |

**694 characters — about 450 tokens — is the entire difference between a broken and an intact causal
record.** The chain's own configured budget is 4,000 characters and it never used more than 694 of them.
The design intent ("a tail trim removes it before it can remove the mandatory rows") was a reasonable
guess that the measurement contradicts: causation is one of C3's five dimensions, and its only carrier was
being spent first to save rows the certificate does not check.

**Fixed** — see `22_plan_after_compression.md` v3 and change_log entry 10.

### New — where the reference block actually goes

The reference block is a **hard 4,000 characters and is truncated** (it ends with
`…[reference truncated by combined budget]`). Its composition:

| part | chars | share |
|---|---|---|
| preamble / imported setting text | 457 | 11% |
| **hierarchical narrative summary** | **2,409** | **60%** |
| `<memory>` rows from recall | 1,130 | 28% — **5 rows fit** |

Recall selects **6** memories (`last_recall_debug.selected`), and **5** reach the prompt. So the binding
constraint on this chat is **not** the 12,000-character state cap — which has 4,912 characters of headroom —
but the 4,000-character reference block, 60% of which is narrative. Any future retrieval design has to
argue for its budget against that 2,409.

### What this changes

A0 is **redesigned** from canonicalisation to head-morpheme expansion. A2 is **answered** (null: no gate
beats recency on this corpus) and its successor question is where the gate's query comes from, since a
recent-dialogue query cannot by construction outrank recency. The certificate's coverage gap and the
reference block's composition are both promoted from "unknown" to measured inputs.

