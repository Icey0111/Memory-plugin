# single_state_rendering_and_storage_projection

- Date: 2026-09-12 02:13:35
- Session: Cut per-turn injection and stored bytes without moving a single memory outcome.

## Problem / Requirement

The user restated the standing goal: **save consumption while keeping the original memory quality.**
The previous session had answered "how many tokens does 50 floors of memory cost" and taken the two
free cuts it could find (opaque registry ids, the reference cap). Three targets were named and left on
the table, in size order: the extraction log, the 15.5x JSON wrapper around the memory text, and the
state being rendered twice.

## Purpose of Change

Remove measured duplication from both the prompt and the chat file, and prove the removal changed no
outcome. The certificate is the ruler: state coverage, soundness, commitment retention, causal coverage
and T-Causal must be byte-identical before and after, or the cut does not ship.

## How It Was Changed

### 1. The state is rendered once instead of twice (the measured win)

Measured on the 50-floor acceptance chat (`Seraphina - 2026-09-12@01h15m20s127ms`, 72 memories), by
rebuilding the injection and scoring four variants of the SAME text with the certificate:

| variant | chars | tokens | state | stale | commit | causal | T-Causal |
|---|---|---|---|---|---|---|---|
| flat summary + must + groups (shipped) | 8,983 | 6,403 | 10/10 | 0 | 22/22 | 3/3 | 12/14 |
| groups only, query-scoped rows | 3,565 | 2,396 | **8/10** | 0 | 22/22 | 3/3 | 10/14 |
| groups only, ALL live memories | 6,449 | 4,598 | 10/10 | 0 | 22/22 | 3/3 | 12/14 |

The third row is the whole argument. The rows could not replace the summary while the caller handed them
a query-scoped slice - that is why trimming the summary to 1,200 characters once cost 2 of 10 covered
values. Given every live memory, the rows carry exactly what the summary carried, so the summary has
nothing left to add.

- [index.js L2603-L2620](file:///D:/memory_plugin/index.js#L2603-L2620) - prompt memories are now `orderCanonicalMemories(store)` (every live memory,
  canonical order) instead of `must + top-12 query matches`; `current_state_scope: 'mandatory-only'` becomes a real
  restriction for the first time; `currentState` is no longer passed, so no flat summary is assembled.
- [v55-runtime.js L290-L307](file:///D:/memory_plugin/v55-runtime.js#L290-L307) - the canonical ordering comparator is extracted as `orderCanonicalMemories` so
  the prompt and the stored summary cannot drift apart.
- [context-assembler.js L319-L352](file:///D:/memory_plugin/context-assembler.js#L319-L352) - `buildCurrentStateBlock` no longer renders a state summary; `cap` is
  now the only bound, and `REFERENCE_HEADER_CHARS` is exported so a caller can reserve the header instead of guessing.
- [index.js L177-L190](file:///D:/memory_plugin/index.js#L177-L190) and [index.js L313-L331](file:///D:/memory_plugin/index.js#L313-L331) - `current_state_context_max_chars` default 20,000 -> 12,000
  plus a v4 migration. The old 20,000 was never reached because the summary inside it was independently capped at
  9,000; with the summary gone the cap is the only bound, so it is set to the size the double rendering actually produced.

### 2. The layered summary is funded by its real room, and stops losing its newest floors

The summary is injected into the reference block, so the reference cap truncated it - and `truncate` keeps
the HEAD, which is the OLDEST narration. On the acceptance chat the tree was 3,697 characters against
~3,500 of room, so the newest turns were cut mid-sentence while the oldest were kept.

In between, the budget was also being split incorrectly: `format` divided it 24/26/42 across three levels
whether or not they had content. With levels two and three empty (true for the first thirty floors), asking
for 3,400 characters produced 1,201, because level one was pinned to 42% of the budget.

- [v55-summary-runtime.js L270-L286](file:///D:/memory_plugin/v55-summary-runtime.js#L270-L286) - the budget is divided among the levels that have content, in the same
  proportions they would get if all three were populated.
- [v55-consistency.js L175-L200](file:///D:/memory_plugin/v55-consistency.js#L175-L200) - the summary is told the room it actually has
  (`reference_context_max_chars - REFERENCE_HEADER_CHARS`), so its own formatter trims to the newest floors.

### 3. The scene-locator block is no longer injected

`[SCENE SUMMARY LOCATORS ...]` calls itself "derived, rebuildable, not a source of new facts", and it was
measuring 66% duplication: over the live 50-floor chat, 242 of 369 24-character probes taken from the block
were verbatim substrings of the layered summary above it. It was spending 2,297 of the 4,000 reference
characters to say the same thing twice - and because the summary is inserted before the historical marker,
the locator block was the part the cap cut, so it had effectively never reached the model. Removing the
injection makes that explicit instead of accidental. The scenes are still built and still feed the evidence
channel.

- [v55-consistency.js L186-L214](file:///D:/memory_plugin/v55-consistency.js#L186-L214) - the locator injection is removed with the measurement in the comment.

### 4. The stored memory record no longer carries its own empty wrapper

Measured on the same chat (72 memories, 65,958 characters of memory JSON for 5,111 characters of memory
text): 18,631 characters were keys whose value was `null`, `undefined`, `''`, `false` or `[]` for that
record - `invalid_reason`, `superseded_by`, `close_reason`, `supersedes`, `known_by` and `known_by_ids` were
null on all 72 - and another 6,552 were per-record copies of `world_id` / `chat_id` / `branch_id`, the same
string on every record and already stored once in `store.runtime_identity`.

- [v55-store-compact.js L1-L60](file:///D:/memory_plugin/v55-store-compact.js#L1-L60) (new) - the projection, with the one field it must not touch.
- [v55-derived-store.js L289-L322](file:///D:/memory_plugin/v55-derived-store.js#L289-L322) - `toJSON` applies it. This is the only place a chat store is serialised,
  so it is the only place that has to know; the live store keeps every field.

`last_recalled_message` is deliberately excluded: `fuseHybridCandidates` computes
`Number(memory.last_recalled_message)` and applies a recall cooldown whenever that is finite. `Number(null)`
is 0 and finite, `Number(undefined)` is NaN, so dropping the key would silently stop penalising
never-recalled memories. That is a recall-scoring question, not a storage one, and it is not this
projection's to settle - it is recorded as an open defect in the doc.

### 5. Tests

- [test-v55-store-compact.mjs L1-L40](file:///D:/memory_plugin/test-v55-store-compact.mjs#L1-L40) (new) - the projection keeps what matters and drops what does not.
- [test-context-assembler.mjs L42-L52](file:///D:/memory_plugin/test-context-assembler.mjs#L42-L52), [test-index-mock.mjs L6-L20](file:///D:/memory_plugin/test-index-mock.mjs#L6-L20) - assert the state is carried by the rows and not by a summary.
- [test-v55-budget-migration.mjs L7-L16](file:///D:/memory_plugin/test-v55-budget-migration.mjs#L7-L16) - v4 owns the state cap; a budget it does not own is still untouched.
- [test-v55-consistency.mjs L59-L64](file:///D:/memory_plugin/test-v55-consistency.mjs#L59-L64) and [test-v55-fullstack-cleanup.mjs L26-L26](file:///D:/memory_plugin/test-v55-fullstack-cleanup.mjs#L26-L26) - the locator block must stay out.

## Result

Live, after a page reload with no manual override, on the 50-floor acceptance chat:

| | before | after |
|---|---|---|
| injection tokens | 9,513 | **7,731 (-18.7%)** |
| state block | 8,983 chars / 6,403 tok | 6,557 chars / 4,625 tok |
| reference block | 3,110 tok (oldest 3,500 of the summary) | 3,107 tok (newest 3,437) |
| certificate | state 10/10, stale 0, commitment 22/22, causal 3/3, T-Causal 12/14, violations 0 | **identical** |
| chat store bytes | 218,279 | 199,492 |
| memory records | 82,111 bytes / 72 | 843 bytes each (-26% per record) |

Verified end to end, not by inspection: a real generation turn was run on the live chat after the change
(reply 315 chars, extraction 27.2s, memories 72 -> 74, extractions 26 -> 27, spine 80 -> 83, L1 22 -> 23,
`save: ok`, transcript 26 user turns / 26 replies / `healthy: true`), then the page was reloaded from the
compacted chat file and the store came back whole (74 memories, same injection, same certificate).

Offline suite: **76/76 in 19.8s** (75 before; one new file).

Follow-ups recorded but not taken here: (1) the remaining storage wrapper is dominated by the same key
names written once per record - 24,620 bytes of key overhead for 74 records - and removing that needs a
columnar chat format, which was not taken in the same pass as a behaviour change; (2) `extractions` is now
the largest single store key at 94,476 bytes and is kept whole because it is the replay source.
## Second change: the record wrapper, the extraction log, and a scoring defect

- Date: 2026-09-12 02:26:16

### Problem / Requirement

The previous entry left three items on the table in size order: the repeated key names inside the memory
records (24,620 bytes), the `extractions` log (then the largest single store key at 94,476 bytes, 47% of
the store), and a scoring defect found while building the projection.

### Purpose of Change

Take the two storage items that can be taken without giving up replay or memory content, and fix the
scoring defect properly instead of hiding it in the storage layer.

### How It Was Changed

#### 1. The scoring defect, fixed rather than hidden

`fuseHybridCandidates` computed `Number(memory.last_recalled_message)` and applied a recall cooldown
whenever the result was finite. `Number(null)` is 0 and finite, so a memory that had NEVER been recalled
was treated as recalled at message 0 and penalised hardest exactly when the chat was short enough for that
stamp to fall inside the window. The previous entry excluded the field from the storage projection so the
bug could not be resolved by accident; this entry fixes the guard itself.

- [memory-core.js L1150-L1160](file:///D:/memory_plugin/memory-core.js#L1150-L1160) - the cooldown requires a positive stamp, which is what it always meant.
- [test-v55-recall-cooldown.mjs L1-L35](file:///D:/memory_plugin/test-v55-recall-cooldown.mjs#L1-L35) (new) - null, absent and zero now score identically, and a memory
  recalled on the previous turn is still cooled down.
- [v55-store-compact.js L14-L22](file:///D:/memory_plugin/v55-store-compact.js#L14-L22) and [test-v55-store-compact.mjs L20-L22](file:///D:/memory_plugin/test-v55-store-compact.mjs#L20-L22) - the exemption is removed, because
  the value no longer means two different things.

#### 2. Fields with no reader, and caches that are recomputed

- [v55-store-compact.js L24-L37](file:///D:/memory_plugin/v55-store-compact.js#L24-L37) - `prompt_plan`, `setting_index_fingerprint`, `generation_mode` and
  `user_index_at_creation` are written in one place and read nowhere; `entity_ids` is a cache of the entity
  registry that `stampRuntimeIdentity` recomputes deterministically every generation. `known_by_ids` is
  deliberately excluded: two visibility checks read it, and a missing value there would make a private
  memory look public if the check ran before the next stamp.

#### 3. One column per field instead of one key per field per record

After the removals, what was left of the memory wrapper was almost entirely repeated key names. The record
maps are now written column-encoded: the field names once, the values in rows.

- [memory-core.js L201-L235](file:///D:/memory_plugin/memory-core.js#L201-L235) - the codec's shape and `decodeRecordMap`. It lives HERE, next to the record
  definition, because decoding has to happen inside `normalizeStore` and this module deliberately depends on
  nothing but the deterministic spine (an invariant `test-v55-drift-switches.mjs` pins - the first attempt put
  the decoder in the projection module and that test caught it).
- [memory-core.js L275-L279](file:///D:/memory_plugin/memory-core.js#L275-L279) - `normalizeStore` decodes both record maps, so every reader in the codebase
  keeps seeing the plain object map it always saw.
- [v55-store-compact.js L66-L96](file:///D:/memory_plugin/v55-store-compact.js#L66-L96) - `encodeRecordMap` writes the same shape from the projection rules.
- [v55-derived-store.js L300-L312](file:///D:/memory_plugin/v55-derived-store.js#L300-L312) - `toJSON` writes columns; the state summary is dropped whenever it IS the
  canonical form (`last_active_state_source === 'canonical-memory'`), which is the 14,571-byte copy that
  restates the memory records.
- [index.js L507-L520](file:///D:/memory_plugin/index.js#L507-L520) - `getStore` rebuilds that summary from `memories` when it is missing, at the one
  point every reader obtains a store from.

### Result

Live acceptance chat, same chat, measured after a page reload with no manual override:

| | before this entry | after |
|---|---|---|
| plugin store bytes (76 memories) | 199,492 (at 74 memories) | **154,949** |
| memory records | 1,140 bytes per record | **533 (-53%)** |
| extraction records | 3,652 bytes per record | 3,047 (-17%) |
| chat file | 495,694 | 463,482 |
| injection | 7,885 tokens | **8,044** (the chat grew by two turns and two memories) |
| certificate | state 10/10, stale 0, commitment 23/23, causal 3/3, T-Causal 12/14 | state **12/12**, stale 0, commitment 23/23, causal 3/3, T-Causal **14/16**, violations 0 |

Verified end to end again: a real generation turn on the live chat after the format change (reply 462
characters, extraction 65 seconds, memories 74 -> 76, extractions 27 -> 28, spine 83 -> 85, `save: ok`,
transcript 27 user turns / 27 replies / `healthy: true`), then the page was reloaded from the
column-encoded chat file and the store came back whole (76 memories, same injection, state 12/12).

Offline suite: **77/77 in 19.8s** (76 before; one new file).

### What is still not taken, with the arithmetic

Cumulative reduction from the original measurement: the store went 218,279 -> 154,949 bytes for the same
chat, about -29%; the memory records themselves are the smallest they have been at 533 bytes each. A
halving remains out of reach without losing a capability, and this is the honest breakdown of what is
left in the 154,949 bytes:

| key | bytes | why it stays |
|---|---|---|
| `extractions` | 85,325 | `operations` is read by the privacy filter that hides secret floors from the prompt, so it cannot be aged out without redesigning that path |
| `memories` (76) | 40,523 | of which the memory text is ~14,000 bytes; the rest is ~500 bytes of per-record provenance (ids, turn indexes, hashes, dates) that replay and the causal chain need |
| `hierarchical_summaries` | 17,222 | the only narrative carrier for folded floors - the raw prompt holds 402 tokens of transcript |
| `entity_registry` | 7,101 | losing it fragments entity identity for every later mention |
| the rest | ~4,800 | baseline, slots, source fingerprints |
## Third change: folding was behind the model-call guard, so summarized floors stayed in the prompt

- Date: 2026-09-12 03:08:00

### Problem / Requirement

The user described the workflow the system is supposed to have: summarize a configured batch of N floors,
hide exactly those floors, then repeat incrementally as new batches complete. Checking that claim against
the running system found that the second half of the loop - hiding the summarized floors - was not
happening at all.

### Purpose of Change

Make "summarize, then hide the corresponding floors" actually execute, before touching anything about how
the summaries themselves are produced.

### How It Was Changed

`processSummaryHierarchy` runs the deterministic digest first, then returns early when an extraction is in
flight (`__quiet_extraction_in_progress`), and only then calls `foldSummarizedFloors`. The digest was moved
out of that guard for exactly this reason once before - its own header records that the guard is how
`9 hidden floors (12,320 characters) kept no stand-in in the prompt` - but the fold was left behind it.
Folding is per-turn and idempotent, so it moves out too; the call after the model passes stays, so rows the
model creates are folded in the same run.

- [v55-summary-runtime.js L205-L216](file:///D:/memory_plugin/v55-summary-runtime.js#L205-L216) - `foldSummarizedFloors` now runs next to `reconcileFoldCoverage`, before the guard.

### Result

Live acceptance chat, measured before and after one call on the same page:

| | before | after |
|---|---|---|
| raw floors left in the prompt | 11 floors / 22 rows / 4,540 tokens | **1 floor / 2 rows / 400 tokens** |
| fold audit | `runs: 0`, `hidden: 0` | `runs: 1`, `hidden: 53` |
| audit self-healed | - | `audit_repaired: 33` (the markers were on the rows; the audit record was lost) |

So the raw-text component of every prompt was 4,540 tokens instead of 400 - 4,140 tokens per turn that the
summary tree already stood in for. The plugin's own two channels are unchanged (8,044 tokens), and the
certificate is unchanged (state 12/12, stale 0, commitment 23/23, causal 3/3, T-Causal 14/16, violations 0).

Suite: 77/77.

### What this did NOT change, and why that is the next question

The first half of the loop is still not what the user described. `summary_level1_every_turns = 10` is not a
batch size: 23 of 23 Level-1 rows are per-turn digest rows (`modelRows: 0`), 18 covering one turn and 5
covering two. The deterministic digest builds one row per extracted turn AND marks every one of those turns
processed, so the model loop's guard `pending.length < l1` is always true and the model summarizer has never
run. One node per N floors needs a model call over the N floors' raw text, because the digest merely
concatenates per-turn event summaries and cannot make text shorter - so it can reduce the node count but
cannot widen the history the injected window covers. Doing that means restoring the N-batch model summary
with the digest demoted to the fold-coverage fallback, which is a larger change than this entry and is left
for the next one.
## Fourth change: the plan document, and a correction to a claim made in this session

- Date: 2026-09-12 03:18:49

### Problem / Requirement

The user asked for a document recording what to do next, derived from the research into the reference
implementation (`AlbusKen/shujuku`, ACU SP·数据库 9.2.5) and from this session's measurements.

### Purpose of Change

Turn the comparison into a sequenced, certifiable plan, and record one claim from this session that turned
out to be wrong before it reached code.

### How It Was Changed

- [dev_docs/19_next_steps.md L1-L40](file:///D:/memory_plugin/dev_docs/19_next_steps.md#L1-L40) (new) - the plan: basis with measured numbers, the diagnosis that **the
  certificate judges the state and ignores the narrative**, our four core semantics as the constraint on any
  borrowing, a take/reject table, six work items (N0..N5) each with an invariant and a verification, the
  sequencing, four open decisions, and the non-goals.
- [dev_docs/header.md L48-L51](file:///D:/memory_plugin/dev_docs/header.md#L48-L51) - registered in the index.

### Result

The plan's sharpest finding is not a feature gap: **nothing in the certificate's six checks reads the summary
tree.** `state` reads slot-bearing memories, `commitment`/`causal` read the spine, `epistemic` reads `known_by`,
`cost` counts tokens. That is why 23 narrative nodes where 3 were expected, a model summariser that has never
run (`modelRows: 0`), a consolidation layer that has never merged (`l2: 0`, `l3: 0`) and a projection that would
show only the newest ~20 turns at 500 floors all went unnoticed: the narrative layer has no contract, so it
cannot be asked questions.

**The correction.** An earlier message in this session proposed replacing the fold's row markers with a
projection over the transcript. That is not available to us: SillyTavern assembles the prompt from `ctx.chat`,
and the only lever an extension has over a chat row is the one the host's own hide button uses - marking it.
The reference project can project because its rows never enter the chat; it owns their export. The borrowable
lesson is therefore narrower: keep the hidden set authoritative and verify that a rebuild from row markers is
exact, rather than trusting markers as the primary record. This is recorded in the document so it is not
rediscovered later.

The plan also states the arithmetic that stops N2 from being mistaken for a complete fix: staging alone leaves
500 turns as 34 stages at ~700 characters, which is ~23,800 characters against a 3,520-character budget. Only
the hierarchy (N3) brings that back to ~3,500 characters. N2 makes the units; N3 is what pays.

No code changed in this entry.

## Fifth change: the plan was declined, and the decline was recorded

### Problem / Requirement

The user declined the v1 plan outright: *"还是算了，我怕现有的架构又越走越偏导致全都白做了"* - the risk of
drifting away from an architecture that already works is judged higher than the coverage the narrative layer
would buy.

### Purpose of Change

Stop. Do not start N2 or N3. Record the decision and its reasoning in the plan document itself, so that a
later session cannot mistake an unapproved proposal for an approved one and resume it by accident.

### How It Was Changed

- [dev_docs/19_next_steps.md L202-L232](file:///D:/memory_plugin/dev_docs/19_next_steps.md#L202-L232) - a v2 status section, appended
  rather than edited into v1: the plan is **not approved and will not be started**; the reason stated by the
  user; the evidence that the refusal is coherent (everything already shipped this session is *subtraction*,
  whereas N2/N3 would be the first items in this project's history to *add* a layer); a repair-versus-architecture
  table splitting N0/N1/N4/N5-bug from N2/N3; and a note that D1-D4 are moot while v1 is declined.
- [dev_docs/header.md L50](file:///D:/memory_plugin/dev_docs/header.md#L50) - the index row now carries the declined status.
- No code changed. Working tree clean, `npm run check` **77/77 in 19.9s**, `HEAD == origin/v5.5-dev-iteration13`.

### Result

The project stops at a verified point rather than a hopeful one. What is banked is unaffected by the decision:
store 218,279 -> 154,949 bytes, per-memory injection overhead 76 -> 24 characters, the fold fix (11 floors /
4,540 tokens -> 1 floor / 400 tokens), one state rendering instead of two, and a certificate that reads
state 12/12, stale 0, commitment 23/23, causal 3/3, T-Causal 14/16, violations 0.

Two known defects are left in place deliberately and are named in the document so they are not rediscovered
as surprises: `summary_fold_keep_recent_floors = 1` disagrees with `protect_recent_messages = 8` (a second
default that disagrees with the first), and the memory vector collection is stale
(`请求空间 es1:14fzu5i 与已建索引 (missing) 不一致`), so dense recall is off and only lexical plus temporal run.
Neither is architecture, and neither blocks anything already shipped.

## Sixth change: narrative coverage is O(chat) now, not O(window)

### Problem / Requirement

The user came back to the one item they had raised twice before: *"你还有一个事情就是楼层的问题，我之前说的那个还是很重要N层总结一次的那个"*. It mattered more than the plan document said it did.

### Purpose of Change

Find out whether the fear behind it was real. It was, and the mechanism was not the one `19_next_steps.md` described.

### How It Was Changed

- [v55-digest.js L129-L235](file:///D:/memory_plugin/v55-digest.js#L129-L235) - new `coalesceDigestBatches` plus `digestRowFloorIndexes`: floor-aligned
  batches of `everyTurns`, aligned on a floor's ordinal in the completed turn list, sealing a full batch
  into one row whose id hashes its floors. A still-filling batch keeps one row per floor.
- [v55-summary-runtime.js L125-L200](file:///D:/memory_plugin/v55-summary-runtime.js#L125-L200) - `reconcileFoldCoverage` reads the full ordered
  line list instead of the capped window, seals into batches, and carries stored sealed batches verbatim
  while every floor they name is still a completed turn.
- [test-v55-digest-batch.mjs](file:///D:/memory_plugin/test-v55-digest-batch.mjs) (new) - the batching contract, the carry across a pruned
  extraction log, and the control that shows what the carry prevents.
- [test-v55-digest-integration.mjs L48-L62](file:///D:/memory_plugin/test-v55-digest-integration.mjs#L48-L62), [package.json L7](file:///D:/memory_plugin/package.json#L7) - updated.
- [dev_docs/20_narrative_coverage.md](file:///D:/memory_plugin/dev_docs/20_narrative_coverage.md) (new) and its index row in
  [dev_docs/header.md L51](file:///D:/memory_plugin/dev_docs/header.md#L51).

### Result

`digestRows` returns only the newest rows that fit `summary_digest_max_chars` (8,000 by default), and
`reconcileFoldCoverage` used to rebuild `level1` from that window while discarding every digest row it
did not rebuild. Coverage was O(window), and because a floor may only stay hidden while something stands in
for it, every older floor came back as raw text. Simulated with the live chat's own event summaries the
window saturates at about 45 floors: 120 floors left 75 raw, 500 floors left **445-456 raw floors** - more
text than the memory system removes.

Sealing fixes it. Live on the acceptance chat: Level-1 rows 23 -> **10**, narrative 4,578 -> **2,334
characters**, coverage still 28/28, folded rows still 53, injected total 8,044 -> **7,736 tokens**.
Simulated: 500 floors are **500/500 covered by 50 rows and 19,950 characters**, at a flat 39.9 characters
per floor. The suite is **78/78**.

**A correction to the previous entry.** `19_next_steps.md` v2 sorted N2 - N as a real setting, batches of
N - into the architecture column, and it was declined on that basis. That sorting was too broad: the
batching half of N2 repairs a setting that already shipped and did nothing, and without it the fold's own
safety rule guarantees the prompt re-grows without bound. What stays architectural is the model-written
narrative and the L2/L3 merge (N3), and that is still declined.

**What is not claimed.** `l2: 0`, `l3: 0` - the consolidation levels have still never merged, because the
model loop's `pending` comes from `processed_turn_ids`, which the digest fills for every turn. Narrative
reach is still bounded by the summary budget: about the newest 90 floors, not all 500. And a floor's
narrative detail is now ~39 characters instead of ~164 - the facts are unaffected because they live in the
state block, but the story-so-far block is thinner per floor.

## Seventh change: the memory thesis, converged and scoped to this plugin

### Problem / Requirement

The user asked for the memory discussion to be converged onto their original two-line formulation -
*记忆是检索*, *总结给剧情推进提供基础* - after several rounds of literature review. They then corrected
the scope: an earlier version of the convergence had been written into the `all-the-airp` project, and
AIRP is **not** the target. It is a sibling research project, it is not a tavern scenario, and much of it
is unrelated to memory.

### Purpose of Change

State the thesis precisely enough to build and falsify, scoped to **this plugin inside SillyTavern**, and
let the scoping expose what is actually missing here rather than what is missing in AIRP.

### How It Was Changed

- [dev_docs/21_memory_thesis.md](file:///D:/memory_plugin/dev_docs/21_memory_thesis.md) (new) - the converged thesis: five repaired claims with
  evidence, what this plugin already is (a certified *reading* system), the tavern constraints that shape
  the design, a stage-by-stage gap table, the three-layer design, the two defects the thesis exposes in
  what already shipped, the warning that retrieved prose may be ignored, four cheap hypotheses, and the
  not-claimed list.
- [dev_docs/header.md L52](file:///D:/memory_plugin/dev_docs/header.md#L52) - registered in the index.
- No code changed. The AIRP-side document was left in place with a scope note pointing here; it is that
  project's record and is not edited by this one.

### Result

Three things came out of the convergence that were not visible before it.

**1. The index is already half-extracted here.** Every memory carries `entities` and `source_message`;
`entity_registry` exists; and a folded row **keeps its content** - folding sets `is_system` and a marker
and touches nothing else. So `attention → entity → memory → source_message → floor → original text` is
complete except for the last hop. Nothing turns a floor back into injected text. **That single missing hop
is the difference between this plugin having state and having memory.** It also means the broken vector
collection is an *enhancement* for unnamed relevance, not a prerequisite.

**2. The tavern constraints point at a mechanism this plugin already has.** A missed retrieval is
unrecoverable within the turn and costs a reply; every model call is billed to the user. So the gate must
be deterministic and generous, and retrieval is **selective un-hiding for one turn** - the mechanism
`unfoldFloorsNotCovered` already uses, doing something else.

**3. The thesis convicts two things already shipped.** The sealed batch row compresses by **truncating
prose** (~39 characters of each floor's summary) where the situation-model literature says it should
**select structure** across five dimensions - all of which the extraction records already carry. And the
fold certificate checks *every hidden floor has a stand-in*, when the thesis requires *every hidden floor
is still retrievable and the path is complete* - which has never been checked, because nothing reads it.

Nothing was measured in this entry. The four hypotheses and the LongMemEval acceptance table are stated in
the document and are not yet run.

## Eighth change: the plan after the compression discussion

### Problem / Requirement

The user asked what the whole project should do next, now that the compression discussion has been
folded in — not another measurement, a plan.

### Purpose of Change

Turn the converged thesis plus the compression findings into a sequenced plan, and state explicitly what
is *not* being built, so the answer to "what do we do" also answers "what do we stop paying for".

### How It Was Changed

- [dev_docs/22_plan_after_compression.md](file:///D:/memory_plugin/dev_docs/22_plan_after_compression.md) (new) - the ruler (W0), measurement
  before building (Phase A), the last hop (Phase B), the gist layer (Phase C), deferred enhancements
  (Phase D), external validation (Phase E), the stop-doing list, and acceptance criteria.
- [dev_docs/header.md L53](file:///D:/memory_plugin/dev_docs/header.md#L53) - registered in the index.
- No code changed.

### Result

Three things the compression discussion changed about **what to build**, and they are the whole reason
this plan is not a re-run of `19`:

**1. Compression and summarization are different operations.** DeepSeek-OCR reaches 96% recovery at 10× by
*re-encoding*, not by summarizing, so there are several compression–fidelity curves rather than one. The
lesson that transfers is the **paired metric** — compression ratio against decodability — and **both halves
are already measured here** (2.25 / 1.09 / 0.71 / 0.52 / 0.41 at 10/20/30/40/50 floors; `key_retention
23/23 = 1.00`) and have never been plotted together. That plot is W0, and it costs nothing.

**2. The original is stored for free in this scenario.** SillyTavern keeps `ctx.chat` and folding only
excludes rows from the prompt, so the scarce resource is **injected tokens, not storage**. The
compression-rate knob therefore applies to the **gist layer alone**. This is what finally makes C1 of the
thesis cheap to fix: the batch row does not have to carry detail, because retrieval carries detail.

**3. The verbatim layer never needed compressing.** Which is why the broken vector collection is demoted
from prerequisite to enhancement. Everything in Phases W0, A and C is measurable or buildable with **zero
additional model calls**; only Phases D and E have a bill, and both are deferrable.

The stop-doing list is the other half of the answer: no model judge holding the veto, no L2/L3 narrative
merge, no model-written batch narrative, no ported retrieval pipeline, and no per-turn model call. The
first four are the declined plan's expensive items; the fifth is a standing constraint because every call
is billed to the user.

## Ninth change: H1 and H2 verified - the prediction was wrong

### Problem / Requirement

The user asked for the verification to be run. H1 (an IDF gate finds planted long-range detail far better
than a frequency gate) and H2 (a frequency gate is at least as good at identity, so the two are
complementary) were the two hypotheses that decide what layer 1 of the retrieval gate is built on.

### Purpose of Change

Falsify or support them with a measurement that costs nothing, before any code is written against them.

### How It Was Changed

- [remove/.audit-v55/live-check/expr-gate.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-gate.js), [expr-gate2.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-gate2.js), [expr-gate3.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-gate3.js) - three
  probes over the live acceptance chat via CDP; **zero model calls**.
- [dev_docs/21_memory_thesis.md L174](file:///D:/memory_plugin/dev_docs/21_memory_thesis.md#L174) - v2: the adjudication and the reframing.
- [dev_docs/22_plan_after_compression.md L166](file:///D:/memory_plugin/dev_docs/22_plan_after_compression.md#L166) - v2: A2 re-scoped, A0 added.
- No product code changed.

### Result

**H1 is refuted.** Over 19 attention events, the frequency gate matched or beat the IDF gate at every
budget: at B=2, 0.632 vs 0.526; at B=4, 0.842 vs 0.579; at B=8, 0.842 vs 0.789; at B=16 both 0.947. The
paired difference at B=8 was −0.053 with a 95% interval of [−0.332, +0.227], and IDF won 3 events of 19.
The prediction was not merely unsupported; the sign is the wrong way.

**A control passed, so the measurement is not vacuous.** Taking simply the most recent floors scores 0.474
at B=8. Both gates beat it substantially, so entity-based retrieval carries real signal - it is the choice
between the two *scores* that the data does not support.

**H2 is undecidable at this chat length, for a structural reason.** The fraction of entity groups already
present in the rendered state block is 0.40 / 0.60 / 0.85 / **1.00** as the block carries 10 / 25 / 50 / 76
memories. At the live size, **everything is already in the prompt**, so neither gate has anything to add
and "which is better" has no discriminating power.

**The two results are one result, and it is the finding that matters.** Retrieval does not exist to find
what the state block missed - at these lengths it misses nothing. **Retrieval is the overflow mechanism of a
bounded state block**: it recovers what the budget had to drop, and its work begins between 50 and 76
memories carried, which is exactly where the 12,000-character cap binds. The gate should therefore be aimed
at the memories that fell outside the budget, not at "surprising entities" in general. That also explains
the failed prediction: *long-range detail* meant **rare** detail, while what returns after a gap is
disproportionately the **frequent** cast. Frequency answers *who will matter again*; IDF answers *which
token is a distinctive key*. They were never competing for the same job, and the likely design keeps both -
frequency for the gate, IDF for the key - with the roles swapped from what H1/H2 proposed.

**Two defects found on the way.** The entity registry carries **89 raw names that collapse to 20 groups**
(~4.5 names per thing), which makes canonicalisation a prerequisite rather than a detail. And IDF's top
ranked terms in the live chat are 路引, 灰絮之症, 怀表, **eldoria**, **shadowfang** - the last two are
English world-book names inside a Chinese transcript, so rarity alone rewards irrelevant imported
vocabulary and IDF needs a relevance filter.

The plan now carries **A0 - entity canonicalisation** as a prerequisite, with A2 re-scoped to the
budget-overflow question, which needs a corpus where the state cap actually binds.

---

## 10. Correcting entry 9's entity count, answering A2 null, and reserving the change chain's budget

### Problem / Requirement

Three things, in the order they were found.

1. **Entry 9 in this file reports a measurement that is wrong.** It states *"89 raw entity names collapse to
   20 groups (~4.5 names per thing)"* and draws a plan item from it. Re-running the audit properly gives
   different numbers **and the opposite conclusion**, so the correction has to land before any code is
   written against it.
2. **A2 could not be left deferred.** It was re-scoped in entry 9 to "when the state block is forced to drop
   memories, does a gate recover them better than taking the most recent floors?", with the note that it
   needs a corpus where the cap binds. The state cap is a *setting* — `current_state_context_max_chars` —
   so the overflow regime can be induced on the existing chat instead of waiting for a longer one.
3. **Verifying the above surfaced an unmeasured defect.** The certificate's `causal` dimension was the only
   one that failed *before* any state omission, and it was failing for want of 694 characters.

### Purpose of Change

- Replace a wrong number with a measured one, and replace the plan item derived from it with a transform
  that is measured to help rather than measured to hurt.
- Convert A2 from an open question into an answered one, even though the answer is null.
- Stop the change chain from being the first thing a tightening budget removes. Causation is one of the five
  situation-model dimensions the summary exists to preserve, and the chain is its only carrier.

### How It Was Changed

**Measurement (no product code, zero model calls)**

- [remove/.audit-v55/live-check/expr-a1-entities.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a1-entities.js) - the corrected entity audit. Reads `memory.entities` and the
  registry rows' `canonical_name`/`aliases`, excludes `ent_*` identifiers, and reports alias counts.
- [expr-a2-breakdown.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a2-breakdown.js) - the budget sweep: the production assembler and certificate at ten
  state caps from 20,000 to 1,200.
- [expr-a2-gate.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a2-gate.js), [expr-a2-diag.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a2-diag.js), [expr-a2-compose.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a2-compose.js) - the gate-versus-recency
  comparison, its diagnostic, and the reference-block composition measurement.
- [expr-a2-spine.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a2-spine.js) - the change chain across budgets.
- [expr-modsrc.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-modsrc.js) - confirms which module source the running host actually serves.

**Product code**

- [v55-spine.js L347-L388](file:///D:/memory_plugin/v55-spine.js#L347) - new `SPINE_STATE_FLOOR` and
  `planSpineReservation`. The reservation is computed before assembly and the chain's characters are taken
  out of the current-state cap, so the assembler absorbs the cut in its voluntary sections instead of the
  tail trim eating the causal record. Three guards: the effective cap may never fall below the assembler's
  own 800-character clamp floor; a reservation small enough that `spinePromptBlock`'s own 120-character
  floor would return *more* than asked for is discarded rather than accepted; and a store with no chain
  leaves the cap untouched.
- [index.js L2630-L2666](file:///D:/memory_plugin/index.js#L2630) - `buildInjectedContextBundle` calls the
  planner instead of appending the chain after assembly, and passes `reservation.currentStateCap` to the
  assembler. [index.js L56](file:///D:/memory_plugin/index.js#L56) - the import.
- [test-v55-spine-reservation.mjs](file:///D:/memory_plugin/test-v55-spine-reservation.mjs) - six groups of
  assertions over the reservation contract, including the floor guard that the first version of the
  implementation actually failed.
- [package.json](file:///D:/memory_plugin/package.json) - the new test registered in the `check` chain.

**Documentation**

- [dev_docs/21_memory_thesis.md L256](file:///D:/memory_plugin/dev_docs/21_memory_thesis.md#L256) - v3: the
  correction, the A0 redesign, the A2 answer, the budget curve, the chain defect and the reference-block
  composition.
- [dev_docs/22_plan_after_compression.md L193](file:///D:/memory_plugin/dev_docs/22_plan_after_compression.md#L193) -
  v3: A0 redesigned, A2 retired as answered, the shipped fix, and two new items (D4 certificate coverage,
  D5 reference-block split).

### Result

**The entity number in entry 9 is withdrawn.** There are **44** names on memories and **46** registry rows,
not 89 — the probe counted `entity_registry` **keys** (`ent_<hash>` identifiers) as names. And the "20
groups" came from grouping by **substring containment**, which is not co-reference: the largest "group"
contains a port city, its slum district, an alley, a well platform, the water, a sample bottle, a shop and a
shopkeeper. **A0 as entry 9 specified it would have merged a city with a water bottle.** Measured, it drops
entity matches on the production query from **12 to 8** out of 500 rows — it makes matching *worse*. What
survives from entry 9 is the narrow claim: **46 of 46 registry rows are trivial** (`aliases.length <= 1`),
so the registry has never canonicalised anything. Identity should stay strict; matching should expand to head
morphemes, which is the opposite transform.

**A2 is answered, and the answer is null.** With the state cap as an induced overflow condition and the
certificate's own `state.omitted` ∪ `commitment.missing` as machine-generated ground truth, **the lexical
gate does not beat recency at any budget** (caps 4500/3500/2500/1200 at B=1,2,3,5,8). Recency wins the one
cell with enough positives to matter (cap 2500, B=8: recency 4, gate 3). The structural reason is the
actionable result: **only 12 of 500 scored memories receive an entity match on the production query**, and
because the query is built from recent dialogue, *relevant* and *recent* coincide **by construction**. The
successor question is not which score to use but **where the gate's query comes from**.

**A defect was found and fixed.** The change chain renders at 90.2% of the current-state block and was
appended after the assembler had already spent the cap, so it was the first thing a tightening budget
removed:

| state cap | chain chars | causal |
|---|---|---|
| 12000 / 8000 | 694 | 3/3 |
| 7000 | 606 (truncated) | 3/3 |
| **6000** | **0** | **1/3** |

694 characters — about 450 tokens — is the whole difference between a broken and an intact causal record,
and the chain's own configured budget is 4,000. It is the **only** certificate dimension that fails before
any state omission, while `state`, `commitment`, `soundness` and `epistemic` stay green. Fixed by
reserving its characters inside the cap. The reservation is free while there is headroom, so an unconstrained
turn is unchanged.

**Two further measurements, recorded because they bound future work.** The drop rule prioritises correctly —
commitment holds 23/23 down to a 2,500-character cap and breaks only below 1,800, and `stale`/`leaks` are 0
at every budget. But the certificate's `state` dimension is defined over **slot-bearing memories: 12 of 73
active**. At a 2,500-character cap, **44 active memories are dropped and the certificate flags 6**. Separately,
the binding budget on this chat is not the 12,000-character state cap (4,912 characters of headroom) but the
**4,000-character reference block, 60% of which is the narrative summary** — recall selects 6 memories and 5
reach the prompt.

**Verification.** Offline: `npm run check` clean, **79/79 test files pass in 19.9s** (was 78/78; the new
reservation test is the increment). **Live verification is NOT complete.** The host loads the plugin from
`C:\\Users\\20436\\scoop\\persist\\TauriTavern\\data\\extensions\\third-party\\Memory-plugin`, outside the session
workspace, and copying the two changed files there requires a sandbox escalation that did not receive an
approval (two attempts, both timed out). The live sweep therefore still shows the pre-fix behaviour —
`causal 1/3` at a 6,000-character cap. The fix is committed and unit-tested but **has not been observed
working in the real app**.

One incidental finding worth keeping: the deployed extension had been assumed stale because seven core files
differed from the repository. They differ **only in line endings** (CRLF vs LF); the content is byte-identical
after normalisation. The deployment was current, so this session's earlier live measurements are valid.

---

## 11. The deployment path is now scripted, and the earlier measurements are confirmed to have run on the shipped code

### Problem / Requirement

Entry 10 recorded that the change-chain fix was committed and unit-tested but **not verified live**, because
copying it to the host's extension directory needed a sandbox escalation that never arrived. Two follow-on
problems came out of that:

1. Finding the host's extension directory at all took a filesystem-wide search. The repository is
   `D:\\memory_plugin`; the host loads the extension from
   `%USERPROFILE%\\scoop\\persist\\TauriTavern\\data\\extensions\\third-party\\Memory-plugin`. A page reload reloads
   *that* copy. Editing the working tree and reloading therefore verifies nothing, **and fails silently** -
   the probes simply keep reporting the old behaviour, which reads as "the fix did not work".
2. A raw hash comparison of the two trees reported nine runtime files as different, which reads as "the
   deployment is stale" and would have invalidated every live measurement taken this session. Seven of the
   nine differed **only by line endings**.

### Purpose of Change

Make the deployment step explicit and one command, make staleness detectable instead of silent, and settle
whether the measurements in entries 9 and 10 were taken against the shipped code or against something older.

### How It Was Changed

- [deploy-live.mjs](file:///D:/memory_plugin/deploy-live.mjs) - new. Resolves the live directory from
  `--dir`, `$AETHERIA_LIVE_DIR`, or the two known host locations; compares every loadable file **ignoring
  line endings**; prints identical / changed / missing; and copies only with `--apply`. A bare run never
  writes, so it cannot need the escalation its `--apply` may.
- No product code changed in this entry.

### Result

`node deploy-live.mjs` now reports, in one line each, exactly which files the host is running stale:

    live directory : C:\\Users\\20436\\scoop\\persist\\TauriTavern\\data\\extensions\\third-party\\Memory-plugin
    repo files     : 133
    identical      : 110
    changed        : 13  ARCHITECTURE.md, index.js, package.json, README.md, test-*.mjs (x8), v55-spine.js
    missing live   : 10  deploy-live.mjs, test-*.mjs (x9)

**The measurements stand.** Blob-hash comparison (`git hash-object --no-filters` against
`git rev-parse <rev>:<path>`, which is immune to the CRLF question that made raw hashing misleading)
settles it per file:

| module | live vs `HEAD~1` |
|---|---|
| `index.js` | **equal** (differs from `HEAD` only by entry 10's fix) |
| `v55-spine.js` | **equal** (same) |
| `v55-certificate.js` | equal to both |
| `memory-core.js` | equal to both |
| `v55-consistency.js` | equal to both |
| `v55-quality-metrics.js` | identical after line-ending normalisation |
| `v55-tcausal.js` | identical after line-ending normalisation |

So every runtime module the measurements touched was **byte-identical to the previous commit**, and the
only two files this commit changes are the two the fix touches. The budget curve, the gate comparison, the
entity audit and the reference-block composition all describe the code as shipped.

The remaining drift is **documentation and test files only**, which the host never executes. It is recorded
here rather than fixed because a full `--apply` would push `deploy-live.mjs` and nine offline tests into an
extension directory that has no use for them; a runtime-only sync is the right default and is left as a
follow-up rather than guessed at now.

**Still not verified live.** The fix remains unobserved in the running app for the reason in entry 10.
`node deploy-live.mjs --apply` is the single command that needs the approval.

---

## 12. Live verification: the change-chain reservation works, and the fix is now observed in the running app

### Problem / Requirement

Entries 10 and 11 recorded the fix as committed and unit-tested but **not verified live**, because copying it
into the host's extension directory needed a sandbox escalation that had timed out three times. The
escalation was approved on the fourth attempt (the user had been away, not a harness fault), which unblocked
the verification.

### Purpose of Change

Close the gap between "79/79 offline" and "observed working in the real app", and record the shape of the
trade the reservation makes, not just the headline number.

### How It Was Changed

- `node deploy-live.mjs --apply` - 23 files copied into the live extension directory, including
  `index.js` and `v55-spine.js`.
- Host reloaded, then
  [expr-modsrc.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-modsrc.js) confirmed the served
  source now carries `planSpineReservation` and `SPINE_STATE_FLOOR`, and that a cache-busted
  `import()` sees the new export (`freshImportHasPlanner: true`).
- [expr-verify-reserve.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-verify-reserve.js) -
  re-ran the same budget sweep as the pre-fix measurement, same chat, same caps.
- No product code changed in this entry.

### Result

**The defect is fixed, measured against the pre-fix sweep on the same chat.**

| state cap | causal before | causal after | chain chars | state before | state after | tokens before | tokens after |
|---|---|---|---|---|---|---|---|
| 12000 (live) | 3/3 | 3/3 | 694 | 12/12 | 12/12 | 7707 | 7732 |
| 7000 | 3/3 | 3/3 | 606 -> **694** | 12/12 | 12/12 | 7627 | 7632 |
| **6000** | **1/3** | **3/3** | 0 -> **694** | 12/12 | 11/12 | 6888 | **6878** |
| 5500 | 1/3 | **3/3** | 0 -> **694** | 12/12 | 10/12 | 6497 | 6509 |
| 4500 | 1/3 | **3/3** | 0 -> **694** | 9/12 | 10/12 | 5755 | 5791 |
| 3000 | 0/3 | **3/3** | 0 -> **694** | 7/12 | 8/12 | 4636 | 4638 |

The chain now renders **in full, 694 characters, at every cap from 12,000 down to 3,000**, and `causal`
holds **3/3 across that entire range** where it used to be 1/3 or 0/3 below 7,000. No block exceeds its cap
at any point (`over: false` throughout), and `commitment` stays **23/23** down to 3,000.

**The trade is explicit, which is the part worth recording.** At caps 6,000 and 5,500 the state block gives
up one and two slot-bearing memories respectively to keep the causal record whole. That is the intended
direction - causation is one of the five dimensions the summary exists to preserve, and the certificate
scored its loss as the larger failure - but it is a real cost, not a free win, and it is smaller in practice
than the 12/12 -> 10/12 reading suggests: `state` is defined over **12 of 73 active memories** (see entry 10),
so one slot is roughly 1.4% of the store.

**The cost is nil.** At the live setting the block grew by **25 tokens** (+0.3%). At a 6,000-character cap it
came out **10 tokens cheaper**, because reallocating inside the cap lets the assembler pack better than an
append-after-the-cap did.

**The floor guard is exercised live.** At a 900-character cap the block is 863 characters with **no chain
reserved** (`spineChars: 0`, `causal 0/3`): 900 minus the 800-character floor leaves 100, which is below
`spinePromptBlock`'s own 120-character render floor, so the reservation steps aside and hands the cap over
untouched rather than starving the state block. That is exactly the behaviour
`test-v55-spine-reservation.mjs` pins, now observed rather than only asserted.

**Status: verified.** The fix is committed (`7fa405e`), scripted for deployment (`f399e81`), covered offline
(79/79), and now measured working in the running app.

---

## 13. The corpus was already on disk, the state block is 65% short at 51 floors, and the gate question is closed

### Problem / Requirement

Three plan revisions in a row — `22_plan_after_compression.md` v2, v3 and v4 — deferred a question with the
same sentence: *this needs a corpus where the state cap actually binds*. Nothing checked whether one was
already on the machine. It was:

| chat | rows | assistant floors | memories | active | slot-bearing |
|---|---|---|---|---|---|
| the acceptance chat used since entry 9 | 55 | 28 | 76 | 73 | **12** |
| `Seraphina - 2026-09-11@22h56m08s521ms` | 101 | 51 | 224 | 217 | **197** |

Sixteen times the slot-bearing memories. Every question that had been deferred for want of a corpus was
measurable within a minute of finding it.

### Purpose of Change

Measure the two open questions on a corpus with real power — *where does the state actually break?* and *can
any query source recover what the budget dropped?* — and record what the answers force, including a
correction to this session's own v3 conclusion and to a wrong number written into v4's first draft.

### How It Was Changed

**Measurement (no product code, zero model calls)**

- [chat-scan.mjs](file:///D:/memory_plugin/chat-scan.mjs) - new, tracked. Lists every chat the host owns
  with its memory store, read straight from the chat files, so "we need a longer corpus" can be checked
  instead of asserted. Writes nothing.
- [expr-open224.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-open224.js) - opens the
  51-floor chat and confirms its live shape.
- [expr-a2-breakdown.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a2-breakdown.js) -
  re-run on the new corpus: the certificate across ten state caps.
- [expr-a3-arms.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-a3-arms.js) - new. Five arms
  ranked inside the dropped set against the certificate's required set, with a paired bootstrap.
- [expr-state-compose2.js](file:///D:/memory_plugin/remove/.audit-v55/live-check/expr-state-compose2.js) -
  new. Where the 12,000 characters of the state block actually go.

**Documentation**

- [dev_docs/21_memory_thesis.md L401](file:///D:/memory_plugin/dev_docs/21_memory_thesis.md#L401) - v4.
- [dev_docs/22_plan_after_compression.md L283](file:///D:/memory_plugin/dev_docs/22_plan_after_compression.md#L283) - v4.

### Result

**The state contract fails at 51 assistant floors, and the certificate says so.** At the default
12,000-character cap the block renders 11,965 characters and carries **69 of 197 slot values — 35%**.
`commitment` is **15/15**, so the irreversible set is intact, which is the promise that matters and it holds.
`stale` is 0 at every budget. But `state` goes from "12/12" on the acceptance chat to **0.35** here, and the
shortfall is not a tuning error: rendering all 197 rows as they are written needs about **27,300 characters**,
and even a 20,000-character cap only reaches **112/197**.

**The gate question is closed, and not in the gate's favour.** Five arms — recency, the production dialogue
query, a query built from the state block's own content (A3a), the last user message (A3b), and random —
ranked inside the dropped set, with the certificate's `state.omitted` ∪ `commitment.missing` as ground truth:

| cap | required / dropped | recency@8 | dialogue@8 | state@8 | lastUser@8 | random@8 |
|---|---|---|---|---|---|---|
| 12000 | 128 / 142 | 0.039 | 0.039 | 0.039 | 0.055 | **0.056** |
| 9000 | 146 / 163 | 0.034 | 0.034 | 0.041 | 0.048 | **0.049** |
| 7000 | 157 / 174 | 0.032 | 0.032 | 0.038 | 0.045 | **0.046** |
| 4500 | 172 / 192 | 0.041 | 0.029 | 0.029 | 0.041 | **0.042** |
| 2500 | 184 / 204 | 0.038 | 0.027 | 0.033 | 0.038 | **0.039** |

**Every arm is at or below chance at every cap.** The reason is in the second column: **90% of dropped
memories are required**, so recall@B is about B/|D| for any ordering — there is almost nothing to rank
against. The measurement is informationless by construction, which is a property of the target, not of the
scorers. A3a and A3b are therefore **closed rather than deferred**, and the gate's remaining honest scope is
the narrow named-thing lookup, whose test protocol has to be H4's rather than the certificate's.

**This revises entry 10's own conclusion.** Entry 10 said *retrieval is the overflow mechanism of a bounded
state block*. On a 28-floor chat, where the overflow is a handful of rows, that reads well. On a real chat the
overflow is **65% of the state**, and no ranking recovers 65% of anything: **retrieval is the mechanism for
the last mile, not the overflow**, because selection is not a capacity mechanism. The capacity gap is now a
number — **~56% compression** — and **C1 is promoted to the critical path with that target**.

**A wrong number in this version's first draft, corrected.** The draft claimed the block spends **3,004
characters on repeated slot labels and could fit 22 more rows** by hoisting them. That was an arithmetic
error: the sum was taken over the 4 *distinct* owners instead of the 81 rendered rows, overstating the saving
**fivefold**. Measured properly, the labels are 31% of the row characters but the repeated `owner.` prefix is
5% and `kind:` another 5%; hoisting both is worth **1,048 characters, about 7.5 extra rows — 4% of the gap.**
Worth doing, not the answer. It is the same class of error as entry 9's "89 names", and both are written down
rather than quietly fixed.

**Two things found on the way.** `causal` is **9/16 at a 20,000-character cap** with the block nowhere near
tight — seven chains broken structurally rather than by pressure, a failure mode entry 10's reservation fix
does not address and this entry does not diagnose. And the on-disk store is serialised **columnar**, so a
naive `Object.values(store.memories)` returns four structural keys and reports a memory count of **4** for a
chat holding **224**; `chat-scan.mjs` decodes both shapes and reproduces the live counts exactly.

**Verification.** All numbers measured against the running app over CDP. `npm run check` clean, **79/79 test
files pass**. No product code changed in this entry, so the live deployment is unchanged.




