# ADR-0010: Dense retrieval is now justified, and it already exists

- Status: accepted
- Date: 2026-09-12
- Supersedes: the decision rule left open in ADR-0006
- Superseded by: -

## Context

ADR-0006 measured oblique-question recall at 67% on six countable questions and ruled that this was too
weak a sample to justify an embedding backend. It named the instrument - a hand-written question set -
and the threshold: grow it, then decide. The set is now 59 questions against two real chats, of which
12 have a needle that occurs exactly once and can therefore prove which span was found.

## Measurements

Five real chats, lexical only, no embedding backend:

| Set | Result |
| --- | --- |
| In-words probes (the needle's own sentence minus the needle) | 93-100%, median 100%, ~904 tokens per query |
| Entity questions (the question names what the answer is about) | 100% (n=1 countable - entity names repeat, so most are excluded by the uniqueness rule) |
| Oblique questions (the question describes the situation) | **45% (5 of 11)** |
| Evidence precision proxy (quoted spans that carry the answer) | **15% (6 of 40)** |

The failure modes matter more than the rate. Of the six oblique misses, two never had the answering
chunk in the candidate list at all, and four had it at rank 5, 8, 10 and 24 - beyond the four spans the
budget can quote. The precision proxy says the same thing from the other side: the block quotes about
three spans per question and only half of one carries the answer, so it is mostly topically related text.

## Decision

1. **Lexical stays the guaranteed floor.** It needs no backend, no index and no network, and it answers
   entity questions completely.
2. **The dense channel is the answer to the oblique case, and it is already implemented.** Raw chunks are
   embedded and queried whenever a backend is configured and vector recall is on; nothing new has to be
   built. What was missing was the argument, and this measurement is it.
3. **Make the two channels observable.** Diagnostics now report how many candidates came from each
   channel, so a user with a backend can see what the dense half contributes instead of taking it on
   faith.
4. **The instrument ships; the private set does not.** recall-baseline.mjs and the paraphrase format are
   in the repository. The 59 questions quote a private roleplay and stay in remove/ on this machine, so
   the number is reproducible only by the owner - which is stated here rather than implied.

## Consequences

- The roadmap item "grow the paraphrase set and decide" is closed: the set was grown, the number moved
  from 67% to 45% on a larger sample, and the decision is to use the channel that already exists.
- What is still unmeasured is the dense half itself: it needs a configured backend and a live run. The
  per-channel diagnostic is the instrument for that.

### What this does not do

- It does not add reranking. The misses are ranking and candidate-generation failures, and reranking
  cannot recover a chunk that was never a candidate.
- It does not change a default. `vector_recall` already gates the raw index, so an install with a
  backend already runs both channels.
