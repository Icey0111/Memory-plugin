# ADR-0009: The fact subsystem is retired

- Status: accepted
- Date: 2026-09-12
- Supersedes: the "what this does not retire yet" section of ADR-0007
- Superseded by: -

## Context

ADR-0007 retired the legacy generation entry and recorded what it did not retire: the extraction and
fact subsystems stayed in the tree, reachable from their own test hooks and from the tests that pinned
them. That is the shape a dead subsystem takes when it is measured statically - a test that exercises
code the runtime no longer calls is the last thing holding it in place.

## Decision

Delete the tests that pin the retired subsystem first, then let the deletion cascade run to a fixed
point: a declaration may only be deleted when no other file in the repository mentions it, and a module
only when it has no importer left.

Retired in this pass:

| Removed | Lines |
| --- | --- |
| index.js: the extraction pipeline, baseline building, cold-turn snapshots, self-check and their helpers | ~1000 |
| v55-evidence.js, v55-forget.js | 500 |
| v55-quality-metrics.js, v55-certificate.js, v55-tcausal.js | 723 |
| memory-extractor.js, context-assembler.js | ~1200 |
| v55-rerank.js, retrieval-eval.js, v55-selfcheck.js, baseline-host.js | 535 |
| 33 test files whose subject was the retired pipeline | ~2500 |

index.js went from 3444 to 2055 lines; the source set from 111 files to 67, the suite from 64 files to
31. All 31 pass, the syntax gate is clean, and the narrative, setting-plane, store, vector and tokenizer
tests - the ones that exercise code which still runs - are untouched.

## Consequences

- What remains is code the runtime calls. The reader no longer has to decide whether a path is live.
- The live surface is smaller than the retired one, so the next change has fewer places to look.
- The backups are in `remove/` and in Git; the deletion is reversible by history, not by a flag.

### What still is not retired, and why

- `v55-spine.js` is imported by `memory-core.js` for the fact model's spine bookkeeping, and
  `memory-core.js` is live: it holds the chat store, the fold markers and the replay the derived record
  rebuilds from. Retiring the spine means retiring `applyMemoryOps`, which is the migration path for old
  chats. That is a data decision, not a dead-code decision.
- The legacy fact data itself (memories, slots, extractions) is still migrated and preserved for
  compatibility. Nothing reads it for injection, and ADR-0004 moved the projection out of the chat file.
