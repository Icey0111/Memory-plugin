# fix_fold_coverage_certificate

- Date: 2026-09-11 19:20:00
- Session: Functional check of the memory system before the token-band validation run. Found and fixed one
  invariant violation in floor folding (raw text hidden with no stand-in), and recorded the rest of the
  audit as measured evidence.

## Problem / Requirement

The fold feature hides a floor from the model prompt on the promise that a Level-1 stand-in carries it.
[v55-floor-fold.js L63-L67](file:///D:/memory_plugin/v55-floor-fold.js#L63-L67) names the forbidden
failure explicitly: "the plugin would hide raw text that nothing stands in for, which is the one thing
folding must never do."

A read-only audit of every retained chat file found that failure **already materialized** on chat
`Seraphina - 2026-09-11@13h37m08s517ms`:

| measurement | value |
| --- | --- |
| chat rows | 25 |
| rows carrying `aetheria_v55_folded` | 17 |
| hidden assistant floors | 9 |
| Level-1 rows covering them | 0 |
| hidden characters | 12,320 (approx. 4,500 tokens) |
| `floor_folds` audit present in the derived record | no |
| state after opening the chat, 18 s | unchanged |

Two independent causes, both reproduced live afterwards:

1. `unfoldFloorsNotCovered()` iterated the **derived** `floor_folds` audit and returned
   `{restored: 0}` when it was absent. The audit lives in the external derived store, so a chat whose
   derived record predates the key - or a read that lands before hydration - made the one restoration
   path a no-op, even though every folded row carries its own marker.
2. The digest rebuild and that reconciliation sat **behind** the `quiet-in-progress` guard in
   `processSummaryHierarchy`. Measured live: a chat load landed while an extraction was in flight and
   the pass returned `{skipped:'quiet-in-progress'}` for 18+ seconds, rebuilding nothing and
   reconciling nothing. The reconciliation also ran only from a summary pass, which `CHAT_CHANGED`
   never schedules.

## Purpose of Change

Make the coverage certificate self-enforcing: the rows are the record, the repair is model-free, and it
runs whenever a chat is opened. No configuration (a lost derived store, a disabled digest, an extraction
in flight) may leave a hidden floor without a stand-in.

## How It Was Changed

- [v55-floor-fold.js L69-L100](file:///D:/memory_plugin/v55-floor-fold.js#L69-L100) —
  `unfoldFloorsNotCovered` is now **row-marker driven** instead of audit driven. It walks the live chat,
  reads `turn_assistant_index` from each row's own `aetheria_v55_folded` marker, and restores every
  row whose floor is not covered. The audit is used only to prune entries when it happens to exist, so a
  missing `floor_folds` no longer defeats the restore.
- [v55-summary-runtime.js L113-L146](file:///D:/memory_plugin/v55-summary-runtime.js#L113-L146) — new
  exported `reconcileFoldCoverage(ctx)`: the deterministic Level-1 digest rebuild plus the fold
  reconciliation, with no model call. Coverage is read back from `tree.level1` rather than from the
  digest rows alone, so a model Level-1 counts too. When rows are restored it persists both the chat and
  the derived projection.
- [v55-summary-runtime.js L165-L170](file:///D:/memory_plugin/v55-summary-runtime.js#L165-L170) —
  `processSummaryHierarchy` calls it **before** the `quiet-in-progress` guard and returns
  `{skipped:'quiet-in-progress', digest_lines, unfolded}` so a skipped model pass still reports what the
  model-free half did.
- [v55-summary-runtime.js L276-L280](file:///D:/memory_plugin/v55-summary-runtime.js#L276-L280) — the
  `CHAT_CHANGED` handler now calls `reconcileFoldCoverage`, so opening a chat is enough to repair
  coverage without waiting for the next generation.
- [test-v55-fold-coverage.mjs L1-L160](file:///D:/memory_plugin/test-v55-fold-coverage.mjs#L1-L160) —
  new test, six scenarios: no audit and no coverage (all restored), no audit with full coverage (none
  restored), no audit with partial coverage (only the uncovered floor restored), the quiet-locked pass
  (digest built and orphan restored during the lock), a normal pass (zero uncovered), and a direct
  `reconcileFoldCoverage` call (idempotent).

## Verification

- `node run-tests.mjs` — **67/67 test files pass in 18.5 s** (was 66; the new test is the addition).
- Live, chat `Seraphina - 2026-09-11@13h37m08s517ms`, after opening it: `foldedAi` no longer contains
  floors 6 and 10, `uncovered: []`, `digestL1: 10`. `processSummaryHierarchy` reported
  `{created: 0, digest_lines: 10, unfolded: 4}`.
- Live, controlled orphan: a fold marker pointing at uncovered floor 6 was planted on row 0, the app
  switched to another chat and back, and the orphan was restored on open with no manual call and no
  model call (`uncoveredRows` `[0,1]` → `[]`).
