# Narrative Coverage Is Now O(chat), Not O(window)

<!-- VERSION 1 -->
## v1 - 2026-09-12 04:01:24 - sealing Level-1 batches, and the 445 raw floors it prevents

## The problem, measured

Folding is the only thing in this plugin that makes the prompt cheaper, and a floor may only stay hidden
while a summary line still stands in for it (`unfoldFloorsNotCovered`, the safety rule that must never be
bent). The lines came from `digestRows`, which returns only the newest rows that fit
`summary_digest_max_chars` - 8,000 characters by default - and `reconcileFoldCoverage` rebuilt
`level1` from that window on every pass, **discarding every digest row it did not rebuild**
(`if (row?.digest) continue;`).

So coverage was O(window), not O(chat). Simulated with the live acceptance chat's own event summaries and
the live caps (120 rows / 8,000 characters, 164 characters per summary), the window saturates at about
**45 floors**:

| floors | lines in the window | floors with no stand-in, i.e. restored as raw text |
|---|---|---|
| 28 (live today) | 28 | 0 |
| 48 | 46 | 2 |
| 56 | 44 | 12 |
| 80 | 44 | 36 |
| 120 | 45 | 75 |
| 500 | 44 | **456** |

At 500 floors the prompt would carry roughly 456 x 260 = ~118,000 characters of raw transcript **on top
of** the 16,000-character memory injection. The memory system would be a net cost.

This is the defect the user kept pointing at when they asked for "N floors, then summarise those N
floors". They were right, and the reason is not the one in `19_next_steps.md`.

## What changed

`summary_level1_every_turns` already existed and was **set to 10**; it fed only a boundary "beat" and did
nothing else. It now means what it says.

**`v55-digest.js` - `coalesceDigestBatches(rows, { everyTurns, lineChars, ordinalOf })`**

- Floor-aligned batches of `everyTurns`, aligned on a floor's **ordinal** - its position in the completed
  turn list - never on a position inside the sliding window, because an unstable alignment would mean no
  batch is ever recognised twice.
- A **full** batch is SEALED into exactly one row whose id is a hash of its floors, so a later pass
  reproduces the identical row instead of a new one.
- A batch that is still filling keeps one row per floor, so folding still starts at the first extracted
  turn and a sealed row never changes once written: ordinals only ever append.
- A sealed row is ONE line obeying the same `lineChars` cap (400) as every other digest line, shared out
  oldest-first exactly as A4 shares a merged group.
- A batch seals only when **every** floor it owns has a line. A missing extraction therefore blocks its
  batch rather than being swallowed into it.

**`v55-summary-runtime.js` - `reconcileFoldCoverage`**

- Lines come from the **full** ordered line list, not the capped window (`allRows`), and the window keeps
  its other job: the repetition measurement and the A4 grouping, which now runs only when
  `everyTurns === 1` (a batch row already compresses, so running A4 first would compress twice).
- Sealed batches already stored are **carried verbatim** when they cannot be rebuilt - the extraction
  records behind them were pruned - as long as every floor they name is still a completed turn. This is
  the guard that makes a sealed row outlive the extraction log.

## Verification

**Live** (chat `Seraphina - 2026-09-12@01h15m20s127ms`, 55 rows / 28 assistant floors), after deploying
and reloading:

| | before | after |
|---|---|---|
| Level-1 rows | 23 | **10** (2 sealed batches of 10 + 8 rows still filling) |
| narrative characters | 4,578 | **2,334** |
| floors covered | 28/28 | 28/28 |
| folded rows | 53 | 53 |
| injected reference block | 3,003 tokens | 2,694 tokens |
| injected current state | 5,041 tokens | 5,041 tokens |
| **injected total** | **8,044 tokens** | **7,736 tokens** |

**Scaling simulation** (same module, synthetic chat, 126-character summaries, default settings):

| floors | Level-1 rows | narrative chars | coverage | floors the old window would have left raw |
|---|---|---|---|---|
| 50 | 5 | 1,995 | 50/50 | 0 |
| 100 | 10 | 3,990 | 100/100 | 45 |
| 200 | 20 | 7,980 | 200/200 | 145 |
| 500 | 50 | 19,950 | **500/500** | **445** |

Stored narrative is a flat **39.9 characters per floor** (the 400-character batch cap spread over ten
floors), i.e. ~20 KB at 500 floors, against ~260 characters per floor of raw transcript.

**Tests**: `test-v55-digest-batch.mjs` (new, 10 assertions groups) pins the contract and the carry; the
suite is **78/78**. `test-v55-digest-integration.mjs` now also pins that a missing extraction leaves its
whole batch unsealed.

## What this costs, stated plainly

- **Narrative detail.** A floor's line is now ~39 characters instead of ~164: the batch keeps the
  beginning of each floor's event summary and trims the restatement, the same rule A4 already used. The
  **facts** are not affected - they live in the state block's memories, which are unchanged at 5,041
  tokens - but the story-so-far block is thinner per floor.
- **Storage.** ~40 characters per floor of narrative, ~20 KB at 500 floors. This replaces a bounded
  window that could not hold coverage at all.
- **Reach.** The summary block is funded from the reference budget (3,862 characters). At 400 characters
  per batch that is ~9 batches, i.e. the newest ~90 floors, against ~23 before. It is still not every
  floor of a 500-floor chat.

## Still open, and not claimed

- **`l2: 0`, `l3: 0`** - the consolidation levels have still never merged, because the model loop's
  `pending` is derived from `processed_turn_ids`, which the digest fills for every turn. Sealing does not
  touch this. Making L2/L3 real is what would lift narrative reach from ~90 floors to all of them, and it
  needs a model call per N floors.
- No model-written narrative. The batch text is assembled from the extractor's per-turn summaries.
- The narrative is not addressable: a turn id resolves to its batch only by scanning `source_ids`.
- The stale memory vector collection is untouched; dense recall is still off.

## Correction to the plan document

`19_next_steps.md` v2 sorted N2 ("consumption stages, N as a real setting") into the **architecture**
column and it was declined on that basis. That sorting was too broad. The batching half of N2 is a repair
of a setting that already existed, already shipped, and did nothing - and without it the fold's own safety
rule guarantees the prompt re-grows without bound. What remains architectural is the model-written
narrative and the L2/L3 merge, which is `19`'s N3 and stays declined.

<!-- VERSION 2 -->
## v2 - 2026-09-12 04:15:37 - the N-floor unit is not a long-chat feature

v1 justified this change with a 500-floor scenario. That framing conflates two different things, and the
conflation is worth removing, because it is what made the original plan read as architecture when it was
a unit choice.

**N is a unit size. 500 is a stream length. They are not related.**

What N does, at any chat length, and nothing more:

| | |
|---|---|
| one call sees | N complete floors of source text, instead of one |
| model calls | floors / N |
| Level-1 units | floors / N — which is also the stored rows and the storage |

What N does **not** do:

- It is a **divisor, not a bound.** 500 floors at N = 10 is 50 units; at N = 20 it is 25. Still linear in
  the length of the chat. N never makes the count constant.
- It does not reduce how much text is summarized in total. It changes the block size.
- It does not decide whether a long chat can still show its opening. That is a question about the
  INJECTION budget, answered by merging units (the plan's N3) or by retrieving them — never by N.

The measurement in v1 is real: coverage collapsed once the digest window rolled past about 45 floors. But
that is the **persistence** half of this change, not the N half. N's only contribution there is that 500
persisted rows become 50. **Persistence fixes the cliff; N decides how many rows survive it.** Neither
makes the narrative reach floor 1, and this document should not be read as claiming it does.

The honest headline is therefore **"a full batch of N floors becomes one permanent row"**; v1's headline,
"coverage is O(chat) not O(window)", is the second-order consequence of persisting them.
