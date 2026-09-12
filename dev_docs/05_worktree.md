# Work Tree

<!-- Versioned & append-only: never edit past versions; newest is last. -->

<!-- VERSION 1 -->
## v1 - 2026-09-12 18:11:03 - the repository as it is after the narrative rewrite

### Layout

    <project-root>/
    |-- manifest.json                 SillyTavern extension manifest (entry point of the plugin)
    |-- index-v55-bootstrap.js        load-order-critical bootstrap (store guard before core)
    |-- index-v55.js                  settings shell, pagination, single-install wiring
    |-- index.js                      host adapters + the retained v5.4-lineage runtime
    |-- raw-history.js                original-text archive, chunking, lexical rank, folds, evidence
    |-- narrative-runtime.js          the pipeline: summary job, index sync, budgeted assembly, panel
    |-- v55-floor-fold.js             the transcript projection of a fold (writes no chat state)
    |-- memory-core.js                canonical store, replay, applyMemoryOps, fold markers
    |-- memory-extractor.js           retained: the v5.4 extraction prompt and response contract
    |-- memory-op.schema.json         retained: operation schema
    |-- context-assembler.js          retained: the v5.4 prompt assembler (inert)
    |-- setting-*.js, settings.html   plugin-owned world-info plane and its UI
    |-- baseline-*.js                 semantic baseline collection and indexing
    |-- v55-*.js                      the remaining v5.5 modules (see 01_architecture.md section 4)
    |-- source-adapters/              world-info / titled-text import adapters
    |-- style.css                     extension stylesheet
    |-- test-*.mjs                    the offline suite (one file per contract)
    |-- run-tests.mjs                 test runner: one child per test file, file-backed stdio
    |-- check-syntax.mjs              syntax gate: parses every source file it discovers
    |-- package.json                  scripts only (check / test / test:list); no dependencies

### Documentation

| Folder | Holds | Rule |
| --- | --- | --- |
| dev_docs/ | how the project is designed, as current facts: project, architecture, development, data model, roadmap, work tree | append-only and versioned in-file: never edit a past version |
| dev_docs/decisions/ | ADRs: one durable decision each, with its alternatives and consequences | accepted ADRs are not rewritten; supersede them with a new one |
| change_log/ | why each change happened and what resulted | one file per session, append-only, never edited afterwards |
| remove/ | verbatim pre-destruction snapshots (gitignored) | one directory per destructive action, named remove_<timestamp>_<slug>/ |

The documentation set was consolidated on 2026-09-12: twenty-four development documents, most of them
per-iteration evidence reviews, were superseded by the six current-facts files above and moved to
remove/. Their measurements are still in Git history and in the snapshots.

### Root documents

| File | Role |
| --- | --- |
| README.md | user-facing: what the plugin does and how to configure it |
| AGENTS.md | the working agreement for AI agents in this repository |
| CHANGELOG.md | user-visible release changes |
| LICENSE | license |

### Retired modules (in Git and remove/, not on disk)

v55-boundary.js, v55-compression.js, v55-consistency.js, v55-digest.js, v55-finalizer.js,
v55-privacy.js, v55-provenance.js, v55-summary-runtime.js - see ADR-0002. Nothing on disk imports
them, and test-extension-frontend-contract.mjs fails if one comes back.
