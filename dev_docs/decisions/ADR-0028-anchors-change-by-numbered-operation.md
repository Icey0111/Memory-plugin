# ADR-0028: Anchors change by numbered operation, and the host checks the reference

- Status: accepted
- Date: 2026-09-13
- Supersedes: ADR-0026 (one live value per subject) and the identity half of ADR-0027
- Relates to: ADR-0005 (continuity anchors), ADR-0008 and ADR-0012 (knowledge boundaries), ADR-0024, ADR-0025

## The measured problem

ADR-0026 made a subject field the authority that retires a value: any later line about the same subject
replaced the earlier one, whatever it said. That fixed the case it was written for and left two problems,
both of them measured rather than argued.

1. **A label cannot be an identity.** On the live 40-turn ledger the model wrote "心脏石植入者/制造者" on
   one pass and "心脏石植入者" on the next, and the same fact survived twice. Dropping a "/" suffix fixed
   that pair and silently merged every other pair shaped the same way - "刀/位置" and "刀/所有者" become one
   key under exactly the same rule. Deterministic is not the same as correct, and a rule that cannot read the
   label cannot be right on one pair and wrong on another.
2. **A newer value is not a summary of the older one.** On the same ledger, "炉石" ended as "炉边扁平石；
   其灰线早已脱离炉石转向化身，已不再具决定性。" The version it replaced also carried "接生婆血脉最初埋种
   之处" and "是种子在中央扎根的唯一地点". The host cannot tell whether those clauses stopped being true or
   stopped being mentioned, and under ADR-0026 it had no way to ask: the model's own wording was the only
   identity there was, so a restated clause and a dropped clause looked the same.

Measured on that ledger, with clauses split on ；/。 and a token-overlap test (kept >= 0.5, paraphrased
0.2-0.5, dropped < 0.2): of the 34 clauses the replaced versions carried, 7 are still in the live value,
6 are paraphrased into it and **21 are absent** from it. Some of those are correct - "她估计四小时内会倒下"
is answered by the story moving on - but the host cannot tell the correct ones from the lost ones, and that
is the point.

## Decision

1. **The host numbers what it sends.** The summary request carries the live ledger as
   `- A1 | 类型 | 主体 | 陈述`, one line per anchor. The alias names one request only; the ledger keeps
   its own stable id, and the request freezes `{alias, id, revision}` for every line it shows.
2. **The model returns changes, not a restatement.** The anchor section is `【锚点变更】` with three
   operations: `更新 A3 | 来源 raw_77 | 新陈述`, `新增 | 类型 | 主体 | 来源 raw_79 | 陈述` and
   `结束 A5 | 来源 raw_80 | 原因`. An anchor that is not mentioned is left exactly as it is - not deleted,
   and not counted as re-confirmed.
3. **An add never replaces anything.** The same label with a different value is two live records, and the
   collision is reported (`anchors_same_subject`). Only a named update retires a value, and the retired
   value moves to the same bounded window as before, now carrying both the source it came from and the source
   that replaced it.
4. **The host checks the reference, not the meaning.** Four checks: the id is in this request's alias table;
   the source id is in this batch's original text; one record is not changed twice in one batch; the record
   still carries the version the request was built from. The fifth - the batch text did not change under the
   request - is checked at commit with a fingerprint of the exact messages that were sent.
5. **A refused batch is not committed and hides nothing.** Any invalid reference or conflict rejects the
   whole batch: the summary and the anchor changes are one commit, so a refusal cannot leave the two
   disagreeing about the same floors. The stage is recorded as `anchor_ops` with the line and the rule it
   broke. There is no fallback to "who else writes about this label", because that fallback is the thing this
   decision removes.
6. **Identity is a label again.** `anchorSubjectKey` normalises Unicode and collapses whitespace and does
   nothing else: it keeps a "/" suffix, and it is used for display and for recognising an exact restatement,
   never for authorising a replacement.
7. **The near-verbatim fold is gone too.** `ANCHOR_DUPLICATE_SIMILARITY` and its token-overlap rule
   existed to catch a restatement the subject rule could not see; under a change protocol a restatement
   should not arrive at all, and an identical statement under an identical label is still folded by exact
   comparison. The threshold is deleted rather than left dead, because a rule that cannot tell a new value
   (0.021) from an unrelated fact (0.014) has no measured job left.

## Alternatives rejected

- **An LLM dedup pass over the ledger.** Mem0 resolves a candidate with a second model call and Graphiti
  resolves nodes the same way; both make the same class of decision this host cannot verify, and both add a
  call per pass to a pipeline whose summary budget is already the tight one. The reference check here costs
  nothing and is decidable.
- **A similarity guard on top of the change protocol.** Already measured and rejected in ADR-0026: it costs
  five true merges to catch one duplicate. Graphiti's own issue #1728 is the same failure at scale - a
  resolution candidate range that is too wide retires unrelated facts.
- **Falling back to a label match when an alias is unknown.** That is the old rule wearing a new hat, and it
  would make "A7 does not exist" silently mean "the record about this subject". Refusing is cheaper: the
  floors stay visible and the panel says which line was refused.
- **Keeping the old restatement protocol behind a setting.** Two protocols would double the surface a live
  run has to cover, and the cost of the change is measurable on one budget configuration.

## Consequences and measured limits

- **Cost.** On the same ledger and the same 600-token budget, the instruction block grows from 678 to 998
  characters (+320, +47%) and the frozen table from 642 to 682 (+40 for 8 live values). The batch text and
  the injected block are unchanged. The summary budget stays at 600 and the input budget at 40000: the last
  live run's four batches measured 26,239 / 31,524 / 32,921 / 26,951 characters against a 40000 budget, so
  the prompt has room, and the one failure that run recorded was an output overrun (665 > 600), which this
  change does not touch.
- **The model is load-bearing.** The host can prove that an update named a record it was shown. It cannot
  prove that the cited source supports the sentence, or that the new sentence still carries the clause the
  old one carried. The instruction asks for conditions, negations and premises to be kept and gives an
  example of each operation; nothing enforces it, and the 21-clause measurement above is the baseline it has
  to beat.
- **The retired window is 40 records and 20 resolutions, not an archive.** Past the window only the original
  floors remain. The panel and the report state the limit (`anchors_superseded_limit`) rather than implying
  the structured history is complete.
- **A missing section still commits the summary.** No `【锚点变更】` at all means the anchor ledger is left
  alone and its entries are counted as unreferenced; only a *present but illegal* operation set refuses the
  batch. The two are different events and are reported as different events.

## Validation

- `test-anchor-changes.mjs` (new): the frozen table; the three operations; a matching label does not
  authorise a replacement; a slash label keeps its content; a condition survives an update; an unknown
  alias, a source outside the batch, a missing source and a duplicate target each reject the batch; a record
  that moved since the freeze is a conflict; the same batch answered twice is applied once; an exact
  restatement is one record; a refused batch commits nothing and hides nothing and is recorded as
  `anchor_ops`; a missing section keeps the anchors and does not re-confirm them; the report exposes the
  operation counts, the collisions and the retention limit.
- `test-anchor-budget.mjs` (rewritten to the new contract) keeps the ordering, parking and reporting rules
  that are unchanged and adds the explicit-update and slash-label boundaries.
- The live acceptance for this decision is a 40-turn run on the shipped defaults, recorded in the pull
  request with the per-batch operation counts, the refusals, the collisions and the retired records.
