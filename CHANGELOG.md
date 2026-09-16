# Changelog

This file records user-visible release changes. Detailed implementation history
belongs in Git commits and pull requests.

## Unreleased

### Added

- The detail-survival acceptance reports whether the evidence quotation contained the detail itself, not only
  whether a run of it matched. Over the 37 recorded runs, 73 of 82 positive probes had the evidence channel
  matched but only 53 were the needle itself - 20 were a two- to four-character run - and 12 of the 28 recorded
  `retrieval-recovered` outcomes rested on one of those. The summary is a derived paraphrase, so the tolerant
  match stays right for it; the evidence block is a quotation of the original, and `evidenceFull` is that
  reading. The report prints it beside the recovery count.

- The rerank diagnostics record what the stage changed, not only that it ran. `rerank_cost` now carries
  `shortlist`, `moved` (shortlist positions whose occupant changed), `top1_changed`, and the first three
  candidate sources before and after the reorder; a failed call records `moved: 0` rather than leaving the
  reader to infer it from the error. Ten live runs recorded `rerank_used` and its cost and nothing about the
  order, so none of them could say whether a configured reranker had reordered the prompt at all. The metric is
  a pure function of the two orders, so it adds no provider cost. `max_drop` and `max_rise` report the furthest
  any candidate fell below, and rose above, its fused position.

### Changed

- The cross-encoder rerank stage may no longer lift a candidate more than four places above where the fusion
  ranked it; demotion stays unbounded. Measured on 22 live captures, the stage was replacing essentially the
  whole shortlist and the fused first candidate lost the head in every single one, while the answer-level on/off
  comparison over the same fixture came out even. Bounding the *fall* was implemented and measured first and is
  not what ships: it held exactly (`max_drop: 4` in all 39 captures) but it handed the opening-instruction row
  back into the evidence slots - three of four probes in one run, against one of 44 probes unbounded - because
  clearing that row out of the head needs a large demotion. Bounding the rise keeps both properties: the fused
  first candidate kept the head in 14 of 37 captures against none of 22, and the instruction row stayed out.
  Promotion of a row the fusion ranked far down is now limited, which also limits the situation channel's
  late-ranked rescue; that interaction is not yet measured.

### Fixed

- A configured reranker no longer makes the host raise a 404 error on every generation. A provider that serves
  rerank only on its own path answers the OpenAI-compatible `{base}/rerank` with 404 **every time**, and the
  stage's retry is what makes the call work - but the retry runs through the host's own
  `generate_chat_completion` shim, so the host surfaced that expected 404 as "Custom OpenAI endpoint failed with
  status 404" while the story kept being written. The path that answered is now remembered per base URL and
  tried first, and the discovery is written to `narrative_rerank_native_paths` so it survives a reload: the
  probe happens once per install rather than once per page load. A later 404 on the remembered path clears the
  memory and probes again.

- The detail-survival acceptance refuses a run whose fold hid only the first summary batch. Two runs had their
  last batch's request never settle, so `folded` was 21 rows for twenty finished floors, the last ten floors
  stayed visible, and three probes were answered from a transcript that still showed the needles. The phase-1
  gate passed them because it only asked whether any row had been folded; it now requires the fold to cover the
  phase (`folded >= 2 x completeTurns`) and reports that a batch never committed. The greeting need not be
  folded, so a run that leaves it visible still passes.

- The cross-encoder rerank stage reaches providers that serve rerank on their own path instead of the
  OpenAI-compatible `/rerank`. A provider can list a rerank model and still answer `{base}/rerank` with 404:
  Aliyun's MaaS answers `{origin}/api/v1/services/rerank/text-rerank/text-rerank` for the same key and the same
  model (`qwen3.7-text-rerank`), with `input`/`parameters` in and `output.results` out. The stage retried
  nothing, failed open, and recorded `rerank_used: false`, so a configured reranker read as inert - which is how
  the optional stage was judged here. Only a 404 triggers the retry; a 401/429/5xx is a refusal at the right path
  and is reported rather than re-addressed. The diagnostic `rerank_cost.transport` names which path answered.
  Verified end to end against the live provider: 330 ms, 276 provider tokens, and then confirmed inside a
  generation (2026-09-15/16, runs 2e-2h): `rerank_used: true`, `transport: native`, `rerank_error: null` in all
  24 captures, 14-24 documents and 2,760-10,454 provider tokens per call - one call per generation, and none at all
  until at least two candidates the prompt does not already show exist. The same stage now leaves the WebView's `fetch` behind for the host's native HTTP shim, as
  the embedding path already does: a provider request from the WebView is blocked by CORS, and the live run showed
  the stage failing with "Failed to fetch" in 34 ms without reaching any provider. The shim reports a provider
  failure as a thrown error naming the status, so the adapter returns that number as the response status and only a
  named 404 can trigger the path retry; an unnamed failure is reported as 502 rather than guessed.

- A quoted evidence source now records the candidate's own extent (`spanStart`/`spanEnd`) and the channel
  regions the window was allowed to follow (`seats`). Measured on the 2026-09-15 runs: ten needle occurrences fell
  63-207 characters outside the span quoted for the row that carries them, and a full sentence-end extension
  reaches none of them, so the shape is a window placed at one end of a long row rather than a cut one punctuation
  short. Without the regions in the record such a miss cannot be attributed, which is what `seats` now fixes.

- A turns file that declares its negative controls under the wrong key is refused instead of read as having
  none. `parseTurnsFile` takes them from `negativeControls`; a file that used `negatives` parsed clean, reported
  `negativeControls: 0`, and produced a "0 fabricated" acceptance reading from a probe set that had nothing to
  fabricate - which is what every run recorded before 2026-09-16 did. The driver stops on parse errors, so the
  mis-keyed list now fails before any model call.

- The detail-survival acceptance no longer reads a probe answer that the transcript still shows as a fabrication.
  `detail-survival.needleSources` records, against the phase-1 snapshot, whether a declared needle is still in an
  unfolded row and whether any model-written row carries it; `summarizeDetailSurvival` reports those as
  `visible-in-prompt` and `instruction-only` instead of counting them as memory. Re-read against the five recorded
  2026-09-15 runs this removes run 1's single fabrication and both of its `summary-kept` reads: its second batch had
  been refused, so rows 21-40 were still in the prompt and the model answered `落雁驿` and `阿箬` from the
  transcript. The helper reports `known`, so a caller with no transcript keeps the ordinary reading - the first
  wiring read a missing chat as "the model never wrote it" and mislabelled a real recovery. Every outcome now
  also carries the exact token the reply matched, how it matched and how much of the needle it covered
  (`token=臂上(run2, 67%)`), so a tolerant two-character run is visible instead of hidden behind the boolean. A
  census over the six recorded runs found the floor carries 6 of 24 matches and every one shortens the needle; the
  candidate rule that forbids dropping a content character was measured and rejected because it removes two true
  positives, including that run's only retrieval recovery. A frequency filter (ADR-0046's specificity idea) was
  measured next and rejected as well: the true `卷尺` occurs in 9 of 41 rows while the false `臂上` occurs in 2,
  and every token occurs only in rows that already carry the full needle. Run length, position and adjacency were
  rejected the same way - the difference is the referent, not the text. Measured: `node run-tests.mjs` 50/50 and
  `node check-syntax.mjs` 99 files.

- The opening greeting is hidden with the first committed summary batch instead of staying visible inside the
  hidden block. A chat's first row is the character's greeting, which no user turn contains; coverage is a prefix
  that starts there, so leaving it visible made the hidden rows begin at floor 1. The host draws one "context
  starts here" line (SillyTavern/TauriTavern's `.lastInContext`, `chat.length - openai_messages_count`), so on a
  live chat with a committed ten-turn batch the line landed on the last hidden row instead of the first visible
  one: the faded block appeared to be in context and the visible greeting above the line appeared hidden. The
  greeting now folds under the same every-chunk-covered rule as any other row, and only once a complete turn is
  covered, so a coverage claim that names nothing but the greeting hides nothing (ADR-0047); it still does not
  count toward the ten-turn cadence. Measured: `node run-tests.mjs` 50/50 and `node check-syntax.mjs` 99 files;
  the natural track's fold already excluded the greeting, so the 1,296-turn corpus reading is unchanged by
  construction.

- A quoted window no longer slides off every region the channel that picked the span voted for. Window placement
  scores candidate windows by how many of the question's own words they carry, which is a proxy for where the
  answer is; a move that left no channel region inside quoted a different part of the row than the one the slot
  was spent on. On a held-out chat the lantern row was quoted from offset 128 while its needle sat at 41, because
  the question's words pulled the window forward and off the anchor at the head. Measured: the ten-probe labelled
  gate is unchanged at **9/10**, and the 1,289-turn corpus paired check is **0 turns worse and 4 better**
  (character-description readings 101 -> 105). The archive-wide variant of the same held-out control loses one
  probe, which is the honest cost of refusing the move.

- A quoted window opened on the question's own word now reaches back a few characters when that word sits at
  the window's **head**, so the modifier phrase that answers the question is not cut off: "一个穿灰袍、拄藤杖的
  老头" now falls inside the quote for "那个老头最显眼的穿着是什么", which takes the labelled probe set from
  8/10 to **9/10** strict needle readings (10/10 by the tolerant matcher) with the 1,289-turn corpus paired
  check at **0 turns worse and 3 better**. The reach is deliberately scoped to a word at the window's head: the
  same reach applied to a window whose answer sits in its last characters destroys that answer, and
  `test-evidence-window` section 4 is the guard for that direction.

- A quoted original window now follows the region the channel that picked the span actually found, and a
  character's introduction row is a candidate of its own (ADR-0045, N41). On a real chat the reply had
  described a character's appearance confidently and wrongly, because the describing paragraph - which comes
  *before* she is named - was never quoted for a question about her appearance. Window terms are filtered by
  story frequency (a word the whole story uses cannot move a window), a character's own name is never a window
  seat, and the descriptor run that defines a description is chosen for density rather than for count in a wide
  window. A ten-question labelled probe set from that chat went from 2/10 to 8/10 needles inside a quoted
  window, or **10/10 by the project's own paraphrase-tolerant reading** - both strict misses are the matcher's
  two-character floor with the answering fact inside the quote (粉色长发 in the quoted introduction row,
  "灰袍、拄藤杖的老头" at the head of the row-12 window). The channel's ranking score is unchanged, and its pick table
  was re-measured by hand (43 rows reproduced exactly; 3 moved, none better or worse). A row that mentions
  another candidate character earlier than the name it would introduce is that character's row and no longer
  counts as this one's introduction - that qualification removed 9 of 25 introduction candidates, all of them a
  passing reference inside somebody else's introduction, at the cost of one row that introduces two names. The
  candidate is granted only for names the knowledge block tracks, and the wider clothing-and-face vocabulary
  places the window without scoring: scoring with it changed which chunk the channel picks and cost four
  description readings over 1,258 corpus turns. Over that corpus the recall proxies end at situation-term 85.5%,
  asked-thing 65.0% and character-described 27.4% (Chinese chats 81.1%), against 85.0% / 64.6% / 26.6% before.
- The evidence window rule (ADR-0037) was inert in every shipped prompt: the runtime called `packRawEvidence`
  without `query`, so the term list was empty and the rule returned immediately, while both harnesses that
  accepted the change passed the query themselves. The runtime passes it now and a runtime-level test through
  `buildNarrativeContext` fails if it stops (ADR-0037 correction, N38). The first live reading of that run was
  corrected too: it had been taken from the previous build's diagnostics instead of the probe turn's own
  `injections.thisTurn`.
- A batch that never committed is no longer read as a merge (`committed`), and a probe run whose floors were
  never folded is marked unattributable (`attribution`) instead of counting every answer as fabricated - a
  forced run had printed five fabrications that were nothing of the kind.
- The offline dense ruler can no longer measure with vectors it cannot replay. A missing vector used to
  remove the dense channel for that question while the run still printed a dense header, so a lexical
  number was read as a dense one; the run now declares every input it will read, refuses to print a table
  when one cannot be supplied, and exits non-zero. A paired comparison likewise refuses two dumps whose
  recorded vectors differ, because a difference in the ranking rule cannot be separated from a difference
  in the embeddings.
- A host metadata-write failure that lands after a summary committed is recorded as a persistence problem
  (`persist_error`, stage `metadata_write`) instead of a model failure, and the original-text vector index is
  classified as `raw` rather than `memory`, so a raw query keeps its own threshold.
- The Tauri Embedding transport splits one insert into provider requests of at most 20 inputs. A
  DashScope-compatible qwen3 Embedding route rejects a larger batch, and the caller's 40-chunk insert made the
  whole original-text index rebuild throw: the index record was deleted and dense recall stayed off with only a
  diagnostics reason to account for it (ADR-0010).
- The knowledge-boundary block reports what it injected and what the budget left out, the way the anchor block
  already did. It used to return only its surviving text, so an accepted boundary could be dropped on every
  generation with nothing in the trace to show it: the live chat carried four entries at the 200-token default
  and injected exactly one, and one of the three left out restated the same negation that the anchor budget had
  already parked. The panel states the counts, the warning names the dropped entry, and the read-only report
  runs the same selection (`knowledge_injected`, `knowledge_parked`, `knowledge_parked_terms`;
  `selectKnowledge`).

### Changed

- The settings panel now names the records it parked instead of only counting them (three per list, each cut to
  a recognisable length), and it states a live statement that has **no subject** apart from one that merely had
  **no carrier** - the first cannot be resolved by anything, the second was not restated. Both conditions were
  already in the read-only report and neither was on the screen. The line is built by `anchorPanelText`, a pure
  function, so what the panel says can be read offline (Issue #2 step 5).
- A summary body refused for `format` or `over_budget` earns one targeted repair, recorded as `body_repair`
  with its own cost, checked against the input budget before sending, and re-evaluated against the same checks
  as the first answer; the request now also states the hard ceiling and its consequence, which it never did.
  `input_budget` stays an unrepaired local block (ADR-0042).
- A new install starts at a 60,000-character summary input budget instead of 40,000: the only recorded block
  needed 43,658 characters for a ten-turn batch whose replies averaged 3,953 (ADR-0043).
- A trimmed evidence quote follows the question's **words** first and the ranker's n-grams second, so a head
  window that matches only fragments of the question no longer keeps the answer outside its own quote
  (ADR-0041).
- The visible settings now expose only controls with a reader: 42 retired v5.4 controls (extraction,
  baseline, evidence, temporal-channel and recall tuning) and a self-check button with no handler are gone,
  and the surrounding text describes the narrative pipeline instead of the retired extraction stack. The
  narrative panel states a summary over its soft target, a metadata-write failure after a commit, and the
  parked anchors that were folded into the retrieval query.
- The summary budget is now a soft target with a separate emergency ceiling
  (`narrative_summary_ceiling_tokens`; `0` derives it from the target). A summary body over the target
  but within the ceiling is accepted and recorded as over-target; only a body past the ceiling is
  refused, and a refusal still hides nothing. Dense batches therefore get more room than a fixed
  600-token rejection allowed (ADR-0032).

### Added

- `--detail-survival`: a repeatable acceptance mode that reports which of the two channels carried each
  declared detail - with a paraphrase-tolerant needle matcher, an answer-adjudication row per item, one probe
  per turn with the phase-1 state restored between them (`perTurn`) and an `independence` reading, and a
  frozen `<out>/turns.fixture.json` written before the first model call so any run can be re-run as the same
  fixture (ADR-0033, ADR-0035, ADR-0038, ADR-0040).
- Every build records the ranking it was given (`evidence_candidates`) and what the packer did with each
  candidate (`evidence_trace`, including whether an included quote had to be shortened), bounded to 40 rows
  with counts over the whole record (ADR-0039).
- `acceptance-capture.js` restores a saved chat through the host's own reset path - reset the surface epoch,
  redisplay the canonical chat, re-apply the fold classes - because replacing the array leaves stale message
  roots mounted (ADR-0034).
- `embedding-cassette.mjs`: the ruler's dense vectors are a transport cassette. Every entry is
  keyed by the request that produced it - model, base, role, the provider task the plugin derives from them
  and the exact input text - so a changed retrieval prefix, model, base or task is a miss rather than a
  silent replay of a vector computed from something else, which the old `c:<hash>` / `q:<question>` keys
  could not tell apart. `recall-baseline.mjs --cassette-requests <file> --model <m> --base <u>` writes the
  inputs a run will read and `recall-embed.mjs --requests <file>` embeds exactly those, so a run and its
  recording cannot drift; a legacy cache is read only under an explicit `--adopt-legacy`, and every report
  and dump from one carries `provenance legacy-unverified` (N28).
- `answer-adjudication.mjs`: a graded answer becomes a record instead of a verdict. Each row carries the
  machine verdict, whether the assembled prompt carried the fact, whether the reply conveys it, and whether
  the probe itself is broken; the classification (`fixture-defect` / `prompt-insufficient` / `model-error` /
  `scorer-false-negative` / `confirmed-pass` / `scorer-false-positive`) and the memory credit are derived, so
  a row cannot disagree with its own evidence. A pass requires sufficient prompt evidence: a correct answer on
  an empty prompt is recorded as ungrounded and classified against the prompt, not credited to memory. Applied
  to this session's sixteen graded cells: nine machine misses contained **no model error at all** - one was the
  grader and eight had no evidence in the prompt - while three machine hits were fixture defects (the fact is
  on the character card) and two correct answers were ungrounded (N27).
- The second error direction of the ledger is reported: the quoted evidence rows that only a *retired* statement
  names (`superseded_evidence`, `superseded_evidence_sources`, `superseded_source_pool`). An anchor operation
  retires the statement, not the row it was read from, so a row can stay active, stay ranked, and carry the old
  version of a fact that was explicitly updated. It is labelled a risk indicator rather than a verdict, because
  the evidence header states that historical states need not be current. Measured on the live chat: 10 retired
  statements name 7 rows that no live statement cites, all 7 still active, and a quoted span from that pool
  appears in both product-path turns sampled (N26).
- Every build resolves each live ledger statement to a carrier: its own injected anchor or boundary line, a
  quoted original row, or nothing. Folding, the anchor budget and the boundary budget each answer a local
  question, and each can report success while a statement the ledger still calls live reaches no part of the
  prompt - measured on the live chat, where one negation was parked as an anchor *and* dropped from the
  boundary block in the same turn. The count with no carrier is reported, the dropped statement is named, and a
  warning states it (`required_total`, `required_line`, `required_source`, `required_none`,
  `required_uncarried`; `ledgerCarriers`, N25). It is a lower bound: the summary prose is not read.
- The shipped retrieval path is written down once (dev_docs/01_architecture.md) and reported per generation as
  `retrieval_config`: scorer, fusion `k`, each channel's weight and the packer policy. "Dense was on" reads the
  same at the shipped 0.1 vote and at 1.0, and the packer's policy was not stated in the trace at all. The
  submodular packer is named as the ruler-only experiment it is, and the runtime passes `SHIPPED_PACK_POLICY`
  explicitly instead of inheriting a default, so a change to the experiment cannot change a live prompt (N23).
- `acceptance-capture.js` and `acceptance-longchat.mjs`: a versioned, reusable long-chat acceptance runner.
  The capture boundary records the raw request, response and elapsed time of the summary call *and* of its
  targeted repair - the repair prompt does not carry the summary marker, which is how the 421757c run lost it -
  and it saves the injected state block for every turn instead of only at batch boundaries. Chat text, raw
  responses and credentials stay outside the repository; `test-acceptance-capture.mjs` proves the boundary
  offline with a simulated transport.
- `runtime-precheck.mjs`: a live preflight that compares the repository, the deployed directory and the
  function sources actually loaded in the page, and fails closed when they differ. `deploy-live.mjs --check`
  compares only the disk, and a page loaded before a deploy keeps the previous module.
- `replay-anchor-evidence.mjs`: replays a captured acceptance run's frozen summary requests and responses
  through the current parser with no model call, so a protocol change can be checked before paying for
  another story.
- Continuity anchors accept several original rows as the source of one fact (`来源 raw_15、raw_17`,
  comma, semicolon or slash lists). Every token is validated against the batch and every token is kept.

- `recall-baseline.mjs --span-cost`: the other side of the evidence budget's allocation, as a switch. It
  charges a span its own cost instead of the fair share, which keeps the tail of an anchor that slightly
  overruns its share and reaches fewer messages when anchors routinely overrun it (`packRawEvidence`
  `spanCost`, off in the shipped path). Measured: on the labelled English set it is a small win (8/15 to
  9/15 answers, same 5.00 messages reached); on a real Chinese chat it is a loss (100% to 97% recall over 35
  auto-labelled unique needles, 891 to 979 tokens per query), and it reaches four messages instead of five on
  the CJK fixture, because half of that chat's anchors are over the 200-token share. It stays off.
- `recall-baseline.mjs`: the committed ruler for archive cost and lexical recall, measured on real
  chats. It also takes a hand-written question set (`--paraphrases`), which is the instrument the
  dense-retrieval decision waits on. Results and limits are in ADR-0004 and ADR-0006.
- The ruler reports, per countable question, the lexical and fused entropy and top-1/top-2 margin, the
  answer's rank, the rule that dropped it and the quoted slot that carried it. `--dump` writes a run to
  JSON and `--against <dump>` compares two runs as paired questions with an exact McNemar test, and
  `--scorer`/`--pack` switch the rule under test. A question entry may name its chat, so its needle is
  checked for uniqueness where it matters - inside that chat - and for containment in one chunk.
  `--evidence` and `--entries` pin the evidence budget and the slot count, which is how the budget frontier
  below was measured.
- Continuity anchors: promises, ownership, secrets, identities and life states are stored separately,
  fed back to the summarizer verbatim every pass, and re-injected every generation. An anchor the model
  stops mentioning is kept and flagged; only an explicit resolution removes it.
- The measurement pass: the paraphrase set grew to 59 questions, oblique-question recall measured 45%
  (and evidence span precision 15%) on the questions that can be judged, the archive measured 3.8 KB per
  floor with zero superseded versions, and the resident block was shown to stay inside its budget across
  ten lossy summary rewrites. Decisions: the dense channel is justified and already exists (ADR-0010),
  the archive is not pruned (ADR-0011), boundaries stay a record rather than a filter (ADR-0012).
- Diagnostics now report how many retrieval candidates came from each channel, so the dense half can be
  A/B'd from the panel, and an unrepeated knowledge boundary is announced like an unrepeated anchor.
- Knowledge boundaries: who knows what, and who explicitly does not, is its own section of the
  summary - stored, fed back to the summarizer verbatim, and re-injected every generation with its own
  budget. It is a record the panel can show and a test can assert, not enforcement.
- The fact subsystem is retired with it: the extraction pipeline, the prompt assembler, the recall
  path, the cold-snapshot cache, the length certificate, the quality metrics, the reranker, the
  retrieval self-check and the baseline builder, plus the 33 test files that pinned them. index.js went
  from 3444 to 2055 lines; the repository carries 67 source files where it carried 111.
- The legacy generation runtime is retired rather than gated: the v5.4 interceptor, its prompt
  assembly, the extraction and recall-prefetch events, the startup reconciliation, and six settings
  controls that no longer had a handler are gone.
- Two quiet failures are now counted and announced: a summary job that keeps failing, and an
  unsummarized tail that keeps growing. Neither breaks the story, and both used to be invisible.
- Narrative continuity summary: a background pass every N floors writes one compact summary of where
  the story stands (default budget 600 tokens), replacing the previous summary rather than growing it.
- Original-text archive and retrieval: every message version is kept, chunked and indexed, and
  evidence is quoted back on demand with its source id, character span, floor and speaker (default
  budget 1000 tokens).
- Settings panel "剧情摘要与原文检索" with live diagnostics, "update the summary now", and
  "restore the original text".
- `check-syntax.mjs`: the syntax gate discovers the files it parses instead of using a hand-written list.

### Changed


- The summary prompt states the update/end distinction: an update archives the old value, so the same number
  must not also be ended in one batch; an end means the whole fact no longer holds. The trailing-label spelling
  a model produced ("结束 A1 旧状态") still refuses and is fixed by the repair, never by executing a
  label-stripped end.

- A refused `【锚点变更】` section earns exactly one targeted repair, and the host keeps what the first answer
  already validated: valid operations, the summary body and the knowledge boundaries are frozen, the repair
  supplies only replacements for the rejected lines, and kept plus replacement lines are re-parsed as one batch.
  A repair that answers "无" can no longer erase the valid content. The repair request is budget-checked before
  it is sent, original and repair costs are recorded apart, unavailable usage is marked unknown, and a repair
  transport failure keeps both the attempt and the original refusal. Both paths share one final current-state
  check.
- An unmistakable anchor operation written without its heading is recovered and reported as `inferred`;
  uncertain text still refuses the batch.
- The summary prompt teaches the multi-source shape and adds three ledger checks: extract the needed facts when
  the ledger is empty, check other live values for a contradiction when updating, and keep character belief and
  unproven guess distinct from objective fact. None of them mandates an add.
- The `anchors_same_subject` warning now states that it counts records sharing a label; it is not a
  contradiction detector.

- **Anchors change by numbered operation.** The summarizer is shown the live ledger with a short id per
  line (`- A1 | 类型 | 主体 | 陈述`) and answers with a change list instead of restating everything:
  `更新 A3 | 来源 raw_77 | 新陈述`, `新增 | 类型 | 主体 | 来源 raw_79 | 陈述`,
  `结束 A5 | 来源 raw_80 | 原因`. An anchor nobody mentions is left alone, and a subject is a label again -
  "新增" never replaces a value, so two facts that share a subject both stay. Every reference is checked
  before the summary and the ledger commit together: an unknown id, a source outside the batch, two
  changes to one record, a record that moved since the request, or a batch text edited during the call all
  refuse the batch, leave the original floors visible, and are reported per line with the rule they broke.
  The panel shows the last batch's operation counts, the refused lines, the live values that share a
  subject, and the retired records with their sources. The retired window is 40 records and is stated in
  the panel rather than implied to be complete.
- Historical retrieval focuses on a pending user request while scene names remain available to the
  character-description channel. Continuation keeps the recent-scene query. Pure continuation commands
  remain archived but cannot consume historical evidence slots.

- Prompt injection is two blocks again: the continuity summary as the current-state block, and quoted
  original text plus relevant setting entries as the reference block. The fact set is no longer
  rendered into the prompt.
- A floor leaves the prompt only while the accepted summary covers every chunk of it; the newest floor
  and the unsummarized tail always stay visible.
- The extension has one generation entry instead of four layered installers.
- The retired fact set (memories, slots, hierarchical summaries) moved out of the chat file into the
  derived record. Measured: 53-188 KB less per chat, and it is rebuildable from the replay log, which
  stays in the chat file. An install with no derived backend keeps everything as before.
- Original-text retrieval is scored with BM25 (k1 1.2, b 0.75) instead of a presence-only IDF sum, so term
  frequency saturates and length is normalised. Measured paired on 52 hand-written questions: one question
  moved and none were won, so recall is unchanged; on the probe set the same 100% recall costs 737
  evidence tokens a query instead of 904. The change buys cost, not recall, and is reported that way.
- The dense retrieval channel gets a weak vote instead of an equal one: `rankRawChunks` fused both channels
  at 1/(60+rank+1), and on 52 hand-written questions that equal vote measured worse than lexical retrieval
  alone (56% against 60%), because dense alone scores 37%. It raised candidate coverage from 96% to 98% while
  lowering what survived into the prompt. The dense weight is now 0.1 and the evidence slot floor is 333
  tokens rather than 400, both measured against the configured embedding backend. End to end on the same set:
  answer-in-context 56% -> 69%, oblique recall 53% -> 69%, span precision 14% -> 23%, evidence 930 -> 893
  tokens a query - 7 questions won, none lost, p=0.016 (ADR-0015).
- A cross-encoder rerank stage for the original-text candidates, off until a model name is set in
  `narrative_rerank_model`. It reranks the fused shortlist once per generation, reuses the embedding
  connection's endpoint and key, and is fail-open: a missing model or a failed call leaves the fused order in
  place and records the reason in the diagnostics. Measured offline on 52 hand-written questions, reranking
  raises answer-in-context from 69% to 87% with `jina-reranker-v3` (10 questions gained, 1 lost, p=0.012) and
  to 81% with `jina-reranker-v2-base-multilingual` (7 gained, 1 lost) - and it is 22 evidence tokens cheaper,
  because the packer spends its budget on better-ranked spans (ADR-0016).
- `recall-embed.mjs` builds the vector cache the ruler measures the dense channel with, using the same chunk
  text and retrieval task the plugin embeds with. The key comes from a file or an environment variable and is
  never written or printed.
- The evidence slot count is derived from the evidence budget - one slot per 333 tokens, between one and
  six - instead of being fixed at four. Swept on 52 hand-written questions: a share below about 333 tokens
  cannot cover a merged message envelope, and a share above about 500 buys nothing, so at 1000 tokens four
  slots was quoting twice as much junk for the same answers. Two slots at the shipped budget measures 63%
  answer-in-context against 62%, 886 evidence tokens against 932, and 32% span precision against 15%; a
  larger budget now buys more slots rather than longer quotations (1600 -> 69%, 2400 -> 75%). ADR-0014.
- Budgeted submodular evidence packing (arXiv 2607.00725) is implemented behind the ruler's `--pack`
  switch and is deliberately not the default: it measured 54% answer-in-context against the greedy
  packer's 62% on the same 52 questions (7 against 3 discordant, p=0.34), trading oblique recall
  (60% -> 49%) for entity recall (71% -> 86%) at 6% fewer tokens. No ADR: a layer has to win its A/B.

### Fixed

- Anchor operations without bullets or on a section heading's line are no longer silently skipped.
  Missing/empty required anchor sections refuse summary coverage; explicit no-change answers are reported
  separately. Long or punctuated labels are accepted, malformed fields still refuse the batch, and new
  anchor statements retain their full conditions instead of being cut at 240 characters.

- Summary cadence is now a strict complete-turn batch: wait for N turns, summarize exactly N, then hide
  only those complete turns. Backlogs cannot enlarge a batch; input limits cannot cut it mid-message.
  New messages stay outside an in-flight request. Misaligned legacy coverage is invalidated and unfolded.
  Manual summary calls obey the same threshold; the input budget is exposed for oversized batches.
- The summary request is assembled from original messages rather than from retrieval chunks, and it is
  measured as the exact string that is sent. Measured on the chat that actually failed: 53 chunks became
  21 messages and 30,300 characters became 23,742 (the overlap was paid again at every cut). A local
  budget shortfall is now a block - no model call, no hiding, one record however often it is re-checked -
  and it is no longer counted as an interface failure (ADR-0024).
- The injected state block counts floors: a first batch of ten turns now reads "current as of floor 10"
  instead of floor 21, and it updates on the next assembly. The panel reports the committed coverage and
  the coverage the last injection carried as separate numbers with separate revisions (ADR-0024).
- A failed summary says which failure it was - transport or provider error, empty body, truncated body,
  summary over its own budget, or anchors without prose - and keeps the last one, its input cost and the
  response status after a retry succeeds, marked recovered. Staleness now compares content versions rather
  than floor counts, "injected" is recorded only once the host has the block, and a summary that commits
  while a prompt is being assembled re-composes that prompt instead of leaving the rows it hid neither
  summarized nor visible (ADR-0025).
- The unsummarized tail is reported as a condition (accumulating, summarizing, failing, blocked, backlog)
  rather than a size. A tail below the cadence never warns however large it is; the old 4,000-token
  threshold no longer raises a fault on its own.
- `narrative_input_chars` defaults to 40000 for new installs, the measured size of a ten-turn batch. An
  install still on the old 18000 default keeps it and is told, not silently changed.
- Continuity anchors now hold one live value per subject. A newer statement about the same subject replaces
  the older one and the replaced entry is kept in a history rather than deleted, so the block can no longer
  carry both "the knife is in your hand" and "the knife is locked under the well". The summarizer is asked
  for the subject field, and the injected block is filled evenly across kinds and newest-first inside each
  kind instead of in the order the model happened to write lines — measured on a live ledger, the old cut
  kept facts averaging 165 seconds old and dropped ones averaging 1024 seconds old. The default anchor
  budget rises from 300 to 600 tokens, and whatever still does not fit is reported instead of being
  summarised as "N omitted" (ADR-0026).
- A subject written two ways is one subject: identity is normalised (Unicode, whitespace, a dropped `/`
  suffix), so a fact like "心脏石植入者/制造者" and "心脏石植入者" can no longer survive twice, and the
  summarizer is shown the canonical spelling. Containment matching was measured and refused — it merged five
  genuinely different subjects to catch that one duplicate. The fixed kind-priority table is gone as well: it
  ranked three of the nine kinds one live run produced, so which kind is served first is now decided by
  recency (ADR-0027).

- Knowledge boundaries accept bracketed, pipe-delimited and `character/state: fact` forms consistently;
  old format duplicates are normalized while distinct same-pass assertions remain visible.
- Recall diagnostics count only the quoted span. User-target coverage is reported separately from
  query-term coverage; continuation is marked inapplicable. Rerank diagnostics include elapsed time,
  estimated input tokens and provider usage when returned, including attempted-call cost on failure.

- The evidence block no longer quotes the same text twice, and no longer quotes text the prompt is
  already showing under another row id. A 100-floor run whose user turn was always "继续。" spent all five
  slots on five copies of that same fifty-character row: 366 tokens of filler and none of the story.
  Replaying the state a prompt is really built from - the chat ending at the user's row - reproduces it on
  the lexical path alone, and the same replay at floor 50 packs five story passages for 920 tokens. The
  live block at floor 51 agreed after deploy (ADR-0022).
- The settings panel now mounts. `parent.prepend` had been moved into the renderer, where the only
  `parent` in scope is the browser's `window.parent`; the panel was never attached and every scheduled
  pass threw, which then replaced the diagnostics with the error. Found by the live acceptance run.
- The same continuity anchor spelled `- 身份 | ...` and `- [身份] ...` no longer becomes two anchors.
  Measured on a 40-floor run: 11 real anchors were being stored as 19, and the panel warned that eight of
  them had "not been repeated".
- The background summary budgets for a reasoning model: 5,798 of 6,569 completion tokens in one measured
  call went to reasoning, the body came back empty, and at the old 2,048 default the summary never
  formed. The default is 8,192 and the empty-body error now names the cause (ADR-0013).

- A summary that no longer matches the history (after an edit, a swipe, a delete or a branch change)
  is dropped and its floors are restored in the same call, instead of being injected as if current.
- A background summary that finishes after the user has changed chats is discarded instead of being
  written into the wrong chat.
- A diagnostics read creates no stored keys, so it cannot put an empty object back into the chat file.
- Edited or folded floors can no longer stay hidden with nothing standing in for them.
- Evidence packing merges overlapping spans instead of discarding the second as a duplicate, gives every
  entry a share of the budget, and trims a span that does not fit rather than dropping it. Measured on a
  hand-written question set: oblique-question recall 17% -> 67%, in-words recall unchanged at 93-100%.

### Deprecated

- The fact store, the context assembler, the memory spine and the extraction pipeline are retained for
  old-chat compatibility only. They are inert while the narrative pipeline is on.

### Removed

- The layered summary stack: hierarchical summary runtime, digest, consistency, provenance,
  finalization, scene boundaries, repetition compression and per-actor fact filtering, together with
  their settings keys and seventeen test files.

### Security

- Quoted evidence is labelled as quoted history, not instructions.
