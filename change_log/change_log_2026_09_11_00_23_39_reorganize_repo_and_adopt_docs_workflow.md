# reorganize_repo_and_adopt_docs_workflow

- Date: 2026-09-11 00:23:39
- Session: Finishing the local-file reorganization - archive the leftover clone logs, adopt the dev_docs / change_log / remove documentation workflow, and move the v5.5 plan document out of the plugin root.

## Problem / Requirement

The previous session moved every non-current file into `remove/` and pushed the current revision
(`cb7c24a`), but three items were left open:

1. The installed TauriTavern copy of the extension still carried 15 leftover `suite*.log` scratch
   files from earlier test runs.
2. The v5.5 plan document `MEMORY_PLAN_2026.md` sat in the plugin root among the runtime modules,
   and the repository had no defined home for design or planning material.
3. There was no per-session record of why a change was made, and no defined place for
   pre-destruction backups - `remove/` had been used as a flat archive with no conventions.

## Purpose of Change

Give each kind of writing exactly one home - design in `dev_docs/`, change history in
`change_log/`, pre-destruction backups in `remove/` - and move the plan document out of the plugin
root without invalidating the release inventory that `PACKAGE_MANIFEST.json` describes.

## How It Was Changed

- [dev_docs/header.md L1-L72](file:///D:/memory_plugin/dev_docs/header.md#L1-L72) - new. Folder conventions: English, one topic per file, numbered reading order, append-only in-file versioning.
- [dev_docs/00_overview.md L1-L62](file:///D:/memory_plugin/dev_docs/00_overview.md#L1-L62) - new. Problem, goals (never forget the irreversible / keep the detail / keep the memory logic), scope, non-goals, stakeholders.
- [dev_docs/01_architecture.md L1-L98](file:///D:/memory_plugin/dev_docs/01_architecture.md#L1-L98) - new. The four kinds of data, the load-order-critical entry chain, the module map, the write pipeline and the injection path as Mermaid diagrams.
- [dev_docs/02_tech_stack.md L1-L55](file:///D:/memory_plugin/dev_docs/02_tech_stack.md#L1-L55) - new. Plain ESM with no build step and no dependencies, the host store ABI, the fitted token model `fit-126-v1`, the explicit `node --check` gate and the file-stdio test runner.
- [dev_docs/03_data_model.md L1-L89](file:///D:/memory_plugin/dev_docs/03_data_model.md#L1-L89) - new. Canonical vs derived stores, the canonical field table, the full `DERIVED_KEYS` list, the metadata-guard ownership rules, the spine record shape and the invariants.
- [dev_docs/04_roadmap.md L1-L49](file:///D:/memory_plugin/dev_docs/04_roadmap.md#L1-L49) - new. Points at the plan document, records the S/A/B status and the risks that are still open.
- [dev_docs/05_worktree.md L1-L63](file:///D:/memory_plugin/dev_docs/05_worktree.md#L1-L63) - new. The canonical directory tree, the role of each top-level part, and why the root documents stay at the root.
- [dev_docs/MEMORY_PLAN_2026.md L1-L230](file:///D:/memory_plugin/dev_docs/MEMORY_PLAN_2026.md#L1-L230) - moved from the plugin root with `git mv`, content unchanged. Kept in Chinese because it is the shared working document with the maintainer; that is the one exception to the English rule in `dev_docs/header.md`.
- [change_log/header.md L1-L90](file:///D:/memory_plugin/change_log/header.md#L1-L90) - new. One file per session, append-only, four required sections, editor-aware jump links.
- [remove/header.md L1-L81](file:///D:/memory_plugin/remove/header.md#L1-L81) - new. Backup-before-destruction rules, plus a project note recording that the pre-existing flat archive content is frozen as-is.
- [remove/remove_2026_09_11_00_21_26_installed_clone_suite_logs/manifest.md L1-L16](file:///D:/memory_plugin/remove/remove_2026_09_11_00_21_26_installed_clone_suite_logs/manifest.md#L1-L16) - new backup entry: the 15 `suite*.log` files from the installed clone, archived before deletion.
- [remove/remove_2026_09_11_00_22_13_relocating_the_v5_5_plan_document_out_of_the_plugin_root_into_dev_docs_per_the_project_docs_workflow/manifest.md L1-L14](file:///D:/memory_plugin/remove/remove_2026_09_11_00_22_13_relocating_the_v5_5_plan_document_out_of_the_plugin_root_into_dev_docs_per_the_project_docs_workflow/manifest.md#L1-L14) - new backup entry: `MEMORY_PLAN_2026.md` snapshotted before it was moved out of the root.

Two actions happened outside the repository: the 15 `suite*.log` files were deleted from
`C:\Users\20436\scoop\persist\TauriTavern\data\extensions\third-party\Memory-plugin`, and that
installed clone remains checked out at `cb7c24a`.

## Result

- `npm run check` and `npm test` pass at the new revision: 61/61 test files in 18.0 s.
- The plugin root now contains only the current revision plus three documentation folders, and no
  packaged file moved, so `PACKAGE_MANIFEST.json` stays valid for the files it enumerates.
- `remove/` still holds the audit snapshots, the third-party reference checkout and the
  iteration-08 archive; all of it is ignored by `/remove/` in `.gitignore`.
- Follow-ups: the `dev_docs/` documents describe the system as built, so they need a new versioned
  block whenever the design moves; the plan document's sections 3 (A tier) and 7 (open problems)
  remain the live work list.
