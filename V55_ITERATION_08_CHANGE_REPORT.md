# Aetheria Unified Memory v5.5-dev — Iteration 08 Change Report

Date: 2026-09-09
Base: `v5.5-dev-iteration07` / `3fdccf6` (package `5.5.0-dev.7`)
Target: `v5.5-dev-iteration08` (package `5.5.0-dev.8`)
Scope: close the release-blocking defects and the proposal gaps found by the architecture
cross-check (`V55_ARCHITECTURE_CROSSCHECK.md` in the parent workspace).

Verification: `npm run check` equivalent = 18/18 syntax checks pass; `npm test` equivalent = **33/33
test scripts pass** (Iteration 07 shipped 27 with 1 failure).

---

## 1. Release-blocking fixes

### 1.1 Provenance origin was overwritten before it was recorded

- `v55-consistency.js`: now `stabilizeProvenanceStore(...)` runs **before** `stampRuntimeIdentity(ctx)`.
  `v55-runtime.js:stampRuntimeIdentity` unconditionally rewrites `record.branch_id`, so stabilizing
  afterwards recorded the freshly derived branch as the origin.
- Test: `test-v55-consistency.mjs` now passes (was the single failing test in Iteration 07).

### 1.2 Prompt cleanup was defeated by the wrapper stack

- `v55-finalizer.js` / `v55-consistency.js`: when the legacy interceptor cleared both prompt keys for
  a suppressed generation, the wrappers forwarded the cleared payloads and skipped scene-summary
  re-injection. Suppression = plugin disabled, `impersonate`, or `quiet` that is not an opted-in
  third-party request.
- `index.js`: `runQuietExtraction` marks the plugin's own quiet call
  (`__quiet_extraction_in_progress`) so opting into third-party quiet never affects background
  extraction. New setting `quiet_allow_third_party_injection` (default `false`), UI checkbox
  `aum-v54-quiet-third-party`.
- Test: `test-v55-fullstack-cleanup.mjs` runs the real `index-v55.js` stack with extractions and
  asserts normal keeps Reference + Current State while quiet / impersonate / disabled stay cleared;
  it also asserts the opt-in injects for third-party quiet but never for the plugin's own extraction.

---

## 2. Proposal items implemented

| Proposal item | Change | Test |
| --- | --- | --- |
| World secret vs character knowledge (P0) | Explicit `secret` / `visibility` / `known_by` schema in `setting-schema.js`, `setting-importer.js`, `source-adapters/worldbook-json.js`; propagated to `setting-index.js` chunks and fused rows; `filterSettingRowsForActor` applied to generation and extraction retrieval (`index.js`). Dedup still uses the full objective snapshot. Nothing is inferred from prose/filenames. | `test-setting-secret-visibility.mjs` |
| Rule exceptions/conditions must not be split away (P1) | `setting-index.js` `splitSettingText` glues a fragment starting with `如果/除非/但是/unless/...` back onto its rule up to a bounded soft cap. | `test-setting-chunk-conditions.mjs` |
| 0.84 threshold calibration (P1) | `test-baseline-calibration.mjs` locks the five proposal scenarios and asserts a story-delta false-reject rate of 0; `evaluateBaselineDuplicate` gained an entity-disjoint guard and `CHANGE_MARKERS` gained common change verbs (卖掉/辞职/毕业/...). | `test-baseline-calibration.mjs`, `test-baseline-index.mjs` |
| Same-name characters must not cross-link (acceptance #3) | `v55-runtime.js`: `entity_scope` / `entity_keys` give story entities an explicit discriminator; an explicit discriminator never falls back to a same-name entity (`resolveEntityId`); shared `deriveActorIdentity` exported. | `test-v55-entity-identity.mjs` |
| Failed vector refresh must keep a usable version (P1) | `index.js` Setting index catch path returns the last known-good active profile for the same provider instead of `collection_id: null`. | existing lifecycle/host tests |
| Scene summary must expand to linked event evidence (C8) | `v55-finalizer.js` `collectSceneEvidence` + `injectSceneEvidenceBlock`, bounded (1200 chars) and labeled derived; wired in finalizer and consistency. | `test-v55-scene-evidence.mjs` |
| Depth `0` preserved, invalid values fall back (D2 edge) | `normalizeDepth` treats `null` / blank as not-set; `'0'` / `0` preserved. | `test-depth-normalization.mjs` |
| Dead code | Removed the eager `buildBaselineHint` computation from `ensureSemanticBaseline` (the hint had no consumer since Iteration 04). | `test-index-baseline-mock.mjs` |

---

## 3. Documentation and metadata sync

- `package.json` / `manifest.json`: `5.5.0-dev.8`, display name Iteration 08, 6 new test scripts
  registered (33 total).
- `CHANGELOG.md`: Iteration 07 + Iteration 08 entries.
- `README.md`: title and development note moved to Iteration 08; commit ladder includes I07/I08.
- `ARCHITECTURE.md`: title is now v5.5-dev; new section 18 documents the Iteration 07/08 boundary.
- `TEST_PLAN.md`: title is now v5.5-dev; new "Iteration 08 additions" section.
- `PACKAGE_MANIFEST.json`: regenerated (71 files with real sha256/bytes), version
  `5.5.0-dev.8`, `development_iteration` = `v5.5-iteration-08`, policies extended with
  `explicit_role_private_schema`, `condition_aware_chunking`, `role_private_retrieval_filter`,
  `failed_refresh_reuses_active_profile`, `provenance_origin_before_stamp`,
  `quiet_allow_third_party_injection_setting`, `scene_evidence_expansion`.
- `settings.html`: header version label updated.

---

## 4. Deliberately still deferred (not defects)

- **Commit H live acceptance**: real SillyTavern final-request inspection for normal / Continue /
  regenerate / group / quiet / chat switch / plugin disable, provider-specific System handling and
  real-provider threshold calibration. No real host was available in this environment.
- **Host baseline vector sharing**: the host Persona/character/lorebook baseline collection is still
  chat-scoped with a purge-then-rebuild path. The plugin-owned Setting Index already provides the
  world/revision-shared, embedding-profile-separated index the proposal asks for; making the host
  fallback shared needs collection-GC safety work and is left for a dedicated change.
- **Retired Setting vector collection GC**: intentionally retained for safety.

---

## 5. Verification commands

```bash
npm run check   # 18/18 node --check
npm test        # 33/33 test scripts
```

If the system `npm` launcher is missing, run the same commands from `package.json` directly with
`node`, as done here.
