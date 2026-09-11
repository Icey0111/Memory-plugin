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
