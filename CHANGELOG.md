# Changelog

## 5.5-dev Iteration 13 hotfix 2 — mobile credential durability and a bounded, braked Embedding transport

### Fixed
- **The Aetheria-owned Embedding key did not survive a WebView reload.** Iteration 12 made the key memory-only to keep it out of WebView `localStorage`, which is the right place to keep it *out* of — but "memory only" was too strong a promise on Android, where the WebView is torn down and recreated constantly, so the user was asked to retype the key on essentially every launch while the desktop build behaved. The key now lives in TauriTavern's own extension store (`aetheria-unified-memory-v55/credentials/embedding_api_key`, the documented per-extension persistence outside the WebView), is re-hydrated once per session by `ensureTauriVectorApiKeyLoaded()`, and is deleted with the key itself. It still never touches WebView `localStorage` and still never touches the host Secret Store.
- **An unreachable provider stalled the turn pipeline for minutes per call.** TauriTavern builds every provider client with `Client::builder().no_proxy()` and a 3-minute connect / 10-minute request budget (`tt-adapter-http/src/pool.rs`) — sized for a human watching a chat stream, not for background vector work that runs inside a turn. Two changes: `requestEmbeddingJsonViaTauriNative()` now abandons its own call after a bounded wait (60s base, +0.5s per input, capped at 150s, overridable) instead of waiting out the host budget, and `v55-private-vector-transport.js` brakes the transport after 3 consecutive *reachability* failures for 120s. A provider that answered with 4xx/5xx is reachable and never opens the brake — that is configuration to fix, not an outage.

### Changed
- The Tauri Embedding timeout hint now names the actual constraint: TauriTavern never uses the OS/system proxy, only its own request-proxy setting.
- The vector panel help text states where the Aetheria-owned key is stored and that it is restored after a restart.

### Validated
- `npm run check` passes; the full offline suite passes, including new coverage for the bounded wait and budget math (`test-v55-tauri-native-http-bridge.mjs`), durable key persistence/re-hydration/clearing (`test-v55-tauri-vector-backend.mjs`), and the transport brake driven through the real interception path (`test-v55-private-vector-transport.mjs`).

## 5.5-dev Iteration 13 hotfix — TauriTavern host error toasts and store purge

### Fixed
- **Model discovery provoked a host-level error toast.** `v55-api-connections.js` enumerated Embedding models through TauriTavern's `get_chat_completions_status` command. TauriTavern maps every failure of that command through `log_user_visible_error` (`presentation/commands/helpers.rs`), and the native backend-error bridge `emit`s it as a global `后端错误` toast — emitted by Rust, so catching the rejection in the extension could not suppress it. Whenever a provider has no `/models` endpoint (Jina lists chat models, not embedding models), sits behind a proxy, or is slow on a mobile link, the user got a red toast for what is optional decoration. Discovery is now a plain WebView `fetch` only and stays silent on every failure; `buildTauriModelDiscoveryInvoke` / `discoverModelsViaTauriNative` are removed from `v55-tauri-native-http-bridge.js`, and the panel says so in TauriTavern instead of promising a model list.
- **Purging a collection that was never persisted raised `NotFound`.** `v55-tauri-vector-backend.js` called `extension.store.deleteJson` unconditionally, and TauriTavern answers a missing key with `CommandError::NotFound` → a second unsuppressable `后端错误` toast. `deleteCollection` now probes with the documented non-throwing `tryGetJson` and returns early when the key is absent, and still tolerates a `NotFound` race rather than converting it into a failure.

### Changed
- Native Embedding timeouts now carry a reachability hint (device network / host proxy / mirror endpoint) instead of surfacing only the raw host text, because a timeout there is a network path problem, not a transport defect.

### Validated
- `npm run check` passes; the full offline suite passes, including the updated `test-v55-tauri-native-http-bridge.mjs` (no host status ABI reachable from the bridge, timeout guidance present) and `test-v55-tauri-vector-backend.mjs` (store mock now implements the documented `{ found, value }` contract and fails like TauriTavern on a missing delete).

## 5.5-dev Iteration 13 — Reliability fixes, time/scope model and the evidence loop

### Added
- `v55-evidence.js`: cold turn snapshot in chat metadata under `store.cold_turns` (per-fingerprint, character-capped, oldest-first pruning); `expandMemoryEvidence` resolves a memory back to its original wording from the live chat first and the cold snapshot second.
- `v55-evidence.js` text protocol `【查阅记忆】` / 对象 / 事项 parsed and resolved on demand, and a bounded `[MEMORY EVIDENCE — ORIGINAL TEXT, RESOLVED ON DEMAND]` block emitted by `formatEvidenceBlock`.
- `v55-metrics.js`: `model_calls` (extraction/summary/other), `embed_calls` / `embed_items`, prompt/completion/embed character counts and estimated tokens (chars / 4), with `formatMetrics` / `resetMetrics`; persisted in extension settings.
- `v55-selfcheck.js`: six fixed hard cases (数字 / 否定 / 条件 / 承诺 / 偏好变化 / 跨轮) executed through the production fusion path (lexical + temporal + structured RRF + MMR) with recall/precision/MRR from `retrieval-eval.js`.
- Memory time/scope model in `memory-core.js`: `recorded_at` (when it was said), `effective_from` / `effective_until` (the interval it applies to) and `scope` (the situation it applies in, bounded to 200 chars); `selectTemporalCandidates` as the query-time temporal channel; `fuseHybridCandidates` accepts a labelled `structuredLists` structured-RRF channel; retrieval text includes `scope`.
- `memory-extractor.js`: `scope` added to the extraction JSON schema, normalizer and prompt.
- `index.js`: cold snapshot recorded at extraction; temporal channel added to recall and its picks exposed in recall diagnostics; metering wired to quiet extraction and embedding insert/query; `extraction_batch_turns` every-N-turn sampling with a widened recent-context window; `CHAT_DELETED` purges that chat's memory/baseline collections through a plugin vector-collection registry, plus a manual purge action; diagnostics UI controls.
- `v55-consistency.js`: resolves the previous assistant turn's `【查阅记忆】` block and appends the evidence block to Reference; records `store.last_evidence_resolution`.
- `v55-summary-runtime.js`: `summary_auto_rebuild_on_history_change` now defaults to `true`; summary calls are metered; a summary skipped because extraction is in flight is retried after 1.5s.

### Fixed
- **Privacy filter missed XML-escaped text.** `v55-finalizer.js` matched hidden memories against raw prompt lines only, so secrets containing `& < > ' "` stayed in the prompt while being reported hidden; it now matches the raw line and its XML-escaped form.
- **Vector sync could lose a vector permanently.** `index.js` wrote `memory.vector_hash` before the transport call, so a failed insert left no matching vector and a later sync reset `stale` to false; ordering is now insert → delete → commit hashes, and a failure keeps the old hashes.
- **Duplicate, un-sanitized scene injection.** `v55-finalizer.js` re-injected scene summary and scene evidence that consistency already injects from the actor-sanitized store; the finalizer injection was removed.
- **`/api/vector` responses were trusted on HTTP status alone.** `index.js` now validates JSON parse, `ok`/`success`/`error`, the metadata array and inserted/deleted counts, and a dense query failure no longer aborts lexical recall.
- **Shared prompt key raced across interceptor wrappers.** Three wrappers swapped the shared `ctx.setExtensionPrompt` across an `await`; `v55-consistency.js` now serializes the chain so overlapping generations cannot cross-contaminate.
- **Tauri extension-store errors were swallowed.** `v55-tauri-vector-backend.js` read/delete failures (blank collection overwrite, false purge success) now propagate.
- **Extraction contract.** A non-array `operations` payload is rejected; missing `event_summary` / `active_state` are reported as warnings instead of wiping canonical state; dropped operations are counted (`memory-extractor.js` + `index.js`).
- **Op accounting.** `op_count` / notification counted the injected noop as a committed op and reported success despite apply errors; fixed in `index.js`.
- **Stale index use in dense Setting mapping.** `setting-retriever.js` now prefers the authoritative hash over a stale array index (hash-first, index fallback).
- **History budget probe ignored `<evidence>` cost.** `context-assembler.js` now charges the probe for evidence so high-importance evidence memories are not dropped.
- **Store-integrity install could report false success.** `v55-store-integrity.js` returned true even when the accessor guard could not be installed.
- **Direct API connection reported unverified success.** `v55-api-connections.js` no longer persists `enabled=true` before the probe and the panel renders a verified flag instead of always showing success.
- Unified entry ordering (`order` null/undefined) across the list view and the index view via `compareSettingOrder` (`setting-index.js`, `setting-store.js`).
- Tauri Embedding API key is no longer persisted in WebView localStorage; it is session-only (`v55-tauri-vector-backend.js`).
- `EXTENSION_PATH` is derived from `import.meta.url` instead of a hardcoded `v5_4` folder.
- Dead code removed: whole files `v55-summary.js` and `v55-tauri-api-compat.js`; `appendRowsWithBudget`, `buildBaselineHint`, `getWorld`, `assertSettingStoreValid`, `assertSameImmutableRecord`, `embeddingEndpoint`, `MODULE_ID`, unused imports and the stale `baseline_hint_chars` setting.

### Validated
- `npm run check` passes.
- 47 offline test suites pass, including new `test-v55-reliability-fixes.mjs`, `test-v55-evidence.mjs`, `test-v55-temporal.mjs` and `test-retrieval-hard-cases.mjs`.
- `v55-selfcheck.js` fixed hard cases pass 6/6 with `MRR 0.750` recorded as the regression floor.

### Scope boundary
- No real SillyTavern or Tauri runtime acceptance yet.
- The cold snapshot is bounded, not an unbounded archive.
- `scope` is free text; there is no natural-language time parsing.
- Token counts are estimates (chars / 4).

## 5.5-dev Iteration 12 — Tauri embedding credential isolation

### Fixed
- Tauri embeddings use an Aetheria-owned key instead of the host secret bridge, so the plugin no longer depends on host Secret Store plaintext exposure for its own embedding requests.
- URL and store key normalization for the Tauri embedding provider.

### Scope boundary
- Native Jina `task` forwarding and host Vector Storage reuse on Tauri remain out of scope; the plugin owns the derived vector path.

## 5.5-dev Iteration 11 — TauriTavern plugin-owned vector backend

### Added
- `v55-tauri-vector-backend.js`: plugin-owned derived vector backend selected only when the Tauri Host ABI is present (`insert` / `query` / `list` / `delete` / `purge`) with Float32 base64 vectors, cached norms, cosine ranking and extension-store persistence.
- `v55-tauri-native-http-bridge.js`: native HTTP bridge for direct OpenAI-compatible `/embeddings` requests, with `retrieval.passage` for documents and `retrieval.query` for queries.
- Probe behaviour that validates provider embedding, role distinction, plugin persistence, cosine retrieval and cleanup together, and reports the real provider error instead of TauriTavern's `vector_endpoint_unavailable` 501.

### Safety / semantics
- Only rebuildable derived vectors are persisted in the Tauri store; Canonical memories are not moved there.
- Secret boundary: Aetheria does not use the host Secret Store for its own embeddings and does not weaken TauriTavern key-masking policy.
- The SillyTavern `/api/vector` path and its selected-secret rotation bridge remain unchanged and are used only when the Tauri ABI is absent.

### Scope boundary
- Iteration 12 then replaced the host secret bridge with an Aetheria-owned key. The first direct embedding request after a full restart may still require re-entering the key when the host still refuses plaintext secret exposure.

## 5.5-dev Iteration 10 — Integration closure and host compatibility

### Added
- Hierarchical summary runtime (`v55-summary-runtime.js`) with level1/level2/level3 summaries sharing the normal generation lifecycle and budget.
- Store-ownership contract test; the full-stack lifecycle test imports `index-v55-bootstrap.js`.
- CI workflow `.github/workflows/iteration10-ci.yml` running syntax checks and the Node test chain.

### Fixed
- Canonical replay no longer erases module-owned chat state; omitted module-owned fields such as `setting_binding`, `entity_registry` and `hierarchical_summaries` are preserved while rebuildable derivatives are invalidated (`v55-store-integrity.js`).
- Private knowledge is filtered before derived scene text exists; mixed transaction summaries are rebuilt from visible operations only and hierarchical visibility propagates recursively through source IDs (`v55-privacy.js`).
- Memory and Baseline indexes carry per-chat embedding-space identity (policy v3); a built legacy index with no per-index fingerprint is not trusted.
- Independent embedding credentials fail closed, and vector policy failures never resend the raw request.

### Scope boundary
- Iteration 10 documents that SillyTavern `release` cannot forward a vector `secret_id`, so its serialized rotate/request/restore bridge is the only available isolation; Iteration 11 replaces this on Tauri.
- No real-browser/SillyTavern end-to-end acceptance was claimed.

## 5.5-dev Iteration 9 — Embedding Space Profile and provider-neutral evaluation

### Added
- `embedding-profile.js`: embedding-space identity separate from retrieval policy, with a `space_fingerprint` (provider/model/endpoint/family/role transforms/dimension+normalization hints) and a `retrieval_policy_fingerprint` (calibrated thresholds + Setting multi-view RRF).
- `v55-vector-policy.js`: Aetheria-owned request policy for Aetheria `/api/vector/*` calls only, applying the document/query transforms and namespacing private physical collections by embedding-space fingerprint.
- Multi-view Setting dense retrieval: labelled Setting queries retrieve focus, assistant context, entity/location context and active-state/objective views, then combine rankings through weighted RRF; failure falls back to the single-query path.
- `retrieval-eval.js`: provider-neutral Recall@K, Precision@K, MRR, hit rate, minimum-recall threshold calibration and candidate-vs-baseline deltas.
- Tests `test-embedding-profile.mjs`, `test-retrieval-eval.mjs` and `test-v55-vector-policy.mjs`, added to the normal test chain.

### Safety / semantics
- A model-space change requires a derived-vector rebuild; a threshold/RRF change does not.
- Canonical Memory is never deleted on a model change; pre-profile derived vectors are invalidated once because they lack the new representation-space identity.
- No request rewrite touches non-Aetheria vector collections, and no API secret enters an embedding fingerprint or Canonical Memory.

### Scope boundary
- No real-browser SillyTavern acceptance, native Jina `task` forwarding, universal Cross-Encoder rerank transport or automatic Gold-dataset generation.
- Jina deliberately remains symmetric through the current ST vLLM bridge because provider-native `task` forwarding is not guaranteed.

## 5.5-dev Iteration 8 — Release-blocking fixes + proposal closure

### Fixed
- **Provenance origin order:** `v55-consistency.js` now stabilizes provenance before stamping runtime identity, so the first-observed branch is not overwritten by the freshly derived branch id (`test-v55-consistency.mjs` failed on Iteration 07 as published).
- **Prompt cleanup regression:** `v55-finalizer.js` / `v55-consistency.js` no longer re-inject Scene Summary locators after the legacy interceptor cleared both prompt keys for quiet / impersonate / disabled generations. Covered end-to-end by `test-v55-fullstack-cleanup.mjs`.
- Depth normalization now treats `null` / blank input as "not set" (falls back) while preserving a legal numeric `0`.
- Removed the dead eager `buildBaselineHint` computation from `ensureSemanticBaseline`.

### Added
- Explicit role-private setting schema (`secret` / `visibility` / `known_by`) with actor-filtered generation and extraction retrieval; nothing is inferred from prose or filenames.
- Condition/exception-aware setting chunking (`splitSettingText`) that keeps a rule's `除非/如果/但是/unless/...` clause with the rule.
- Baseline write-gate calibration samples plus entity-disjoint guard and additional change markers.
- Same-name entity disambiguation: explicit `entity_scope` / `entity_keys` keep story entities apart; an explicit discriminator never falls back to a same-name entity.
- Failed Setting vector refresh reuses the last known-good active profile for the same provider instead of dropping dense recall.
- Scene evidence expansion (`collectSceneEvidence` / `injectSceneEvidenceBlock`), bounded and labeled derived.
- Third-party quiet policy setting; the plugin's own extraction is always cleared.
- Tests: `test-v55-fullstack-cleanup.mjs`, `test-v55-entity-identity.mjs`, `test-v55-scene-evidence.mjs`, `test-setting-secret-visibility.mjs`, `test-setting-chunk-conditions.mjs`, `test-baseline-calibration.mjs`.

## 5.5-dev Iteration 7 — Architectural closure (chat binding, identity, scene summary, budget)

- Chat → World/Revision binding, chat-local entity registry, branch provenance registry, Canonical Current State authority, knowledge visibility filter, scene summary lifecycle, unified Reference + Current State budget, Setting Entry overlay editor, untitled TXT preview.
- Iteration 7 shipped with one failing integration test and the quiet/disable prompt regression; both are fixed in Iteration 8.

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
