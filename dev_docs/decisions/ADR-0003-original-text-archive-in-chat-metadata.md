# ADR-0003: The original-text archive lives in chat metadata

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

"Never lose the original" needs a durable place to put it. Three candidates existed:

| Candidate | Survives a chat reload | Survives an edit or a swipe | Available when the derived backend is down | Cost |
| --- | --- | --- | --- | --- |
| The host transcript itself | yes | no - the previous version is gone | yes | none |
| The external derived store | after hydration | yes | no | a lost record loses the archive |
| Chat metadata (this decision) | yes | yes | yes | the archive is duplicated inside the chat file |

The host transcript cannot be the archive: an edit or a swipe destroys the version the summary was
built from, and the plugin needs that version to keep its coverage claim honest. The derived store is
a cache by design - the project already documents that losing it must never lose a fact, and an
archive that disappears when a backend is unavailable would break the first goal.

## Decision

Keep the versioned archive in chat metadata, under `raw_history`, and treat it as the archive of
record. The derived store and the vector collections stay rebuildable caches over it.

- Every message version is stored once, under a never-reused id, with its index, role, name and text.
- `active` records which lineage is in the chat now; superseded versions stay in `records`.
- Nothing in the narrative path prunes the archive. Growth is a known cost, recorded in the roadmap
  as an open item with a measurement to make before any policy is written.

## Consequences

- An edit, a swipe, a delete or a branch change can always be compared against what the summary read,
  which is what makes the coverage-prefix check meaningful.
- Evidence quotes can cite a version that is no longer in the transcript, which is the point.
- The chat file roughly doubles: every message appears once in the transcript and once in the
  archive. For a long roleplay this is the largest cost the plugin imposes, and it is paid in a file
  the user can see.
- A chat exported without its metadata loses the archive. The transcript is still there; the
  superseded versions are not.

### Alternatives considered

- **Archive in the derived store only.** Rejected: the store is documented as rebuildable, and a
  missing backend would silently turn "original text is authoritative" into "original text is
  whatever the transcript still happens to hold".
- **Archive only the spans a summary cited.** Rejected: it makes the archive a projection of the
  summarizer's attention, which is the defect this architecture exists to remove.
- **Compress the archive in place.** Deferred, not rejected: it needs a measurement of what is
  actually large (raw text vs. superseded versions) before a format decision.
