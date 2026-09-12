# Changelog

This file records user-visible release changes. Detailed implementation history
belongs in Git commits and pull requests.

## Unreleased

### Added

- `recall-baseline.mjs`: the committed ruler for archive cost and lexical recall, measured on real
  chats. It also takes a hand-written question set (`--paraphrases`), which is the instrument the
  dense-retrieval decision waits on. Results and limits are in ADR-0004 and ADR-0006.
- Continuity anchors: promises, ownership, secrets, identities and life states are stored separately,
  fed back to the summarizer verbatim every pass, and re-injected every generation. An anchor the model
  stops mentioning is kept and flagged; only an explicit resolution removes it.
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

### Fixed

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
