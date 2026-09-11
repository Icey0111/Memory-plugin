# What To Do Next, After The Compression Discussion

<!-- VERSION 1 -->
## v1 - 2026-09-12 05:12:56 - the plan, the stop-doing list, and the acceptance criteria

### What changed since `19_next_steps.md`

`19`'s plan was declined and its open decisions are moot. `21_memory_thesis.md` replaced the framing.
The compression discussion then changed three things about **what to build**:

1. **Compression and summarization are different operations.** DeepSeek-OCR reaches 96% recovery at
   10× by *re-encoding* rather than by summarizing — compression is not the same axis as loss of
   meaning. There are several compression–fidelity curves, not one.
2. **In this scenario the original is stored for free.** SillyTavern keeps `ctx.chat`; folding only
   excludes rows from the prompt. The scarce resource is **injected tokens**, not storage.
   **Therefore the compression-rate knob applies to the gist layer alone**, and the verbatim layer
   costs nothing to keep and only costs to inject.
3. **The transferable artifact is the paired metric**: compression ratio × decodability. Both halves
   are already measured here — 2.25 / 1.09 / 0.71 / 0.52 / 0.41 at 10/20/30/40/50 floors, and
   `key_retention 23/23 = 1.00` — and they have never been plotted together.

---

### W0 — The ruler. Do this first; it costs nothing.

Produce the **compression–fidelity curve** as a standing artifact: compression ratio (memory tokens ÷
source tokens) against the certificate (the decodability analogue), per floor count, from
`getQualityReport` output that already exists.

- **Invariant**: both axes come from measurements already taken; no new model call, no new behaviour.
- **Why first**: every later item is judged by "did this move the curve", and right now the curve has
  never been drawn. One number in it is already notable — at ten floors the memory is **larger** than
  the source (2.25), crossing 1.0 near twenty floors.

---

### Phase A — measure the gate before building it

**A1 — index completeness audit.** Build `entity → floors` from the `entities` and `source_message`
already on every memory, and measure coverage, fan-out and reach.

- **Invariant**: every memory's `source_message` resolves to an existing turn; the index's floor set
  is a superset of the floors every memory claims.
- **Decides**: whether the last hop can be built on what is already extracted, or whether the
  extraction side must change first.
- **Cost**: zero model calls.

**A2 — the gate, measured not argued.** IDF gate versus frequency gate against planted probes.

- **Prediction to falsify**: the IDF gate finds planted long-range detail far better; the frequency
  gate is at least as good at identity. The two are complementary, not substitutes.
- **Discipline**: pre-registered thresholds, paired intervals, controls — the method the training
  project already uses. **No product code changes in this phase.**

**A3 — retrieval probes.** Plant K entities that recur after long gaps and measure whether the
original text is reachable at all, before anything injects it.

---

### Phase B — the last hop

**B1 — familiarity gate, deterministic, zero model calls.** Entities in the incoming turn scored by
**IDF × recency decay** against the registry. Fires generously.

- **Invariant**: a missed retrieval is unrecoverable within the turn and a spurious one costs tokens,
  so the gate's error budget is asymmetric by construction — **it may not be tuned to reduce false
  positives at the cost of false negatives.**

**B2 — selective un-hiding, structured injection.** Entity → `source_message` floors → restore those
rows **for one turn**, verbatim, inside a bounded budget.

- **Invariant**: injection happens **only** in structured, labelled, holder-scoped, bounded form.
  The measured 0% result — the same fact ignored when it lived only in prose — is the failure mode.
- **Mechanism already exists**: `unfoldFloorsNotCovered` restores rows today; it does it for safety,
  not to answer a question.

**B3 — the fold invariant.** Replace *"every hidden floor has a stand-in"* with *"every hidden floor
is still retrievable, and the retrieval path is verified"*.

- **Invariant**: for every hidden floor, the gate can be shown to reach it from at least one entity,
  or the floor is restored. **This is the certificate the thesis actually requires**, and today
  nothing checks it.

---

### Phase C — the gist layer

**C1 — the situation-model batch row.** Replace the 400-character truncation (≈39 characters per
floor, oldest-first) with **selection across the five dimensions** — time, space, causation,
protagonists, intention — from fields the extraction records already carry.

- **Invariant**: every dimension is either present or explicitly empty; the row is bounded; the row
  **doubles as the index entry** for its floors.
- **Why it is cheap**: no model call, and it removes information the retrieval layer makes redundant.
  Under this thesis the gist row does not need to carry detail — only the situation model.

**C2 — entropy-jump boundaries.** Replace the fixed `summary_level1_every_turns` boundary with an
entity-distribution entropy jump **only if H3 passes**.

- **Invariant**: batch boundaries are reproducible from the transcript alone.
- **Consequence if it holds**: it removes the fixed batch size *and* the compression rate derived from
  it, because batch size becomes a function of the story rather than a constant.

---

### Phase D — enhancements, in priority order

**D1 — the vector collection.** Fix `vector.stale`. This is an *enhancement* for relevance that names
nothing, not a prerequisite: the entity chain does not depend on it.

**D2 — abstention.** LongMemEval's fifth ability, and the one this plugin has no notion of. The gist
pole is certified; "I do not know" is not represented at all.

**D3 — baseline headroom.** `mandatory_baseline_limit: 24` sits at **23/24**. The next never-drop
memory loses its guarantee. Measure what actually happens at 25 before deciding whether the cap or
the ranking is wrong.

---

### Phase E — external validation

Run the plugin against **LongMemEval's five abilities** — information extraction, multi-session
reasoning, temporal reasoning, knowledge updates, abstention. Supersession already covers the fourth
and nothing covers the fifth; a benchmark number is worth more than a self-authored one, because it
is comparable to the field's 30% drop.

---

### The stop-doing list

Explicitly **not** in this plan, and why:

| not doing | why |
|---|---|
| a model judge/router holding the veto | C5: the failure this project exists to prevent is a *missed* retrieval, and it is unrecoverable within the turn. The model may rank and trim only. |
| L2/L3 narrative merging (`19`'s N3) | the gist row does not need reach; retrieval is what reaches. This was the single most expensive item in the declined plan. |
| a model-written batch narrative | same reason, plus it is the first thing that would add a component able to be wrong on its own. |
| porting a large retrieval pipeline | the entity chain is already half-extracted here; the pipeline is other people's solution to a problem this project does not have. |
| a per-turn model call of any kind | every call is billed to the user, and the gate is deterministic by design. |

---

### Acceptance criteria

The project can be said to work when, on a chat of at least 200 floors:

1. a planted **irreversible** fact from the first ten floors is present in its batch's situation-model
   row, with all five dimensions accounted for;
2. when its entity recurs at floor 200, the **original text** of its floor is injected, within budget,
   in structured form;
3. the reply demonstrably uses it, against a control where it is not injected;
4. the certificate stays green throughout — `key_retention`, `causal`, `violations`;
5. and the compression–fidelity curve from W0 shows where on it that happened.

None of this requires the vector collection, a model judge, or a narrative merge.

---

### Cost

Phases **W0, A1, A2, A3 and C1** are measurable or buildable with **zero additional model calls**.
Phase **B** adds deterministic code and one bounded injection per turn. Phases **D** and **E** are the
only ones with a real bill, and both are deferrable until the gate is shown to work.


<!-- VERSION 2 -->
## v2 - 2026-09-12 05:16:15 - A2 adjudicated: the gate's question changed

H1 and H2 were run (zero model calls). The full numbers are in `21_memory_thesis.md` v2. Consequences for
this plan:

**A2 is re-scoped.** As written it asked which score finds long-range detail better. That question is
**not decidable on a chat of this length**: the frequency gate was at least as good as the IDF gate at
every budget, and the reason is structural — at the live block size **100% of entity groups are already in
the prompt**, so neither gate has anything to add. A2 becomes: *when the state block is forced to drop
memories, does a gate recover them better than taking the most recent floors?* That needs a corpus where
the state cap binds.

**A new prerequisite, A0 — entity canonicalisation.** 89 raw entity names collapse to 20 groups (~4.5 names
per thing). No gate or index can be built on the registry as-is, and this is cheap, deterministic work.

**The gate's target changes.** Not "surprising entities" but **the memories that fell outside the budget**.
The gate is the overflow mechanism of a bounded state block, and that is also the first honest statement of
what retrieval is *for* in this plugin.

**C1 gains a constraint.** If IDF is ever used as a key, it needs a relevance filter: its top-ranked terms
in the live chat are 路引, 灰絮之症, 怀表, **eldoria**, **shadowfang** — the last two are English world-book
names in a Chinese transcript that have nothing to do with the plot.

**Unchanged**: W0, A1, B1–B3, C1's situation-model row, and the stop-doing list. Nothing here reopens a
model judge, a narrative merge, or a per-turn model call.

<!-- VERSION 3 -->
## v3 - 2026-09-12 05:40:01 - A0 redesigned, A2 answered null, and the budget is spent in the wrong order

Measurements and corrections are in `21_memory_thesis.md` v3. This version changes the plan and ships one
item from it.

### Shipped now — the change-chain reservation (was B3's neighbourhood, now B0)

**Done and tested.** `planSpineReservation` in `v55-spine.js`, called from `buildInjectedContextBundle`.
The change chain's characters are reserved **inside** the current-state cap instead of appended after it, so
the assembler absorbs the cut in its voluntary sections rather than the tail trim eating the causal record.

Why it was worth doing before anything else: the chain is **694 characters**, its configured budget is
4,000, and losing it drops the certificate's `causal` from **3/3 to 1/3** at a 6,000-character cap while
`state`, `commitment`, `soundness` and `epistemic` all stay green. Causation is one of C3's five
situation-model dimensions and this was its only carrier. The reservation is free whenever there is
headroom, so it costs nothing on an unconstrained turn.

Guards, all pinned by `test-v55-spine-reservation.mjs`: the effective cap may never fall below
`SPINE_STATE_FLOOR` (800 — the assembler's own clamp floor, which would otherwise silently undo the
reservation); `spinePromptBlock` refuses to render below its own 120-character floor and can therefore
return *more* than asked for, so an oversized small-reservation is discarded rather than accepted; a store
with no chain leaves the cap untouched.

### A0 is redesigned — expand, do not canonicalise

v2's A0 said "entity canonicalisation" on the strength of "89 names → 20 groups". **That number was an
artifact** (folding in `ent_*` registry keys and grouping by substring containment) and the transform it
implied is **measured to make things worse**: collapsing each name to its group head drops entity matches on
the production query from 12 to 8 out of 500 rows.

The failure is conceptual. Containment is not co-reference — the "group" contains a port city, its slum, an
alley, a well, the water, a sample bottle, a shop and a shopkeeper. So:

- **identity stays strict.** `registerEntity`'s exact-normalised-match rule is correct for holders,
  discriminators and `known_by`, and must not be relaxed. The registry's real gap is that it has never
  merged anything (46 of 46 rows are trivial), which is a *record* of extraction's vocabulary, not a bug to
  paper over.
- **matching gets permissive.** The index key becomes the name's **head morpheme**, so a turn mentioning
  井台 reaches a memory tagged 井水样瓶, and 弥拉 reaches 弥拉的手札 without merging them into one entity.

A0 is therefore: build a **derived, read-only matching index** over head morphemes, leave the registry alone.
Cheap, deterministic, and it does not touch identity.

### A2 is answered, and the answer is null

The state cap is a setting, so the overflow regime was induced on the existing chat instead of waiting for a
46-floor corpus. Ground truth is machine-generated by the certificate. **The gate does not beat recency at
any budget**, and recency wins the one cell with enough positives (cap 2500, B=8: recency 4, gate 3).

**The structural reason is the actionable part.** Only 12 of 500 scored memories receive an entity match on
the production query, and the query is built from **recent dialogue** — so *relevant* and *recent* coincide by
construction and the gate has no way to outrank recency. **The successor question is not "which score" but
"where does the gate's query come from".** Candidate sources, in order of cost:

- **A3a — query from the state block's open items** (commitments, active conditions) rather than from recent
  turns. Zero model calls, and non-recent by construction.
- **A3b — query from the last user message only.** 65 characters on this chat, and already measured to score
  10 memories with a 4.92 gap between rank 1 and rank 4 — a far sharper distribution than the 872-character
  context variant (282 vs 42, but 241 of that gap is one row).
- **A3c — a model-formulated query.** Deferred; it is the only one with a bill, and the user pays it.

A2's original wording is retired: it was answered, not deferred.

### New — the certificate's coverage gap becomes an explicit plan item (D4)

`state` is defined over slot-bearing memories: **12 of 73 active**. At a 2,500-character cap, 44 active
memories are dropped and the certificate flags 6. A sufficiency metric that sees a twelfth of the store
cannot be the acceptance test for a retrieval feature. D4: extend the certificate's sufficiency set from
"live slots" to "every active memory", or state the narrow scope in the certificate itself so the number is
never read as global.

### New — the reference block is the binding budget, not the state cap (D5)

The reference block is a hard 4,000 characters and truncated, and **60% of it is the narrative summary**
(2,409 of 4,000; setting text 457; memory rows 1,130 fitting 5 of the 6 recall selected). The state cap has
4,912 characters of headroom. D5: decide the reference split deliberately — recall currently gets whatever
is left after the narrative, and the narrative is the one part no measurement has ever argued for.

### C1 gains a second constraint

C1's batch row was to carry C3's five dimensions by *selecting structure instead of cutting prose*. The
change-chain finding sharpens it: **causation needs a reserved carrier, not a share of one.** Whatever C1
renders, the "why is it like this" record must not be the thing a tail trim removes first.

### Unchanged

The stop-doing list, W0, A1 (now done — see 21 v3), B1, B2, C1's situation-model row, and the cost rule:
**no per-turn model call, and no model output may mean "do not retrieve".**

