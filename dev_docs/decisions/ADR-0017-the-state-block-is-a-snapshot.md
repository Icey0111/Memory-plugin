# ADR-0017: The state block is a snapshot of the last summary

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

Anchors and knowledge boundaries are not maintained between summaries. The summary pass restates them,
the host merges that restatement with what it carried, and the result is injected unchanged until the
next pass - ten completed user turns, normally twenty floors, at the default cadence. ADR-0005 and
ADR-0008 chose that shape for the write path: one background model call per cadence, no per-turn work,
no extra extractor.

Two things follow from it that had not been measured on a chat long enough to see them. A state change
made after a summary pass is invisible to the block until the next pass, so for that window the block
can contradict floors the transcript still shows. And because the model is asked to re-state what is
still valid, the lists only grow.

A 60-turn live run (120 floors, cadence 10, `deepseek-v4-flash`, `jina-reranker-v3`) measured both:

| observation | measurement |
| --- | --- |
| every active entry re-stated at every pass | `anchors_unconfirmed` = 0 and `knowledge_unconfirmed` = 0 on all 60 turns |
| summary passes / failures | 6 / 0 |
| anchors at turns 10, 20, 30, 40, 50, 60 | 7, 9, 9, 12, 16, 20 |
| knowledge at the same turns | 6, 8, 9, 14, 18, 20 (the cap) |
| knowledge lines on the busiest subject | 1, 2, 2, 3, 4, 6 |
| turns for a state change to reach the block | 7, 6, 4; two changes never reached one |
| turns whose block contradicted the transcript | 6 (turns 15-20, the key still with 林昭) |

At turn 60 the 20-entry knowledge block covers eight subjects and gives one character six lines; 韩铮
holds both `不知道 账本存在` and `知道 账本在林昭手中`. The prompt asks for one line per statement, the
merge rule retires a subject's *carried* line, and the model re-states every line it wrote before - so
neither side collapses a subject down to one line.

The staleness did not cause a wrong answer. On turn 21 the block still named the wrong key holder and the
model answered from the still-visible handover instead, noticing the empty belt. Eleven probes asked
about facts 4 to 59 turns old; ten were answered correctly, including the one whose answer existed only
in a floor folded since turn 10, which retrieval quoted.

## Decision

1. **The state block remains a snapshot of the last accepted summary.** The pipeline does not extract or
   reconcile anchors per turn, and does not add a second model call for them. The measured defects are
   staleness by up to one cadence and over-keeping, neither of which a verification call addresses.
2. **The transcript stays the authority inside the window.** Folding only hides floors an accepted summary
   covers (N1), the newest floors are never hidden (N2), and a state change is therefore always present in
   the prompt while the block is stale. This is the property that made the stale window harmless, and it
   is why the lag is reported rather than corrected by hiding more.
3. **The knowledge list keeps a hard cap of 20 and reports the overflow.** The one-line-per-subject rule is
   kept for carried lines, but it is not relied on as an invariant: the summary cannot be assumed to write
   one line per character.
4. **The staleness is a known, bounded cost, not a defect to close by refreshing more often.** A per-turn
   refresh would spend a model call per turn to remove at most one cadence of lag on facts the prompt
   already carries.

## Consequences

- The write path stays at one background call per cadence. The cost of a stale block is paid in the prompt,
  not in background calls.
- The over-keeping is bounded by the knowledge cap only; the anchor list has no cap beyond its token budget
  and grew 7 to 20 over 60 turns.
- A user-visible symptom exists for the one case that matters: an entry the summary stops re-stating is kept
  and flagged rather than dropped.

### What this does not fix

- **The contradictory pair inside the knowledge block.** Two lines for one character can both be current and
  contradict each other. The cap and the overflow count make it visible; they do not resolve it.
- **Over-keeping as a rate.** One model at one cadence. Whether a different summary model keeps one line per
  character, or drops them, is unmeasured.
- **The last ten turns of a chat.** A change made just after a pass is not projected until the next one, and
  a chat that ends there never projects it at all.
