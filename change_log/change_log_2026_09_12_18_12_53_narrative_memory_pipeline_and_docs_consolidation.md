# narrative_memory_pipeline_and_docs_consolidation

- Date: 2026-09-12 18:12:53
- Session: Take over an interrupted refactor, finish the narrative memory pipeline in the semantics it was started with, retire what it replaced, and collapse the exploded documentation set.

## Problem / Requirement

Two requests were open when the previous session was cut off by a usage limit:

1. Clean up the documentation, which had grown to twenty-five files and roughly four thousand lines.
2. Finish the one-pass refactor that follows from the architecture review, and check the project for
   old functionality that no longer works, so the architecture is sounder.

The previous session had already created `raw-history.js`, `narrative-runtime.js`, and the wiring in
`index-v55.js` / `index.js`, and stated its own next steps: verify edit / branch / summary-failure
restoration, clean the documentation, and stop old and new flows from stacking. It stopped with two
failing tests, an unverified pipeline, and no documentation work done beyond scaffolding
`dev_docs/00_project.md`, `dev_docs/02_development.md`, `decisions/`, `AGENTS.md` and `CHANGELOG.md`.

## Purpose of Change

Complete that work in the same semantics rather than restating it: the summary carries continuity, the
original text carries detail, a floor leaves the prompt only while a summary covers all of it, and the
prompt has exactly one writer. Then remove what the new pipeline replaced, and reduce the documentation
to current facts.

## How It Was Changed

### 1. Verified the pipeline before changing anything else

- Added [test-narrative-pipeline.mjs L1-L60](file:///D:/memory_plugin/test-narrative-pipeline.mjs#L1-L60): nine sections covering the acceptance criteria
  the review asked for. The first is the one that matters - a detail (a code word) that exists only in
  the original text, in a chat with no extracted facts at all, is still recalled and cited. The rest
  cover chunk-id stability, archival of superseded versions, prefix-validated coverage, summary
  failure, budget overrun, no room in the host context, edits, abandoned chats, quiet generation, and
  the batch/input budget.
- Added [test-narrative-bootstrap-lifecycle.mjs L1-L40](file:///D:/memory_plugin/test-narrative-bootstrap-lifecycle.mjs#L1-L40): the bootstrap-level lifecycle. Loading
  the real extension must leave exactly one generation entry, inject the summary as the current-state
  block and quoted original text as the reference block, clear both channels for quiet, impersonation,
  disabled and its own background pass, never register the retired hierarchical-summary key, and
  restore the folded floors when disabled.
- Rewrote the stale version of that test (previously `test-v55-fullstack-cleanup.mjs`, backed up in
  `remove/`): it asserted that the reference block contains a hierarchical summary, which is the
  behaviour that was removed.

### 2. Fixed what the verification exposed

- [narrative-runtime.js L108-L135](file:///D:/memory_plugin/narrative-runtime.js#L108-L135): diagnostics writes now merge instead of replacing each
  other. An invalidation used to be erased by the next write, so the one moment the panel had something
  to report was the one moment it showed nothing. `summary_invalidated` is reported while it is true
  and cleared when a matching summary exists again.
- [narrative-runtime.js L270-L280](file:///D:/memory_plugin/narrative-runtime.js#L270-L280): the per-node render hook and the chat-load sweep for the
  folded styling, which the retired UI installer used to provide.
- [narrative-runtime.js L285-L305](file:///D:/memory_plugin/narrative-runtime.js#L285-L305): `readNarrativeReport`, a read-only state report for the
  settings panel that creates no key, folds no row and calls no model.

### 3. Removed the old flows instead of stacking them

- Retired eight modules that nothing reachable imported any more: `v55-summary-runtime.js`,
  `v55-digest.js`, `v55-consistency.js`, `v55-finalizer.js`, `v55-provenance.js`, `v55-boundary.js`,
  `v55-compression.js`, `v55-privacy.js`. Backup:
  `remove/remove_2026_09_12_18_06_41_retire_the_layered_summary_stack/` and
  `remove/remove_2026_09_12_18_07_40_retire_the_v55_finalizer_layer/`.
- [v55-floor-fold.js L1-L48](file:///D:/memory_plugin/v55-floor-fold.js#L1-L48): reduced from 435 lines to the transcript projection alone. Fold
  decisions, the fold audit, unfold-by-coverage and the reachability report belonged to the retired
  stack; folding is now decided by the summary's coverage in `raw-history.js`, and this file only makes
  the transcript show it.
- [index-v55.js L250-L310](file:///D:/memory_plugin/index-v55.js#L250-L310): removed the runtime dashboard, which reported facts, extractions
  and scene summaries that no longer exist, and installed the narrative panel in its place.
- [v55-ui-polish.js L108-L118](file:///D:/memory_plugin/v55-ui-polish.js#L108-L118): removed the localization of that dashboard.
- [index.js L209-L215](file:///D:/memory_plugin/index.js#L209-L215): dropped three settings keys whose only readers were the retired
  modules (`boundary_detection_enabled`, `compression_repetition_enabled`,
  `cold_eviction_by_reconstructability`), and [index.js L1267-L1267](file:///D:/memory_plugin/index.js#L1267-L1267): the prune call keeps the
  default it always resolved to, so a saved setting behaves as before.
- Pruned three tests that pinned retired behaviour while keeping their live assertions:
  [test-extension-frontend-contract.mjs L11-L30](file:///D:/memory_plugin/test-extension-frontend-contract.mjs#L11-L30) now asserts the single generation entry, the
  narrative contract, and that the retired modules stay retired;
  [test-v55-derived-store.mjs L165-L180](file:///D:/memory_plugin/test-v55-derived-store.mjs#L165-L180) replaces two retired status readers with the
  read-only narrative report; [test-v55-reliability-fixes.mjs L1-L12](file:///D:/memory_plugin/test-v55-reliability-fixes.mjs#L1-L12) drops the per-memory
  privacy section, whose subject no longer reaches a prompt.
- Reachability is now zero orphans: every `.js` file in the repository is imported, directly or
  transitively, from `index-v55-bootstrap.js`.

### 4. Replaced the hand-maintained syntax gate

- Added [check-syntax.mjs L1-L65](file:///D:/memory_plugin/check-syntax.mjs#L1-L65) and pointed [package.json L1-L11](file:///D:/memory_plugin/package.json#L1-L11) at it. The old
  `npm run check` was a sixty-entry chain of `node --check` calls that had drifted: it checked six
  deleted files and missed the two newest ones.
- Bumped the version to 5.5.0-dev.14 in [package.json L4-L4](file:///D:/memory_plugin/package.json#L4-L4) and [manifest.json L1-L15](file:///D:/memory_plugin/manifest.json#L1-L15).

### 5. Collapsed the documentation to current facts

- Rewrote [dev_docs/00_project.md L1-L71](file:///D:/memory_plugin/dev_docs/00_project.md#L1-L71), [dev_docs/01_architecture.md L1-L113](file:///D:/memory_plugin/dev_docs/01_architecture.md#L1-L113),
  [dev_docs/02_development.md L1-L57](file:///D:/memory_plugin/dev_docs/02_development.md#L1-L57), [dev_docs/03_data_model.md L1-L76](file:///D:/memory_plugin/dev_docs/03_data_model.md#L1-L76),
  [dev_docs/04_roadmap.md L1-L52](file:///D:/memory_plugin/dev_docs/04_roadmap.md#L1-L52) and [dev_docs/05_worktree.md L1-L59](file:///D:/memory_plugin/dev_docs/05_worktree.md#L1-L59) as the current
  system, each starting at version 1 with a real timestamp.
- Added three decision records: [dev_docs/decisions/ADR-0001-narrative-memory-architecture.md L1-L70](file:///D:/memory_plugin/dev_docs/decisions/ADR-0001-narrative-memory-architecture.md#L1-L70),
  [dev_docs/decisions/ADR-0002-retire-the-layered-summary-stack.md L1-L66](file:///D:/memory_plugin/dev_docs/decisions/ADR-0002-retire-the-layered-summary-stack.md#L1-L66) (including what the
  retirement gave up) and [dev_docs/decisions/ADR-0003-original-text-archive-in-chat-metadata.md L1-L53](file:///D:/memory_plugin/dev_docs/decisions/ADR-0003-original-text-archive-in-chat-metadata.md#L1-L53).
- Versioned [dev_docs/header.md L96-L175](file:///D:/memory_plugin/dev_docs/header.md#L96-L175) to v2: the file table now lists the six current
  documents plus `decisions/`, and the versioning note no longer points at a skill script that is not
  installed in every environment.
- Moved the twenty superseded documents and the root `ARCHITECTURE.md` signpost to
  `remove/remove_2026_09_12_18_11_39_consolidate_the_dev_docs_set/`, with a README explaining the
  snapshot. Nothing was lost: every file is also in Git history.
- Rewrote [README.md L1-L113](file:///D:/memory_plugin/README.md#L1-L113): it still described extraction, the context assembler and dual
  system prompts, and still declared a `vectors` dependency the manifest does not have.
- Filled in [CHANGELOG.md L6-L60](file:///D:/memory_plugin/CHANGELOG.md#L6-L60) with the user-visible changes.

## Result

- `npm run check`: 110 files parse. `npm test`: 68 of 68 test files pass.
- The pipeline is verified end to end through the real bootstrap, not only in unit isolation: the
  summary folds covered floors, evidence quotes a detail the summary does not mention, and disabling
  the extension puts the original text back.
- The architecture has one generation entry, one budget calculation, and one place that decides what
  the model sees. Eight modules, seventeen test files, twenty documentation files and one root
  signpost are gone, each with a verbatim backup in `remove/`.
- Known and recorded, not hidden: the original-text archive duplicates the transcript inside the chat
  file (ADR-0003, roadmap item 3), the legacy fact runtime is still in the tree and is the first
  roadmap item, per-actor knowledge filtering was given up with the fact path (ADR-0002), and dense
  retrieval over original text is unmeasured until an embedding backend is configured (roadmap item 2).

## Addendum 2026-09-12 18:16:24 - a store-swap bug found by widening the test, recorded after the first commit

The first commit was verified and pushed. Adding the host adapter's setting path to the lifecycle
test then exposed a real defect, so it is recorded here as an addition rather than by rewriting the
entry above.

Making the fixture run the setting path (a non-zero setting budget) and asserting that the
diagnostics say *why* original-text vectors are unavailable failed: the field was absent while the
failure itself was still reported. The cause is the store projection: it replaces
`ctx.chatMetadata[aetheriaUnifiedMemoryV54]` whenever it persists, so a reference captured before a
persist points at a retired object and every write through it disappears.

Three writes were affected, in [narrative-runtime.js L45-L60](file:///D:/memory_plugin/narrative-runtime.js#L45-L60) and
[narrative-runtime.js L129-L250](file:///D:/memory_plugin/narrative-runtime.js#L129-L250):

- the summary and its diagnostics after `prepare()`, which itself persists;
- the vector availability report after `syncIndex()`;
- the whole delivery report at the end of `buildNarrativeContext()`.

All of them now write through a fresh read (`diagnose`), and the context assembly reads the live store
rather than the snapshot `prepare()` returned. The two WeakMaps were rekeyed for the same reason:
they were keyed by the store object, so the running summary job and the live index were lost on
exactly the turns that wrote something. Keying them by the chat-metadata object, which is stable for a
chat and replaced when the user switches chats, also restores the concurrency guard: two passes fired
for one chat now share one job.

[test-narrative-pipeline.mjs L257-L288](file:///D:/memory_plugin/test-narrative-pipeline.mjs#L257-L288) adds a fixture whose host replaces the store object on
every persist, and asserts that the summary, the vector reason, the delivery report and the folds all
land in the live store, and that two concurrent passes run one summary job rather than two. The
lifecycle test now runs the setting path and asserts the vector report, so the path is covered on
every run instead of only in a one-off probe.
