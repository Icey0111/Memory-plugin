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

### The tolerance the live run forced

Two 40-turn acceptance runs were needed, and the second one changed the parser. The summarizer wrote
**nine lines in the shape `更新 | 类型 | 主体 | 来源 raw_N | 陈述`** - the update word with a type and a label
where the id belongs. Under the first parser each of those refused the whole batch: three batches were
refused, three extra model calls were spent, and the summary stalled for a cadence each time before the model
happened to write the word the host wanted.

An update word with no target names nothing, so nothing can be retired by accepting it: the line is an add,
and it is now applied as one and counted as `reinterpreted` in `anchors_ops` so the operator can see the word
is being misused. This is not the forbidden fallback - "only a target that was named and verified may retire
a value" is untouched, a `结束` with no target is still refused (there is no record it could mean), and a
valid alias that has moved is still a conflict.

### Live acceptance, in three runs on the shipped defaults

The protocol was accepted or corrected on live 40-turn runs (`继续。` as every user turn, no settings
changed, no page or chat reload during a run). All three are kept because the first two are the reason the
third exists.

| Run | Instruction block | Batches committed | Operations applied | Refused turns | Other failures | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 16:54 | 1,045 | 1 of 4 | 7 adds, 0 invalid | 0 | 0 | **input budget blocked batch 2 at 40,047 against 40,000; re-checked 42 times over 21 turns** |
| 17:09 | 744 | 2 of 4 | 5 adds | 3 (10 lines, all `alias_required`) | 1 over budget, 1 format | the update word without a target cost three batches |
| 17:45 | 744 | 4 of 4 | **0** | 2 (12 lines: 1 `missing_source`, 1 `unknown_alias`, 10 `bad_subject`) | 1 over budget (619 > 600) | 4 of 4 batches committed, 19406 / 33599 / 28790 / 10993 characters, all inside the budget |

**What this establishes.** The host mechanism works: on the 16:54 run the first batch committed seven adds
with seven correct sources, zero invalid lines and zero collisions, and every record carries a version. After
both corrections, the 17:45 run committed every batch it attempted with no input-budget block at all.

**What it does not establish, and must not be read as success.** In none of the three runs did the summarizer
ever emit an explicit `更新 A#` - it either reported no anchor changes at all (0 operations in 4 of 4
batches on the third run) or reached for the update word without a target. So the operation the whole
decision is built around - a named replacement - is **unexercised live**, and the ledger ended the third run
empty. "Fewer live values and nothing parked" is not evidence here; there was nothing to park.

**What the runs cost.** Two of three runs spent extra model calls on refusals, and two of three lost a
cadence of summary to them. The 17:45 run had the best shape: 4 of 4 batches, 40/40 sends, 0 fallbacks,
0 reloads, 3 empty-reply recoveries, 2 refused turns out of 40, and one unrecovered output-budget failure at
the very end (619 tokens against the 600-token summary budget, which the decision above deliberately leaves
alone).

**The limit that is not this change.** Two runs were blocked by the 40,000-character input budget, on batches
of 37,509 and 43,351 characters of original text - 93% of the request. On the second of those the old
protocol would have measured 45,402, so the ceiling is the chat's reply length against a budget calibrated on
a 23,742-character batch. A protocol change of a few hundred characters decides whether such a chat can be
summarized at all, which is why the instruction block was cut rather than the budget raised.

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

- **Cost, and the run that measured it.** On the same ledger and the same 600-token budget, the
  instruction block grows from 678 to 744 characters (+66, +10%) and the frozen table from 642 to 682 (+40 for
  8 live values). The batch text and the injected block are unchanged.
  This number is load-bearing, and a live run is why. The first version of this text was 1,045 characters. On
  a 40-turn acceptance run the second batch measured 37,509 characters of original text, so the request was
  40,047 against a 40,000-character budget: **47 characters over, and the pipeline blocked**. That batch was
  re-checked 42 times over the next 21 turns, the summary never advanced past floor 10, and 30 floors stayed
  unfolded. The old protocol's request on the same batch would have been 39,680. The instruction block is
  therefore cut to 744 characters - the sentence asking the model to keep the subject stable was removed
  because a label is no longer an identity, and the separate worked example was removed because the three
  format lines already carry a concrete id, a concrete statement and a concrete source. The batch is 93% of
  the request, and the pipeline's own input budget is what sets the ceiling. The summary budget stays at 600
  and the input budget at 40000.
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
