# What To Do Next — The Narrative Layer Contract

<!-- VERSION 1 -->
## v1 - 2026-09-12 03:18:49 - the plan derived from the SP·数据库 comparison and this session's measurements

## Basis

Two evidence sources, both read this session.

**Measured on our own live chat** (`Seraphina - 2026-09-12@01h15m20s127ms`, 55 floors, 76 memories):

| quantity | value |
|---|---|
| source text, first 50 floors | 13,090 chars / 9,806 tokens (196/floor) |
| injected per turn | 7,885 tokens (reference 3,070 + current state 4,815) |
| injection ceiling | 16,000 chars = 12,000 state + 4,000 reference, about 11,600 tokens |
| fixed block overhead | 138 tokens (1.7%); per-memory overhead fell 76 -> 24 chars and floors at the label |
| marginal cost per live memory | about 90 chars; the state cap binds at about 130 memories (~user turn 49) |
| narrative nodes | 23 Level-1 rows for 28 completed turns; **18 cover one turn, 5 cover two** |
| narrative source | **`modelRows: 0`** — the deterministic per-turn digest is the whole tree |
| consolidation | **`l2: 0`, `l3: 0`** — no stage has ever been merged |
| raw floors in the prompt before the fold fix | 11 floors / 4,540 tokens; after: **1 floor / 400 tokens** |
| certificate now | state 12/12, stale 0, commitment 23/23, causal 3/3, T-Causal 14/16, violations 0 |

**Read from the reference project** (ACU `SP·数据库 9.2.5`, `AlbusKen/shujuku`, shallow clone):

- `FLIGHT_MODE_MAX_VISIBLE_CHRONICLE_ROWS_ACU = 15` (`src/shared/models/flight-mode-model.ts`), a hard-coded
  constant, not a user setting.
- The archive rule is text in the sheet schema (`src/service/flight-mode/big-summary-sheet-def.ts:54-58`):
  *only when currently visible chronicle rows reach 15 may one row be added, and the new row must summarise
  ALL currently visible rows — summarising only the newest few is forbidden*; existing summary rows forbid
  both update and delete.
- The hide is a **projection**: `hiddenRowIds` in state, applied at three read sites, never to the data
  (`big-summary-sheet-def.ts`, `update-orchestrator.ts:823` stages it with a rollback, `injection-engine-custom.ts:34`,
  `prompt-prepare.ts:201`, `if-block-parser.ts:36`).
- A second, independent window: the newest **50** chronicle rows are injected verbatim
  (`recentFixedInjectCount: 50` -> `summaryIndexRecentFixedInjectCount` -> `summary-vector-index-runtime.ts:855`).
- Summary rows are embedded and retrieved with BM25 + vectors + RRF (k=60), with a model-generated keyword
  query. Their narrative is retrievable; ours is not.

## Diagnosis

**Our certificate judges the state and ignores the narrative.** Of its six checks, `state` reads slot-bearing
memories, `commitment`/`causal` read the spine and the irreversible set, `epistemic` reads `known_by`, and
`cost` counts tokens. Nothing reads the summary tree. That single blind spot explains every narrative defect
found this session: 23 nodes where 3 were expected, a model summariser that has never run, a consolidation
layer that has never merged anything, and a 500-floor projection that would show only the newest ~20 turns.

The narrative layer did not break because it lacks features. **It has no contract, so it cannot be asked
questions**, and therefore nothing noticed it rotting for 28 turns.

## Core semantics — the constraint on any borrowing

| semantics | our implementation | consequence for borrowing |
|---|---|---|
| state is a slot map with supersession, not a log | `store.slots[slot] = id`; the replaced value stays as `closed`/`superseded` | facts are versioned by slot; the past is replayable, so a narrative node is never the only copy of a fact |
| every fact has a cause and a source | spine change chain + provenance registry + `source_message` | "why is it like this now" is decidable without a model |
| the prompt is a projection of the store, and the projection is bound by a certificate | two host prompt keys; six judge-free checks | **a new mechanism is only acceptable if it can be certified** |
| irreversibility is a first-class axis | mandatory baseline (bounded at 24 rows) + `NEVER_DROP_RANK` | guarantees stay structural, never instructional |

One sentence: **other systems project to make the prompt smaller; we project to make the state answerable.**

## A correction to an earlier claim in this session

An earlier message proposed "stop writing `is_system` and project the transcript away instead". **That is not
available to us.** The chat transcript is the host's, and SillyTavern assembles it from `ctx.chat`; the only
lever an extension has over it is the same one the host's own hide button uses — marking the row. The
reference project can project because its rows never enter the chat at all: they live in its database and it
owns the export. So the borrowable lesson is narrower and still worth having: **keep the hidden set
authoritative and verify it, rather than trusting per-row markers that can be lost.**

## What transfers, what does not

| | verdict |
|---|---|
| consumption-based archiving (batch = the visible set; consuming it hides it) | **take it** — it is the only thing that makes non-overlap structural |
| immutable, addressable narrative nodes | **take it** — a node that is never rewritten can be named, diffed and retrieved |
| the water level as the trigger ("unconsumed >= N"), not a clock | **take it** — but make N a setting; theirs is hard-coded 15 |
| projection-discipline for our own derived text | **take it** — for the summary and evidence channels we own |
| SQLite / table substrate | **reject** — our unit is a fact with a slot and a cause, not a row; cost is a 10 MB bundle plus sql.js WASM, and the certificate already decides our invariants |
| model-instruction-based guarantees | **reject** — their 15-row rule is largely prompt text; our S4 is structural |
| the vector-index apparatus (shards, packs, manifests, mirrors) | **reject** — theirs solves remote upload bandwidth and multi-device mirroring; ours is one local chat |
| narrative as the source of truth | **reject** — for us store = truth, narrative = derived; an immutable node must carry `source_ids` so every claim still traces back |

## Work items

Each item states the invariant it must satisfy, because an invariant is what makes it certifiable.

### N0 - Align the two windows (tiny, now)

`protect_recent_messages = 8` (rows) suppresses recall for the newest 8 rows *because they are assumed to be in
the prompt*, while `summary_fold_keep_recent_floors = 1` (floors) keeps only the newest floor raw. The rows in
between are excluded from recall and folded away. Today the complete state block covers them; at the state cap
they would fall through both.

- Change: keep at least `ceil(protect_recent_messages / 2)` floors unfolded, or lower `protect_recent_messages`.
- Invariant: the set of rows assumed present equals the set of rows actually present.
- Verify: live check of both settings and the unfolded floor count.

### N1 - Make the hidden set authoritative (small)

The fold audit is a derived key; when the derived record was lost the audit read `runs: 0, hidden: 0` while 33
rows carried fold markers, and it only recovered by scanning the rows. That recovery is a good fallback and a
bad primary.

- Change: the fold audit is written wherever `hiddenTurnIds` changes, and a rebuild is an explicit, tested path.
- Invariant: **the rebuild from row markers reproduces the audit exactly** (idempotent), and every hidden floor
  has a stand-in in the projection.
- Verify: a certificate check for fold coverage (this instrument exists as `floorFoldStatus` and is not wired
  into `getQualityReport`), plus a test that deletes the derived record and asserts the rebuilt audit is equal.

### N2 - Split coverage from narrative, and make the narrative a consumption batch (the core)

Today one layer does two jobs: the per-turn digest is both the fold-coverage certificate and the injected
narrative. That is why `summary_level1_every_turns` is dead — the digest marks every turn processed, so the
model batch loop's `pending.length < l1` guard is always true (`v55-summary-runtime.js:217-218`).

- Change: two layers. **(a) Coverage**: the per-turn digest rows stay, rebuildable, one per turn. **(b) Stages**:
  take the oldest **unconsumed** coverage rows once there are at least N of them, produce **one immutable stage**
  row carrying `source_ids`, and mark the batch consumed. N is `summary_level1_every_turns` and becomes a real,
  user-visible setting (floor, not exact count — the batch may be larger if the pass runs late).
- Invariant: **stages partition the completed turns** — pairwise disjoint, append-only (no stage is ever
  rewritten or deleted), and every turn covered by exactly one stage or by no stage yet.
- Verify: a certificate check for the partition (disjoint, monotone, total over consumed turns); a test that runs
  two passes and asserts the first stage's bytes are unchanged; a live check that node count falls from
  turns/1 to turns/N.
- Risk: medium. The digest currently rebuilds `level1` wholesale (`live.level1 = [...kept, ...built]`), so the
  rebuild path must learn to leave stages alone.

### N3 - Make the hierarchy actually merge (medium; costs model calls)

`l2: 0` and `l3: 0` after 28 turns. The `need = l2 * l1` compensation (`v55-summary-runtime.js:229`) exists only
because L1 was per-turn; once L1 is an N-batch it must go back to `l2`/`l3`.

- Change: restore the plain multiples; run L2 over stages and L3 over L2; keep a switch, because this is the
  only item that spends model calls (one per N turns).
- Invariant: **the hierarchy is total and the injected window reaches the beginning** — the earliest turn
  covered by the injected narrative text is turn 0 once enough history exists.
- Verify: a certificate check for the narrative horizon (earliest covered turn id); an offline test on a
  synthetic 500-turn tree.

### N4 - Make the narrative addressable (small, deterministic first)

`【查阅记忆】` already resolves a request against the live chat and the cold snapshot. Stages carry `source_ids`,
so a stage can be found by turn id **without** embeddings.

- Change: extend the evidence resolver to answer "which stage covers turn k" and to return the stage text.
- Invariant: **any covered turn id resolves to exactly one stage.**
- Verify: a resolver test plus a certificate check that every stage is reachable from its `source_ids`.

### N5 - Repair the memory vector index, then decide about indexing the narrative

Measured live: `collection_id: aetheria_v54_q99nk8`, `stale: true`,
`last_error: 请求空间 es1:14fzu5i 与已建索引 (missing) 不一致`. 35 of 76 memories are indexable and every
`vector_hash` matches, so the content is fine and the collection's space binding is not. Dense recall is
currently off; only lexical and temporal run.

- Change 1 (bug): rebuild the collection. Independent of everything above.
- Change 2 (decision): index stages only if N4 proves insufficient. Their design embeds summary rows; ours
  would be the same idea at a fraction of the apparatus, and the coarse-node risk they carry (one vector per
  row, hence per N turns) applies to us too.

## Sequencing

```
N0 (minutes)  ->  N1 (small)  ->  N4 (small)  ->  N5-bug (independent)
                                    \
                                     N2 (core, needs D1/D2)  ->  N3 (needs D4)
                                                                      \
                                                                       N5-decision
```

### The arithmetic that must not be forgotten

Staging alone does **not** fix the 500-floor window. 500 turns at N=15 gives 34 stages; at ~700 characters each
that is ~23,800 characters against a 3,520-character summary budget. What actually buys coverage is the
hierarchy: 34 L1 rows, then L2 over groups of ~7 gives 5 rows at ~700 characters = ~3,500 characters, which
covers all 500 turns. So N2 makes the units, and **N3 is what pays**. Doing N2 without N3 changes the shape of
the problem, not its size.

## Open decisions (these need a human)

- **D1 - is N a floor or an exact count?** Recommended: a floor (batch >= N), because the pass runs when it
  runs and a smaller trailing batch would either never be summarised or be summarised too early.
- **D2 - accept that the prompt holds up to N turns of raw text.** That is the direct consequence of a floor:
  turns that have not reached a batch are not yet consumed, so they stay visible. At N=15 that is roughly
  15 x 196 = ~2,900 tokens of raw text per turn, which is larger than the current 400 and must be accepted
  deliberately.
- **D3 - is the stage layer injected instead of the digest?** Recommended: yes — stages into the reference
  budget, coverage rows only as the fold certificate. Otherwise the same story is injected twice.
- **D4 - is one model call per N turns acceptable, and which model?** The reference project's own FAQ tells
  high-floor users to switch the archive to a fast model; ours would want the same escape hatch.

## Non-goals

- No SQL, table or WASM substrate. No new runtime dependency, no build step.
- No vector-index infrastructure (shards, packs, manifests, mirrors, remote upload).
- No guarantee that depends on a model obeying an instruction; every new invariant above is checkable by
  string and identifier comparison over the store and the projection.
- No change to the certificate's existing six checks' meaning. New checks are added alongside them.

<!-- VERSION 2 -->
## v2 - 2026-09-12 03:43:07 - status: declined, and why that is a defensible call

**The plan in v1 is not approved and will not be started.** The stated reason is the one that matters: the
narrative layer is the first item in this project's history that would *add* a layer rather than remove one,
and the risk of drifting away from an architecture that already works is judged higher than the coverage it
would buy.

That judgement is consistent with the evidence rather than in tension with it:

- Everything shipped in this session is subtraction — one state rendering instead of two, no write-only
  fields, no empty storage wrapper, a fold guard that now fires while an extraction is in flight, a recall
  cooldown that could not actually expire. The store fell 218,279 -> 154,949 bytes and the injected overhead
  per memory fell 76 -> 24 characters, with every certificate check unchanged.
- v1's N2 and N3 are the opposite: a new stage layer, a new setting whose direct consequence is holding up to
  N turns of raw text in the prompt, and one model call per N turns. That is architecture, and refusing it is
  a coherent position.

If this is ever reopened, the split that matters is **repair versus architecture**:

| item | is it architecture? |
|---|---|
| N0 — make `summary_fold_keep_recent_floors` follow `protect_recent_messages` | no: deleting a second default that disagrees with the first |
| N1 — derive the hidden set from the row markers and verify it | no: a check, not a layer |
| N4 — resolve a turn id to its stage | no, but pointless without N2 |
| N5-bug — the stale vector collection | no: a fault, and dense recall is already off |
| N2, N3 | **yes — declined** |

Nothing already banked depends on any of them. The tree is clean, the suite is 77/77 in ~20 s, and this
document exists so the analysis survives even though the work does not happen. D1–D4 are moot while v1 is
declined.

<!-- VERSION 3 -->
## v3 - 2026-09-12 04:01:24 - the repair half of N2 has shipped; the table in v2 was too broad

The user returned to this item and said it still mattered: *the one about summarising once every N
floors*. Investigating it found a defect that v2 had not, and the split in v2 turned out to be drawn in
the wrong place.

**What was found.** Level 1 was rebuilt on every pass from `digestRows` - the newest lines that fit
`summary_digest_max_chars` - and every digest row outside that window was discarded. Coverage was
therefore O(window): measured with the live chat's own event summaries, the window saturates at about 45
floors, and because a floor may only stay hidden while something stands in for it, `unfoldFloorsNotCovered`
restored every older floor as raw text. At 500 floors that is 445-456 raw floors, more text than the memory
system removes.

**What shipped.** Level 1 now seals floor-aligned batches of `summary_level1_every_turns` - a setting that
already existed, was already set to 10, and did nothing but set a boundary beat. A full batch becomes one
row with an id hashed from its floors; a part-full batch keeps one row per floor; a stored sealed batch is
carried verbatim while its floors still exist. No new settings, no new storage key, no new prompt key, no
model call. See `20_narrative_coverage.md`.

**The correction.** v2's table put N2 in the architecture column. The batching half of N2 was not
architecture - it was a repair of a setting that lied, and without it the fold's own safety rule guarantees
unbounded prompt growth. That half has shipped. The table should have read:

| item | is it architecture? |
|---|---|
| N0, N1, N4, N5-bug | no - repairs |
| N2 — the batching half | **no - repaired, shipped as `20_narrative_coverage.md`** |
| N2 — the model-written narrative, and N3 | yes - still declined |

The distinction that survives is sharper than "adds a layer": **a change is architecture when it adds a
thing that can be wrong on its own.** Sealing adds no such thing - it makes an existing layer's coverage
complete and checkable by identifier comparison. A model-written narrative per batch and an L2/L3 merge
would each add one, and both remain declined.
