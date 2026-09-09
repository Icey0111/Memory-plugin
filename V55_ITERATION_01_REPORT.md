# Aetheria Unified Memory v5.5 — Iteration 01 Report

Date: 2026-09-09  
Base: v5.4 (`82e613cf41c7be710d42e3372b9d92c6e76dd9c4` design baseline; supplied v5.4 package used as executable source baseline)  
Implemented scope: **Commit A + Commit B only**

## 1. What changed

### Commit A — safe injection depth normalization

The runtime no longer uses `Number(settings.injection_depth) || 4`.
A single `normalizeDepth()` path now handles normal injection, disabled/quiet cleanup and chat-switch cleanup.

Acceptance cases:

- `0 -> 0`
- `1 -> 1`
- `4 -> 4`
- `"0" -> 0`
- negative / `NaN` / invalid -> fallback

No memory schema or prompt content changed.

### Commit B — plugin-owned Setting Store + schema

Added:

- `setting-schema.js`
- `setting-store.js`
- `test-setting-store.mjs`
- `test-setting-store-host.mjs`

The store is persisted under:

```text
extensionSettings.aetheriaUnifiedMemoryV54.setting_store
```

This is deliberately separate from:

```text
chatMetadata.aetheriaUnifiedMemoryV54
```

Therefore world-setting data can be shared by several chats while plot transactions/current state remain chat-local.

The schema contains:

```text
WorldRecord
SourceRecord
SettingRevision
SettingEntry
```

with store schema version `1`.

## 2. Data invariants enforced in code

1. Revision records are immutable after creation. A changed worldbook must become a new source/revision later in the import pipeline.
2. An extension revision must explicitly reference a baseline revision.
3. Activating an extension whose `base_revision_id` does not equal the world's active baseline is rejected.
4. Switching the active baseline automatically removes incompatible active extensions.
5. Source/revision/entry relations must stay inside the same `world_id`.
6. Imported `raw_payload` is preserved as JSON data and is never interpreted as a plugin control prompt.
7. Deleting populated worlds/sources/revisions requires explicit cascade behavior.
8. Future store schema versions are rejected rather than silently downgraded.

## 3. Persistence decision for this iteration

For the first implementation pass, the global setting library lives in SillyTavern extension settings. This matches the existing extension persistence mechanism and gives cross-chat scope without introducing a server plugin or another database.

This is suitable for the current verified reference worldbook size, but it is not declared the final storage backend for arbitrarily large libraries. Before scaling to many large immutable revisions, v5.5 should measure settings payload size and save behavior in a real SillyTavern instance.

## 4. Tests

Executed with Node.js v22.16.0.

- `npm run check`: PASS
- original `memory-core` suite: 29/29 PASS
- all original v5.4 mock/extractor/baseline/vector tests: PASS
- new depth normalization test: PASS
- new Setting Store schema/CRUD/migration/serialization test: PASS
- new cross-chat host persistence test: PASS

No real SillyTavern browser acceptance is claimed yet.

## 5. Intentionally not implemented yet

Iteration 01 does **not** yet:

- import JSON/TXT from the settings UI;
- parse worldbook keywords/constant/disabled fields into `SettingEntry`;
- retrieve setting text for generation;
- replace the current chat-scoped baseline vector index;
- split reference/current-state injection into depth 4 + depth 1;
- incrementally update setting embeddings.

Those remain Commit C–G from the v5.5 implementation plan.

## 6. Next iteration

Iteration 02 should implement **Commit C — Import Adapters + Preview**:

1. `worldbook-json` adapter;
2. titled-TXT adapter;
3. deterministic content hashing;
4. unknown-field preservation in `raw_extra`;
5. import preview object with validation diagnostics;
6. explicit commit step creating Source + immutable Revision + Entries;
7. fixture test using the verified 41-entry worldbook shape;
8. only after parser tests pass, wire import controls into `settings.html`.
