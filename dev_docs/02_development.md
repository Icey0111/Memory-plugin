# Development

<!-- Versioned & append-only: never edit past versions; newest is last. -->

<!-- VERSION 1 -->
## v1 - 2026-09-12 18:10:47 - toolchain, commands, and the bar a change has to clear

### Toolchain

| Item | Choice | Rationale |
| --- | --- | --- |
| Language | Plain ESM JavaScript | SillyTavern loads third-party extensions as-is: no build step, no bundler, no transpile target |
| Dependencies | None at runtime | Every dependency is a way to break on someone else's machine |
| Host surface | window.SillyTavern.getContext() | The supported API; no private internals |
| Node | 20 (matches CI) | The suite runs on the same major the workflow uses |
| Optional host ABI | window.__TAURITAVERN__.api.extension.store | Derived-state backend; IndexedDB is the fallback |

### Commands

| Command | What it does |
| --- | --- |
| npm run check | Parses every source file (check-syntax.mjs). The file list is discovered, not hand-maintained |
| npm test | The offline suite: one child process per test-*.mjs (run-tests.mjs) |
| npm run test:list | Lists the test files the runner would execute |
| node test-narrative-pipeline.mjs | The acceptance test for the narrative pipeline alone |

Both runners spawn children with file-backed stdio on purpose: capturing a child's output through a
pipe needs a named pipe, and a confined environment refuses one. A runner that cannot capture output
cannot report a failure.

### Quality bar

A change to the pipeline is complete when all of the following hold:

1. npm run check and npm test pass (68 test files).
2. The narrative acceptance test still passes: a detail that exists only in the original text is
   recallable, and no floor is hidden without a stand-in.
3. The change is recorded in change_log/ with the four required sections, and any durable decision
   is recorded as an ADR in dev_docs/decisions/.
4. dev_docs/ still describes the current system. If a document no longer matches the code, fix the
   document in the same change.

### What must not regress

| Property | Test |
| --- | --- |
| A floor is never hidden without a stand-in | test-narrative-pipeline.mjs |
| The bootstrap leaves exactly one generation entry and owns its prompt channels | test-narrative-bootstrap-lifecycle.mjs |
| Background work never writes into a chat the user left | test-narrative-pipeline.mjs |
| A diagnostics read creates no state | test-v55-derived-store.mjs |
| The retired modules stay retired | test-extension-frontend-contract.mjs |

### CI

.github/workflows/iteration10-ci.yml runs npm run check and npm test on pull requests into main and
on pushes to the v5.5-dev-iteration* branches. It does not run on other branch names.

<!-- VERSION 2 -->
## v2 - 2026-09-12 18:37:24 - document the measurement ruler and when to run it


### Toolchain

| Item | Choice | Rationale |
| --- | --- | --- |
| Language | Plain ESM JavaScript | SillyTavern loads third-party extensions as-is: no build step, no bundler, no transpile target |
| Dependencies | None at runtime | Every dependency is a way to break on someone else's machine |
| Host surface | window.SillyTavern.getContext() | The supported API; no private internals |
| Node | 20 (matches CI) | The suite runs on the same major the workflow uses |
| Optional host ABI | window.__TAURITAVERN__.api.extension.store | Derived-state backend; IndexedDB is the fallback |

### Commands

| Command | What it does |
| --- | --- |
| npm run check | Parses every source file (check-syntax.mjs). The file list is discovered, not hand-maintained |
| npm test | The offline suite: one child process per test-*.mjs (run-tests.mjs) |
| npm run test:list | Lists the test files the runner would execute |
| node test-narrative-pipeline.mjs | The acceptance test for the narrative pipeline alone |
| node recall-baseline.mjs | The ruler: archive cost, retired-fact-set cost and lexical recall, measured on real chats |

Both runners spawn children with file-backed stdio on purpose: capturing a child's output through a
pipe needs a named pipe, and a confined environment refuses one. A runner that cannot capture output
cannot report a failure.

### Measure before changing a budget

recall-baseline.mjs reads real chats and runs the real ranking and packing code without loading the
plugin. Run it before changing a token budget, a chunk size or a ranking rule, and put the numbers in
the change log. ADR-0004 records the first set: lexical recall 88-100% at median rank 0 for about 925
tokens per query, and an archive that costs about one copy of the conversation text.

### Quality bar

A change to the pipeline is complete when all of the following hold:

1. npm run check and npm test pass (68 test files).
2. The narrative acceptance test still passes: a detail that exists only in the original text is
   recallable, and no floor is hidden without a stand-in.
3. The change is recorded in change_log/ with the four required sections, and any durable decision
   is recorded as an ADR in dev_docs/decisions/.
4. dev_docs/ still describes the current system. If a document no longer matches the code, fix the
   document in the same change.

### What must not regress

| Property | Test |
| --- | --- |
| A floor is never hidden without a stand-in | test-narrative-pipeline.mjs |
| The bootstrap leaves exactly one generation entry and owns its prompt channels | test-narrative-bootstrap-lifecycle.mjs |
| Background work never writes into a chat the user left | test-narrative-pipeline.mjs |
| A diagnostics read creates no state | test-v55-derived-store.mjs |
| The retired modules stay retired | test-extension-frontend-contract.mjs |

### CI

.github/workflows/iteration10-ci.yml runs npm run check and npm test on pull requests into main and
on pushes to the v5.5-dev-iteration* branches. It does not run on other branch names.
