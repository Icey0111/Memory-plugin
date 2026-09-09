# Aetheria Unified Memory v5.5-dev — Iteration 03 Report

Date: 2026-09-09  
Runtime identity: **v5.4 remains unchanged intentionally**  
Implemented scope: **Commit D — Setting Index**

## 1. Iteration goal

Iteration 03 connects the plugin-owned Setting Store from Iteration 02 to a real, rebuildable retrieval index, without yet changing generation prompt contents.

The implementation target is deliberately narrower than Commit E/F:

```text
Imported Source / Revision / Entry
        ↓
active world + active baseline + compatible active extensions
        ↓
SettingChunk projection
        ├─ local lexical index (always available)
        └─ optional shared Vector Storage projection
```

The existing v5.4 Host Semantic Baseline remains in place for current write-time baseline deduplication. Plugin-owned imported settings are now indexed, but are not yet automatically injected into generation or autonomous extraction.

## 2. New module: `setting-index.js`

The new host-agnostic module provides:

- `resolveActiveSettingScope()`
- `buildSettingChunks()`
- `buildSettingIndexSnapshot()`
- `computeSettingIndexFingerprint()`
- `getSettingCollectionId()`
- `buildSettingVectorItems()`
- `scoreSettingChunk()`
- `lexicalSearchSettingChunks()`
- `summarizeSettingSnapshot()`

No SillyTavern globals or network access are used inside this module.

## 3. World/revision scope replaces chat scope

Plugin Setting Index identity is derived from:

```text
world_id
+ active baseline revision_id
+ compatible active extension revision_ids
```

The Vector Storage collection is therefore named like:

```text
aetheria_v55_setting_<world+revision-scope-hash>
```

It does **not** contain a chat id.

Consequences:

- two chats using the same active plugin world/revision set share the same setting collection;
- chat switching does not require rebuilding the same world index;
- changing active baseline/extension revisions produces a different collection id;
- per-chat Canonical Memory remains unchanged and chat-local.

This is the first code-level separation between **shared world knowledge** and **branch/chat-local story memory** in the v5.5 runtime path.

## 4. Structured SettingChunk projection

Each active, non-disabled `SettingEntry` is projected into one or more chunks.

Every child chunk retains:

- `world_id`
- `revision_id`
- `revision_kind`
- `source_id`
- parent `entry_id`
- original `source_entry_id`
- parent `content_hash`
- title
- comment
- primary keys
- secondary keys
- constant flag
- source order
- chunk index
- body text
- retrieval text
- lexical tokens
- deterministic chunk/vector hash

Long entries are split using the existing conservative sentence/paragraph chunking behavior. Parent title and keywords are repeated into each child's retrieval view so a late child can still be found from entry-level terminology.

Disabled entries are excluded from the active index but remain preserved in the Setting Store.

## 5. Lexical fallback is a first-class path

Local lexical Setting retrieval is always available and does not depend on embedding.

Ranking combines:

- body lexical similarity;
- retrieval-view lexical similarity;
- exact primary-key match;
- secondary-key match;
- title/comment match;
- a very small constant-entry tie boost.

A specific correction was made during this iteration: repeated parent keywords must not flatten all child chunks to the same near-perfect score. Body relevance remains the main discriminator, so a query about a detail near the end of a long entry can rank the answer-bearing child above earlier children of the same parent.

## 6. Shared vector projection

`index.js` now has `ensurePluginSettingIndex()`.

When the configured SillyTavern Vector Storage provider is supported:

1. build the active Setting Index snapshot;
2. compare scope/fingerprint/provider state;
3. build vector items from SettingChunks;
4. full-build the target world/revision collection;
5. persist only derived index metadata under global extension settings.

The persisted derived state is:

```text
extensionSettings.aetheriaUnifiedMemoryV54.setting_index_state
```

It is **not** written into `chatMetadata`.

If the embedding provider is unavailable, unsupported, disabled or fails, the vector projection becomes unavailable/stale while local lexical Setting retrieval remains usable.

Re-enabling the vector projection after lexical-only mode correctly forces a rebuild instead of incorrectly treating the old disabled state as synchronized.

## 7. Full-build policy and Commit G boundary

Commit D intentionally allows a full build of a target immutable scope collection.

Revision switching is already safer than the old per-chat baseline design because another active revision set has a different collection id, so constructing a new scope does not purge the old scope's collection.

However, this iteration does **not** claim the final Commit G lifecycle:

- no per-entry vector diff yet;
- no staging collection + atomic pointer switch yet;
- a forced rebuild of the *same* scope may still purge/reinsert that target collection.

Those remain Commit G responsibilities.

## 8. Settings UI changes

The Setting Store section now also exposes Plugin Setting Index controls:

- enable/disable Setting vector projection;
- automatic rebuild on scope/provider changes;
- Setting chunk size;
- manual `构建 / 重建设定索引` button.

Status now distinguishes:

- active world;
- active entry count;
- SettingChunk count;
- lexical readiness;
- vector synchronized / disabled / unavailable / stale state.

Diagnostics include a `[SettingIndex]` block with scope, revisions, collection id, fingerprint, counts and derived state.

The UI explicitly states that Commit D builds the index but does not yet inject retrieved settings into generation.

## 9. Automated tests added

### `test-setting-index.mjs`

Covers:

- active baseline + extension scope ordering;
- disabled-entry exclusion;
- structured long-entry chunking;
- parent/revision linkage on every child;
- repeated title/keywords in child retrieval views;
- scope fingerprint and collection id change when active revisions change;
- tail-entry lexical retrieval;
- body-specific child ranking;
- active extension retrieval.

### `test-setting-index-host.mjs`

Covers:

- first chat builds a shared world/revision vector collection;
- second chat with a different chat id reuses the same collection without rebuilding;
- Setting Index state persists globally in extension settings;
- no Setting Index state leaks into chat metadata;
- lexical retrieval works through the host boundary;
- vector-disabled mode remains lexical-ready;
- re-enabling vector mode rebuilds correctly;
- unsupported client embedding source performs no server-vector request and keeps lexical retrieval available.

## 10. Real 41-entry Aetheria v5 acceptance

External acceptance fixture:

`艾瑟瑞亚_世界书_v5_势力深化与区域强权扩展版.json`

The fixture is **not bundled** with the plugin package.

Observed with the default `maxChars=420`:

- imported entries: **41**;
- generated SettingChunks: **91**;
- unique vector hashes: **91 / 91**;
- active collection uses world/revision scope rather than chat id.

Natural-language lexical checks:

1. `剧情要新增一个未定义地区和地方组织，应该遵守哪些世界扩展规则？`
   - rank 1: `uid=27 世界扩展规则｜新地区与新组织生成`

2. `A网络能不能让警察随便读取一个人的全部面板？`
   - rank 1: `uid=21 法律、治安、犯罪与证据`

3. `战争中顶尖强者是不是可以让普通军队完全失去意义？`
   - rank 1: `uid=26 战争、军队与战略平衡`

This directly verifies the main Commit D acceptance concern: material near the end of a large imported worldbook can participate in retrieval instead of being excluded by a fixed prefix budget.

## 11. Regression status

Full suite after Iteration 03:

- memory core: **29/29 PASS**;
- autonomous extractor: PASS;
- v5.4 baseline pure core: PASS;
- depth=0 normalization: PASS;
- Setting Store: PASS;
- Setting Store host persistence: PASS;
- Import adapters: PASS;
- Import host persistence: PASS;
- Setting Index pure tests: PASS;
- Setting Index shared-host tests: PASS;
- interceptor mock: PASS;
- vector/hybrid recall mock: PASS;
- migration fallback: PASS;
- autonomous extraction integration: PASS;
- hard baseline gate: PASS;
- semantic baseline vector gate: PASS.

`npm run check` includes the new `setting-index.js` syntax check.

## 12. Deliberate non-goals

Iteration 03 does **not** yet:

- query the Setting Index from `generationInterceptor`;
- merge dense + lexical Setting candidates;
- send relevant imported settings to `memory-extractor.js`;
- replace the fixed host baseline hint in extraction;
- inject plugin Setting references into the main model context;
- split reference/current-state prompts into depth 4 + depth 1;
- implement incremental per-entry vector updates;
- rename runtime/settings/module identity from v5.4 to v5.5;
- claim real SillyTavern/browser/provider end-to-end acceptance.

## 13. Next target

Iteration 04 should implement **Commit E — Relevant Setting Retrieval**:

```text
current dialogue / extractor pair
        ↓
setting query construction
        ↓
Lexical Setting candidates
        +
Dense Setting candidates (when available)
        ↓
merge / dedupe / parent-aware diversity
        ↓
relevant SettingEntry/SettingChunk references
```

The key acceptance tests should include:

- tail worldbook rules recalled from current dialogue;
- lexical-only fallback when vector is unavailable;
- old inactive revision never returned;
- active extension participates only with its bound baseline;
- constant/core rules receive reserved handling without flooding the context;
- retrieval does not imply character knowledge.

Only after Commit E is stable should Commit F wire the result into the dual-prompt Context Assembler.
