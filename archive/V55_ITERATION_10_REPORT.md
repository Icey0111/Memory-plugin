# Aetheria Unified Memory v5.5 — Iteration 10 integration closure

Base audited revision: `v5.5-dev-iteration09@ee859c1e32898ed4bcbac4979485a9af083a9707`.

Iteration 10 is an integration-hardening pass. It keeps the Canonical/derived architecture and makes the newer v5.5 modules obey shared state ownership, privacy, generation lifecycle, prompt-budget, embedding-space, and failure rules.

## Closed audit findings

1. **Canonical replay no longer erases module-owned chat state.** `v55-store-integrity.js` guards the chat metadata slot before the staged core runs. Canonical-owned fields may be replaced by replay; omitted module-owned fields such as `setting_binding`, `entity_registry`, and `hierarchical_summaries` are preserved. Rebuildable scene/consistency derivatives are invalidated.
2. **Private knowledge is filtered before derived scene text exists.** `v55-privacy.js` applies `known_by` / `known_by_ids` to extraction operations and rebuilds mixed transaction summaries from visible operations only. Scene locators/evidence use the sanitized transaction view. Hierarchical visibility propagates recursively through source IDs.
3. **Hierarchical summaries share the normal generation lifecycle and budget.** The standalone summary prompt is always empty. The consistency layer pulls visible summary context into Reference before the single `budgetPromptPair` pass. `enabled=false`, plugin-owned quiet generations, impersonation, and injection depth `0` are enforced consistently. Background summary generation checks the global switch before every model batch.
4. **Memory and Baseline indexes carry per-chat embedding-space identity.** Policy v3 stores/validates `space_fingerprint` per built index. `CHAT_CHANGED` compares the selected chat's own metadata even when another chat has already updated the global settings signature. A built legacy index with no per-index fingerprint is not trusted.
5. **Independent embedding credential choice is no longer silently ignored.** Requests include the selected `secret_id`. Because current SillyTavern release does not forward that ID through its vLLM vector adapter, Iteration 10 uses a serialized Secret Store rotate/request/restore bridge for Aetheria insert/query calls. Missing or invalid selected credentials fail closed instead of using the host default key; transport identity includes the selected credential ID.
6. **Vector policy failures never resend the raw request.** Multi-view retrieval may fall back only to the same transformed single query. Aetheria policy/transport failures are surfaced to the index lifecycle; the original collection/text representation is never retried.
7. **Regression coverage follows the real manifest entrypoint.** The full-stack lifecycle test imports `index-v55-bootstrap.js`. The stale frontend contract now checks the dynamic `aum-v55-${kind}-...` generator. New regressions cover replay ownership, derived privacy, summary lifecycle/depth, private vector identity, and multi-chat space invalidation. CI runs syntax checks and the full Node test chain.

## Host compatibility note

SillyTavern `release` exposes multi-secret IDs and rotation, and its generic additional-header helper can consume `secret_id`, but `src/vectors/vllm-vectors.js` does not pass a secret ID into that helper. Therefore an extension cannot currently implement purely request-local VLLM vector credential selection. The serialized rotate/request/restore bridge is fail-closed for Aetheria's own requests, but unrelated host VLLM requests launched concurrently during that short rotation window are outside the extension's isolation boundary. If SillyTavern later forwards vector `secret_id`, the request field already provides a direct migration path.

## Release position

Iteration 10 closes the audited code-level integration defects and makes their regressions executable. It does not claim real-browser/SillyTavern end-to-end acceptance until the branch is exercised against the installed SillyTavern build and real embedding providers.
