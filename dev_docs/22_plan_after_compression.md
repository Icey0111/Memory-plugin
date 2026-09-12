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

<!-- VERSION 4 -->
## v4 - 2026-09-12 06:05:00 - the corpus exists, the gate question is closed, and compression becomes the binding constraint

Measurements and the correction of this version's own first draft are in `21_memory_thesis.md` v4.

### The corpus was already on disk

v2 and v3 kept saying A2 "needs a corpus where the cap binds". Scanning every chat the host owns found one
immediately: `Seraphina - 2026-09-11@22h56m08s521ms`, 101 rows / 51 assistant floors / **224 memories / 197
slot-bearing**, against the acceptance chat's 28 floors and 12 slot memories. **No corpus had to be built;
nobody had looked.** Every future "we need different data" claim in this plan now has to survive
`node chat-scan.mjs` first, which lists every chat with its store size in one command.

### A3a and A3b are closed

Both were tested on the real corpus, alongside recency, the production dialogue query, and a random baseline:

| cap | required / dropped | recency@8 | dialogue@8 | state@8 | lastUser@8 | random@8 |
|---|---|---|---|---|---|---|
| 12000 | 128 / 142 | 0.039 | 0.039 | 0.039 | 0.055 | **0.056** |
| 9000 | 146 / 163 | 0.034 | 0.034 | 0.041 | 0.048 | **0.049** |
| 7000 | 157 / 174 | 0.032 | 0.032 | 0.038 | 0.045 | **0.046** |
| 4500 | 172 / 192 | 0.041 | 0.029 | 0.029 | 0.041 | **0.042** |
| 2500 | 184 / 204 | 0.038 | 0.027 | 0.033 | 0.038 | **0.039** |

Every arm at or below chance, at every cap. **This is not a verdict on the query sources; it is a verdict on
the target.** 90% of dropped memories are certificate-required, so recall@B is about B/|D| for any ordering.
The gate question **cannot be answered with the certificate as ground truth** and is closed rather than
deferred.

**A3 is redefined for the last time.** Not "recover what the budget dropped" — that target is 90% of the pool
and unrankable. The gate's real and only job is the **narrow named-thing lookup**: the current turn named
something specific, go get it. That target is small by definition, and testing it needs ground truth that is
small too — a planted fact, or a held-out turn whose content is known to depend on one memory. **H4's
protocol, not the certificate's.**

### The binding constraint is capacity, and it now has a number

At the default 12,000-character cap the block carries **69 of 197 slot values (35%)**, and it is already
rendering 11,965 of 12,000 characters. Rendering all 197 in the current one-row-per-memory form needs about
**27,300 characters**. So:

> **The state block needs ~56% compression to be sufficient at 51 assistant floors.** No retrieval design
> reaches that, because retrieval selects and selection is not a capacity mechanism.

Where the 12,000 characters go today, measured: **69% row text, 31% row labels** — but only 5% is the repeated
`owner.` prefix and 5% the repeated `kind:`. Hoisting both is worth **1,048 characters, about 7.5 extra
rows: 4% of the gap.** It is worth doing and it is not the answer.

(This version's first draft claimed 3,004 characters and 22 rows from label hoisting. **Wrong** — the sum was
taken over the 4 distinct owners instead of the 81 rendered rows, overstating the saving fivefold. Corrected
above. It is the same class of error as v2's "89 names", which is why both are written down rather than
quietly fixed.)

### Plan changes

- **C1 is promoted to the critical path and given a target: 56%.** It is no longer "the situation-model row";
  it is *the* mechanism by which the state fits. Its acceptance test is now concrete — the same 197 slot
  values, rendered at a fidelity the certificate still scores green, inside 12,000 characters.
- **A3a and A3b: closed**, with the table above. The gate's scope narrows to the named-thing lookup and its
  test protocol becomes H4's.
- **New defect, undiagnosed: `causal` is 9/16 at a 20,000-character cap** with the block nowhere near tight.
  Seven chains are broken structurally, not by pressure. v3's reservation fixed the *budget* failure mode; this
  is a different one. Do not assume the chain renders what the certificate needs.
- **New D6: the certificate's ground truth cannot test retrieval.** `state` is a binary sufficiency ideal over
  every live slot, which is 90% of any dropped set at scale. Any future retrieval experiment needs a small,
  independent target — not this.
- **`chat-scan.mjs` is a prerequisite for any "we need more data" claim.** It reads the store straight
  from each chat file, so it costs nothing and needs no browser. Writing it also caught a real trap: the store
  is serialised **columnar** on disk (`v55-store-compact.js`), so a naive `Object.values(store.memories)`
  returns the four structural keys and reports a memory count of **4** for a chat that holds **224**. The
  script now decodes both shapes and reproduces the live counts exactly.

### Unchanged

The stop-doing list, the cost rule (**no per-turn model call; no model output may mean "do not retrieve"**),
B1/B2, and the verification discipline: measure on the real app, and write down the corrections.

<!-- VERSION 5 -->
## v5 - 2026-09-12 06:45:00 - the trim now removes the least consequential memory, and the weight table is the open question

Measurements and the negative result are in `21_memory_thesis.md` v5.

### Shipped — the state block is emitted in canonical priority order

**Done, tested, verified live.** `buildCurrentStateBlock` no longer assembles fixed topical groups in a
fixed order. It emits every live memory in **non-increasing canonical weight** and changes the heading when
the group does, so the tail trim removes the least consequential memory instead of whichever group happened
to be written last.

The two were the same bug: the old `Active conditions / relations / ownership` group held `state` (weight
7), `relation`/`ownership` (4) and `belief` (2) together, and **a group that spans three weight bands
cannot be emitted in weight order at all.** So the group was split into `Current state`,
`Relations / ownership` and `Beliefs / expectations`.

Verified live on the 51-floor chat: knowledge rendered **0/46 → 46/46** at the ceiling and 1/46 → 32/46 at a
20,000 cap; commitments **13/13 at the default cap**; `tcausal` **16/40 → 32/40**. The missing set is now
exactly the two lowest-weight kinds.

### C1's target is unchanged, and now correctly located

Deterministic text compression was sized before anything was built, and it does not reach 56%:

| strategy | chars for 197 rows | saving |
|---|---|---|
| today | 27,983 | - |
| hoist the shared slot prefix | 25,483 | 9% |
| + collapse near-duplicate texts | 25,483 | **0%** |

There are no near-duplicates to collapse. So **C1 stays at 56% and stays on the critical path**, but the
honest statement of what it is has changed: it is not "make the state fit", it is "carry more of the state in
the same budget". The ordering fix does not shrink the gap; it decides what falls in.

### A design rejected on evidence

v4's own framing suggested splitting `belief`/`knowledge` (111 rows, 61% of the full render) out of the
always-on block. Measured, their entities are re-mentioned **more** often than the core kinds' (0.55 vs
0.44), so the split would have been a preference dressed as a design. **Closed.**

### Promoted — the weight table is now the first thing to validate

`CANONICAL_KIND_WEIGHT` used to break ties inside a fixed group order. It now fully determines what
survives, and two entries look wrong:

- **`world_delta` (weight 1) is never rendered at any budget**, and one of the four is an ongoing threat
  ("Shadowfang still remembers the player's scent"). That is not the least consequential thing in the store.
- **`belief` (weight 2) is effectively never rendered** (2 of 65 at the default cap) despite having the
  highest measured reuse rate.

**New work item, ahead of further compression: D7 - validate the weight table.** The inputs a measurement can
supply are now all in hand - reuse rate, dormancy (median floors until reuse), irreversibility rank, and the
certificate's per-kind effect - and none of them was available when the current numbers were chosen. The
ordering fix is correct whatever the table says; the table is what to argue about.

### Unchanged

The stop-doing list, the cost rule, B1/B2, C1's 56% target, A3's narrowing to the named-thing lookup, and the
verification discipline: measure on the real app, and write down the corrections.



