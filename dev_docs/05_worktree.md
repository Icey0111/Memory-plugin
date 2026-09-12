# Work Tree

### Layout

    <project-root>/
    |-- manifest.json                 SillyTavern extension manifest (entry point of the plugin)
    |-- index-v55-bootstrap.js        load-order-critical bootstrap (store guard before core)
    |-- index-v55.js                  settings shell, pagination, single-install wiring
    |-- index.js                      host adapters + the retained v5.4-lineage runtime
    |-- raw-history.js                original-text archive, chunking, lexical rank, folds, evidence
    |-- narrative-runtime.js          the pipeline: summary job, index sync, budgeted assembly, panel
    |-- summary-transport.js          the quiet summary request: cloned preset, no persisted job flags
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
| dev_docs/ | how the project is designed, as current facts: project, architecture, development, data model, roadmap, work tree | edit current facts in place; version history lives in Git |
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

First wave (ADR-0002): v55-boundary.js, v55-compression.js, v55-consistency.js, v55-digest.js,
v55-finalizer.js, v55-privacy.js, v55-provenance.js, v55-summary-runtime.js. The frontend contract
test fails if one comes back.

Second wave (ADR-0009, the fact subsystem): v55-evidence.js, v55-forget.js, v55-quality-metrics.js,
v55-certificate.js, v55-tcausal.js, memory-extractor.js, context-assembler.js, v55-rerank.js,
retrieval-eval.js, v55-selfcheck.js, baseline-host.js, with the 33 test files that pinned them.
index.js went from 3444 to 2055 lines, the source set from 111 files to 67 and the suite from 64 to
31. v55-spine.js survives because the live memory-core.js uses it (ADR-0009).
