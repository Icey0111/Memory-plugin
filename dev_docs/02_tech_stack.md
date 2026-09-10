# Tech Stack

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

> Languages, frameworks, libraries, tooling and rationale.


<!-- VERSION 2 -->
## v2 - 2026-09-11 00:22:37 - record the v5.5 technology choices

### Runtime

| Choice | Rationale |
| --- | --- |
| Plain ESM JavaScript | SillyTavern loads third-party extensions as-is; there is no build step, no bundler and no transpile target to keep in sync |
| Zero runtime dependencies | The extension must survive the host's version of everything; every dependency is a way to break on someone else's machine |
| `window.SillyTavern.getContext()` | The only supported host surface; no private internals are touched |
| `window.__TAURITAVERN__.api.extension.store` | Optional host ABI for the derived store, backend name `tauritavern-extension-store`; IndexedDB is the fallback when the host offers nothing |
| `setExtensionPrompt` | Prompt injection without inserting pseudo-messages into the real chat array |

### Storage

- Authoritative state lives in chat metadata under `aetheriaUnifiedMemoryV54` and therefore travels
  with the chat file.
- Derived state lives in the host extension store, namespace `aetheria-unified-memory-v55`, table
  `derived`, record version 1, addressed by a `derived_store` pointer; writes are debounced (900 ms).
- Vectors are hosted by whichever embedding backend the user configured, behind a per-chat space
  identity so two chats can never read each other's vectors.

### Token accounting

`v55-tokenizer.js` uses a fitted model, version `fit-126-v1`, rather than a character heuristic:

    tokens ~= 0.9408 * cjkChars + 0.2441 * otherChars      R^2 = 0.9989, MAPE = 1.1%

Word segmentation uses `Intl.Segmenter` (ICU) so n-grams reflect real word boundaries; the n-gram
set is the recall floor when no embedding backend is available.

### Tooling and CI

| Item | Detail |
| --- | --- |
| Syntax gate | `npm run check` runs `node --check` over an explicit file list, so a new module must be registered deliberately |
| Test runner | `npm test` -> `run-tests.mjs`, one child process per `test-*.mjs`, file-backed stdio (confined environments refuse pipes, and a runner that cannot capture output cannot report a failure) |
| Node version | 20 (matches CI) |
| CI | `.github/workflows/iteration10-ci.yml` runs check + full suite on the `v5.5-dev-iteration10..13` branches and on pull requests into `main` |

### Deliberate non-choices

No TypeScript, no framework, no vector database service, no network call at load time, and no
generated code committed to the repository.
