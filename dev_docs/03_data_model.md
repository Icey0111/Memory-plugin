# Data Model

<!-- Versioned & append-only: never edit past versions; newest is last. -->

<!-- VERSION 1 -->
## v1 - 2026-09-12 18:11:03 - the original-text archive, the derived index, and what may be deleted

### 1. Two stores, two rules

| Store | Medium | Key | Rule |
| --- | --- | --- | --- |
| Chat store | chat metadata | aetheriaUnifiedMemoryV54 | Travels with the chat. Losing it loses the archive |
| Derived store | host extension store, IndexedDB fallback | namespace aetheria-unified-memory-v55, table derived | Rebuildable. Losing it costs time, never text |

The vector collections are a third, rebuildable medium, addressed per chat and per space identity so
two chats can never read each other's vectors.

### 2. The narrative keys (what the live pipeline reads and writes)

| Key | Shape | Written by | Meaning |
| --- | --- | --- | --- |
| raw_history.version | 1 | captureHistory | Archive schema version |
| raw_history.sequence | integer | captureHistory | Id counter; ids are never reused |
| raw_history.records | id -> { id, index, role, name, text } | captureHistory | Every version ever seen, including superseded ones |
| raw_history.active | [id] | captureHistory | The lineage that is in the chat right now, in message order |
| narrative_summary | { version, text, covered } | updateNarrative | The continuity summary and the chunk ids it read |
| narrative_diagnostics | object | updateNarrative, buildNarrativeContext | What the last pass delivered, cost, and what failed |
| narrative_vector | { fingerprint, hashes } | syncIndex | Which chunks the vector collection holds, for this embedding space |

A chunk id is `<raw_id>:<start>:<end>`; its index hash is `fnv1a32(chunkId + '|' + text)`, so a
stored hash identifies an exact span of an exact message version. Chunks are ~700 characters with a
100 character overlap, and the cut prefers a newline or a sentence end.

**Coverage is a prefix, not a set.** `narrative_summary.covered` must equal the first N chunk ids of
the current chunk list, in order. Anything else is rejected and the summary is dropped, which is what
makes an edited or reordered history safe.

### 3. Retained legacy keys

Old chats still carry the v5.4/v5.5 fact model: `memories`, `slots`, `extractions`,
`source_fingerprints`, `entity_registry`, `vector`, `baseline`, `setting_binding`,
`runtime_identity`, the diagnostics keys, and `hierarchical_summaries`. The narrative pipeline
never reads or writes them; `index.js` still migrates and preserves them so an old chat opens
without losing anything. `hierarchical_summaries` is no longer written by any module.

### 4. Derived keys

`DERIVED_KEYS` in v55-derived-store.js: `cold_turns`, `scene_summaries`, `scene_summary_source`,
`scene_summary_fingerprint`, `floor_folds`, `summary_history`, `provenance_registry`,
`last_extraction_debug`, `last_recall_debug`, `last_errors`, `v55_consistency`,
`v55_finalizer_diagnostics`, `current_state_authority`, `last_active_state_diagnostic`,
`v55_inner_bundle`, `spine`.

Deliberately **not** derived: `vector` and `baseline` (a stripped copy would read as stale),
`entity_registry` (identity would fragment), `runtime_identity` (the assignment is authoritative),
and every narrative key above - the archive is the thing that must survive a lost backend.

### 5. Ownership rules in the metadata guard

- `CANONICAL_OWNED_KEYS` may be replaced by a canonical replay assignment.
- `DERIVED_DROP_KEYS` are rebuilt from the new canonical state rather than preserved. "Drop" means
  "do not bring back", not "erase": a key owned by another store is never resurrected from the
  previous value, and it is not deleted from the object a runtime reader sees.
- A diagnostics read must create nothing. `readNarrativeReport` and the store projections are
  read-only for exactly this reason: a lazily created key would be written back into the chat file.

### 6. Invariants

| Id | Statement |
| --- | --- |
| D1 | The chat store is the archive of record; the derived store and the vector collections are rebuildable caches |
| D2 | A superseded message version is archived, never overwritten |
| D3 | A summary is valid only while its covered prefix matches the current chunk list |
| D4 | Deleting the derived record must never delete text, a summary, or a coverage claim |
| D5 | Nothing that a reader can trigger may create a stored key |

<!-- VERSION 2 -->
## v2 - 2026-09-12 18:37:24 - the replayable fact set is a derived key now; the replay log stays canonical


### 1. Two stores, two rules

| Store | Medium | Key | Rule |
| --- | --- | --- | --- |
| Chat store | chat metadata | aetheriaUnifiedMemoryV54 | Travels with the chat. Losing it loses the archive |
| Derived store | host extension store, IndexedDB fallback | namespace aetheria-unified-memory-v55, table derived | Rebuildable. Losing it costs time, never text |

The vector collections are a third, rebuildable medium, addressed per chat and per space identity so
two chats can never read each other's vectors.

### 2. The narrative keys (what the live pipeline reads and writes)

| Key | Shape | Written by | Meaning |
| --- | --- | --- | --- |
| raw_history.version | 1 | captureHistory | Archive schema version |
| raw_history.sequence | integer | captureHistory | Id counter; ids are never reused |
| raw_history.records | id -> { id, index, role, name, text } | captureHistory | Every version ever seen, including superseded ones |
| raw_history.active | [id] | captureHistory | The lineage that is in the chat right now, in message order |
| narrative_summary | { version, text, covered } | updateNarrative | The continuity summary and the chunk ids it read |
| narrative_diagnostics | object | updateNarrative, buildNarrativeContext | What the last pass delivered, cost, and what failed |
| narrative_vector | { fingerprint, hashes } | syncIndex | Which chunks the vector collection holds, for this embedding space |

A chunk id is `<raw_id>:<start>:<end>`; its index hash is `fnv1a32(chunkId + '|' + text)`, so a
stored hash identifies an exact span of an exact message version. Chunks are ~700 characters with a
100 character overlap, and the cut prefers a newline or a sentence end.

**Coverage is a prefix, not a set.** `narrative_summary.covered` must equal the first N chunk ids of
the current chunk list, in order. Anything else is rejected and the summary is dropped, which is what
makes an edited or reordered history safe.

### 3. Retained legacy keys

Since ADR-0004, memories, slots and hierarchical_summaries are derived keys: they stay readable as
ordinary properties in memory, but they are written to the external record and left out of the
serialized chat store. They are a projection of extractions (memories and slots are exactly
buildCanonicalState(extractions)) and the summary tree is dead, so nothing is lost by dropping them
from the file. The strip activates only after the external record for that chat has been read or
written, so an install with no derived backend keeps them in the chat file as before.

Old chats still carry the v5.4/v5.5 fact model: `memories`, `slots`, `extractions`,
`source_fingerprints`, `entity_registry`, `vector`, `baseline`, `setting_binding`,
`runtime_identity`, the diagnostics keys, and `hierarchical_summaries`. The narrative pipeline
never reads or writes them; `index.js` still migrates and preserves them so an old chat opens
without losing anything. `hierarchical_summaries` is no longer written by any module.

### 4. Derived keys

`DERIVED_KEYS` in v55-derived-store.js: `cold_turns`, `scene_summaries`, `scene_summary_source`,

Added by ADR-0004: memories, slots, hierarchical_summaries - measured at 99-371 KB per chat, 18-53% of
the file, before the relocation.
`scene_summary_fingerprint`, `floor_folds`, `summary_history`, `provenance_registry`,
`last_extraction_debug`, `last_recall_debug`, `last_errors`, `v55_consistency`,
`v55_finalizer_diagnostics`, `current_state_authority`, `last_active_state_diagnostic`,
`v55_inner_bundle`, `spine`.

Deliberately **not** derived: `vector` and `baseline` (a stripped copy would read as stale),
`entity_registry` (identity would fragment), `runtime_identity` (the assignment is authoritative),
and every narrative key above - the archive is the thing that must survive a lost backend.

### 5. Ownership rules in the metadata guard

- `CANONICAL_OWNED_KEYS` may be replaced by a canonical replay assignment.
- `DERIVED_DROP_KEYS` are rebuilt from the new canonical state rather than preserved. "Drop" means
  "do not bring back", not "erase": a key owned by another store is never resurrected from the
  previous value, and it is not deleted from the object a runtime reader sees.
- A diagnostics read must create nothing. `readNarrativeReport` and the store projections are
  read-only for exactly this reason: a lazily created key would be written back into the chat file.

### 6. Invariants

| Id | Statement |
| --- | --- |
| D1 | The chat store is the archive of record; the derived store and the vector collections are rebuildable caches |
| D2 | A superseded message version is archived, never overwritten |
| D3 | A summary is valid only while its covered prefix matches the current chunk list |
| D4 | Deleting the derived record must never delete text, a summary, or a coverage claim |
| D5 | Nothing that a reader can trigger may create a stored key |
| D6 | The fact set is a projection of the replay log: the projection may live in the derived record, the log stays in the chat file |
