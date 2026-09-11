# Architecture

This file used to be the architecture document. It had grown into a 448-line log
of development iterations, which is a large part of why the architecture became
hard to read. It now lives in `archive/ARCHITECTURE_iteration_log.md`, and this
file is only a signpost.

The current description is in `dev_docs/`. Read the newest version block at the
end of each file - the files are append-only, so earlier blocks are history.

| Want to know | Read |
|---|---|
| What the system is, in one page | `dev_docs/01_architecture.md` (newest version block) |
| The whole system as one concept picture | `dev_docs/08_concept_map.md` |
| Entities, the two stores, ownership rules | `dev_docs/03_data_model.md` |
| What each stage does, measured, and the gaps | `dev_docs/07_functional_check.md` |
| What remains from earlier designs | `dev_docs/09_legacy_inventory.md` |
| Why the code is shaped this way | `dev_docs/06_architecture_drift.md` |
| Capabilities and non-goals | `dev_docs/00_overview.md` |

Other entry points:

- `dev_docs/MEMORY_PLAN_2026.md` - the design plan and its acceptance criteria.
- `change_log/` - one file per work session, the chronological record.
- `archive/` - superseded design documents, kept for history only.
