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

<!-- VERSION 4 -->
## v4 - 2026-09-12 06:05:00 - on a real 51-floor chat the state block is 65% short, and no gate can fix that

v3 tested the gate on the 28-assistant-floor acceptance chat and concluded "no gate beats recency". That
chat turned out to be the wrong corpus for a second reason: at its size **nothing overflows**. Scanning every
chat the host owns found the corpus the question needs:

| chat | rows | assistant floors | memories | active | slot-bearing |
|---|---|---|---|---|---|
| acceptance chat (v2, v3) | 55 | 28 | 76 | 73 | 12 |
| **`Seraphina - 2026-09-11@22h56m08s521ms`** | **101** | **51** | **224** | **217** | **197** |

The second is 1.8x the floors and **16x the slot-bearing memories**. Everything below is measured there.
Probes: `expr-open224.js`, `expr-a2-breakdown.js`, `expr-a3-arms.js`, `expr-state-compose2.js`.

### The state contract fails at this length, and the certificate says so

Sweeping the state cap on the 51-floor chat:

| state cap | tokens | state | commitment | causal | tcausal | active dropped |
|---|---|---|---|---|---|---|
| 20000 | 14143 | 112/197 | 15/15 | 9/16 | 16/40 | 92 |
| **12000 (default)** | **9436** | **69/197** | **15/15** | **9/16** | **14/40** | **142** |
| 9000 | 7754 | 51/197 | 15/15 | 9/16 | 14/40 | 163 |
| 7000 | 6635 | 40/197 | 15/15 | 9/16 | 14/40 | 174 |
| 4500 | 5250 | 25/197 | 8/15 | 9/16 | 10/40 | 192 |
| 2500 | 4083 | 13/197 | 3/15 | 4/16 | 5/40 | 204 |

**At the default setting the block carries 69 of 197 slot values — 35%.** The certificate has been reporting
`state 12/12` on the acceptance chat because that chat only *has* 12 slot memories; on a chat of ordinary
length the same metric reads **0.35**, and the shortfall is not reachable by any budget that also leaves room
for dialogue: even at a **20,000-character cap the block is 112/197**, because the 197 rows need about
**27,300 characters** to render as they are written.

Two things survive, and they are the important ones. **`commitment` is 15/15 at every cap down to 7,000** —
the irreversible set is carried in full at the default, which is the promise that matters. And `stale` is 0
at every budget.

**A third thing does not survive, and is not a budget problem.** `causal` is **9/16 at a 20,000-character cap
with 19,965 characters rendered** — seven causal chains are broken with the block nowhere near tight. That is
structural, not pressure, and v3's reservation fix does not address it. Recorded as a defect to investigate;
not diagnosed here.

### The gate test, on a corpus where it finally has power

Ground truth is still machine-generated: the certificate's `state.omitted` ∪ `commitment.missing`, ranked
inside the dropped set. Four query sources plus recency:

| cap | dropped | required | ratio | recency@8 | dialogue@8 | state@8 | lastUser@8 | **random@8** |
|---|---|---|---|---|---|---|---|---|
| 12000 | 142 | 128 | 0.90 | 0.039 | 0.039 | 0.039 | 0.055 | **0.056** |
| 9000 | 163 | 146 | 0.90 | 0.034 | 0.034 | 0.041 | 0.048 | **0.049** |
| 7000 | 174 | 157 | 0.90 | 0.032 | 0.032 | 0.038 | 0.045 | **0.046** |
| 4500 | 192 | 172 | 0.90 | 0.041 | 0.029 | 0.029 | 0.041 | **0.042** |
| 2500 | 204 | 184 | 0.90 | 0.038 | 0.027 | 0.033 | 0.038 | **0.039** |

**Every arm is at or below random at every budget.** Paired bootstrap at B=8 (2,000 resamples) puts
dialogue−recency at [−0.016, +0.023] and state−recency at [−0.047, +0.047] at the default cap, and the
pattern holds at every cap. A3a (query from the state block's own content) and A3b (query from the last user
message) were both tested and both fail identically.

**The reason is the `ratio` column, and it is not a defect in the gates.** **90% of dropped memories are
required by the certificate.** When the target is 90% of the pool, recall@B is ≈ B/|D| for *any* ordering,
because there is almost nothing to rank *against*. A ranking cannot select "most of everything", so the
measurement is informationless by construction — and that is a property of the problem, not of the scorer.

### The conclusion this forces, and it revises v3

v3 said: *retrieval is the overflow mechanism of a bounded state block*. On a 28-floor chat that reads well,
where the overflow is a handful of rows. **On a real chat the overflow is 65% of the state**, and no ranking
recovers 65% of anything.

> **Retrieval is the mechanism for the last mile, not the overflow.** It answers "the current turn named
> something specific — where is it?". It cannot answer "the state does not fit", because that is a capacity
> problem and selection is not a capacity mechanism.

The capacity gap is now quantified rather than asserted: **197 slot rows need ~27,300 characters against a
12,000-character cap — 56% compression — and the block already renders 11,965 of 12,000.**

### A correction to this version's own first draft

The first draft of this version claimed the block spends **3,004 characters on repeated slot labels and could
fit 22 more rows** by hoisting them. **That was an arithmetic error** — the sum was taken over the 4 *distinct*
owners instead of the 81 rendered rows. Measured properly:

| | chars | share |
|---|---|---|
| row text | 7,742 | 69% |
| row labels (`[kind:slot] `) | 3,501 | **31%** |
| — of which the repeated `owner.` prefix | 584 | 5% |
| — of which the repeated `kind:` prefix | 576 | 5% |

Hoisting the owner prefix saves **553 characters, about 4 extra rows** at 139 characters per row; hoisting
kind as well saves **1,048, about 7.5 rows**. So **label micro-optimisation is worth 4% of the gap**, not the
31% the label share suggests. It is worth doing and it is not the answer. **The answer has to be compressing
the 81-character memory text itself**, which is C1's situation-model row and the compression-rate knob the
thesis already identifies.

### What this changes

The compression axis is promoted from "one of the phases" to **the binding constraint**, and it now has a
number to hit. A3a and A3b are **closed** (both tested, both at chance, and the reason is structural). The
gate's remaining honest scope is the narrow named-thing lookup, which still has to be shown to beat recency —
and on this evidence it will only do so when the target is *small*, which the certificate's binary sufficiency
definition can never produce.

<!-- VERSION 5 -->
## v5 - 2026-09-12 06:45:00 - the block was spending its whole budget on beliefs and never rendering knowledge

v4 established that the state block is 65% short at 51 floors and that no ranking fixes a capacity problem.
This version found why the shortfall lands where it does, and fixed it. Measurements on the same 51-floor
chat (101 rows, 217 live memories, 197 slot-bearing). Probes: `expr-c1-profile.js`,
`expr-c1-strategies.js`, `expr-c1-reuse.js`, `expr-c1-coverage.js`, `expr-c1-missing.js`,
`expr-c1-bykind.js`, `expr-c1-order.js`.

### Three compression strategies were sized, and two of them do not exist

Before touching anything, what could deterministic compression actually save?

| strategy | chars for 197 rows | saving |
|---|---|---|
| S0 today's one-row-per-memory render | 27,983 | - |
| S1 prefix tree (hoist the shared dotted slot prefix) | 25,483 | **9%** |
| S2 S1 + collapse near-duplicate texts | 25,483 | **0%** |

**S2 saved nothing: no two of the 197 memory texts are 80% token-contained in one another.** The store is
not bloated with restatements. And the prefix tree is only 9%, because a slot is `owner.category.name` and
the third segment is unique per memory - the repeated part is the leading owner, about 12 characters a row.

**Text compression cannot reach the 56% the capacity gap needs**, and these are the numbers that say so. The
remaining lever is not compression at all, it is *ordering*, which the next section found.

### The defect: the block renders every live memory and cuts the tail, and the tail was arbitrary

The block is capped at 20,000 characters by `clampInteger` regardless of the setting (a 40,000 setting is
silently clamped, which is why v4's sweep appeared to plateau). At that ceiling it rendered 129 of 197 slot
values. The 68 that never rendered were **not** a budget effect - they were a group that sat past the cut,
because the block emitted fixed topical groups in a fixed order:

> locations → present → conditions → commitments → knowledge → other

and `Active conditions / relations / ownership` was a **125-row grab-bag spanning canonical weights 7 down
to 2** (`state` 7, `relation`/`ownership` 4, `belief` 2). Emitted third, it consumed the entire budget by
itself. Measured at the ceiling:

| kind | weight | rendered before |
|---|---|---|
| knowledge | 3 | **0 of 46** |
| world_delta | 1 | **0 of 4** |
| commitment | 5 | 0 of 13 in its own group - alive only through the 24-slot Must-remember baseline |
| intention | 6 | 3 of 9 |
| belief | 2 | 52 of 65 - **emitted before any knowledge row could be reached** |

**The block was spending its whole budget on the lowest-weight kind it contains and never reaching a
higher-weight one.** That is the same failure the change-chain reservation fixed in v3, in a different
place: content the certificate requires, placed last, cut first.

### The fix, and it is an ordering fix

Rows are emitted in **non-increasing canonical weight** and the heading changes as the group does, so the
tail trim now removes the least consequential memory. For that to be possible at all the groups had to stop
spanning weight bands, so `belief` and `relation`/`ownership` were split out of the old conditions group
into `Beliefs / expectations` and `Relations / ownership`. A group that spans three bands cannot be emitted
in weight order, which is why the coarse grouping and the wrong trim were the same bug.

Measured after (slot values rendered, by kind):

| kind | weight | total | @12000 | @16000 | @20000 | ceiling |
|---|---|---|---|---|---|---|
| state | 7 | 58 | 47 | **58** | **58** | 58 |
| intention | 6 | 9 | 3 | **9** | **9** | 9 |
| commitment | 5 | 13 | **13** | **13** | **13** | 13 |
| relation / ownership | 4 | 2 | 2 | 2 | 2 | 2 |
| knowledge | 3 | 46 | 1 | 6 | 32 | **46** |
| belief | 2 | 65 | 2 | 2 | 2 | 6 |
| world_delta | 1 | 4 | 0 | 0 | 0 | 0 |

Every row is monotone in weight at every budget, which is the property that matters: a memory is never cut
while a less consequential one is still rendered. **Commitments are 13/13 at the default cap** instead of
surviving by accident through the baseline. **Knowledge goes from 0/46 to 46/46** at the ceiling and from
1/46 to 32/46 at 20,000. And the certificate's `tcausal` **nearly doubles, 16/40 to 32/40** at the ceiling,
because the causal questions needed rows that were never being rendered.

Total coverage: **129/197 → 135/197** at the ceiling, 112 → 117 at 20,000.

### A negative result that stopped a bad design

Before ordering, the obvious move was to stop injecting accumulated knowledge at all: `belief` (65) and
`knowledge` (46) are 111 of the 197 rows and **61% of the full render**, and they read as notes rather than
situation. That split would have fit the budget comfortably - the remaining 86 rows need 10,144 characters
against a 12,000 cap.

**It is not supported by the data.** Re-mention rate, counting only entities that are not the ubiquitous
cast, for each memory after the floor it came from:

| kind | n | re-mentioned | never repeated | median floors until reuse |
|---|---|---|---|---|
| belief | 73 | **0.479** | 0.493 | 4 |
| knowledge | 52 | **0.404** | 0.519 | 2 |
| state | 64 | 0.297 | 0.359 | 5 |
| commitment | 13 | **0.154** | **0.769** | **40** |

**The "deferred" group is re-mentioned more often than the "core" group** (0.55 vs 0.44), so scoping them
out would have been a preference dressed as a design. The table also shows why re-mention rate cannot be the
policy: commitments have the *lowest* re-mention rate and the *longest* dormancy, and they are the most
protected kind in the system. **A commitment is protected because of what it costs when it is silently lost,
not because it is used often** - the asymmetry the whole design rests on, now measured rather than assumed.

### The policy is now the weight table, and it was never validated

Before this change the group order dominated and the weight table only broke ties. Now the table fully
determines what survives, and two of its entries look wrong on inspection:

- **`world_delta` at weight 1 is never rendered at any budget** - and one of the four is
  `影牙.threat.tracking_player`, "Shadowfang still remembers the player's scent, so the road outside remains
  dangerous". An ongoing threat is not the least consequential thing in the store.
- **`belief` at weight 2 is effectively never rendered** (2 of 65 at the default cap), while its reuse rate
  is the highest measured.

This is recorded as the open question, not changed here: **the ordering fix is correct whatever the table
says, and the table is now the thing to argue about.** Choosing weights is a policy decision that a
measurement can inform - reuse rate, dormancy, irreversibility - but the current numbers are a first guess
from before anyone could see their effect.

### What this changes

The capacity gap is unchanged at ~56%: this fix does not make the state fit, it makes the block **lose the
right things** while it does not fit. C1's target stays. The weight table is promoted from an implementation
detail to the **first thing to validate**, ahead of any further compression work.

<!-- VERSION 6 -->
## v6 - 2026-09-12 07:20:00 - D7 answered: the weight table was never the problem, and two instruments were reporting green while checking nothing

v5 promoted "validate the weight table" ahead of further compression work. This version ran it, and the
question dissolved. Measurements on the 51-floor chat (101 rows, 217 active memories, 197 slot-bearing).
Probes: `expr-d7-orders.js`, `expr-d7-share.js`, `expr-d7-floor.js`, `expr-d7-samples.js`,
`expr-d7-signals.js`, `expr-d7-vacuous.js`, `expr-d7-verify.js`.

### Correction — v5's premise was wrong

v5 said the weight table "was never validated". **It was validated twice**, for two different questions,
and both validations are in the code with their reasoning:

| family | where | order (high to low) | the question it answers |
|---|---|---|---|
| **render priority** | `CANONICAL_KIND_WEIGHT` (v55-runtime), `kindWeight` (memory-core) | state > intention > commitment > relation/ownership > knowledge > belief > world_delta | what should the model see first? |
| **irreversibility** | `IRREVERSIBILITY` (v55-spine, mirrored in v55-certificate), `RECONSTRUCTIBILITY` (v55-forget) | commitment > relation/ownership > knowledge > intention/world_delta > state/belief | what cannot be rebuilt if removed? |

**Each family is internally consistent and each carries its own justification.** The spine's table says so
explicitly: *"This is deliberately not importance: importance is a judgement about the story,
irreversibility is a fact about the world. A promise cannot be unmade; a location changes again next turn."*
The forget table adds that a `state` record is the most rebuildable thing in the store.

What is actually wrong is narrower and sharper: **`CANONICAL_KIND_WEIGHT`'s comment claims "the most
consequential kinds first" and never defines consequential** - and for `state` it is the exact inverse of the
only principled ranking in the codebase. The render order was never *decided*; it was inherited.

### Both orders were measured, and the guarantee is not at stake

At the default 12,000-character cap:

| kind | render priority (current) | irreversibility order |
|---|---|---|
| state | **64 / 64** | 0 / 64 |
| knowledge | 1 / 52 | **52 / 52** |
| intention | 9 / 9 | 9 / 9 |
| commitment | 13 / 13 | 13 / 13 |
| world_delta | 0 / 4 | **4 / 4** |
| belief | 1 / 73 | 4 / 73 |
| relation / ownership | 1 / 1, 1 / 1 | 1 / 1, 1 / 1 |

**Both retain the certificate's protected set identically** (commitment 13/13, relation 1/1, ownership
1/1), so the promise this plugin actually makes is unaffected by the choice. The trade is purely
state-versus-knowledge.

**Decision: keep the render order.** `state` is the only kind whose loss produces an immediate,
mechanical contradiction - a wrong location or condition makes the very next reply wrong - while a lost
knowledge or belief row makes the character less informed, which the scene can repair. Recorded as a
decision with its criterion rather than left as an inheritance.

**Two mechanisms for avoiding the choice were simulated and both rejected.** A per-kind share cap
redistributes the budget but still starves whichever kind is last: `world_delta` renders 0 of 4 at every
share setting from 60% to 33%. A two-pass floor in its natural form breaks the protected set outright
(commitment 13/13 drops to 5/13), and in a corrected form only trades one starving kind for another. A
floor is also the wrong instrument for the problem it was meant to solve - see below.

### The real finding: the priority is a function of an unreliable classifier

The floor idea came from wanting to protect mis-classified rows, and the samples say that is the actual
defect. `kind` is assigned per-memory by the extraction model with no consistent definition, and the four
`world_delta` rows in this store are:

- an ongoing threat - "Shadowfang still remembers the player's scent, so the road outside remains dangerous";
- **where a mentor's notebook is hidden** - a knowledge fact;
- a dried root tucked in that notebook's binding - a physical detail;
- an apothecary being emptied three days ago - an event.

And `belief`, ranked second-lowest, holds the character's live deductions: *"Seraphina infers that if the
grey breath really reached the well water, it was not carried by wind - someone prised the well open; people
who draw water do not chisel the rim."* **That is the plot.** Meanwhile `state`, which consumes 71% of the
default budget, holds "the player character is currently inside the dwelling".

**Tuning the numbers would encode this classifier's noise more precisely.** No weight table fixes a label
that means four different things.

### Two instruments were reporting green while checking nothing

Chasing the priority turned up something worse, and it is this version's most important result.

**`importance` is dead.** All 217 active memories are `'medium'`; **zero are `'critical'`.** Four call
sites special-case `'critical'` and can never fire: `v55-spine` twice (the spine's own ranking bonus and
the change chain's), `v55-boundary`'s never-repeat path, and `memory-core.getActiveMemories`'s
importance filter and tiebreak. The second axis of the entire priority system has never contributed
anything.

**`known_by` is empty on every memory in the store** - all 217, including all 52 knowledge rows. The
consequences:

| instrument | what it did |
|---|---|
| certificate `epistemic` | `checkable: 0`, `leaks: 0`, **`clean: true`** - reported a clean bill on nothing examined |
| T-Causal | declares **four** question kinds; generated 40 cases that were **all `why` (9) and `who_first` (31)**. `who_unknown` needs a holder set and produced none. |

Both are vacuous, and **both report success.** The certificate's own header says it "answers six questions
about one generation's projection"; two of the six could not be asked. That is the failure this instrument
exists to prevent - it is the project's substitute for a model judge, and a judge that returns "clean"
without looking is the thing it was built to replace.

**Two channels, one dead and one unused.** `importance` is dead, `known_by` is empty, `kind` is noisy -
and the store carries a fourth, rich signal nobody consults for priority: **`epistemic`**, distributed
`fact` 60, `belief` 52, `reported` 31, `inference` 30, `observed` 29, `plan` 15. That is a real
distribution over real distinctions (witnessed / deduced / told / planned), and it is orthogonal to kind.
The priority is one-dimensional in a store that is not.

### What shipped

- **The certificate cannot report an unexamined dimension as clean.** `epistemic.clean` is now `null`
  when nothing is checkable, with an explicit `checked` flag, following the file's own convention for an
  unmeasurable dimension (`state.rate`). `formatCertificate` prints `leak=not-checked` instead of the
  ambiguous `leak=0/0`.
- **T-Causal's absent question kinds are visible.** `scoreTcausal` already returned `by_kind`; the
  certificate was dropping it. It is now carried through, together with an `unexercised` list of declared
  kinds that produced no case, and the summary line names them.
- Pinned by `test-v55-certificate-vacuity.mjs`: an unexamined dimension reports `null`, never `true`;
  every declared T-Causal kind is either exercised or named, never both and never neither; and a holder set
  is what puts `who_unknown` back to work.

### What this changes

**D7 is closed, and it did not produce a new weight table.** It produced a decision (keep the render
order, criterion recorded) and a demotion: the priority's real weakness is that it rests on a single noisy
label. Two successors, in order:

- **D8 - make the priority two-dimensional.** Combine the kind ordering with `epistemic`, which is the one
  discriminating channel the store already carries and the priority ignores. Deterministic, no model call.
- **D9 - find out why `known_by` and `importance` are never populated.** Either the extraction contract is
  not asking for them, or it is asking in a way the model ignores. Until this is fixed, the certificate's
  epistemic dimension and T-Causal's `who_unknown` kind are decorative. This one may cost model calls and
  is therefore the user's call, not this plan's.




