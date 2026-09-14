# Development and Validation

The extension is native JavaScript ES modules, with no build step. Use Node.js 20 or newer.

| Command | Purpose |
| --- | --- |
| npm run check | Discover and syntax-check sources |
| npm test | Offline regressions, including host adapters |
| node test-summary-lifecycle.mjs | Cadence, concurrent reads, joint invalidation and summary transport |
| node test-anchor-budget.mjs | The never-inject-a-retired-statement rule, even round-robin selection, parked-value reporting, a slash label that keeps its content, a legacy ledger migrated as it stands, and the legacy anchor-budget notice |
| node test-anchor-changes.mjs | Numbered operations, atomic refusal, missing/empty/explicit-none sections, inline and unbulleted operations, multi-source 来源 lists with per-token validation, inferred-heading recovery and its prose counterexample, malformed fields, long labels, full conditions beyond 240 characters, frozen references, batch diagnostics, the duplicate-target refusal when an update and an end name the same number |
| node test-anchor-repair.mjs | The one targeted repair after a refused anchor section: validated operations, summary and boundaries preserved when the repair answers "无", replacement-only repair merged and re-validated as one batch, exactly one extra call, a failed repair that still refuses and keeps both attempts, the pre-send budget block, and a repair transport failure that keeps the attempt beside the original refusal, a redundant '结束 A1 旧状态' line repaired away while the legal update still commits, and a repair returning a conflicting end refused as duplicate_target |
| node test-runtime-precheck.mjs | The disk-vs-loaded comparison, including the stale `bad_subject` signature this acceptance run recorded |
| node runtime-precheck.mjs | Live preflight: repo vs deployed disk vs the function sources actually loaded in the page. Exit 0 only when all three agree, 1 when stale, 2 when unknown |
| node replay-anchor-evidence.mjs | Replay of the 421757c acceptance requests and responses through the current parser with no model call. Exits 0 with a note when the local evidence directory is absent |
| node eval-anchor-protocol.mjs --out report.json | Opt-in five-call model probe through an open host's summary connection and local CDP endpoint; saves synthetic inputs, raw responses, parsed operations and ledgers without writing chat state. Structural passes require manual semantic review |
| node acceptance-longchat.mjs --turns <file> --out <dir> | Reusable long-chat acceptance driver. Requires `node runtime-precheck.mjs` to exit 0 first; imports the versioned capture module from the page and refuses an `--out` inside the repository, so chat text and raw responses stay out of it |
| node acceptance-longchat.mjs --turns <file> --out <dir> --detail-survival | Detail-survival mode. Phase 1 plays a detailed turns file (every detail declares a needle and the question that tests it); the committed summary then decides what phase 2 asks. It asks only the details the summary actually dropped, plus one retained positive control and every declared negative control, all in one probe turn, and prints the four counts - summary-kept / retrieval-recovered / refused / fabricated - with the adjudicated rows written next to the run |
| node test-detail-survival.mjs | The mode's decision logic against captured text: the adaptive retention split over summary prose, active anchors and knowledge; channel attribution from the probe turn's own `injections.thisTurn`; the question-leak refusal; the four counts; and a Chinese-only needle against an English reply recorded as a fixture defect rather than a model miss. No model call |
| node acceptance-longchat.mjs --out <dir> --restore-snapshot <snap.json> [--restore-persist] | The harness restore. Puts a full snapshot's transcript and derived state back, resets the host's bounded ChatSurface, redisplays the canonical chat and re-applies the fold classes in that order (ADR-0034); a class-only pass cannot cure a stale projection. Needs no turns file and no model call, and does not save the chat unless `--restore-persist` is given |
| node test-acceptance-capture.mjs | The capture boundary with a simulated transport: both the summary and its targeted repair record request, response and elapsed, two consecutive turns keep separate injected blocks, and the block a turn actually saw is read from `injections.thisTurn` rather than the stale `before`. Also the restore sequence - mutate in place, reset the surface epoch, redisplay, re-apply the fold classes - against a fake host, including a partial host, a second host instance and a snapshot without rows. No model call |
| node test-summary-diagnostics.mjs | Failure stages and the retained record, the two state versions, injection recorded only after the prompt is set, the assembly-across-a-commit case, the five warning conditions, and the input-budget default |
| node test-summary-contract.mjs | The batching contract: the floor horizon, committed vs injected coverage, one-entry-per-message requests, the cost of the text that is sent, and the difference between a local budget block and an interface failure |
| node test-summary-budget.mjs | The target/ceiling split and the injection budget: the pure length verdict, the configured budget as the worst case capped by host room, a dense batch accepted over the target, a sparse one under it with equal completed turns, and an over-ceiling body refused with nothing hidden |
| node test-anchor-handoff.mjs | The parked-anchor handoff: the bounded query builder, and a committed anchor that does not fit its budget starts a recorded retrieval handoff while one that fits leaves the query alone |
| node test-recovery-isolation.mjs | A metadata-write failure after the committed state is on the store is a persistence problem, not a model failure; a write that fails before the commit still rejects and hides nothing; the raw original index is its own vector kind |
| node recall-baseline.mjs | Original-text retrieval and packing measurement. `--cassette-requests <file> --model <m> --base <u>` writes the inputs a run will read; `--embeddings <cassette>` replays them and refuses to measure when one is missing; `--adopt-legacy` reads an old `c:`/`q:` cache and reports it as unverified. Three tracks - synthetic probe (default), source-first labelled (`--paraphrases`) and natural capture (`--natural`) - share one scorer and are named in the output (ADR-0033) |
| node recall-baseline.mjs <chat> --natural [--cadence 10] | The natural track: replays the real user messages through `planRetrievalQuery`, folds synthetic batches at the cadence, and scores with the shipped ranker and packer. Reports situation-term, asked-thing and profile recall derived from the prefix history, apart for requests and continuations |
| node test-natural-track.mjs | The natural track's plumbing offline: a real query is the user text, folding hides the batch floors and keeps the newest pair visible, the packer re-echoes no visible source and quotes no continuation command, and the aggregate carries the track name. No model call |
| node recall-embed.mjs | Record the cassette the ruler replays. `--requests <file>` embeds exactly the inputs a run declared; the chat-plus-`--questions` form still builds one by hand |

## Acceptance contract

Default summary cadence is **10 floors**, a floor being one user message and the character's reply -
twenty dialogue message rows. The setting, the report and the hidden count all use that unit; message rows
are the derived number.
A character greeting is not a user turn; an unanswered user message is not completed. Tests of
specific boundaries may explicitly use another interval, but live acceptance must retain 10.

Before a live run, `node runtime-precheck.mjs` must exit 0: the repository, the deployed directory and the
functions the open page has actually loaded have to be the same code. Comparing the disk alone is not enough -
a page loaded before the deploy keeps the old module, and re-reading the served file proves nothing about it.
Comparing against a stale page load costs a whole run: one 421757c run had every deployed file matching the
repo while the page still executed the pre-421757c `parseAnchorChanges`. Exit 2 is unknown, never a pass;
deploy and reload, then re-run.

Live summary probes must save, per call and **including the one targeted repair**: `finish_reason`, the requested
output cap, prompt and completion usage, the raw body and the actual commit result. The harness must recognise
the repair request as its own call kind - the repair prompt does not carry the summary marker, so a marker-only
test drops it, which is how the 421757c long-chat run lost the repair's raw request, response and elapsed time.
The exact injected state block must be saved for **every** turn, not only the batch and final turns, or a probe
turn's reference text is overwritten before it is archived. The runner is versioned (`acceptance-longchat.mjs`
with `acceptance-capture.js`) and its record path is proved offline by `test-acceptance-capture.mjs`; the turns
file, the output directory and credentials stay outside the repository. A field that was not captured is
reported as unknown; a finish reason is never inferred from a token count; reasoning text is not stored.
Every started request carries an id and a running/succeeded/failed status: an in-flight record is not a
failure, and a call that settles between two snapshots is collected by id on a later turn instead of being
dropped. A request that never settled is reported as an incomplete capture, never as a success.

A batch refused for its anchor section is retried once by the host with a targeted repair that shows the model
its own answer and the rejected lines. The repair is a second call with its own recorded cost; a failed repair
still refuses the batch and keeps the original refusal. Replaying a prior run's frozen responses
(`node replay-anchor-evidence.mjs`) is the cheap way to check a protocol change before paying for story
generation again.

Each successful call covers exactly N completed turns and hides their complete messages. Manual calls
obey the same threshold. Freeze the request before dispatch; append/edit outside that batch must not
extend its coverage. The request is assembled from the batch's original messages - one entry per message,
whole text - and the text that is measured is the text that is sent. An over-budget batch is a recorded
block: no model call, no hidden floor, one record per frozen batch and budget, and no increment of the
model-failure counter (ADR-0024). A failed call records its stage - transport, empty body, truncated body,
summary over its accept budget, format - with the input cost and the response status, and a later success
marks it recovered rather than erasing it (ADR-0025). "Injected" means the host was given the block, and
the state version, not the floor count, decides staleness. Run test-summary-contract.mjs and
test-summary-diagnostics.mjs before deploying a summary change.

The detail-survival mode answers "what must the summary keep?" with a measurement instead of an
assumption. A set of small details crosses at least two summary passes; the committed summary - prose,
active anchors and knowledge - is read once, and the details it does not contain are what phase 2 asks
about, so the author's expectation is recorded as calibration and never selects a question. The positive
control comes from what the summary did contain and each negative control is a value the story never
wrote, so an answer is attributed to a channel instead of to plausibility. Channel attribution reads
`injections.thisTurn` - the block the probe turn's own generation set - never the previous turn's block,
which is the instrument defect 76c50d0 fixed. A probe question that contains the needle it tests is
refused before a generation is spent. A needle is matched with a verbatim reading first and a paraphrase-tolerant content-run reading second:
the first live run read three of six details as absent while the channels carried them as "缺角" for
"缺了一角", "左耳白" for "左耳是白的" and "第三夜前" for "第三天夜里" (ADR-0035). Both readings record the
matched token, and the question-leak check stays strict. A needle match is still a machine reading: every
item goes through answer-adjudication.mjs, and a needle-language mismatch is a recorded fixture defect
rather than a model miss. The mode measures only and changes no summary, retrieval or injection behaviour.
A live run on 2026-09-14 (DetailSurvival1, 20 turns, both batches committed, zero failures) re-scores as
摘要保留 4 / 检索取回 1 / 拒绝 1 / 编造 0: five confirmed passes and the never-written value refused.

A restored chat needs the host's own reset path. Replacing `ctx.chat` and re-applying the plugin's fold
classes leaves the previous message roots mounted; the host's bounded ChatSurface allows one contiguous
viewport plus the true tail and refuses an ambiguous projection with `ChatSurface projection has 3 ranges;
maximum is 2`. `--restore-snapshot` (through `acceptance-capture.js`'s `restoreSnapshot`) mutates the
canonical array in place, resets the surface epoch, redisplays the chat, and only then re-applies the fold
classes (ADR-0034). `syncFloorFoldDom` alone is a styling pass and cannot cure a stale projection. The
restore does not write the chat file unless `--restore-persist` is given.

A live check on 2026-09-14 (DetailSurvival1, 43 rows, `bounded: false`) restored a full snapshot with
`{reset: true, redrawn: true, folded: 40}` and the next generation completed normally (731 characters,
zero retries). The three-range case itself was not reproduced: this install has
`chat_virtualization_enabled = false`, and in the unbounded controller a redisplay after the array shrank
did not throw. The reset path is shared by both controllers, so the sequence is verified; the bounded
reproduction remains to be run.

Run at least 30 completed turns to exercise three automatic summaries. Record summary responses
(requested output cap, finish reason, body length, reasoning usage when returned), covered sources,
folded rows, quoted evidence, query, and actual character replies. Keep original text authoritative.
Check one exact historical detail, a changed ownership, an unresolved commitment, and a character
who was absent when a secret was disclosed. A substring recall score is not a narrative-quality score.

Use a new named test chat and verify character, chat identity and extension activation before running.
Wait for the background worker at measurement points without forcing a summary. Record temporary
test settings and restore them after the run. Do not print API credentials or reasoning text.

Offline tests must cover history edit/delete/swipe, late background results, ordinary generation
during a summary, a partial/empty completion, and unchanged main-generation settings. A generation
read must not start or wait for a summary. Quiet fallback recursion remains suppressed.

## Delivery

Review the scoped diff, run checks, commit on the task branch, then use the finish_task.py command
in AGENTS.md to push and verify the remote SHA. Update the PR with actual verification results.
CI runs syntax and offline tests on pull requests to main. Live-model runs are separate acceptance
evidence and are not implied by a green CI check.

## Retrieval experiments

The ruler accepts --paraphrases (question, needle, kind and optional chat), --scorer, --pack,
--evidence, --entries, --embeddings and --dense-weight. --dump and --against compare matched questions.
Use held-out stories before treating measured weights as general defaults. Never commit private
chat corpora, API keys or full provider logs. See 06_retrieval_research.md for past measurements.

`retrieval-audit.mjs --chat-dir <directory> --out <json>` compares queries on identical historical
prefixes with synthetic folding every ten completed turns. `--keep-directives` restores pure
continuation commands to candidate eligibility for a controlled comparison. It never uses a chat's
final summary to evaluate an earlier turn. The file split is deterministic, not evidence that related
chats are statistically independent.

`retrieval-experiment.mjs` separates preparation, service calls and evaluation:

```text
node retrieval-experiment.mjs prepare <labelled-spec.json> <prepared.json>
node retrieval-experiment.mjs candidates <prepared.json> <candidates.json> <vector-cache.json>
node retrieval-experiment.mjs evaluate <candidates.json> <results.json> <rerank-cache.json>
```

The spec names `chatFile`, `chatId`, `model`, `embeddingModel`, and `cases` with `id`, `question`,
and a pre-annotated answer `needle`. The first phase emits `vectorRequests`; the second emits
`rerankRequests`. A service runner supplies a `responses` map keyed by request id, with `rows`
(vector metadata or rerank index/score pairs), `ms`, or `error`. Inputs are hashed exactly; changed
candidates require new calls. Keep first failures separately when retrying. Throttle by the provider's
token limit, not only by request count. These phases never generate a summary or a story reply.
