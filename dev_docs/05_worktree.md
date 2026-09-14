# Work Tree

## Active modules

| Responsibility | Files |
| --- | --- |
| Entry point and settings shell | manifest.json, index-v55-bootstrap.js, index-v55.js, settings.html |
| Host services and retained store adapters | index.js, memory-core.js |
| Raw archive, chunking, ranking, knowledge parsing and evidence | raw-history.js |
| Request and continuation queries | retrieval-query.js |
| Summary scheduling, index synchronization, prompt budgets and diagnostics | narrative-runtime.js |
| Summary request transport | summary-transport.js |
| Optional original-chunk rerank transport and shortlist | v55-rerank.js |
| Transcript fold presentation | v55-floor-fold.js |
| Setting import, storage and retrieval | setting-*.js, source-adapters/ |
| Tokenizer and lexical baseline | baseline-index.js, v55-tokenizer.js |
| Other active adapters and projections | see 01_architecture.md |
| Offline regression and syntax gates | test-*.mjs, run-tests.mjs, check-syntax.mjs |
| Retrieval measurements | recall-baseline.mjs, retrieval-audit.mjs, retrieval-experiment.mjs |
| Runtime preflight and evidence replay | runtime-precheck.mjs, replay-anchor-evidence.mjs |

The current v55-rerank.js is the optional original-text reranker introduced by ADR-0016.
The fact-path reranker with the same filename was retired by ADR-0009; that historical retirement
does not mean today's module is inert. memory-extractor.js and context-assembler.js are retired,
not retained modules.

## Documentation and evidence

| Location | Rule |
| --- | --- |
| README.md | User-facing behavior and configuration |
| dev_docs/ | Current design, validation methods, evidence limits and module map |
| dev_docs/decisions/ | Durable choices; supersede explicitly rather than rewriting accepted decisions |
| CHANGELOG.md | Release-level user-visible changes |
| Git and pull requests | Implementation history and verification |
| Local measurement outputs outside the repository | Private chats, provider results and acceptance records; never dependencies of production code and never a repository-local vault |

There is no append-only change_log workflow, no repository-local measurement vault and no requirement
to make local history copies. Acceptance evidence lives in the pull request and outside the repository,
for example in a temporary directory; the ignored `remove/` path holds prior work only and must not grow.
Use Git to recover retired tracked files.
