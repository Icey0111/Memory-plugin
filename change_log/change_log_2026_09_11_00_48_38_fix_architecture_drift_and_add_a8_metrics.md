# fix_architecture_drift_and_add_a8_metrics

- Date: 2026-09-11 00:48:38
- Session: Audit the repository against the memory system's own core function, fix every deviation found, and add the A8 quality metrics that phase P4 was gated on.

## Problem / Requirement

The plan's phase P4 is gated on "causal QA accuracy must not fall", but no such metric existed, and an
audit of the whole codebase (see [dev_docs\06_architecture_drift.md L1-L124](file:///D:/memory_plugin/dev_docs\06_architecture_drift.md#L1-L124)) found five places
where the implementation had drifted from the memory system's core function:

1. memory and the setting (world-info) plane had grown a **loop** in both directions;
2. the current-state block is a **wider baseline** than the mandatory set, which made the S7 contrast
   impossible to construct;
3. the archived original text lived in the memory store as if it were memory;
4. the model-initiated `【查阅记忆】` lookup is a tool call in text clothing;
5. the measurement slot was occupied by cost metering, not by quality.

## Purpose of Change

Make the memory system measurable and honest about its own boundary: every implicit coupling becomes a
named, observable switch; every non-memory component is either proven optional by an offline
assertion or explicitly declared substrate; and the four metrics the plan asks for actually exist.

## How It Was Changed

- [index.js L146-L185](file:///D:/memory_plugin/index.js#L146-L185) — three new settings: `setting_baseline_veto_enabled` and `setting_query_seed_from_memories` (the two directions of the setting<->memory coupling, both defaulting to the historical behaviour) and `current_state_scope` (`mandatory+broad` default, `mandatory-only` for the experiment).
- [index.js L1915-L1945](file:///D:/memory_plugin/index.js#L1915-L1945) — `retrieveGenerationSettings` / `retrieveExtractionSettings` stop seeding the setting query from memories when the switch is off, and record `lastSettingSeedDebug` so the choice is observable rather than inferred.
- [index.js L1960-L1985](file:///D:/memory_plugin/index.js#L1960-L1985) — `createPluginBaselineDeduper` returns `reason: 'setting-veto-disabled'` when the world-info plane is not allowed to veto a memory write.
- [index.js L2470-L2530](file:///D:/memory_plugin/index.js#L2470-L2530) — `buildInjectedContextBundle` resolves the scope through `resolveCurrentStateScope` and reports `current_state_scope` / `broad_active_count` in diagnostics.
- [index.js L1128-L1136](file:///D:/memory_plugin/index.js#L1128-L1136) — the cold snapshot is documented as an evidence cache, not memory.
- [index.js L3305-L3360](file:///D:/memory_plugin/index.js#L3305-L3360) — `resolveCurrentStateScope`, `getQualityReport` and their test exports.
- [index.js L41-L41](file:///D:/memory_plugin/index.js#L41-L41) — import of the new quality module.
- [v55-quality-metrics.js L1-L180](file:///D:/memory_plugin/v55-quality-metrics.js#L1-L180) — new. A8's four metrics, pure and offline: key retention, causal recall (canonical), causal recall (injected), and the compression curve.
- [context-assembler.js L419-L425](file:///D:/memory_plugin/context-assembler.js#L419-L425) — expose `buildCurrentStateBlock` for testing.
- [v55-evidence.js L10-L22](file:///D:/memory_plugin/v55-evidence.js#L10-L22) — state that the cold snapshot and the lookup protocol are optional and never read by canonical memory.
- [settings.html L95-L105](file:///D:/memory_plugin/settings.html#L95-L105) and [settings.html L150-L156](file:///D:/memory_plugin/settings.html#L150-L156) — UI for the three new switches.
- [index.js L3040-L3065](file:///D:/memory_plugin/index.js#L3040-L3065) — bindings for them.
- [test-v55-quality-metrics.mjs L1-L80](file:///D:/memory_plugin/test-v55-quality-metrics.mjs#L1-L80) — new test for the four metrics.
- [test-v55-drift-switches.mjs L1-L113](file:///D:/memory_plugin/test-v55-drift-switches.mjs#L1-L113) — new test for the switches, plus dependency-direction assertions: `memory-core.js` must never mention `cold_turns`, `scene_summaries`, `查阅记忆` or `setting-`, and must import exactly one module.
- [package.json L1-L30](file:///D:/memory_plugin/package.json#L1-L30) — the new module and the two new tests registered in `npm run check`.
- [dev_docs\06_architecture_drift.md L1-L124](file:///D:/memory_plugin/dev_docs\06_architecture_drift.md#L1-L124) — the audit itself: test used, census, findings, dispositions, and what was deliberately left alone.
- [dev_docs\header.md L36-L36](file:///D:/memory_plugin/dev_docs\header.md#L36-L36) — index entry for the new document.

## Result

- `npm run check` passes and the suite is **63/63 in 18.3 s** (up from 61).
- The setting<->memory loop can now be broken by two switches, and both directions report what they did.
- The current-state baseline is a named policy, so S7 can be run as "with mandatory vs without mandatory".
- A8's four metrics exist and are computed from the store alone, with no model call. `causal_recall`
  is documented as a lower bound on T-Causal, and the gap to `causal_injected` is the injection-ratio
  number A5 needed.
- Follow-ups: the legacy prompt key is still cleared on every publish (migration residue, not drift);
  and whether the two new switches should default to off is a product decision, not an architecture one.
