# Aetheria Unified Memory v5.4 — Test Plan

## Automated

### Existing regression
- memory op parser/schema
- add/update/close/supersede/reinforce/invalidate/noop
- slot lifecycle
- branch replay
- evidence gate
- hybrid lexical/dense/entity bypass
- graph diffusion
- MMR-like diversity
- query variants
- dynamic budget
- v5.3 autonomous extraction transaction behavior

### v5.4 baseline pure core
- deterministic chunk/fingerprint
- baseline source change alters fingerprint
- exact duplicate blocked
- semantic paraphrase + topic/entity anchor blocked
- knowledge acquisition preserved
- world_delta/change preserved
- temporary active state preserved

### host source collection
- Persona collected
- character description/personality/scenario collected
- embedded character book collected
- Persona/character/chat bound books loaded
- current activated World Info included
- unrelated account lorebook names NOT enumerated
- group context does not crash and resolves known members best-effort

### integration
- real baseline hint reaches quiet extractor
- rejected operation never reaches Canonical Store
- event and knowledge survive gate
- transaction/debug records rejection
- baseline vector collection rebuilds
- semantic vector query can reject paraphrase
- provider fingerprint change rebuilds baseline projection
- Persona source change rebuilds baseline projection

## Real SillyTavern acceptance still required

1. Persona switching.
2. Character switching.
3. Character-bound lorebook.
4. Persona-bound lorebook.
5. Chat lore.
6. Global constant + keyword/selective World Info.
7. Group chat.
8. Streaming and non-streaming generation.
9. Regenerate/swipe/edit/delete while extraction is queued.
10. Local Transformers vector source.
11. At least one remote embedding provider.
12. 1k / 10k memory stress and latency measurements.
13. False-positive Baseline gate adversarial cases:
    - baseline likes plants vs story buys a plant;
    - baseline owns house vs story returns home;
    - baseline pet contract vs contract renegotiation;
    - world fact X vs character newly learns X.

## v5.5 development Iteration 01 additions

- `test-depth-normalization.mjs`: verifies legal injection depth `0` is preserved and invalid/negative values fall back.
- `test-setting-store.mjs`: verifies Setting Store schema v1, CRUD, immutable revision semantics, extension/base compatibility, migration, serialization and cascade rules.
- `test-setting-store-host.mjs`: verifies setting library persistence uses global extension settings and survives chat changes without leaking into chat metadata.

## v5.5 development Iteration 02 additions

### Import adapter / commit tests
- `test-setting-importer.mjs`
  - Worldbook JSON known-field normalization.
  - Original `uid`, keys, secondary keys, constant/disabled/order preservation.
  - Unknown entry fields preserved in `raw_extra`.
  - Exact raw JSON text retained by SourceRecord.
  - Source + entry content hashes are deterministic and non-empty.
  - Preview does not mutate the store.
  - Commit creates World -> Source -> Revision -> Entries.
  - Baseline activation pointer is set only on commit.
  - Identical source detection uses content hash, not filename.
  - Duplicate commit rejects by default.
  - Explicit `reuse_source` creates a new revision without cloning the identical source.
  - H1/H2 TXT segmentation.
  - Text before first heading is preserved as preamble.
  - Untitled TXT remains one entry and is not heuristically fragmented.

- `test-setting-importer-host.mjs`
  - Preview + commit can be executed through the extension host boundary.
  - Persistent Setting Store remains under extension settings.
  - Imported world data does not enter per-chat Canonical Memory metadata.

### External real-sample acceptance (not bundled)
- `艾瑟瑞亚_世界书_v5_势力深化与区域强权扩展版.json`
  - 41 source entries -> 41 imported entries.
  - 2 constant entries retained.
  - 0 disabled entries retained as expected.
  - no adapter warning.
  - first/last entry ids, title/comment/content/keys/order retained.
  - unknown SillyTavern World Info fields survive in `raw_extra`.
  - committed store passes schema validation.

### Still required in later v5.5 iterations
- Shared SettingChunk build/index by world + revision.
- Tail-entry lexical retrieval.
- Dense/lexical Setting retrieval and fallback.
- Extractor relevant-setting retrieval.
- Dual extension-prompt injection.
- Incremental entry-level index update and safe collection switch.


## v5.5 development Iteration 03 additions

### Setting Index pure tests
- `test-setting-index.mjs`
  - Active scope resolves baseline first and only compatible active extensions.
  - Disabled entries never enter the active Setting Index.
  - Long SettingEntry content splits into multiple SettingChunks.
  - Every child chunk retains parent `entry_id`, `revision_id`, title and keywords.
  - World/revision scope changes alter both fingerprint and shared collection id.
  - Tail-entry lexical query ranks the answer-bearing child chunk first rather than flattening all child chunks by repeated parent keys.
  - Extension-only query retrieves the active extension entry.

### Host/shared-vector tests
- `test-setting-index-host.mjs`
  - First chat builds a world/revision-scoped Setting Vector collection.
  - A second chat with the same extension Setting Store reuses the same collection id and does not rebuild it.
  - Setting Index state remains in global extension settings rather than chat metadata.
  - Unsupported client embedding provider does not attempt server vector calls and local lexical retrieval remains available.

### External real-sample acceptance (not bundled)
- 41 imported entries -> 91 SettingChunks at `maxChars=420`.
- 91/91 unique chunk/vector hashes in the acceptance run.
- Query `新增一个未定义地区和地方组织` ranks `uid=27 世界扩展规则｜新地区与新组织生成` first.
- Query about police reading a user's full A-network panel ranks `uid=21 法律、治安、犯罪与证据` first.
- Query about strong individuals making ordinary armies meaningless ranks `uid=26 战争、军队与战略平衡` first.

### Still required in later v5.5 iterations
- Commit E: generation/extractor query construction and dense+lexical relevant-setting merge.
- Commit F: unified context assembler and dual prompt injection.
- Commit G: per-entry vector diff, staging/safe collection switch and no-purge-window lifecycle.
- Commit H: real SillyTavern final-request acceptance across normal/continue/regenerate/group/quiet and providers.

## v5.5 development Iteration 04 additions

### Relevant Setting retrieval pure tests
- `test-setting-retriever.mjs`
  - Generation Query includes last user message, small previous-assistant context, active scene/location entities and unresolved commitments/objectives.
  - Extraction Query includes current user+assistant pair plus active state slots/entities.
  - Lexical + dense SettingChunk candidates fuse by RRF without mixing with story-memory candidates.
  - Child hits deduplicate to parent SettingEntry results and expand back to parent content.
  - Parent entries with many weak matching chunks do not win simply by accumulating chunk count.
  - Constant entries are exposed through a separate bounded reserve channel.
  - SettingChunks can be projected to baseline records for full active-setting write-time dedup.

### Runtime / extractor integration
- `test-setting-retrieval-host.mjs`
  - Real generation interceptor executes Setting retrieval on the current dialogue query.
  - Generation Setting retrieval result is available for the main Context Assembler; Iteration 05 now verifies final Reference injection.
  - Lexical-only mode remains fully functional with no vector network call.
  - Quiet extractor receives the relevant imported plugin setting plus a bounded constant/core reserve.
  - An unrelated non-constant setting is not dumped into the extractor prompt.
  - Static plugin-setting restatement is rejected by the hard write gate even with an empty Host Baseline.
  - `knowledge` acquisition about the same baseline fact is preserved.
  - Extraction transaction records active setting scope/fingerprint and relevant setting ids.

- `test-setting-retrieval-vector-host.mjs`
  - Setting Vector collection is built under world/revision scope.
  - Runtime dense query maps SillyTavern vector metadata back to SettingChunks.
  - Dense + lexical candidates fuse to the expected parent entry.
  - Chat id never appears in the Setting collection identity.

### External real-sample acceptance (not bundled)
- 41-entry Aetheria v5 worldbook still imports 41 entries and builds 91 SettingChunks (`2 constant / 0 disabled`).
- Generation Query `新地区 + 新地方组织 + 生成边界` -> rank 1 `uid=27 世界扩展规则｜新地区与新组织生成`.
- Generation Query `警察 + A网络 + 全部面板` -> rank 1 `uid=21 法律、治安、犯罪与证据`.
- Generation Query `战争 + 顶尖强者 + 普通军队` -> rank 1 `uid=26 战争、军队与战略平衡`.
- Extraction-style privacy query returns multiple relevant A-network/privacy/legal entries rather than depending on file order.

### Still required in later v5.5 iterations
- Commit G: per-entry vector diff, staging/safe collection switch and no-purge-window lifecycle.
- Commit H: real SillyTavern final-request acceptance across normal/continue/regenerate/group/quiet and multiple providers.


## v5.5 development Iteration 05 additions

### Context Assembler pure tests
- `test-context-assembler.mjs`
  - Reference Block contains relevant/constant setting data and historical memory, but not current-state data.
  - Current State Block contains Canonical active state/slots, but not historical memory or world-setting body.
  - Imported XML-like source markup is escaped and instruction-like source wording is explicitly demoted to data.
  - `settingIds`, `memoryIds`, `droppedIds`, token estimate and per-class budget diagnostics are emitted.
  - Tight Reference caps are enforced without unbounded constant residency.

### Dual prompt / lifecycle tests
- `test-index-mock.mjs`
  - Reference key is injected at default System depth 4.
  - Current State key is injected at default System depth 1.
  - Current state does not leak into Reference.
  - interceptor leaves the real chat array byte-for-byte/structurally unchanged.
  - quiet clears Reference, Current State and the legacy single-block key.

- `test-context-injection-lifecycle.mjs`
  - normal / continue / regenerate / group use the same two-key path.
  - quiet / impersonate / disabled plugin clear all prompt keys.
  - legal `current_state_injection_depth = 0` remains `0`.

### Runtime Setting-to-Reference integration
- `test-setting-retrieval-host.mjs` now verifies the retrieved tail Setting enters the main-model Reference Block while unrelated non-constant Setting remains absent.
- Existing plugin baseline dedup and knowledge-acquisition exception continue to pass in the same runtime fixture.

### External real-sample acceptance (not bundled)
- 41-entry Aetheria v5 worldbook -> 91 SettingChunks (`2 constant / 0 disabled`).
- Query about creating an undefined region/new local organization ranks `uid=27 世界扩展规则｜新地区与新组织生成` first.
- The assembled Reference Block contains that tail rule and a synthetic historical memory, while excluding synthetic current location state.
- The Current State Block contains the synthetic current location and excludes the historical memory.

### Still required
- Commit G: incremental per-entry Setting Vector diff, safe collection staging/switch, no purge window, embedding-profile lifecycle.
- Commit H: inspect real SillyTavern final requests for normal/continue/regenerate/group/quiet, short history, chat switch, disable, and multiple providers/System handling.

## v5.5 development Iteration 06 additions

### Pure Setting lifecycle tests
- `test-setting-index-lifecycle.mjs`
  - Entry manifest preserves per-entry chunk/vector ownership.
  - one changed Entry is detected as `changed`, not as a whole-index rebuild;
  - added / removed / unchanged Entries are classified independently;
  - targeted insert set contains only added/changed Entry chunks;
  - old hashes for changed/removed Entries are exposed for targeted deletion;
  - physical collection identities differ across embedding profiles and safe-build generations.

### Host lifecycle / no-purge-window tests
- `test-setting-index-lifecycle-host.mjs`
  - state schema migrates to v2;
  - legacy v1 collections without embedding-profile identity are retained for diagnostics but not trusted as active;
  - initial/forced full build occurs in an inactive staging collection and is sample-query verified;
  - one Entry content change performs targeted insert + delete with **no active collection purge**;
  - embedding model/profile change builds a new staging collection and switches only after verification;
  - previous active collection remains intact and is recorded as retired;
  - failed replacement verification leaves the old active pointer and old vectors untouched, while returning `vector_degraded=true` / lexical fallback.

### External real-sample acceptance (not bundled)
- 41-entry Aetheria v5 worldbook still imports as 41 Entries / 91 chunks / 2 constant / 0 disabled.
- Entry manifest reports 41 Entries / 91 chunks.
- tail-rule generation query still ranks `uid=27 世界扩展规则｜新地区与新组织生成` first.
- modifying only the imported `uid=27` Entry in a same-scope test snapshot yields exactly one `changed` manifest Entry, no added/removed Entries, and targeted old hash deletion.

### Still required
- Commit H: inspect real SillyTavern final requests for normal/continue/regenerate/group/quiet, short history, chat switch, disable, and multiple providers/System handling.
- Real provider calibration of sample verification behavior and dense thresholds.
