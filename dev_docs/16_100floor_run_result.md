# 100-Floor Run Result

## v1 - 2026-09-12 00:20:00 - the first judge-free measurement of this architecture over 100 floors

### 1. What was run

- **100 floors = 50 user turns + 50 character replies**, one continuous story in ten acts
  (plague, poisoned well, quarantine, the brass vial and the bishop, manhunt, the lighthouse
  ledger, betrayal, the bell-tower confrontation, aftermath).
- Fresh chat, a real model, the real plugin. Roughly 300-400 characters asked per reply.
- **Nothing in the dialogue ever asked the character to recall anything.** The conversation only
  advanced the story, so whatever survived at the end survived on its own. This is what makes the
  measurement meaningful: no turn primes the memory system.
- The instrument was the length certificate (`15_innovation_path.md`), computed after every turn,
  by string and identifier comparison only - **no model judge anywhere in the loop**.
- Ten batches; the page was reloaded and the chat reopened between batches.
- Transcript health was asserted after **every** batch: user turns, filled replies, empty rows, and
  a live `saveChat()` probe.

### 2. Transcript health: clean

| after batch | user turns | replies | empty rows | save | healthy |
|---|---|---|---|---|---|
| 0 | 5 | 5 | 0 | ok | true |
| 1 | 10 | 10 | 0 | ok | true |
| 2 | 15 | 15 | 0 | ok | true |
| 3 | 20 | 20 | 0 | ok | true |
| 4 | 25 | 25 | 0 | ok | true |
| 5 | 30 | 30 | 0 | ok | true |
| 6 | 35 | 35 | 0 | ok | true |
| 7 | 40 | 40 | 0 | ok | true |
| 8 | 45 | 45 | 0 | ok | true |
| 9 | 50 | 50 | 0 | ok | true |

Final chat: 102 rows, 1,081,692 bytes. Duration 69 minutes. Reply lengths stayed inside
360-572 characters throughout.

### 3. The curve

Every tenth floor, from the certificate computed at that moment:

| floor | injected tokens | state coverage | commitment | causal chains | T-Causal |
|---|---|---|---|---|---|
| 2 | 948 | 100% | 100% | 0/0 | 100% |
| 12 | 3,943 | 91% | 100% | 0/0 | 91% |
| 22 | 6,963 | 51% | 63% | 1/2 | 57% |
| 32 | 8,363 | 52% | 90% | 1/2 | 48% |
| 42 | 9,025 | 53% | 100% | 1/2 | 45% |
| 52 | 10,963 | 48% | 100% | 1/5 | 35% |
| 62 | 11,116 | 37% | 100% | 0/7 | 10% |
| 72 | 10,688 | 25% | 100% | 0/7 | 8% |
| 82 | 11,191 | 25% | 100% | 2/8 | 18% |
| 92 | 11,154 | 17% | 100% | 0/14 | 8% |
| 100 | 10,690 | 18% | 100% | 1/16 | 13% |

### 4. What held

**Commitment retention stayed at 100% for the entire run**, flat, from floor 2 to floor 100. The
protected set was exactly the rank-4-and-above kinds: 13 commitments, 1 relation, 1 ownership.

This is the project's stated first goal - never lose an irreversible fact - and **it is met**.

### 5. What failed

- **State coverage fell from 100% to 18%.** At floor 100 the injected context carried 34 of the
  190 live slot values, and only 14 of the 90 slot values that belong to this story.
- **T-Causal answerability fell from 100% to 13%.** The block could no longer answer "why is it
  like this now", "who did this first", "who does not know".
- **Causal coverage sat at 1/16 (6%)** - the replaced endpoints were almost never both present.
- **Cost rose 11x**, from 948 to 10,690 injected tokens, while answering less.

### 6. Root cause, measured

At floor 100 the store held **208 memories: 201 active, 6 closed, 1 superseded.** Over 100 floors
the system retired **seven** memories in total. It only ever adds.

Meanwhile the injected baseline is bounded. The projection at floor 100 was **16,082 characters**
(reference 11,346 + current state 4,735). 190 live slot values cannot fit in 16,000 characters - the
arithmetic alone predicts the decay, independently of any measurement choice. The curve is what a
fixed budget meeting an unbounded store must look like.

The certificate separates the two failure modes, and it is unambiguous about which one this is:
**violations 0 across all 100 floors** (T-Causal), stale rows about 1 per turn, 35 in total over 50
turns. **The memory never says anything false. It says less and less.**

Confirmed by a probe of the final store: the omitted values include the plague's own status slot,
which still read "seven cases, which city gate is unclear" - true at turn 2, never updated by turn
100. Omission of updates, not contradiction, is the failure.

### 7. Two secondary findings

1. **`known_by` was emitted for 0 of 201 live memories.** The epistemic check ran 0/0 for the whole
   run, so the leak question is not merely unanswered - the field it depends on does not exist. P9
   of the methodology is unimplemented, and the certificate cannot yet rule on it.
2. **12 of 50 turns did not confirm extraction inside the 90-second window**; the store recorded 38
   extractions for 50 turns. The omissions above may be understated, not overstated.

### 8. What this means

The architecture is **safe and not sufficient**. It keeps its promises and loses its detail. That is
the opposite of the usual LLM failure (fluent but unfaithful), and it is a real property worth having
- but it does not reach the goal of "cheap and stable".

It also settles the next step by measurement rather than by argument. The problem is not a missing
structure; it is that nothing is ever retired. The next stage is **compaction under a sufficiency
rule**: retire or merge what no longer carries a question, so that a fixed budget keeps covering the
current state. The certificate is what will say whether that worked, and it already shows that it is
measuring the right thing - commitment stayed flat while coverage collapsed, which is exactly the
separation the design is supposed to produce.

### Caveats

- One chat, one character, one story. No repetition.
- The 90-second extraction window was not always enough (12/50), so some omissions may be missed
  extractions rather than lost memory.
- The story-relevant subset was selected by keyword; the 18% figure is the whole live slot set and
  the 16% figure is the story subset, and both decay the same way.
- The certificate's reachability test is a 24-character verbatim fragment match. It is strict: a
  memory reworded into the projection counts as absent. The projection size bound above makes the
  conclusion hold regardless.
