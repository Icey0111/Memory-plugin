# ADR-0044: A descriptor-cluster score for character descriptions was measured and rejected

- Status: rejected
- Date: 2026-09-15
- Supersedes: -
- Superseded by: -

## Context

A real chat (21 turns) failed a memory check in a way the diagnostics could name. The user asked for a named
character's appearance and personality; the reply described her confidently and wrongly. The story *does*
introduce her, in one paragraph that describes her **before** naming her. That row was never quoted. The
character-description channel picked a 700-character action beat in which she is physically present:

| row | mentions of the name | descriptor words within +/-60 chars | old score |
| --- | --- | --- | --- |
| action beat (row 30) | 4 | **11** body and weapon words | **41 - picked** |
| introduction (row 8) | 3 | **5** | 21 - eighth |

Three reasons, all in the metric and the lexicon: the descriptor test was a window around a mention, and an
action row naturally packs body words around an active character; Chinese names the person after describing
them, so the cluster sat outside the window; and the lexicon was body-part nouns (the vocabulary of *action*)
with none of the words that describe a person. The channel also reported `detailed: true` for that character
while the quoted row never said what she looked like - a false success.

A baseline over twelve recorded chats and the real one (43 candidate names, every pick read by hand) found
**23 picks that were not a description of the name** and 20 that were.

## Attempted, and measured

The change tried: score by the densest 140-character descriptor window of a chunk instead of by descriptors
near a mention; extend `PROFILE_TERMS` with clothing and face words; require the cluster to be within 200
characters of a mention (the first version routed an object and a place to whichever chunk described a person
most densely); credit each descriptor to the nearest candidate name; and break equal scores by the cluster's
distance to the name.

Measured, with the same hand-judged method as the baseline:

- **It does not pay.** *** went 23 -> 24 and KEEP 20 -> 19: three names fixed, four regressed. Of 43 picks,
  **19 landed on a cluster about a different character** before the distance rules, and the three regressions
  are one shape - the same character in three chats, where two rows tied and the tie went to the row whose
  cluster describes someone else.
- **Two of the three "fixes" were accidental cross-character wins**, not the channel finding the right row.
- The one real fix - the motivating chat - is real: the introduction row does get picked and quoted
  (`raw_9[437, 643]`).
- **It does not fix the user's question either.** Of ten labelled probes built from that chat (every needle
  unique, six about appearance or clothing), the number whose needle lands inside a quoted window is
  **2/10 with the old rule and 2/10 with the cluster rule**: the row is now reached, and the window - which
  follows the question's own words - still lands elsewhere in it.
- The lexicon extension alone (old score, new words) keeps the three regressions correct but leaves the
  motivating failure in place: the action beat still outscores the introduction, 44 against 21.

## Decision

**Do not ship the cluster score.** The lexicon extension and the cluster reading were part of the same
attempt and are reverted with it, so this ADR changes no behaviour: the channel scores as it did before.

## What this leaves behind

- The mechanism and the numbers above, which are the diagnosis the next attempt starts from.
- A reusable labelled probe set for that chat: ten questions with needles verified unique, of which **2/10**
  have their needle inside a quoted window today (the rest are split between the row never being quoted and
  the window landing elsewhere in the row).
- The next rule to try, in order:
  1. **A span quoted because a channel picked it should have its window follow that channel's region.** For
     these questions the question's own words do not occur near the description at all, so a window driven by
     them cannot work; `profileTargets` already computes the region a description sits in.
  2. **Ownership by sentence, not by nearest mention.** Crediting a descriptor to the nearest candidate name
     misattributed a pronoun-subject sentence ("he has an old scar" belongs to the man named in the previous
     sentence, not to the innkeeper named in the next one). A same-/adjacent-sentence rule is the shape to
     measure next; the nearest-mention rule was measured and is not it.
- The lexicon extension is a prerequisite for either of those and should be re-measured with it rather than on
  its own.
