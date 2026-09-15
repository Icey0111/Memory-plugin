# ADR-0045: A quoted window follows the region its channel found

- Status: accepted
- Date: 2026-09-15
- Supersedes: -
- Superseded by: -

## Context

ADR-0044 recorded a measured rejection - a descriptor-cluster *score* does not pay for the character channel -
and left the next rule to try, in order: a span quoted because a channel picked it should have its window
follow that channel's region, and descriptor ownership should be decided by sentence rather than by nearest
mention. This is the first rule, shipped and measured on the ten-question probe set that ADR built.

The defect in one paragraph: the character channel scores descriptor words within +/-60 characters of a
mention of the name, and this prose describes a person *before* naming them. On the real chat the describing
paragraph sits at 188-334 and the name's first mention at 349, so the channel picked a 700-character action
beat instead, and even when the introduction row was reached its trimmed window followed the question's own
words - which for "薇斯珀的外貌和性格是什么？" do not occur near the description at all.

## What changed

Three mechanisms, each measured alone and together before any of them shipped.

1. **Window terms are filtered by the story's own frequency.** `queryWindowTerms` takes the chunk collection
   and drops any term that more than `ENTITY_DF_RATIO` (25%) of chunks carry - the test the rare-term channel
   already applies to its own terms. A word the whole story uses is not a place to look. Measured on the real
   chat: "什么" occurs four times in the describing row and twice in the charcoal-pit row, and it alone moved
   two windows off the sentence the question was about.
2. **A span quoted because a channel picked it keeps that channel's region.** `profileTargets` and
   `entityTargets` report where in the row the signal was found - the densest run of descriptor words, or the
   occurrence of the term - and `rankRawChunks` carries it to the packer as an `anchors` entry. When a span
   has to be shortened, the anchors are the incumbent window seats and the head is the fallback, so the
   question's words displace a channel's region only by covering strictly more of the row. A term's seat
   reaches back `ANCHOR_PREROLL` (48) characters: the phrase that answers a question about a named thing
   modifies it rather than following it ("一个穿灰袍、拄藤杖的老头" answers "最显眼的穿着是什么"). A
   character's own name is never an anchor, because the describing sentences come *before* the name and
   anchoring on the name cuts the paragraph off behind it - found by the synthetic fixture, not by reasoning.
3. **A character's introduction is a candidate of its own.** For each named character the earliest hidden
   chunk that mentions the name becomes a second target of the character channel, with the densest run of
   that row (within 200 characters of the mention) as its region - unless another candidate name is mentioned
   earlier in that same row, which makes it *that* character's row and their target. The qualification is
   measured, not guessed: see the 43-name table below. The score cannot find that row: the
   describing sentences name nobody, so no mention sits near the words, and the name is common enough that
   the rare-term channel drops it as prose. The descriptor lexicon also gained the words those sentences
   actually use (`斗篷`, `皮甲`, `短刃`, `刀鞘`, `颧骨`, `目光`, `语气`, ...); the original list was
   body parts and weapons, which is the vocabulary of an action beat.

The run that decides a description is the *densest* run, not the count within a wide window: a 240-character
window that starts at a row's opening scene accumulates the scene's words as well as the description's and
wins, which put the window on "门口站着一个身影" instead of on "她比我矮半个头". At 120 characters the
paragraph wins.

## Measured

Ten labelled probes from the real chat (built for ADR-0044), every needle verified unique, counting a hit when
the needle is inside a quoted window. Each mechanism was behind a switch during the sweep:

| construction | hits |
| --- | --- |
| shipped before this ADR | 2/10 |
| frequency-filtered window terms only | 2/10 |
| channel regions as window seats only | 3/10 |
| introduction candidate only | 2/10 |
| frequency filter + channel regions | 5/10 |
| all three mechanisms | 7/10 |
| all three + the descriptor lexicon | **8/10** |

The window rule has to be right, not only the ranking: the introduction candidate on its own reaches the
describing row and leaves the set at 2/10, because the window still follows the question.

The two remaining misses are named rather than averaged away:

- `s_hair` (瑟拉菲娜的头发是什么颜色？, needle 粉色的发丝 in row 6): the row never ranks - the channel speaks
  for row 2, where she is introduced, and the needle is in a later row it never nominates. A ranking defect,
  not a window one.
- `g_robe` (needle 穿灰袍 at 609 in row 12): the row is quoted and the window starts at 610 on the only
  matching question term ("老头" at 617), three characters after the modifier phrase that answers the
  question. The window-boundary case; ADR-0044's second rule is about this shape.

## Measured against the 43-name pick table

ADR-0044's other instrument is a hand-judged table over twelve recorded chats and the real one: for each
candidate name, is the chunk the channel picked a description of that name. It was re-measured with the same
method, the same chats and the same name lists, and the baseline was reproduced exactly (43/43 rows, every
chunk id, row index, occurrence count, descriptor count and score identical).

- **Top pick: 3 of 43 changed, and none of them is an improvement or a regression** - all three are ties or
  near-ties moved by a newly-known word, and the hand reading calls both rows of each pair what the baseline
  called the old one. Totals stay **23 not-a-description / 20 a description**, so the score is not
  re-litigated and the lexicon flipped no verdict.
- **Introduction candidates: 25 without the qualification, of which 8 were read as *not* introducing that
  name.** All eight are one shape: 老谈's first mention is the closing clause of 秦婶's introduction
  ("她还说，渡船是下游老谈的。"), so the row introduces somebody else. Requiring that no other candidate
  name is mentioned earlier in the row removes all eight and a ninth of the same shape; it also loses one
  genuinely useful row, one that introduces two names at once (a cat named in the row that introduces the
  innkeeper). 15 candidates remain, every one of them a row that introduces or describes the name, and 14 of
  them belong to characters whose top pick is one of the 23.
- The motivating case survives the qualification and is the reason it is worth keeping: for 薇斯珀 in the
  real chat the top pick is still the action beat, and the introduction candidate is `raw_9:0:691` row 8 -
  "她比我矮半个头…穿着深绿色的皮甲…她叫薇斯珀，是这片林子里的巡林人".

## The shipped path, on the turn that failed

The probes each pass their own question as the query, which is not how the runtime works: the runtime plans the
query from the pending user turn and supplies the character names from the knowledge block. Replaying the real
chat's actual memory-check turn through `planRetrievalQuery` (focused strategy, 44-character query,
`profileNames = ["薇斯珀"]`) and then the shipped ranker and packer: the evidence block quotes rows 41, 30,
**8**, 23 and 24, and row 8's window is `[146, 352]`, anchored on the descriptor region and carrying **all
five** of the row's appearance and clothing details (左颧骨, 深绿色的皮甲, 藤条编成, 刀鞘上刻着, 像刀子一样直).
Before this change the same turn quoted neither row 8 nor those details anywhere. That is the production
query, not a probe question, and it is the reading the probes were a proxy for.

## The live turn after the change

The memory check was then run again in a branch of the same chat, and the record the plugin kept for that turn
is the live reading this ADR was otherwise missing:

- `profile_names = ["薇斯珀"]`, `profile_terms = [{quoted: true, detailed: true, descriptors: 13}]`. The
  `detailed` reading is now true rather than the false success ADR-0044 found on an action beat.
- Five spans were quoted (trace: 5 included, 16 entry_cap, 1 same-message): row 8 at `[146, 352]` with
  `anchored: true`, and rows 24 `[136, 340]`, 28 `[768, 995]`, 30 `[1139, 1347]`.
- Row 8's candidate is `["lexical", "profile"]` at relevance 0.008 - the lowest of the five. The character
  channel's introduction candidate is what carried it into the block, and its window is the descriptor region,
  so seven descriptor phrases of that row sit inside the quote (左颧骨, 深绿色的皮甲, 藤条编成, 刀鞘上刻着,
  像刀子一样直, 鬓角, 灰绿色的眼睛). Without the anchor the same span would have been trimmed to its head.
- Read against the quoted text, the reply's appearance and clothing sentences are grounded in it, including
  "鞘上刻着和我家门框一样的图腾" and "左颧骨有道细疤……她一抿嘴，那道疤就跟着抽一下"; its scene sentences are
  grounded in rows 24 and 30; and "缠纹和你肩上那几道岔口，一处不差" traces to row 26 ("它们的走法跟火塘边那半截
  藤杖上的一模一样。一圈缠一圈") and to the injected knowledge line about the half-burnt staff. The clauses
  that are not in the text are voice rather than fact ("编得比我的结实，刺都是朝外的", "鞘口磨白了", "不是讲究，
  是怕打斗时被抓住") and contradict nothing.
- One diagnostic gap surfaced on the same turn, worth its own iteration: `asked_terms` records 外貌 and 性格
  as `recalled: false`, because that metric asks whether the *question's own words* appear in the quoted rows
  and a story never writes "外貌"; the name itself is dropped by the term frequency cap (only its n-gram
  `斯珀的` survives), so a question about a character is structurally reported as unrecalled however well the
  turn goes. The reading that matched this turn is `profile_terms.detailed`.

## The corpus check, which is not flattering

The natural track replays every real user message in the corpus through `planRetrievalQuery` and scores the
evidence that was actually packed: 73 chats, **1,258 turns** (903 request, 355 continuation), lexical only, the
same chats on both sides.

| proxy | before | after |
| --- | --- | --- |
| situation-term recall | 85.0% (3974/4673) | 85.3% (3988/4673) |
| asked-thing recall | 64.6% (3047/4718) | 64.9% (3060/4718) |
| character described (profile `detailed`) | 26.6% (101/380) | 25.5% (97/380) |
| the same, Chinese chats only | 77.0% (57/74) | 75.7% (56/74) |

Two things belong in the record rather than out of it. The profile proxy is only meaningful on the Chinese
chats: it asks whether a quoted row carries a descriptor word near the name, the lexicon is Chinese, and the 306
non-Chinese name-readings can essentially never pass (14.4% before, 13.4% after) while dominating the aggregate.
And the replay derives its character names from the row `name` fields, not from the knowledge block, so it does
not exercise the case this ADR fixes - on the real turn the name came from the knowledge block
(`profile_names = ["薇斯珀"]`). What the corpus does measure is the cost: the introduction candidate is a
second candidate competing for the same five slots, available on 290 of those turns and inside the fused top five
on 68, and on this corpus that cost is a few description readings bought for nothing.

That is the next measured step: gate the introduction candidate on a name the knowledge block tracks - which is
where the real failure lives - or give it a reserved seat, and re-run both instruments.

## Decision

Shipped. It ships as the window rule, not as a new score: the character channel's ranking score is unchanged
(occurrences x 2 + descriptors x 3), so the hand-judged pick table of ADR-0044 is not re-litigated - only the
lexicon changes which words that score counts.

The window rule (ADR-0037, ADR-0041) keeps its own contract: with no query, nothing moves and the head window
stands; equal coverage does not move a window; the head is the incumbent when no channel anchor exists; and a
quote that was shortened still records itself as trimmed.

## Consequences

- `profile_terms` is one reading per character, taken over every row the channel speaks for, so a character
  whose introduction paragraph is quoted is no longer reported as undescribed while the prompt carries it.
- The character channel speaks for up to two rows per character; `PROFILE_LIMIT` bounds characters, not rows.
- `packRawEvidence` filters window terms against the chunks it was given, so `queryWindowTerms` called
  without them (a harness, a test) behaves exactly as before.
- Proven offline by `test-profile-window.mjs` on a synthetic story that reproduces the conditions - the name
  recurs, the description precedes the name, an action beat outscores the introduction - with the control that
  the same question reaches the description only with the channel on. No chat text is committed.
- Not fixed: descriptor ownership by sentence (ADR-0044's second rule), the `s_hair` ranking shape, and the
  window-boundary shape of `g_robe`.
