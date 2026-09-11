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
