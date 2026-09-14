# ADR-0041: The evidence window is moved by words before n-grams

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

ADR-0037 moves a trimmed evidence window onto the part of the message the question is about, and it measured
coverage with the ranker's own tokenizer - CJK 2- and 3-grams. Those over-match: a 2-gram is shared by any
prose that happens to contain the same two characters in order, including the fragments that straddle two of the
question's words. Measured on the frozen probe turn (windowfix7), the message holding the tea answer had a head
window that covered two such fragments and **zero question words**, and no other window covered more, so the rule
did not move and the answer stayed outside the quote. The same turn's scar row moved only because its n-gram
coverage happened to differ.

## Decision

`queryWindowTerms` returns two layers: **words** from the host's own segmentation
(`v55-tokenizer.js`'s `segmentWords`, the precision layer the lexical channel already uses) and the ranker's
**n-grams** underneath it as the recall floor. `slideWindowToQuery` compares candidate windows by distinct
words first and distinct n-grams second, and generates its candidate start positions from both layers. The
head-anchored window is still the incumbent and only a strictly better window moves it.

## Consequences

- Both frozen losses are recovered by the replay of that probe turn with its own emitted rows as the candidate
  list: `raw_9` moves from `[0, 199]` to `[290, 489]` and now holds `茉莉`; `raw_19` moves from
  `[0, 231]` to `[103, 334]` and holds `月牙`.
- No regression where the change should not matter. The labelled A/B on the same frozen chat (six single-topic
  questions, lexical, identical candidates on both sides) is 4/6 before and 4/6 after, with the same 4 of 30
  quoted spans carrying their answer and the same token totals within noise. Replaying the per-turn probes, each
  one still quotes the row that carries its needle and the negative control still quotes nothing.
- The gain is on mixed questions, which is where the loss was: the six labelled questions name one subject each,
  and both layers already found those answers.
- Cost: about 1.06 ms per pack with the query against 0.80 ms with none, where the n-gram-only layer measured
  about 0.97 ms, so the word layer is roughly 0.1 ms.
- The limit ADR-0037 recorded still stands: a window moved by the question's own words cannot find an answer
  whose sentence shares no question word at all. The per-turn probe composition is what covers that case, not a
  better window.
