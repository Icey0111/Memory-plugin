# Roadmap and Evidence Limits

## Current decision

Keep versioned raw history, a compact continuity snapshot, original-chunk retrieval, optional reranking
and budgeted quotations. The summary is not an embedding document. The default summary cadence remains
ten complete user turns (normally twenty message rows); its frozen input and successful coverage must agree.

## Anchor changes and acceptance limits

- Anchors change by explicit numbered operations against a frozen id/revision table (ADR-0028). Labels
  no longer authorize replacement; slash suffixes are preserved. No similarity-based retirement remains.
- Every nonempty anchor line reaches validation, including unbulleted and inline operations. Missing or
  empty sections reject the batch; explicit `无` is a distinct valid zero-change response. Malformed
  fields and invalid references reject atomically, while label punctuation and length do not.
- Statements are stored in full. The 600-token injection budget parks whole entries rather than truncating
  their conditions. Selection stays round-robin by kind, newest-first within each kind.
- Input/summary/anchor defaults remain 40000/600/600. The instruction block is 760 characters, including
  the clarification that restating an unchanged state is not an update.
- The saved 17:45 run finished with 40 completed turns but only 30 covered/folded turns, zero active anchors
  and an unrecovered 619/600 summary-budget failure. Four requests were not four successful commits.
- The old ledger's lexical 7/6/21 clause groups are review candidates, not measured semantic loss or an
  upper bound. A source reference alone does not establish entailment or preservation of necessary clauses.
- Five fixed synthetic cases on deepseek-v4-flash exercised add, named update, conditional update, end and
  no change. The first run unnecessarily updated the no-change case; after one prompt clarification the
  five structural checks passed and the operation text was manually reviewed. This is short-input protocol
  evidence. Long-context behavior, omission, stale facts and total retry cost still need separate acceptance.
- Use `node eval-anchor-protocol.mjs --out <report.json>` for the explicit five-call protocol probe. It uses
  the host's summary connection without writing the chat or memory ledger. Raw requests and responses are
  saved for review. Long-run narrative/summary quality remains assigned to a separate task.

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
