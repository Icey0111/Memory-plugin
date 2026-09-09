# Changelog

## 5.5-dev Iteration 6 — Incremental Setting Vector Lifecycle (Commit G)

### Added
- Setting Index state schema v2 with per-scope `profiles{embedding_profile_hash}` and atomic `active_profile_hash / active_collection_id` pointers.
- Entry manifests for every ready Setting vector profile, including per-entry signatures and vector hashes.
- Per-entry diff semantics: unchanged reuse, added insert, changed insert+verify+targeted old-hash delete, removed targeted delete.
- Embedding-profile-aware physical collection identities and inactive staging generations for safe full builds.
- Sample-query verification before a newly built vector profile can become active.
- Retired collection tracking; old active collections are intentionally retained for later optional GC.
- Diagnostics for current embedding profile, vector degradation, verification result, last diff, cleanup-pending hashes and retired collections.
- `test-setting-index-lifecycle.mjs` and `test-setting-index-lifecycle-host.mjs`.

### Safety / lifecycle
- A one-entry Setting change never purges the active collection. New hashes are inserted and verified before old hashes are removed.
- Failed incremental insertion/verification best-effort rolls back newly inserted hashes while leaving the old valid vectors intact.
- New embedding provider/model profiles build in an inactive staging collection, verify, then switch the local active pointer atomically.
- Failed staging builds do not move the active pointer and never purge the previous active collection; the request falls back to lexical Setting retrieval with `vector_degraded=true`.
- Legacy state-v1 Setting collections lacked embedding-profile identity, so they are retained as diagnostics/GC metadata but are not silently trusted as active v2 indexes.

### Validated
- Full `npm run check` and `npm test` pass, including 23 test scripts and the existing 29/29 memory-core assertions.
- Mock host proves same-profile one-entry change uses targeted insert/delete with no `/api/vector/purge` against the active collection.
- Mock host proves embedding-model change builds/verifies a new collection, preserves the previous collection, then switches pointer.
- Mock host proves failed third-profile verification leaves the previous active pointer/vectors unchanged and returns lexical degradation.
- Real 41-entry Aetheria v5 sample remains 41 Entries / 91 chunks / 2 constant / 0 disabled; tail `uid=27` remains rank 1 and a synthetic same-scope change to only that Entry produces exactly one changed manifest Entry.

### Scope boundary
- Commit H real SillyTavern final-request and multi-provider System-role/depth acceptance remains unverified.
- Retired collection garbage collection is intentionally deferred; Commit G prioritizes no-data-loss switching over automatic cleanup.
- Runtime/module/settings keys intentionally remain v5.4 during staged v5.5 migration.

## 5.5-dev Iteration 5 — Context Assembler + Dual Injection (Commit F)

### Added
- `context-assembler.js`: pure, host-agnostic central budget/formatting boundary for main-generation context.
- Dedicated Reference Block containing bounded constant/core Setting, relevant Setting and historical memory sections.
- Dedicated Current State Block containing only Canonical current-state material from the previous completed turn.
- Two extension prompt keys: `aetheria_unified_memory_v5_4_reference` (System depth 4 by default) and `aetheria_unified_memory_v5_4_current_state` (System depth 1 by default).
- New UI controls for Reference budget, Current State budget, Current State depth and reply-reserve hint.
- Context Assembler diagnostics: selected Setting/memory ids, dropped ids, block sizes, approximate tokens and budget allocation.
- Cleanup lifecycle for quiet / impersonate / disabled / chat switch, plus legacy single-block key cleanup during staged upgrade.

### Safety / semantics
- Imported Setting text is explicitly labeled source/reference data rather than dialogue or control instruction. XML-like source markup is escaped.
- World truth remains distinct from character knowledge.
- Historical memory is explicitly labeled past/not-necessarily-current.
- Current state is explicitly labeled as effective for the previous completed turn; newer raw dialogue wins on conflict.
- Interceptor continues to avoid appending/splicing fake chat messages.
- Legal depth `0` is preserved for the new Current State depth as well as the existing Reference depth.

### Validated
- Pure assembler tests verify Reference/current-state separation and central caps.
- Mock lifecycle covers normal / continue / regenerate / group / quiet / impersonate / disabled.
- Main runtime Setting retrieval now reaches the Reference prompt while unrelated Setting remains absent.
- Real 41-entry Aetheria sample still produces 91 chunks; `uid=27` tail rule ranks first and survives through final Reference assembly.
- Full `npm run check` and `npm test` pass.

### Scope boundary
- Commit G incremental per-entry Setting Vector lifecycle and safe collection switching remain unimplemented.
- Commit H still requires inspection of real SillyTavern final requests and provider-specific System handling.
- Runtime/module/settings keys intentionally remain v5.4 during staged v5.5 migration.

## 5.5-dev Iteration 4 — Relevant Setting Retrieval (Commit E)

### Added
- `setting-retriever.js`: generation/extraction Setting Query builders plus host-agnostic lexical+dense candidate fusion.
- Generation Query now combines the latest user message, a small previous-assistant budget, current scene entities, active location, unresolved commitments/objectives and current-state hints.
- Extraction Query now combines the current user+assistant pair, affected/current entities and active state slots.
- Separate Setting retrieval runtime path with local lexical candidates, optional dense candidates, RRF fusion, parent-entry expansion, entry-level dedup and rough per-retrieval character caps.
- Constant settings are exposed through a bounded reserve channel rather than copied once per child chunk or appended without limit.
- Autonomous extraction now receives only relevant plugin Setting entries plus a small relevant/core Host Baseline reserve instead of the old fixed 12k host-baseline prefix.
- Plugin-owned active Setting scope now participates in the hard Baseline write gate through `findPossibleMatches(candidateOperation)` semantics. Static state/relation/commitment/ownership restatements can be rejected even when no SillyTavern World Info is bound.
- Knowledge/event/belief/intention/world_delta exemptions remain intact, so "character learns an existing world secret" is still a valid story delta.
- Runtime Setting-retrieval diagnostics and UI controls for dense usage, candidate/final counts, threshold, RRF K and generation/extraction rough budgets.

### Fixed
- Entry-level RRF aggregation no longer rewards large parent entries merely because they contain many weakly matching child chunks. Ranking uses the best child plus only small capped support from the next two chunks.

### Validated
- Real 41-entry Aetheria v5 worldbook still imports 41 entries and produces 91 SettingChunks with 2 constants / 0 disabled.
- Generation queries for new-region generation rules, police/A-network privacy, and strategic warfare retrieve the intended entries (`uid=27`, `uid=21`, `uid=26`) at rank 1 in lexical-only acceptance.
- Lexical-only runtime test proves the extractor receives the relevant imported tail rule, does not dump an unrelated entry, blocks a static duplicate through the plugin baseline gate, and preserves a new `knowledge` operation about that same baseline fact.

### Scope boundary
- Commit E runs Setting retrieval on the real generation path and feeds relevant Setting context to the autonomous extractor, but the main model still receives the legacy single memory prompt. Commit F will be the first iteration to assemble and inject the dedicated reference block at depth 4 and current-state block at depth 1.
- Incremental no-purge vector lifecycle remains Commit G.
- Runtime/module/settings keys intentionally remain v5.4 during staged v5.5 migration.

## 5.5-dev Iteration 3 — Setting Index (Commit D)

### Added
- `setting-index.js`: resolves active world/revision scope and projects immutable SettingEntry records into deterministic `SettingChunk` rows with parent entry/source/revision links.
- Structured long-entry chunking repeats parent title/keywords into each child retrieval view without treating those headers as independent source facts.
- World+active-revision scoped collection ids (`aetheria_v55_setting_*`) that do not contain chat ids, allowing the same plugin world to reuse one setting index across chats.
- Guaranteed local lexical Setting retrieval path with title/primary/secondary keyword boosts and body-specific ranking.
- Optional shared Setting Vector projection using the existing SillyTavern Vector Storage provider.
- Derived global `setting_index_state` under extension settings, separate from per-chat Canonical Memory metadata.
- Setting Index build/rebuild controls and diagnostics in the extension settings UI.
- Tests for scope isolation, disabled entries, parent links, tail-chunk retrieval, cross-chat shared vector reuse, and embedding-unavailable lexical fallback.

### Validated
- Real 41-entry Aetheria v5 worldbook produces 91 SettingChunks at the 420-char default and 91 unique vector hashes.
- Queries about world expansion, A-network police access, and strategic warfare rank the corresponding late/mid worldbook entries first.
- Two different chat ids sharing one active world/revision scope reuse the same collection id and do not issue a second vector rebuild in the mock host.

### Scope boundary
- Commit D builds and maintains the plugin-owned index but does **not** yet inject imported settings into generation or the autonomous extractor. Commit E will connect dialogue queries to relevant-setting retrieval.
- Full safe staging/no-purge incremental lifecycle remains Commit G; this iteration permits a full rebuild of the target immutable scope collection.
- Runtime/module/settings keys intentionally remain v5.4 during staged v5.5 migration.

## 5.5-dev Iteration 2 — Import Adapters + Preview (Commit C)

### Added
- `setting-importer.js`: two-phase `previewImport` / `commitImport` pipeline, deterministic source/entry hashing and explicit duplicate policy.
- `source-adapters/worldbook-json.js`: verified SillyTavern World Info JSON parsing with uid/key/keysecondary/constant/disable/order preservation and unknown fields stored in `raw_extra`.
- `source-adapters/titled-text.js`: conservative H1/H2 segmentation; untitled text remains one entry.
- Settings UI for file preview, world selection/creation, revision label/type, extension baseline binding, optional activation, commit and Setting Store export.
- Host integration test proving committed imported settings persist through global extension settings rather than chat metadata.

### Validated
- Real 41-entry Aetheria v5 worldbook imports 41/41 entries, including 2 constant entries, while retaining SillyTavern-specific unknown fields.
- Duplicate source content is detected by content hash and rejected unless explicitly reused/copied.

### Scope boundary
- Imported settings are stored but not yet generation-retrieval indexed. Commit D/E will build the shared Setting Index and relevant-setting retrieval path.
- Runtime/module/settings keys intentionally remain v5.4 during the staged v5.5 migration.

## 5.5-dev Iteration 1 — Foundation (Commits A+B)

### Added
- Plugin-owned global `Setting Store` persisted under the extension settings namespace, independent of per-chat Canonical Memory metadata.
- `setting-schema.js`: schema v1 for World / Source / Revision / Entry, normalization, conservative migration, validation and serialization.
- `setting-store.js`: immutable revision/source insertion, world CRUD, activation pointers, extension-to-baseline compatibility checks and explicit cascade deletion.
- Tests for cross-chat shared setting persistence, migration, serialization, unknown raw source payload preservation and immutable revision semantics.

### Fixed
- Legal SillyTavern injection depth `0` is no longer converted to `4`; invalid/negative values fall back safely.

### Scope boundary
- This is an implementation iteration on top of the v5.4 runtime identity. Import adapters, setting retrieval, shared setting vector indexing and dual prompt injection are not implemented yet.
- Existing Canonical Memory, baseline gate and recall behavior remain unchanged.

## 5.4.0 — Semantic Baseline Index

### Added
- `baseline-index.js`: deterministic Persona/Character/World Info chunking, fingerprinting and duplicate evaluation.
- `baseline-host.js`: conservative SillyTavern context source collection.
- Independent Baseline vector collection (`aetheria_v54_baseline_*`).
- Hard post-extraction write gate before Canonical Memory application.
- Lexical duplicate gate + optional semantic vector gate.
- Story-delta exemptions for event/knowledge/belief/intention/world_delta and explicit change semantics.
- Baseline fingerprint/provider fingerprint stale/rebuild lifecycle.
- Real baseline content supplied to quiet extraction prompt rather than macro placeholders when available.
- Baseline rejection audit data in extraction transaction/debug metadata.
- Baseline status and rebuild controls in settings UI.
- Tests for source scoping, group fallback, deterministic fingerprint, lexical duplicate blocking, semantic paraphrase blocking, knowledge/world-delta preservation, provider/source rebuild.

### Preserved
- v5.3 autonomous after-AI extraction and branch-safe transaction replay.
- v5.2 hybrid recall stack.
- v5.1/v5.2/v5.3 migration compatibility.
- no direct mutation of SillyTavern chat history.

### Not implemented / deferred
- destructive semantic cleanup of all pre-v5.4 legacy memories;
- Cross-Encoder reranking;
- safe host-level old-message prompt pruning;
- exhaustive indexing of every globally selected but currently inactive lorebook.
