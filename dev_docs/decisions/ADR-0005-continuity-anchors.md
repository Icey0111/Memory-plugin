# ADR-0005: Continuity anchors, and the guards that report their absence

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

The summary is rewritten from scratch on every pass: the model reads the previous summary plus the new
floors and writes a replacement. A fact the new text stops mentioning is therefore gone - and the
facts most worth keeping are exactly the ones a compression pass drops first, because a promise, an
ownership transfer or a secret is one sentence among many while a room description is vivid.

Two quieter failures sit next to it. The summary job can fail repeatedly without anything throwing:
the floors stay visible, which is the safe direction, so the story keeps working while the prompt
grows back to the length the summary existed to prevent. And the unsummarized tail can simply never
reach the update threshold. Both are invisible until someone reads a diagnostic.

## Decision

**Anchors.** Anchors are the commitments, ownership, secrets, identities and life states that are
still in force. They are taken out of the summary prose and into the store:

- The summarizer receives the current anchor list and must repeat every still-binding anchor verbatim,
  add the ones it finds, and list resolved ones under a second section.
- An anchor the model stops mentioning is **kept and flagged as unrepeated**. Only an explicit
  resolution removes it. Silence is neither a resolution nor a confirmation.
- A format slip (no sections at all) leaves the anchors untouched and is announced.
- Anchors are re-injected every generation as a binding block beside the summary, with their own token
  budget that sends whole lines or none and reports what it omitted. Resolved anchors are kept in a
  bounded history, so a drop is auditable rather than silent.

**Guards.** The two quiet failures are counted and announced rather than prevented by a budget:

- summary_failures, reset by the next success, with a threshold;
- pending_floors and pending_tokens, with a threshold;
- both surfaced as a warning above the settings panel's diagnostics, plus unrepeated anchors and
  truncated anchors.

## Consequences

- Continuity-critical facts no longer depend on the summarizer remembering to carry them forward.
  They survive an arbitrary number of rewrites unless something explicitly resolves them.
- The prompt carries a small, bounded, deterministic block that the summary budget cannot evict.
- A summarizer that stops following the format degrades to "summaries still work, anchors frozen", and
  says so, instead of silently losing the anchors.
- The retired per-actor knowledge filter is still not restored; ADR-0008 covers what replaced it.

### What this does not do

- It does not verify that an anchor is *true*, only that it was stated and not explicitly resolved.
- It does not stop the model from resolving an anchor wrongly. The resolved list is the audit trail for
  that, and it is bounded to the last 20 entries.
- It does not bound the archive or the legacy runtime; those are ADR-0004 and ADR-0007.
