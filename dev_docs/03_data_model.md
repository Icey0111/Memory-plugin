# Data Model

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

> Entities, schema, relationships. Remove this file if not applicable.


<!-- VERSION 2 -->
## v2 - 2026-09-11 00:22:38 - record the canonical and derived data model

### 1. Two stores, two rules

| Store | Medium | Rule |
| --- | --- | --- |
| Canonical | chat metadata key `aetheriaUnifiedMemoryV54` | travels with the chat; losing it loses facts |
| Derived | host extension store (IndexedDB fallback) | rebuildable; losing it costs time, never a fact |

### 2. Canonical fields

| Field | Meaning |
| --- | --- |
| `version`, `sequence` | store schema version and replay sequence |
| `memories` | the current, replay-derived fact set (each record carries its slot, epistemic status and `channel`) |
| `slots` | one slot per addressable piece of world state; a new value supersedes the old one without erasing the history |
| `extractions` | the accepted operation transactions, in order - the replay log |
| `source_fingerprints` | per-pair fingerprints used to detect edits, swipes and deletions |
| `baseline`, `vector` | semantic baseline and memory index payloads (kept canonical: they are small, and a stripped copy would read as stale) |
| `hierarchical_summaries` | the L1/L2/L3 summary tree, each row carrying `source_ids` that point at original turns |
| `entity_registry` | entity identity across mentions; losing it fragments identity for every later mention |
| `setting_binding` | which plugin-owned setting collection this chat is bound to |
| `runtime_identity` | the authoritative identity assignment for this chat |
| `last_*` | diagnostics: last active state, last extraction/recall debug, last errors |

### 3. Derived fields

``DERIVED_KEYS`` (in `v55-derived-store.js`): `cold_turns`, `scene_summaries`,
`scene_summary_source`, `scene_summary_fingerprint`, `floor_folds`, `summary_history`,
`provenance_registry`, `last_extraction_debug`, `last_recall_debug`, `last_errors`,
`v55_consistency`, `v55_finalizer_diagnostics`, `current_state_authority`,
`last_active_state_diagnostic`, `v55_inner_bundle`, `spine`.

Deliberately **not** derived: `vector` and `baseline` (a stripped copy reads as stale),
`entity_registry` (identity fragmentation), `runtime_identity` (the assignment is authoritative).

### 4. Ownership rules in the metadata guard

- `CANONICAL_OWNED_KEYS` (`version`, `sequence`, `memories`, `slots`, `source_fingerprints`,
  `extractions`, `last_active_state`, `last_active_state_source`, `last_event_summary`,
  `last_extraction_debug`, `last_errors`, `last_recall_debug`, `baseline`, `vector`) may be
  replaced by a replay assignment.
- `DERIVED_DROP_KEYS` (`scene_summaries`, `scene_summary_source`, `scene_summary_fingerprint`,
  `v55_consistency`, `v55_finalizer_diagnostics`) are rebuilt from the new canonical state rather
  than preserved.
- A key owned by another store is never *resurrected* from the previous value - but it is also not
  deleted from the object runtime readers see. "Drop" means "do not bring back", not "erase".

### 5. The memory spine

`v55-spine.js`, `SPINE_VERSION = 1`, stored under the `spine` key:

    {
      version, seq,
      nodes:   [ ... ],   // bounded window, MAX_NODES = 300
      ledger:  [ ... ],   // one row per applied batch, MAX_LEDGER = 120
      by_slot, by_memory, first_by_slot   // indices, MAX_INDEX = 24
    }

- No timestamp is stored, so a rebuilt spine is byte-identical to the original.
- Irreversibility is a fact about the world, not a judgement about the story:
  `commitment 5`, `relation 4`, `ownership 4`, `knowledge 3`, `intention 2`,
  `world_delta 2`, `state 1`, `belief 1`, `event 1`.
- `NEVER_DROP_RANK = 4`: at or above this rank a memory is injected whatever recall decides.
- Provenance channels: `saw`, `heard`, `told`, `inferred`.

### 6. Invariants

| Id | Statement |
| --- | --- |
| I1 | Canonical state is `replay(extractions)`; nothing else may rewrite it |
| I2 | Summaries are derived from original turns, never from other summaries |
| I3 | Every memory records how its holder came to know it (`channel`) |
| C1 | A memory that cannot be derived from the chat must not live in the derived record |
| C2 | Deleting the derived record must never delete a fact |

See [MEMORY_PLAN_2026.md](MEMORY_PLAN_2026.md) sections 1 and 5 for the full statement.
