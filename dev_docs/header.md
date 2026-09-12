# dev_docs — Read This First

<!-- Versioned & append-only: never edit past versions; newest is last. -->

<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

> ⚠️ MANDATORY: Before reading or writing ANY file in `dev_docs/`, read this
> file completely. It defines the conventions and structure that every other
> document in this folder must follow. If this file and any external guidance
> disagree, this file wins — it is project-specific and travels with the repo.

## Purpose

`dev_docs/` holds the project's initial design and planning documentation:
the architecture, technology choices, data model, roadmap, and the work-tree
layout. It is the single source of truth for *how the project is designed*.

## Writing Conventions

- Language: English.
- Format: Markdown. Exactly one `#` H1 title per file, matching its topic.
- One topic per file; do not mix concerns.
- Keep documents current, but NEVER overwrite: revise by appending a new
  version copy in the same file (see "Versioned, Non-Overwriting Revisions")
  and record the change in `change_log/`.
- Prefer diagrams-as-text (Mermaid) and tables over long prose.
- Use relative links between docs; never hardcode absolute machine paths.

## Documentation Structure

Files are numbered so their reading order is explicit:

| File | Contents |
|------|----------|
| `00_overview.md`     | Problem statement, goals, scope, non-goals, stakeholders |
| `01_architecture.md` | System architecture, module boundaries, key flows, diagrams |
| `02_tech_stack.md`   | Languages, frameworks, libraries, tooling and the rationale |
| `03_data_model.md`   | Entities, schema, relationships (omit if not applicable) |
| `04_roadmap.md`      | Milestones, phases, open questions, risks |
| `05_worktree.md`     | The project directory tree and the responsibility of each part |
| `06_architecture_drift.md` | Where the codebase stops being a memory system, and what was done about it |
| `07_functional_check.md` | What each memory stage actually does, measured, and the gaps that remain |
| `08_concept_map.md` | The whole system as one concept picture: the four data kinds, stores, invariants |
| `09_legacy_inventory.md` | Artifacts that survive from earlier designs, measured, with the command class used to find them |
| `10_airp_memory_methodology.md` | Memory methodology derived from the roleplay problem, with the research that supports or contradicts it |
| `11_human_memory_analogy_evidence.md` | Evidence review of human-memory analogies for agent memory, including the dissent |
| `12_long_context_evidence.md` | Long-context benchmarks and what they do not measure |
| `13_agent_memory_systems_evidence.md` | How production and research agent-memory systems store, retrieve and supersede |
| `14_roleplay_memory_evidence.md` | What roleplay front-ends actually implement, roleplay benchmarks, and the metrics nobody has measured |
| `15_innovation_path.md` | The decision: what is blank, what to own, what not to build, and the staged path |
| `16_100floor_run_result.md` | The 100-floor run: the curve, what held, what failed, and the measured root cause |
| `17_iteration_result.md` | What the iteration changed, end to end, and what is still not claimed |
| `18_token_cost_and_storage.md` | What the memory system costs per turn and in the chat file, what was removed, and the defects left open |
| `19_next_steps.md` | The narrative layer contract: what this project should take from the reference implementation, what it must not, and the sequenced plan. **Declined at v2** - see the repair-versus-architecture split |
| `20_narrative_coverage.md` | Level-1 batch sealing: how narrative coverage stopped being O(window), the 445 raw floors it prevents at 500, and what it costs |
| `21_memory_thesis.md` | The converged thesis scoped to this plugin: retrieval is memory, the summary is a five-dimension situation model, the index is already half-extracted, and the two defects that exposes in what shipped |
| `22_plan_after_compression.md` | The plan after the compression discussion: the ruler first, measurement before building, the last hop, the gist row, the stop-doing list, and the acceptance criteria |

When adding a new document, use the next numeric prefix and register it in the
table above so this index stays complete.

## Work-Tree Definition

Document the canonical project layout in `05_worktree.md`. It must show where
`dev_docs/` and `change_log/` live and describe each top-level directory's
responsibility.

## Versioned, Non-Overwriting Revisions

dev_docs files are APPEND-ONLY. Never overwrite, delete, or edit content that
already exists in a file.

When a new development direction changes a document:

1. Copy the LATEST version block in full, within the SAME file (never create a
   separate file).
2. Append it as the next version and make ALL edits only on that new copy.
3. If a further change arises later, copy the latest (already-edited) version
   again and edit that copy - and so on.

Each version is delimited by a machine-readable anchor followed by a human
heading (the anchor is what tooling keys on, so it never collides with `##`
headings used inside the body):

    <!-- VERSION <N> -->
    ## v<N> - <YYYY-MM-DD HH:MM:SS> - <short reason>

The newest version is always the last block; every earlier version stays as an
immutable history. The timestamp must be real system time. Generate the next
version automatically (this also wraps a not-yet-versioned file's current
content as `v1` before adding the editable copy):

    python <skill>/scripts/new_version.py <file> --reason "<why>"

<!-- VERSION 2 -->
## v2 - 2026-09-12 18:11:50 - consolidate the documentation set to current facts plus ADRs

> ⚠️ MANDATORY: Before reading or writing ANY file in `dev_docs/`, read this
> file completely. It defines the conventions and structure that every other
> document in this folder must follow. If this file and any external guidance
> disagree, this file wins — it is project-specific and travels with the repo.

## Purpose

`dev_docs/` holds the project's initial design and planning documentation:
the architecture, technology choices, data model, roadmap, and the work-tree
layout. It is the single source of truth for *how the project is designed*.

## Writing Conventions

- Language: English.
- Format: Markdown. Exactly one `#` H1 title per file, matching its topic.
- One topic per file; do not mix concerns.
- Keep documents current, but NEVER overwrite: revise by appending a new
  version copy in the same file (see "Versioned, Non-Overwriting Revisions")
  and record the change in `change_log/`.
- Prefer diagrams-as-text (Mermaid) and tables over long prose.
- Use relative links between docs; never hardcode absolute machine paths.

## Documentation Structure

Files are numbered so their reading order is explicit:

| File | Contents |
|------|----------|
| `00_project.md`     | Problem, goals, scope, non-goals, stakeholders |
| `01_architecture.md` | The pipeline, the modules, the invariants, and what is not built |
| `02_development.md` | Toolchain, commands, quality bar, CI |
| `03_data_model.md`  | Stores, keys, ownership rules, invariants |
| `04_roadmap.md`     | What shipped, what is next, open risks, what is not planned |
| `05_worktree.md`    | The canonical directory tree and each part’s role |
| `decisions/`        | ADRs: one durable decision each, with its alternatives and consequences |

The set was consolidated on 2026-09-12 from twenty-five files to these six plus ADRs. Superseded
documents were moved to a `remove/remove_<timestamp>_consolidate_the_dev_docs_set/` snapshot and
remain in Git history; earlier conclusions are not current facts and do not belong here.

When adding a new document, use the next numeric prefix and register it in the
table above so this index stays complete.

## Work-Tree Definition

Document the canonical project layout in `05_worktree.md`. It must show where
`dev_docs/` and `change_log/` live and describe each top-level directory's
responsibility.

## Versioned, Non-Overwriting Revisions

dev_docs files are APPEND-ONLY. Never overwrite, delete, or edit content that
already exists in a file.

When a new development direction changes a document:

1. Copy the LATEST version block in full, within the SAME file (never create a
   separate file).
2. Append it as the next version and make ALL edits only on that new copy.
3. If a further change arises later, copy the latest (already-edited) version
   again and edit that copy - and so on.

Each version is delimited by a machine-readable anchor followed by a human
heading (the anchor is what tooling keys on, so it never collides with `##`
headings used inside the body):

    <!-- VERSION <N> -->
    ## v<N> - <YYYY-MM-DD HH:MM:SS> - <short reason>

The newest version is always the last block; every earlier version stays as an
immutable history.

To add the next version: read the real system time from the operating system,
append the anchor and heading, copy the latest version block in full underneath
it, and edit only that copy. The skill scripting that used to generate this
(`new_version.py`) is not installed in every environment, so the procedure above
is the contract rather than the script.
