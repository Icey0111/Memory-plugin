# ADR-0001: The narrative memory architecture

- Status: accepted
- Date: 2026-09-12
- Supersedes: the fact-first extraction architecture described in the retired dev_docs set
- Superseded by: -

## Context

The plugin had one pipeline for everything: extract facts from each completed floor, keep the fact
set current, then decide what to put in the prompt from that fact set. Two problems followed from it.

1. **Retrieval was gated by extraction.** The vector index held extracted facts, and on-demand
   original-text lookup searched those facts first. A detail the extractor did not record - a code
   word, a number inside a sentence, a negation - had no direct entry point even though the chat
   still contained it. Reproduced with a small fixture: the original text contained a code word, the
   extracted fact did not, and the lookup found nothing.
2. **The prompt was the memory.** Every active fact was rendered into the current-state block until
   a character budget ran out, and the acceptance certificate treated "every valid fact appears in
   the prompt" as completeness. That rewards copying and punishes compression, and it grows with the
   story.

The owner's requirement was narrower and clearer than either: the summary exists to keep the story
going, and retrieval exists to find the original wording when it matters.

## Decision

Split the job in two, and let the original text be the only authority.

1. **The original text is archived, versioned and indexed.** Every message version is stored under a
   stable id; the text is chunked (~700 characters, 100 overlap) and indexed lexically now, densely
   when an embedding backend is configured. Nothing has to be extracted before text can be found.
2. **One continuity summary every N floors.** A background model call reads the previous summary plus
   the newly completed floors and writes a compact replacement: where the story stands, the causal
   steps that got it there, who wants what, unresolved commitments, and knowledge boundaries it must
   not contradict. It is bounded by a token budget and rejected if it exceeds it.
3. **Coverage is recorded as a chunk-id prefix.** A summary reports exactly which chunks it read.
   Coverage is validated against the current chunk list, so an edit invalidates it rather than
   silently mis-describing the story.
4. **A floor leaves the prompt only while a valid summary covers all of it.** The newest assistant
   floor and the user turn that produced it are never hidden. If the summary cannot be injected, the
   floors come back in the same call.
5. **Evidence is quoted from the original text, with citations.** Retrieval skips text the prompt
   still carries, cites source id, character span, floor and speaker, and labels the block as quoted
   history rather than instructions.
6. **The model writes prose, the host parses nothing.** The summary is text, not JSON and not a tool
   call. The host owns triggering, storage, retrieval and injection.

## Consequences

- Recall is no longer limited by what an extractor noticed. The acceptance test that pins this asks
  for a detail that exists only in the original text, in a chat with no facts at all.
- The prompt no longer grows with the number of facts. Its resident part is one summary with an
  explicit budget; the rest is quoted on demand.
- Prompt assembly has one entry point, one budget calculation and one place that decides what is
  visible, instead of four layered wrappers.
- The fact model is retained for old chats but is inert: it is migrated and preserved, never read
  for injection.

### What this gave up

- **Per-actor knowledge filtering.** `known_by` used to remove facts a character could not know.
  With facts out of the prompt there is nothing left to filter per line; knowledge boundaries are now
  text inside the summary. See ADR-0002.
- **The completeness certificate.** "Every valid fact is in the prompt" stopped being a meaningful
  target. Delivery is measured instead: summary tokens, evidence tokens, visible raw tokens, what was
  covered, what failed and why.
- **Deterministic, model-free continuity.** The summary now depends on a model call. Its failure mode
  is defined instead: the previous summary and the original floors stay, and the error is recorded.
