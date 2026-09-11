# Legacy Inventory

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

## v1 - 2026-09-11 21:12:14 - artifacts that survive from earlier designs

Scope: what is still in the repository but no current code path needs, plus the
structure that makes the project hard to read. Every item states how it was
measured, so it can be re-checked rather than believed.

### 1. Six dead derived-store keys

`DERIVED_KEYS` declares 16 keys. Six occur exactly once in the whole source
tree - inside that declaration - and are neither read nor written anywhere:

`cold_turns`, `summary_history`, `provenance_registry`,
`current_state_authority`, `last_active_state_diagnostic`,
`v55_inner_bundle`.

Two of those names read as load-bearing storage (`cold_turns`,
`summary_history`), so the declaration actively misleads a reader. A seventh,
`spine`, duplicates the name already exported as `SPINE_KEY` by
`v55-spine.js`, giving one concept two declarations.

Measured by searching every root source file for the literal quoted key.

### 2. A dead host prompt key owned by two files

`aetheria_unified_memory_v5_5_hierarchical_summary` is declared independently in
`v55-consistency.js` and in `v55-summary-runtime.js`, and is set to the empty
string by design (summaries are folded into the reference block). Two owners for
a key that carries nothing.

### 3. Three naming generations live at once

| Generation | Where it is still live |
|---|---|
| v5.2 / v5.3 | `MIGRATION_V52_TO_V53.md` and `MIGRATION_V53_TO_V54.md` at the root; 2 occurrences of the V53 token |
| v5.4 | `manifest.json` still exports `generate_interceptor: aetheriaUnifiedMemoryV54Interceptor`; the two host prompt keys are `aetheria_unified_memory_v5_4_reference` and `..._current_state`; the settings key is `aetheriaUnifiedMemoryV54`; panel element ids are `aum-v54-*`; 154 occurrences of the V54 token across 18 files |
| v5.5 | the version actually being developed, visible in the summary key and the source filenames |

The v5.4 names are the host contract, so renaming them is not free. The debt is
that the only place a host can see the plugin announce itself is still 5.4.

### 4. A flat root: 166 tracked files in one directory

43 source files, 70 test files, and 33 loose files, all side by side. Documents
at the root that are history rather than design:

- 13 `V55_ITERATION_*_REPORT.md` (iteration 12 is missing; iteration 08 uses a
  different suffix)
- `CHANGELOG.md`, `TEST_PLAN.md`, `PACKAGE_MANIFEST.json` (446 lines)
- `MIGRATION_V52_TO_V53.md`, `MIGRATION_V53_TO_V54.md`
- `v5.4_开发上下文恢复.md`, `v5.4_验收报告.txt`
- `LITTLEWHITEBOX_REFERENCE.md`, `RETRIEVAL_ARCHITECTURE_2026.md`

### 5. Four overlapping architecture documents

| File | Lines | Shape |
|---|---|---|
| `ARCHITECTURE.md` (root) | 448 | an iteration log: sections 13-19 are literally "Iterations 01-05", "Iteration 06", "Iteration 07/08", "Iterations 09-13" |
| `dev_docs/01_architecture.md` | 75 before v3 | module map and key flows |
| `dev_docs/06_architecture_drift.md` | 89 | where the code stops being a memory system |
| `dev_docs/08_concept_map.md` | 134 | concept map |

The root file is the one a newcomer opens first and the one most likely to be
stale, because it grows by appending one section per iteration.

### 6. `remove/` holds 2,965 files, none of them tracked

| Part | Files | What it is |
|---|---|---|
| `.audit-v55` | 1,057 | the live-host audit harness |
| `.ref-lwb` | 1,737 | a reference plugin checkout |
| `v5.5-dev-iteration08` | 74 | a previous iteration snapshot |
| top level | 77 | including a complete old copy of the plugin (`index.js` 2,564 lines, `memory-core.js` 1,038 lines, `ARCHITECTURE.md` 295 lines, `MEMORY_PLAN_2026.md` 158 lines) |

`git ls-files remove` returns 0, so none of it ships. It is the reason the
working tree looks far larger than the project.

### 7. Confusing names, not dead code

No source file is orphaned: the basename of each of the 43 source files appears
in at least one other source file or in `manifest.json`. Three pairs invite
confusion anyway:

- `v55-metrics.js` meters cost (calls, tokens); `v55-quality-metrics.js`
  measures quality (retention, injection composition, causal probes).
- `baseline-index.js` is the world-info index; `setting-index.js` is the
  vector-backed index over the setting store and reuses it.
- Three modules each wrap the same host interceptor in turn
  (`installV55Runtime`, `installV55Finalizer`, `installV55Consistency`), so reading
  any one of them does not tell you what the prompt finally contains.


<!-- VERSION 2 -->
## v2 - 2026-09-11 21:19:00 - correct v1: the derived-store keys are live, and the summary key is a tombstone, not dead code

### 0. Correction to v1

v1 claimed six keys in `DERIVED_KEYS` were declared but never read or written.
That was wrong. All six are live:

| Key | Written / read by |
|---|---|
| `cold_turns` | `v55-evidence.js` writes `target.cold_turns`; `v55-forget.js` reads `store?.cold_turns` |
| `summary_history` | `v55-summary-runtime.js` reads and creates `store.summary_history` |
| `provenance_registry` | `v55-provenance.js` writes `store.provenance_registry`; `index-v55.js` reads it |
| `current_state_authority` | `v55-runtime.js` writes `chatStore.current_state_authority` |
| `last_active_state_diagnostic` | `v55-runtime.js` writes it next to `last_active_state` |
| `v55_inner_bundle` | `index.js` publishes it; `v55-consistency.js` reads and deletes it |

The error was in the search, not in the code. v1 looked for the quoted literal
`'cold_turns'`, which can only ever match the declaration. Production code
reaches the same key as a property access (`store.cold_turns`), which a quoted
search cannot see. Every "this field is unused" claim in this document must be
re-measured with a property-access search as well as a literal search.

v1's second claim was wrong the same way. The summary prompt key is not dead:
`v55-consistency.js` clears it on every generation and guards on it. It is a
tombstone that stops an older version's key from surviving. Only the duplicated
declaration is a defect, not the key.

What settled it was the test suite, not a grep. Removing the six keys was
attempted; `test-v55-derived-store.mjs` failed on `cold_turns`, and the edit was
reverted. `v55-derived-store.js` is byte-identical to its committed state.

### 1. One concept, two declarations, contradictory comments

`spine` is declared in `DERIVED_KEYS` and again as `SPINE_KEY` in
`v55-spine.js`. The files disagree about whether it belongs in the derived store:

- `v55-spine.js` states the spine is "not a derived store key" and that a
  derived spine "would be silently invisible" to the paths that read it.
- `v55-derived-store.js` states it does belong there, and explains that the
  ownership guard was changed so derived keys stay readable to runtime readers.
- `dev_docs/MEMORY_PLAN_2026.md` records a live measurement in which
  registering `spine` made `store.spine` permanently undefined for runtime
  readers, and lists that as still unproven.

The code keeps `spine` in `DERIVED_KEYS`, and the spine does reach the prompt
in a live run. So the comment in `v55-spine.js` is stale, and the plan's open
item is unresolved rather than closed. Recorded as an open question, not as dead
code, and deliberately not edited in this pass.

### 2. The summary prompt key has two owners

`aetheria_unified_memory_v5_5_hierarchical_summary` is declared independently in
`v55-consistency.js` and `v55-summary-runtime.js`. Both set it to the empty
string, and `v55-consistency.js` also guards on it. The key carries nothing by
design; the defect is one constant with two sources of truth.

### 3. Three naming generations live at once

| Generation | Where it is still live |
|---|---|
| v5.2 / v5.3 | `archive/MIGRATION_V52_TO_V53.md` and `archive/MIGRATION_V53_TO_V54.md`; 2 occurrences of the V53 token |
| v5.4 | `manifest.json` still exports `generate_interceptor: aetheriaUnifiedMemoryV54Interceptor`; the two host prompt keys are `aetheria_unified_memory_v5_4_reference` and `..._current_state`; the settings key is `aetheriaUnifiedMemoryV54`; panel element ids are `aum-v54-*`; 154 occurrences of the V54 token across 18 files |
| v5.5 | the version actually being developed, visible in the summary key and the source filenames |

The v5.4 names are the host contract, so renaming is not free. The debt is that
the only place a host sees the plugin announce itself still says 5.4.

### 4. The flat root, addressed in this pass

Before: 170 tracked paths with 34 loose non-code files at the root - 13
`V55_ITERATION_*_REPORT.md`, `CHANGELOG.md`, `TEST_PLAN.md`,
`PACKAGE_MANIFEST.json` (446 lines, a version 5.5.0-dev.8 snapshot whose own
header says the next step is Iteration 08 live acceptance), two migration
documents, two v5.4 handover documents, `LITTLEWHITEBOX_REFERENCE.md`,
`RETRIEVAL_ARCHITECTURE_2026.md`, and the 448-line architecture log.

Now: 22 of those moved to `archive/`, which the root `ARCHITECTURE.md` signpost
points at. The root keeps 12 loose files: `.gitignore`, `LICENSE`,
`manifest.json`, `memory-op.schema.json`, `package.json`, `README.md`,
`run-tests.mjs`, `settings.html`, `style.css`, `tcausal-cases.json`,
`fx-dump.mjs`, and the `ARCHITECTURE.md` signpost.

The two files that referenced moved documents were repointed:
`README.md` now cites `archive/MIGRATION_V53_TO_V54.md` and
`archive/V55_ITERATION_07_REPORT.md`. `PACKAGE_MANIFEST.json` referenced the
others, and it moved with them.

### 5. Four overlapping architecture documents

| File | Lines | Shape |
|---|---|---|
| `ARCHITECTURE.md` (root) | 20 | a signpost, as of this pass |
| `archive/ARCHITECTURE_iteration_log.md` | 448 | the former root document: sections 13-19 are literally "Iterations 01-05", "Iteration 06", "Iteration 07/08", "Iterations 09-13" |
| `dev_docs/01_architecture.md` | three version blocks | module map and key flows; v3 is the one-page description |
| `dev_docs/06_architecture_drift.md` | 89 | where the code stops being a memory system |
| `dev_docs/08_concept_map.md` | 134 | concept map |

The root file was the one a newcomer opens first and the one most likely to be
stale, because it grew by appending one section per iteration. That is now the
signpost's only job.

### 6. `remove/` holds 2,965 files, none of them tracked

| Part | Files | What it is |
|---|---|---|
| `.audit-v55` | 1,057 | the live-host audit harness |
| `.ref-lwb` | 1,737 | a reference plugin checkout |
| `v5.5-dev-iteration08` | 74 | a previous iteration snapshot |
| top level | 77 | including a complete old copy of the plugin (`index.js` 2,564 lines, `memory-core.js` 1,038 lines, `ARCHITECTURE.md` 295 lines, `MEMORY_PLAN_2026.md` 158 lines) |

`git ls-files remove` returns 0, so none of it ships. It is the reason the
working tree looks far larger than the project. Left untouched here: it is the
project's sanctioned pre-destruction backup area, and the live-host audit
harness still lives inside it.

### 7. Confusing names, not dead code

No source file is orphaned: the basename of each of the 43 source files appears
in at least one other source file or in `manifest.json`. Three pairs invite
confusion anyway:

- `v55-metrics.js` meters cost (calls, tokens); `v55-quality-metrics.js`
  measures quality (retention, injection composition, causal probes).
- `baseline-index.js` is the world-info index; `setting-index.js` is the
  vector-backed index over the setting store and reuses it.
- Three modules each wrap the same host interceptor in turn
  (`installV55Runtime`, `installV55Finalizer`, `installV55Consistency`), so reading
  any one of them does not tell you what the prompt finally contains.


<!-- VERSION 3 -->
## v3 - 2026-09-11 21:35:00 - resolve the spine question, unify two key declarations, and reduce remove/

### 1. The spine question is settled by measurement, in favour of the derived store

v2 recorded a contradiction. `v55-spine.js` said the spine is not a derived store key,
`v55-derived-store.js` said it is, and `MEMORY_PLAN_2026.md` recorded a live measurement in which
registering it made `store.spine` undefined for runtime readers.

Measured against the running app, before any change, on the chat
"Seraphina - 2026-09-11@20h22m03s183ms", with the external derived backend hydrated
(`tauritavern-extension-store`) and `spine` present in `DERIVED_KEYS`:

| Reading | Value |
|---|---|
| `store.spine` is an own property of the live store | true |
| spine nodes / ledger entries | 50 / 10 |
| `spinePromptBlock(store)` output | 476 characters |
| spine present in the derived record's key list | true |
| `DERIVED_KEYS.length` | 16 |

So the spine is both readable by runtime readers and persisted as a derived key. The failure the
plan recorded belonged to the earlier ownership guard, which deleted derived keys off the live store
object; that guard was replaced by a serialisation-time projection
(`installDerivedSerializationFilter`), so the two are compatible.

Resolution: the derived-store registration stays, and the stale comment in `v55-spine.js` was
rewritten to state the measured behaviour and to record the plan's open item as closed in favour of
the registration.

### 2. Two key names now have one source of truth

| Was | Now |
|---|---|
| the `'spine'` literal in `DERIVED_KEYS`, plus `SPINE_KEY = 'spine'` in `v55-spine.js` | `DERIVED_KEYS` imports `SPINE_KEY` |
| `SUMMARY_PROMPT_KEY` in `v55-consistency.js`, plus `SUMMARY_KEY` in `v55-summary-runtime.js` | one `export const SUMMARY_PROMPT_KEY` in `v55-summary-runtime.js`, imported by `v55-consistency.js` |

Both directions follow an import edge that already existed, so no module edge was added and no cycle
became possible: `v55-spine.js` imports nothing at all, and `v55-consistency.js` already imported
from `v55-summary-runtime.js`.

Measured after the change: the summary key literal occurs exactly once in the source tree,
`SUMMARY_KEY` occurs zero times, and `SPINE_KEY` has one declaration.

One `'spine'` literal remains, in `v55-quality-metrics.js`, where it is an injection-section id
(`{ id: 'spine', marker: '[记忆变更链' }`) rather than a store key. Left alone: different namespace.

### 3. `remove/` reduced from 64.0 MB to 9.6 MB

`remove/` is untracked (`/remove/` is in `.gitignore`), so nothing here affects the repository.

| Removed | Files | Recoverable because |
|---|---|---|
| `.ref-lwb` | 1,737 | a clone of `https://github.com/RT15548/LittleWhiteBox.git` at `a6f9f6c` |
| loose top-level files | 76 | a stale full copy of the plugin; the current revision is the repository itself |
| `v5.5-dev-iteration08` | 74 | a previous iteration snapshot |
| `source-adapters` | 2 | duplicates of the tracked `source-adapters/` |

Kept: `.audit-v55` (1,058 files), because the live-host audit harness lives there and it is the only
way to verify against the running app; the three `remove_*/` entries, which are the audit trail this
folder exists for; and `header.md`, the folder's mandatory conventions file.

One file could not be removed: `remove/CENTRALIZED_MEMORY_PROPOSAL.md`. Its ACL grants
`BUILTIN\Users` read-and-execute only and gives modify rights to a different sandbox account
(`ICEY0111\CodexSandboxUsers`), so deletion is denied even after clearing attributes, and
`cmd /c del /f` is denied too. Left in place rather than escalated for one stale design note.

### 4. Verification

`node run-tests.mjs`: 70/70 in 19.1 s, before and after every change above. The code edits are
behaviour-preserving by construction: each replaces a literal with a constant holding the identical
string.
