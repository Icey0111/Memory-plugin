# Changelog

This file records user-visible release changes. Detailed implementation history
belongs in Git commits and pull requests.

## Unreleased

### Added

- `runtime-precheck.mjs`: a live preflight that compares the repository, the deployed directory and the
  function sources actually loaded in the page, and fails closed when they differ. `deploy-live.mjs --check`
  compares only the disk, and a page loaded before a deploy keeps the previous module.
- `replay-anchor-evidence.mjs`: replays a captured acceptance run's frozen summary requests and responses
  through the current parser with no model call, so a protocol change can be checked before paying for
  another story.
- Continuity anchors accept several original rows as the source of one fact (`来源 raw_15、raw_17`,
  comma, semicolon or slash lists). Every token is validated against the batch and every token is kept.

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
