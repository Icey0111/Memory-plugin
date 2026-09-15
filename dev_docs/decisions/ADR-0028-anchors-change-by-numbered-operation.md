# ADR-0028: Anchors change by numbered operation

- Status: accepted; model effectiveness remains under evaluation
- Date: 2026-09-13
- Supersedes: ADR-0026 (subject-based replacement) and the identity half of ADR-0027
- Relates to: ADR-0005, ADR-0008, ADR-0012, ADR-0024, ADR-0025

## Problem

A subject label can name several independently changing facts. Replacing an entire entry because a
new statement shares its label can discard conditions or unrelated clauses. Text similarity cannot
authorize that replacement either. The host needs an explicit target it can validate.

## Decision

The host presents each current record as `A1 | type | label | full statement` and freezes its alias,
record id and revision for this request. The model returns a textual delta:

```text
【锚点变更】
- 新增 | 承诺 | 归还钥匙 | 来源 raw_77 | 甲将在乙释放人质后归还钥匙。
- 更新 A1 | 来源 raw_78 | 刀在井边，不在井底。
- 结束 A2 | 来源 raw_79 | 约定已经履行完毕。
```

An add never retires another record. An update keeps the target id, increments its revision and
archives the old value. An end moves its target to the resolved window. An omitted record stays active
and is not counted as reconfirmed. An update word without an alias, but with complete add fields, is
accepted as an add and counted as `reinterpreted`; it is not a successful update.

Before committing the summary and ledger together, the host checks every operation's alias and source
against the frozen request, rejects duplicate targets and checks that the record revision and original
batch have not changed. A rejected batch advances neither summary coverage nor folding.

## Parsing and preservation contract

- Every nonempty anchor-section line reaches validation, with or without a bullet. A heading may carry
  its first operation on the same line. Unrecognized text is an error, never an empty change list.
- Missing, empty, explicit `无` and operation-bearing sections are distinct. Missing or empty required
  sections reject the batch. Explicit `无` commits zero operations; mixing it with operations rejects.
  Successful diagnostics carry `anchor_ops.section` (`none` or `ok`); rejected lines and rules remain
  in the existing error record after recovery.
- Labels are display text. Length and punctuation do not authorize rejection or replacement. Field
  counts are checked without deleting empty columns, so malformed rows do not silently shift fields.
- Statements are stored in full, including content after the former 240-character limit. The injection
  budget still selects whole anchors and parks those that do not fit; it does not truncate stored facts.
- Unicode and whitespace normalization is used for comparison only. Slash suffixes remain meaningful.
  Exact restatements may deduplicate; approximate similarity and subject-based supersession are gone.

The host verifies references, not entailment. An existing source id does not prove the statement is
supported, and a named update does not prove that every necessary clause survived.

## Budgets and evidence

Defaults remain 40,000 input characters, 600 summary tokens and 600 anchor tokens. The prompt explicitly
says restating an unchanged state is not an update. Its instruction block is 760 characters at a
600-token summary target, versus 744 before this clarification. Fixed ten-turn batches remain indivisible;
an over-budget batch stays visible. Shortening instructions cannot guarantee every possible batch fits.

The saved 17:45 run (`cont80f-final.json`) has 40 completed user turns, only **30 covered/folded turns**,
zero active anchors and an unrecovered 619/600 summary-budget failure. Four request costs were recorded;
they are not four successful commits. The former bullet-only parser can skip operations, so zero applied
operations alone cannot establish that the model explicitly reported no changes.

The prior 15:57 ledger's 34 clauses were divided by lexical overlap into 7 high-overlap, 6 intermediate
and 21 low-overlap clauses. These are candidates for semantic review, not confirmed loss counts or a
mathematical upper bound on loss. Obsolete facts and paraphrases require separate assessment.

`eval-anchor-protocol.mjs` uses five fixed synthetic cases and the host's real summary connection without
writing chat or memory state. On deepseek-v4-flash, the initial run passed add, named update, conditional
update and end; it unnecessarily updated the unchanged case. With the clarification, all five structural
checks passed. Manual inspection confirmed the location update, retained hostage condition and fulfilled
promise ending. This establishes short-input protocol capability, not long-context reliability or overall
summary quality. Detailed request/response evidence belongs with the PR, not duplicated document histories.

## Retention and alternatives

Retired records retain their original and replacement sources in a 40-entry window; endings have a
20-entry window. Beyond those windows the lossless raw history is the authority. Budget parking does
not invalidate a fact. No extra inference call, graph database or similarity-based retirement is added.

## Validation

`test-anchor-changes.mjs` covers explicit operations, reference/version conflicts, atomic refusal,
missing/empty/no-change sections, unbulleted and inline operations, malformed fields, long labels and
conditions beyond 240 characters. Existing pipeline, budget and lifecycle tests cover folding and
injection. Long-run semantic acceptance remains a separate task.
