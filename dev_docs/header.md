# dev_docs — Read This First

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
