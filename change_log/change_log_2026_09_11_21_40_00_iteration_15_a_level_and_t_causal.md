# iteration_15_a_level_and_t_causal

- Date: 2026-09-11 21:40:00
- Session: Implement the A-level plan items for the memory system, in one pass, with the plan's own
  precondition (the T-Causal acceptance set) built first.

## Problem / Requirement

`dev_docs/MEMORY_PLAN_2026.md` section 6 states a hard precondition for every phase:

> P1 之前的硬性前提：先把 T-Causal 问答集做出来。没有它，后面所有改动都无法判断是否真的"没丢逻辑"。

It did not exist. What existed was a 32-character substring probe in `v55-quality-metrics.js` that the
module itself documents as a lower bound. Consequence: the P4 gate ("causal QA must not fall") could not
be evaluated, so the A list could not be validated even where it had been implemented. Status before
this iteration:

| | A1 carriers | A2 boundaries | A3 schema | A4 compression | A5 ratio | A6 forgetting | A7 layout | A8 metrics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| state | 1/2/4 yes, 3 absent | absent | absent (default off) | absent | unmeasured | half | done | 3 of 4 |

## Purpose of Change

Build the acceptance instrument first, then implement the A items so that each one is gated on a number
the plan asked for - and stays switchable, because the plan's own degradation rule is "a failed detector
is never worse than today's behaviour".

## How It Was Changed

**The instrument (plan section 1 / section 6)**

- [v55-tcausal.js L1-L250](file:///D:/memory_plugin/v55-tcausal.js#L1-L250) — new. Three question types
  from the plan (why / who-first / who-does-not-know) plus a `no_stale` type, and a scorer with two
  corpora: `current` (live memories) answers "what is true now", `history` (retired records + the
  previous values the spine kept) answers "how did it get like this". A `forbids` fragment is always
  judged against `current`, so a replaced value may appear in a change chain but may never be answerable
  as the present state. A violation is scored separately from a miss: a miss is "unreachable", a
  violation is "contradicts itself", which is what invariant I1 forbids.
- [tcausal-cases.json L1-L90](file:///D:/memory_plugin/tcausal-cases.json#L1-L90) — new, hand-authored:
  9 cases over a replayable slot-change script (an irreversible commitment, a superseded inference, a
  location changed twice, a limited knower set, an invalidated claim).
- [index.js L3405-L3430](file:///D:/memory_plugin/index.js#L3405-L3430) — `getQualityReport` now returns
  `injection_composition`, `tcausal.canonical`, `tcausal.injected` and a printable `tcausal_text`. Only
  spine-generated cases run against a live chat; the authored fixture belongs to the offline test.

**A2 boundaries** — [v55-boundary.js L1-L230](file:///D:/memory_plugin/v55-boundary.js#L1-L230), new.
Hard (location slot or participant set change), soft (irreversible change or world_delta), and the floor
beat as the last resort. `boundaryStats.beat_share` reports how much had to fall back.

**A4 repetition-driven compression** — [v55-compression.js L1-L240](file:///D:/memory_plugin/v55-compression.js#L1-L240),
new. The trap it is designed around: shrinking the digest *window* is not compression, because the window
is the fold coverage certificate and dropping lines restores raw floors. So compression merges turns into
one line whose `source_ids` keep every turn id - coverage unchanged, text shorter. Merging happens only
when it actually shortens, never across a boundary, and only above a repetition dead zone (0.2).

**A6 reconstructability** — [v55-forget.js L1-L190](file:///D:/memory_plugin/v55-forget.js#L1-L190), new,
plus [v55-evidence.js L52-L92](file:///D:/memory_plugin/v55-evidence.js#L52-L92) where `pruneColdTurns`
stops being `order.shift()`. A first occurrence is a tie-breaker inside a rank, never a protection, for
the reason section 8.1 recorded about S5.

**A8's fourth number** — [v55-quality-metrics.js L188-L250](file:///D:/memory_plugin/v55-quality-metrics.js#L188-L250):
`injectionComposition` and `injectionSectionCost`, plus a `fullText` option on `injectionBreakdown`.

**A5, measured and only trimmed where nothing is lost** —
[context-assembler.js L93-L118](file:///D:/memory_plugin/context-assembler.js#L93-L118): empty XML
attributes (`epistemic=""`, `known_by=""`, ...) are no longer emitted. Measured on a real request, six
memory rows carried 241 characters of \`<summary>\` text inside a 3,917-character block.

**Switches** — [index.js L185-L190](file:///D:/memory_plugin/index.js#L185-L190):
`boundary_detection_enabled`, `compression_repetition_enabled`, `cold_eviction_by_reconstructability`,
all defaulting to the new behaviour and all degrading to the previous one when off, plus three checkboxes
in the generated summary panel.

**Two defects the T-Causal fixture forced out**

- [memory-core.js L486-L495](file:///D:/memory_plugin/memory-core.js#L486-L495) and
  [v55-spine.js L228-L262](file:///D:/memory_plugin/v55-spine.js#L228-L262) — `update` rewrote the record
  text in place, so the replaced value existed nowhere; S2's acceptance ("any slot enumerates its full
  history") silently held only for `supersede`. Measured: `update` 56 uses against `supersede` 20. The
  replaced text is now recorded on the spine node and rendered as `曾: A -> B -> 当前: C`.
- [memory-core.js L576-L586](file:///D:/memory_plugin/memory-core.js#L576-L586) — a `supersede` that named
  `target_slot` but omitted `slot` created the replacement with `slot: null`; the old record had already
  released the slot, so the slot map lost its current value entirely and the change chain rendered nothing
  for a slot that had visibly changed. The replacement now inherits the target's slot.

## Tests

New: `test-v55-tcausal.mjs` (the QA set, the two corpora, the negative check, unmeasured != zero) and
`test-v55-plan-a.mjs` (A2 verdicts and the beat fallback, A4 repetition -> grouping with coverage
preserved and no compression on novel text, A6 eviction order and the deliberate over-budget, A8 section
costs and the tiling invariant).

## Verification

`node run-tests.mjs` — **70/70 test files pass in 19.1 s** (68 before this iteration).
