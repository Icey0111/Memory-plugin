# ADR-0020: A named character gets the passage that describes them

- Status: accepted
- Date: 2026-09-13
- Supersedes: -
- Superseded by: -

## Context

The division of labour this project settled on is that the summary carries the logic - who these people are,
what they want, what is unresolved - and retrieval carries the concrete detail. ADR-0019 put the situation's
*terms* into the fusion, which recovered a returning object or place but not a returning person: the passage
that says what a character looks like or is like is rarely the passage that best matches the last three
messages, and it is the one the story contradicts itself against when it goes missing.

The character names were already extracted. The knowledge block is keyed by name (`林昭/知道`), so the
summary has already decided who exists; no second model call is needed to know who is in the scene.

## Decision

1. **A character who is in the situation claims the chunk that describes them.** `profileTargets` takes the
   known names that appear in the query, and for each picks the hidden chunk with the most mentions of the
   name and the most descriptor words said within 60 characters of it. The window is required because most
   descriptor words are common enough to appear somewhere in any chunk.
2. **The descriptors are a hand-written lexicon** (`PROFILE_TERMS`): eyes, hair, scars, build, voice, hands,
   clothing, and a short list of manner words. It is Chinese-only by construction.
3. **It is a fusion channel at 0.6 of a lexical vote, and it keeps a rerank seat** like the situation channel,
   so the describing chunk cannot be ranked out before it can be reordered.
4. **`profileRecall` reports the distinction that matters**: whether a quoted passage *mentions* the character
   or *describes* them, because a scene they appear in is not the same as a passage that says what they are
   like.

## Consequences

Measured on a 26-turn run written so that three characters and one place are introduced with distinctive
attributes, folded, and then brought back:

| observation | measurement |
| --- | --- |
| turns with a known character in the situation | 16 |
| turns where a *describing* passage was quoted | **15** |
| turns where they were only mentioned, or not quoted at all | 1 / 0 |
| checked turns where the reply contradicted a folded attribute | **0 of 6** |

The replies are the more interesting half. On the turn the innkeeper reappeared, the model wrote that the
little finger could not be seen through the fog and had a character ask the tea-seller to confirm it, rather
than assert a version it could not see. On the next turn it restated the cough. Nothing invented an attribute
the folded text did not contain.

### What this does not fix

- **The trigger is loose.** A name anywhere in the last three messages is "in the situation", so the channel
  claims a slot on most turns (15 of 16 here). With three evidence slots and two channels now claiming seats,
  the budget is under pressure that is not yet measured.
- **The lexicon is hand-written and Chinese-only.** A character described by a word outside it is only
  "mentioned", not "described".
- **Consistency is measured, not enforced.** Nothing prevents a contradiction; this run simply did not produce
  one. A guard would need a detector, and six checked turns do not justify building one.
