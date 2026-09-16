# ADR-0004: Measured storage and the lexical recall baseline

- Status: accepted
- Date: 2026-09-12
- Supersedes: the unmeasured cost claim in ADR-0003
- Superseded by: -

## Context

Three open items were carried in 04_roadmap.md as risks with no numbers behind them: what the
original-text archive costs inside the chat file, what the retired fact set still costs there, and
whether lexical-only retrieval over original text is good enough that dense retrieval has to earn its
place. ADR-0003 had asserted that "the chat file roughly doubles"; that was an estimate from the
design, not a measurement.

recall-baseline.mjs is now the ruler for both questions. It reads real chats, runs the real ranking
and packing code, and writes nothing.

## Measurements

Five real chats (the five largest under default-user/chats), 2026-09-12, Node 24 on Windows:

| Chat | File | Messages | Retired fact set in the file | Of which relocated by this version | Archive | Lexical recall | Candidate hit | Median rank | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AetheriaS14 | 1069 KB | 77 | 151 KB | 77 KB | 351 KB | 100% | 100% | 0 | 925 tok |
| Seraphina 22h56 | 933 KB | 101 | 371 KB | 188 KB | 86 KB | 89% | 96% | 0 | 924 tok |
| AetheriaS40 | 521 KB | 83 | 99 KB | 53 KB | 156 KB | 88% | 96% | 0 | 930 tok |
| Seraphina 02h14 | 494 KB | 41 | 261 KB | 149 KB | 81 KB | 100% | 100% | 0 | 910 tok |
| Seraphina 00h42 | 464 KB | 51 | 217 KB | 106 KB | 41 KB | 100% | 100% | 0 | 926 tok |
| **median** | **521 KB** | 77 | **217 KB** | **106 KB** | **86 KB** | **100%** | **100%** | **0** | **925 tok** |

Recall is measured over the floors a summary would already have folded: each probe is a literal
needle (a quantity or a rare four-character phrase) that occurs exactly once in the whole transcript,
asked with the needle's own sentence minus the needle. It is therefore an **upper bound** for the
lexical channel, not an estimate of how it handles an oblique question.

## Decision

1. **Relocate the replayable fact set out of the chat file.** memories, slots and
   hierarchical_summaries join the derived keys: readable in memory, written to the external record,
   and stripped from the serialized chat store. extractions stays canonical, because it is the replay
   log the fact set is rebuilt from - so no fact is lost by dropping the projection. The strip only
   activates after the external record has been read or written for that chat, so nothing leaves the
   file before a copy exists elsewhere.
2. **Correct the cost model in ADR-0003.** The archive costs about one copy of the conversation text,
   measured at 41-351 KB, which is 4-33% of these chat files, not a doubling - because per-message
   JSON overhead and the plugin's own store dominate the bytes. The archive stays lossless: at this
   price, compressing or bounding it would trade a real capability for a small saving.
3. **Lexical retrieval is the baseline, and it is a strong one.** 88-100% recall at median rank 0 for
   about 925 tokens per query, with no embedding backend configured. Dense retrieval now has a number
   to beat; it is not added because the architecture diagram says so.
4. **The ruler is committed.** recall-baseline.mjs ships with the repository so the next budget,
   chunk-size or ranking decision is made against these numbers rather than against intuition.

## Consequences

- The chat file loses 53-188 KB (median 106 KB, 10-20% of the file) on the chats measured, and the
  loss is safe by construction: the projection is rebuildable from the log that stays.
- The store read path is unchanged for runtime readers: the keys remain ordinary properties in memory
  and only serialization omits them.
- An install with no derived backend keeps everything in the chat file, exactly as before.
- The 11-12% of probes lexical retrieval misses, and the oblique questions this ruler does not model,
  are now the open measurement rather than an open opinion.

### What this does not decide

- It does not retire the legacy runtime (roadmap item 1). The keys moved; the code that produced them
  is still in the tree.
- It does not bound the archive. The measurement says the archive is not the biggest cost; if that
  changes on longer chats, this ADR is the baseline to re-measure against.
- It does not establish that dense retrieval is unnecessary - only that its absence costs at most
  12% of this probe set, which is the number a dense implementation has to improve on.
