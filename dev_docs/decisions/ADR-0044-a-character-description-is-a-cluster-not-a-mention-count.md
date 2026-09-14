# ADR-0044: A character description is a cluster, not a mention count

- Status: accepted
- Date: 2026-09-15
- Supersedes: -
- Superseded by: -

## Context

A real chat (21 turns, 43 rows) failed a memory check in a way the diagnostics could name. The user asked a
named character's appearance and personality and the reply described her confidently and wrongly - a garment
colour and material, a hairstyle, calluses, a height - none of which the story states. What the story does
state, in one introduction paragraph, is a garment, an eye colour and a facial feature; that paragraph was
never quoted. (The chat text stays outside the repository; only the measurements are recorded here.)

The row holding that (row 8, `raw_9:0:691`) was never quoted. The character-description channel picked
`raw_31:0:699` (row 30) instead - a water/action beat in which she is physically present - scoring 41 against
the introduction's 21. Three separate reasons, all in the metric:

1. `score = occurrences * 2 + descriptors * 3`, and `descriptors` counted lexicon words within +/-60 characters
   of **a mention of the name**. A long action row where she acts collects body and weapon words near her name
   (肩背, 手, 指, 脚, 背, 肩, 袍, 杖 - eleven of them); a real description in Chinese names the person *after*
   describing them ("...刀鞘上刻着与我家门框相同的图腾。她叫薇斯珀..."), so the cluster sits outside the window.
2. The lexicon was body-part nouns - the vocabulary of *action* - and carried none of the words that describe:
   斗篷, 皮甲, 颧骨, 鬓角, 灰绿, 图腾, 装束. The richest describing words scored nothing.
3. The mention count was a large term, so being on stage beat being described.

The instrument also lied in the other direction: `profile_terms` reported `detailed: true` for that
character while the quoted row never said what she looked like. A baseline over thirteen recorded chats
(43 candidate names, judged by reading each pick) found **23 picks that were not a description of the name**.

## Decision

- A description is scored as the **densest descriptor window** of the chunk: `describingWindow` returns the
  140-character window containing the most distinct `PROFILE_TERMS`, wherever it is, with the name required only
  to appear somewhere in the chunk. The score is `descriptors * 3 + min(occurrences, 3) * 2`, so mentions order
  the field but no longer dominate it.
- `PROFILE_TERMS` gains the appearance and clothing vocabulary that names a person: 睫, 瞳, 眸, 颧, 腮, 唇, 齿,
  颈, 身材, 腰, 篷, 甲, 兜帽, 披风, 装束, 衣着, 打扮, 灰绿, 图腾.
- `profileRecall.detailed` needs a **cluster** in the quoted row, at least 60% of the target's own cluster with
  an absolute floor of `PROFILE_DENSE_MIN` (5), so quoting the row the channel picked counts, quoting a scene
  that merely packs body words does not, and a short description is not punished for being short.
- The cluster is **anchored to the name**: it must lie within `PROFILE_ANCHOR_RANGE` (200 characters) of a
  mention of that name, or the chunk is not a candidate for it. The cluster itself is name-independent, so
  without this a chunk that mentions an object once and describes a person densely wins for the object.
- `describingWindow` does not depend on the name, so it is computed lazily once per mentioned chunk and reused
  for every name in the batch.

## Consequences

- On the real chat the target row moves from score 21 (8th) to 39 (1st): the evidence then quotes
  `raw_9[437,643]` - a window of the introduction paragraph - so the description reaches the prompt.
- Cost, measured on that chat (68 chunks, 4 names, min of 9 runs x 200 calls): `profileTargets` 0.53 ms before,
  0.68 ms after. The whole-ranker measurements are dominated by noise and are not used here.
- The labelled A/B on the frozen FactSurvival3 chat is unchanged (6 authored questions: 4/6 answers in evidence,
  4 of 30 quoted spans carrying their answer).
- **The risk this ADR introduced was measured and bounded.** The dense window is name-independent, so a first
  version sent objects and places to whichever chunk described a *person* most densely: on the real chat the
  amber pendant and the barrier were both routed to the character's introduction row. Distances in that row are
  7 characters from her name, 290 from the pendant and 248 from the barrier, which is what fixed the range at
  200. Comparing all candidate names across the twelve frozen chats and the real one (52 scored pairs, before
  the range and after): the picked chunk unchanged 24, changed 28; the dense window contains the scored name in
  **33** cases against 26 without the range, and contains no name at all in **11** against 23. Eight still show
  another candidate name inside the window, which is the residual to watch - a cluster within 200 characters of
  a name can still describe whoever is standing next to them.
- The other half of that live failure is **not** addressed here, and the acceptance run says so. Replaying the
  user's own appearance question on that chat with the profile channel on: before the change the introduction row
  was not quoted at all; after it, it is (`raw_9[437, 643]`, and that window contains the eye colour). But of ten
  labelled probes built from that chat (every needle unique, six of them appearance or clothing), the number whose
  needle ends up inside a quoted window is **2/10 before and 2/10 after**: the row is now reached, and the window
  - which follows the question's own words (ADR-0037/ADR-0041) - still lands somewhere else in it. For these
  questions the question's words do not occur near the description at all, so following them cannot work. The
  next rule, measured and not yet written, is that a span quoted because a **channel** picked it (the descriptor
  cluster, or a returning entity) should have its window follow that channel's region, the way `profileTargets`
  already computes one.
