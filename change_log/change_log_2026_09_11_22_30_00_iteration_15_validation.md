# iteration_15_validation

- Date: 2026-09-11 22:30:00
- Session: Validate iteration 15 on a live 10-floor chat, which found a defect the offline suite had missed.

## Problem / Requirement

The 500-700 token run was executed against the A-level build. The replies were fine; the memory
diagnostics were not. The report showed `digest_lines: 0`, a single model-written Level-1 row where the
deterministic digest should have produced eleven, and `foldCoverage.digestL1: 0`.

## Root cause

`groupDigestRows` in [v55-compression.js](../v55-compression.js) returned `list.map(single)` from an
early `size === 1` branch **before** `const single = ...` was initialised. `const` is hoisted but not
initialised, so every call with a group size of 1 threw `ReferenceError: Cannot access 'single' before
initialization`.

A group size of 1 is not a corner case: it is what `compressionPlan` returns for **every window with no
meaningful repetition**, i.e. the default for ordinary prose. Live confirmation:

    ReferenceError: Cannot access 'single' before initialization
        at groupDigestRows (v55-compression.js:147:25)
        at reconcileFoldCoverage (v55-summary-runtime.js:139:23)

Three things then conspired to hide it:

1. `processSummaryHierarchy` catches a reconcile failure into `tree.last_error`, and the model half of the
   pass sets `last_error = null` at the end - so the error was erased before anyone could read it.
2. The model path took over and wrote one plausible-looking Level-1 row covering all ten turns, which is
   exactly what the digest would have produced, so the tree looked healthy.
3. **The offline suite never called `groupDigestRows` with a group size of 1.** The A4 test exercised
   grouping only on a repetitive window; the novel-window case asserted the plan's `group_size` but never
   ran the grouper.

## How It Was Changed

- [v55-compression.js L145-L153](file:///D:/memory_plugin/v55-compression.js#L145-L153) — `single` is
  declared before the early return, with the failure recorded in the comment.
- [v55-summary-runtime.js L176-L186](file:///D:/memory_plugin/v55-summary-runtime.js#L176-L186) —
  `processSummaryHierarchy` returns `compression` and `reconcile_error`. A swallowed failure in the
  model-free half now shows up in a run report instead of being cleared by the model half.
- [v55-summary-runtime.js L142-L163](file:///D:/memory_plugin/v55-summary-runtime.js#L142-L163) — a model
  Level-1 row whose every turn the digest covers is dropped rather than injected a second time. Both stand
  in for the same turns at the same granularity; keeping both sends the same story twice.
- [test-v55-plan-a.mjs L85-L92](file:///D:/memory_plugin/test-v55-plan-a.mjs#L85-L92) — the group size of
  1 path is asserted directly, so the default path is no longer untested.
- [test-v55-fold-coverage.mjs L160-L186](file:///D:/memory_plugin/test-v55-fold-coverage.mjs#L160-L186) —
  the de-duplication rule: a fully covered model row is dropped, a row covering anything outside the digest
  window stays.

`node run-tests.mjs` — **70/70 test files pass in 18.9 s**.

## Validation

**Token band.** Chat `Seraphina - 2026-09-11@20h22m03s183ms`, directive "请写一段 500 到 650 字的长回复",
one `generate()` per reply, zero `continue` anywhere.

| turn | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reply tokens | 522 | 775 | 690 | 755 | 643 | 741 | 797 | 746 | 537 | 636 |
| produced characters | 2137 | 3164 | 2826 | 3089 | 790 | 912 | 980 | 902 | 677 | 780 |

min 522 / p25 636 / median 741 / p75 755 / max 797; **0 below 500, 5 inside 500-700, 5 above**. Median 741
against a 500-700 target - the natural generation sits a little above the band, which is why the ceiling is
not the binding constraint. Turns 0-3 answer in **English** (the character card's greeting is English, and
the model matched it before switching to Chinese), which is why their character counts are 3-4x the later
turns at comparable token counts; the token model is script-aware and charges them correctly.

**Memory, measured on the run.** key retention 2/2 on every one of the ten turns (worst rate 1.00);
`causal_recall` 25/25 = 1.00; T-Causal canonical 30/30 with **0 violations**; injection coverage 1.00 down
to 0.625 as the store grew past the budget; reference block 706 -> 5,309 characters, current state
1,255 -> 4,471.

**A-level path, verified live on the same chat after the fix** (`reconcileFoldCoverage` on real data,
zero model calls):

| | value |
| --- | --- |
| digest lines | 11 of 11 turns, every row `digest: true` |
| compression | repetition 0.113 (below the 0.2 dead zone) -> factor 1.00, group size 1, 11 lines in, 11 out |
| boundaries | 5 over 11 turns - hard 4 (3 location changes + chat-open), soft 1 (world_delta), **beat 0** |
| `beat_share` | 0.00 - the detectors never had to fall back to the floor beat on this chat |
| segments | 5, mean 2.2 turns, largest 3 |
| fold coverage | 17 hidden rows, 11 covered floors, **0 uncovered** |
| superseded model rows | 1 dropped (the stale row the broken digest had left behind) |

The compression result is the honest one rather than the flattering one: this chat's turns introduce new
slots and share almost no phrasing, so A4 correctly declines to merge anything. Compression is a function
of repetition, and here there is none.
