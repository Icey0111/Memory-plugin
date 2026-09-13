# Roadmap and Evidence Limits

## Current decision

Keep the architecture: versioned raw history, a compact continuity snapshot, original-chunk retrieval,
optional reranking and budgeted quotations. The summary is not an embedding document. Per-message
summaries, a fact-generation pipeline and a summary pyramid would duplicate authority without fixing
the measured query and packing failures.

The default remains ten completed user turns (normally twenty message rows). Summary quality and
long-run narrative acceptance are a separate task; this retrieval iteration does not establish them.

## Completed anchor-budget work

- One live value per subject, with the retired entry kept in a bounded ledger together with the id of what
  replaced it (ADR-0026).
- The subject became part of the summarizer protocol, so a mutable fact keeps one identity across passes and
  the model is asked to resolve what a new statement replaces.
- The block is filled evenly across kinds and newest-first inside each kind, instead of in the order the
  model emitted lines. Measured on the real 30-anchor ledger: the old cut kept facts averaging +165 s old
  and dropped facts averaging +1024 s old, including the corrected values of two facts whose stale versions
  stayed in the block.
- The default anchor budget is 600 rather than 300, and what does not fit is reported
  (`anchors_parked`, `anchors_parked_terms`, `anchors_without_subject`).

## Completed anchor-change work

- The anchor section is a change list against a host-assigned alias table: @@更新 A3 | 来源 raw_77 | 陈述@@,
  @@新增 | 类型 | 主体 | 来源 raw_79 | 陈述@@, @@结束 A5 | 来源 raw_80 | 原因@@. An anchor nobody mentions is
  left as it is, and a label no longer authorises a replacement (ADR-0028).
- Every reference is checked before the same commit writes the summary and the ledger: the alias must be in
  the frozen request, the source must be in this batch's original text, one record cannot be changed twice,
  the record must still carry the frozen revision, and the batch text must not have changed under the
  request. A refusal commits nothing and hides nothing.
- The near-verbatim similarity threshold and the subject-based supersession are both deleted, and the label
  keeps a "/" suffix: the same rule that merged "心脏石植入者/制造者" also merged "刀/位置" with "刀/所有者".
- Measured cost of the change on the same ledger and the same 600-token budget: instructions 678 -> 998
  characters, frozen table 642 -> 682 for 8 live values. The injected block and the batch text are unchanged.

### What this work has not established

- The host proves that an update named a record it was shown. It does not prove the cited source supports the
  sentence, or that the new sentence still carries the clauses the old one carried. Measured baseline on the
  live 15:57 ledger: of 34 clauses carried by replaced versions, 7 are still in the live value, 6 are
  paraphrased into it and 21 are absent from it - an upper bound on loss, not a count of errors, because
  some of those clauses are correctly obsolete.
- Whether the model actually uses the protocol is a live-run question. It is measured per batch by
  @@anchors_ops@@ (added / updated / ended / restated / invalid) and @@anchor_op_errors@@.

## Completed anchor-identity work

- Subject identity is a deterministic normalisation (Unicode, whitespace, a dropped `/` suffix). Measured on
  the live ledger: it folds 17 active anchors to 16, frees one parked slot, and leaves every remaining
  subject distinct. Containment was measured and refused: it would merge five different facts to catch that
  one duplicate (ADR-0027).
- The hand-written kind rank table is deleted. It ranked three of the nine kinds one live run produced, so
  "life-or-death first" was not operating. Round-robin remains and service order is decided by recency, which
  needs no maintenance as the model's vocabulary drifts (ADR-0027).

## Completed summary-diagnostics work

- Classify a failed summary (transport, empty body, truncated, over the accept budget, format) and keep a
  bounded record of the last one with its input cost and response status; a success marks it recovered
  instead of clearing it (ADR-0025).
- Separate the source version from the content version of the committed state, compare `injected_stale` by
  version, and record "injected" only after the host has received the block (ADR-0025).
- Re-read the committed state after the last await of prompt assembly and again synchronously before the
  prompt is set, so a commit that lands mid-assembly cannot pair an old block with newly hidden rows. The
  defect reproduced with a controllable pause before the fix: 40 rows hidden, block still at floor 10.
- Name the condition behind the tail: idle, accumulating, summarizing, failing, blocked or backlog. The
  4,000-token threshold no longer raises a fault on its own - a stalled, oversized full batch does.
- `narrative_input_chars` defaults to 40000 for new installs; an existing 18000 is kept and reported as a
  notice rather than overwritten.

## Completed summary-batching work

- Count the state header in floors, and report committed coverage separately from the coverage the last
  injection carried, each with its revision (ADR-0024).
- Assemble the summary request from original messages (one entry per source, whole text) while retrieval
  keeps its 700/100 chunks. Deduplication is by source id, never by text.
- Measure the exact string that is sent, part by part, and report the character budget apart from the
  unknown model context window.
- Separate a local input-budget block from an interface failure: one record per frozen batch and budget,
  no model call, no hiding, and its own warning instead of the failure counter.

## Completed retrieval work

- Normalize explicit knowledge-boundary syntax, retire older subject versions using existing confirmation
  timestamps, and preserve different assertions from the same pass. No semantic contradiction resolver.
- Count only actual quoted spans in profile and user-target diagnostics. Query-derived entity coverage
  remains a trace and no longer triggers a quality alarm.
- Focus pending user requests on the user's words; retain scene names for profile retrieval. With no new
  user request or with a pure continuation, retain the recent-scene query.
- Exclude pure user continuation commands from all evidence channels while retaining their raw archive.
  Whole-text quotation deduplication still applies (ADR-0022).
- Add prefix replay and exact-input cached vector/rerank experiments. Final results and limitations are
  in [06_retrieval_research.md](06_retrieval_research.md).

## Measured summary-input budget

Rebuilt from the chat that failed the first batching acceptance (41 rows, 43,352 characters of character
text, 22 recorded failures): the ten-turn batch is 53 retrieval chunks and 21 original messages, and the
request parts are instructions 556 + carried summary 1 + anchors 1 + knowledge 1 + batch 23,148 =
23,742 characters. The old per-chunk accounting demanded 30,300 for the same batch (1.28x), so the
18,000 default could never hold it. At 18,000 the batch is one block with `checks: 20`, zero model
calls, zero failures and zero hidden rows; at 40,000 the same frozen batch commits ten floors and hides
twenty rows. The numbers are for this one character, model and reply length, not a general rule: a
default is still an open product question, and the plugin cannot read the model context window, so a
request that fits the character budget can still be refused by the provider (ADR-0024).

## Decisions the evidence does not support

| Question | Current decision and remaining evidence |
| --- | --- |
| Should summary text replace a continuation query? | No default change. The replay has 44 continuation turns, none in the file holdout; no labelled continuation target set proves an improvement. |
| Should all frequently repeated text be demoted? | No. Repetition does not establish irrelevance. Pure continuation commands are excluded; recurring story facts remain eligible. The earlier reported 43 filler slots were not reproduced by the new prefix replay and cannot be claimed fixed. |
| Is reranking worth every call? | Keep it optional and preserve user configuration. The final 12-question real-service test gains one answer at about 0.74 seconds and roughly 9.8k estimated input tokens per call. This is a small sample, not a universal benefit. |
| Is vector recall independently better? | It changes candidates, but adds no answer on its own in that 12-question set; combined with reranking it adds one. Keep the existing weak vote, not a newly tuned weight. |
| Are profiles unaffected by focused requests? | No. Actual-span profile coverage fell from 13/17 to 11/17 in the file holdout. Better user-target coverage is a measured tradeoff. |
| Are 200+ message rows and summary decay accepted? | Not by this task. Existing archive measurements and older story runs do not establish long-run narrative quality. |

## Open question: the 600-token summary budget

Two live runs recorded three single summary failures across four batch commits, each followed by a
successful retry. The cause is unproven: the summaries landed at 532 of 600 tokens, which is close enough
to the ceiling to be plausible, and the failure reason was not retained at the time. It is retained now
(`summary_last_error`), so the next occurrence can be read instead of guessed at. Raising the 600-token
budget first would spend more context on an unknown. The commit that fixed the retained evidence also
confirms the batch request itself is well inside its budget: 23,742 characters against 40,000.

## Architectural limits

The archive is complete but duplicates transcript storage. Knowledge boundaries are explicit narrative
records, not enforced information-flow controls. The continuity snapshot can lag until the next accepted
summary; the visible tail covers that interval. Token budgets limit injected blocks, not every host-side
prompt component. User-target coverage is a heuristic; only independently labelled answer spans measure
answer-in-context, and even that is not generated-answer correctness.

Historical live-story observations remain in Git and the relevant ADRs. They must not be presented as
fresh acceptance of the current branch.
