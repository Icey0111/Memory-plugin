# ADR-0006: Packing, not ranking, was the retrieval bottleneck

- Status: accepted
- Date: 2026-09-12
- Supersedes: the open question in ADR-0004 section "What this does not decide"
- Superseded by: -

## Context

ADR-0004 measured lexical retrieval at 88-100% recall, but with a probe that asked with the needle's
own sentence minus the needle, and stated that the oblique question - the case dense retrieval exists
for - was still unmeasured. That measurement is now possible: recall-baseline.mjs accepts a
hand-written question set with an expected literal needle, in two kinds (a question that names the
entity, and one that describes the situation without naming it).

## Measurements

Twenty hand-written questions against one real chat, lexical-only, no embedding backend:

| Question set | Before this pass | After the packing fix |
| --- | --- | --- |
| In-words probes (needle's own sentence) | 93-100%, median 100%, 925 tok | 93-100%, median 100%, 904 tok |
| Entity questions (names the entity) | 100% (1 countable entry) | 100% |
| Oblique questions (describes the situation) | **17%** (1 of 6) | **67%** (4 of 6) |

The oblique misses were not ranking failures. The needle's chunk was in the candidate list at rank 2,
2 and 3, and in one case rank 10, but never reached the prompt:

- Adjacent chunks of one message overlap by design and every hit is padded, so two hits on the same
  message always overlap. The second was treated as a duplicate and discarded - which is how the
  sentence carrying the answer was thrown away while its neighbour was quoted.
- Packing was greedy: the first candidate could spend the whole allowance, so an answer that ranked
  third was answered with the wrong text.
- A candidate too long for what was left was skipped whole.

## Decision

Fix the packer before adding a retrieval channel.

1. **Overlapping candidates merge** into one span. The merged span keeps the earliest rank's position
   and the best-ranked candidate's range as its anchor.
2. **Every entry gets a share of the budget** (maxTokens / maxEntries, floor 160 tokens), so the first
   candidate cannot starve the rest.
3. **A span that still does not fit is trimmed toward its best-ranked part**, never dropped.
4. **No embedding backend is added now.** After the packer fix, the residual ranking miss rate on the
   paraphrase set is 1 of 6, on a six-question sample. That is too weak a signal to justify a backend,
   a second index, a space identity and a rebuild lifecycle. The paraphrase set is the instrument;
   grow it to 50+ questions and re-run before deciding.

## Consequences

- Oblique recall went from 17% to 67% with no new dependency, no model call and no extra token cost
  (the in-words probes also got slightly cheaper).
- The finding generalises beyond this project's pipeline: a retrieval result is not delivered until it
  survives packing, and packing policy can dominate ranking quality.
- The one remaining true ranking miss (a question about the well's反常 behaviour, whose answer shares
  almost no vocabulary with the question) is recorded rather than explained away.

### What this does not decide

- Whether dense retrieval would help on the *remaining* oblique failures. That is exactly what the
  grown paraphrase set is for.
- Whether the per-entry share (maxTokens / maxEntries) is the right split for very long messages. The
  trim keeps the best-ranked part, but a 2000-character message is quoted in fragments.
