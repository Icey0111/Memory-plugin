# Changelog

## 5.5-dev Iteration 13 hotfix 8 — summarize every ten floors, then fold them out of the prompt

The memory system now summarizes on a fixed cadence — one Level-1 summary per **ten completed floors** —
and a floor a Level-1 summary already covers **leaves the model prompt entirely**. The summary stands in
for it, the original wording stays in the chat file, in the transcript and in the cold snapshot, and the
whole thing is reversible from the settings panel.

### Added
- **Floor folding (冷原文 / cold original text).** `v55-floor-fold.js` marks a summarized floor
  `is_system = true` — SillyTavern's only prompt-visible lever, and the same flag its own `/hide`
  command uses — plus a plugin-owned marker in `message.extra`. SillyTavern's prompt builder filters
  `!x.is_system`, so the floor stops reaching the model while remaining in the transcript, collapsed
  rather than removed (`.mes.aum-v55-folded`).
- **Fold-aware row classification.** Telling the two uses of `is_system` apart is what makes folding
  safe: a folded row is still dialogue for extraction, for the dialogue-pair fingerprints, for branch
  identity and for on-demand evidence expansion, while a host `/hide` is not and was never meant to be
  remembered. `memory-core.js` now exports `isFoldedRow` / `isHostHiddenRow` / `isDialogueRow` and
  every reader of chat history in the extension goes through them — `memory-core`, `index.js`,
  `v55-runtime` (branch id), `v55-consistency`, `v55-finalizer`, `v55-evidence` and
  `setting-retriever`. Without this the memory system would forget the very floors it had just
  summarized, and every fingerprint would rebind the moment a floor was folded.
- **Reversibility and audit.** Folds are recorded in chat metadata under `store.floor_folds` with a
  per-row content fingerprint, so a shifted or rewritten chat cannot make the plugin unhide the wrong
  message. `unfoldAllFloors()` restores everything and is wired to a settings button.
- **Settings.** `summary_fold_hidden_floors` (default on), `summary_fold_keep_recent_floors` (default 1)
  and `summary_source_max_chars` (default 24000), with UI controls, a fold counter in the status line and
  a "恢复全部已折叠楼层" button.
- `test-v55-floor-fold.mjs` covers the fold, idempotency, host-`/hide` separation, unfold, index-shift
  safety, the tree-reset invariant and the injected summary shape.
- `test-v55-summary-store-swap.mjs` and the new `writeMergedChatStore` case in
  `test-v55-store-integrity.mjs` cover a store replacement landing in the middle of a summary model call
  and a store write running before the ownership guard exists.
- `test-v55-summary-error-string.mjs` covers every error shape the host and the transport actually emit,
  and asserts that ordinary narrative text mentioning a number is still accepted.
- **The summary tree was destroyed every time a chat was loaded.** SillyTavern loads a chat by
  *assigning a brand-new* `chat_metadata` object, which no plugin can intercept. The ownership guard is
  therefore not installed yet when the plugin's own store write runs, and `setStore` replaced the store
  wholesale — taking the summary tree and the floor-fold audit with it. A live reload recreated this
  exactly: the chat file held `l1=4 / l2=2 / l3=1` and `floor_folds.hidden=77`, the app loaded the same
  file with `l1=0` and `hidden=0`, and then wrote the empty tree back. Store writes now merge through
  `writeMergedChatStore()` so the guarantee no longer depends on whether the guard happens to be
  installed, and `CHAT_CHANGED` re-installs the guard synchronously as well as on the next tick.
- **A failed provider generation was stored as a summary.** A host generation that fails resolves with a
  short error string — `"[API 错误]\nToo many requests: … status 429: AGY quota exhausted for requested
  model"` — rather than throwing. The summarizer accepted it, stored the provider's error text as the
  level-1/2/3 summary and permanently marked the batch as summarized, so floors were folded with an error
  message standing in for them. Error-shaped completions are now rejected, the batch stays pending and the
  failure lands in `last_error`.


### Fixed
- **A summary tree captured across a model call was orphaned from the store that reached disk.** The
  ownership guard keeps independently-owned chat state across a Canonical replay by cloning it into the
  replacement store object. `processSummaryHierarchy` held the tree it had read *before* the model call,
  so every batch created after a replay landed in an object nothing ever persisted: a live 42-floor run
  summarized correctly in memory (`l1=4 / l2=2 / l3=1`) and came back from disk with `l1=0`. Each
  mutation now re-reads the tree from chat metadata, and a batch whose record was lost with the store is
  simply re-summarized. `test-v55-summary-store-swap.mjs` reproduces the swap mid-call.
- **An auxiliary key that arrived as an own property holding `undefined` erased owned state.**
  `mergeAuxiliaryChatState` treated "property present" as authoritative, and `normalizeStore` spreads its
  input, so a store that merely *omitted* `hierarchical_summaries` could still carry the key as
  `undefined` and drop both the tree and the floor-fold audit. Only a non-`undefined` incoming value is
  authoritative now; an explicit `null` or a replacement value still is.

### Changed
- `summary_level1_every_turns` default **1 → 10**: one Level-1 summary per ten completed floors.
  `summary_max_tokens` default **600 → 2048**, because a reasoning model bills its hidden reasoning
  against the same budget and 600 truncated the visible summary mid-sentence in a live session.
- **The injected summary shape had to change to match.** The old `format()` injected three or five newest
  items per level and dropped every item a higher level had consumed. That is correct when the raw floors
  are still in the prompt, and wrong once they are folded: a forty-floor chat could collapse to a single
  skeleton paragraph. Each level now gets a share of the sub-budget and is filled newest-first, and while
  floors are folded the lower levels stay in even after a higher level consumed them, because they are
  now the only surviving record of those floors.
- `summary_max_context_chars` default **6000 → 9000** to fit the extra levels.

### Guarantees
- Only a floor a Level-1 summary actually covers is folded, and the newest floor is never folded —
  SillyTavern's swipes and regeneration act on the last message, and its own hide helper refreshes the
  swipe buttons precisely because hiding the tail breaks them.
- A summary-tree reset **restores the raw text before it drops the tree**, so no content is ever missing
  from the prompt with nothing standing in for it.
- Folding is idempotent and persists through the host's own `saveChat()`; the transcript styling is
  re-applied after every chat load.

## 5.5-dev Iteration 13 hotfix 7 — the injected memory finally reaches the model

Verified against a live TauriTavern session with the real provider (WebView2 CDP, retained host request
logs, real Jina embeddings). This session's test chat ran a 12-turn scripted scenario end to end.

### Fixed
- **No Aetheria block ever reached the model.** The three v5.5 layers (runtime → finalizer → consistency)
  coordinated by swapping `ctx.setExtensionPrompt` on the context object they were handed. Real
  SillyTavern builds a **fresh context object on every `getContext()` call**, so the swap only ever
  mutated a throwaway: nothing was captured, and `v55-consistency` re-emitted the composed block using
  `position`/`depth` from an empty capture. `Number(undefined)` is `NaN`, SillyTavern matches
  `position` against its own `extension_prompt_types`, and `NaN` matches nothing — so every block was
  silently dropped while the plugin kept reporting success. Retained requests proved it: the recorded
  generation carried neither `PLUGIN REFERENCE DATA` nor `PLUGIN CURRENT STATE`. The legacy runtime now
  **publishes** its bundle for the outer layers to compose on top of, and every re-emit normalises the
  prompt arguments to a real numeric position and depth. The same request now carries both blocks, the
  hierarchical summary, scene locators, scene evidence and the recalled memory ids.
- **The whole summary tree was wiped and re-summarised on every launch.** `dirty()` treated every
  history-mutation event as an edit, and the host re-emits those events while it hydrates a chat at
  startup. It now resets only when a turn that had already been summarised actually disappeared, so an
  edit/swipe/delete still invalidates the tree while a plain reload does not.
- **One chat could own two vector collections.** `getCollectionId()` hashed whatever
  `getCurrentChatId()` returned, and the host reports the same chat with and without its `.jsonl`
  suffix depending on which path opened it (UI switch vs. `openCharacterChat`/restore). The plugin built
  a second collection and then reported the first as a stale index with no per-index space_fingerprint.
  Chat identity is now normalised once and used for the memory collection, the baseline collection and
  the per-chat registry.
- **A fresh chat reported a stale Dense index.** `indexLooksBuilt()` counted the provider fingerprint
  the plugin stamps when it merely *ensures* a collection, so a chat with zero vectorised rows was
  reported as `stale` with "现有 memory Dense 索引没有 per-index space_fingerprint；拒绝把它当作当前空间
  使用" — a message about a rebuild that had nothing to rebuild. A memory dense index now counts as built
  only when it actually holds a vectorised row; a genuine legacy index still carries rows, so it is still
  detected and rebuilt.

### Added
- `test-v55-injection-host-fresh-context.mjs` reproduces the real host shape (a new context object per
  `getContext()`) and asserts the reference/current-state blocks survive with a numeric position and
  depth. The existing lifecycle test used one stable context object, which is exactly why it never caught
  the defect.
- `test-v55-summary-dirty.mjs` asserts that hydration update events keep the tree and that a real edit
  still invalidates it.
- The extraction debug record now carries an `attempts` array (phase, budget, value type, length,
  parsed, starved) so a failed extraction says which provider round-trips ran instead of leaving the same
  parse error for every cause.

## 5.5-dev Iteration 13 hotfix 6 — any parse failure retries, and the retry is observable

### Fixed
- **The doubled retry never ran for a brace-less completion.** `budget-retry` was gated on
  `looksLikeStarvedJson()`, which requires the completion to start with `{`. A reasoning model that
  spends the entire budget before emitting its first brace returns prose (or two stray characters), the
  gate rejected it, and the turn was abandoned with nothing but a parse error. The gate is now simply
  "did not parse, and there is budget headroom".
- Live proof with `extraction_response_tokens: 256`: the recorded `attempts` show
  `structured@256 → budget-retry@512 → plain-json-retry@256`, and with 1024 the first structured attempt
  succeeded. Across the 12-turn scenario two turns needed the doubled retry and both then parsed cleanly.

### Changed
- **Summary budget.** `summary_max_tokens` raised to 2048 for this install (and
  `extraction_response_tokens` to 2048): the same provider was truncating summaries at 600 with
  `finish_reason: "length"`. After the change every summary in the run finished with `stop`.

## 5.5-dev Iteration 13 hotfix 5 — a starved extraction retries with more budget

### Fixed
- **A reasoning model can exhaust the extraction budget before the JSON closes.** With the prompt finally
  reaching the model, the live session showed `finish_reason: "length"` after 62 characters of JSON
  because ~2500 characters of hidden reasoning had consumed the rest of a 1024-token budget. The default
  `extraction_response_tokens` is now 2048, a completion that starts like JSON but does not parse
  triggers **one retry with a doubled budget** (`mode: "budget-retry"`, capped at 8192), and the
  parse-error record distinguishes "no JSON at all" from "JSON left unclosed".
- The same session showed the hierarchical summary clipped at `summary_max_tokens: 600`
  (`finish_reason: "length"`, reasoning ~1700 characters). Raise that setting for reasoning models; no
  code change is needed because it is already user-configurable.

## 5.5-dev Iteration 13 hotfix 4 — extraction now reaches the model

### Fixed
- **The extraction prompt never reached the provider.** Retained TauriTavern request logs showed the
  extraction call arriving as `[system] Write Seraphina's next reply… / [user] <character card>` — the
  supplied `quietPrompt` was absent, so the model answered with roleplay prose or raw reasoning and the
  JSON parse failed every time. `runQuietExtraction()` now prefers `ctx.generateRaw()`, which delivered
  the exact prompt and clean JSON against the same host in a direct comparison; `generateQuietPrompt()`
  remains as the fallback for hosts without `generateRaw`. The summary path already worked for the same
  reason — it goes through Connection Manager rather than a quiet generation.

## 5.5-dev Iteration 13 hotfix 3 — defects found by running a real conversation in TauriTavern

Driven end to end through a live TauriTavern session (WebView2 CDP): the plugin loaded, registered both
prompt channels, generated, summarised, ran extraction and metered its calls. Defects showed up that no
offline suite could see.

### Fixed
- **The credential hydration poisoned the key.** `ensureTauriVectorApiKeyLoaded()` read the host store
  with `probe?.value ?? probe` and then stringified the result. A missing entry comes back as
  `{ found: false }`, so hydration produced the literal string `"[object Object]"`, stored it as the
  live key, and every Embedding call went out with it — Jina answered `AUTH_INVALID_API_KEY` (401) and
  the whole vector path silently produced nothing while the panel reported a saved credential. Reading is
  now an explicit `readStoreEntry()` that unwraps `{ found, value }`, absence stays absent,
  `setTauriVectorApiKey()` accepts strings only, and `readStoreEntry()` deliberately still lets genuine
  store failures propagate so a broken store cannot look like an empty collection.
- **Quiet extraction inherited the chat preset's `max_tokens`.** `runQuietExtraction()` passed only
  `quietPrompt` and `jsonSchema`, so the host used the preset budget — 300 tokens in this session — and a
  reasoning model spent all of it on hidden reasoning. The visible completion arrived truncated
  (`finish_reason: "length"`) and the parser correctly rejected it, so no memory was ever written.
  Extraction now sets its own budget (`extraction_response_tokens`, default 1024, clamped 128-8192), and a
  parse failure records `raw_length` plus a truncation hint when the completion contains no JSON at all.

### Validated live
- The transport brake classified a provider 401 as *reachable* and did not open (`failures: 0`), which is
  exactly the behaviour the classification was written for.
- `get_chat_completions_status` never appears in the running module; `bridgeExports` on the live page
  lists only the embedding transport.

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
