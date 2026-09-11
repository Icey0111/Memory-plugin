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
