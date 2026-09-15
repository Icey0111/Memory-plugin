# ADR-0007: Retire the legacy generation runtime

- Status: accepted
- Date: 2026-09-12
- Supersedes: roadmap item 1 of ADR-0004
- Superseded by: -

## Context

Four installers used to wrap one host interceptor: a compatibility runtime, a feature finalizer, a
consistency pass and a provenance stabilizer. The narrative pipeline replaced all four with one entry,
and index.js kept assigning globalThis[aetheriaUnifiedMemoryV54Interceptor] with the v5.4 generation
path - extraction, recall, cold snapshots, prompt assembly - behind runtime gates that made it inert.

A gate is not a retirement. It keeps the code, the imports, the UI controls and the reader's doubt:
every future change has to ask whether the gated path still works.

## Decision

Delete the legacy generation entry and its call sites, rather than gating them.

- The interceptor, its injected-bundle assembly and the prefetch commit are gone. index.js no longer
  assigns the global; narrative-runtime.js is the only generation entry.
- The bootstrap guard that required the global to exist is gone with it. It only ever proved that the
  legacy core had loaded.
- The events that existed to feed extraction, recall prefetch and history reconciliation are gone. What
  remains registered is host housekeeping: clearing stale prompt keys on a chat change, status UI, and
  purging a deleted chat's vector collections.
- The startup pass no longer reconciles history or builds a baseline; it migrates the store and makes
  the setting plane ready, which is what the narrative runtime actually reads.
- Six settings controls whose handlers were removed with the path are removed from settings.html. A
  control that does nothing is worse than no control: it tells the user the feature exists.
- The runtime gates (narrative_pipeline) are gone, because there is nothing left to gate.

## Consequences

- One generation entry, one place that decides what the model sees, and no second implementation
  waiting behind a boolean.
- index.js lost the interceptor, the reconciliation, the prefetch chain and the dead controls: 700+
  lines removed by measurement, with the suite at 64/64 files.
- Four test files that existed to pin the retired path are retired with it
  (test-index-mock, test-index-vector-mock, test-index-migration-fallback,
  test-context-injection-lifecycle), and the setting-plane test that drove its assertions through the
  interceptor now drives the setting retrieval directly.

### What this does not retire yet

The extraction and fact subsystems are still in the tree. They are reachable from their own
\`__test\` shims and from the tests that pin them, so the deletion cascade stops there: a test that
exercises code the runtime no longer calls is the last thing holding it in place. Removing them means
deleting that test set first, then re-running the excision, then deleting whatever loses its last
importer. The reachability script that did this pass is the tool for it (remove/_excise.mjs at the time
of writing: delete a declaration only when no other file in the repository mentions it).
