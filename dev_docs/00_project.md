# Project

<!-- Versioned & append-only: never edit past versions; newest is last. -->

<!-- VERSION 1 -->
## v1 - 2026-09-12 18:10:47 - state the problem, the two products, and the boundaries

### Problem

A SillyTavern roleplay outgrows the model's context window long before the story ends. Every simple
answer fails in its own way:

| Approach | Failure mode |
| --- | --- |
| Keep the last N floors | Everything older than N is gone, including promises, deaths and ownership transfers |
| Keep every fact in the prompt | The prompt grows until the host's ceiling trims something the story needed |
| One growing summary of the whole chat | Drift: a summary of a summary hardens a paraphrase into a fact |
| Retrieve top-k fragments per turn | Decides what is relevant before knowing what will matter, and reports nothing when it finds nothing |

The failure that matters most is quiet: text leaves the prompt while nothing stands in for it, and no
one can tell afterwards what the model was actually shown.

### Goals

1. **Continuity at a small, fixed cost.** The prompt carries a compact summary of where the story
   stands, bounded by an explicit token budget, not by how long the chat is.
2. **Detail on demand.** Original wording stays recoverable: retrieval quotes the original text for
   material the prompt no longer carries, with a source id, a floor and a speaker.
3. **Nothing hidden without a stand-in.** A floor leaves the prompt only while an accepted summary
   covers every chunk of it. A summary that fails, overruns its budget, or stops matching the
   history restores the original floors.
4. **Version correctness.** Edits, swipes, deletions and branch changes must not leave a summary or
   an evidence quote pointing at text that no longer exists.
5. **Traceability.** Every compressed claim can be traced back to the messages it came from, and the
   system reports what it measured and what it did not.

### Scope

- A zero-dependency SillyTavern third-party extension, Aetheria Unified Memory v5.5-dev.
- One generation entry: a single interceptor that assembles and injects one reference block and one
  current-state block, and clears both when the host is generating something that is not the story.
- The original text of the chat, versioned, kept in the chat's own metadata.
- One narrative continuity summary, regenerated from the original text by a background model call
  every N floors.
- A mixed index over original-text chunks (lexical now, dense when an embedding backend is
  configured) used to quote evidence back.
- A plugin-owned world-info ("setting") plane with its own import, index and retrieval lifecycle.

### Non-goals

- No fact extraction as the price of admission for retrieval. Facts may be derived, but nothing has
  to be extracted before the original text can be found again.
- No model training, fine-tuning, or learned memory readout.
- No external memory service: the extension works with nothing but the chat client.
- No second source of truth for generated text: the summary is built from original turns, never from
  another summary.
- No per-actor knowledge enforcement: what a character may know is carried in the summary text, not
  filtered per line. See ADR-0002 for what that gave up.

### Stakeholders

The solo maintainer, plus SillyTavern users running long multi-hundred-floor chats.

### Where to go next

- [01_architecture.md](01_architecture.md) - the pipeline, the modules, and the invariants
- [03_data_model.md](03_data_model.md) - what is stored, where, and what may be deleted
- [04_roadmap.md](04_roadmap.md) - what is next and what is explicitly not planned
- [decisions/](decisions/) - the decisions that shaped this, including the retired stack
- [../README.md](../README.md) - user-facing behaviour
