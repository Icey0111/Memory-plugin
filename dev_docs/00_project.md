# Project

### Product contract

The user's original statement is preserved in [../AGENTS.md](../AGENTS.md).
For AI roleplay (AIRP), structured summaries maintain the logic that lets the
story continue, while retrieval recovers precise original evidence for details
and factual verification. These are cooperating responsibilities of one memory
system; neither alone establishes narrative reliability.

Continuity includes necessary causes, current goals and state, unresolved
commitments, conditions, negations and knowledge boundaries. Original history
remains authoritative. Summary text and structured state are derived
interpretations; a source reference does not establish that an interpretation is
correct, and a retrieved historical statement may have been superseded.

Preserving necessary meaning takes priority over minimizing summary length.
Equal turn counts do not imply equal information density, and unresolved earlier
state still needs representation. The budget policy separates a soft summary
target (`narrative_summary_tokens`, default 600) from an explicit emergency
ceiling (`narrative_summary_ceiling_tokens`, `0` derives it from the target) and
from the total injection budget. A body over the target but within the ceiling is
accepted and recorded as over-target; only a body past the ceiling is refused,
and a refusal hides nothing (ADR-0032).

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

1. **Continuity under explicit resource limits.** The prompt must retain the logic needed for
   continuation. Summary space should reflect necessary information, with storage, generation
   limits and injection budgets accounted for separately; an always-small fixed cost is not
   evidence of preserved meaning.
2. **Detail on demand.** Original wording stays recoverable: retrieval quotes the original text for
   material the prompt no longer carries, with a source id, a floor and a speaker.
3. **Nothing hidden without a stand-in.** A floor leaves the prompt only while its accepted
   representation can be injected and its recorded source coverage is valid. Source coverage is
   a structural condition, not proof that every necessary fact survived compression.
4. **Version correctness.** Edits, swipes, deletions and branch changes must not leave a summary or
   an evidence quote pointing at text that no longer exists.
5. **Traceability.** Every compressed claim can be traced back to the messages it came from, and the
   system reports what it measured and what it did not.

### Scope

- A zero-dependency SillyTavern third-party extension, Aetheria Unified Memory v5.5-dev.
- One generation entry: a single interceptor that assembles and injects one reference block and one
  current-state block, and clears both when the host is generating something that is not the story.
- The original text of the chat, versioned, kept in the chat's own metadata.
- One narrative continuity summary, updated by a background model call every N completed turns.
  The current request combines the previous summary, active anchors and knowledge boundaries
  with the new batch's original messages. Earlier originals are not reread on every pass, so
  an earlier omission is not automatically recovered by later summary updates.
- A mixed index over original-text chunks (lexical now, dense when an embedding backend is
  configured) used to quote evidence back.
- A plugin-owned world-info ("setting") plane with its own import, index and retrieval lifecycle.

### Non-goals

- No fact extraction as the price of admission for retrieval. Facts may be derived, but nothing has
  to be extracted before the original text can be found again.
- No model training, fine-tuning, or learned memory readout.
- No external memory service: the extension works with nothing but the chat client.
- No second authoritative history: original turns remain the source of truth even though the
  current summary update carries forward a previous derived summary.
- No promise that retrieval relevance equals narrative necessity, that all stored active state is
  injected, or that a structurally valid memory makes the model semantically infallible.
- No per-actor knowledge enforcement: what a character may know is carried in the summary text, not
  filtered per line. See ADR-0002 for what that gave up.

### Stakeholders

The solo maintainer, plus SillyTavern users running long multi-hundred-floor chats.

### Where to go next

- [01_architecture.md](01_architecture.md) - the pipeline, the modules, and the invariants
- [03_data_model.md](03_data_model.md) - what is stored, where, and what may be deleted
- [04_roadmap.md](04_roadmap.md) - what is next and what is explicitly not planned
- [Issue #2](https://github.com/Icey0111/Memory-plugin/issues/2) - sequenced implementation tasks,
  evidence requirements, real-call ceilings and stopping conditions
- [decisions/](decisions/) - the decisions that shaped this, including the retired stack
- [../README.md](../README.md) - user-facing behaviour
