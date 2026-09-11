# Token Cost and Storage Cost

<!-- VERSION 1 -->
## v1 - 2026-09-12 02:13:35 - initial measurement, the single-rendering cut, and the storage projection

Two different costs, usually confused: what the memory system sends to the model every turn, and what it
keeps in the chat file. This document states both for one real acceptance chat and records what was
removed, what was kept, and why.

All numbers below are from the live app (TauriTavern WebView), chat `Seraphina - 2026-09-12@01h15m20s127ms`,
measured by rebuilding the injection through `globalThis.aetheriaUnifiedMemoryV54Interceptor(chat, 32768,
false, 'normal')` and then reading the two named prompt keys. Sampling the prompt slots as found between
generations reads empty or half-built and is not a measurement.

Source: `change_log/change_log_2026_09_12_02_13_35_single_state_rendering_and_storage_projection.md`.

## The two channels

The plugin owns exactly two host prompt keys. Nothing else it produces reaches the model.

| key | depth | carries |
|---|---|---|
| `aetheria_unified_memory_v5_4_reference` | 4 | reference data: the layered plot summary, the scene evidence block, recalled historical memories |
| `aetheria_unified_memory_v5_4_current_state` | 1 | the live state: must-remember rows, topical groups, the change chain |

The chat transcript itself is not a channel: folded floors are hidden from the prompt, so on this chat 49
of 51 rows were folded and the raw transcript in the prompt was 402 tokens.

## Per-turn injection, before and after

| section | before | after |
|---|---|---|
| current state: flat summary of every live memory | 5,418 chars / 4,007 tok | - |
| current state: must-remember rows | 1,805 / 1,247 | 1,303 / ~950 |
| current state: topical groups | 830 / 584 | ~4,400 / ~3,100 |
| current state: change chain | 663 / 502 | 663 / 532 |
| reference: layered summary | 3,541 / ~3,000 | 3,437 / ~2,930 |
| reference: scene locator block | 0 (always cut) | 0 (not injected) |
| **total** | **9,513** | **7,731 (-18.7%)** |

with an identical certificate: state 10/10, stale 0, commitment 22/22, causal 3/3, T-Causal 12/14,
violations 0.

### The rule that made the cut possible

The state was rendered twice: once as a flat summary of EVERY live memory, once as topical groups carrying
only the mandatory baseline plus a query-scoped slice. The rows could not replace the summary *while they
were a subset* - that is exactly why trimming the summary to 1,200 characters once dropped coverage from
10/10 to 8/10. Give the rows every live memory and the duplication disappears with nothing lost. The
precondition is the whole change; the budget arithmetic is a consequence.

## Storage

For the same chat, the plugin store was 218,279 bytes of a 500,693-byte chat file - 44% of the chat.

| key | before | after |
|---|---|---|
| `extractions` (the replay source) | 94,944 | 94,476 |
| `memories` | 82,111 | 62,385 (74 records; 843 bytes each, -26%) |
| `hierarchical_summaries` (authoritative) | 15,915 | 16,588 |
| `last_active_state` (authoritative) | 14,019 | 14,571 |
| `entity_registry` (authoritative) | 6,785 | 6,943 |
| **store total** | **218,279** | **199,492** |

Note what is NOT in the chat file: the spine, the provenance registry, the scene summaries, the recall
debug and the fold audit all live in the external derived store (`v55-derived-store.js`), so the chat file
carries facts and not indices.

### Where the wrapper went

72 memory records weighed 65,958 characters around 5,111 characters of memory text - a 12.9x wrapper. Two
parts of it carried no information at all and were removed at serialisation:

- 18,631 characters of keys whose value was `null`, `undefined`, `''`, `false` or `[]` for that record. Six
  keys (`invalid_reason`, `superseded_by`, `close_reason`, `supersedes`, `known_by`, `known_by_ids`) were
  null on all 72 records - about 9,300 characters of key that never held a value.
- 6,552 characters of per-record `world_id` / `chat_id` / `branch_id`, identical on every record and already
  stored once in `store.runtime_identity`.

## Open defects and stated limits

1. **`last_recalled_message: null` is read as "recalled at message 0".** `fuseHybridCandidates` computes
   `Number(memory.last_recalled_message)` and applies a recall cooldown whenever the result is finite.
   `Number(null)` is 0, so a memory that was never recalled is penalised as if it had been recalled at the
   start of the chat, whenever `currentMessage <= cooldownTurns`. The storage projection must NOT hide this
   by removing the key, so it is stated here instead: the fix belongs in the scoring code, and it changes
   recall results, so it was not bundled with a cost change.
2. **The remaining wrapper is repeated key names.** 74 records still spend 24,620 bytes writing the same
   field names 74 times. Removing that needs the memory records written columnar (field names once, values
   in rows), which is a chat-file format change and was deliberately not taken in the same pass as a
   behaviour change.
3. **`extractions` is now the largest single key** (94,476 bytes) and is kept whole because it is the replay
   source. Any bounded-retention policy must first establish what replay is still promised to a user.
4. **This is one chat, one character, one run.** The token numbers are from a single 25-user-turn chat and
   the storage numbers from a single 74-memory store. The certificate is judged over the store, so a store
   with fewer recorded facts asks fewer questions.
<!-- VERSION 2 -->
## v2 - 2026-09-12 02:26:16 - the column format, the write-only fields, and the recall-cooldown defect

v1 measured the two costs, removed the double rendering of the state (-18.7% per turn) and the empty part of
the memory wrapper, and left three things on the table: the repeated key names, the `extractions` log, and a
scoring defect it refused to hide. This version takes the first, explains why the second stays, and fixes the
third at its source.

### Per-turn injection

Unchanged by this version, as intended: removing storage wrapper must not move what the model sees. The chat
has since grown by two verification turns, so the live figures are 8,044 tokens over 76 memories against
7,731 over 72 - the same configuration, a larger store, a clean certificate (state 12/12, stale 0,
commitment 23/23, causal 3/3, T-Causal 14/16, violations 0).

### Stored bytes

| key | v1 measurement (74 records) | v2 measurement (76 records) |
|---|---|---|
| `extractions` | 94,476 (at 26) | 85,325 (at 28) |
| `memories` | 62,385 | 40,523 |
| `hierarchical_summaries` | 16,588 | 17,222 |
| `last_active_state` | 14,571 | not written |
| `entity_registry` | 6,943 | 7,101 |
| **store total** | **199,492** | **154,949** |
| chat file | 495,694 | 463,482 |

Per record: 1,140 -> 533 bytes for a memory (**-53%**), 3,652 -> 3,047 bytes for an extraction (-17%).
Against the first measurement of this chat (218,279 bytes at 72 memories) the store is about 29% smaller.

Three changes produced that:

1. **Columns.** After v1's removals, the memory wrapper was almost entirely repeated key names - 74 records
   spending 24,620 bytes writing the same 28 field names 74 times. Both record maps are now written with one
   column per field. `decodeRecordMap` lives in `memory-core.js`, next to the record definition, because
   decoding has to happen inside `normalizeStore` and that module is pinned to one dependency by
   `test-v55-drift-switches.mjs`.
2. **Fields nothing reads.** `prompt_plan`, `setting_index_fingerprint`, `generation_mode` and
   `user_index_at_creation` were written in one place and read nowhere. `entity_ids` is a cache that
   `stampRuntimeIdentity` recomputes deterministically. `known_by_ids` is NOT removed: two visibility checks
   read it, and a missing value there would make a private memory look public if the check ran before the
   next stamp.
3. **The canonical state summary is not persisted.** It is `buildCanonicalState` over `memories` - the same
   file already carries those records in full - and `getStore` rebuilds it on load. It is dropped only when
   it IS that canonical form; a state written by the legacy extractor carries a different source and is kept.

### The cooldown defect, now fixed

v1 recorded it and refused to resolve it by removing the key. `fuseHybridCandidates` read
`Number(memory.last_recalled_message)` and applied a cooldown whenever the result was finite; `Number(null)`
is 0 and finite, so a memory that had NEVER been recalled was treated as recalled at message 0 and penalised
hardest exactly when the chat was short enough for that stamp to fall inside the window. The guard now
requires a positive stamp. `test-v55-recall-cooldown.mjs` pins null, absent and zero to the same score, and a
memory recalled on the previous turn to a lower one.

### What is still not taken, with the arithmetic

A halving of the store is not reachable without giving up a capability. Of the remaining 154,949 bytes:
`extractions` is 85,325 and its `operations` array is read by the privacy filter that hides secret floors
from the prompt, so it cannot be aged out without redesigning that path; `memories` is 40,523 of which the
text is about 14,000 and the rest is per-record provenance that replay and the causal chain need;
`hierarchical_summaries` is 17,222 and is the only narrative carrier for folded floors; `entity_registry` is
7,101 and losing it fragments entity identity. Reported rather than promised: the honest target here was
the wrapper, and the wrapper is what was taken.

Limits unchanged from v1: one chat, one character, one run.
