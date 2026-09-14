# Roadmap and Evidence Limits

## Current decision

Follow the [AIRP product contract](00_project.md#product-contract): preserve necessary continuity
and recover precise original evidence, then assess whether the actual prompt supports the reply.
Minimizing summary length is subordinate to preserving that meaning.
The summary budget separates an information-sensitive target, an explicit emergency ceiling and the
total injection budget (ADR-0032): a body over the target but within the ceiling is accepted and
recorded, and only a body past the ceiling is refused. The ceiling derives from the target unless the
user sets it. The final numeric limits still have to be selected from evidence.

The active execution plan is [Issue #2](https://github.com/Icey0111/Memory-plugin/issues/2).
It starts with a trustworthy trace of one existing failure, then budget semantics and the proven
summary/retrieval handoff gap, followed by recovery, isolation and product clarity. Each task has
its own acceptance and stopping condition; no new long-chat campaign or architecture layer is
required to begin.

`node acceptance-longchat.mjs --detail-survival` is the reusable instrument for the hand-run
detail-survival baseline: it asks only the details the committed summary dropped, with a retained
positive control and a never-written negative control, and attributes each answer to the continuity or
the evidence channel (N29). It also reads retention against the committed summary after **every** batch and
groups it by the declared fact kind, which is the cross-merge question. The first live measurement
(2026-09-14, chat FactSurvival2, 11 facts, merges at floors 10 and 20): the floor-10 summary kept 11/11 and
the floor-20 merge kept 8/11 - it lost a still-live state and a condition while keeping three incidental
details, so **2/7 must-keep facts were lost in a merge**. One chat and eleven facts is a located defect,
not a rate.

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
- Input/summary/anchor defaults remain 40000/600/600. The instruction block is 1018 characters, including
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

## Live long-chat acceptance of the current baseline

One 40-user-turn run (four ten-floor batches plus four recall probes) on `fc9b729` with runtime `9f85ada`:
no persistent runtime block, the one refused batch (a 610/600 summary body) retried on the same frozen batch one
turn later and committed, all four batches ended committed, zero parked anchors, the injected state equal to
the live one, and a recall probe that quoted hidden original floors (`raw_24`, `raw_78`).

That is the floor, not a clearance. The run does not show that the system is free of structural problems or
that plot continuation is reliable. The character overrode the staged script from about floor 10, so the
fact-retention half of the test is only partly valid; one summary body contradicted its own anchors; and the
run's own record was incomplete, because the repair call's raw request and elapsed time were dropped and probe
turns did not persist their injected text. The record chain is now versioned and proved offline:
`acceptance-capture.js` and `acceptance-longchat.mjs`, with `test-acceptance-capture.mjs`; the chat text and
raw responses they produce stay outside the repository.

### Live acceptance, continuation-only (30 turns, 2026-09-14)

One 30-user-turn run on the current branch (`67577c4`, deployed and preflight-verified 32/32) on a fresh test
chat, with the user turn a bare continuation command in every turn and the record kept outside the repository.
Three batches (turns 10, 20, 30) committed with zero summary failures and zero repairs, and every generation
resolved to a reply; the driver retried two blank replies automatically and both succeeded. Replies averaged
about 2.5k characters (1.2k-3.8k), mean wall time was 13.7 s per turn (max 68.3 s), and the three summary
calls took 8.9-9.3 s. The final injected blocks were 1,927 characters of state and 3,830 characters of quoted
original evidence.

Because the user turn carried no content, this is the continuation case: the state block and retrieval had to
carry the story without an explicit question. The committed summary tracked the invented plot (the west-road
departure, the lake-shore footprints, the bare tracks from the water, the test mud board and the next-day
plan), and the anchor ledger held 15 live anchors; at a 600-token anchor budget the parked ones are the case
the parked-anchor query handoff covers.

An earlier 30-turn run on the same code used scripted user turns that narrated the character; it is recorded
here only to note that it is superseded, because a user turn must carry the player's own action rather than
putting words in the character's mouth.

This is one chat and case-level evidence, not a quality score, and it does not measure generated-answer
correctness. Two provider limits were observed. The OpenAI-compatible endpoint serves `/embeddings` but
returns HTTP 404 for `/rerank`, so reranking is disabled and the fused order is used; the failure was recorded
with its estimated cost and the fallback kept runs working. In this run the dense channel contributed no
candidate (`channels: {lexical: 149, vector: 0}`) with `vector_available: true` and no error recorded, while
an earlier chat on the same embedding model returned 24 dense candidates; the cause is not established and is
recorded as open.

The body-level negation-scope probe is the follow-up: three materials x two prefixes x three runs, frozen
before the first call. The B4 compression was observed **once**, and three frozen replays of the identical
request afterwards did not reproduce it; neither the cause nor the rate is known, and the original failure was
selected after the fact, so it cannot be pooled with the replays as an error rate. The one added sentence
changed none of the real-place outcomes while replacing one prose over-affirmation with one internal
contradiction on the denied-place material. The sentence is not added (ADR-0030), and the body-level
compression stays a recorded, low-frequency risk.

The baseline stays usable, with semantic reliability still limited. Known cases retained: the staged amber-glass
replacement at T24 is lost after the character denies it and no anchor carries it; the staged tower, key, Cora
and Tomas survive only as denials; one summary body and its own anchors disagree about the black reef and both
are injected; and three floors were still pending at floor 40.

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
- A host metadata-write failure that lands after the committed state is on the store is recorded as
  `persist_error` (stage `metadata_write`) and is not counted as a model failure; a write that fails before the
  commit still rejects and hides nothing (audit F-1). The original-text vector collection is classified as
  `raw` rather than `memory`, so a raw query keeps its requested threshold and is not judged against the memory
  index's embedding space (audit F-8).

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
- The retrieval query carries the parked active anchors' statements, bounded by the query's own
  5000-character cap, so a constraint the anchor budget parked still has a route back to the original text
  it paraphrases. Measured on the d7eed81 audit: the base continuation query packed the east-room source row
  without the span carrying the lock constraint, and adding the parked statements recovered the original row
  (`raw_18`). The dense query is untouched and reserved evidence seats stay rejected (`raw-history.js`).

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

The 600-token default is the soft target, not a universal measure of sufficient memory. The
target/ceiling split is [ADR-0032](decisions/ADR-0032-a-soft-summary-target-and-an-emergency-ceiling.md);
the ceiling derives from the target unless the user sets it. A length-only rejection and semantic
information loss are different observations; accepting a 610-token body does not prove that semantic
information is preserved. The historical runs below explain the existing evidence, not a requirement
to preserve the old hard cap indefinitely.

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
