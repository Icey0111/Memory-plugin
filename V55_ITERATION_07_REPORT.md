# Aetheria Unified Memory v5.5-dev — Iteration 07 Report

Date: 2026-09-09  
Base branch/commit: `v5.5-dev-iteration06` / `d1559d6bdd9a21c33bf0d86e764670ccb73d0488`  
Target branch: `v5.5-dev-iteration07`  
Package identity: `5.5.0-dev.7`  
Legacy runtime/settings namespace: intentionally retained for migration compatibility pending live SillyTavern acceptance.

## 1. Iteration goal

Iteration 07 is an architectural closure pass against `CENTRALIZED_MEMORY_PROPOSAL.md`. It does not replace the mature v5.4 autonomous transaction/replay/vector implementation. Instead it adds explicit v5.5 boundaries around that runtime so the plugin can satisfy the missing identity, authority, budgeting, visibility and product-management requirements without destabilizing Commits A–G.

The staged stack is now:

```text
index.js (mature extraction / replay / memory vector / setting retrieval)
    ↓
v55-runtime.js
    chat Setting binding
    stable entity ids
    Canonical Current State authority
    combined prompt budget
    ↓
v55-finalizer.js
    immutable Setting Entry overlays
    scene-summary derivation
    private plot-knowledge filtering
    untitled TXT segmentation preview
    Setting Entry editor UI
    ↓
v55-consistency.js
    re-acquire normalized chat metadata after legacy runtime
    rebuild scenes from current extraction transactions
    re-apply knowledge filter + final combined budget
    ↓
v55-provenance.js
    preserve first-observed branch ownership
    track shared ancestry through seen_on_branches
```

`index-v55.js` installs this wrapper stack once, with an idempotent module-level guard.

## 2. Chat → World / Revision binding

A chat now stores an explicit `setting_binding` in chat metadata:

```text
world_id
baseline_revision_id
extension_revision_ids[]
pinned
updated_at
```

The global Setting Store remains the shared library/default. Established chats resolve their own pinned binding rather than relying on the current global active pointer.

A settings-page `v5.5 Chat Setting Binding` UI allows the current chat to pin:

- one World;
- one Baseline revision;
- zero or more compatible Extension revisions.

Extension/base compatibility is validated before the binding is accepted.

## 3. Runtime identity and Entity Registry

The current chat derives:

```text
world_id
chat_id
branch_id
```

A chat-local `entity_registry` maps aliases to stable `entity_id` records. Host character identity uses a SillyTavern character discriminator when available, and user identity uses a separate host-user discriminator. Memory rows receive derived:

```text
entity_ids[]
known_by_ids[]
world_id
chat_id
branch_id
```

This removes display-name-only identity as the only structural key while preserving the original text aliases for retrieval/display compatibility.

## 4. Branch provenance

Iteration 07 distinguishes:

- current branch identity;
- transaction/memory origin branch;
- branches on which an inherited record is still visible.

`v55-provenance.js` keeps a `provenance_registry`:

```text
memories[id] {
  origin_branch_id
  seen_on_branches[]
  world_id
  chat_id
}

transactions[transaction_id] {
  source_key
  origin_branch_id
  seen_on_branches[]
  world_id
  chat_id
}
```

If the compatibility layer recomputes and temporarily overwrites a record with the current branch id, the provenance pass restores the first-observed origin and adds the current branch only to `seen_on_branches`.

This avoids pretending that an inherited pre-fork transaction was created independently on every swipe/regenerate branch.

## 5. Canonical Current State authority

Free-text extractor `active_state` is no longer treated as the final injected authority in the v5.5 wrapper path.

Before main generation, `v55-runtime.js` deterministically derives Current State from active structured Canonical Memory rows. The old free-text state is kept only as diagnostic material:

```text
last_active_state_diagnostic
last_active_state = derived Canonical state
last_active_state_source = canonical-memory
current_state_authority = structured-memory-v55
```

Closed/superseded/invalid rows cannot re-enter the current state simply because an old free-text summary still mentions them.

## 6. Knowledge visibility

Iteration 07 adds a structural filter for private plot memory.

For `knowledge` and `belief` memories with a non-empty `known_by` / `known_by_ids`, the final generation context checks the active character identity. If the active role is not in that knowledge set, exact matching memory records are removed from both:

- Reference history memory records;
- Current State memory lines.

This creates an actual role-knowledge barrier for extracted plot memory rather than relying only on a prose warning.

Important scope boundary: imported Setting entries are still objective world-reference data unless a future source schema/overlay explicitly marks an entry as role-private. Iteration 07 does **not** infer secret visibility from ordinary worldbook prose or filenames.

## 7. Scene Summary lifecycle

Scene summaries are derived only from extraction transactions. They never summarize previous scene summaries.

Each scene stores at least:

```text
scene_id
world_id
chat_id
branch_id
source_transaction_ids[]
source_keys[]
start_message
end_message
location
actors[]
outcome
open_items[]
fingerprint
```

Scene boundaries are created conservatively by:

- location changes;
- branch changes;
- transaction-count caps.

The final generation path selects a small number of relevant scenes from the latest dialogue query. They enter Reference as:

```text
[SCENE SUMMARY LOCATORS — DERIVED, REBUILDABLE, NOT A SOURCE OF NEW FACTS]
```

The block explicitly identifies source transaction ids. Source edits/regeneration naturally change the extraction transaction set; scenes are rebuilt from that set rather than incrementally rewriting themselves.

## 8. Unified Reference + Current State budget

Iteration 05 originally bounded Reference and Current State independently. Iteration 07 adds a final combined cap based on:

```text
host context size
- reply reserve tokens
```

The current implementation uses the existing conservative mixed Chinese/Latin approximation of about two characters per token for this host guard.

Budget pressure priority is:

```text
Current State first
Reference / history second
```

After private-knowledge filtering and Scene Summary insertion, `v55-consistency.js` applies the combined budget again against the final prompt pair. Diagnostics store:

```text
combined_cap_chars
combined_used_chars
reference_chars
current_state_chars
reply_reserve_tokens
```

## 9. Setting Entry editing without destroying imported revisions

Imported Source/Revision data remains the durable raw library. Iteration 07 does not mutate raw imported files in place.

The new Setting Entry editor writes `setting_entry_overrides` keyed by:

```text
world_id::revision_id::entry_id
```

An overlay may replace:

- title;
- content;
- primary/secondary keys;
- constant;
- disabled;
- order.

At runtime a cloned active Setting Store receives the overlay. The entry keeps the same `entry_id` and revision scope but receives a derived override content hash. Therefore Commit G sees a normal same-scope per-entry manifest change and can use its existing targeted vector insert/verify/delete lifecycle instead of a full Setting collection rebuild.

Clearing the overlay immediately falls back to the immutable imported Entry.

## 10. Constant/core Setting reserve

Iteration 07 removes the accidental assumption that every world has exactly two constant entries.

During a generation, if the active scope contains more constant entries than the configured reserve, the wrapper temporarily raises the reserve up to the active constant count (capped at 20), then restores the user setting after the request.

This keeps constant/core semantics data-driven while still preventing unbounded residency.

## 11. Untitled TXT preview

The conservative import adapter remains unchanged: a TXT/Markdown file without H1/H2 headings is still imported as one Entry by default, so heuristics cannot silently fragment user-authored material.

Iteration 07 adds a UI-only segmentation preview for such files:

- paragraph candidates when blank-line paragraphs exist;
- sentence candidates otherwise;
- candidate count, character count and short preview.

The preview explicitly states that import remains one Entry until the user adds explicit headings. This satisfies the requirement for an untitled-TXT segmentation preview without making an unsafe automatic split decision.

## 12. Post-runtime consistency boundary

The old runtime normalizes/replays chat metadata by replacing the metadata object. A wrapper that captures the pre-call object can therefore become stale.

`v55-consistency.js` intentionally waits until the inner runtime returns, then re-reads:

```text
ctx.chatMetadata[aetheriaUnifiedMemoryV54]
```

from the host and performs final:

- runtime identity stamping;
- provenance stabilization;
- scene rebuild;
- private-knowledge filtering;
- scene insertion;
- combined budget enforcement.

This ensures v5.5-derived state is written to the current normalized object rather than an obsolete reference.

## 13. Wrapper installation safety

`index-v55.js` previously retried installation several times. Without a stack-level guard, an already wrapped interceptor could be mistaken for a new legacy interceptor and wrapped repeatedly.

Iteration 07 now has one module-level `stackInstalled` guard. Retries are used only until both SillyTavern context and the original interceptor exist. Once installed, all later retry callbacks return immediately.

## 14. Tests added

The package test list now includes **27** test scripts in total. New Iteration 07 scripts are:

### `test-v55-runtime.mjs`

Covers:

- chat binding validation;
- world/revision projection without mutating the source store;
- branch-id change across swipe/regeneration;
- Canonical State excludes closed old state;
- `known_by_ids` is retained in canonical state representation;
- combined Reference+Current State budget.

### `test-v55-finalizer.mjs`

Covers:

- same-scope Setting Entry overlay without mutating imported data;
- unrelated world remains untouched;
- location-based Scene Summary boundaries;
- scene source transaction ids;
- scene-summary retrieval/insertion;
- private knowledge removed for the wrong character and retained for the correct character;
- untitled TXT candidate segmentation preview.

### `test-v55-provenance.mjs`

Covers:

- first-observed memory/transaction branch ownership;
- later current-branch overwrite is restored to origin;
- `seen_on_branches` records inherited visibility;
- a newly created transaction on a later branch receives that later branch as origin.

### `test-v55-consistency.mjs`

Covers the exact stale-object hazard:

- inner compatibility runtime replaces chat metadata during generation;
- final v5.5 pass uses the replacement object;
- role-private knowledge is filtered;
- Scene Summary is written to the current object and reaches Reference;
- final pair obeys combined host budget;
- provenance registry is created on the current object.

`npm run check` also includes all four v5.5 wrapper modules.

## 15. Validation status in this ChatGPT iteration

The new tests and syntax-check commands are committed into `package.json`.

However, this ChatGPT execution environment could not clone/download the GitHub working tree into its local Node container: the execution container had no GitHub DNS/network access, and the raw-file download fallback was unavailable. Therefore this report does **not** claim that the newly added Iteration 07 tests were executed locally in this conversation.

The pre-Iteration-07 test status remains the verified Iteration 06 result (`npm run check` PASS / `npm test` PASS). Iteration 07 requires one external run of:

```bash
npm run check
npm test
```

before tagging/releasing it as a tested package.

## 16. Architectural status against the proposal

```text
Setting library / versioned import                         IMPLEMENTED
World-vs-plot separation                                  IMPLEMENTED
Chat -> World/Revision binding                            IMPLEMENTED (I07)
Stable entity ids / alias registry                        IMPLEMENTED (I07, chat-local registry)
Branch provenance fields                                  IMPLEMENTED (I07 compatibility registry)
Structured Current State as generation authority          IMPLEMENTED (I07 wrapper path)
Setting vs plot retrieval separation                      IMPLEMENTED
Relevant extraction Setting retrieval                     IMPLEMENTED
Structure-aware Setting chunking                          IMPLEMENTED
Per-Entry incremental vector lifecycle                    IMPLEMENTED
Embedding-profile safe staging/switch                     IMPLEMENTED
Scene Summary as rebuildable transaction locator          IMPLEMENTED (I07)
Private plot knowledge role boundary                      IMPLEMENTED (I07)
Unified final Reference + Current State budget            IMPLEMENTED (I07)
Setting revision selection per chat                       IMPLEMENTED (I07 UI)
Entry edit path reaching same-scope incremental diff      IMPLEMENTED (I07 overlay UI)
Untitled TXT segmentation preview                         IMPLEMENTED (I07 preview only)
Lexical fallback without embedding                        IMPLEMENTED
Real SillyTavern final-request/provider acceptance        EXTERNAL LIVE ACCEPTANCE REQUIRED
Automatic retired Setting vector collection GC           DEFERRED BY DESIGN
Role-private imported Setting schema                      NOT INFERRED / FUTURE EXPLICIT SCHEMA
```

## 17. Remaining acceptance boundary

The architecture/code closure is complete enough to move to live acceptance rather than another design iteration.

The remaining Commit H work is observational host verification, not another memory architecture rewrite. It must inspect actual SillyTavern outgoing requests for:

- normal generation;
- Continue;
- swipe/regenerate;
- group chat;
- very short histories;
- quiet extraction;
- chat switching;
- plugin disable;
- System-message depth placement;
- at least one local and one remote embedding/provider path;
- final combined token budget;
- duplicate prompt prevention;
- Setting Entry overlay causing a one-entry vector diff in a real host.

Until those checks and the newly extended Node suite pass, keep the package labelled `v5.5-dev`, not a final v5.5 release.
