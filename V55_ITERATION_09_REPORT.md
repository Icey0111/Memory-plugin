# Aetheria Unified Memory v5.5-dev — Iteration 09 Change Report

Date: 2026-09-10  
Base: `v5.5-dev-iteration08` / `13d44a933db80231d2e571b76cfc81b20490cb73`  
Target: `v5.5-dev-iteration09` / package `5.5.0-dev.9`

Scope: make dense retrieval/model switching provider-neutral and move embedding-specific semantics out of Canonical Memory logic.

## Architecture implemented

### Embedding Space Profile

`embedding-profile.js` separates representation-space identity from retrieval policy.

- provider/model/endpoint/family/role transforms/dimension+normalization hints -> `space_fingerprint`
- calibrated thresholds + Setting multi-view RRF -> `retrieval_policy_fingerprint`
- model-space changes require derived-vector rebuild
- threshold/RRF changes do not
- E5 query/passage prefixes are supported in auto mode
- Jina deliberately remains symmetric through the current ST vLLM bridge because provider-native `task` forwarding is not guaranteed

### Aetheria-owned vector policy

`v55-vector-policy.js` wraps the mature Iteration 08 private transport and applies the profile policy only to Aetheria `/api/vector/*` requests. Iteration 08 continues to own private OpenAI-compatible endpoint isolation.

- inserted text receives the document transform
- query text receives the query transform
- private physical collections are additionally namespaced by embedding-space fingerprint
- Memory/Setting/Baseline can use profile-calibrated query thresholds
- Canonical Memory is never deleted on model changes
- pre-profile derived vectors are invalidated once because they lack the new representation-space identity

### Multi-view Setting dense retrieval

Labelled Setting queries can independently retrieve focus, assistant context, entity/location context and active-state/objective views, then combine rankings through weighted RRF. Failure falls back to the mature single-query path.

### Provider-neutral evaluation primitives

`retrieval-eval.js` adds Recall@K, Precision@K, MRR, hit rate, minimum-recall threshold calibration and candidate-vs-baseline metric deltas. Threshold tuning therefore lives in evaluation/profile policy rather than Canonical Memory semantics.

## UI

`v55-embedding-profile-ui.js` adds an **Embedding Space Profile** panel beside the existing Summary API/private Embedding API controls.

Space controls: family, query/document role strategy, prefixes, dimension hint and normalization hint. Retrieval-only controls: Memory/Setting/Baseline dense threshold overrides, Setting multi-view fusion and RRF K.

The UI exposes both fingerprints and diagnostics. Space-field changes trigger safe derived-index invalidation; retrieval-only changes do not.

## Tests added

- `test-embedding-profile.mjs`
- `test-retrieval-eval.mjs`
- `test-v55-vector-policy.mjs`

The new modules were syntax-checked and their focused tests passed before commit. The repository test script is extended so these tests become part of normal `npm test` execution.

## Invariants retained

- Canonical Memory / extraction transactions remain authoritative.
- Current State remains separate from historical recall.
- Setting Store remains world/revision scoped and separate from story history.
- Lexical fallback remains usable when dense retrieval is unavailable.
- No request rewrite touches non-Aetheria vector collections.
- No API secret enters embedding fingerprints or Canonical Memory.

## Deliberate boundaries

This iteration does not claim real-browser SillyTavern acceptance, native Jina `task` forwarding, a universal Cross-Encoder rerank transport, or automatic Gold-dataset generation. Those boundaries are explicit in `RETRIEVAL_ARCHITECTURE_2026.md` instead of being hidden behind model-specific assumptions.
