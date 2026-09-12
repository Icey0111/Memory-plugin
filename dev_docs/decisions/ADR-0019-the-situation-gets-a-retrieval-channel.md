# ADR-0019: The situation gets its own retrieval channel, and recall becomes a metric

- Status: accepted
- Date: 2026-09-13
- Supersedes: -
- Superseded by: -

## Context

Recall is trigger-driven, not question-driven. The query is the last three messages, so a past person walking
back in, a visited place coming round again or a borrowed object being named again is a term in that query.
A 30-turn run was written for exactly those moments - six of them, every relevant floor folded before its
moment, no question asked at any of them - and it failed half of them: 3 of 6, with a mean of 0.22 of the
three evidence slots actually about the thing that had returned. The bronze lamp was named again on floor 27;
it was introduced on floor 4; the evidence quoted floors 20, 10 and 10.

The lexical channel did not miss it. `scoreChunks` returns every chunk with a positive BM25 score, so a chunk
holding a query term is always a candidate. It ranked it too low to survive fusion, and the rerank shortlist
is the fused head, so the chunk where the thing was introduced could not be reordered into the prompt.

There was also no metric. The 3 of 6 came from a hand-written probe table, which cannot be re-run against other
chats or other models.

## Decision

1. **A situation channel.** `entityTargets` takes the terms of the query that (a) occur in at least one chunk,
   (b) occur in no more than a quarter of them, (c) are the longest spelling of themselves - every n-gram of a
   longer term is a fragment of it, and counting both turns one piece of evidence into two candidates. Terms
   that also live in a hidden floor are chosen before rarer ones: without that order the rarest terms of a
   query are the n-grams unique to the newest message, which exist nowhere else and crowd out everything that
   could recall something. The 8 best targets each claim two chunks: the best-ranked one holding the term, and
   the earliest still-hidden one, which is where the thing was introduced.
2. **It is a fusion channel, not a filter**, weighted 0.5 of a lexical vote (`ENTITY_WEIGHT`). It raises the
   chunk; it does not decide it.
3. **The rerank shortlist admits up to 8 claimed documents** beyond its score-ordered head
   (`RERANK_ENTITY_EXTRA`), because the head is exactly where the introduction is not.
4. **One span per message in the packer.** A message longer than a chunk can yield two non-overlapping chunks
   that both rank, and a slot bought twice for one message buys nothing. Measured, this fires zero times in the
   three live runs, so it is a guard with a synthetic test rather than an improvement.
5. **The metric replaces the probe table.** `entityRecall` reports, per generation, the situation terms that
   exist only in hidden floors and whether the packed evidence quoted them; the panel warns at two misses.

## Consequences

Measured on the same 30-turn run, before and after:

| observation | before | after |
| --- | --- | --- |
| reappearance moments that recalled a floor of the thing that returned | 3 of 6 | **5 of 6** |
| mean share of the three slots about that thing | 0.22 | **0.39** |
| automatic metric over 30 turns | not recorded | 60 of 128 terms (47%) |

The per-turn terms are readable: on the turn the lamp was named again the term `盏铜灯` is recalled, and on
the turn the innkeeper returned `左手小`, `手小指` and `缺一节` come back with him.

### What this does not fix

- **The terms are character n-grams, not names.** `能看见`, `压了压` and `收回来` are counted as missable
  entities because they are rare and live only in hidden floors. The 47% is therefore an indicator that can be
  trended, not a recall score, and it is quoted as such.
- **A correction, because the first report of it was wrong.** The packer was said to spend 10 to 15 percent of
  its slots on a second span of a message already quoted that turn. Counted by message id it is 0 in all three
  runs; the repeated floors that looked like it were the two messages of one turn, which are two messages.
- **Six moments and one chat.** The channel is justified by the mechanism - a candidate that was found and
  ranked out cannot be reranked in - and the improvement is measured once.
