# ADR-0026: One live value per subject, and a block that is filled evenly

- Status: superseded by ADR-0028 (the subject is a label, and a replacement now names its target)
- Date: 2026-09-13
- Relates to: ADR-0005 (continuity anchors), ADR-0008 and ADR-0012 (knowledge boundaries), ADR-0024, ADR-0025

## The measured problem

A 40-turn live run ended with 30 live anchors and a 300-token anchor block that injected 10 of them. The
block was filled in the order the summarizer emitted lines, which is insertion order, so the cut kept the
oldest facts and dropped the newest: measured average age of what was kept, +165 s; of what was dropped,
+1024 s. Two of the dropped entries were the corrected current values of facts whose stale versions stayed
in the block, so the model was handed "约不足一日内或及心脏" while the story had reached "约四小时", and
the ledger held both "Ilyra的长刀现由你持有" and "Ilyra长刀已沉入井底…不在你手中".

## Decision

1. **One live value per subject.** `supersedeAnchors` keeps the newest entry per subject and moves the
   rest to a bounded `superseded` ledger. Nothing is deleted: the retired entry keeps its text and records
   which entry replaced it and why. A subject is an explicit field on the anchor
   (`- 类型 | 主体 | 陈述`); without one, only a near-verbatim restatement is folded.
2. **The subject is part of the summarizer protocol.** The anchor section of the summary request now shows
   the subject so the model can keep it stable across passes, asks for a subject on entries that lack one,
   and requires a superseded entry to be listed in 【已解决】.
3. **The block is filled evenly and newest-first.** `orderAnchors` serves one line per kind in turn, with
   kind rank deciding who is served first in each round and `first_seen` deciding the order inside a kind.
4. **The budget is a selection budget, and what it leaves out is reported.** `selectAnchors` returns the
   injected lines and the parked entries; diagnostics carry `anchors_active`, `anchors_injected`,
   `anchors_parked`, `anchors_parked_terms`, `anchors_superseded` and `anchors_without_subject`, and a
   parked live value warns with its counts.
5. **The default anchor budget is 600, not 300.** The contract is that an anchor is re-injected until
   something explicitly resolves it; the measured corpus is about 29 tokens per anchor, so 300 held ten
   entries of a 20-to-30-entry ledger. This is a structural mismatch between the contract and the budget,
   which is a different thing from ADR-0025's unexplained summary failures, so it is sized rather than
   hoped at. 600 is still below the evidence block's 1000.

## Alternatives rejected by measurement

- **Select by relevance to the last few messages.** The last few messages are already in the prompt, so this
  spends a hidden-state budget restating the visible scene: on the real chat it overlapped the old cut by
  1 of 8 and scored the topic of the last three messages at 5.09 against 0.14 for everything else. It also
  dropped the long-standing promises. Generative Agents' relevance+recency+importance (arXiv 2304.03442)
  retrieves memories that are *not* otherwise in context, which is not this situation.
- **Kind priority in blocks.** Life-or-death facts filled every slot first and starved the promises
  completely: 0 of 8 injected at a 600-token budget, including the scene's own operating instructions.
- **Lexical similarity as the whole rule for supersession.** Measured on the real anchors: restatements
  score 0.775-0.800 and unrelated facts 0.011-0.014, but a *new value for the same subject* — the knife held
  against the knife sunk — scores 0.021, indistinguishable from unrelated. Overlap cannot see supersession.
- **Extending the near-verbatim threshold downward** to catch those pairs would fold unrelated facts at
  0.099 against 0.021, so it would merge distinct promises and ownership.

`ANCHOR_DUPLICATE_SIMILARITY = 0.6` sits in the measured gap between 0.800 and 0.021.

## Consequences and measured limits

On the real 30-anchor ledger the change takes supersession to 28 live, and at 600 tokens the block injects
18 of them with 10 parked; at 900 it injects 26 with 2 parked. Nothing that the old cut injected is lost,
and the corrected current values of the poison clock and the knife now take the first slot of their kinds
instead of being parked behind their stale versions.

**The limit is explicit.** Two entries with the same subject are never injected together only when the
subject field is present, and the existing ledger has none — so on that chat both the four-hour and the
one-day poison clock are still injected, and both the held and the sunk knife. Supersession cannot reason
about those entries until the summarizer has re-emitted them with subjects, which is what the protocol
change and `anchors_without_subject` are for. The same chat also shows the intrinsic tension: at 600 tokens
the long-standing promises ("Seraphina承诺会保护你", the wooden amulet) are what gets parked, because the
block serves the newest value of each kind first.

## Validation

`test-anchor-budget.mjs` (new): a restatement is one entry and the newer one is live; unrelated facts both
survive; an explicit subject makes a differently-worded newer statement supersede the older one and the two
never coexist; a superseded statement is never injected; a tight budget parks the oldest and reports it;
the read-only report and the assembly agree; a legacy store is normalised on load with its history kept;
and the three-field form is parsed without corrupting an ordinary statement that contains a pipe.
