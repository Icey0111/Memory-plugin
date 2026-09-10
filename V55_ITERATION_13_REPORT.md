# Aetheria Unified Memory v5.5 — Iteration 13 change report

Target: `v5.5-dev-iteration13` / package `5.5.0-dev.13`.

## Background

Iterations 09-12 moved dense retrieval onto an Embedding Space Profile, closed the audited integration
defects, and gave Aetheria a plugin-owned derived vector backend on TauriTavern with an Aetheria-owned
embedding key. Iteration 13 is a stability and capability pass on top of that base: it fixes the
reliability defects the earlier passes exposed, adds a time/scope model to Canonical Memory, and closes
the gap between a compressed recall result and the original chat wording. The Canonical/derived split and
the setting-plane / story-plane separation are unchanged.

## Reliability fixes

All fixes below are covered by unit tests:

1. **Privacy filter missed XML-escaped text.** `v55-finalizer.js` compared the hidden-memory text
   against raw prompt lines, while the reference records carry escaped text. Secrets containing
   `& < > ' "` therefore stayed in the prompt while being reported hidden. The matcher now accepts the
   raw line or its XML-escaped form.
2. **Vector synchronization could lose a vector permanently.** `index.js` wrote
   `memory.vector_hash` before the transport call, so a failed insert left a hash for a vector that was
   never stored and a later sync reset `stale` to false. Ordering is now insert → delete → commit
   hashes; on failure the old hashes remain.
3. **Duplicate, un-sanitized scene injection.** `v55-finalizer.js` re-injected scene summary and scene
   evidence that consistency already injects from the actor-sanitized store. The finalizer injection was
   removed.
4. **`/api/vector` responses were trusted on HTTP status alone.** Insert/delete counts were ignored and a
   failed query silently degraded to "no hits". `index.js` now validates JSON parse,
   `ok`/`success`/`error`, the metadata array and inserted/deleted counts, and a dense query failure no
   longer aborts lexical recall.
5. **Shared prompt key raced across interceptor wrappers.** Three wrappers swapped the shared
   `ctx.setExtensionPrompt` across an `await`, so overlapping generations could cross-contaminate.
   `v55-consistency.js` now serializes the chain.
6. **Tauri extension-store errors were swallowed.** `v55-tauri-vector-backend.js` could overwrite a
   collection with blank content or report a purge that never happened. Read/delete errors now
   propagate.
7. **Extraction contract.** `operations` must be an array; missing `event_summary` / `active_state` are
   reported as warnings instead of wiping canonical state; dropped operations are counted
   (`memory-extractor.js` + `index.js`).
8. **Op accounting.** `op_count` / notification counted the injected noop as a committed operation and
   reported success despite apply errors; fixed in `index.js`.
9. **Stale index use in dense Setting mapping.** `setting-retriever.js` preferred an array index over
   the authoritative hash; it is now hash-first with index fallback.
10. **History budget probe ignored `<evidence>` cost.** `context-assembler.js` dropped high-importance
    evidence memories because the probe did not charge for them; it now does.
11. **Store-integrity install false success.** `v55-store-integrity.js` returned true even when the
    accessor guard could not be installed.
12. **Direct API connection false success.** `v55-api-connections.js` persisted `enabled=true` before
    the probe and the panel always rendered success; a verified flag now gates both.
13. **Dead code removed.** Whole files `v55-summary.js` and `v55-tauri-api-compat.js`; plus
    `appendRowsWithBudget`, `buildBaselineHint`, `getWorld`, `assertSettingStoreValid`,
    `assertSameImmutableRecord`, `embeddingEndpoint`, `MODULE_ID`, unused imports and the stale
    `baseline_hint_chars` setting.
14. **Ordering unified.** `compareSettingOrder` now applies the same `null`/`undefined` ordering to the
    list view and the index view (`setting-index.js`, `setting-store.js`).
15. **Tauri embedding key scope.** The key is no longer persisted in WebView localStorage; it is
    session-only (`v55-tauri-vector-backend.js`).
16. **Path derivation.** `EXTENSION_PATH` is derived from `import.meta.url` instead of a hardcoded
    `v5_4` folder.

## Backlink/evidence loop

`v55-evidence.js` lets the model ask for the original wording of a memory it has only seen in compressed
form. The assistant emits a small text protocol:

```text
【查阅记忆】
对象：<entity>
事项：<item or query>
```

`parseMemoryLookupRequests` recognizes the marker and the 对象 / `object` and 事项 / `item` fields.
`resolveMemoryLookupRequests` matches those requests against the store, and `expandMemoryEvidence`
resolves each hit back to original wording — the live chat first, the cold snapshot second.
`formatEvidenceBlock` emits a bounded `[MEMORY EVIDENCE — ORIGINAL TEXT, RESOLVED ON DEMAND]` block.
`v55-consistency.js` resolves the previous assistant turn's block and appends the evidence block to
Reference, recording `store.last_evidence_resolution`.

## Cold原文 snapshot

Every extracted turn records a cold snapshot in chat metadata under `store.cold_turns`, keyed per
fingerprint. Snapshots are character-capped and pruned oldest-first (`pruneColdTurns`), so the snapshot
is a bounded recovery buffer rather than a second transcript. It exists solely as the fallback source for
evidence resolution when the live chat has already moved past (or lost) the original turn.

## Time and scope model

`memory-core.js` now separates three notions that were previously collapsed into one timestamp:

- `recorded_at` — when the statement was said;
- `effective_from` / `effective_until` — the interval the memory applies to;
- `scope` — the situation the memory applies in, free text bounded to 200 characters by
  `validateMemoryOp`.

`selectTemporalCandidates` is the query-time temporal channel. `fuseHybridCandidates` accepts a labelled
`structuredLists` structured-RRF channel, so structured/temporal candidates are fused with the lexical
and dense channels rather than bypassing them. Retrieval text includes `scope`. `memory-extractor.js`
adds `scope` to the extraction JSON schema, normalizer and prompt.

## Runtime self-check and cost metering

`v55-selfcheck.js` defines six fixed hard cases (数字 / 否定 / 条件 / 承诺 / 偏好变化 / 跨轮) and runs them
through the production fusion path: lexical + temporal + structured RRF + MMR. Recall, precision and MRR
come from `retrieval-eval.js`. The recorded result is 6/6 with `MRR 0.750` as the regression floor; the
same check is exposed as a diagnostics button.

`v55-metrics.js` meters `model_calls` by kind (extraction / summary / other), `embed_calls` and
`embed_items`, and prompt / completion / embed character volume with estimated tokens (chars / 4).
`formatMetrics` / `resetMetrics` render and clear the counters, which are persisted in extension
settings. Metering is wired to quiet extraction and to embedding insert/query.

## Cost defaults

- Tokens are always an estimate: `ceil(chars / 4)`.
- `extraction_batch_turns` defaults to 1 (every finalized exchange) and is bounded to 1-10; sampling
  above 1 widens the recent-context window so the batch still has a coherent scene.
- `summary_auto_rebuild_on_history_change` now defaults to `true`.
- A summary skipped because extraction is in flight is retried after 1.5s instead of being dropped.
- Recall diagnostics expose the temporal channel's picks so an operator can see why a candidate entered
  the budget.

## Vector collection lifecycle

`index.js` keeps a plugin vector-collection registry of the Aetheria-owned memory and baseline
collections per chat. On `CHAT_DELETED` the collections for that chat are purged, and a manual purge
action can clear every Aetheria-owned collection. Collections remain derived, rebuildable data;
Canonical Memory, extraction transactions and chat正文 are never stored in them.

## Tests

- `npm run check` passes (syntax check over the runtime and test modules).
- 47 offline test suites pass, including the new `test-v55-reliability-fixes.mjs`,
  `test-v55-evidence.mjs`, `test-v55-temporal.mjs` and `test-retrieval-hard-cases.mjs`.

## Deliberate boundaries

- No real SillyTavern or Tauri runtime acceptance yet; the offline suites are the current evidence.
- The cold snapshot is bounded and pruned, not an unbounded archive.
- `scope` is free text. There is no natural-language time parsing, so `effective_*` intervals come from
  message positions and explicit operations, not from prose.
- Token counts are estimates (chars / 4), not provider-reported usage.
- The self-check hard cases are a fixed regression floor, not a general benchmark.
