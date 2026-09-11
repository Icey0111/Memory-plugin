# Functional Check — 2026-09-11

> Read-only audit of what the memory system actually does, run before the next quality/cost validation.
> Sources: the 67-file offline suite, a live module/pipeline exercise over CDP in the running
> TauriTavern app, and a scan of all 17 retained chat files (canonical stores) plus 211 extraction
> records and 844 extraction operations.

## 1. Verdict per stage

| Stage | Mechanism | Evidence | Status |
| --- | --- | --- | --- |
| ingest | extractor -> `parseExtractionResult` -> `applyMemoryOps` | 211 records / 844 ops across 17 chats; 0 validation errors, 0 apply errors; a fresh-chat greeting produced 6 ops, 6 memories, 6 spine nodes | works |
| represent | slot map, `supersede`, irreversibility ranking | `add` on an occupied slot closes the previous state; `supersede` by `target_slot` and by `target_id` both mark the target `superseded`; 62.1% of real ops carry a slot | works |
| retain | never-drop set (critical importance or irreversibility >= 4) | `key_retention` 7/7 = 1.00 at injection time on the last 10-floor run | works |
| compress | deterministic Level-1 digest + floor folding | digest covers every extracted turn at 0 model calls; 10 digest lines on two chats; folded history removed 48-99% when folding ran; `compression` 1,851 memory tokens vs 4,610 raw at 10 floors (40%) and 9,924 raw at 20 floors (18.7%) | works, one defect fixed — see section 3 |
| recall | reranker + self-check | `runRetrievalSelfCheck` 6/6 PASS, MRR 0.750; `causal_recall` 8/8 = 1.00 | works |
| inject | reference block + current-state block + layered summary | real request logs carry `[PLUGIN REFERENCE DATA]`, `[HISTORICAL MEMORY]` and the layered summary; 6,359 + 2,269 chars at 10 floors; `injection_coverage` 0.75 | works |

Module health: all 20 core modules import cleanly inside the running app. Canonical/derived split is
healthy — backend `tauritavern-extension-store`, durable, hydrated, 175 writes, 0 errors, and
`spine`/`floor_folds`/`cold_turns` are absent from the chat files exactly as designed.

## 2. Cost profile of extraction

| measurement | value |
| --- | --- |
| extraction records | 211 |
| generation mode: structured / budget-retry / plain-json-retry | 70 / 62 / 79 |
| retry rate | 67% (2-3 model calls per floor) |
| prompt size (chars) | min 5,569 / p25 9,144 / median 10,522 / p75 12,172 / max 20,000 |
| `relevantSettingContext` budget = 0 | 82 of 82 records that carry a `prompt_plan` |
| baseline rejections | 0 |
| op mix | add 698 (82.7%), update 56 (6.6%), close 35 (4.1%), reinforce 21 (2.5%), supersede 20 (2.4%), noop 14 |
| `epistemic` emitted | 0 of 844 ops (the model writes `channel`: saw 316, heard 145, inferred 120, told 26, empty 56) |

## 3. Defect found and fixed

Floor folding could leave raw text hidden with no stand-in, and had already done so on one retained
chat: 9 hidden floors, 12,320 characters, 0 Level-1 coverage, and the state survived a chat load.
Both causes and the fix are in
[change_log_2026_09_11_19_20_00_fix_fold_coverage_certificate.md](../change_log/change_log_2026_09_11_19_20_00_fix_fold_coverage_certificate.md).

## 4. Open gaps (measured, not yet changed)

1. **The structured baseline gate is inert on this setup.** The character is bound to the world book
   `Eldoria` (4 entries, 4,129 chars) and the plugin passes a 3,584-char host baseline to the
   extractor, but `setting_binding.world_id` is `null`, `relevantSettingContext` is 0 chars in every
   planned record, `baseline.record_count` is 0, and 0 of 211 extractions had a baseline rejection. The
   soft prompt instruction not to re-register world-book facts is active; the hard gate is not.
2. **Memory is mostly additive.** 82.7% of real ops are `add`. Only 13% are `update`/`close`/`supersede`,
   so stale state can coexist with current state even though the supersede mechanism itself works.
3. **The hierarchical summary is one level deep.** `level3` is 0 in all 17 chats and `level2` is <= 1;
   the only reliable layer is the deterministic digest. `summaryPasses` reported
   `skipped:'quiet-in-progress'` in the last validation run.
4. **`epistemic` is never emitted**, so the prompt's rumor/belief/inference/plan mapping is dead text;
   the model carries the same distinction through `kind` instead. Values that `validateMemoryOp`
   rejects would drop a whole operation, so this is worth keeping an eye on.
5. **Extraction retries 67% of the time**, at ~11.2k chars per prompt. This is the dominant background
   cost and it is the same ladder that already had to be widened once.
