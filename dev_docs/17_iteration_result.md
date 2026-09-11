# Iteration Result

## v1 - 2026-09-12 02:55:00 - what the session's iteration changed, measured end to end

### 1. What was measured

25 user turns = **50 floors**, one continuous story, fresh chat, the same scenario prefix used by every
comparison in this session. Real model, real plugin, page reloaded between batches.
Transcript health asserted after every batch. The final reading taken with the **trustworthy protocol**:
call the interceptor, then read the two named prompt keys.

### 2. The result

| reading | session start (floor 50) | final (floor 50) |
|---|---|---|
| state coverage | 48% | **100%** |
| causal coverage | 20% (1/5) | **100%** (3/3) |
| T-Causal | 35% | **85%** (11/13) |
| commitment retention | 100% | **100%** (21/21) |
| retired values rendered as live | present | **0** |
| T-Causal violations | 0 | **0** |
| injected tokens | 10,963 | 13,040 (+19%) |
| **new slots per extraction** | **5.0** | **0.4** |
| commentary (`belief`) share of memory | 31% | 14% |
| live slot values at floor 50 | ~190 at floor 100 | **9** |

Final kind mix: knowledge 14, commitment 14, intention 11, state 10, belief 10, ownership 5,
world_delta 2, relation 2, event 3 - durable facts, not per-turn commentary.

Transcript health: 5/5, 10/10, 15/15, 20/20, 25/25 users to replies, zero empty rows, `saveChat` ok on
every batch, for the whole run.

### 3. What each change contributed

| change | measured effect |
|---|---|
| extraction discipline (slot reuse, admission test, commentary ban, <=6 ops) | state pool grew **5.0 -> 1.3** new slots per extraction; **195 of 201 slots had been written exactly once** before it |
| current-state ceiling 5,000 -> 20,000 | at a fixed total budget, state coverage **44% -> 91%**, T-Causal **30% -> 63%**, tokens **-21%** |
| change chain 600 -> 4,000 chars, 8 -> 24 rows | causal coverage **35% -> 76%**, T-Causal **75% -> 93%**, stale rendering 2 -> 0 |
| reference block 12,000 -> 8,000 | pays for the chain; the reference block measured **flat below 4,000 characters** |
| budget migration | without it, **every** correction above would have applied only to fresh installations |

### 4. The method, which mattered more than any single change

Two rules, both learned from failures in this session:

1. **Never sample the prompt slots as found.** Between generations they are empty or half-rebuilt. Call the
   interceptor, then read the two named keys. Without this rule a run whose real coverage was 100%
   reported 53%, and the iteration that produced the largest gain of the session was briefly recorded as a
   null result.
2. **Assert transcript health after every batch**: user turns, filled replies, empty rows, and a live
   `saveChat()`. Without it, a run produced blank character turns for four batches while a smoke test, a
   green test suite and a plausible metric all agreed the system was fine. A screenshot found it in seconds.

### 5. What is not claimed

- **One character, one story, one run per configuration.** No repetition, no second scenario.
- **The T-Causal cases are generated from the spine**, so a memory system that records fewer things is
  asked fewer questions. The commitment and causal numbers are checked against the store, not the story,
  and would not catch a fact the extractor never wrote.
- **Epistemic leak is still unmeasurable**: `known_by` is emitted for 0 memories, so the check runs 0/0.
  P9 of the methodology remains unimplemented.
- **The cost is 19% higher** than the session start. The measured frontier offers a deliberate way to trade
  that back, and the trade is not taken.
- **The causal chain is fixed at 3,000-4,000 characters.** A longer session will eventually exceed it; the
  cap is now large enough for 50 floors, not proven large enough for 500.
