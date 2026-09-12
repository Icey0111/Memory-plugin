# ADR-0021: The evidence budget reaches more messages, and reserved seats are not shipped

- Status: accepted
- Date: 2026-09-13
- Supersedes: -
- Superseded by: -

## Context

ADR-0019 and ADR-0020 gave the situation and the characters their own fusion channels. Both exist because
their candidates rank late by construction, so both were given enough weight to reach the head of the fused
order - and a replay of a recorded 26-turn chat showed what that cost: the best candidate matching *only* the
last three messages kept a slot on **1 of the 17 turns where one existed**. Three slots had become two
channels' worth, and nobody chose that; it was the arithmetic.

Three cures were plausible and they are cheap to compare offline, so the comparison was made by replaying a
recorded chat rather than by generating two more: for every turn, rebuild the query (the last three captured
rows at that turn), the visible set (from the recorded `folded_rows`), and the chunk prefix, then run
`rankRawChunks` and `packRawEvidence` under each variant and count what changed.

| variant at a 1000-token budget | entity recalls | similarity kept | profile described | tokens/turn |
| --- | --- | --- | --- | --- |
| 3 slots (shipped) | 84 of 136 (62%) | 1 of 17 | 17 of 17 | 611 |
| 3 slots + a seat for the claiming channels | 84 of 136 | 1 of 17 | 17 of 17 | 611 |
| 3 slots + a seat for similarity | 63 of 136 (46%) | **17 of 17** | 17 of 17 | 875 |
| 5 slots | 116 of 136 (85%) | 5 of 17 | 17 of 17 | 593 |
| 6 slots | **128 of 136 (94%)** | 10 of 17 | 17 of 17 | 604 |

## Decision

1. **Reserved seats are not shipped.** Reserving for the claiming channels changed 3 of 24 turns and moved no
   metric, because those channels already rank at the head. Reserving for similarity is zero-sum: it buys 16
   similarity turns by giving up 21 of 136 situation-term recalls, at *more* tokens, because the displaced
   span was longer.
2. **The divisor is not a price.** `EVIDENCE_TOKENS_PER_SLOT` goes from 333 to 200 and the cap from 6 to 8.
   The packer spends only what its candidates need, so at a fixed budget more slots cost nothing - 611 tokens
   a turn at three slots against 604 at six - while reaching three times as many messages.
3. **The curve is recorded rather than the maximum taken.** 200 (five slots, 85%) is shipped, not 160 (six
   slots, 94%), because the shares get shorter as the count rises and the offline question set was run without
   the cap.

## Consequences

The offline 52-question set agrees that more slots do not hurt, and reaches 100% answer-in-context at five and
six slots against 97% at three and four.

### What this does not settle

- **A correction, because the first run of this experiment was wrong.** It reported that reservation changed
  nothing. It had been run against a host page that still held the previous build, so the option did not exist
  and every variant was the baseline. The repository and the loaded extension are two directories. The
  numbers above come from the re-run after `deploy-live.mjs --apply` and a page reload.
- **One chat.** The replay is one recorded 26-turn run; the claim that more slots cost nothing is a property
  of this packer's accounting, reproduced on this chat.
- **Shallower quotes.** Five slots at 1000 tokens share out about 200 tokens each instead of 333. The offline
  set does not show harm, but it pins the slot count without the budget cap, so it is not the same experiment.
