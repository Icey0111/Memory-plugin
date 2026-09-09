# Aetheria Unified Memory v5.5-dev — Iteration 04 Report

Date: 2026-09-09  
Runtime identity: **v5.4 remains unchanged intentionally**  
Implemented scope: **Commit E — Relevant Setting Retrieval**

## 1. Iteration goal

Iteration 04 connects the plugin-owned Setting Index from Iteration 03 to real dialogue-dependent retrieval without yet performing the final main-model context rewrite reserved for Commit F.

The implemented path is now:

```text
Plugin Setting Store
    ↓
active world + active baseline + compatible extensions
    ↓
SettingChunk Index
    ↓
Generation Query / Extraction Query
    ↓
Lexical candidates + optional Dense candidates
    ↓
RRF + parent-entry expansion + entry dedup
    ↓
Relevant SettingEntry results
    ├─ generation path: retrieved + diagnosed, not yet main-model injected
    ├─ extraction path: relevant settings enter quiet extractor prompt
    └─ write gate: full active Setting scope can reject baseline restatements
```

This preserves the architecture rule that **world setting retrieval and story-memory retrieval are separate channels**. Imported world settings are never inserted into the per-chat episodic memory vector collection.

## 2. New module: `setting-retriever.js`

A new host-agnostic module implements the Commit E retrieval core.

Exports include:

- `buildGenerationSettingQuery()`
- `buildExtractionSettingQuery()`
- `mapDenseSettingMetadata()`
- `fuseSettingCandidates()`
- `formatRelevantSettingContext()`
- `settingChunksToBaselineRecords()`

The module performs no SillyTavern network I/O and does not depend on browser globals.

## 3. Generation Query

Generation retrieval no longer depends on only the last user sentence.

The query builder combines bounded views of:

```text
last user message
+ previous assistant message
+ current scene entities
+ active location
+ unresolved commitments / objectives
+ current-state hint
```

Current-scene additions come from the Canonical Store's active memories rather than from Setting data itself.

This is intentionally different from the story-memory query pipeline. The resulting query is sent only to the plugin Setting Index.

## 4. Extraction Query

The background extractor uses a separate query shape:

```text
current user message
+ current assistant reply
+ affected/current entities
+ active state slots
+ current-state hint
```

The pair itself receives the largest text budget. Active slots/entities only provide disambiguation and continuity.

This avoids the previous design where the extractor was given a fixed prefix of the host baseline and had to hope that the relevant world rule happened to be near the beginning.

## 5. Lexical + Dense Setting retrieval

The runtime retrieval pipeline in `index.js` now:

1. resolves/ensures the active Setting Index;
2. always runs local lexical SettingChunk retrieval;
3. optionally queries the shared Setting Vector collection when available;
4. maps SillyTavern vector metadata back to SettingChunks;
5. fuses lexical and dense ranks with RRF;
6. deduplicates child chunks to parent SettingEntries;
7. expands a matched child back to parent-entry content;
8. applies a rough per-retrieval entry/character cap;
9. exposes constant settings separately as a bounded reserve channel.

If vector search is disabled, unsupported or stale, the path remains fully usable through local lexical retrieval.

## 6. Important RRF correction: no large-entry size bias

During real-sample acceptance an entry with several weakly matching child chunks could outrank a much more relevant short entry simply because the parent accumulated many child RRF scores.

That behavior was corrected.

Parent score now uses:

```text
best child
+ 0.25 × second-best child
+ 0.10 × third-best child
```

Additional weak children do not keep increasing the parent score.

This keeps parent expansion useful without rewarding long entries merely for being long.

## 7. Constant-setting policy

`constant=true` no longer means “append every child chunk unconditionally”.

The retriever exposes constants through:

```text
constant_entries[]
```

The caller chooses a bounded reserve count. The extractor currently defaults to two constant entries maximum.

This prepares Commit F for the proposed critical/constant budget reserve without creating an unbounded prompt prefix.

## 8. Autonomous extractor integration

The quiet extractor now receives:

```text
current dialogue pair
+ Canonical current state
+ relevant plugin Setting entries
+ bounded relevant/core Host Baseline
```

The old fixed `baseline_hint_chars = 12000` prefix is no longer the preferred extraction input path.

For Host Persona/Character data, a small core reserve is still included because identity facts can remain important even when lexical overlap with the current pair is weak. Additional Host Baseline records are chosen by current extraction-query relevance.

The prompt explicitly labels plugin settings as reference data and states that objective world truth does **not** imply character knowledge.

## 9. Plugin-owned Baseline dedup interface

Commit E adds the runtime equivalent of:

```text
baselineDeduper.findPossibleMatches(candidateOperation)
```

The active plugin Setting scope is projected to baseline records for the write gate.

For each eligible operation:

1. the existing Host Baseline gate is checked;
2. if not blocked, the plugin Setting Baseline is checked;
3. lexical duplicate matching is always available;
4. semantic matching uses the shared Setting Vector collection when ready;
5. only after both gates pass can the operation enter Canonical Memory.

This means a user can run with **no SillyTavern World Info binding** and the plugin-owned imported baseline can still prevent static world facts from being stored as story memories.

## 10. Knowledge boundary preserved

The existing baseline-gate exemptions remain unchanged:

- `event`
- `knowledge`
- `belief`
- `intention`
- `world_delta`
- explicit change semantics
- clearly dynamic current-state slots

Therefore:

```text
baseline fact: X is objectively true
story event: character now learns X
```

still produces a valid `knowledge` memory even though X already exists in the plugin Setting baseline.

The new integration test verifies this directly.

## 11. Main generation path boundary

The real `generationInterceptor` now executes Relevant Setting retrieval on every normal main-generation path.

However, the returned Setting entries are **not yet inserted into the main-model extension prompt**.

This is deliberate.

Commit F remains responsible for replacing the current one-block prompt with:

```text
Reference Block
  relevant settings
  + historical memory
  → IN_CHAT / System / depth 4

Current State Block
  structured effective state only
  → IN_CHAT / System / depth 1
```

Iteration 04 tests explicitly verify that generation retrieval runs while imported Setting text is still absent from the current main-model prompt.

## 12. Retrieval diagnostics and settings UI

The Setting section now exposes Commit E controls for:

- enable/disable relevant Setting retrieval;
- enable/disable dense Setting retrieval;
- candidate Top-K;
- final SettingEntry count;
- dense threshold;
- RRF K;
- rough generation Setting budget;
- extractor Setting budget;
- constant reserve count.

Diagnostics now include a `[SettingRetrieval]` block with:

- query mode;
- world/scope;
- query components;
- lexical candidate count;
- dense availability/reason;
- dense candidate count;
- selected SettingEntry ids/titles/revisions/channels;
- matched child ids;
- dropped entry ids.

Large retrieved content is not persisted into extension settings as diagnostics.

## 13. Automated tests added

### `test-setting-retriever.mjs`

Covers:

- generation query composition;
- extraction query composition;
- active location/entity/objective inclusion;
- lexical + dense metadata fusion;
- RRF;
- child-to-parent dedup/expansion;
- constant reserve channel;
- full active-setting baseline projection.

### `test-setting-retrieval-host.mjs`

Covers:

- generation retrieval through the host boundary;
- real interceptor execution of Setting retrieval;
- no premature main-model Setting injection before Commit F;
- lexical-only fallback with zero vector calls;
- relevant Setting insertion into quiet extractor prompt;
- unrelated Setting omission;
- plugin-owned hard baseline duplicate rejection with empty Host Baseline;
- `knowledge` exception preservation;
- transaction/debug recording of Setting scope and relevant entry ids.

### `test-setting-retrieval-vector-host.mjs`

Covers:

- shared Setting vector collection build;
- real mock `/api/vector/query` call for Setting retrieval;
- metadata → SettingChunk mapping;
- dense + lexical fusion;
- world/revision collection identity independent of chat id.

The extractor prompt unit test was also updated for the new relevant Setting / Host Baseline sections.

## 14. Real 41-entry Aetheria v5 acceptance

External fixture:

`艾瑟瑞亚_世界书_v5_势力深化与区域强权扩展版.json`

The fixture is not bundled in the plugin archive.

Observed again with `maxChars=420`:

```text
imported SettingEntry: 41
SettingChunk:          91
constant:               2
disabled:               0
```

Generation-query lexical acceptance:

1. `新地区 + 新地方组织 + 生成边界`
   - rank 1: `uid=27 世界扩展规则｜新地区与新组织生成`

2. `警察 + A网络 + 全部面板`
   - rank 1: `uid=21 法律、治安、犯罪与证据`

3. `战争 + 顶尖强者 + 普通军队`
   - rank 1: `uid=26 战争、军队与战略平衡`

An extraction-style privacy query returns several relevant A-network/privacy/legal entries. This is expected because extraction context can legitimately require both low-level A-network rules and legal procedure rules; Commit F will own the final cross-channel prompt budget, not force one parent entry to monopolize context.

## 15. Regression status

Final automated status after Iteration 04:

```text
npm run check  PASS
npm test       PASS
```

`package.json` now runs:

- **12 syntax-check commands**;
- **19 test scripts**.

The existing memory-core suite remains **29/29 PASS**.

All previous v5.4 and v5.5-dev A-D regression tests remain green, including:

- Canonical Memory replay;
- autonomous extraction;
- memory vector recall;
- Host Semantic Baseline lexical/vector gate;
- depth=0;
- Setting Store;
- import preview/commit;
- shared Setting Index;
- lexical fallback;
- cross-chat Setting index reuse.

## 16. Deliberate non-goals

Iteration 04 does **not** yet:

- replace the current single main-model memory prompt;
- inject Setting + history as the final depth-4 reference block;
- inject structured current state at depth 1;
- implement the unified Context Assembler budget;
- perform per-entry vector diff updates;
- implement staging + atomic index collection switch;
- claim real SillyTavern final-request acceptance;
- claim multi-provider live System-role/depth behavior.

## 17. Next implementation step

The next iteration is **Commit F — Context Assembler + Dual Injection**.

Primary tasks:

1. add `context-assembler.js`;
2. consume the already-computed generation Setting results;
3. consume existing historical memory recall separately;
4. budget critical/constant settings, relevant settings and historical memory;
5. generate a clearly labeled reference block at System depth 4;
6. generate a current-state-only block at System depth 1;
7. use two extension-prompt keys;
8. clear both keys on quiet/impersonate/disable/chat switch;
9. add diagnostics for selected/dropped Setting and memory ids;
10. keep real chat rows untouched.

Commit G incremental vector lifecycle and Commit H real SillyTavern final-request acceptance remain after that.

## 19. Architecture document update

`ARCHITECTURE.md` now records the staged v5.5 world-setting plane, the distinct generation/extraction query shapes, the plugin-owned Baseline write-gate semantics, and the deliberate Commit F/G/H boundary.
