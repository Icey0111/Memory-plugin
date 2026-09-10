# Overview

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

> Problem statement, goals, scope, non-goals, stakeholders.


<!-- VERSION 2 -->
## v2 - 2026-09-11 00:22:20 - fill in the v5.5 project overview

### Problem

A SillyTavern roleplay outgrows the model's context window long before the story ends. Every simple
answer to that fails in its own way:

| Approach | Failure mode |
| --- | --- |
| Keep the last N floors | Everything older than N is gone, including promises, deaths and ownership transfers |
| Summarise the whole chat into one growing text | Drift: a summary of a summary hardens a paraphrase into a "fact" |
| Retrieve top-k fragments per turn | Decides what is relevant *before* knowing what will matter, and drops irreversible changes without recording that it did |

### Goals

Stay highly compressed *and* macro-strong at the same time:

1. **Never forget what cannot be undone.** A promise, a death, a transfer of ownership, a secret
   learned. This is not a ranking problem and must not be left to a relevance score.
2. **Hold most of the detail.** The ordinary texture of the story stays addressable.
3. **Do not lose the memory logic.** What happened in which order, and which fact replaced which,
   must survive compression.

### Scope

- A zero-dependency SillyTavern third-party extension, `Aetheria Unified Memory v5.5-dev`.
- Automatic extraction of story state from each completed user/assistant pair.
- A canonical, replayable memory store that travels with the chat file.
- Hierarchical summaries, a deterministic memory spine, and a mandatory baseline for irreversible
  facts.
- Retrieval and injection through a single assembler, never by inserting fake messages.
- A plugin-owned world-info ("setting") store with its own import/index/retrieval lifecycle.

### Non-goals

- No brain-like wholesale rewrite of memory. The design is additive and replayable by construction.
- No model training, fine-tuning, or learned memory readout.
- No external memory service: the extension must work with nothing but the chat client.
- No second source of truth for generated text: summaries are built from the original turns, never
  from other summaries.

### Stakeholders

The solo maintainer, plus SillyTavern users running long multi-hundred-floor chats.

### Where to go next

- [01_architecture.md](01_architecture.md) - modules, boundaries and flows
- [04_roadmap.md](04_roadmap.md) and [MEMORY_PLAN_2026.md](MEMORY_PLAN_2026.md) - the plan and its explicit exclusions
- [../README.md](../README.md) - user-facing behaviour; [../ARCHITECTURE.md](../ARCHITECTURE.md) - the v5.4 lineage in full
