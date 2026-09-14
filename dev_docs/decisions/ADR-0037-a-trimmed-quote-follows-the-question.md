# ADR-0037: A trimmed evidence quote follows the question, not the message head

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

The FactSurvival3 probe asked what the ferry crossing was called and the reply said it did not remember. The
memory block that turn saw quoted five original rows and none of them carried the name - although the archive
still had it in two places. One of the five was `raw_29`, an 833-character reply whose own last sentence says
"'青石渡'这三个字，是他这渡口的名字", and it was quoted as its first 205 characters. A span larger than its
per-slot share is trimmed from the head whatever the question asked about, so both the name (offset 483) and
the question's own word 渡口 (offset 500) fell outside the quoted window. Replaying the frozen chat through
`packRawEvidence` at the shipped 1,000-token budget reproduced `{source: raw_29, start: 0, end: 205}`
exactly, so the defect is in the packer and not in the recording.

The weight this carries is the product contract's: the floor-10 summary had already dropped the place name, so
the evidence channel was its only route back to the prompt, and quoting the message without the answer spends
the same budget to answer nothing.

## Decision

The trim branch of `fitEvidenceSpan` chooses *where* the window sits, not only how long it is. Candidate
starts are the occurrence positions of the question's own terms in the matched text, each positioned at the
window's start and at its end; the head-anchored window is the incumbent, and only a window covering strictly
more distinct question terms displaces it. Terms come from the ranker's own tokenizer, so a window moves by
exactly the terms that made the message rank, and one-character terms are dropped because they occur several
times per sentence. Terms are capped at 256 (longest first) and candidate starts at 400, which is what bounds
the cost. The growth branch, the per-slot share, the entry count and the total budget are untouched: the window
keeps its length, so the number of messages reached and the tokens spent do not change.

## Consequences

- Labelled A/B on the frozen FactSurvival3 chat (6 authored questions, lexical only, the same candidate list
  both sides): answer-in-evidence 3/6 -> 4/6, quoted spans carrying their own answer 3/30 -> 4/30, 790 -> 783
  tokens per query. The recovered question ("灯座内侧有什么痕迹？", needle 两道被磨平) had been dropped as
  `trimmed_out`; nothing regressed.
- The live case is repaired: the same span is now `{start: 295, end: 500}` and ends on the sentence that names
  the crossing. Reconstructing that turn's five quoted rows and re-packing them moves three windows (the
  crossing reply gains the name) for 666 tokens against 671 - the same budget, spent on the part of each
  message the question was about.
- Selection is not touched. In the lexical-only replay the crossing question still ranks 10th and is dropped
  by the entry cap, so this fixes what is quoted once a row is chosen; the live run's fused ranking did reach
  the row. Recovering a row that never ranked is a different defect with a different fix.
- The rule is deliberately conservative and says so: a window that already covers as many question terms as
  any other is left where it is, so a message with nothing to choose between its windows is quoted exactly as
  before.
- Cost measured on the frozen chat: 1.10 ms per pack with the query against 0.82 ms without, at most five
  trimmed spans per turn.
- A quote is evidence, not a claim about the current world state; the summary contract and the ranking are
  unchanged by this ADR.
