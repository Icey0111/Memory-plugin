# dead_context_trimming_controls_removed

- Date: 2026-09-12 16:34:49
- Session: Find out why generation refused to run, prove whether the plugin caused it, then run the 20-user-turn / 40-floor acceptance the user asked for.

## Problem / Requirement

The user's standing goal is a memory system that is **又省又稳** — high-quality compression that never
forgets key or irreversible facts. The immediate instruction was: run the acceptance test the user had
spec'd (**20 user turns, 40 floors, ~300-400 character replies, natural conversation rather than
deliberate "do you remember" questions, with a summary pass every 10 floors**), and in the same pass
clean up whatever old functionality was still lying around.

The blocking symptom was that generation refused to run at all:

    ChatSurface projection has 3 ranges; maximum is 2

thrown from inside `generate()`, so the UI simply looked like the model was thinking forever. The
previous session had recorded this as **not caused by the memory plugin** and had escalated it as a
host/application bug, on the strength of three isolations: the plugin disabled, both plugin blocks
forced to one depth, and every SillyTavern core IN_CHAT prompt moved out of the way. The error survived
all three, so the plugin looked exonerated.

## Purpose of Change

Stop guessing at the range limit from the outside and read the host's own validator, then get a clean
20-turn run so the memory system's real behaviour can finally be measured instead of argued about.

## How It Was Changed

### Finding the rule instead of inferring it

- The error string is not in any on-disk `.js`, but the host serves its frontend modules over
  `http://tauri.localhost/`. Fetching them from inside the page located the throw site:
  `kernel/chat-surface/projection.js`. The rule is `collectRanges(indices)` — **consecutive** indices
  merge into one range, and more than two ranges is refused.
- `bounded-chat-surface.js` builds the projection as `viewportItems` union `{tailMessageId}` and
  validates that the viewport is one contiguous run, so that path can produce at most two ranges.
  The failing call therefore had to come from somewhere else.
- Capturing the thrown error's stack settled it:
  `createChatProjection` ← `commitProjection` ← `reconcileMounted` ← `reconcileMountedChatSurface` ←
  `addOneMessage`. **The projection is rebuilt from the messages currently mounted in the DOM.**
- A DOM probe showed `#chat` holding exactly two elements, mesid 0 and mesid 2, on a chat with 15+ rows.
  The mounted set was already fragmented; adding the next reply produced a third group.
- Cause of the fragmentation: the test driver itself. `expr-run40-*.js` did `ctx.chat.push({...})` and
  then called `generate()` directly. The user row was never rendered, so the DOM and `ctx.chat`
  desynchronised on the first turn and every later generation inherited the damage. The very first
  generation had already poisoned the chat; each subsequent one threw earlier.
- **The plugin never touches either side.** Grepping the whole tree finds zero `chat.push` / `chat.splice`
  / `removeChild` / `display='none'`; the only message-DOM interaction is
  `document.querySelector('.mes[mesid=...]')` in `v55-floor-fold.js`, used to toggle a CSS class
  ([v55-floor-fold.js L139-L145](file:///D:/memory_plugin/v55-floor-fold.js#L139-L145)). The earlier
  "not the plugin" conclusion was right, but for the wrong reason — it was not a host bug at all, it was
  a harness bug.

### Fixing the harness instead of the product

- New driver pair `expr-real1.js` / `expr-real2.js` (in `remove/.audit-v55/live-check/`, untracked) send
  through the real UI path: set `#send_textarea`, dispatch `input`, click `#send_but`, await
  `GENERATION_ENDED`, then wait for the extraction counter to advance. This keeps DOM and chat in step.
- One generation was spent on a smoke turn before the batch, per the standing lesson from the earlier
  20-turn attempt. It succeeded, so the batch was launched.

### Dead-code cleanup (the only product change)

- [index.js L250-L258](file:///D:/memory_plugin/index.js#L250-L258) — removed the
  `manage_context_window` and `keep_recent_messages` defaults.
- [index.js L2700-L2712](file:///D:/memory_plugin/index.js#L2700-L2712) — removed `trimPromptHistory()`,
  whose entire body was a comment plus `return 0`.
- [index.js L2765-L2780](file:///D:/memory_plugin/index.js#L2765-L2780) — removed the last call site and
  its `trimmedMessages` log field.
- [index.js L3130-L3140](file:///D:/memory_plugin/index.js#L3130-L3140) and
  [index.js L3180-L3190](file:///D:/memory_plugin/index.js#L3180-L3190) — removed the two renderer binds.
- [settings.html L156-L165](file:///D:/memory_plugin/settings.html#L156-L165) — removed the
  "上下文裁剪（暂不启用）" heading, the permanently disabled checkbox and the hidden number input; kept the
  paragraph explaining *why* the plugin does not trim history, reworded so it no longer points at
  controls that do not exist.
- Pre-change snapshots: `remove/remove_2026_09_12_16_34_48_dead_context_trimming_controls/`.

## Result

**The 20-user-turn / 40-floor acceptance run completed with zero generation failures.**

| batch | turns | gen errors | timeouts | extraction timeouts | evidence turns | avg reply chars |
|---|---|---|---|---|---|---|
| smoke | 1 | 0 | 0 | 0 | 1/1 | 515 |
| 2-10 | 9 | 0 | 0 | 1 | 9/9 | 489 |
| 11-20 | 10 | 0 | 0 | 0 | 10/10 | 413 |
| **total** | **20** | **0** | **0** | **1** | **20/20** | **449** |

Reply lengths ranged 270-567 characters and all 19 non-smoke replies were Chinese; 19/19 fell inside the
250-700 band that the user's "300-400, not strict" allows.

Memory grew 12 → 44 records, 41 active, 24 slot-bearing, 20 extractions (one per turn). The reference
block saturated at its 4,000-character cap from turn 4; the state block grew 913 → 7,246 characters.
Visible injected text averaged 7,913 characters per turn (ref 3,655 + state 4,257).

Live certificate on the finished chat:

    certificate v1 tokens=6881 state=20/24 slots (83%) stale=0 commitment=34/39 (87%)
    leak=not-checked causal=6/12 tcausal=29/40 violations=0 unexercised=no_stale

Recall of planted details, taken only from the replies (the character was never asked "do you remember"):

| detail | planted at turn | echoed by the character at |
|---|---|---|
| 凿痕 (three inward-slanting chisel marks) | 4 | 10, 15, 16 |
| 鹿 (the deer that fell thirty years ago) | 6 | 7, 8, 9, 20 |
| 藤箱 / 叶脉 (half a leaf-vein on the box) | 8 | 19, 20 |
| 脚印 (two sets of footprints) | 16 | 17, 18 |
| 石槽 (the old stone trough at the ditch bottom) | 19 | 20 |

Summary passes after turns 5 / 10 / 15 / 20 produced level-1 rows of 6 / 10 / 15 / 11 (884 / 1,659 /
2,566 / 2,068 chars). The level-1 count **falling** from 15 to 11 on the last pass is recorded as
observed, not explained.

### Problems this run exposed, recorded rather than smoothed over

1. **The narrative frame broke in the second half.** The character card puts the user bedridden in
   Seraphina's hut, while turns 11-20 have the user walking to the city gate, into the forest and back.
   The model resolved the contradiction by playing the user as a liar, so turns 12-20 are a repetitive
   interrogation instead of a story. This is a defect in the test scenario, not in the plugin, but it
   depresses every "did the model use the retrieved text" signal in the back half and has to be fixed
   before the next run.
2. **The rare-bigram control is not a control.** 68% of replies contain a rare bigram drawn from *another*
   turn's evidence, against 42% from their own. The evidence blocks share so much narrative text that
   "other turns' evidence" is not a clean negative. The H4 question (is retrieved original text actually
   used?) is therefore **not answered** by this run.
3. **`/note` inserts a chat row.** The instruction written with `/note` appears as message 1 on the chat,
   not only as `chat_metadata.note_prompt`. The run is still valid, but one of the 42 rows is an
   instruction, not a floor.
4. **Folding is on by default and very aggressive.** `summary_fold_hidden_floors: true` with
   `summary_fold_keep_recent_floors: 1` (both shipped defaults) left `prompt_messages: 5` of
   `chat_messages: 42` — 37 rows hidden, all 37 still reachable through retrieval. That is the thesis
   working as designed, but it means the model saw almost no raw history, and the run does not test the
   unfolded path.

### Verification of the cleanup

`npm run check` clean; `node run-tests.mjs` **84/84 test files passed**. No test asserted the removed
contract, because there was no behaviour behind it to assert.

### Still open

- H4 (is retrieved text used) needs a scenario without the frame collapse, and a control that does not
  share narrative text with the treatment.
- B2 (relevance-driven selective un-hiding, default off) remains deliberately deferred.
- Phase E (LongMemEval), D1 (`vector.stale`, needs an embedding provider) and C1 (the remaining
  compression headroom) are untouched by this session.

---

## Second change: the removal was invisible in the running app, and the stale values were still stored

### Problem / Requirement

Two gaps found while verifying the cleanup above, not while writing it.

First: `node deploy-live.mjs --apply` reported `identical: 138, changed: 1  index.js`. It had not copied
`settings.html` at all. The script's payload filter was `/^(.*\.(js|mjs|json|md))$/`, so the settings page —
which `manifest.json` declares and the host fetches from the same directory — had been silently drifting
from the repository for as long as the script has existed. The cleanup was live in name only.

Second: after the redeploy and reload, the two removed keys were still present in the persisted settings
blob. Removing a key from `DEFAULT_SETTINGS` stops it being written, but does not remove the copy already
saved into `ctx.extensionSettings`. Inert, since nothing reads them, but exactly the kind of leftover the
user asked to have cleaned up.

### Purpose of Change

Close both gaps so "removed" means removed in the running app, not just in the repository.

### How It Was Changed

- [deploy-live.mjs L44-L51](file:///D:/memory_plugin/deploy-live.mjs#L44-L51) — `html` added to the payload
  filter, with a comment saying why the omission was not obvious.
- [index.js L259-L263](file:///D:/memory_plugin/index.js#L259-L263) — new `REMOVED_SETTINGS_KEYS` list.
- [index.js L355-L368](file:///D:/memory_plugin/index.js#L355-L368) — `getSettings` deletes any removed
  key it finds on a stored blob.

### Result

- `node deploy-live.mjs --apply` now reports `changed: 2  deploy-live.mjs, settings.html` and copies both.
- Live settings DOM, after reload: `document.getElementById('aum-v54-manage-window')` and
  `aum-v54-keep-recent` both `null`; zero hits for either id in the served `settings.html`.
- Live settings blob, after reload: both keys already gone **before** the interceptor was invoked, so the
  extension's own init path prunes them; 139 keys remain and `debug` / `injection_depth` are intact.
- Live injection re-measured on the finished 42-row chat through the documented interceptor protocol:
  interceptor returns without error, reference block 2,580 chars, state block 8,115 chars, 44 memories,
  41 active. The extension is not damaged by the removal.
- `npm run check` clean; `node run-tests.mjs` **84/84 test files passed**.

---

## Third change: the evidence block was injected twice, and its lines were never checked against the prompt

### Problem / Requirement

A second 20-user-turn acceptance run was started to fix the previous run's scenario defect and to finally
isolate H4 (is retrieved original text actually used?). Two defects surfaced from the run itself rather
than from reading code.

First: on turn 1 of a fresh chat, the reference block the model receives was

    [MEMORY ABSTENTION - THE RECORD HAS NOTHING FOR THIS TURN] No stored memory or original text
    resolved for: Seraphina. Their current state is unknown; say so rather than inventing it.

**twice**, verbatim, 368 characters. `runWithV55ConsistencyInner` appended the resolved evidence block to
the reference text once before `budgetPromptPair` and again after it, so every evidence line reached the
model duplicated. The pre-budget copy also sat inside the string that the reservation at
`maxReferenceChars` was subtracting for, so the duplicate was charged to the reference budget twice.

Second: over the run, **31,310 characters of evidence text were injected**, and **8,529 of them (27%) were
already present verbatim in the reference or state block**, rising to **70% on the worst single turn**. The
candidate screen in `resolveTurnEvidence` tests only the first 24 characters of the *memory* text, while
what is actually emitted is the expanded *turn* text, which a memory summary never contains. The screen is
therefore structurally unable to see the duplicate it is looking for.

### Purpose of Change

Stop paying twice for the same text, and make the check happen where the two texts can actually be
compared.

### How It Was Changed

- [v55-consistency.js L268-L273](file:///D:/memory_plugin/v55-consistency.js#L268-L273) - the pre-budget
  append is gone; the evidence block is appended once, after budgeting, which is what the reservation was
  always written for.
- [v55-evidence.js L290](file:///D:/memory_plugin/v55-evidence.js#L290) - `formatEvidenceBlock` takes
  `alreadyVisible`.
- [v55-evidence.js L304-L330](file:///D:/memory_plugin/v55-evidence.js#L304-L330) - a line whose body is
  already in that text is dropped; a block whose every line is dropped returns `''` rather than a heading
  with nothing under it. Lines under 20 characters are never dropped, because removing them saves nothing.
- [v55-consistency.js L249-L258](file:///D:/memory_plugin/v55-consistency.js#L249-L258) - the caller passes
  the reference and state text it is about to publish.
- [test-v55-turn-evidence.mjs L89-L125](file:///D:/memory_plugin/test-v55-turn-evidence.mjs#L89-L125) - new
  case 7: a visible line is not repeated, an invisible one survives, an all-visible block reports nothing,
  and a sub-20-character line is never dropped.
- Pre-change snapshots: `remove/remove_2026_09_12_16_52_10_evidence_block_appended_twice/` for the first
  defect, `remove/remove_2026_09_12_17_12_00_evidence_lines_already_visible/` for the second.

### Result

- Duplication confirmed gone live: interceptor invoked on the finished 20-turn chat, 6 evidence lines,
  **0 of them present anywhere in the rest of the reference or the state block**.
- Same live turn measured both ways: 1,864 characters before, 1,864 after, **0 saved on that turn**. The
  saving is turn-dependent - part of the 27% came from a replay that passed `protectRecent: 0` rather than
  the shipped `protectRecent: 8`, so **the shipped-path saving is smaller than 27% and is not quantified**.
  What is quantified is the guard: on the shipped path the block no longer contains any line the model
  already has.
- `npm run check` clean; `node run-tests.mjs` **84/84 test files passed**.

### Run B, the second 20-turn / 40-floor acceptance

| batch | turns | gen errors | timeouts | extraction timeouts | evidence turns | avg reply chars |
|---|---|---|---|---|---|---|
| 1-10 | 10 | 0 | 0 | 0 | 10/10 | 497 |
| 11-20 | 10 | 0 | 0 | 0 | 10/10 | 509 |
| **total** | **20** | **0** | **0** | **0** | **20/20** | **494** |

Replies 379-634 characters, 19/19 in the 250-700 band, all Chinese. Memories 5 -> 64. Reference block
saturated at 4,000 characters from turn 7; state block 725 -> 3,147.

Long-range recall, taken from the character's own words and never prompted for:

- Turn 20 asks how many days the journey took. The reply: *"你从北边走过来，走了十一天。这是你自己进城那
  三天前对我说的原话，我记着。"* - turn 1's detail, 19 turns later, with its provenance.
- Turn 20 also recalls turn 4's chisel marks and adds her own observation that the stone dust is still white.
- Turn 19 counts: *"这是第二回你把我的话搬去喂一头鹿了。头一回我当场跟你说过。"* - a cross-turn count.
- Turn 9 quotes her own earlier phrasing back: *"我方才说得很清楚——'你那本手札'。"*

### Two corrections to earlier entries in this file

1. **The level-1 row count falling is not content loss.** Run A showed 15 -> 11 rows; run B showed 6 -> 2 and
   7 -> 3, which looked like summaries being dropped. Reading the tree settles it: the rows are 10-turn
   batches (`covers: 10`), and the pass re-consolidates per-turn rows into batch rows. The final level-1 row
   still describes the last user turn in detail, and level 2 / level 3 are legitimately empty. Nothing is
   lost; the counter was measuring a shape, not a budget.
2. **The scenario defect from run A was misdiagnosed.** Entry 1 blamed the character card's bedridden
   premise. Run B, whose turns added explicit recovery and time markers, collapsed the same way for a
   different reason: **details the user asserts about the character's past or belongings are not canon**, so
   the model plays her as denying them ("林子里没有藤箱", "我没有师父", "第三回了"). This is a defect in the
   test design, and it means a valid H4 run has to let the *character* introduce the facts the user later
   asks her to recall, instead of the user planting objects in her house.

### H4 is still not answered

The detail table shows every planted detail present in the prompt at the turn it was echoed. The reference
block is a 4,000-character hierarchical summary that already paraphrases nearly everything, so retrieval
and summary are not separable in this configuration: the summary, not the raw-text channel, is carrying the
long-range recall that the run demonstrates. Isolating H4 needs a chat long enough that a fact falls out
of the summary while remaining retrievable.

