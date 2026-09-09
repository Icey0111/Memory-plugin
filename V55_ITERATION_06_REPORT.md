# Aetheria Unified Memory v5.5-dev — Iteration 06 Report

Date: 2026-09-09  
Runtime identity: **v5.4 remains unchanged intentionally**  
Implemented scope: **Commit G — Incremental Setting Vector Lifecycle**

## 1. Iteration goal

Iteration 06 upgrades the plugin-owned Setting Vector projection from the Commit D/F “full rebuild is allowed” model to a no-active-purge lifecycle with four guarantees:

1. one Entry change does not purge the whole active collection;
2. vector identity includes the embedding profile rather than only world/revision scope;
3. a new embedding space is built and verified before the active pointer moves;
4. embedding failure never blocks the main reply and never deletes an existing valid Setting index.

The target flow is now:

```text
world + active revisions
        ↓
SettingChunk snapshot
        ↓
Entry manifest
        ↓
embedding_profile_hash
        ↓
┌────────────────────────────────────┐
│ same ready profile                 │
│   Entry diff                       │
│   -> targeted insert/delete        │
│                                    │
│ new profile / forced full build    │
│   inactive staging collection      │
│   -> insert                        │
│   -> sample-query verify           │
│   -> atomic active pointer switch  │
└────────────────────────────────────┘
        ↓
Dense Setting retrieval
or lexical fallback when degraded
```

## 2. Setting Index state schema v2

`setting_index_state` is now normalized to schema v2.

Each logical scope keeps:

```text
scope_key
world/revision summary
active_profile_hash
active_collection_id
profiles {
  embedding_profile_hash -> {
    provider_fingerprint
    collection_id
    snapshot fingerprint
    entry_manifest
    ready / stale
    verification
    last_diff
    cleanup_pending_hashes
  }
}
retired_collection_ids
vector_degraded
last_error
```

A v1 state row can be migrated without destructive cleanup. Old v1 collections lacked an embedding-profile identity, so their metadata is kept under `legacy_v1` for diagnostics/optional later GC, but they are not silently reused as a trusted v2 active profile.

## 3. Embedding-profile identity

The physical vector collection now binds at least:

```text
world_id
+ active revision ids
+ embedding_profile_hash
```

The profile hash derives from the existing provider fingerprint, which already includes the relevant source/model/API-endpoint configuration while excluding API secrets.

Safe full builds add a generation component to the physical collection id, producing an inactive staging collection. This prevents a forced rebuild from accidentally purging the currently active collection even when the logical scope and embedding profile are unchanged.

## 4. Entry manifest and per-entry diff

`setting-index.js` now exports:

- `buildSettingEntryManifest()`;
- `diffSettingEntryManifests()`;
- `computeSettingEmbeddingProfileHash()`;
- profile/generation-aware `getSettingCollectionId()`;
- filtered `buildSettingVectorItems(snapshot, { entryIds })`.

Each manifest Entry owns its current vector hashes and a deterministic signature derived from revision/entry/content/chunk data.

Diff behavior:

```text
unchanged -> no vector request
added     -> insert only this Entry's chunks
changed   -> insert replacement chunks -> verify -> delete old hashes
removed   -> delete only old hashes for this Entry
```

This makes the lifecycle independent from file order and avoids rebuilding 91 chunks when only one worldbook Entry changes.

## 5. Safe incremental update order

For changed/added Entries the runtime deliberately does **not** delete first.

```text
insert new hashes
-> sample-query verification against hashes owned by changed/added Entries
-> targeted delete of old hashes
```

If insert or verification fails:

- newly inserted hashes are rolled back best-effort;
- old hashes were not deleted yet;
- the previous profile remains authoritative;
- the current request uses lexical fallback.

If old-hash cleanup fails after a successful replacement, the profile remains ready. Stale hashes cannot become source facts because dense metadata is mapped back through the current Setting snapshot; hashes that are no longer present are ignored. The failed cleanup list is retained in diagnostics.

## 6. Safe full build and atomic profile switch

A new embedding provider/model or a forced rebuild uses an inactive staging collection:

```text
purge staging only
-> insert entire current snapshot
-> sample-query verification
-> construct ready profile state
-> atomically update active_profile_hash / active_collection_id
-> retain previous active collection id as retired
```

The previous active collection is never purged in this path.

If staging verification fails:

- the staging collection is cleaned best-effort;
- the active pointer does not move;
- previous active vectors remain intact;
- `vector_degraded=true` is exposed;
- Setting retrieval remains available lexically.

Automatic GC of retired collections is deliberately not implemented in Iteration 06. Safety and recoverability take priority over reclaiming derived vector storage.

## 7. Verification semantics

SillyTavern Vector Storage does not expose a reliable collection-count endpoint in the current plugin integration, so Commit G performs the practical verification available to this runtime:

1. local expected chunk count is stored;
2. all insert requests must succeed;
3. a sample SettingChunk is queried against the staging/current collection;
4. returned metadata must map to a hash belonging to the expected current snapshot (or the changed Entry set for incremental updates).

A profile is not marked ready until this verification succeeds. Real provider behavior still needs Commit H calibration in a live SillyTavern instance.

## 8. Diagnostics / UI

Setting diagnostics now expose:

- current `embedding_profile_hash`;
- active profile / collection;
- `vector_degraded`;
- last per-entry diff;
- sample verification result;
- cleanup-pending hashes;
- retired collection ids;
- legacy v1 collection metadata if migrated.

The settings UI text now describes Commit G maintenance semantics rather than the previous full-rebuild lifecycle.

## 9. Automated tests

Environment used in this iteration:

```text
Node.js v22.16.0
```

Full validation:

```text
npm run check  PASS
npm test       PASS
```

The test script currently contains **23 test files**, including the existing **29/29 memory-core assertions**.

New tests:

### `test-setting-index-lifecycle.mjs`

Confirms:

- added / changed / removed / unchanged classification;
- targeted insert Entry set;
- targeted old hash deletion set;
- profile-separated physical collections;
- separate safe-build generation ids.

### `test-setting-index-lifecycle-host.mjs`

Confirms:

- v1 -> v2 lifecycle-state migration;
- initial safe staged build + sample verification;
- same-profile one-Entry change performs insert/delete without active `/purge`;
- embedding-model change builds a new collection and preserves the old one;
- active pointer moves only after verification;
- failed third-profile verification leaves the previous pointer and vectors untouched;
- failed replacement returns `vector_degraded=true` and lexical fallback behavior.

All pre-existing Store/import/retrieval/context injection/autonomous extraction/baseline/vector tests remain green.

## 10. Real 41-entry Aetheria acceptance

The same external Aetheria v5 worldbook sample used in prior iterations was run through the Iteration 06 modules.

Result:

```text
SettingEntry        41
SettingChunk        91
constant             2
disabled             0
manifest entries    41
manifest chunks     91
```

The natural-language “undefined region + new local organization” query still ranks:

```text
uid=27
世界扩展规则｜新地区与新组织生成
```

first.

A synthetic same-scope modification to only that imported Entry produces:

```text
added    0
changed  1
removed  0
```

and only that Entry is selected for replacement vector insertion. The old vector hashes for that Entry are exposed for targeted deletion.

## 11. Current development boundary

```text
Commit A  depth=0                         DONE
Commit B  Setting Store                   DONE
Commit C  Import + Preview                DONE
Commit D  Setting Index                   DONE
Commit E  Relevant Setting Retrieval      DONE
Commit F  Context Assembler + Dual Inject DONE
Commit G  Incremental Index Lifecycle     DONE
Commit H  SillyTavern live acceptance     NEXT
```

Commit H must inspect the **real final SillyTavern requests**, not only mocks, for normal / Continue / regenerate / group / quiet, very short histories, chat switching, disable behavior, provider-specific System-message handling, depth placement, duplicate prevention and token budgets.

Until that is completed, the package remains a staged **v5.5-dev implementation running under the intentionally unchanged v5.4 runtime/settings namespace**.
