# Aetheria Unified Memory v5.5 — Iteration 11 TauriTavern vector closure

Base: `v5.5-dev-iteration10@f238790c81ced64df3cfb63e4815410a521a92cb`.

## Root cause

The remaining Jina failure was not a Jina endpoint/model error. Native TauriTavern currently registers `/api/vector/list|insert|delete|query|query-multi|purge|purge-all` as compatibility routes and deliberately returns HTTP 501 with `cause=vector_endpoint_unavailable` for all of them. Iteration 10 still used SillyTavern's `/api/vector` contract for storage/query after configuring an independent embedding provider, therefore any real TauriTavern probe necessarily failed before Jina could be meaningfully validated.

## Iteration 11 design

### TauriTavern

Aetheria now owns its **derived vector backend** when `window.__TAURITAVERN__` is present:

- provider call: direct OpenAI-compatible `/embeddings` request;
- Jina role semantics: `retrieval.passage` for inserted documents and `retrieval.query` for queries;
- vector representation: Float32 base64 plus cached norm;
- similarity: cosine ranking;
- persistence: documented `window.__TAURITAVERN__.api.extension.store` JSON storage;
- supported compatibility operations: `insert`, `query`, `list`, `delete`, `purge`;
- response shape remains compatible with the SillyTavern vector endpoint used by the existing Aetheria core.

Canonical memories are **not** moved into this store. Only rebuildable derived vectors are persisted.

### SillyTavern

The existing server `/api/vector` path and selected-secret rotation bridge remain unchanged. The Tauri path is chosen only when the Tauri Host ABI is detected.

## Secret boundary

TauriTavern's Secret Store normally masks keys and refuses `/api/secrets/find` plaintext access unless `allow_keys_exposure` is enabled. Iteration 11 does not weaken that policy.

When the user enters a vector API key in Aetheria on TauriTavern, the compatibility adapter:

1. stores it through `/api/secrets/write` as `api_key_vllm`;
2. keeps the plaintext only in an in-memory session cache keyed by the returned secret id;
3. clears the password input;
4. uses the session copy only for direct embedding requests.

After a full application restart, if plaintext secret exposure remains disabled, the user may need to re-enter the API key once before the first direct embedding request. The key is never persisted inside the Aetheria vector collection.

## Probe behavior

The existing UI still probes via the logical `/api/vector/insert` + `/query` contract, but in TauriTavern the Aetheria fetch layers intercept those requests before they reach the native host route. A successful probe therefore validates all of the following together:

- direct provider embedding request;
- Jina query/document task distinction;
- plugin-owned vector persistence;
- cosine retrieval;
- collection cleanup.

If direct provider access fails, the UI now reports the actual provider HTTP/network/CORS error rather than TauriTavern's unrelated `vector_endpoint_unavailable` 501.

## Regression coverage

`test-v55-tauri-vector-backend.mjs` validates Float32 encoding, cosine similarity, Jina task payloads, insert/query/list/delete/purge behavior, extension-store persistence, and that the backend never calls `/api/vector` while executing provider traffic.
