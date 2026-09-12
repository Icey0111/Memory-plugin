# ADR-0002: Retire the layered summary and consistency stack

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

Four installers wrapped the host interceptor in turn: a compatibility runtime, a feature finalizer, a
post-runtime consistency pass and a provenance stabilizer. A hierarchical summary runtime added a
level-1/2/3 tree with its own digest, its own fold audit, its own settings panel and its own prompt
key. Each layer could rewrite what the previous one produced.

The costs were visible in the code and in the tests:

- Four writers of the same prompt keys, so "what did the model actually see" had no single answer.
- A fold audit table that had to be reconciled against a digest window, with a dedicated test class
  for the case where a floor was hidden and its stand-in had silently rolled out of the window.
- A summary tree whose upper levels never materialised in practice, and a digest that duplicated the
  level-1 layer.
- Modules that were no longer imported by the entry point but still carried tests: unreachable code
  with the maintenance cost of reachable code.

## Decision

Retire the layers whose only job was to feed or police the fact-injection path, and keep exactly one
generation entry.

Retired (deleted from the tree, preserved in Git and in `remove/`):

| File | What it did | Replaced by |
| --- | --- | --- |
| v55-summary-runtime.js | Hierarchical L1/L2/L3 summary, digest, summary prompt key, settings panel | narrative-runtime.js (one bounded summary, validated coverage) |
| v55-digest.js | Deterministic per-turn digest rows | `raw_history` chunks; the summary reads original text directly |
| v55-consistency.js | Post-hoc reconciliation of the assembled prompt | One assembly point in `narrative-runtime.js` |
| v55-finalizer.js | Scene summaries, private-knowledge filter, transaction finalization | Scene summaries retired; setting audiences still filtered by `filterSettingRowsForActor` |
| v55-provenance.js | Provenance registry over the fact store | Only meaningful for injected facts; facts are no longer injected |
| v55-boundary.js | Scene boundary detection (plan A2) | The summary decides what is worth carrying; boundaries are no longer a switch |
| v55-compression.js | Repetition-driven compression (plan A4) | Bounded summary budget |
| v55-privacy.js | Per-actor filtering of the fact set and summary tree | Knowledge boundaries are written into the summary text |
| v55-floor-fold.js (partly) | Fold decisions, fold audit, unfold, reachability report | `raw-history.js` owns the decision; the file keeps only the transcript projection |

Retained: the modules on the live path in 01_architecture.md, plus the legacy fact runtime reachable
through `index.js` for old-chat compatibility. The legacy runtime is unreachable while the narrative
pipeline is on; removing it is the first item in the roadmap.

`test-extension-frontend-contract.mjs` fails if a retired module reappears or an installer is
re-imported, so reviving any of them requires a superseding ADR rather than a quiet re-import.

## Consequences

- One writer of the prompt keys, one budget, one place to look when the model saw the wrong thing.
- 68 test files remain, all of them about code that ships. Seventeen test files that existed only to
  pin retired behaviour were removed with their modules, and two were rewritten against the new
  contract instead.
- The removed settings keys (`boundary_detection_enabled`, `compression_repetition_enabled`,
  `cold_eviction_by_reconstructability`) had no reader left; the prune call keeps its previous
  default, so an install that saved them behaves exactly as before.

### What this gave up

Per-actor knowledge filtering is the real loss. If character-level knowledge boundaries matter later,
they need a design of their own - the retired filter operated on a fact set that no longer reaches
the prompt, so it cannot simply be reinstated.
