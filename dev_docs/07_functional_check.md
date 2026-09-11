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

---

## Revision 2 — 2026-09-11 20:10 (validation results, and the epistemic defect)

### Token band, natural single generation, 10 floors

Chat `Seraphina - 2026-09-11@19h32m15s946ms`, new chat, directive "请写一段 790 到 950 字的长回复",
one `generate()` per reply, no `continue` anywhere in the run.

| turn | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reply tokens | 1017 | 973 | 986 | 996 | 868 | 902 | 864 | 827 | 903 | 696 |
| produced characters | 1203 | 1197 | 1199 | 1237 | 1084 | 1111 | 1079 | 1024 | 1124 | 864 |

min 696 / p25 864 / median 903 / p75 986 / max 1017; **8 of 10 inside 700-1000**, one 4 tokens below and
one 17 tokens above. Measured cost is 0.845 tokens per produced character.

Calibration ladder, all single-generation: ask 600-750 chars -> 646-859 tokens (median 679); ask
790-950 chars -> 696-1017 (median 903). The first ask was too low; the second is centred.

### Memory integrity on the same run

| measurement | value |
| --- | --- |
| fold coverage certificate | 13 hidden rows, 8 covered floors, 8 digest lines, **0 uncovered rows** |
| key retention, per turn | 0/0 2/2 2/2 3/3 3/3 4/4 5/5 5/5 6/6 — worst 1.00 |
| `causal_recall` | 39/39 = 1.00 |
| injected reference / current-state chars | 0 -> 5,419 / 0 -> 4,304 over the run |
| injection coverage, per turn | 1.00 1.00 1.00 0.60 0.93 0.75 0.81 0.75 |
| canonical compression at 20 floors | 2,527 memory tokens vs 9,134 raw = 27.7% |
| extraction | 8 of 10 turns; 48 memories, 50 spine nodes |

### What the prompt actually pays for

Precise breakdown of the last generation of that run (total prompt 15,393 characters):

| block | chars | share of prompt |
| --- | --- | --- |
| `[PLUGIN REFERENCE DATA]` preamble | 459 | 3.0% |
| `[AETHERIA 分层剧情摘要]` layered summary | 3,247 | 21.1% |
| `[HISTORICAL MEMORY]` (memories, scenes, setting) | 3,917 | 25.4% |
| `[PLUGIN CURRENT STATE]` | 2,305 | 15.0% |
| **plugin memory total** | **9,928** | **64.5%** |

Inside `[HISTORICAL MEMORY]` the actual `<summary>` text of the six memories is **241 characters**; the
two scene blocks are 1,591 and the XML wrappers, evidence excerpts and instruction preamble make up the
remaining 2,085. In other words the rendered memory channel is about **40x the canonical memory text it
carries**, and the layered summary block alone (3,247) is larger than everything else combined. That is
where the next round of "省" has to come from: not from compressing memory further, but from rendering
less of it.

### Second defect found and fixed

Every non-`intention` memory was published as `epistemic="fact"`, because the model never emits
`epistemic` and the default was constant. Captured live:

    <memory id="m_4_3_2vq8m" kind="belief" ... epistemic="fact"><summary>塞拉菲娜推断灰咳不是普通疾病…</summary></memory>

An inference was asserted to the model as a fact — the one upgrade the extraction rules forbid. Fixed by
deriving the label from the record instead of defaulting it; see
[change_log_2026_09_11_20_05_00_fix_epistemic_is_not_a_constant.md](../change_log/change_log_2026_09_11_20_05_00_fix_epistemic_is_not_a_constant.md).

### Remaining open items, updated

1. The structured baseline gate is still inert (`setting_binding.world_id` null, `relevantSettingContext`
   0 in 82/82 planned records, 0 baseline rejections in 211 extractions).
2. Memory is still mostly additive (82.7% `add`), and the two-fold repair proves the supersede mechanism
   works, so the gap is extractor behaviour, not the store.
3. `level2`/`level3` stay 0 at this scale: an L2 needs `l2*l1` = 30 digest lines, which a 10-floor chat
   cannot reach. Not a defect, a threshold.
4. The final-turn consistency snapshot came back `null` in both validation runs even though 9 of 10
   per-turn snapshots were recorded. Diagnostic gap, unresolved.
5. Extraction still retries 67% of the time at ~11.2k characters per prompt.
