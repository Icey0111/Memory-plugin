# Work Tree

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

> The project directory tree and each part's responsibility.


<!-- VERSION 2 -->
## v2 - 2026-09-11 00:22:41 - document the canonical repository layout

### Layout

    <project-root>/
    |-- manifest.json                 SillyTavern extension manifest (entry point of the whole plugin)
    |-- dev_docs/                     design and planning (this folder) - read header.md first
    |-- change_log/                   one chronological entry per working session - read header.md first
    |-- remove/                       pre-destruction backups - read header.md first
    |-- .github/workflows/            CI: syntax gate + full offline suite
    |-- source-adapters/              world-info / titled-text import adapters
    |-- index-v55-bootstrap.js        load-order-critical bootstrap (guard before core)
    |-- index-v55.js                  v5.5 staged init
    |-- index.js                      v5.4-lineage runtime: extraction, replay, retrieval, injection
    |-- v55-*.js                      the v5.5 modules (see 01_architecture.md section 3)
    |-- memory-core.js                canonical store, replay, applyMemoryOps
    |-- memory-extractor.js           extraction prompt + response contract
    |-- memory-op.schema.json         operation schema
    |-- context-assembler.js          the single prompt assembler
    |-- baseline-*.js                 semantic baseline collection and indexing
    |-- setting-*.js, settings.html   plugin-owned world-info plane and its UI
    |-- style.css                     extension stylesheet
    |-- test-*.mjs, run-tests.mjs     the offline suite
    |-- package.json                  scripts only (check / test / test:list); no dependencies

### The three documentation folders

| Folder | Holds | Rule |
| --- | --- | --- |
| `dev_docs/` | how the project is designed: overview, architecture, stack, data model, roadmap, work tree, plus the plan | append-only, versioned in-file; never overwrite |
| `change_log/` | why each change happened and what resulted | one file per session, append-only, never edited afterwards |
| `remove/` | verbatim pre-destruction snapshots | one directory per destructive action, append-only |

### Root documents and the release manifest

The root also carries long-lived documents: `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`,
`TEST_PLAN.md`, `RETRIEVAL_ARCHITECTURE_2026.md`, `LITTLEWHITEBOX_REFERENCE.md`,
`MIGRATION_V52_TO_V53.md`, `MIGRATION_V53_TO_V54.md`, the `V55_ITERATION_*_REPORT.md` history and
`PACKAGE_MANIFEST.json`.

They stay at the root on purpose: `PACKAGE_MANIFEST.json` enumerates the packaged file set (it
recorded 71 files at iteration 08), so moving them would invalidate the release inventory. New
planning material belongs in `dev_docs/` instead.

### Legacy content in remove/

`remove/` was used as a flat archive before this workflow existed, so it still contains entries that
do not follow the `remove_<timestamp>_<slug>/` convention: `.audit-v55/` (audit snapshots and the
live-acceptance harness), `.ref-lwb/` (a third-party reference checkout), `v5.5-dev-iteration08/`
and a copy of the pre-iteration-13 root files. They are left in place and are excluded from git by
`/remove/` in `.gitignore`.
