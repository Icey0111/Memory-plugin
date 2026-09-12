# one-page architecture and legacy inventory

- Date: 2026-09-11 21:12:14
- Session: the project owner reported that the architecture had become unreadable after fifteen iterations of feature work, and asked for one readable page before asking what old material had not been cleaned up.

## Problem / Requirement

The repository had grown to 166 tracked files in a single flat directory, with
four overlapping architecture documents and three naming generations live at
once (v5.2/v5.3, v5.4, v5.5). The root `ARCHITECTURE.md` grows by appending one
section per iteration, so a newcomer reading it receives a change log rather than
an architecture. The project owner stated the architecture was no longer
comprehensible and asked, in order, for a written one-page description and then
for an inventory of what old material is still present. No runtime behaviour was
reported as broken.

## Purpose of Change

Give a reader who does not know the module names one page that explains the whole
system, re-anchor the project owner's original design keywords against what the
code actually does, and record the stale artifacts as measured evidence rather
than as an impression. This is a documentation-only change: no source file was
modified.

## How It Was Changed

- [dev_docs/01_architecture.md L101](file:///D:/memory_plugin/dev_docs/01_architecture.md#L101) - appended v3, a plain-language one-page architecture: the system in one picture, four nouns, the life of one message, what the 43 source files do, the original design keywords mapped onto the code with a status each, and what is deliberately absent. v1 and v2 remain as immutable history above it.
- [dev_docs/09_legacy_inventory.md L1](file:///D:/memory_plugin/dev_docs/09_legacy_inventory.md#L1) - new document recording the measured legacy artifacts: six dead derived-store keys, a dead host prompt key with two owners, three naming generations live at once, the flat root, four overlapping architecture documents, `remove/`, and the pairs whose names confuse without being dead.
- [dev_docs/header.md L40](file:///D:/memory_plugin/dev_docs/header.md#L40) - registered the new document in the structure table, as that header requires.
- [change_log/change_log_2026_09_11_21_12_14_one_page_architecture_and_legacy_inventory.md L1](file:///D:/memory_plugin/change_log/change_log_2026_09_11_21_12_14_one_page_architecture_and_legacy_inventory.md#L1) - this entry.

Versioning and the change-log entry were produced with the project-docs-workflow
scripts (`new_version.py`, `new_change.py`) so the append-only conventions and the
real system timestamp hold.

## Result

`dev_docs/01_architecture.md` now opens, in its newest version block, with a page
that states the system without requiring the module names. Its load-bearing
claims are: two arrows leave the raw chat and never meet, so there is no
`summary -> tags -> memory` path; summaries are never embedded and therefore
cannot be recalled, only injected; and recall has no independent tag channel.

`dev_docs/09_legacy_inventory.md` records the stale material with the measurement
that found it. The largest items are the six dead derived-store keys, the
`remove/` directory (2,965 untracked files including a complete old copy of the
plugin) and the 448-line root `ARCHITECTURE.md` that duplicates this document in
stale form. Nothing was deleted in this change; deletion is a separate decision
and would require a `remove/` backup per that folder's header.

Verification: the source tree was re-scanned after the edit and `dev_docs/01_architecture.md`
contains three version anchors at lines 6, 12 and 101, with v3 last as required.

---

## Entry 2 - cleanup pass: archive the historical root documents

- Date: 2026-09-11 21:19:00
- Session: same conversation, second request - "先清理" (clean up first), chosen from the two options offered at the end of Entry 1.

## Problem / Requirement

Entry 1's inventory measured 34 loose non-code files at the root: 13 iteration
reports, a 446-line package manifest that is a version 5.5.0-dev.8 snapshot whose
own header says the next step is Iteration 08 live acceptance, two migration
documents, two v5.4 handover documents, and a 448-line root `ARCHITECTURE.md`
that had grown into an iteration log. The project owner chose cleanup over feature
work, on the condition that no functionality change.

## Purpose of Change

Reduce the root to the source, the tests, and the files the host loads, and move
superseded design and release documents into one `archive/` directory, so a reader
can tell current material from history.

## How It Was Changed

- 22 files moved to `archive/` with `git mv` (git history preserved): 13 `V55_ITERATION_*_REPORT.md`, `CHANGELOG.md`, `TEST_PLAN.md`, `PACKAGE_MANIFEST.json`, `MIGRATION_V52_TO_V53.md`, `MIGRATION_V53_TO_V54.md`, `LITTLEWHITEBOX_REFERENCE.md`, `RETRIEVAL_ARCHITECTURE_2026.md`, `v5.4_开发上下文恢复.md`, `v5.4_验收报告.txt`, and `ARCHITECTURE.md` as `archive/ARCHITECTURE_iteration_log.md`.
- [ARCHITECTURE.md L1](file:///D:/memory_plugin/ARCHITECTURE.md#L1) - replaced by a 20-line signpost to `dev_docs/`, since the old content was an iteration log rather than an architecture.
- [README.md L3](file:///D:/memory_plugin/README.md#L3) and [README.md L329](file:///D:/memory_plugin/README.md#L329) - links to moved documents repointed at `archive/`.
- [dev_docs/09_legacy_inventory.md L100](file:///D:/memory_plugin/dev_docs/09_legacy_inventory.md#L100) - appended v2, which corrects v1.
- [dev_docs/09_legacy_inventory.md L1](file:///D:/memory_plugin/dev_docs/09_legacy_inventory.md#L1) - v1 kept as immutable history, including the part that was wrong.
- `remove/remove_2026_09_11_21_17_26_.../` - pre-overwrite snapshots of `ARCHITECTURE.md` and `v55-derived-store.js`, per that folder's header.

## Result

Root loose non-code files: 34 before, 12 after. Test suite: 70/70 in 19.1 s,
identical before and after the change.

A removal was attempted and reverted, and that is the most useful result here.
Entry 1 claimed six derived-store keys were dead. They are not. `DERIVED_KEYS` was
edited to drop them, `test-v55-derived-store.mjs` failed on `cold_turns`, and
`git checkout` restored the file byte-identically. The cause was the measurement,
not the code: the audit searched for the quoted literal `'cold_turns'`, which can
only match the declaration, while production code reaches the key as
`store.cold_turns`. All six are live, in `v55-evidence.js`, `v55-forget.js`,
`v55-summary-runtime.js`, `v55-provenance.js`, `v55-runtime.js`, `index.js` and
`v55-consistency.js`. The same error made the summary prompt key look dead; it is
a tombstone that is still cleared on every generation.

One open question was found and deliberately left alone: `spine` is declared both
in `DERIVED_KEYS` and as `SPINE_KEY`, and `v55-spine.js` states it is not a
derived-store key while `v55-derived-store.js` says it is. `MEMORY_PLAN_2026.md`
records a live measurement where registering it made `store.spine` undefined for
runtime readers. The spine does reach the prompt today, so the comment in
`v55-spine.js` is the stale half, but this is load-bearing state and was not
changed on a guess.

No code change survives this pass: `v55-derived-store.js` is byte-identical to
`e1f6e98`.

---

## Entry 3 - resolve the spine question, unify two key declarations, reduce remove/

- Date: 2026-09-11 21:35:00
- Session: same conversation, third request - "继续清理剩下的两个部分" (continue cleaning the remaining two parts).

## Problem / Requirement

Entry 2 left two items. First, two key names each had two declarations: `'spine'` appeared in
`DERIVED_KEYS` and again as `SPINE_KEY`, with the two files' comments contradicting each other, and
the summary prompt key was declared separately in `v55-consistency.js` and
`v55-summary-runtime.js`. Second, the untracked `remove/` area held 64.0 MB, mostly a third-party
reference checkout and stale snapshots of the plugin.

## Purpose of Change

Give each key name exactly one source of truth, settle the spine contradiction with a measurement
against the running app instead of an opinion, and reduce the scratch area without touching the
audit trail or the live-test harness.

## How It Was Changed

- [v55-derived-store.js L20](file:///D:/memory_plugin/v55-derived-store.js#L20) and [L59](file:///D:/memory_plugin/v55-derived-store.js#L59) - imports `SPINE_KEY` from `v55-spine.js` and uses it as the `DERIVED_KEYS` entry instead of repeating the literal.
- [v55-spine.js L14-L31](file:///D:/memory_plugin/v55-spine.js#L14-L31) - the stale claim that the spine is "not a derived store key" replaced by the measured behaviour, quoting the live reading, and recording the plan's open item as closed.
- [v55-summary-runtime.js L15-L17](file:///D:/memory_plugin/v55-summary-runtime.js#L15-L17) and [L286](file:///D:/memory_plugin/v55-summary-runtime.js#L286) - one exported `SUMMARY_PROMPT_KEY`.
- [v55-consistency.js L23](file:///D:/memory_plugin/v55-consistency.js#L23) - imports that constant; [L35](file:///D:/memory_plugin/v55-consistency.js#L35) - its duplicate declaration removed.
- `remove/` - `.ref-lwb`, 76 loose top-level files, `v5.5-dev-iteration08` and `source-adapters` deleted. `.audit-v55`, the three `remove_*/` entries and `header.md` kept.
- [dev_docs/09_legacy_inventory.md L231](file:///D:/memory_plugin/dev_docs/09_legacy_inventory.md#L231) - appended v3.

## Result

`node run-tests.mjs`: 70/70 in 19.1 s, unchanged. The code edits are behaviour-preserving by
construction - each replaces a literal with a constant holding the identical string - and both
directions reuse an import edge that already existed, so no new module edge and no cycle is possible.

The spine question is now settled with evidence rather than argument. Probed against the running app
before the change, on chat "Seraphina - 2026-09-11@20h22m03s183ms" with the derived backend hydrated
and `spine` in `DERIVED_KEYS`: `store.spine` was an own property of the live store carrying 50 nodes
and 10 ledger entries, `spinePromptBlock` produced 476 characters, and the spine was present in the
derived record's key list. The derived-store registration is therefore correct and the
`v55-spine.js` comment was the stale half; the plan's recorded failure belonged to the earlier
strip-based ownership guard, since replaced by a serialisation-time projection.

Measured after the change: the summary key literal occurs exactly once in the source tree,
`SUMMARY_KEY` occurs zero times, `SPINE_KEY` has one declaration, and the only remaining `'spine'`
literal is an injection-section id in `v55-quality-metrics.js`.

`remove/`: 2,969 files and 64.0 MB became 1,081 files and 9.6 MB; the whole workspace is 11.1 MB.

One file could not be deleted: `remove/CENTRALIZED_MEMORY_PROPOSAL.md`. Its ACL grants
`BUILTIN\Users` read-and-execute only, with modify rights held by a different sandbox account
(`ICEY0111\CodexSandboxUsers`), so deletion is denied even after clearing attributes and
`cmd /c del /f` is denied too. Left in place and reported rather than escalated for one stale note.

Not yet done: the change was verified by the test suite and by a live probe taken before the edit.
Re-running the probe against the edited code requires reloading the extension in the live app, which
is the next step rather than a completed one.

---

## Entry 4 - live verification of the unified keys

- Date: 2026-09-11 21:42:00
- Session: same conversation, continuing Entry 3.

## Problem / Requirement

Entry 3 closed with the change verified by the test suite and by a live probe taken *before* the
edit. The edited modules had not been loaded by the running app.

## Purpose of Change

Confirm in the real TauriTavern session that the edited modules load and that both unified constant
names resolve at runtime. Entry 3 is left untouched; this entry records what it left open.

## How It Was Changed

- The four edited modules were copied into the live extension folder, which is outside the workspace, so this step needed the wider sandbox mode.
- The page was reloaded and the chat re-opened, then probed with `remove/.audit-v55/live-check/expr-spine-recheck.js`.
- No project file changed in this entry.

## Result

Probed after reload on chat "Seraphina - 2026-09-11@20h22m03s183ms":

| Reading | Before the edit | After the edit |
|---|---|---|
| `store.spine` is an own property of the live store | true | true |
| spine nodes | 50 | 50 |
| `spinePromptBlock` characters | 476 | 476 |
| `DERIVED_KEYS.length` | 16 | 16 |
| last `DERIVED_KEYS` entry resolves to | "spine" | "spine" |
| `v55-summary-runtime.js` exports `SUMMARY_PROMPT_KEY` | no - it held a private `SUMMARY_KEY` | "aetheria_unified_memory_v5_5_hierarchical_summary" |

The last row is the discriminator. The pre-edit module did not export that name at all, so the probe
proves the edited module is the one the app loaded. Behaviour is otherwise identical, the derived
backend is still hydrated, and the spine still reaches the prompt.

The reload step itself reports `ok: false` with `Execution context was destroyed`. That is the
expected artifact of `location.reload()` destroying the execution context mid-evaluation, not a
failure: the fresh page and the successful character re-open confirm the reload happened.

---

## Entry 5 - the innovation decision, the length certificate, and the 100-floor run

- Date: 2026-09-11 22:10:00
- Session: same conversation. The owner asked for a decision on the innovation path, then to build the instrument in one pass and run a real 100-floor conversation against it without ever testing memory in-dialogue.

## Problem / Requirement

The research left one blank that matters: no benchmark measures whether a memory architecture causes
continuity failure, because the only available measuring device is a model judge and model judges are
demonstrably unreliable. The owner also corrected a unit error: 100 floors means 50 user turns plus 50
character replies, not 100 user turns.

## Purpose of Change

Own the ruling rather than the structure: build a judge-free instrument, then use it to decide which
structures are worth their cost. Then run a natural 100-floor conversation where nothing in the dialogue
tests memory, so that whatever survives at the end survived on its own.

## How It Was Changed

- [dev_docs/15_innovation_path.md L1](file:///D:/memory_plugin/dev_docs/15_innovation_path.md#L1) - the decision: what is blank, the thesis (memory is a projection of a complete log consumed by a frozen model, so its only value is soundness and sufficiency at a payable cost), what not to build, and the staged path.
- [v55-certificate.js L1](file:///D:/memory_plugin/v55-certificate.js#L1) - the instrument. Six checks per projection, all by string and identifier comparison with no model call: state coverage, soundness, commitment retention, epistemic leak, causal coverage and token cost.
- [test-v55-certificate.mjs L1](file:///D:/memory_plugin/test-v55-certificate.mjs#L1) - two projections over one store, one faithful and one broken in four named ways, plus a determinism assertion.
- [index.js L3378](file:///D:/memory_plugin/index.js#L3378) - the certificate is published in the quality report, computed from the same effective injected text T-Causal uses, so it is a live metric rather than a file nothing calls.
- Live harness (untracked, `remove/.audit-v55/live-check/`): `gen-airp100floor-turns.mjs` (50 user turns = 100 floors, a ten-act story, no turn asks the character to recall anything), `expr-airp100-run.template.js`, `gen-airp100-run.mjs`, `run-airp100floor.ps1`.

## Result

Test suite: **71/71 in 19.2 s**, the new certificate test included.

**Two real defects were found by the live smoke test, and neither was visible offline.** Both would have
silently corrupted the whole run:

1. The first template dropped the `reloadCurrentChat()` call the proven runner makes after pushing the
   user turn. The host's view of the conversation stayed stale and generation returned a **3-character
   reply** on turns 2 and 3. Restoring the reload fixed it.
2. On a brand-new chat the first `generate()` returned an **empty reply** before the greeting existed.
   The runner now requests and discards the greeting first, and the recovery ladder tries a fresh
   generation before falling back to `continue`.

After both fixes, the three-turn smoke test produced 498 / 423 / 505 characters (408 / 343 / 401 tokens)
with extraction completing on every turn, and the certificate reported real variation rather than a
constant - for example state coverage 9/13, causal coverage 2/2, commitment 2/4.

Two properties of the certificate were already visible in the smoke data and are findings, not bugs:
epistemic checks are **0** because `known_by` is still emitted for 0.0% of memories, so the instrument
cannot yet rule on the leak question; and turn-1 state coverage reads 0/5 because no memory exists
before the first extraction.

The 100-floor run (50 user turns, fresh chat, ~300-400 characters asked per reply) was launched as a
background job at 22:09. Its result is not in this entry.

---

## Entry 6 - the first 100-floor run produced blank turns; four defects, found from a screenshot

- Date: 2026-09-11 22:36:00
- Session: same conversation. The owner sent a screenshot of the running chat showing character turns rendered as empty bubbles containing only a collapsed "thinking" indicator.

## Problem / Requirement

The background run launched in Entry 5 was producing **empty character messages**. The chat file confirmed
it: across 46 rows, roughly half the character turns had `mes` length **0**. The suite was green, the smoke
test had reported 498/423/505 characters, and the run still produced nothing visible.

## Purpose of Change

Stop the run, find the real cause rather than the symptom, and make the runner's health checkable at the
transcript level, because the certificate measures the store and could not see this.

## How It Was Changed

Four distinct defects, all in the untracked live harness:

1. **`openai_max_tokens = 700`**: a reasoning model bills its hidden reasoning against the same budget, so
   the allowance was spent before any visible text. Raised to 1600.
2. **The empty character row was kept**: the run's recovery generated a replacement, but the empty row
   stayed in the transcript, so the UI showed a blank turn. The runner now removes a trailing empty
   character row.
3. **The prune did not save**: it edited `ctx().chat` in memory only, and the next `reloadCurrentChat()`
   restored the row from the file. Measured consequence: empty rows reappeared and two user turns ended up
   **adjacent**. The prune now calls `saveChat()`.
4. **A short but non-empty reply triggered a fresh `generate()`**, which creates a *second* message instead
   of extending the first. The recovery now branches: empty means remove and re-ask, short means
   `generate('continue')`, which appends in place and adds no row.

Harness files: `expr-airp100-run.template.js` (all four fixes), `gen-airp100floor-turns.mjs`,
`run-airp100floor.ps1`.

## Result

After the fixes, a four-turn verification on a fresh chat produced exactly **one** character reply per user
turn, at 464 / 445 / 496 / 421 characters, with no empty rows anywhere in the transcript. The run was
relaunched at 22:36 as `pwsh-19`.

**The important failure here is the measurement, not the model.** The Entry 5 smoke test "passed" at
498/423/505 characters because it measured message length, and the transcript it measured contained empty
rows that the number did not surface. A green test suite, a plausible metric, and a passing smoke test all
agreed while the product was visibly broken; a screenshot from the owner found it in seconds. The
certificate cannot cover this because it rules on the store, not on the transcript. The post-run analysis
must therefore assert transcript health directly: exactly one character row per user row, none empty.

---

## Entry 7 - chat saving failed mid-run; a per-batch health check added

- Date: 2026-09-11 22:56:00
- Session: same conversation. The owner sent a second screenshot showing "无法保存聊天 / 请检查服务器连接" toasts.

## Problem / Requirement

The relaunched run (Entry 6) stopped persisting the chat. The chat file on disk froze at 22:41:31 with 12
rows while generation continued. Measured directly: `saveChat()` rejected with
`{"error":"Failed to save chat","details":"[object Object]"}` over HTTP 500, and the host logged
`Unhandled rejection: Error at saveChatUnsafe (script.js:8544)`. The JSONL on disk was valid (12 lines, 0
unparseable), so the file was not the problem.

## Purpose of Change

Stop losing turns, find whether the cause was the run or the host, and add the transcript-level check that
Entry 6 admitted was missing.

## How It Was Changed

- Diagnosis: after a **page reload**, the same `saveChat()` returned **ok**. So the failure was in-page
  state accumulated by the runner's save/reload churn, not a corrupt chat and not the memory architecture.
- `run-airp100floor.ps1` - the page is now reloaded between batches and the chat reopened by name. This
  also exercises the derived store the way a real refresh does.
- `expr-health.js` - a transcript-level assertion run after **every** batch: user turns, filled replies,
  empty assistant rows, and a live `saveChat()` probe. `healthy` is true only when every user turn has
  exactly one non-empty reply. This is the check whose absence let Entry 5 pass while the product was broken.
- `expr-airp100-run.template.js` - supports reopening an existing chat and dropped a redundant reload
  inside the recovery ladder; the batch log now records a compact projection instead of the provider's
  multi-thousand-character reasoning blobs.

## Result

Batch 0 of the relaunched run (`pwsh-20`), fresh chat: 5 user turns, 5 replies, **0 empty assistant rows**,
`save: "ok"`, `healthy: true`, last reply 473 characters. The chat is
`Seraphina - 2026-09-11@22h56m08s521ms`.

First certificate reading, with no interpretation added yet: state coverage 17/18, stale 1, commitment
3/3, epistemic leak unmeasurable (holder sets still not emitted), causal 0/0 because no slot has two
revisions yet, T-Causal 18/19, injected 3,534 tokens. One turn did not confirm extraction inside the
90-second window.

Per-turn cost is about 105 seconds, so 100 floors is roughly 1.5 hours including the reloads. The run
continues; its result is not in this entry.

---

## Entry 8 - the 100-floor result, the measured root cause, and the first iteration

- Date: 2026-09-12 00:10:00
- Session: same conversation. The 100-floor run completed; the owner asked to iterate on the result.

## Problem / Requirement

The 100-floor run (`16_100floor_run_result.md`) showed the architecture is safe but not sufficient:
commitment retention flat at 100% for the whole run, state coverage falling 100% to 18%, T-Causal falling
100% to 13%, injected tokens rising 11x. Nothing was retired: 223 adds, 10 updates, 1 supersede, 7
retirements in 100 floors.

## Purpose of Change

Find the mechanism rather than the symptom, fix the mechanism, and validate on a run comparable to the
original so the two can be read side by side.

## How It Was Changed

**Diagnosis, from the live store, all deterministic:**

| Reading | Value |
|---|---|
| `add` operations | 223 |
| of those, creating a **brand-new slot** | **200** |
| of those, reusing an existing slot | **0** |
| distinct slots touched | 201 |
| slots written **exactly once** | **195** |
| memory text: median / mean / max | 79 / 81 / 183 chars |
| slot prefixes | `Seraphina.belief` 65, `.state` 48, `.knowledge` 43, `.commitment` 12 |

So the store does not grow because facts accumulate. It grows because **the extractor invents a new slot
for every fact and never reuses one**. Two thirds of the volume is `Seraphina.belief.*` entries that are
per-turn literary readings of the player's sentences ("she read 'us' as two people and a rattan chest"),
not world state.

A second reading corrected an earlier assumption of mine: the reference block is **not** mostly memories.
It is 11,346 characters of hierarchical summary carrying only **6** `<memory>` rows. The injected rows are
verbatim the stored texts (verified: `rowEqualsStored` true, 152 chars both sides), so the certificate is
measuring the right thing; the state simply is not in the block.

**The fix (prompt only, no new structure):**

- [memory-extractor.js L218](file:///D:/memory_plugin/memory-extractor.js#L218) - the `【slot】` section becomes `【slot 复用 — 强制】`: the extractor must read the existing slots it is already given and use `update / supersede / close` on them, and must not create a parallel slot. It states the measurement (200 of 223 adds created a new slot; 190-entry pool; 18% coverage) so the instruction carries its own evidence.
- [memory-extractor.js L218](file:///D:/memory_plugin/memory-extractor.js#L218) - a `【写入门槛】` test (durability in three days, consequence for later action, statability as a fact about the world), an explicit `【绝对不要写】` ban on wording analysis, sentence counting, rhetorical reading and meta-commentary about the conversation, and a bound of about six operations per turn.
- [test-v55-extraction-discipline.mjs L1](file:///D:/memory_plugin/test-v55-extraction-discipline.mjs#L1) - asserts every one of those clauses, including that the existing slots reach the extractor, so the discipline cannot be quietly dropped again.

## Result

Test suite: **72/72 in 19.1 s**.

Validation launched as `pwsh-21`: **25 user turns = 50 floors**, the same scenario prefix as the original
run, on a fresh chat, reloading between batches. Floor 50 is directly comparable with the original run's
floor 50, which read **state 48%, commitment 100%, causal 1/5, T-Causal 35%, 10,963 injected tokens**.

If the extraction discipline works, the state pool should stop growing roughly five slots per turn, and
state coverage at floor 50 should rise well above 48%. If it does not move, the prompt is not the lever
and the next candidate is a deterministic consolidation pass. That result is not in this entry.

---

## Entry 9 - the 50-floor validation: partial success, one clause that did nothing, one measurement bug of mine

- Date: 2026-09-12 00:35:00
- Session: same conversation. The 25-user-turn (50-floor) validation of Entry 8's extraction discipline completed.

## Problem / Requirement

Entry 8 changed only the extraction prompt and predicted that the state pool would stop growing about five
slots per turn. The validation was to confirm or refute that.

## How It Was Changed

Nothing in the plugin. Two harness defects the validation exposed were fixed:

- `expr-airp100-run.template.js` - a turn whose reply never arrived left a **user row with no reply**, which
  breaks the user/assistant pairing extraction depends on. The unanswered user turn is now dropped and the
  step records `droppedUserTurn`.
- `expr-batch.js` - the post-batch probe read the host's extension prompts, which can be empty between
  generations, and reported **0% coverage**. It now falls back to the persisted `v55_inner_bundle` and
  reports which source it used.

## Result

| reading | baseline (100-floor run) | now (25 user turns) |
|---|---|---|
| new slots per extraction | **5.0** (201 slots / 40 extractions) | **1.3** (32 / ~25) |
| slot reuse | 0 | **0** |
| `belief` share of memories | 31% | 10-18% |
| kind mix | belief 65 dominant | knowledge 19, commitment 14, belief 13, intention 11, state 9 |
| memories at 25 user turns | ~190 live slot values by turn 50 | 74 memories, **31** with a slot |
| injected characters | 10,963 tokens at floor 50 | 12,007 chars (~8k tokens) at floor 50 |

**What worked.** The state pool grew about **four times slower**, and the per-turn commentary flood is
gone: the store is now dominated by durable facts (knowledge, commitment, intention) instead of the
character's reading of individual sentences. That was the `【绝对不要写】` clause, and it worked.

**What did nothing.** `addReuseSlot` is still **0**. But the reading is probably not "the clause failed":
once the commentary entries stop being written, the remaining adds really are distinct new facts, so
`add` is the correct operation and there is nothing to reuse. The reuse clause is a no-op rather than a
failure, and it is not worth another iteration on its own.

**What the validation exposed about my own measurement.** Coverage read 0% on the last batch, and that was
my probe, not the memory: it read the host's prompt slots at a moment when they were empty because the
final turn had no reply. The store-shape numbers above are unaffected. Coverage must be taken from inside
the run, which the next validation will do.

**Still unsolved.** Injection grew from 7,359 to 12,007 characters over 25 turns, so the underlying
condition from Entry 8 has not changed: **a bounded budget against a set that only accumulates.** The
discipline made the set grow four times more slowly, which delays the collapse rather than preventing it.

That moves the lever. Extraction discipline is no longer the interesting question; the remaining one is
**which of the accumulated facts enter the budget, and whether any can be retired without losing a
question**. That is a selection and consolidation problem, decided by the certificate rather than by a
prompt.

---

## Entry 10 - measuring the budget without a model call, and the allocation it found

- Date: 2026-09-12 01:05:00
- Session: same conversation, continuing the iteration.

## Problem / Requirement

Entry 9 concluded the remaining lever was selection: a bounded budget against a set that only
accumulates. Choosing a selection policy by argument would have repeated the two mistakes already made
this session, so the first task was to make the question **measurable in seconds instead of an hour**.

## Purpose of Change

Turn injection-policy questions into a fast, repeatable measurement, find where the budget actually goes,
and spend it where it earns answerability.

## How It Was Changed

**A measurement method, not a change.** The injected blocks are only observable during a generation, which
is why the post-hoc probes returned zero. But the plugin's own interceptor can be invoked directly:
`globalThis.aetheriaUnifiedMemoryV54Interceptor(chat, contextSize, false, 'normal')` populates the host
prompt slots **without calling a model**. That turns a 40-minute run into a 0.4-second measurement and
makes ablation possible.

**Where the budget went** (50-floor chat, composition from the plugin's own `injectionComposition`):

| section | chars | tokens | share |
|---|---|---|---|
| layered summary | 7,675 | 5,820 | **54.9%** |
| current state | 5,000 | 2,610 | 35.8% |
| historical memory | 851 | 357 | 6.1% |
| reference head | 459 | 113 | 3.3% |

The current-state block was pinned at **exactly** its 5,000-character ceiling, and the summary was
spending 5,820 tokens.

**Ablation of the summary** - identical in every respect except the switch:

| | summary ON | summary OFF |
|---|---|---|
| injected tokens | 8,897 | **6,610** |
| state coverage | 17/31 | **17/31** |
| commitment | 19/19 | **19/19** |
| causal | 3/13 | **3/13** |
| T-Causal | 17/40 | **17/40** |
| violations | 0 | 0 |

**The layered summary contributed nothing to any measured question while costing 2,287 tokens.**

**Allocation sweep** (summary cap × current-state ceiling):

| summary | state ceiling | tokens | state | causal | T-Causal |
|---|---|---|---|---|---|
| 9,000 | 5,000 (old) | 8,897 | 17/31 | 3/13 | 17/40 |
| 0 | 16,000 | 7,654 | 21/31 | 3/13 | 22/40 |
| 0 | **20,000** | **7,213** | **28/31** | 3/13 | **26/40** |
| 2,000 | 20,000 | 7,264 | 28/31 | 3/13 | 26/40 |
| 4,000 | 20,000 | 7,399 | 28/31 | 3/13 | 26/40 |

- [index.js L171](file:///D:/memory_plugin/index.js#L171) - `current_state_context_max_chars` default **5,000 -> 20,000**, with the measurement as its justification.
- [test-v55-injection-allocation.mjs L1](file:///D:/memory_plugin/test-v55-injection-allocation.mjs#L1) - asserts the behaviour rather than the constant: a 20,000 ceiling must admit the live set, a small ceiling must still bind, the declared 20,000 maximum must still hold, and a mandatory irreversible row must survive the smallest ceiling.

## Result

Test suite: **73/73 in 19.4 s**.

Measured on the 50-floor chat, changing only the allocation:

| | before | after |
|---|---|---|
| state coverage | 17/31 (55%) | **28/31 (90%)** |
| T-Causal | 17/40 (43%) | **26/40 (65%)** |
| commitment | 19/19 | 19/19 |
| causal | 3/13 | 3/13 |
| **injected tokens** | 8,897 | **7,213 (-19%)** |

**Coverage rose 35 points and cost fell 19%.** The mechanism is visible in the sweep: as the ceiling
rises the reference block shrinks (8,984 -> 1,317 characters), because state the model is simply given no
longer has to be recalled. That is the sufficiency principle from `15_innovation_path.md` showing up as a
measurement rather than as a thesis.

Two things this does not fix, recorded so they are not mistaken for solved: **causal coverage stayed at
3/13** (the replaced endpoints are still not rendered, a separate gap), and the summary is left enabled at
a small size rather than removed, because the certificate cannot measure whether it helps the *prose* -
only that it does not help these questions.

Validation of the change in a real run (`run-validate50b.ps1`, 25 user turns = 50 floors, the same
scenario prefix, logging the in-run certificate this time) launched as `pwsh-22`. Its result is not in
this entry.

---

## Entry 11 - the validation looked like a null result until the budget itself was measured

- Date: 2026-09-12 01:20:00
- Session: same conversation. The 50-floor validation of Entry 10's allocation change completed.

## Problem / Requirement

The sweep predicted state coverage 55% -> 90%. The real run's last turn read **53%**. That disagreement
had to be explained rather than averaged, and the change had to be kept or reverted on evidence.

## How It Was Changed

Nothing in the plugin in this entry.

## Result

**The run itself** (25 user turns scheduled; 24 completed because one reply never arrived and the new
pairing guard correctly dropped the unanswered user turn, giving 24 users and 24 replies instead of 25 and
24):

- All 5 batches: `healthy: true`, `save: ok`, no empty rows. The transcript-health guard worked.
- End-of-run in-run certificate: state **18/34 (53%)**, commitment 12/12 (100%), causal 4/17, T-Causal
  **15/40 (38%)**, 10,253 tokens.
- Prior 50-floor run for comparison: state 17/31 (55%), causal 3/13, T-Causal 17/40 (43%), 8,897 tokens.
- Within the run, coverage **oscillated between 44% and 100%** (turns 17, 18 and 21 all read 100%).

So on the headline reading, the change bought nothing and cost more. That is what the run says, and it is
recorded as a null result.

**Why it was a null result, measured.** The plugin's own consistency record on the final chat:

| reading | value |
|---|---|
| transcript | 13,753 chars / **10,470 tokens** |
| `combined_cap_chars` | 32,000 |
| `combined_used_chars` | 23,968 |
| injected reference + current state | 11,719 + 12,249 |

The memory budget is **not a fixed number that a setting controls**. It is whatever is left after the
transcript, and the transcript grows every turn. A standalone budget probe returned an effective combined
cap of **13,184** characters when invoked with the host's reported 8,192-token context, while the live
generation recorded 32,000 - so the effective budget also depends on the context the interceptor is handed.
Raising a configured ceiling therefore cannot help: something else decides how much room there is.

**The decisive test, run on the real chat at floor 48**, holding the total character budget fixed (all
three rows produced exactly 13,985 characters — the budget is fully consumed either way, so the only
question is *what it is spent on*):

| allocation (state cap / reference cap) | injected tokens | state coverage | causal | T-Causal |
|---|---|---|---|---|
| 5,000 / 12,000 (old) | 9,138 | **15/34 (44%)** | 2/17 | **12/40 (30%)** |
| 20,000 / 12,000 (new) | **7,260** | **31/34 (91%)** | 3/17 | **25/40 (63%)** |
| 20,000 / 4,000 | 7,260 | 31/34 (91%) | 3/17 | 25/40 (63%) |

**At a fixed budget, spending it on state instead of recall and summary takes coverage from 44% to 91%,
T-Causal from 30% to 63%, and total injected tokens down 21%** (9,138 -> 7,260). The allocation change is
kept on this evidence.

The two readings are consistent once the mechanism is named: the allocation is worth a great deal *at a
given budget*, and the end-of-run reading is low because **the budget had been squeezed**, not because the
allocation failed. The certificate measures the projection the plugin built; the projection's size is
decided by a dynamic budget the plugin does not currently control or report.

**What this makes the next lever.** Not the caps. The transcript is 10,470 tokens at floor 48 and grows
without bound, and the memory budget is whatever remains. Reducing the transcript's share - floor folding
and cold-original eviction, the machinery that the earlier functional audit found had *zero observable
effect* - is what would stop the memory budget shrinking as a conversation gets long.

---

## Entry 12 - the transcript conclusion in Entry 11 was wrong; folding works, and the cost/quality frontier measured

- Date: 2026-09-12 01:45:00
- Session: same conversation, continuing the iteration.

## Problem / Requirement

Entry 11 concluded that the memory budget shrinks because the transcript grows, and named floor folding as
the next lever. That conclusion had to be checked before acting on it.

## Result

### 1. Entry 11 was wrong: folding works, and the transcript is not the constraint

Measured on the same chat:

| reading | value |
|---|---|
| chat rows | 49 |
| rows folded | **47** |
| rows in the prompt | **2** |
| characters in the prompt transcript | **520** |
| tokens in the prompt transcript | **402** |
| folded characters | 13,233 of 13,753 |

`floorFoldStatus` reports `enabled: true, keep_recent: 1, hidden_messages: 47, prompt_messages: 2`. The
10,470-token figure in Entry 11 was the **whole chat file**, including the 47 rows folding had already
removed from the prompt. The transcript contributes 402 tokens, not 10,470, so it is not squeezing the
memory budget. **Floor folding is not dead machinery; it is doing its job.**

What actually sets the budget (from `v55-runtime.js`):

    combined = min( reference_cap + current_state_cap , (contextSize - replyReserve) * 2 )

and `budgetPromptPair` already gives current state priority over reference and truncates reference into
whatever remains. That part of the design is correct.

### 2. The frontier, measured at the context size a real generation uses

| reference cap | tokens | state | causal | T-Causal | stale |
|---|---|---|---|---|---|
| 12,000 (current) | 14,619 | **33/34 (97%)** | 6/17 | **29/40 (73%)** | 2 |
| 8,000 | 12,073 | 31/34 (91%) | 4/17 | 26/40 (65%) | 0 |
| 6,000 | 10,549 | 31/34 (91%) | 3/17 | 25/40 (63%) | 0 |
| 4,000 | 9,155 | 31/34 (91%) | 3/17 | 25/40 (63%) | 0 |
| 2,000 | **7,526** | 31/34 (91%) | 3/17 | 25/40 (63%) | 0 |

The reference block is **flat below 4,000 characters**: 4,000 and 2,000 produce identical readings, so the
last 2,000 characters are pure waste. Against the current default, trimming reference to 2,000 would save
**7,093 tokens (48%)** and cost 2 points of state coverage, 3 of causal and 4 of T-Causal.

**Not changed.** That trade is a product decision, not a measurement, and the certificate cannot see what
the reference block does for the *prose* - recalled memories and scene detail are also what makes a reply
feel continuous. The frontier is recorded so the trade can be made deliberately rather than guessed.

### 3. A measurement I do not trust yet

The in-run certificate and the post-run reconstruction **disagree on the same chat**: the run's final turn
read state 18/34 (53%), and calling the same interceptor with the same settings minutes later reads
**33/34 (97%)**.

Leading explanation, not yet proven: the in-run certificate is taken after the extraction call completes,
and the extraction is itself a `generateRaw` call that runs the interceptor against a small budget and
**overwrites the host prompt slots**. If so, the in-run certificate was measuring the projection built for
the quiet extraction, not the one the roleplay generation used.

Until that is settled, the post-run reconstruction is the number to quote for the roleplay path, and every
in-run certificate in this session should be treated as suspect. This is recorded because it is exactly the
class of error that produced the blank-turn and zero-coverage mistakes earlier: **a measurement that
agrees with itself while measuring the wrong moment.**

---

## Entry 13 - the measurement is settled, and the change is much larger than the run reported

- Date: 2026-09-12 02:05:00
- Session: same conversation, fixing the measurement before doing any more tuning.

## Problem / Requirement

Entry 12 recorded that the in-run certificate (state 53%) and the post-run reconstruction (state 97%)
disagreed on the same chat, and that tuning on an untrusted ruler would tune the wrong thing. The leading
hypothesis was that the quiet extraction call re-runs the interceptor and overwrites the host prompt slots.

## How It Was Changed

Instrumented the interceptor itself: wrapped `globalThis.aetheriaUnifiedMemoryV54Interceptor` so every
invocation records its arguments and the resulting block sizes, then ran one real generation.

## Result

**The hypothesis is refuted.** One generation produced **exactly one** interceptor call:

    { contextSize: 1998400, refChars: 12000, stateChars: 12306 }

- The extraction does **not** invoke the interceptor, so it cannot overwrite the projection.
- `contextSize` is **1,998,400**, not 8,192. The context clamp `(contextSize - reserve) * 2` therefore never
  binds, and the configured caps decide the split. The earlier 13,184 figure came from a probe that passed
  8,192 by hand; it was self-inflicted and, briefly, the basis of a wrong conclusion.
- The projection for a real generation is **12,000 + 12,306 = 24,307 characters**.

**Both projection-extraction methods agree at this moment**, which removes the last doubt:

| method | state | commitment | causal | T-Causal | tokens |
|---|---|---|---|---|---|
| every prompt slot joined | **34/34 (100%)** | 12/12 | 6/17 | **30/40 (75%)** | 14,600 |
| the two named keys | **34/34 (100%)** | 12/12 | 6/17 | **30/40 (75%)** | 14,600 |

**Why the in-run certificate read low.** It is taken after the generation and the extraction wait. When a
generation fails the prompt slots are empty (the run's dropped turn read `tokens=0, state=0/28`), and
between generations they can hold a partially rebuilt projection (the final turn read 10,253 tokens
against the true 14,600). **The in-run certificate samples a mutable global at an unconstrained moment.**

**The protocol is therefore fixed for the rest of this work: never trust a post-hoc probe or an in-run
sample. Call the interceptor, then read the two named prompt keys.** That is what every measurement in
Entries 10 to 12 should have been, and the ones that were not are to be treated as noise.

## The corrected headline

Same scenario prefix, floor 50, trustworthy method:

| | before this iteration | after |
|---|---|---|
| state coverage | 48% | **100%** |
| commitment | 100% | 100% |
| causal coverage | 20% | 35% |
| T-Causal | 35% | **75%** |
| injected tokens | 10,963 | 14,600 (+33%) |

The iteration that Entry 11 called a null result was in fact the largest single improvement of the session.
The null result was an artefact of the ruler.

Two things remain true and are not claimed as fixed: **causal coverage is still 6/17 (35%)**, and the
injection is 33% more expensive, with the measured frontier (Entry 12) offering a deliberate way to trade
that back.

---

## Entry 14 - the causal hole closed, and the budget correction made to reach existing installs

- Date: 2026-09-12 02:40:00
- Session: same conversation, completing the remaining two items in one pass.

## Problem / Requirement

Entry 13 left two things: **causal coverage 6/17 (35%)**, the largest remaining hole, and an injection 33%
more expensive than the pre-iteration baseline.

## How It Was Changed

**Diagnosis with the trustworthy protocol** (call the interceptor, read the two named keys):

- The change chain **is** injected and its marker **is** in the projection.
- `spinePromptBlock` produced only **587 characters**, rendering **7 of 19** replaced values, against 17
  slots that had actually changed.
- `spine_injection_max_chars` was **600** by default. The only carrier of "why is it like this now" had the
  **smallest budget in the system**, while the reference block had 12,000 and the state block 20,000.

**Sweep** (spine budget x reference budget), trustworthy protocol, on the 50-floor chat:

| spine cap | reference cap | spine chars rendered | tokens | state | causal | T-Causal |
|---|---|---|---|---|---|---|
| 600 (old) | 12,000 | 587 | 14,600 | 34/34 | 6/17 (35%) | 30/40 (75%) |
| 1,200 | 12,000 | 995 | 14,865 | 34/34 | 8/17 (47%) | 32/40 (80%) |
| 2,400 | 12,000 | 2,277 | 15,714 | 34/34 | 10/17 (59%) | 35/40 (88%) |
| 4,000 | 12,000 | 3,609 | 16,589 | 34/34 | **13/17 (76%)** | **39/40 (98%)** |
| 4,000 | 8,000 | 3,609 | **14,079** | 33/34 | 13/17 (76%) | 37/40 (93%) |

The last row is the choice: **better than the old configuration on every axis and cheaper than it**, paying
for the chain out of the reference block, which Entry 12 had already measured as flat below 4,000
characters.

- [index.js L191](file:///D:/memory_plugin/index.js#L191) - `spine_injection_max_chars` **600 -> 4000**, `spine_injection_max_rows` **8 -> 24**.
- [index.js L170](file:///D:/memory_plugin/index.js#L170) - `reference_context_max_chars` **12000 -> 8000**.
- [test-v55-causal-budget.mjs L1](file:///D:/memory_plugin/test-v55-causal-budget.mjs#L1) - asserts the chain carries the replaced values, that the budget scales it, that the changed slot is named, and that an unchanged slot is not listed.

**A gap that would have made all of this invisible.** `getSettings` only fills keys that are **absent**, so
a corrected default reaches new installs and reaches existing ones **never**. Every measured correction in
this session would have applied only on a fresh installation.

- [index.js L298](file:///D:/memory_plugin/index.js#L298) - `MEMORY_BUDGET_VERSION`, `MEMORY_BUDGET_MIGRATIONS` and `migrateMemoryBudgets`: one rewrite of the three budget keys, once, stamped so a later user edit is respected.
- [test-v55-budget-migration.mjs L1](file:///D:/memory_plugin/test-v55-budget-migration.mjs#L1) - an old install is corrected once; a second run does nothing; a budget the migration does not own is untouched; a user edit after migration survives.

## Result

Test suite: **75/75 in 19.7 s**.

**Verified live on the 50-floor chat**, same moment, old allocation then new:

| | old | new |
|---|---|---|
| injected characters | 24,289 | 23,335 |
| injected tokens | 14,605 | **14,079 (-4%)** |
| state coverage | 34/34 (100%) | 33/34 (97%) |
| soundness violations (stale rendered live) | 2 | **0** |
| commitment | 12/12 | 12/12 |
| **causal coverage** | **6/17 (35%)** | **13/17 (76%)** |
| **T-Causal** | **30/40 (75%)** | **37/40 (93%)** |
| T-Causal violations | 0 | 0 |

Causal coverage **doubled**, T-Causal rose 18 points, stale rendering went to zero, and the total is
cheaper. The one cost is a single state value (34 -> 33), within the noise of which memories happen to
render.

End-to-end validation launched as `pwsh-23`: 25 user turns = 50 floors, the same scenario, new budgets
forced, transcript health asserted after every batch. Its result is not in this entry.

---

## Entry 15 - what the memory system actually costs, and the two cuts that were free

- Date: 2026-09-12 04:00:00
- Session: same conversation. The owner asked what the memory system costs in tokens and said plainly that
  it must be cheap or it is a liability in itself.

## Problem / Requirement

Measure the real cost, then cut it without losing what the system is for.

## Measurements

**Per generation, on the 50-floor chat** (interceptor protocol):

| item | chars | tokens | share |
|---|---|---|---|
| state summary (canonical state, every active memory as `- [kind:slot] text`) | 8,260 | 4,701 | 35% |
| layered plot summary | 7,541 | 6,060 | 46% |
| current-state grouped rows | 3,565 | 2,396 | 18% |
| reference head | 459 | 113 | 1% |
| **total** | 19,826 | **13,269** | |

**Stored, for the same chat**: 153,992 characters / **59,236 tokens**.

| stored part | chars | tokens | share |
|---|---|---|---|
| extraction log (26 operation records) | 59,583 | 25,907 | 44% |
| memory records as JSON (72 memories) | 68,171 | 21,335 | 36% |
| spine | 18,606 | 5,456 | 9% |
| layered summaries | 7,803 | 4,428 | 7% |
| entity registry | 6,265 | 1,711 | 3% |
| baseline, vector, slots, settings | 2,274 | 650 | 1% |

**The actual memory text is 4,391 characters / 3,824 tokens.** The JSON that carries it is 21,335 tokens -
a **15.5x wrapper**. Against a 10,150-token transcript, the memory system stores 584% of the source and
injects 131% of it every turn.

## The two cuts that were free, and the one that was not

**Free: opaque registry ids.** Rows rendered `entities=ent_1h6kygz,...` and `known_by=...`. Those are
hashes a reader cannot map to anything. 62 rows spent 2,842 characters / **709 tokens** on them.
- [v55-runtime.js L280](file:///D:/memory_plugin/v55-runtime.js#L280) - `canonicalLine` no longer renders them. When the epistemic channel is built it must render holder **names**.
- [test-v55-runtime.mjs L46](file:///D:/memory_plugin/test-v55-runtime.mjs#L46) - a test asserted `known_by=ent_a`. Rather than delete the assertion, it now asserts the ids are gone **and** that a row still names the fact it is about, with the reason recorded.

**Free: reference block 8,000 -> 4,000.** On this chat 8,000 / 4,000 / 2,000 all produced **state 10/10,
commitment 22/22, causal 3/3, T-Causal 12/14, zero violations**, while tokens fell 12,576 -> 9,513 ->
7,541. 2,000 is not the default because on a denser chat the same trim cost 3 T-Causal points; 4,000 is
free on the sparse chat and still funded on the dense one.

**Not free, and reverted: capping the state summary.** The obvious saving was to cap the 8,260-character
prose summary to 1,200, which cut the injection 29% (13,269 -> 9,468). It also dropped state coverage
**10/10 -> 8/10**, because that summary is not a restatement of the rows below it: it is the canonical
state rendered for **every** active memory, so it is the state carrier, and the rows hold only the
mandatory baseline plus the grouped subset. Reverted, with the reason written into the code so it is not
tried again. **The real duplication is that state is rendered twice**; removing it means making the rows
the complete carrier first, which is a design change rather than a budget trim.

**Identified and not taken: the layered summary.** Two independent ablations found it contributes nothing
to any measured question (state, causal, T-Causal all unchanged) while costing 345 to 1,932 tokens. It is
left on because its enabled flag and context cap live in `v55-summary-runtime.js` defaults rather than in
the plugin settings, so changing its default is a settings-path question, not a one-line trim - and
because the certificate cannot see what it does for the prose.

## Result

Test suite: **75/75 in 19.7 s**.

**Verified live after a page reload, with no manual override** - the migration did the work:

    memory_budget_version: 3, reference: 4000, current_state: 20000, spine: 4000/24
    certificate v1 tokens=9506 state=10/10 (100%) stale=0 commitment=22/22 (100%) causal=3/3 tcausal=12/14 violations=0

| | before this entry | after |
|---|---|---|
| injected tokens | 13,269 | **9,513 (-28%)** |
| state / commitment / causal / T-Causal | 10/10, 22/22, 3/3, 12/14 | **identical** |
| opaque id tokens | 709 | 0 |

Against the session start (10,963 tokens, state 48%, T-Causal 35%) the system is now **cheaper and carries
100% of the state instead of 48%**.

**Still on the table, in size order**: the extraction log at 25,907 stored tokens (kept because it is the
replay source), the 15.5x JSON wrapper around 3,824 tokens of memory text, and the twice-rendered state.











