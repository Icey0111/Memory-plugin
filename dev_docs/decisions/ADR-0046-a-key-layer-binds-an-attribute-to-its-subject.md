# ADR-0046: A key layer binds an attribute to its subject, and a precision ruler accepts it

- Status: accepted (direction; nothing implemented yet)
- Date: 2026-09-15
- Supersedes: -
- Superseded by: -

## Context

The next structural step is a key layer: the summary's relation net names subjects and attributes, and retrieval
becomes a key-to-span lookup instead of a similarity search (Issue #2). The first attempt to measure it asked the
cheap question - is the needle inside a derived span? - and that number is saturable. On 16 authored questions
(ten labelled probes plus six descriptive references), adding place subjects and widening the anchored window
took coverage from 9/16 to 16/16 while the spans a question fires grew from **188 to 634** and the share of them
that actually carries the needle stayed near 4%. Coverage bought by widening is noise, not retrieval.

## Decision

1. **The acceptance instrument is a precision ruler, not coverage.** Every question is annotated with its
   subject, attribute and aliases. The ruler reads reachability (a fired key points at a span containing the
   needle), subject attribution (that span belongs to the annotated subject), route (the question names or
   resolves the subject, or fires the asked attribute), and **bidders** (every span the question fires, and how
   many of those carry the needle). A rule is accepted on reachability with bidder precision as a floor.
2. **An attribute key is composite.** It is `subject.attribute`, so it fires only for that subject's spans. The
   subject key points at the subject's *canonical* spans - the two densest descriptor runs for that subject -
   not at every row in which the name occurs.
3. **Attribute keys are kept only while they are specific.** A term that appears in more than six rows is prose,
   not a label. This is the frequency test ADR-0045 already applies to window terms, applied to the key set.
4. **The key layer owns a vocabulary and an alias table.** Attribute words the descriptor lexicon lacks
   (`裙摆`, `地面`, `斗篷`, `皮甲`, `刀鞘`) become keys, and question words map to key words
   (`伤 -> 疤`, `头发 -> 发`, `老头 -> 灰袍老者`, `水汊 -> 炭窑洼`). A subject whose name never appears in
   the story text is reached by its own qualifying name fragments.

## Measured

No model call; one definition of "precise" (reachable, right subject, legitimate route) across every row.

| derived key rule | reachable | right subject | precise | bidders | bidder precision |
| --- | --- | --- | --- | --- | --- |
| person descriptor clusters only (today's derivation) | 8/16 | 6/16 | 5/16 | 188 | 4.3% |
| + attribute vocabulary, aliases, name fragments and one canonical place key | 13/16 | 13/16 | 13/16 | 162 | 8.6% |
| composite keys (`subject.attribute`), no specificity floor | 14/16 | 14/16 | 14/16 | 112 | 13.4% |
| composite keys + the row-count floor (<= 6) | **14/16** | **14/16** | **14/16** | **38** | **36.8%** |

Binding the attribute to its subject is what stops a fired key from selecting an unrelated row: reachability rises
to 14/16 while fired spans fall from 162 to 112. The specificity floor then earns its place on top - it cuts 112
to 38 and lifts the share carrying the needle from 13.4% to 36.8% with no loss of reachability, because the
subject key's canonical span is what reaches a named subject, so the removed terms were noise rather than answers.

## Alternatives rejected

- **Flat keys.** Today's derivation reaches 8/16 with 188 bidders and 4.3% precision; a question about one
  attribute selects every row that carries a common descriptor word.
- **Coverage by widening.** The suffix-heuristic place set plus wide windows reaches 16/16 at 634-965 bidders and
  under 4% precision. The coverage number was measuring geometry, not labels.
- **Composite keys without the floor.** 14/16 at 112 bidders and 13.4% precision - reachable, but three times the
  competition of the floored rule for no extra reachability.

## Consequences and limits

- **Nothing is shipped.** The shipped pipeline is unchanged; this ADR records the form the key layer must take
  when it is built, not a capability.
- The two remaining misses are one defect: a character's later re-description is covered by no span. That is the
  selection defect Issue #2 keeps separate from the key table. A measurement the same day narrowed it further:
  anchoring a span on the attribute word and attributing it to the row's own subject reaches both misses, but the
  fan-out of a common attribute key (100 candidate spans for one key) was what blocked it. A later measurement
  the same day closed it on the ruler: attribute-anchored spans ranked by the pre-cap term count then proximity,
  plus a phrase table ranked by phrase length, reach 16/16 at 67 fired spans and 47.8%, with each miss decided by
  a rank-1 mechanism rather than a tie. An audit the same day bounds that reading: 51.4% of the fired spans carry
  no needle; splitting the query-expansion flag shows the legitimate subject-key route alone carries 13/16 and the
  shipped planner's resolution carries the last three, at 119 fired spans and 37.0%; and on an unrelated chat the
  same rule reads 2/10 where the shipped retriever reads 6/10. The vocabulary question was then tested clean: a
  mechanical derivation re-run on a third chat recovered 3 of 10 needed words and reached 3/10, against 8 of 9 and
  6-7/10 where its author had already seen the probes, and moving the occurrence choice to retrieval time did not
  beat the index-time rule. On this evidence the key layer is not better than the shipped retriever out of domain.
  See 02_development.md.
- The instrument reads a private chat and private needles, so it is not committed; its method and its numbers are.
- **A measurement defect can manufacture a design conclusion.** The first reading of the composite rules was
  taken while the ruler's subject-key route was silently inert - the canonical span set was built from pre-copy
  objects while the firing check received copies - and it reported that the specificity floor *starves* composite
  keys. With the route working, the result reversed. Any instrument change that can alter a conclusion must be
  re-run against the whole table before that conclusion is trusted.
