# Aetheria Unified Memory v5.5-dev — Iteration 02 Report

Date: 2026-09-09  
Runtime identity: **v5.4 remains unchanged intentionally**  
Implemented scope: **Commit C — Import Adapters + Preview**

## 1. What changed

Iteration 02 turns the Setting Store foundation from Iteration 01 into a user-facing import pipeline.

New modules:

- `setting-importer.js`
- `source-adapters/worldbook-json.js`
- `source-adapters/titled-text.js`
- `test-setting-importer.mjs`
- `test-setting-importer-host.mjs`

Updated:

- `index.js`
- `settings.html`
- `style.css`
- `package.json`
- `README.md`
- `CHANGELOG.md`
- `TEST_PLAN.md`

## 2. Two-phase import contract

The import path is now explicitly split:

```text
File / text / JSON object
        ↓
previewImport(...)
        ↓
parse + normalize + hash + warnings
        ↓
NO persistent mutation
        ↓
user confirms world/revision options
        ↓
commitImport(...)
        ↓
Source -> Revision -> Entries -> optional activation
```

`previewImport()` never writes extension settings. `commitImport()` only writes after the caller explicitly chooses the world and revision semantics.

## 3. Worldbook JSON adapter

The first JSON adapter targets the SillyTavern World Info structure verified in the project sample:

```json
{
  "entries": {
    "0": { "uid": 0, "comment": "...", "content": "..." }
  }
}
```

Preserved normalized fields:

- original `uid` / `id` as `source_entry_id`;
- `comment`;
- title, preferring an explicit title and then the first Markdown heading;
- `content`;
- `key` / `keys`;
- `keysecondary` / `secondary_keys`;
- `constant`;
- `disable` / `disabled` / `enabled=false`;
- `order`.

Every unrecognized per-entry field is retained in `raw_extra`. The complete original source text is retained in `SourceRecord.raw_payload`, so top-level and entry-level source material is not destructively normalized away.

Imported prompt-like fields remain data. The adapter does not execute or elevate any imported field into plugin control logic.

## 4. TXT / Markdown adapter

The text adapter intentionally uses a conservative policy:

- H1 (`#`) and H2 (`##`) headings create sections;
- text before the first heading is preserved as a separate preamble entry;
- if no H1/H2 heading exists, the whole file becomes one entry;
- it does not guess paragraph/topic boundaries and fragment untitled prose.

This matches the design goal that uncertain TXT segmentation should prefer fidelity over aggressive automatic splitting.

## 5. Hash and duplicate policy

Source content receives a deterministic content hash:

- SHA-256 when `crypto.subtle` is available;
- deterministic local fallback only if the host cannot provide SHA-256.

Entry hashes include retrieval-relevant normalized fields, not only body text, so future per-entry index diffing can detect changes to keys, title, flags or other preserved semantics.

Duplicate handling is explicit:

- default commit policy: reject an identical source already present in the target world;
- `reuse_source`: reuse the existing identical Source and create a new immutable Revision only after explicit confirmation;
- `copy_source`: available at API level when an intentional duplicate Source record is desired.

The filename is not used as the duplicate identity.

## 6. Settings UI

The extension settings page now contains a **Plugin Setting Store / Import Preview** section:

1. choose JSON/TXT/Markdown file;
2. click `预览导入`;
3. inspect format, entry count, constant/disabled count, content hash, warnings and a short title sample;
4. choose existing world or create a new world;
5. choose revision label and baseline/extension type;
6. extension imports must explicitly select a baseline revision;
7. choose whether to activate after commit;
8. click `确认写入设定库`.

A separate `导出 Setting Store` button exports the plugin-owned store for inspection/backup.

The status line reports the active plugin world and active, non-disabled entry count. It deliberately labels those entries as **stored, not yet retrieval-indexed** so the UI does not imply that Commit D/E already exists.

## 7. Validation against the real 41-entry Aetheria v5 sample

Development validation used the project Library sample:

`艾瑟瑞亚_世界书_v5_势力深化与区域强权扩展版.json`

Observed and successfully imported:

- source entries: **41**;
- parsed entries: **41**;
- `constant=true`: **2**;
- disabled entries: **0**;
- no adapter warnings;
- first and final entries both retained original `uid`, title/comment/content/keys/order;
- SillyTavern-specific unknown fields such as `selectiveLogic`, `probability`, `displayIndex`, recursion flags etc. remained in `raw_extra`;
- Source/Revision/Entry store validation passed after commit.

The real worldbook is not bundled into the plugin package; it was used as an external acceptance fixture only.

## 8. Automated tests

Added tests cover:

- Worldbook JSON preview;
- known field normalization;
- unknown field preservation;
- exact source payload preservation;
- SHA-256/fallback hash presence;
- commit into a new world;
- active baseline pointer;
- duplicate detection;
- duplicate rejection by default;
- explicit identical-source reuse for a new revision;
- H1/H2 TXT segmentation;
- preamble preservation;
- no-heading TXT stays a single entry;
- persistence through SillyTavern extension settings host boundary.

The full existing v5.4 + Iteration 01 test suite remains green.

## 9. Deliberate non-goals for this iteration

Iteration 02 does **not** yet:

- replace `baseline-host.js` as the generation baseline source;
- build a shared Setting vector/lexical index;
- retrieve relevant imported settings for generation;
- feed relevant imported settings to the autonomous extractor;
- split long setting entries into structured chunks;
- perform dual prompt injection;
- rename the runtime namespace to V55.

Those are Commit D/E/F responsibilities. The imported Setting Store is now a durable source of truth, but it is intentionally not yet wired into prompt generation.

## 10. Next implementation target

Iteration 03 should implement **Commit D — Setting Index**:

- derive `SettingChunk` records from active revisions;
- index scope by `world_id + revision_id(s)` rather than chat id;
- retain `entry_id` parent links;
- create lexical retrieval as the guaranteed fallback;
- allow a first full build before incremental diffing;
- do not purge the existing v5.4 host Baseline implementation until the plugin-owned path is proven.
