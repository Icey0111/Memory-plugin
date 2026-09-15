# Development and Validation

The extension is native JavaScript ES modules, with no build step. Use Node.js 20 or newer.

| Command | Purpose |
| --- | --- |
| npm run check | Discover and syntax-check sources |
| npm test | Offline regressions, including host adapters |
| node test-summary-lifecycle.mjs | Cadence, concurrent reads, joint invalidation and summary transport |
| node test-anchor-budget.mjs | The never-inject-a-retired-statement rule, even round-robin selection, parked-value reporting, a slash label that keeps its content, a legacy ledger migrated as it stands, and the legacy anchor-budget notice |
| node test-anchor-changes.mjs | Numbered operations, atomic refusal, missing/empty/explicit-none sections, inline and unbulleted operations, multi-source 来源 lists with per-token validation, inferred-heading recovery and its prose counterexample, malformed fields, long labels, full conditions beyond 240 characters, frozen references, batch diagnostics, the duplicate-target refusal when an update and an end name the same number |
| node test-anchor-repair.mjs | The one targeted repair after a refused anchor section, and the one body repair after a `format` or `over_budget` refusal (a missing body and an over-ceiling body each commit from one repair, and a repair that is still wrong leaves the batch refused): validated operations, summary and boundaries preserved when the repair answers "无", replacement-only repair merged and re-validated as one batch, exactly one extra call, a failed repair that still refuses and keeps both attempts, the pre-send budget block, and a repair transport failure that keeps the attempt beside the original refusal, a redundant '结束 A1 旧状态' line repaired away while the legal update still commits, and a repair returning a conflicting end refused as duplicate_target |
| node test-runtime-precheck.mjs | The disk-vs-loaded comparison, including the stale `bad_subject` signature this acceptance run recorded |
| node runtime-precheck.mjs | Live preflight: repo vs deployed disk vs the function sources actually loaded in the page. Exit 0 only when all three agree, 1 when stale, 2 when unknown |
| node replay-anchor-evidence.mjs | Replay of the 421757c acceptance requests and responses through the current parser with no model call. Exits 0 with a note when the local evidence directory is absent |
| node eval-anchor-protocol.mjs --out report.json | Opt-in five-call model probe through an open host's summary connection and local CDP endpoint; saves synthetic inputs, raw responses, parsed operations and ledgers without writing chat state. Structural passes require manual semantic review |
| node acceptance-longchat.mjs --turns <file> --out <dir> | Reusable long-chat acceptance driver. Requires `node runtime-precheck.mjs` to exit 0 first; imports the versioned capture module from the page and refuses an `--out` inside the repository, so chat text and raw responses stay out of it |
| node acceptance-longchat.mjs --turns <file> --out <dir> --detail-survival | Detail-survival mode. Phase 1 plays a detailed turns file (every detail declares a needle and the question that tests it); the committed summary then decides what phase 2 asks. It asks only the details the summary actually dropped, plus one retained positive control and every declared negative control - all in one probe turn in `single` mode, or one question per turn with the phase-1 state restored between them in `perTurn` mode - and prints the four counts - summary-kept / retrieval-recovered / refused / fabricated - with the adjudicated rows written next to the run |
| node test-detail-survival.mjs | The mode's decision logic against captured text: the adaptive retention split over summary prose, active anchors and knowledge; channel attribution from the probe turn's own `injections.thisTurn`; the question-leak refusal; the four counts; and a Chinese-only needle against an English reply recorded as a fixture defect rather than a model miss. No model call |
| node acceptance-longchat.mjs --out <dir> --restore-snapshot <snap.json> [--restore-persist] | The harness restore. Puts a full snapshot's transcript and derived state back, resets the host's bounded ChatSurface, redisplays the canonical chat and re-applies the fold classes in that order (ADR-0034); a class-only pass cannot cure a stale projection. Needs no turns file and no model call, and does not save the chat unless `--restore-persist` is given |
| node test-acceptance-capture.mjs | The capture boundary with a simulated transport: both the summary and its targeted repair record request, response and elapsed, two consecutive turns keep separate injected blocks, and the block a turn actually saw is read from `injections.thisTurn` rather than the stale `before`. Also the restore sequence - mutate in place, reset the surface epoch, redisplay, re-apply the fold classes - against a fake host, including a partial host, a second host instance and a snapshot without rows. No model call |
| node test-summary-diagnostics.mjs | Failure stages and the retained record, the two state versions, injection recorded only after the prompt is set, the assembly-across-a-commit case, the five warning conditions, and the input-budget default |
| node test-summary-contract.mjs | The batching contract: the floor horizon, committed vs injected coverage, one-entry-per-message requests, the cost of the text that is sent, and the difference between a local budget block and an interface failure |
| node test-summary-budget.mjs | The target/ceiling split and the injection budget: the pure length verdict, the configured budget as the worst case capped by host room, a dense batch accepted over the target, a sparse one under it with equal completed turns, and an over-ceiling body refused with nothing hidden |
| node test-anchor-handoff.mjs | The parked-anchor handoff: the bounded query builder, and a committed anchor that does not fit its budget starts a recorded retrieval handoff while one that fits leaves the query alone |
| node test-recovery-isolation.mjs | A metadata-write failure after the committed state is on the store is a persistence problem, not a model failure; a write that fails before the commit still rejects and hides nothing; the raw original index is its own vector kind |
| node recall-baseline.mjs | Original-text retrieval and packing measurement. `--cassette-requests <file> --model <m> --base <u>` writes the inputs a run will read; `--embeddings <cassette>` replays them and refuses to measure when one is missing; `--adopt-legacy` reads an old `c:`/`q:` cache and reports it as unverified. Three tracks - synthetic probe (default), source-first labelled (`--paraphrases`) and natural capture (`--natural`) - share one scorer and are named in the output (ADR-0033) |
| node recall-baseline.mjs <chat> --natural [--cadence 10] | The natural track: replays the real user messages through `planRetrievalQuery`, folds synthetic batches at the cadence, and scores with the shipped ranker and packer. Reports situation-term, asked-thing and profile recall derived from the prefix history, apart for requests and continuations |
| node test-natural-track.mjs | The natural track's plumbing offline: a real query is the user text, folding hides the batch floors and keeps the newest pair visible, the packer re-echoes no visible source and quotes no continuation command, and the aggregate carries the track name. No model call |
| node recall-embed.mjs | Record the cassette the ruler replays. `--requests <file>` embeds exactly the inputs a run declared; the chat-plus-`--questions` form still builds one by hand |

## Acceptance contract

Default summary cadence is **10 floors**, a floor being one user message and the character's reply -
twenty dialogue message rows. The setting, the report and the hidden count all use that unit; message rows
are the derived number.
A character greeting is not a user turn and does not count toward the cadence; it is hidden with the first covered batch, under the same every-chunk-covered rule (ADR-0047). An unanswered user message is not completed. Tests of
specific boundaries may explicitly use another interval, but live acceptance must retain 10.

Before a live run, `node runtime-precheck.mjs` must exit 0: the repository, the deployed directory and the
functions the open page has actually loaded have to be the same code. Comparing the disk alone is not enough -
a page loaded before the deploy keeps the old module, and re-reading the served file proves nothing about it.
Comparing against a stale page load costs a whole run: one 421757c run had every deployed file matching the
repo while the page still executed the pre-421757c `parseAnchorChanges`. Exit 2 is unknown, never a pass;
deploy and reload, then re-run.

Live summary probes must save, per call and **including the one targeted repair**: `finish_reason`, the requested
output cap, prompt and completion usage, the raw body and the actual commit result. The harness must recognise
the repair request as its own call kind - the repair prompt does not carry the summary marker, so a marker-only
test drops it, which is how the 421757c long-chat run lost the repair's raw request, response and elapsed time.
The exact injected state block must be saved for **every** turn, not only the batch and final turns, or a probe
turn's reference text is overwritten before it is archived. The runner is versioned (`acceptance-longchat.mjs`
with `acceptance-capture.js`) and its record path is proved offline by `test-acceptance-capture.mjs`; the turns
file, the output directory and credentials stay outside the repository. A field that was not captured is
reported as unknown; a finish reason is never inferred from a token count; reasoning text is not stored.
Every started request carries an id and a running/succeeded/failed status: an in-flight record is not a
failure, and a call that settles between two snapshots is collected by id on a later turn instead of being
dropped. A request that never settled is reported as an incomplete capture, never as a success.

A batch refused for its anchor section is retried once by the host with a targeted repair that shows the model
its own answer and the rejected lines. A body refused for `format` or `over_budget` earns the same single
repair, recorded as `body_repair`: the request again, a correction and the refused text to cut (ADR-0042). The repair is a second call with its own recorded cost; a failed repair
still refuses the batch and keeps the original refusal. Replaying a prior run's frozen responses
(`node replay-anchor-evidence.mjs`) is the cheap way to check a protocol change before paying for story
generation again.

Each successful call covers exactly N completed turns and hides their complete messages. Manual calls
obey the same threshold. Freeze the request before dispatch; append/edit outside that batch must not
extend its coverage. The request is assembled from the batch's original messages - one entry per message,
whole text - and the text that is measured is the text that is sent. An over-budget batch is a recorded
block: no model call, no hidden floor, one record per frozen batch and budget, and no increment of the
model-failure counter (ADR-0024). A failed call records its stage - transport, empty_body, truncated, over_budget, format, input_budget,
anchor_ops - with the input cost and the response status, and a later success
marks it recovered rather than erasing it (ADR-0025). "Injected" means the host was given the block, and
the state version, not the floor count, decides staleness. Run test-summary-contract.mjs and
test-summary-diagnostics.mjs before deploying a summary change.

The detail-survival mode answers "what must the summary keep?" with a measurement instead of an
assumption. A set of small details crosses at least two summary passes; the committed summary - prose,
active anchors and knowledge - is read once, and the details it does not contain are what phase 2 asks
about, so the author's expectation is recorded as calibration and never selects a question. The positive
control comes from what the summary did contain and each negative control is a value the story never
wrote, so an answer is attributed to a channel instead of to plausibility. Channel attribution reads
`injections.thisTurn` - the block the probe turn's own generation set - never the previous turn's block,
which is the instrument defect 76c50d0 fixed. A probe question that contains the needle it tests is
refused before a generation is spent. A needle is matched with a verbatim reading first and a paraphrase-tolerant content-run reading second:
the first live run read three of six details as absent while the channels carried them as "缺角" for
"缺了一角", "左耳白" for "左耳是白的" and "第三夜前" for "第三天夜里" (ADR-0035). Both readings record the
matched token, and the question-leak check stays strict. A needle match is still a machine reading: every
item goes through answer-adjudication.mjs, and a needle-language mismatch is a recorded fixture defect
rather than a model miss. The mode measures only and changes no summary, retrieval or injection behaviour.
A live run on 2026-09-14 (DetailSurvival1, 20 turns, both batches committed, zero failures) re-scores as
摘要保留 4 / 检索取回 1 / 拒绝 1 / 编造 0: five confirmed passes and the never-written value refused.

A detail may also declare a `kind` from the product contract's list (identity, place, state, promise,
condition, negation, knowledge, detail). Retention is then read against the committed summary after **every**
batch, so the report shows which facts a merge loses and of which kind. The question-leak check is verbatim
or a content run of at least three characters, and the whole declared set is checked before the first
generation: a two-character run would refuse a legitimate question like "什么时候才开？" against the needle
"雾散了才开", and that false positive aborted a paid run after phase 1.

### First fact-survival measurement (2026-09-14)

Chat FactSurvival2, 11 declared facts, merges at floors 10 and 20. The floor-10 summary kept **11/11**. The
floor-20 merge kept **9/11**: it lost the still-live state `k-state` (the west road blocked by a landslide)
and the incidental `d-bell`, while keeping three other incidental details (`d-tea`, `d-cat`, `d-scar`).
That is **1/7 must-keep facts lost in a merge**, and the raw output for that batch does not contain it, so
the model omitted it rather than the pipeline dropping it. It answers "what must the summary keep": the
merge prunes by salience, not by kind.

The first reading said 2/7 and named `k-condition` as the second loss. Reading the frozen raw response
showed the model had written it as "老谈雾不开桨" - the same condition in the opposite polarity - and the
needle ("雾散了才开", "雾散") could not reach it. A condition may be stated either way round, so its needle
must carry both. The observation now records the batch's raw summary output beside the committed bag and
reports which stage lost a fact (`model` or `pipeline`), which is what separated the two.

The first attempt (FactSurvival1) never reached the second merge: the batch was blocked with
`reason: input_budget`, `needed_chars 43,658` against the 40,000 default, a 40,649-character batch of ten
turns whose replies averaged **3,953** characters in this run (max 5,464) - the "about 1,800" written here
  first was wrong, and a new install now starts at 60,000 (ADR-0043). Per ADR-0024 that is a recorded block - no model call,
no hidden floor - and the measurement was taken with `narrative_input_chars` raised to 120,000 and restored
afterwards. The default input budget is a measured limit for long-reply stories, not only for the context
window.

A second measurement (FactSurvival3, same 11 facts, both merges committed with the budget raised) followed
the retention change in ADR-0036. The floor-10 summary kept 8/11 and the floor-20 merge 7/11, but **every
must-keep fact survived the merge** - `state` 1/1 and `condition` 1/1, where the first measurement lost the
state - and incidental occupation fell from three facts to one (`d-cat`). The place name `k-place` was
absent, but it was already absent from the floor-10 summary and the raw output never wrote it: an initial
omission, not a merge loss.

### Repeats (2026-09-14)

Six runs of the same 11 facts, merges at floors 10 and 20. Two never reached the second merge:
FactSurvival1 was blocked at its batch (`input_budget`) and FactSurvival4's floor-20 summary failed
`over_budget`, so no merge committed. Neither may be read as a merge observation - FactSurvival4's report
said "across 2 merges" while only one had happened, which is why the observation now carries `committed`
and an uncommitted batch is excluded from the survival reading.

Of the four valid two-merge runs, the pre-change one lost one must-keep fact in the merge (`k-state`,
1/7) and the three post-change repeats lost none (0/7 each). Initial omissions still happened in two of the
three: `k-place` was never written by the floor-10 summary in FactSurvival3, and `k-condition` in
FactSurvival5 - though retrieval recovered the condition in that run's probe turn. Incidental occupation at
the last merge fell from three facts (pre-change) to one, two and two. The instruction change removed the
merge loss in every repeat; it did not make the first summary complete, and four runs is not a rate.

A restored chat needs the host's own reset path. Replacing `ctx.chat` and re-applying the plugin's fold
classes leaves the previous message roots mounted; the host's bounded ChatSurface allows one contiguous
viewport plus the true tail and refuses an ambiguous projection with `ChatSurface projection has 3 ranges;
maximum is 2`. `--restore-snapshot` (through `acceptance-capture.js`'s `restoreSnapshot`) mutates the
canonical array in place, resets the surface epoch, redisplays the chat, and only then re-applies the fold
classes (ADR-0034). `syncFloorFoldDom` alone is a styling pass and cannot cure a stale projection. The
restore does not write the chat file unless `--restore-persist` is given.

A live check on 2026-09-14 (DetailSurvival1, 43 rows, `bounded: false`) restored a full snapshot with
`{reset: true, redrawn: true, folded: 40}` and the next generation completed normally (731 characters,
zero retries). The three-range case itself was not reproduced: this install has
`chat_virtualization_enabled = false`, and in the unbounded controller a redisplay after the array shrank
did not throw. The reset path is shared by both controllers, so the sequence is verified; the bounded
reproduction remains to be run.

### A trimmed quote that answered nothing (2026-09-14)

The FactSurvival3 probe answered "I do not remember" for the ferry crossing. Re-reading that turn showed why:
the memory block quoted five original rows and none carried the name, although the archive held it twice. One
of the five was the 833-character reply whose own last sentence names the crossing ("'青石渡'这三个字，是他这渡
口的名字"), quoted as its first 205 characters, because a span over its per-slot share is trimmed from the head
whatever the question asked about. Replaying the frozen chat through `packRawEvidence` at the shipped
1,000-token budget reproduced `{source: raw_29, start: 0, end: 205}` byte for byte, which is what made this a
packer defect rather than a recording error.

ADR-0037 makes the trimmed window the one that covers the most of the question's own terms, keeping the
head-anchored window as the incumbent and the length, budget and slot count unchanged; ADR-0041 then put the
question's **words** above the ranker's n-grams in that comparison. Measured on that frozen
chat with six authored questions and the same candidate list on both sides (lexical only,
`recall-baseline.mjs --paraphrases`): answer-in-evidence 3/6 -> 4/6, quoted spans carrying their own answer
3/30 -> 4/30, 790 -> 783 tokens per query. The recovered question ("灯座内侧有什么痕迹？", needle 两道被磨平)
had been dropped as `trimmed_out`; nothing regressed. The crossing span is now `{start: 295, end: 500}` and
ends on the sentence that names it.

Two limits belong with the number. Selection is untouched: in the lexical replay the crossing question still
ranks 10th and is dropped by the entry cap, and only the live fused ranking reached the row - a row that never
ranks is a different defect. And a window that already covers as many question terms as any other is left
where it is, so this repairs the case where the head answers nothing rather than re-ranking every quote.

A build now records the ranking it was given as well as what it quoted: `evidence_candidates` (order,
span, fused and per-channel scores) and `evidence_trace` (one outcome per ranked candidate, with slot, cost
and whether an included quote was shortened), both bounded to 40 rows with counts over the whole record. Measured on the frozen FactSurvival3 chat
that is 4.7 KB and 2.1 KB against 289 bytes for the quoted rows alone. The question it was added for is
answerable offline: the 75-character message with all three of the probe's own words in it ranks 9 of 30
lexically and is `entry_cap`, so it was ranked out and not unrankable - the live fused run had 77
candidates from the dense, situation and character channels. Selection and packing are different outcomes in
one record now (ADR-0039).

The detail-survival probe now records what its answers are evidence of. `single` (default) asks every
selected item in one turn, so one reply is one sample of a budget that four to six questions compete for - the
live single-turn run quoted five rows and answered one of four items, and the two rows holding the answers it
missed were quoted and then cut by the trim, not left unranked.
`perTurn` asks one question per turn and restores the phase-1 snapshot before each later one (the ADR-0034
restore path, not saved), so N questions are N independent samples. The saved evidence carries `probeMode`,
an `independence` reading and each probe's `restored` flag, and the console prints it (ADR-0040).

A real chat asked a named character's appearance and the reply invented it. The row that introduces her was never
quoted; the character-description channel picked a 700-character action beat in which she is physically present
(four mentions with eleven body and weapon words within +/-60 characters of them) over the introduction paragraph
(three mentions, five words - Chinese names the person *after* describing them, so the cluster sits outside any
window around the name). The channel also reported `detailed: true` for her while the quoted row never said what
she looked like. A baseline over the twelve frozen chats and the real one (43 candidate names, every pick read)
found 23 picks that were not a description of the name.

The attempt to fix it - score the densest 140-character descriptor cluster instead of descriptors near a mention,
extend the lexicon with clothing and face words, anchor the cluster within 200 characters of the name, credit each
descriptor to the nearest candidate name, break ties by distance - was **measured and rejected** (ADR-0044):
*** went 23 -> 24 (three fixed, four regressed), 19 of 43 picks before the distance rules landed on a cluster about
a different character, and two of the three "fixes" were accidental cross-character wins. The lexicon alone keeps
the three regressions correct but leaves the motivating failure in place (the action beat still scores 44 against
21). Nothing shipped, and the code is back to its previous state.

The attempt does leave a usable instrument and a sharper diagnosis:

- A labelled probe set from that chat - ten questions, every needle verified unique, six about appearance or
  clothing - of which **2/10** have their needle inside a quoted window today. The misses split into two defects
  that the set separates: the row is never quoted (ranking), or the row is quoted and the window lands elsewhere
  in it (the window follows the question's own words, which for an appearance question do not occur near the
  description at all - the ADR-0037/ADR-0041 limit).
- Even the rejected scoring rule, which does get the introduction row quoted (`raw_9[437,643]`), leaves the probe
  set at 2/10, so the next rule has to change the *window*, not only the ranking: a span quoted because a channel
  picked it should carry that channel's region.
- Descriptor ownership has to be decided by sentence rather than by nearest mention: crediting the nearest
  candidate name misattributed a pronoun-subject sentence ("he has an old scar") to the innkeeper named in the
  next clause instead of the man named in the previous sentence.

The first of those rules shipped (ADR-0045, N41): a span quoted because a channel picked it now keeps the
region that channel found, a character's introduction row is a candidate of its own, window terms are filtered
by story frequency, and one descriptor run is chosen for density rather than for count in a wide window. The
labelled probe set went from **2/10** needles inside a quoted window to **8/10** (7/10 without the lexicon
extension that the describing sentences actually need), with each mechanism measured behind a switch before
the combination shipped. Read with the repository's own paraphrase-tolerant matcher the same ten probes are
**10/10**: both strict misses are the matcher's two-character floor and the answering fact is inside the quoted
window, so what remains is a missing *route* to the row that phrases it, not a missing fact. The channel's ranking score did not change, so the 43-name pick table from ADR-0044
was re-measured rather than re-litigated: the baseline reproduced exactly (43/43), 3 top picks moved with no
improvement and no regression (both rows of each pair read the same way as before), and the totals stay 23 / 20.
The introduction candidate was measured too - 25 rows, 8 of them read as *not* introducing that name, all eight
the same shape (a name whose first mention is a passing clause inside another character's introduction). A row
that mentions another candidate name earlier than this one is that character's row, and requiring it removes all
eight plus a ninth of the same shape, at the cost of one row that introduces two names at once: 15 candidates
remain, every one of them a describing or introducing row, and the real chat's 薇斯珀 still reaches `raw_9` row
8.

Two more measurements came out of that. The corpus itself (the natural track: 73 chats, 1,258 real-query turns)
first read **worse** than the baseline - the character-described proxy 26.6% -> 25.5% - and a paired per-turn diff
traced it to the *lexicon*, not to the window and not to the new candidate: adding clothing words to the scoring
list changed which chunk the channel picks, and a pick that moves off the describing row takes the row's evidence
slot with it. Splitting the vocabulary (the scoring list unchanged; the wider list only places the window) fixed
it: the same diff is now 0 turns worse and 3 better, and the corpus ends at situation-term 85.5%, asked-thing
65.0%, character-described 27.4% (Chinese chats 81.1%) against 85.0% / 64.6% / 26.6%. Second, the introduction
candidate is a second bidder for the same five slots, so it is now granted only to names the knowledge block
tracks: on the 43-row table that is 14 candidates, every one a row that introduces or describes its name, and 13
of the 14 are inside the fused top five - so it needs no reserved seat. The 8 rows once read as *not* introducing
their name are removed by the passing-reference rule, not by the gate. Read with the repository's own
paraphrase-tolerant matcher the probes are **10/10**: both strict-verbatim misses are the matcher's
two-character floor with the answering fact inside the quoted window (粉色长发 in the quoted introduction row for
`s_hair`; "灰袍、拄藤杖的老头" at the head of row 12's window for `g_robe`, one character after the needle
begins). What is still missing is a *route*, not a fact: `s_hair`'s row 6 - a later re-description of the same
character - never ranks, which is the selection defect Issue #2 keeps apart from the window rule.


A summary body refused for `format` or `over_budget` now earns one repair (ADR-0042): the same request
again, a correction, and the refused text (bounded to 1,600 characters) to cut rather than rewrite. It is
recorded as `body_repair` with its own cost, checked against the input budget before sending, run through the
same frozen-state check, and the second answer is evaluated exactly like the first. The request now also states
the hard ceiling and its consequence, which it had never done. Offline both stages commit (`test-anchor-repair`
4b/4c). Live, forced with a 100-token target and ceiling on a ten-turn batch, the path fired: two calls, the
repaired answer 172 tokens against the ceiling, batch still refused with `recovered: false` and the repair's
cost recorded. A first forcing attempt at a 300-token ceiling needed no repair - the model obeyed the stated
ceiling - which is one run, not a rate. `input_budget` stays an unrepaired local block (ADR-0024).

The detail-survival record now also carries an `attribution` reading, because the forced-repair run showed what
a refused batch does to the numbers: with no committed summary nothing is folded, the whole transcript stays in
the prompt, and every item reads as "conveyed with no channel", which the report counts as fabricated. That run
printed five fabrications that were nothing of the kind. `channelAttribution` marks such a run
(`meaningful: false`) and the driver prints the notice instead of letting the counts be read as conclusions.

The evidence window (ADR-0037) is now moved by the question's **words** first and its n-grams second
(ADR-0041). The n-grams alone had matched fragments that straddle two question words, so on the frozen probe
turn the head window of the tea answer covered two fragments and no question word and nothing moved. With the
word layer first, that row moves from `[0, 199]` to `[290, 489]` and holds `茉莉`, and the scar row moves to
`[103, 334]` and holds `月牙`. The labelled A/B on the same chat is unchanged (4/6, 4 of 30 spans), and the
per-turn probes replay unchanged, so the gain is on mixed questions and the cost is about 0.1 ms per pack.

A rule can be measured and still not run. `packRawEvidence`'s window rule (ADR-0037) was inert in the
shipped prompt from the day it was written: the runtime called the packer without `query`, so the term list was
empty and the rule returned immediately, while the labelled A/B (`recall-baseline.mjs`) and
`test-evidence-window.mjs` both passed the query and reported it working. The runtime passes it now, and
`test-narrative-pipeline.mjs` proves it through `buildNarrativeContext` - a long hidden message whose answer
sits at the end of its first over-share chunk must be quoted with the answer inside, and the test fails if the
option is removed. Replaying that frozen probe turn: `raw_19` moves from `[0, 231]` to `[103, 334]` and now
holds 月牙. `raw_9` was still unchanged at that point, which is why ADR-0041 put the question's **words** above
its n-grams: with that layer it moves to `[290, 489]` and holds 茉莉.

A fixture authored for the missing case closed it: a long **user** turn (the only row a fixture can place
deterministically) whose answer sits at the end of its first over-share chunk, with the question naming the
subject next to it. Run with `probeMode: perTurn`, the probe turn quoted that row as `raw_10[287,484]` with
`trimmed: true`, the window carried `两道被磨平`, and the reply conveyed it - and the offline pre-check on the
authored row had predicted the same `[287,484]`. That is the first live turn that needed a trim, so ADR-0041 is
now measured on the shipped path (`ds-trim1`).

### Live run after the window change (2026-09-14)

A rebuilt fixture (5 of the original 11 declared facts - the rest of that file was lost, which is why ADR-0038
exists) played 20 turns in a new Seraphina chat, both merges committed, the input budget temporarily raised to
120,000 and restored to 40,000 afterwards. The run wrote its own `turns.fixture.json` and named it in the meta
file with its sha256: ADR-0038 working live.

It did **not** reproduce the crossing case: this run's floor-10 summary kept the place name (`place` 1/1 at
the last merge), so the probe never asked for it and ADR-0037's window rule was not exercised against a dropped
fact. What it did measure is where the four asked items went - read from the probe turn's **own** block
(`injections.thisTurn`, the block the turn's generation set) and not the previous turn's. That is the trap this
mode was built around, and an analysis script in this session fell into it: the first reading of these numbers
was taken from the previous build's diagnostics and has been corrected here.

- All five quoted rows were shortened (`trimmed: true`). `raw_19` ranked 2nd and holds `月牙`; `raw_9`
  ranked 5th and holds `茉莉`. In both, the emitted window stopped before the word: the probe turn's block
  carried `缺角` but neither `月牙` nor `茉莉`.
- So the two refusals were **packing** losses - quoted and then cut - not selection losses. The turn's
  outcomes were 5 `included`, 30 `entry_cap`, no `budget` and no `too_long`.
- The tea reply said 艾草茶, another tea that also exists in this run's story.

A second run of the same fixture with `probeMode: 'perTurn'` - one question per turn, the phase-1 state
restored between them, four restores confirmed, `independent: true, samples: 5` - recovered **3 of 3 dropped
details** through the evidence channel and the retained place name through continuity, with the negative control
still refused. Its quoted rows were short and were quoted whole (`trimmed: false`). That run's floor-20 merge
failed `over_budget` and did not commit, so its retention reading covers one merge only; the `committed` flag
added earlier kept that out of the merge count.

One run per mode is not a rate, and the two runs have different generated replies, so the difference is not the
probe composition alone. What it establishes is narrower and worth having: the same three details that were
quoted and cut under one mixed question came back whole under three focused ones.

Each run that plays a turns file now writes `<out>/turns.fixture.json` before its first model call: the
input it actually used, together with the source path, byte count and sha256. Replay it with the ordinary
command and `--turns <out>/turns.fixture.json`. The recorded chat can always be replayed, but only the frozen
fixture can be re-run as the same fixture, and the file a run was given is not committed - the fact-survival
fixture was lost that way, which is why those runs cannot be compared against a later change under the same
input. See ADR-0038.

Run at least 30 completed turns to exercise three automatic summaries. Record summary responses
(requested output cap, finish reason, body length, reasoning usage when returned), covered sources,
folded rows, quoted evidence, query, and actual character replies. Keep original text authoritative.
Check one exact historical detail, a changed ownership, an unresolved commitment, and a character
who was absent when a secret was disclosed. A substring recall score is not a narrative-quality score.

Use a new named test chat and verify character, chat identity and extension activation before running.
Wait for the background worker at measurement points without forcing a summary. Record temporary
test settings and restore them after the run. Do not print API credentials or reasoning text.

Offline tests must cover history edit/delete/swipe, late background results, ordinary generation
during a summary, a partial/empty completion, and unchanged main-generation settings. A generation
read must not start or wait for a summary. Quiet fallback recursion remains suppressed.

## Delivery

Review the scoped diff, run checks, commit on the task branch, then use the finish_task.py command
in AGENTS.md to push and verify the remote SHA. Update the PR with actual verification results.
CI runs syntax and offline tests on pull requests to main. Live-model runs are separate acceptance
evidence and are not implied by a green CI check.

## Retrieval experiments

The ruler accepts --paraphrases (question, needle, kind and optional chat), --scorer, --pack,
--evidence, --entries, --embeddings and --dense-weight. --dump and --against compare matched questions.
Use held-out stories before treating measured weights as general defaults. Never commit private
chat corpora, API keys or full provider logs. See 06_retrieval_research.md for past measurements.

`retrieval-audit.mjs --chat-dir <directory> --out <json>` compares queries on identical historical
prefixes with synthetic folding every ten completed turns. `--keep-directives` restores pure
continuation commands to candidate eligibility for a controlled comparison. It never uses a chat's
final summary to evaluate an earlier turn. The file split is deterministic, not evidence that related
chats are statistically independent.

`retrieval-experiment.mjs` separates preparation, service calls and evaluation:

```text
node retrieval-experiment.mjs prepare <labelled-spec.json> <prepared.json>
node retrieval-experiment.mjs candidates <prepared.json> <candidates.json> <vector-cache.json>
node retrieval-experiment.mjs evaluate <candidates.json> <results.json> <rerank-cache.json>
```

The spec names `chatFile`, `chatId`, `model`, `embeddingModel`, and `cases` with `id`, `question`,
and a pre-annotated answer `needle`. The first phase emits `vectorRequests`; the second emits
`rerankRequests`. A service runner supplies a `responses` map keyed by request id, with `rows`
(vector metadata or rerank index/score pairs), `ms`, or `error`. Inputs are hashed exactly; changed
candidates require new calls. Keep first failures separately when retrying. Throttle by the provider's
token limit, not only by request count. These phases never generate a summary or a story reply.

### Settings and diagnostics clarity (Issue #2 step 5, in progress)

The panel's controls were audited against their readers rather than read: eleven settings and two buttons, and
every one of them is read - `narrative_every`, `narrative_summary_tokens`, `narrative_summary_ceiling_tokens`,
`narrative_evidence_tokens`, `narrative_setting_tokens`, `narrative_anchor_tokens`, `narrative_input_chars`,
`narrative_pending_warn_tokens`, `narrative_summary_failure_warn`, `narrative_rerank_model`, `narrative_fold`,
"总结下一完整批次" and "恢复原文显示". No obsolete control was found, so none was removed, and the mount point is
the settings page the host actually renders (`settings.html` keeps `#aum-v54-settings`, which the panel falls
back to when the memory page id is absent) - the id that once failed was the panel's own, and that trap is pinned
in `test-narrative-panel.mjs`.

Two of the four conditions the plan asks to be shown distinctly were recorded in the read-only report and were
not on the screen. The four now are: the soft target (`summary_over_target`), a hard failure (`summary_block`
with its numbers, or a repeated failure with the last error), parked information (`anchors_parked` and
`knowledge_parked`, now **named** rather than only counted - three per list, each cut to 22 characters, because
the first rendering on the real chat pasted four eighty-character statements into one line), and an unresolvable
statement (`anchors_without_subject`, now stated apart from "no carrier": the first cannot be resolved by
anything, the second was not restated). The ledger line is built by the pure `anchorPanelText`, so what the
panel says can be read offline; rendering it against the real branch chat is what caught the wall of text.

### A correction: the batch observation is one revision behind its own commit

The 20-turn acceptance (a fresh chat, ten turns introducing a character and ten a scene) completed on
2026-09-15: both batches committed, the phase-1 gate passed (20/20 floors, a 602-character summary covering 42
chunks, 40 rows folded), and five questions were asked from a restored phase-1 state. The memory check read
**summary-kept 1 / retrieval-recovered 2 / refused 2 / fabricated 0**, no negative-control leak and no fixture
defect - the two recovered details came back through the evidence channel and the third was truthfully refused.

That same run's `fact-survival` classification reported `must-keep lost in a merge: 2/4 (d-place, d-rule)`,
attributed to the model, and it was reported as a reproducible defect. **It is a measurement artefact.** The
merge call's own request and response contain both facts, and the committed store after the run keeps them in
the summary text, in the anchors and in the knowledge block. The observation is taken from the batch turn's own
status, which is the state one revision *behind* the commit that batch just made, so a fact introduced in that
batch reads as absent. The site carries the limitation in a comment until the observation is re-read after the
commit settles. A wrong fact-survival verdict is worse than no verdict: it argues for a pipeline change the
state does not need, and this one would have added a protection clause to the merge request for a loss that
never happened.

### The window reaches back for a modifier phrase (2026-09-15)

One of the two probes that stayed outside its quote by wording was a window opened on the question's own word
one character after the answer: "一个穿灰袍、拄藤杖的老头" answers "那个老头最显眼的穿着是什么", and the
window started on 老头. A few characters of lead-in fix it - and a first attempt at a blanket lead-in broke
`test-evidence-window`'s live case, cutting 青石渡 out of the tail it sits in. Both shapes are real: the answer
may modify the matched word or follow it. The discriminator is where the matched word sits in the window, so the
reach now applies only when that word is at the window's head, and the dangerous direction keeps its own test.
Measured: strict needle readings 8/10 -> 9/10, and the 1,289-turn corpus paired check is unchanged at 0 turns
worse and 3 better. The remaining probe miss is not a window case at all: a later re-description of a character
never ranks, which is the selection defect Issue #2 keeps apart from the window rule.


### A rejected attempt: a denser second description row does not reach the row that phrases the fact

The last labelled probe miss (`s_hair`: a character's hair, asked about in a later re-description) looked like a
ranking gap a third character-channel candidate would close, since the introduction row is the same row the score
already picks for that character. It was implemented and measured, and it is **rejected**:

- The row that carries the needle ranks **8th**, fused score 0.0154, against a fifth-place 0.0217 - so a
  character-channel nomination (+0.0098) would in fact seat it.
- But the nomination rule ("the densest descriptor cluster other than the scored row and the introduction")
  selected a different row (row 42, a cluster of 11), because the needle's row describes her with few of the
  lexicon's words.
- Nothing available at query time says which row is the one: the question's words (头发, 颜色) do not occur in
  it, and the story says 粉色的发丝.

The candidate changed no probe reading (9/10 before and after), so it was reverted and nothing shipped. What
would reach the row is either nominating every row that mentions the name - k bidders for five slots, whose cost
the corpus instrument can measure - or a channel that maps a question's attribute to the row that answers it.
Both are open, and both need the same two-instrument acceptance this attempt failed.
### A second rejected attempt: nominating every row that mentions the name

The open path above - nominate every hidden row that mentions the character, so the row that phrases a fact is
always among the candidates - was implemented with a bound of six further rows per character and measured. It is
**rejected**: the labelled probes fall from **9/10 to 7/10**, because six more nominations at the character
channel's weight are six more bidders for the same five slots, and the extra weight displaces the rows that were
carrying the answers (two questions answered from the introduction row lose it). Two tests fail for the same
reason and their assertions were not adjusted to fit it.

That is the product contract's own warning in its general form: coverage bought by nominating more is paid for in
the precision of what is quoted. Reaching the row that *answers* a question therefore needs a targeted mechanism -
a question attribute mapped to the row that answers it, or a nomination that does not compete at the same weight
as the rows already chosen - rather than more candidates at the same weight. The change is reverted and nothing
shipped.

### A third attempt, and what it settles: the question's own attribute

Mapping the question's attribute to the rows carrying it - the mechanism the two rejections pointed at - was
implemented: the query's descriptor words (for "瑟拉菲娜的头发是什么颜色？" that is 发) nominate up to two rows
per character that carry the word near the name, with the quote anchored on the word nearest the name. Measured:

- The strict probe count does not move (9/10), and the block's composition changes: rows 28 and 24 leave the
  five slots. So it is a cost with no strict benefit - rejected, reverted, nothing shipped.
- What the run does settle is the *nature* of the remaining miss. The question is already answered at the fact
  level: two quoted rows carry 粉色 (the introduction row and a later row), and the project's own
  paraphrase-tolerant matcher reads the probe set **10/10**. The strict needle (粉色的发丝) sits in a row that
  no query-time signal selects, and selecting it would not add a fact the block lacks.

The reading to keep, then, is not "the row never ranks" but "the strict needle's *wording* lives in a row the
block need not quote, because the fact is quoted already". A future attempt should not be aimed at that row; it
should be aimed at a question whose fact is genuinely absent from the block, and there the instruments already in
place (the ten probes' fact-level reading, the 1,289-turn corpus, and the phase-1 gate) are what measure it.

### A rejected competition rule, and the key inventory that sets the next step (2026-09-15)

The last two measurements of the session belong beside the three rejected selection attempts above, because they
are the same finding read from the other side: on this pipeline a slot spent is a slot taken.

**Rejected: silencing the character channel on a request turn.** The character channel is the one that knows what
a description is, so it was the natural bidder to remove whenever the question already names its subject.
Measured on the 16 questions (the ten labelled probes plus six descriptive references), silencing the channel on
a request turn whose question does **not** name its subject takes the needle-inside-quote count from **12/16 to
9/16**, and the three questions that lose are exactly the three pronoun requests (`r-scar`, `r-cloak`,
`r-armour`), which lose row 8. That is the introduction row the channel was the only route to, because an
unnamed reference has nothing else to match - so the channel is not a competitor to prune; it is the route for the
questions that need it. A broader form, silencing it on every request turn, is worse still at **5/16**: four
named probes (`w_scar`, `w_armour`, `w_cloak`, `m_speech`) also reach row 8 only through it, so the channel
is load-bearing well beyond pronouns. Reverted, nothing shipped; the repository is at its prior state, so the
corpus reading is unchanged by construction.

**Measured: the key inventory the structural index would need.** On the same 16 questions, today's
anchor/knowledge index has a key whose cited rows cover the needle's row for **4/16** - and all four are places
(`p_firepit`, `p_ground`, `r-firepit`, `r-ground`). The person and object half of the net is empty: no
existing key cites row 8 or row 6. A mechanical derivation of the same shape the channel already uses - a tracked
name plus its densest descriptor run, keyed by the descriptor words that run carries - would cover **9/16**, but
the question's own words fire one of those derived keys on only **7/16**. That 7 is a coarse lower bound and not
a coverage number: a key can fire on a row that does not carry the needle, and a key the question never says can
still be the right one (`r-scar` and `r-cloak` are covered by a derived span whose key the question does not
use). Five derived keys would have to be authored for this sample.

Read together, the two readings are the next step's brief. The index is already a real, cheap route for places;
for people and objects it exists as a derivation that has not been keyed, and the channel that finds it today is
the one the competition rule wanted to delete. The work therefore moves from nomination - three attempts, all
rejected because a fifth bidder displaces an answer - to keying the span the channel already finds, so the route
becomes deterministic instead of one more competitor for five slots.

### The key layer needs a precision ruler, not a coverage number (2026-09-15)

The coverage numbers in the previous subsection are the weak metric this section replaces. The first attempt to
measure a key layer asked "is the needle inside a derived span?" and that number is saturable: adding place
subjects and widening the anchored window took the same 16 authored questions (ten labelled probes plus six
descriptive references) from 9/16 to 16/16 while multiplying the spans a question fires from 188 to 634 and
leaving the share that actually carries the needle at about 4%. Widening bought coverage by buying noise.

The ruler that replaces it annotates each question with its subject, attribute and aliases, then scores four
axes instead of one: coverage (the needle is inside some derived span), subject (that span is attributed to the
annotated subject), route (the question names or resolves the subject, or fires the asked attribute), and
**bidders** - every span whose key the question fires, and how many of those contain the needle. "Reachable"
means at least one fired key points at the needle; "precise" is reachable with the hitting span attributed to
the right subject and a legitimate route. Measured verbatim, no model call:

| derived key rule | reachable | right subject | precise | bidders | bidder precision |
| --- | --- | --- | --- | --- | --- |
| person descriptor clusters only (today's derivation) | 8/16 | 6/16 | 5/16 | 188 | 4.3% |
| + attribute vocabulary, aliases, name fragments and one canonical place key | 13/16 | 13/16 | 13/16 | 162 | 8.6% |
| composite keys (`主体.属性`), the subject key pointing at the subject's two densest spans | 14/16 | 14/16 | 14/16 | 112 | 13.4% |
| composite keys with attribute keys kept only while specific (row count <= 6) | 14/16 | 14/16 | **14/16** | **38** | **36.8%** |

Three findings are worth keeping.

- **Binding an attribute to its subject is what stops a fired key from selecting an unrelated row.** A flat key
  fires wherever its word appears; the composite form `主体.属性` fires only for that subject's spans, and the
  subject key points at the subject's two densest spans rather than at every row the name occurs in. That alone
  takes reachability from 13/16 to 14/16 and the fired spans from 162 to 112, because a question about one
  attribute of a character no longer selects every row that happens to carry a common descriptor word.
- **The specificity floor still earns its place on top.** Dropping attribute terms that appear in more than six
  rows cuts the fired spans from 112 to 38 and lifts the share that carry the needle from 13.4% to **36.8%**,
  with no loss of reachability: the subject key's canonical span is what reaches a named subject, so the removed
  terms were noise rather than answers. (This corrects an earlier reading of this section, taken while the
  ruler's subject-key route was silently inert.)
- **The two remaining misses are one defect, not two.** `s_hair` and `m_speech` are a later re-description of
  a character that no span covers. A subject-only question (`p_firepit`) is reached once the subject key points
  at the subject's canonical span, so it is not a separate case.

Nothing shipped: the key layer is a measurement prototype and the pipeline is unchanged. The ruler and its
annotation set are the instrument the next attempt has to pass, and the plan's Step 1 target changes from "key
coverage rises" to "reachability rises with bidder precision as a floor". The instrument reads a private chat
and private needles, so only the method and the numbers are recorded here; it is not committed.

### The last two misses became a fan-out problem, not a vocabulary one (2026-09-15)

ADR-0046 left `s_hair` and `m_speech` unreachable, and they were one defect: the attribute word can sit
hundreds of characters from the subject's name (`瑟拉菲娜` at 22 against `粉色的发丝` at 372; `薇斯珀` at
287 against `像刀子一样直` at 334), so the densest-cluster anchor never reaches it. Anchoring the span on the
attribute word itself, and attributing it to the row's own subject - the archived row's speaker name mapped to
the knowledge subject, plus the subjects named in the row - instead of to a distance threshold does reach both.

What blocks it is the fan-out, and one reading of it was again an artefact:

- With no frequency cap the attribute-anchored spans reach 15/16 but fire **2801 spans**. A frequency cap applied
  over the enlarged set then counted occurrences across every new span and stripped the new spans' terms to
  empty, so one variant read as 34 spans at **70.6%** precision while its index was effectively empty.
- The fan-out concentrates in common attribute words: the single composite key `薇斯珀.口` has **100 candidate
  spans across 17 rows** - `开口`, `门口` and every other 口 in the story, all attributed to her because the
  row is hers.
- Because the cap zeroes those spans' terms, the rule that keeps the best three spans per key is ordering by a
  number that is now uniformly zero. Its 16/16 is a tie-break that happens to include a covering span, not a
  mechanism; the best principled point on the curve is **15/16 at 54 fired spans and 53.7% precision**.

The remaining work is therefore precise: an attribute vocabulary that separates a person's attribute from the
same character inside a common word, and a key-to-span ranking by proximity or descriptor density rather than by
a term count the frequency cap has already removed. Later exploration scripts drifted in their flat baseline, so
only ADR-0046's numbers and the v7 reproduction inside them are comparable to the table above.

### Ranking cannot close the last miss; attribution needed a control of its own (2026-09-15)

Two parallel measurements extended the fan-out finding.

**A defensible ordering helps, but it cannot reach `m_speech`.** Ordering each composite key's candidate spans by
a signal other than the frequency-capped term count - distance from the subject's nearest mention in the row, or
the descriptor count computed before the cap, or both - buys `s_hair` and precision, but every defensible
ranking stops at 15/16. The best point is the combination at one span per key: 15/16 reachable at **43 fired spans
and 58.1%** carrying the needle, against ADR-0046's 14/16 at 38 and 36.8%. Only the degenerate ordering - the one
sorting by the term count the cap has zeroed - reads 16/16, which is the tie-break already recorded. `m_speech`
is therefore a vocabulary problem, not a ranking one: the manner phrase ("她话不多，开口往往像刀子一样直")
contains 口, 100 candidate spans in this story carry that character, and the span covering the needle ranks 17th by
distance behind 98 incidental ones. The key has to recognise a manner phrase, not a character.

**Attribution was measured against a control, and the speaker field is weak.** For the 16 needles' rows, the
archived row's speaker maps to the annotated subject in only **2/16** (the two rows where the subject is the
narrator) and misattributes 14/16; the subject's name occurs in the row in 14/16, its name or an alias in
**16/16**, and a two-character fragment in 16/16. The named set is never a singleton (**0/16**) - largely because
the second-person 你 appears in almost every row - and becomes a singleton in 10/16 once 你 is excluded. The rule
the key layer should use is therefore: name, alias and fragment for recall; the persona excluded from the subject
set; proximity or descriptor density only as the discriminator that picks one span among the named subjects; the
speaker field at most as a tie-break.

**A reproducibility caveat.** Two scripts implementing the nominal "keep two spans per key" rule disagree - 15/16
at 54 spans and 53.7% against 13/16 at 43 and 48.8% - while the ADR-0046 reference reproduces exactly in both
(14/16 at 38 and 36.8%). Until that reference is re-established, only the reproducing row is comparable.

### Phrase keys close the manner miss, and the reference was rebuilt (2026-09-15)

**A phrase key, not a character key, closes `m_speech`.** A small auditable table of manner and expression
phrases (语气, 神态, 说话风格) replaces the character key: the question's word is aliased to the manner sense and
the span is anchored on the phrase. Ranking candidate phrases by their length rather than by how many phrases a
span carries is decisive - the phrase that answers the question ranks first by length and fourth to sixth by
density, so a density ranking would have produced a false "the phrase table does not work". With the specific
table and one kept span per key, the rule reaches **15/16 at 40 fired spans and 37.5%**, against the v7 anchor's
14/16 at 38 and 36.8%: the manner miss is closed for two extra spans and no precision cost. The character-level
key it replaces had 100 candidate spans; the phrase key has 22. `s_hair` is not closed this way and is not the
same defect - the question says 头发 while the needle's row says 发丝 and another row carries the question's own
words, so the covering span ranks fifth of seven. That is a cross-row selection defect, not a vocabulary one.

**The reference disagreement had a single cause.** The two scripts reading 15/16 and 13/16 for the nominally
identical rule differ only in the *subject* canonical tie-break, and that tie-break is decisive because the
frequency cap zeroes the primary sort key: almost every attribute term exceeds the cap, so the term count the
canonical sorts by is uniformly zero. The scripts then disagreed about which of a subject's spans is canonical,
and the losing choice keeps head-anchored attribute windows where the descriptor cluster - the one that covers
the needle - used to be. Neither number was the rule's reading. The rebuilt reference draws the subject canonical
only from non-attribute spans and ranks it by the pre-cap term count, and ranks the attribute canonical by pre-cap
terms then proximity; under that rule both variants agree, and the attribute spans close `s_hair` at 15/16 with
65 fired spans and 47.7%.

**The two fixes were measured separately, never together.** Phrase keys close the manner miss and attribute
spans close the hair miss, but no run combined them, so 16/16 remains unproven - and the earlier 16/16 readings
stay artefacts of the degenerate ordering until the combination is measured on the rebuilt reference.

### The two fixes together close both misses (2026-09-15)

Combined on the rebuilt reference, attribute-anchored spans and phrase keys close both historical misses, and the
controls reproduce each separate row exactly (v7 14/16 at 38 and 36.8%; the attribute rule 15/16 at 65 and 47.7%;
the phrase rule 15/16 at 40 and 37.5%). The best point keeps one span per key: **16/16 reachable, right-subject
and precise at 67 fired spans and 47.8%** with the reference's own attribution, or 74 spans at 48.6% if the
persona-excluding attribution rule is added. Both misses are decided by a mechanism rather than a tie:

- `s_hair`, key `瑟拉菲娜|发丝`: two candidates, and the covering span is rank 1 by distance (351 against
  infinity for the other row).
- `m_speech`, key `薇斯珀|语气`: 22 candidates, the covering spans are ranks 1, 2 and 3 by phrase length, and
  rank 1 is chosen with no tie.

Re-running the combined rule with no frequency cap still reads 16/16, so the result does not depend on the cap;
swapping the phrase ranking from length to density drops it to 15/16, so the ranking signal is load-bearing. One
integration defect was fixed on the way: merging alias tables with an object spread let a label table overwrite
the base table's alias list, which cost one probe until the lists were unioned instead.

This is still a measurement prototype. Nothing is shipped, the pipeline is untouched, the runs make no model
calls, and the instrument reads a private chat and private needles, so only the method and the numbers are
recorded.

### The 16/16 does not survive an audit (2026-09-15)

The combined rule reads 16/16 on the annotated probes. Auditing that reading changes what it means, in three ways.

**False positives are real and concentrated.** Of the 74 spans the sixteen questions fire, only 36 carry the needle -
**51.4% do not** - and 6 (8.1%) are attributed to the wrong subject, five of them on the one question whose row
names three subjects: the rule builds an attribute window for every named subject, so a quotation of one
character's description becomes another character's span. Every needle, however, does sit in a span that genuinely
answers its question; no hit is a coincidental substring.

**The reading is conditional on an oracle.** The question expansion appends the annotated subject to the query for
questions that do not name it. With that step removed the same rule reads **8/16**, because the step also gates the
subject-key route for questions that *do* name their subject. The shipped planner resolves pronouns and
descriptions with limited accuracy, so 8/16, not 16/16, is the honest in-domain number until the route and the
resolution are separated.

**Nothing transfers.** On a second, unrelated chat with the rule unchanged, the same rule reads **2/10**. Seven of
the eight misses need an attribute word the frozen vocabulary does not contain (six distinct words), and the two
successes are exactly the probes whose attribute word the original sixteen already required. One miss had its word
in the vocabulary and still failed because the question refers to the thing descriptively and never names the
attribute - a reference problem, not a vocabulary one. Vocabulary ablation says the same from the other side: of
the whole alias table only one entry changes any probe's reading, and no phrase-table entry does, so what the ruler
mostly measures is "the question's own words plus the annotated subject".

The honest statement is narrower than the milestone above: the derived spans do contain a genuine answer to each of
the sixteen questions, and the composite-key form beats the flat baseline, but 16/16 is not evidence that the key
layer retrieves them unaided.

### The audit's 8/16 was itself a conflation, and the shipped path wins out of domain (2026-09-15)

Two controls complete the audit.

**The 8/16 reading was wrong in the same way the earlier 16/16 was.** The flag the audit removed did two unrelated
jobs: it gated the subject-key route, and it appended the annotated subject. Split into two switches, the four
combinations read: neither, 8/16; the subject route alone, **13/16**; the annotated subject alone, 10/16; both,
16/16. So the legitimate mechanism carries thirteen of the sixteen on its own, and only the three pronoun questions
need a resolver. The shipped planner supplies one - run with its `profileNames` instead of the annotated subject
and the rule still reads **16/16**, at 119 fired spans and 37.0% precision against 74 and 48.6% with the oracle.
The planner appends every scene name rather than disambiguating, so the heavier cost is the honest price of a
realistic resolver, not a loss of reachability. The descriptive references the planner does not cover (`老头`,
`水汊`) are still carried by the hand-authored alias table.

**Out of domain, what ships wins.** On the second chat's ten held-out probes the shipped path reaches **6/10**
when the chat's own summary is respected (4/10 with every row quotable) and quotes the needle's row in 8/10
(6/10), while the key layer reaches **2/10**. That chat's subjects are read correctly from its own knowledge
block, but the attribute vocabulary is the first story's: seven of the eight misses need a word the table does not
contain, six distinct ones. The prototype is therefore not better than the retriever that already ships on data it
was not tuned for.

**What stays open is vocabulary acquisition, not the key form.** In domain the composite-key mechanism carries
13/16 unaided and 16/16 with a shipped resolver; out of domain it collapses only because its attribute keys were
authored per story. The next question is whether that vocabulary can be derived from the summary's own relation
net instead of written by hand - if it cannot, the key layer costs an author several entries per chapter and buys
nothing over the retriever already in place.

### Automatic derivation recovers the held-out reading, and for a specific reason (2026-09-15)

The held-out chat's attribute vocabulary was derived mechanically instead of authored: 2-4 character CJK fragments
that recur near a knowledge subject, plus any the chat's own knowledge and anchor text carries, kept maximal and
requiring at least two rows. That yields 822 candidate terms and recovers eight of the nine words the ten held-out
questions need - all but the single-character `岔`, which the length rule excludes. On the same ten probes and the
frozen rule, reachable goes from **2/10 to 6/10** at 150 terms and **7/10** at all 822, against the shipped
retriever's 6/10.

Adding the same missing words by hand does **not** move the reading: with `烟锅/船/麻丝/灯/岔/脚印` added it stays
at 2/10. The two readings disagree only because the vocabularies differ in **specificity**, and they agree on the
frozen control (both read 2/10), which is what makes the comparison meaningful. The derived list contains the
multi-character phrases the questions actually use (`铜烟锅`, `渡船`, `船底`), and a key built on a rare phrase
has few candidate spans, so the single span the rule keeps per key is the one that carries the needle; a key built
on the generic noun (`烟锅`, `船`, `灯`) has many candidates and keeps the wrong one.

So automatic derivation is a real route to the vocabulary, and it also exposes the structural defect underneath:
**a composite key points at exactly one span, and the ordering that picks it does not know which occurrence the
question needs.** Keeping twenty spans per key recovers the held-out reading to 8/10, but fires 212 spans at 11.8%
precision where the shipped retriever quotes fifty. The next question is whether a key can point at a *set* of
occurrences ranked with the question's own evidence, rather than at one span chosen before the question is known.
Two caveats: the derivation rule was written by someone who had seen the probes, and the two implementations
differ slightly in bidder counts (27 against 33 on the frozen control) even though their reachability agrees.

### Retrieval-time selection does not help, and the derived vocabulary does not generalize (2026-09-15)

Two decisive negatives close this line of work for now.

**Choosing the occurrence after the question is known does not beat choosing it before.** Indexing every attribute
candidate and ranking them at retrieval time with the question's own evidence fails the bar that was set for it -
held-out reachability at least 6/10 with bidder precision at least 29% at a small cut. The best retrieval-time
point keeps two spans per key: **9/10 reachable at 16.3% bidder precision**, against the index-time rule's **7/10
at 32.5%**. At a cut of one it is worse than index time - the same 7/10 at **11.3%** - so the extra reachability
comes from keeping more candidates, not from a better ordering. In domain the same change is strictly worse: index
time already reaches 16/16 at 41.8%, while retrieval time needs three spans per key for the same 16/16 at 23.3%.
The residual miss is not a selection problem either: for the boat question the three keys the question fires each
have one candidate span and none covers the needle, while the covering spans are generated by terms the question
never names. That needs object-level coverage, not a ranking.

**The derived vocabulary does not generalize; the earlier recovery was contaminated.** The derivation was re-run
unchanged on a third chat, with ten probes authored before any derivation ran for that chat. It recovered **3 of
10** needed words and reached **3/10**, against 8 of 9 and 6-7/10 on the chat whose probes the rule's author had
already seen. Six of the seven misses are words that occur in exactly one row, which the rule's two-row minimum
filters out before they can become keys; a seventh occurs twice but outside the near-subject window and is absent
from the knowledge text. Even the recovered words often do not route, because the single span kept per key is on a
different row than the needle.

Read with the rest of this section: the composite-key form is a real in-domain mechanism, but on clean
out-of-domain data it is not better than the retriever already shipping, and neither a wider vocabulary rule nor a
retrieval-time ranking closes the gap.

### A quoted window no longer trades its channel anchor for the question's words (2026-09-15)

The window rule scores candidate windows by how many of the question's own words they carry, and that is a proxy
for where the answer is. A move that leaves no channel region inside the window is quoting a different part of the
row than the one the slot was spent on. Measured with an instrument that reproduces the shipped control exactly:
on a held-out chat the lantern row was quoted from offset 128 while its needle sat at 41, because the question's
words pulled the window forward and off the anchor at the head.

The rule now refuses a move that would take the last channel region out of the window while the incumbent window
still holds one. Measured: the labelled ten-probe gate is unchanged at **9/10**; the 1,289-turn corpus paired
check is **0 turns worse and 4 better** (character-description readings 101 -> 105, situation terms 3,990 ->
4,023); and the held-out chat's runtime-faithful reading rises from 6/10 to 7/10. The archive-wide variant of the
same held-out control loses one probe (`h_hair`) - with every row quotable the guard refuses a move that would
have reached that needle - and that is recorded because it is the honest cost, not because the runtime path uses
that variant.

### A real detail check, and one rejected window candidate (2026-09-15)

A user played a 23-row chat and then a branch of it, asking six detail questions one per turn. Every answer is in
the original text and none of them is in the summary, the anchors or the knowledge block: a character's eye
colour, her coat and cuff, her blade's handle, the pines on the walk to the mill, the mill's broken stairs, and
the light under the guardian's palm. **All six failed to come back.** The replies did not invent them - the model
reported that those details had not been written and asked the user to decide - so this is a retrieval recall
failure with no fabrication. The recorded block for the last of the six quoted five rows, and the row holding its
answer was not among them. On the others the replies show the boundary inside the sentence that carries the
detail: the coat was quoted and the cuff, a few characters later in the same sentence, was not; the sheath was
quoted and the handle in the same sentence was not.

That second shape produced the rejected candidate: when a truncated window ends in the middle of a sentence, end
it where the sentence ends instead. Measured on the current corpus directory (**1,296 turns**, the two new chats
included): the labelled gate is unchanged at 9/10, but the paired check is **1 turn worse with 85 situation-term
recalls lost** (4,006 -> 3,921), and two offline window tests fail - `test-evidence-window` and
`test-profile-window`, whose fixtures assert exact starts. Rejected and reverted, and the assertions were not
adjusted to fit the change. The first shape - a row that never ranks - is the five-slot competition again.

### A covered greeting is hidden with its first batch (2026-09-15)

The live transcript of a committed ten-turn batch showed two visible mismatches at once. Rows 1-20 were folded,
but the character's greeting (row 0) stayed fully visible inside the hidden block; and the host's single "context
starts here" line - SillyTavern/TauriTavern's `.lastInContext`, `border-top: 3px dotted` placed at
`chat.length - openai_messages_count` - sat on row 20, the last *hidden* row, instead of row 21. One line cannot
represent a hidden set that is not a contiguous prefix, so the faded block appeared to be in context and the
visible greeting above the line appeared hidden. Folding is also what makes a covered row quotable (N7), so the
greeting was the one summarized row retrieval was forbidden to quote.

`applyNarrativeFolds` named only complete user turns, so `completeTurnRanges` never mentioned the greeting even
though the summary's coverage is a prefix that starts there. The greeting now falls under the same
every-chunk-covered rule, gated on at least one complete turn being covered so a claim that names nothing but the
greeting hides nothing (ADR-0047, which supersedes the greeting clause of ADR-0023). Measured: `node run-tests.mjs`
50/50 and `node check-syntax.mjs` 99 files; the natural track already excluded the greeting from its simulated
`visible` set, so the 1,296-turn corpus paired check is unchanged by construction - the runtime now agrees with
the instrument rather than the instrument moving.

The same live run left the second batch uncommitted: `pending_floors` 10 and `summary_failures` 2, both refusals
at the `over_budget` stage (a body past the ceiling, and its one body repair also over). That is why floors 21-40
stayed visible in that transcript - nothing hides a row until an accepted summary covers it. It is a
summary-commit reliability problem, separate from the fold projection, and it stays open.

The first live run after the deploy still folded 40 rows, because the host page had not been reloaded and was
executing the previous `raw-history.js`. `runtime-precheck.mjs` reported PASS anyway: its WATCH list named the
anchor and commit-path functions but not `applyNarrativeFolds`, so the one function this change altered was
invisible to the gate. The fold functions are now watched. The precheck rightly reported the stale loaded module
before the reload, and after the reload the same chat reads `folded 41` (rows 0-40, greeting included, probe rows
41-42 visible) - the boundary the host will draw on the next generation sits at row 41, below floor 40. A gate is
only as wide as the functions it watches.

A gate is only as wide as the functions it watches.

### Five sequential live acceptance runs (2026-09-15)

Five fresh chats, twenty turns each, `acceptance-longchat.mjs --detail-survival` in `perTurn` mode, against the
deployed plugin. Runs 1-2 executed the fold rule before ADR-0047 (the host had not been reloaded); runs 3-5
executed it. Every run's phase-1 gate passed with 20/20 complete floors.

| run | chat | folded @10 / @20 | batches | declared -> retained | probe outcomes (as printed) |
| --- | --- | --- | --- | --- | --- |
| 1 | 阿箬 / 落雁驿 | 20 / 20 | 1 of 2 | 9 -> 7 | kept 1, retrieved-not-conveyed 1, fabricated 1 |
| 2 | 石原 / 断桥渡 | 20 / 40 | 2 of 2 | 6 -> 4 | kept 1, retrieval-recovered 1, retrieved-not-conveyed 1 |
| 3 | 柳娘 / 望江楼 | **21 / 41** | 2 of 2 | 5 -> 5 | kept 1 (not conveyed) |
| 4 | 白先生 / 药王谷 | **21 / 41** | 2 of 2 | 9 -> 8 | kept 1, retrieval-recovered 1 |
| 5 | 铁蛋 / 黑风寨 | **21 / 41** | 2 of 2 | 9 -> 7 | kept 1, refused 2 |

- **The fold change is confirmed live.** Runs 3-5 fold 21 rows at the first commit and 41 at the second, and the
  host's boundary line lands on row 41 in each - below floor 40, not on floor 40.
- **The batch refusal did not recur.** Eight of nine batch attempts committed; the only refusal is run 1's second
  batch (`over_budget`, twice including the one body repair). Four later batches needed that repair and committed
  from it (runs 2, 3, 5 second batch; run 4 first batch), so the repair path works and the run-1 refusal was the
  model answering over the ceiling, not a systematic blocker.
- **The summary seldom drops a declared incidental detail.** 38 declared, 31 retained. Phase 2 therefore usually
  probes only the positive control, so these runs carry little evidence about the retrieval channel.
- **The probe label assumed the source is not in the prompt, and that assumption was wrong.** Run 1's second
  batch was refused, so rows 21-40 were still in the prompt. The model answered `落雁驿` (`d-place`) and `阿箬`
  (`d-name`) from the transcript, and the report counted the first as `fabricated` with `channel=none` and the
  second as `summary-kept`. Neither was a memory outcome.
- **A transliteration is not a loss.** Run 4's only "dropped" needle is `白先生` against a summary *response* that
  wrote `Bai`; the story itself carries the name in an assistant row on floor 28, which is what the probe then
  recovered.
- **Refusal was truthful, not fabricated.** Run 5 dropped `d-teeth` and `d-shoe`, retrieval returned
  `channel=none` for both, and the model answered "不记得" twice.

Read against the phase-1 rows instead of the whole chat, the same five recorded runs give **4 summary-kept,
2 retrieval-recovered, 2 retrieved-not-conveyed, 2 refused, 0 fabricated, 2 visible-in-prompt**: both new readings
land on run 1, and run 4's `d-name` survives as a real recovery. The instrument to trust for retrieval remains the
labelled probe set and the corpus, not this phase-2 probe on a chat whose summary drops almost nothing.

### A detail-survival probe reads the transcript before it reads the memory (2026-09-15)

The five runs above exposed a missing reading rather than a model result. A probe can only be evidence about
memory while the answer is not already in the prompt, and the grader had no way to know either way. `needleSources`
now answers both questions against the phase-1 snapshot the probe is asked against: is a declared needle still in
an **unfolded** row, and does any **model-written** row carry it at all. `summarizeDetailSurvival` turns those into
two readings instead of counting them as memory:

- `visible-in-prompt` - the needle's own row is still visible, so the reply can copy the transcript (run 1's
  `d-place` and `d-name`).
- `instruction-only` - the evidence matched, but no model-written row carries the needle, so the quote came from a
  user row. It did not fire in these five runs; run 4's `d-name` has an assistant row as well, so that recovery
  stands.

The helper reports `known`, and the summarizer only applies the two readings when a transcript was actually handed
in. That guard is not decoration: the first wiring read a missing chat as "the model never wrote it" and relabelled
run 2's real `d-tool` recovery as instruction-only. Measured: `node run-tests.mjs` 50/50 and
`node check-syntax.mjs` 99 files; test-detail-survival section 16 pins all three readings, including the
no-transcript case. Re-read offline against the five runs' phase-1 rows, run 1's single `fabricated` and both of
its `summary-kept` false readings become `visible-in-prompt`, and nothing else moves.

Confirmed live the same day. A sixth run (`石原`, the same frozen fixture as run 2, sha256 `63fafbc2`) played on
the fixed code: folded 21 then 41, both batches committed, and the record's `sources` block carries `known: true`
with the full hit list for every declared item. Neither new reading fired - every phase-1 row was folded - and the
run kept a genuine `fabricated`: the dropped `d-arm` was answered with "手臂上" plus an invented scar history
("十五年前那场湖心解体、船主溺亡"), on `channel=none`.

That reply also exposed the last invisible step. The tolerant reading accepted the run "臂上" for the needle
"小臂上", so `conveys=true` rested on two characters of a phrase the reply had made *less* specific ("手臂上" is
the arm, not the forearm). The token was already computed and thrown away. `summarizeDetailSurvival` now carries
`token` and `how` on every outcome and the driver prints them (`token=臂上(run2)`), so a reader sees which run
carried the verdict instead of trusting the boolean. The matcher is unchanged: ADR-0035's two-character floor is
what recovers "缺角" for "缺了一角", and tightening it is a measured change, not a drive-by.

