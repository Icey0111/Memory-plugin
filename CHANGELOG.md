# Changelog

This file records user-visible release changes. Detailed implementation history
belongs in Git commits and pull requests.

## Unreleased

### Added

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
