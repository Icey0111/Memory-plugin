# Roadmap and Evidence Limits

## Current architecture

The active path uses versioned original text, one rolling continuity summary, continuity anchors,
knowledge records, original-chunk BM25/dense retrieval, optional reranking, and budgeted quotations.
The extracted-fact generation runtime and layered-summary stack are retired.

This iteration separates background summary work from foreground reads, invalidates all continuity
projections together after history changes, and uses request-local summary settings with response
diagnostics. Default cadence is 10 completed user turns, normally 20 message floors. Summary coverage
is source coverage, not proof of semantic fidelity.

Anchors and knowledge boundaries are re-stated by the summary rather than updated between passes, so the
injected block is a snapshot of the last accepted summary (ADR-0017), and it states the floor it is current
as of. Knowledge is one line per character, bundling what that character knows and does not know (ADR-0018);
the host counts any character that takes more than one line and warns.

## Measured on a 60-turn live run

Sixty user turns (120 floors), one chat, cadence 10, `deepseek-v4-flash`, `jina-reranker-v3`, evidence
budget 1000: six summary passes, no summary failures, no aborted turns. Every active anchor and boundary
was re-stated at every pass - `anchors_unconfirmed` and `knowledge_unconfirmed` were 0 on all 60 turns.
What the run exposed is over-keeping and staleness, not forgetting.

| turn | 10 | 20 | 30 | 40 | 50 | 60 |
| --- | --- | --- | --- | --- | --- | --- |
| anchors | 7 | 9 | 9 | 12 | 16 | 20 |
| knowledge | 6 | 8 | 9 | 14 | 18 | 20 (capped) |
| knowledge lines on the busiest subject | 1 | 2 | 2 | 3 | 4 | 6 |

At turn 60 the knowledge block spends its 20 entries on eight subjects, six of them on one character, and
韩铮 holds both `不知道 账本存在` and `知道 账本在林昭手中`. The prompt asked for one line per statement;
the model was not writing one line per character.

State changes reached the injected block after 7, 6 and 4 turns, and two changes made at turns 52 and 54
never reached a block inside the window. The only contradiction observed was that window: for turns 15-20
the block still said 黄铜钥匙归林昭 after the handover on turn 14. The transcript of the handover was still
visible, and the model used it - the turn-21 probe was answered correctly by noticing the empty belt.

Eleven probes asked about facts established 4 to 59 turns earlier; ten were answered correctly. The one
probe whose answer existed only in the original text (a lamp detail from turn 6, folded since turn 10) was
retrieved and answered from the quotation. Of the eight probes whose source floor was folded, two had that
floor packed into the evidence block; the other six were already carried by the state block, so retrieval
was not what answered them.

### After the protocol change (ADR-0018)

The knowledge section now asks for one line per character that bundles what that character knows and does
not know, every injected block states the floor it is current as of, and the host counts subjects that took
more than one line. Verified on a fresh 30 user turns (60 floors), same cadence, model and reranker, three
summary passes, 0 summary failures and 3 generator retries:

| observation at turn 30 | 60-turn run | verification |
| --- | --- | --- |
| knowledge entries | 9 | 7 |
| most lines on one subject | 2 | 1 |
| subjects with more than one line | 1 | 0 |
| probes answered | 10 of 11 over the whole run | 6 of 6 |

The verified form keeps one line per character and puts what the character does *not* know in that same
line, which is what the merge rule always assumed. The stale window is unchanged: the key handover on turn
12 stayed wrong in the block until the turn-20 pass, a lag of 9 turns.

### Which layer actually answers (four runs, 114 turns, 27 probes)

Every probe was answered correctly across the four runs. The single exception was a character declining to
assert a death on the strength of one report, which is the answer the scene wanted.

| where the answer already was | probes |
| --- | --- |
| the injected state block (summary + anchors + boundaries) | 24 of 27 |
| the summary alone, on the purpose-written probe set | 10 of 10 |
| **retrieval was the only possible source** | **3 of 27** |

The last row is the finding. Retrieval was the only possible source in 3 of 27 probes, all in the 60-turn run
(turns 40, 51, 59); in the 30-turn run and in both 24-turn probe runs it was never the only source. All three
were answered, and the two whose answer exists as original text had that text quoted. No missed recall was
observed - three cases are not a rate.

The summary is why. On a purpose-written probe set - a meaningless serial `灰鹭17-B`, a door plate
`丙字三号`, a count that fell from seven to five, an `靛蓝` lining - the summary carried all ten details at a
600-token budget, and still carried all ten after the budget was cut to 300 (summaries 344 vs 409 characters
stored). Squeezing the budget shortened the prose and kept the itemised facts.

So the continuity block is the foundation the story leans on, and retrieval covers what that block drops. The
cost of the arrangement is the prompt budget the block occupies, not the accuracy of the index.

### Situational recall, which is what retrieval is for

Those 27 probes were questions. Recall is not a question: it is a past person walking back in, a visited place
coming round again, a borrowed object being named again. The trigger is the situation - the recent messages -
and the test is whether the earlier floors come back with it, without anyone asking.

A 30-turn run was written for that, with six such moments and every relevant floor folded before its moment:

| observation | measurement |
| --- | --- |
| turns that packed any evidence | 20 of 30 (67%; 50 of 60 and 20 of 30 in the two earlier runs) |
| moments that brought back at least one earlier floor of the thing that returned | **3 of 6** |
| relevance of the slots when it did | 1 of 3 slots; the other two went to recent floors or floor 1 |
| continuity block carried the returning entity | 6 of 6 |
| reply treated it as familiar | 6 of 6 |

Missed outright: the tea-shed keeper when the shed came back, the bronze lamp when it was named again, and the
dispensary back door when the route was discussed. The lamp's introduction was floor 4 and the run quoted
floors 20, 10 and 10 instead. The lexical channel had found all three; it ranked them too low to survive
fusion, and a rerank shortlist is the fused head, so they could never be reordered in.

**Fixed in ADR-0019**, by giving the situation its own fusion channel and a shortlist guarantee. Measured on
the same 30-turn run:

| observation | before | after |
| --- | --- | --- |
| reappearance moments that recalled a floor of the thing that returned | 3 of 6 | **5 of 6** |
| mean share of the three slots about that thing | 0.22 | **0.39** |
| automatic metric over 30 turns (`entityRecall`) | not recorded | 60 of 128 terms (47%) |

The per-turn terms are readable: the lamp is recalled on the turn it is named again, and `左手小`, `手小指`
and `缺一节` come back with the innkeeper on the turn he returns.

Two limits stand. The terms are character n-grams rather than names, so `能看见` and `收回来` are counted as
missable entities; 47% is an indicator to trend, not a recall score. And a first report of this table claimed
that 10 to 15 percent of evidence slots were spent on a second span of a message already quoted that turn.
Counted by message id that is 0 in all three runs - the repeated floors were the two messages of one turn, which
are two messages. The one-span-per-message rule survives as a guard, not as a measured gain.

**Correction to the section above.** "Retrieval is a fallback that rarely fires" is true of questions and false
of recall. Retrieval packs evidence on two thirds to five sixths of turns; what is rare is a question only it
can answer. Measured by situation, it fires constantly and finds the right earlier floor about half the time.

### The detail a person needs (ADR-0020)

The situation channel recovered things, not people. `profileTargets` now takes the character names the
summary already tracks and that the last three messages mention, and claims the hidden chunk that describes
them - the most mentions of the name and the most descriptor words said near it. Measured on a 26-turn run
where three characters and one place were introduced with distinctive attributes, folded, and brought back:

| observation | measurement |
| --- | --- |
| turns with a known character in the situation | 16 |
| turns where a describing passage was quoted | **15** |
| contradicted a folded attribute | **0 of 6 checked turns** |

The replies show what that buys. When the innkeeper reappeared, the model said the little finger could not be
seen through the fog and had a character ask the tea-seller to confirm it instead of asserting a version it
could not see. Six checked turns are not a contradiction rate, and a guard is not justified by them.

### Slot allocation, measured by replay (ADR-0021)

Adding the situation and character channels pushed the general similarity channel out: the best candidate
matching only the last three messages kept a slot on **1 of 17** turns. Replaying a recorded 26-turn chat
through the packer under each variant - rather than generating twice - settled it:

| variant at a 1000-token budget | entity recalls | similarity kept | tokens/turn |
| --- | --- | --- | --- |
| 3 slots (was shipped) | 84 of 136 (62%) | 1 of 17 | 611 |
| 3 slots + a seat for similarity | 63 of 136 (46%) | 17 of 17 | 875 |
| 5 slots | 116 of 136 (85%) | 5 of 17 | 593 |
| 6 slots | 128 of 136 (94%) | 10 of 17 | 604 |

Reserved seats are not shipped: the claiming channels already rank at the head, and a seat for similarity is
zero-sum. The divisor changed instead - `EVIDENCE_TOKENS_PER_SLOT` 333 to 200, cap 6 to 8 - because the
packer spends only what its candidates need, so the same budget now reaches three times as many messages for
no more tokens. The first run of this experiment was invalid: it ran against a host page holding the previous
build, so every variant was the baseline.

### A second scenario, with no memory question asked

Every earlier run carried probes. This one is a different story entirely - a repair dock in a northern salt
harbour, new characters, new places - and the user only talks: no turn asks about the past, so recall has to be
triggered by the situation or not at all. 30 turns, 0 summary failures, evidence on the 20 turns that had
folded text to reach.

| observation | measurement |
| --- | --- |
| turns with a known character in the situation | 20 |
| of those, turns that quoted a passage *describing* them | **20** |
| attribute checks kept / contradicted | **6 / 6 kept, 0 contradicted** |
| mean evidence tokens, mean slots used | 362, 3.33 of the 5 the budget pays for |

The hardest check is the one that matters. On turns 21 and 22 the manager arrives with a bandage, and the
attribute was **not** in the summary block: it came from the original text. The reply put the bandage on the
left eye - the one the story gave him - and nowhere invented a problem with the right one. The same reply
noticed that the navigator's copper ring was lying on the bench rather than in her ear, a detail from a floor
folded ten turns earlier, and the next turn put it back on the correct ear.

That is the third scenario in a row with no observed contradiction, which is still not a rate: three runs,
twelve checked attributes across the two runs that check them, one model. An earlier version of this section
said eighteen; the two check tables hold six each.

### The first failure on a chat a human drove

Twenty-five turns run by hand, in character, with no probes. On the last turn the user asks what a mushroom
looks like - "赤斑伞是什么特征来着？" - and the answer is wrong in a way the design was supposed to prevent.

Floor 18 holds the authoritative description: "帽面暗红，上头一串一串褐斑，顺着伞盖的纹路排，像用火烧过一道。
柄细，根扎在朽藤和老杉根交缠的地方". Replaying the turn offline against the stored archive:

| floor | what it says about the mushroom | rank of 49 candidates | quoted? |
| --- | --- | --- | --- |
| 6 | "一种长在林地阴影处的蘑菇，色泽鲜艳" - no appearance at all | 5 | **yes** |
| 18 | the description above | **16** | no |
| 19 | mentions it in passing | 17 | no |

The evidence block spent 899 tokens on floors 5, 9, 8, 6 and 10. The reply then produced 朱红伞面, 白里带灰的
褶子, 一拃高, 一丛三株 and 掐开肉泛红 - **none of which appear anywhere in the original text** - and turned floor
18's 褐斑 into 暗红斑 and its 火烧纹 into 藤爬纹. It is the first contradiction a run has produced, and the
first one a user would see.

**Mechanism, corrected.** The first reading of this blamed the entity channel: it claims a term's earliest
hidden holder and its best-ranked one, and both resolve to floor 6. That is true and it is not the reason.
Floor 18 ranked **16th of 49 candidates, inside the 24 the reranker is given**, and the reranker chose floors
11, 13, 17, 19 and 20 over it. The descriptive floor was available and the stage that reorders candidates
demoted it, so the bottleneck is the reranking decision, not the candidate set. A densest-mention claim was
implemented to move floor 18 and did not move it (still rank 16); it was reverted rather than shipped
unverified.

**The warning misfired too.** The panel warned that 8 situation terms were not recalled; those 8 were
character n-grams (`她的指`, `喝了两`, `回来了`). It fired on the right turn for the wrong reason, and pointed
at nothing a user could act on. A metric that counts fragments cannot report "the thing you were asked about
was described in a floor that was not quoted".

## Validation still worth extending

1. Repeat the long run with other summary models and cadences. One model at one cadence follows the one-line
   instruction, and one model at one cadence is all that has been measured; the host-side counter exists so a
   model that does not follow it is detected rather than argued about.
2. Isolate the effect of the horizon header. Both the 60-turn run and the verification answered the
   stale-window probes correctly, so the header's benefit is unmeasured; it is kept because it removes an
   ambiguity for about a dozen tokens per block, not because a measurement showed a gain.
3. Measure whether a per-turn state refresh costs less than the contradictions it would remove. The current
   block is free but stale by up to one cadence, and a contradiction inside it is now a known shape.
4. Evaluate live recent-message queries on held-out stories. Four runs did that and the question moved: at
   this scale live play almost never makes retrieval the only source, so the same runs cannot justify reranking
   either. Revisit with a corpus the summary cannot hold, or where a whole cadence is summarised into a budget
   far below what it now uses.
5. Measure archive growth with edits and branches over hundreds of turns. Earlier near-zero numbers of
   superseded versions are observations from those chats, not a bound on future storage.

## Constraints

- Knowledge boundaries are explicit records, not enforced information-flow restrictions.
- Summary/anchor/knowledge token budgets bound injected blocks, not the host's unsummarized tail.
- Embedding and reranking calls have costs beyond the final LLM context budget.
- The earlier 87% answer-in-context result belongs to its measured question set and provider.
- Source-id coverage verifies provenance alignment, not whether every necessary fact was summarized.
- Retrieval fires on most turns. Its situational hit rate was 3 of 6 on the run written to test it and is
  5 of 6 after ADR-0019; its character-profile form quoted a describing passage on 15 of 16 turns where a
  known character was in the scene. Each of those is one chat. The entity metric counts n-gram fragments and
  is an indicator rather than a score, and the descriptor lexicon behind the profile channel is hand-written.
- The state block is stale by up to one cadence by design (ADR-0017); the visible transcript is what covers
  that window.

A measured failure exists for the state block - over-keeping and staleness of up to one cadence - and the
first of the two has been fixed by changing the restatement protocol rather than by adding a model call
(ADR-0018). The remaining work is a change to the projection, not a new memory hierarchy or a per-floor
summarizer.
