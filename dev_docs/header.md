# Project Documentation

Read this file before changing dev_docs. These documents describe the current system.

Start with the AIRP memory product contract at the top of [../AGENTS.md](../AGENTS.md),
then read [00_project.md](00_project.md) and [01_architecture.md](01_architecture.md).
After context compaction, restore those responsibilities before choosing new work:
structured continuity and precise original evidence must cooperate in the actual prompt.
The implementation plan lives in [Issue #2](https://github.com/Icey0111/Memory-plugin/issues/2);
planned budget changes must not be described as already implemented.

- Edit current facts in place. Do not append full versions or create local history copies.
- Git stores historical content; pull requests store implementation discussion and validation.
- CHANGELOG.md records user-visible release changes. Do not add per-task change_log files.
- ADRs record durable decisions and meaningful alternatives; supersede them explicitly when needed.
- Keep documentation in English, with one H1 per file and relative repository links.
- The user's explicit instructions take precedence over this convention.

| File | Purpose |
| --- | --- |
| 00_project.md | Goals, scope and non-goals |
| 01_architecture.md | Live pipeline and invariants |
| 02_development.md | Development and acceptance checks |
| 03_data_model.md | Authoritative stores and derived projections |
| 04_roadmap.md | Remaining work and measured limitations |
| 05_worktree.md | Module responsibilities |
| 06_retrieval_research.md | Retrieval experiments and their limits |
| decisions/ | Durable architecture decisions |

The old append-only rule was superseded to fulfil the documentation-cleanup request. Historical
archive/ and change_log/ documents are recoverable from Git; they are not current instructions.
