# Architecture Drift

> What in this codebase does not serve the memory system's own core function, and what was done
> about it. Added in iteration 14 after auditing the whole repository against the plan's own
> invariants.

## 1. The test used

Core function, taken from [04_roadmap.md](04_roadmap.md) section 1: turn dialogue that already
happened into reliable, addressable, logically ordered long-term memory, and inject it within a
budget.

    ingest (dialogue) -> decide & represent -> retain & compress -> recall & inject

A module belongs to the core when its input is the transcript (or state derived from it) and its
output changes what memory holds. Two questions decide every case:

1. Is its input "what already happened", or is it a plan, a static document, or another subsystem's
   artifact?
2. Can canonical memory be correct when this module is absent?

## 2. Census

About 14,100 lines of JavaScript, excluding HTML and CSS.

| Layer | Lines | Share | Examples |
| --- | --- | --- | --- |
| Memory core | ~6,820 | 48% | memory-core 1290, v55-finalizer 738, v55-runtime 510, v55-derived-store 485, context-assembler 424, v55-floor-fold 349, v55-spine 309, v55-consistency 240, v55-summary-runtime 213, v55-evidence 208, memory-extractor 172, v55-tokenizer 170, baseline-* 413 |
| `index.js` (mixed) | 3,276 | 23% | one file; by keyword: setting 515, vector 444, memory 352, UI 46 |
| Setting (world-info) plane | 1,988 | 14% | setting-retriever 448, setting-index 404, setting-schema 315, setting-store 295, setting-importer 295, source-adapters 231 |
| Vector / platform / credentials | 1,598 | 11% | v55-private-vector-transport 415, v55-api-connections 335, embedding-profile 290, v55-tauri-vector-backend 220, v55-vector-policy 191, v55-tauri-native-http-bridge 147 |
| Presentation | ~345 | 3% | v55-ui-polish 327, v55-embedding-profile-ui 18 |

## 3. Findings

### 3.1 A loop between the setting plane and memory (behavioural — fixed)

Two couplings had grown in opposite directions:

    memory (active memories) --seed--> setting retrieval query
    setting chunks --baseline records--> memory admission gate (a veto)

Evidence: `setting-retriever.js` (`collectActiveEntities`, `activeLocations`,
`activeObjectives`, `activeSlots`) built the world-info query out of active memories, and
`index.js createPluginBaselineDeduper` turned setting chunks into baseline records that could
reject a memory write.

Why it mattered: it made "measure the memory channel alone" impossible, and it made memory's
correctness depend on a document-retrieval product's output.

Fixed: `setting_baseline_veto_enabled` and `setting_query_seed_from_memories`, both defaulting to
the historical behaviour, both observable (`__testGetLastSettingSeedDebug`, and the deduper returns
`reason: 'setting-veto-disabled'` rather than looking like a near-miss).

### 3.2 The current-state block is a wider baseline than the mandatory set (behavioural — fixed)

`buildInjectedContextBundle` unions the mandatory set with `getActiveMemories(...)`
(`max_active_items`, default 12; 18 on the extraction path), and
`context-assembler.js buildCurrentStateBlock` renders all of them — mandatory rows first, then every
group. So S4's "mandatory baseline" was never the only unconditional channel.

Consequence: the S7 contrast as originally written ("mandatory baseline vs recall pool") had no
second arm, because the broad set is present in both.

Fixed: `current_state_scope` = `mandatory+broad` (default) or `mandatory-only`, resolved by the
exported `resolveCurrentStateScope`, surfaced in diagnostics as `current_state_scope` and
`broad_active_count`. The S7 experiment is now constructible as "with mandatory vs without
mandatory", since the broad set is present in both arms.

### 3.3 The archived original text lived in the memory store (attribution — resolved)

`v55-evidence.js` snapshots each extracted turn (`DEFAULT_COLD_MAX_CHARS = 200000`) so an edit or
delete cannot destroy the only copy. That is data protection, not memory.

Resolved by definition rather than by moving code: it is an **evidence cache**. `memory-core.js`
does not import the module and never reads `cold_turns`, and the test suite now asserts exactly that.
The `cold_turn_snapshot_enabled` switch already existed and is the proof it is not load-bearing.

### 3.4 The model-initiated lookup is a tool call wearing a text protocol (boundary — resolved)

`【查阅记忆】` lets the model ask for original wording, which the host resolves. That is the shape
the plan's constraint 1 forbids as a dependency and permits as a supplement.

Resolved by the same dependency assertion: canonical memory must never read the protocol, so it can
only ever be a supplement. `memory_evidence_enabled` turns it off.

### 3.5 The measurement slot was occupied by cost, not quality (gap — fixed)

`v55-metrics.js` meters background model calls and estimated tokens — an operations view. None of
plan section 3 A8's four metrics existed, which is why phase P4's gate ("causal QA accuracy must not
fall") could not be evaluated at all.

Fixed: `v55-quality-metrics.js` implements all four, offline and pure:

| Metric | Definition |
| --- | --- |
| `key_retention` | how much of the never-drop set survived the rendered block |
| `causal_recall` | spine-generated probes answerable from canonical memory |
| `causal_injected` | the same probes answerable from what actually reached the prompt |
| `compression` | resident memory tokens / raw dialogue tokens, per floor count |

Honesty note recorded in the module: `causal_recall` is a **lower bound** on the plan's T-Causal. It
proves the answer is still present in memory, not that a reader would use it. The gap between
`causal_recall` and `causal_injected` is the actionable number for injection ratio (A5): facts that
exist in memory but never reached the model.

## 4. Deliberately NOT treated as drift

| Component | Why it stays |
| --- | --- |
| `baseline-*` | It decides whether an operation merely restates persona/card/world info. That is memory admission, i.e. core |
| `v55-privacy` | Role-private visibility is memory's epistemic boundary, and it serves I1 |
| `v55-floor-fold` | Replacing raw floors with the summary that covers them *is* the compression mechanism |
| `v55-derived-store`, `v55-store-integrity` | Storage substrate for the core, with a documented ownership rule |
| Tauri transport modules | Necessary substrate: the host exposes no generic HTTP POST ABI, so embedding requests travel through the chat-completion command's query suffix. Not memory, but not optional either |

## 5. Still open

- The legacy prompt channel `aetheria_unified_memory_v5_4` is still cleared on every publish
  (`index.js`). It is migration residue, not drift, and removing the clear call would leave stale
  text in old installs.
- 11% of the codebase is platform compatibility. That is a real cost with no memory content.
- Whether the two new switches should eventually default to "off" (a memory-only product) is a
  product decision, not an architecture one.
