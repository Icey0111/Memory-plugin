# ADR-0027: Subject identity is deterministic, and there is no kind table

- Status: accepted
- Date: 2026-09-13
- Relates to: ADR-0026 (one live value per subject)

## The two defects the 40-turn run exposed

1. **The same fact had two subject spellings.** The ledger held `威胁 | 心脏石植入者/制造者` and
   `威胁 | 心脏石植入者` as separate subjects, so supersession did not fold them and one fact was injected
   twice.
2. **The kind rank table was inert.** The run produced 保护, 关系, 地点, 威胁, 承诺, 条件/命令, 秘密, 计数 and
   身份/状态. The table covers six kinds from the original vocabulary and ranked three of those nine, so
   "life-or-death first" was not actually operating; the round-robin alone was distributing the budget.

## Decision

**Subject identity is a deterministic normalisation, not a similarity.** `anchorSubjectKey` normalises
Unicode, collapses whitespace and drops a `/` suffix — exactly the treatment the kind field already gets.
Nothing else.

**The kind rank table is deleted.** `orderAnchors` serves one line per kind in turn, and the kind whose
newest fact is newest is served first; inside a kind the newest value is first. Recency decides, so the rule
needs no maintenance as the model's vocabulary drifts.

**The prompt shows the canonical spelling**, so a variant the model invents is corrected the next time it
reads the list rather than accumulating.

## Alternatives rejected by measurement

- **Containment as an identity rule** (one subject being a substring of another). On the real ledger this
  would merge `user` with `user的保护绳`, `Seraphina` with `Seraphina的额外小袋`, `Seraphina` with
  `Seraphina的嗡鸣承诺`, `Seraphina` with `Seraphina的计数策略`, and `格莱德` with `格莱德结界` — five
  merges of genuinely different facts against the one real duplicate. A rule that costs five truths to catch
  one duplicate is worse than the duplicate.
- **An LLM deduplication pass over entities**, the way Zep/Graphiti does it (it sends extracted nodes and
  candidate nodes to a model with a `NodeResolutions` response schema). It is the right tool when entity
  identity is genuinely ambiguous; here a one-line deterministic rule merged the only real pair with no
  false positives, so a per-pass model call would buy nothing measurable for this schema.
- **A controlled kind vocabulary** (constrain the kind to an enum). It would make the rank table viable, but
  it would also throw away the model's own distinctions; the taxonomy is not the problem, the table was.
- **Extending the table with synonyms** for the new kinds. `威胁`, `保护` and `条件/命令` are all arguably
  high-stakes, which is the same as saying the table has no discriminating power left.

## Consequences and measured effect

On the live ledger the normalisation folds **17 active anchors to 16** and frees one slot: parked entries go
from 5 to 4 at a 600-token budget, with 12 injected. Every remaining active anchor has a distinct subject, so
the one-live-value-per-subject invariant holds across the whole ledger rather than only where the model
happened to spell consistently.

**The limit is deliberate.** Fuzzy identity is refused even where it might help: two spellings that differ by
more than a slash suffix stay two facts, and the panel can show both. The alternative — merging them and
being wrong about five — is worse for a block the model is told is still binding.

## Validation

`test-anchor-budget.mjs`: section 9 merges the two spellings that the live run produced; section 10 asserts
all five containment pairs stay separate facts; section 11 asserts the kind with the newest fact is served
first and a tight budget parks the oldest; section 12 asserts five model-invented kinds are all served before
any kind is served twice.
