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

#### The two-character floor is load-bearing, and "content-complete" is rejected (2026-09-15)

The token exposure made the next question measurable: should the tolerant reading be tightened so a run cannot
drop a *content* character? The census is every needle match the six recorded runs made - 42 field checks over
continuity, evidence and reply.

| tier | matches |
| --- | --- |
| verbatim | 17 |
| run3 | 1 |
| run2 (the floor) | 6 |
| none | 18 |

The floor carries 6 of the 24 matches, so it is not decoration. Every one of the six shortens the needle
(`coverage < 1`); none is a pure stop-character contraction:

| run | item | field | needle | matched | read |
| --- | --- | --- | --- | --- | --- |
| 1 | d-manner | evidence | 跺一下脚上的雪 | 下脚 | false positive: a generic middle run |
| 2 | d-tool | evidence, reply | 黄铜卷尺 | 卷尺 | true: the story's only tape measure |
| 2b | d-arm | reply | 小臂上 | 臂上 | false: the reply said 手臂上, the arm |
| 4 | d-basket | continuity, reply | 藤编的背篓 | 背篓 / 藤编 | true: the story's only basket |

The candidate rule - only stop characters may be dropped, so a run must keep every content character - removes all
seven shortened matches, including two true positives (`d-tool` evidence and reply, `d-basket` continuity and
reply). `d-tool` is run 2's only `retrieval-recovered` verdict, so the rule would have moved a real reading.
Rejected: the floor cannot be tightened geometrically without losing a documented true reading. The difference
between "卷尺" and "臂上" is how generic the fragment is, which is a frequency question (the ADR-0046 specificity
test), not a length question.

What ships is the reading, not a new verdict rule: every outcome carries `token`, `how` and `coverage`,
`partialMatches` counts the shortened runs, and the driver prints `token=臂上(run2, 67%)`. A reader sees what the
verdict rests on, and a later rule has a measured population to be judged against.

#### No text-local signal separates a shortened match from a wrong one (2026-09-15)

The candidate that follows from the ADR-0046 specificity test is a frequency filter: a shortened run should not
carry a verdict when its token is common in the story. Measured over the same seven shortened matches, the idea is
refuted, and in the direction opposite to the intuition.

| run | item | field | needle | token | token rows | needle rows | token outside the needle's rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | d-manner | evidence | 跺一下脚上的雪 | 下脚 | 2 | 2 | 0 |
| 2 | d-tool | evidence, reply | 黄铜卷尺 | 卷尺 | 9 | 9 | 0 |
| 2 | d-manner | evidence | 用指节敲两下 | 敲两下 | 8 | 14 | 0 |
| 2b | d-arm | reply | 小臂上 | 臂上 | 2 | 2 | 0 |
| 4 | d-basket | continuity, reply | 藤编的背篓 | 背篓 / 藤编 | 1 | 1 | 0 |

`卷尺` appears in 9 of the 41 phase-1 rows and is the **true** one; `臂上` appears in 2 and is the **false** one. No
token ever appears in a row that does not also carry the full needle, so "the token leaked outside its phrase" -
the reading that would justify a frequency floor - never happens in this population. A threshold at df <= 2 drops
`卷尺`, `敲两下` and `臂上` together: it removes true positives and keeps the one false positive.

Three more text-local signals were tried and rejected the same way.

- **Run length.** Requiring three characters drops `卷尺` and `背篓`, both true.
- **Position.** Requiring the run to be a prefix or a suffix drops run 1's `下脚` and nothing else - the one
  candidate that looked clean - but for the wrong reason. `下脚` sits in the right row and the quoted window was
  trimmed; the rule would drop a needle whose answer is an attribute in the middle of a longer description, which
  is the shape ADR-0045 works on.
- **Adjacency.** Requiring the text's neighbouring content character to agree with the needle's rejects all seven,
  because a correct terse reply has no neighbour at all: run 2's `d-tool` answered "1. 卷尺。", run 4's
  `d-basket` answered "1. 藤编的。白先生背的是藤篓…", and both are true.

The surviving difference is the **referent**, not the text. `卷尺` is a true match because the story has one tape
measure; `臂上` is a false one because the story has two arms. That is world knowledge and this instrument has
none. The reading shipped above is therefore the whole remedy: it makes a shortened match visible and auditable
instead of pretending to adjudicate it.

#### The descriptive-needle window does not generalize to fresh chats (2026-09-15)

ADR-0045's ruler is six descriptive questions on one chat - a question that names its subject by description, e.g.
"那个会用活印的老头最显眼的穿着是什么", scored by whether the needle lands inside a quoted window. It reported
8/10 strict and 10/10 paraphrase-tolerant on that chat. The six chats from the acceptance runs above are a
held-out domain for exactly that shape: the subject phrase is taken from each fixture's opening row, the needle is
the fixture's own declared detail, and the reading is the shipped ranker and packer with the runtime's visible set.

| run | needle | its row(s) | quoted rows | reading |
| --- | --- | --- | --- | --- |
| 1 | 跺一下脚上的雪 | [8] | [1,2,10,6,12] | miss - the needle's row is not quoted |
| 2 | 用指节敲两下 | [4,8,…,38] | [1,2,4,16,20] | tolerant - row 4 is quoted, the window missed the needle |
| 2b | 小臂上 | [4] | [1,12,40,36,30] | miss - the needle's row is not quoted |
| 3 | 青瓷灯座 | [6,8,…,40] | [1,2,6,32,28] | **strict** |
| 4 | 缺了一角的笠沿 | - | [1,24,18,38,26] | fixture defect: the model wrote the phrase reordered and nothing matches |
| 5 | 门牙缺了一颗 | [4,6,…,40] | [1,32,8,12,10] | miss - row 12 is quoted, the window missed it |

Held out: **strict 1/6, paraphrase-tolerant 2/6**, against 8/10 and 10/10 in domain. Of the five valid probes one
hit, two are window/trim misses (the right row was quoted and the needle fell outside the quote) and two are
selection misses (the right row was not quoted at all).

One mechanism is visible in every row of the table: rows 1 and 2 are quoted in all six. Row 1 is the fixture's own
opening instruction ("让一个新人物登场——石原，替人修船的男人"), and a descriptive question *reuses that phrase*,
so the question's own source matches it lexically and takes a slot without holding the answer. That is partly an
artifact of the acceptance fixtures - a real user rarely writes such an instruction - but a user who does give an
out-of-character instruction gets the same competition, and run 1's `d-place` was answered from that row earlier
the same day. It is recorded as a lead, not as a finding: the next measurement is selection, not the window rule.

#### The quoted slots, measured on the runs' own injection blocks (2026-09-15)

The blocks the fourteen probe turns actually saw - the runtime's dense, rerank and window path, not an offline
replay - hold 70 quoted sections. Seven of them (10%) are user rows, and all seven are the same row: floor 1, the
opening instruction. Their appearance is conditioned on the question.

| probe kind | probes | quoted the instruction row |
| --- | --- | --- |
| identity (`d-name`) | 6 | **6** |
| every other detail | 8 | **1** |

The identity probe is the one that reads its answer out of the user's own turn: the instruction
("让一个新人物登场——石原，替人修船的男人") states the name, the archived row is quotable, and every identity
probe spends one of its five slots there. That does not by itself make the probe unreadable - assistant rows carry
the name too, which is why `instruction-only` never fired - but the probe cannot separate memory from the
instruction it was asked with. The one non-identity case is run 5's `d-shoe`, where the instruction row took a
slot while none of the rows carrying 门牙缺了一颗 was quoted: a real, if small, wasted slot (1 of 8).

This corrects the offline held-out table above, which quoted row 1 in all six chats. That replay ran the ranker
and packer without the dense channel, and the name boost then ranked the instruction row first; on the runtime
path it does not. The offline numbers stand for the *window* question they were taken for, and were too strong
for the slot question.

No packer change follows. Ten percent of slots on driver-authored instructions is mostly an artifact of these
fixtures - a real user row is in-character evidence and belongs in the pool - and a single non-identity case is not
a population. What follows is a fixture rule, now in the schema: an identity needle is the name the instruction
declares, so keep the name out of the instruction or read that probe as a channel control only.

#### The trim misses are whole-sentence-scale, and sentence-end cannot reach them (2026-09-15)

The held-out run above left two window/trim misses, and the recorded blocks measure them exactly: every quoted
section carries its `[raw_N:start-end)` offsets and the row text carries the needle's own offset.

| run | probe | needle | its offset | quoted span | gap |
| --- | --- | --- | --- | --- | --- |
| 1 | d-name | 阿箬 | 70 | [222,422) | the window starts 152 after the needle |
| 2 | d-manner | 用指节敲两下 | 69 | [276,464) | 207 before the window |
| 2 | d-manner | 用指节敲两下 | 314 | [0,204) | 110 past the end |
| 2 | d-name | 石原 | 169 | [276,464) | 107 before the window |
| 2b | d-name | 石原 | 12 | [168,379) | 156 before the window |
| 3 | d-name | 柳娘 | 0 | [133,368) | 133 before the window |
| 3 | d-name | 柳娘 | 0 | [133,368) | 133 before the window |
| 5 | d-teeth | 门牙缺了一颗 | 264 | [0,201) | 63 past the end |
| 5 | d-teeth | 门牙缺了一颗 | 326 | [0,210) | 116 past the end |
| 5 | d-name | 铁蛋 | 317 | [0,210) | 107 past the end |

Ten needle occurrences fall outside the span quoted for the row that carries them, by 63 to 207 characters. On the
candidate rejected on 2026-09-13 - when a trimmed window ends mid-sentence, end it where the sentence ends - a
full sentence-end extension reaches **zero** of the ten: each sits either beyond the next terminator or a whole
sentence before the window's own sentence. That corpus rejection was therefore not a close call, and the held-out
geometry says why: the shape is not a cut one punctuation short, it is a window placed at one end of a long row
while the answer sits 63-207 characters away at the other.

Eight of the ten are the identity probe, whose needle is the character's name: the name sits at offset 0 or 12 of
a row while the window starts 133-276 deep into it. Those probes read `summary-kept` from the continuity channel
anyway, so the verdict does not move - the evidence slot does.

#### The capture could not say why the window was placed there (2026-09-15)

`fitEvidenceSpan` places a trimmed window on the question's own words and on the regions the ranking channels
voted for (`seats`), and refuses a move that leaves every region outside. A quoted source recorded only
`trimmed` and `anchored`, so a miss could not be attributed: "no channel region existed in that row" and "a
region pointed at the head" look identical in the record. Every quoted source now also carries
`spanStart`/`spanEnd` (the candidate's own extent) and `seats` (up to eight region starts with their channels),
and `test-narrative-pipeline` pins them on a case where the window has to move. The next placement change is
measurable from a run's own record instead of a guess.

#### The placement record answers the question (2026-09-15)

Run 2c (the same frozen 石原 fixture) is the first run whose quoted sources carry `spanStart`/`spanEnd` and
`seats`. Its probe turn quoted five rows, and the record separates the two cases the geometry could not.

| source | candidate | quote | trimmed | anchored | seats |
| --- | --- | --- | --- | --- | --- |
| raw_5 | [0,526) | [0,214) | yes | true | profile @14 |
| raw_2 | [0,42) | [0,42) | no | true | entity @16 |
| raw_19 | [0,461) | [0,235) | yes | true | profile @95 |
| raw_3 | [0,421) | [33,247) | yes | true | entity @81 |
| raw_33 | [0,443) | [0,226) | yes | false | **none** |

Four of the five had a region to sit on and the window covers it. The fifth had none: `seats` is empty and
`anchored` is false, so the head window is a fallback with no signal in it. That is the miss shape the held-out
geometry showed - a window at one end of a long row while the answer sits 63-207 characters away - and it is now
attributable: it happens when no channel produced a region, not when a region pointed at the head.

Run 2c's other numbers: both batches committed, folded 21 then 41, the phase-1 gate passed with 20/20 floors and a
944-character summary, and retention kept all six declared details, so phase 2 asked only the positive control -
`d-name`, `summary-kept`, `token=石原(verbatim, 100%)`, which shows the token reading printing in a live run.

#### The next candidate: give a window with no region a signal (direction)

A trimmed window with an empty `seats` list sits at the head because nothing tells it where else to go. The
lexical channel is what ranked that row, and the term positions behind its score are never recorded as regions, so
the one signal that could place the window is discarded before `fitEvidenceSpan` runs. The candidate is to carry
the lexical channel's own best term position as a seat and let the existing rule use it. It is a direction, not a
result: the ranker has to carry term positions first, and it must be measured against the labelled probes and the
corpus before it is believed.

**Measured the same day, and rejected.** The candidate was tested before any code changed, on the six held-out
probes, under the rule the code actually applies: the head window is the incumbent and a seat displaces it only
when the window there covers strictly more of the question's terms. Long rows carrying a needle and a lexical
seat: **20 stay inert** - the seat never beats the head's coverage - and **9 would move, with 2 gains and 4
losses**, three of the nine going from one miss to another.

| run | row | needle@ | head | seat | result |
| --- | --- | --- | --- | --- | --- |
| 2 | row16 | 147 | HIT | 那个@365 | miss |
| 2 | row20 | 69 | HIT | 的男@377 | miss |
| 2 | row24 | 314 | miss | 什么@223 | HIT |
| 3 | row20 | 54 | HIT | 盏灯@236 | miss |
| 3 | row28 | 235 | miss | 那盏灯@193 | HIT |
| 5 | row4 | 38 | HIT | 守寨@247 | miss |
| 5 | row6 | 275 | miss | 年轻@331 | miss |
| 5 | row16 | 227 | miss | 的年轻@472 | miss |
| 5 | row40 | 326 | miss | 寨的@90 | miss |

The seat is the *rarest* matching term, and in a row that matches the question only through filler the rarest
match is itself filler: `那个`, `什么`, `的男`, `的年轻`. Adding the entity channel's frequency cap to the
choice changes nothing - in a 42-chunk chat that cap is 11 chunks, and every one of those terms is under it. The
signal is not "where the row is about", it is "where the row happens to share two characters with the question",
and the head is the better incumbent. **Nothing shipped; no run was spent.**

The placement question therefore stays open, and what it has to answer is narrower than this candidate. A row whose
channel produced a descriptor or a rare-term region already gets a seat, and the rows that still miss are the ones
neither a channel nor a content term can place. That is a coverage problem, not a placement rule.

#### Rerank: the lever exists, the transport cannot reach it, and the effect is measured (2026-09-15)

ADR-0016 measured a cross-encoder over the fused top 24 on 52 authored questions: 69% -> 87% answer-in-context,
v3 gaining ten and losing one (p=0.012). It ships optional and off, and `narrative_rerank_model` is empty in this
install, so **every run reported above was taken with rerank off**. Before deciding anything, the call itself was
checked, and it is not the call the plugin makes:

```
POST {base}/rerank                                          -> 404
POST {host}/api/v1/services/rerank/text-rerank/text-rerank  -> 200
```

The transport builds `resolveOpenAiCompatibleBaseUrl(base) + '/rerank'`, which this provider does not serve; the
same key and the same model (`qwen3.7-text-rerank`) answer on Aliyun's native path with a different body and
response shape (`input.query`/`input.documents` -> `output.results[].relevance_score`). Flipping the setting here
would therefore fail open and record `rerank_used: false` - the fused order unchanged, and no visible error.

Measured offline on the six held-out descriptive probes, through the shipped `rerankShortlist` and
`applyRerankOrder`, with the lexical-only ranker so the comparison stays inside one setup:

| run | needle | baseline | + rerank | top rows before -> after |
| --- | --- | --- | --- | --- |
| 1 | 跺一下脚上的雪 | miss | miss | [1,2,10] -> [2,16,4] |
| 2 | 用指节敲两下 | tolerant | tolerant | [1,2,4] -> [2,4,16] |
| 3 | 青瓷灯座 | strict | strict | [1,2,6] -> [6,28,20] |
| 4 | 缺了一角的笠沿 | miss | miss | [1,24,18] -> [26,28,1] |
| 5 | 门牙缺了一颗 | miss | **tolerant** | [1,32,8] -> [4,18,14] |
| 2b | 小臂上 | miss | miss | [1,12,40] -> [4,14,16] |

**strict 1/6 unchanged, tolerant 2/6 -> 3/6: one gain, no loss, one of six readings changed.** Two things the count
does not show. The opening instruction row is pushed out of the top three in every single case, which is the slot
contamination the quoted-slot audit measured (6 of 6 identity probes quote it). And run 2b is the residual: the
needle's own row moves from third to first and the reading is **still** a miss, because the window quotes the wrong
200 characters of it. **Rerank attacks selection, and selection is only half the wall.**

The transport was then made to reach the path that answers: on a 404 from `{base}/rerank` it retries
`{origin}/api/v1/services/rerank/text-rerank/text-rerank` with that path's body and response shape, and reports
which one answered in `rerank_cost.transport`. Only 404 triggers the retry - 401/429/5xx are refusals at the
right path and are reported rather than re-addressed, and a test pins that a 429 is answered once. Verified end to
end through the shipped `requestRerank` against the live provider: `transport: native`, a scored order,
330 ms and 276 provider tokens for three documents. The stage stays off until a model is named, so this changes
nothing for an install that never configured one.

Turning it on then found the last gap, which no offline test could show. With `narrative_rerank_model` set, the
live run recorded `rerank_used: false`, `rerank_error: "Failed to fetch"`, `documents: 20`, `ms: 34` - the
stage ran, and the provider was never reached. The WebView's `fetch` is blocked by CORS for provider traffic;
the embedding path had left it behind for the host's native HTTP invoke shim long ago (`v55-tauri-native-http-bridge.js`,
"TauriTavern WebView fetch() can be blocked by browser CORS even though the native Rust backend can reach the same
provider"), and the rerank transport had not. The shim was probed first and does carry a rerank body: a direct
`generate_chat_completion` with the native path answered `output.results` plus usage. It also reports a provider
failure as a thrown error that *names* the status ("Custom OpenAI endpoint failed with status 404"), because the
ABI has no response object, while the compatible path it must fall back from is decided by status - so the new
fetch-shaped adapter parses that number out and returns it, and an unnamed failure becomes 502 rather than a
guess. `requestRerank` now prefers that shim whenever the host offers one. Live confirmation needs the next run:
the wiring is proven at the shim (the probe above) and in the unit tests, not yet in a generation.

#### Rerank reaches the provider in a real generation and makes the instruction slot rare (2026-09-15/16, ten runs)

Ten runs took the stage with `narrative_rerank_model = qwen3.7-text-rerank` and
`narrative_rerank_candidates = 24`: 2e-2h on the `石原` fixture and the six two-path runs described below. Each
ran the `--detail-survival` acceptance with `perTurn` probes on its own fresh chat; the later ones were opened
from the driver side with the host's `/newchat` slash command instead of by hand.

| runs | probe turns | rerank_used at turn 10 / 20 / final | transport | documents | elapsed | provider tokens |
| --- | --- | --- | --- | --- | --- | --- |
| 2e-2h | 1-2 | false / true / true | native | 14-24 | 110-338 ms | 2,760-10,454 |
| path1-a..c | 3-5 | false / true / true | native | 13-24 | 119-191 ms | 2,300-11,270 |
| path2-a..c | 3-5 | false / true / true | native | 14-24 | 121-232 ms | 3,116-15,620 |

**All 92 captures with `rerank_used: true` have `rerank_error: null`**, over 13-24 documents and 110-338 ms.
Turn 10 recording no call is the stage's own guard rather than a failure - with every floor still unfolded
there are fewer than two candidates the prompt does not already show, so the shortlist is empty and no request is
spent, the shape the code comment already recorded from an earlier live run. The cost is one native call per
generation once the first fold lands, 2,300 provider tokens at the low end and 15,620 at the high end of a long
chat, so the ~10k figure quoted for this stage is neither the floor nor the ceiling.

The quoted-slot audit, with the stage the only thing that changed:

| stage | runs | probes | quoted sections | user rows quoted | probes quoting one |
| --- | --- | --- | --- | --- | --- |
| off (2c) or CORS-blocked (2d) | 2 | 4 | 20 | 4 - every one `raw_2`, floor 1 | 4/4 |
| on, native | 10 | 31 | 155 | 3 | 3/31 |

Without the stage every probe spent a slot on a user row and it was always the same one: `raw_2`, the opening
instruction whose text carries the needle for the identity probes. With the stage reaching the provider the share
of quoted slots that are instruction rows falls from 4/20 to 3/155. The three survivors are `raw_2` (floor 1, the
opening instruction), `raw_16` (floor 15) and `raw_6` (floor 5), the last two ordinary continuation
instructions. **An earlier reading of "0 for 6" was a small-sample artifact and is corrected here**: the stage
does not eliminate the instruction slot, it makes it rare. One of the three cost nothing - `path1-a`'s `d-jar`
probe quoted both `raw_16` (the instruction that names `灶上一只粗陶罐`) and `raw_17` (the row the model actually
wrote) and still recovered the detail.

All ten runs are otherwise clean: fold 21 then 41 and both batches committed in every run, gate PASS (20/20
floors, 42 chunks covered), and `ungroundedPasses: 0` in every adjudication. Fact survival at the two merges,
from the ten recorded runs: 5/5 then 6/6 (2e), 5/5 then 5/6 (2f), 5/5 then 5/6 (2g), 5/5 then 6/6 (2h), 6/7 then
7/9 (path1-a), 7/7 then 9/9 (path1-b), 7/7 then 7/9 (path1-c), 4/5 then 5/6 (path2-a), 5/5 then 4/6 (path2-b),
5/5 then 6/6 (path2-c). Two of those report a must-keep lost in a merge, both the
promise `天亮前换岗`. Only `path1-c`'s is real: its committed summary does not contain the promise, which the
retention check independently confirms. `path1-a`'s committed summary retains it, so that report is the
one-revision-behind artifact this observation is already documented to have (`acceptance-longchat.mjs`).

#### The crossed wall is the window, not the selection and not the question (2026-09-16, runs path1-a..c and path2-a..c)

Two paths were run three times each against the selection stage that now works.

- `path1-tiedan` is the `铁蛋` fixture, nine declared details instead of six, so the adaptive probe set has more
  to ask about when the merge drops something.
- `path2-shiyuan` is the `石原` fixture with one question repaired. `d-manner` used to ask 他开口之前有什么固定动作
  ("what fixed action precedes his speaking"), a relation the original text never states; it now asks 他怎么检查船板有
  没有进水, which floor 8 does state.

Both fixtures also declare negative controls under the key the parser actually reads. **They are the first runs
in this log with any.** `parseTurnsFile` takes negative controls from `negativeControls`; every fixture used for
the earlier runs declared them as `negatives`, and an unknown top-level key was ignored, so every "0 fabricated"
recorded before this was measured on a probe set that had nothing to fabricate. The parser now reports the
mis-keyed list as an error, which the driver turns into a stop before any paid run.

| run | dropped details probed | outcome |
| --- | --- | --- |
| path1-a | d-teeth, d-jar | 2 `retrieval-recovered` (门牙 run2/50%, 只粗陶罐 run4/67%) |
| path1-b | none (9 of 9 retained) | - |
| path1-c | d-teeth, d-promise | 1 recovered (门牙缺 run3/75%), 1 `retrieved-not-conveyed` |
| path2-a | d-manner | `retrieved-not-conveyed` |
| path2-b | d-tool, d-manner | 2 recovered (黄铜卷尺 verbatim/100%, 敲两下 run3/50%) |
| path2-c | none (6 of 6 retained) | - |

`path1-c` also lost the promise `天亮前换岗` end to end, and that is the first one this log records: a
must-keep promise dropped by the merge (the retention check says so independently of the batch-time observation),
not quoted back by the evidence, and not asserted in the reply - which correctly says 除此之外，我不记得他明确答应过谁
什么具体的事. The contract says a promise is the kind of thing the summary exists to carry, so this is the reading
to fix next, not a measurement artifact.

**Twelve negative probes, twelve refusals, zero fabrications, zero negative leaks.** The refusals are not
one-word dodges: `path1-c`'s answer to 门上挂着什么铃 was 不记得。（我记忆里没有出现过"门上挂铃"这一项——寨里相关的只有号鼓已毁、铁蛋腰间那面半张牛皮的鼓，以及阿婆灶间剁菜报平安的动静，没有门铃。）,
and `path1-a`'s to the beast count was 不记得。…说不出，就不编。

The `d-manner` pair isolates that remaining stage. Run 2g (with the old question) and `path2-b` (with the
repaired one) both answered it; run 2f declined the relation, and `path2-a` refused outright with a bare 不记得。 - and its evidence
block carried the full needle `用指节敲两下` verbatim, three times:

| `path2-a` quoted row | what it says |
| --- | --- |
| `raw_9` floor 8 | 抬起手指，用指节敲两下身旁的**树干** |
| `raw_17` floor 16 | 先走到桥上，用指节敲两下**桥面** |
| `raw_19` floor 18 | 上钉子时，先用指节在**门框**上敲两下 |

Not one of them is about checking a boat. The model's refusal is correct for the quote it was handed. `path2-b`
quoted a different span and got the answer: 下湖前敲两下船帮。头一下问木，听它空不空；第二下问人，听水下有没有应。
- which its reply reproduces almost verbatim.

So repairing the question changed nothing about the outcome; **what changed the outcome was which characters of
which row the window quoted.** `evidenceMatch` cannot see the difference, because it matches the needle and the
question asks about a relation the needle does not carry: the instrument files both `path2-a` and `path2-b` under
the evidence channel, and `path2-a` lands in `retrieved-not-conveyed`, which reads like the model dropping
something it was given. The same shape is behind `path1-c`'s `d-promise`: the evidence match is the two-character
run `换岗` from 到时辰了，换岗 (a relief-of-duty line, not the promise `天亮前换岗`), and the reply correctly says it
does not remember such a promise. Both are placement and matching artifacts, not answer failures.

That leaves the stages in order: the summary dropped a must-keep promise once in six runs (`path1-c`), the
cross-encoder now stops the instruction row from taking most of its slots, and **the loss that remains on every
other miss in this batch is the window quoting the wrong region of the right row** - the same stage the
2026-09-15 trim geometry measured (ten needle occurrences 63-207 characters outside their quoted span) and this
batch's `d-manner` pair now witnesses live. The next change belongs there, and the signal it needs is coverage of
the question's terms inside the quoted span, not another ordering rule.

#### A run now records what the reranker changed, not only that it ran (2026-09-16)

The ten runs above recorded `rerank_used`, `rerank_error` and `rerank_cost`, and nothing about the order. A
configured reranker therefore read the same whether it had reordered the shortlist or handed the fused order
straight back, and no amount of live running could answer whether the stage did anything - the only controlled
evidence for its effect is the offline held-out table, and that was measured with a different model
(jina-reranker-v3) than the one this install names (`qwen3.7-text-rerank`).

`rerankMoveMetrics` (`v55-rerank.js`) now scores the reorder itself: `shortlist`, `moved` (positions whose
occupant changed), `top1_changed`, and the first three candidate sources before and after. A failed call records
`moved: 0` instead of leaving that to be inferred from the error string. It is a pure function of the two orders,
so it adds nothing to what a run costs. `runtime-precheck` watches both new functions, and section 19 of the
pipeline tests pins a full reversal (`moved === shortlist`), an order that agrees with the fusion (`moved: 0`) and
the fail-open case.

#### The on/off A/B: the stage does what it was bought for, and the answers do not move (2026-09-16, runs ab-off-1..3 and ab-on-1..3)

Six runs of the `path2-shiyuan` fixture, three with `narrative_rerank_model` set and three with it empty,
**interleaved** (off, on, off, on, off, on) so any drift over the batch is split between the arms. The setting is
read live from `extensionSettings` on every generation (`narrativeSettings`), so each switch is a settings write
plus a fresh chat - no host reload, which would land the page on the welcome screen. Every off run reports
`rerank_model: null`, `rerank_used: false`, `rerank_cost: null`; every on run reports `used: true` with no error.

**The stage reorders almost everything, and it removes the opening instruction row every time it sees it.** In
all 22 captures the new metric recorded, `moved` is 13 of 14 up to 24 of 24 shortlist positions and
`top1_changed` is **true**. The fused head puts the opening instruction row `raw_2` in the top three in nine of
those captures, and the reranked head contains it in **none** - 9 for 9, which is the mechanism behind the slot
reading below rather than another correlation.

Cumulative slot audit, now over every run in this log:

| arm | runs | probes | quoted sections | user-row slots | of which `raw_2` | probes quoting one |
| --- | --- | --- | --- | --- | --- | --- |
| off / CORS-blocked | 5 | 17 | 85 | 10 | **10** | 10 |
| on, native | 13 | 44 | 220 | 7 | **1** | 5 |

With the stage off, **every** user-row slot is the same row: `raw_2`, the opening instruction, which for the
identity probe literally carries the answer. With it on, the surviving slots are ordinary continuation
instructions (`raw_6` floor 5, `raw_8` floor 7, `raw_16` floor 15) and `raw_2` appears once in 44 probes.

**The answers, however, do not separate.** Both arms recovered two details:

| arm | recoveries | retrieved-not-conveyed | refused (all negative controls) | fabricated |
| --- | --- | --- | --- | --- |
| off | d-tool (verbatim 100%), d-promise (`船底` 29%) | d-manner twice | 6 | 0 |
| on | d-tool (verbatim 100%), d-arm (verbatim 100%) | d-promise, d-manner | 6 | 0 |

Two against two in thirteen probes each, with the retention differing between runs for reasons that have nothing
to do with the stage (off dropped 0/1/3 details, on dropped 1/2/1). **This sample cannot show an answer-level
gain, and at n=3 per arm it could not have.** What it does show is that the stage changes the prompt in the
direction the offline held-out table predicted - the instruction row out of the top three - at 2,300-15,620
provider tokens per generation once the first fold lands.

Two readings that belong to the instrument rather than to the stage, and are recorded so they are not read as
retrieval wins: `ab-on-2`'s `d-manner` reply describes the same check with a hammer (`用小锤沿船底敲了一圈`), not
the knuckles the needle names, so it is counted as not conveyed; and `ab-off-3`'s `d-promise` is credited through
the two-character run `船底`. One result-level failure stands out and is not explained by any of this: in
`ab-on-1` the **positive control** `d-name` was answered 我从未到过什么渡口，也不认识修船的人 although the needle is in
both channels - the model replied as the character denying knowledge, which is a probe-framing failure worth its
own diagnosis.

#### The drop bound: implemented, measured, and not shipped (2026-09-16, runs ab-bound-1..3)

The A/B left one reading to act on: across 22 captures the stage replaced essentially the whole shortlist and the
fused first candidate lost the head in every single one. The obvious response is to bound how far a candidate may
fall below its fused position - the fusion carries three channels' judgement, and a cross-encoder that overrides
all of it is discarding a signal rather than adding one.

`rerankHead` now takes `maxDrop`, implemented as a deadline insertion rather than a post-hoc repair: at each
position the candidate whose fused position plus the bound has run out is placed, and otherwise the best-scoring
remaining candidate is. Rising stays unbounded, at most one candidate is ever forced, and
`maxDrop >= shortlist - 1` is exactly the old order. `rerank_cost` reports `max_drop` for the same reason it
reports `moved`: a near-reversal can change every position and still respect the bound, so "did the bound hold"
and "how much moved" are different questions.

Three live runs then took `maxDrop = 4` on the same `path2-shiyuan` fixture. **The bound is exact, and it does not
do the job it was aimed at.**

- `max_drop` is **4 in every one of the 39 recorded captures and never more**, so the mechanism works.
- `top1_changed` is still true in 35 of those 39. A bound of four stops the fused first candidate being *buried*;
  it does not stop it *losing the head*, which only takes one place.
- The opening instruction row comes back. In `ab-bound-1` the probe evidence quoted `raw_2` in **three of its four
  probes** (`21:raw_2/f1 | 22:raw_2/f1 | 23:raw_2/f1`), against one of 44 probes across the thirteen unbounded
  runs. Bounding the fall is the wrong lever for the instruction-slot problem, because clearing that row out of
  the head needs a *large* demotion.
- The answer level cannot separate the arms: `ab-bound-2` recovered all three dropped details (`d-arm`,
  `d-tool`, `d-manner`), `ab-bound-1` recovered none of its one, and `ab-bound-3` is **invalid** - its second batch
  never committed, so `foldedRows` is 21 and three probes were answered from a transcript that still showed the
  needles. The instrument classified them `visible-in-prompt`, which is how the run was caught, and it is excluded
  here: three recoveries in ten probes for the bounded stage against two in thirteen for each of the other arms.

So the shipped default stays unbounded and the parameter stays for the next measurement. The variant that keeps
both properties is the complementary one - bound how far a candidate may **rise** (a release-time insertion in the
same shape), which leaves the composition of the head to the fusion while still allowing the instruction row to be
demoted. That is the next thing to measure, not another threshold on this side.

Two instrument notes from the batch. `ab-bound-3` exposes a gate weakness: a run whose second batch never
committed still passed the "phase 1 is summarized and its original rows are hidden" precondition, and only the
per-outcome `visible-in-prompt` classification caught it - the gate should refuse on the fold state as well. And
`ab-bound-2`'s `d-manner` is credited through the three-character run `指节敲`.

#### The rise bound is the variant that keeps both properties (2026-09-16, runs ab-rise-1..3)

Bounding the drop failed because the instruction row has to be demoted *a long way*. The same machinery pointed
the other way does not have that problem: cap how far a candidate may **rise** and demotion stays free, so the
opening instruction row still leaves the head while the head itself is still drawn from the fusion's own leaders
instead of being filled by whatever the provider liked at position twenty.

`rerankHead(pick, order, maxDrop, maxRise)` implements both, and they compose: a candidate is placed no earlier
than its release (`from - maxRise`) and no later than its deadline (`from + maxDrop`). A forced candidate is
always released, because the release is at most `from` and the deadline is at least `from`, so the two bounds
cannot deadlock. `maxRise = 0` is the fused order exactly, either bound at `pick.length - 1` or more stops
bounding that direction, and `(Infinity, Infinity)` is the stage as it was first shipped. `rerank_cost` reports
`max_rise` next to `max_drop`.

Four arms, three runs each, the same `path2-shiyuan` fixture, each run on its own fresh chat:

| arm | runs | probes | dropped details probed | recovered | retrieved-not-conveyed | user-row slots (of which `raw_2`) | fused #1 kept the head |
| --- | --- | --- | --- | --- | --- | --- | --- |
| off | 3 | 13 | 4 | 2 | 2 | 6 (6) | n/a |
| on, unbounded | 3 | 13 | 4 | 2 | 2 | 4 (0) | 0 of 22 captures |
| on, drop <= 4 | 2 | 10 | 4 | 3 | 1 | 5 (4) | 4 of 39 |
| on, rise <= 4 | 3 | 14 | 5 | 5 | 0 | 1 (1) | 14 of 37 |

(`ab-bound-3` is excluded from the drop arm - its second batch never committed. "Captures" counts the diagnostics
objects the snapshots carry, including the duplicated state each snapshot pair writes.)

**The rise bound is exact**: `max_rise: 4` in all 23 captures of the three runs, never more, while `max_drop`
runs free at 9-20. It is the only arm that keeps the instruction row out of the evidence **and** gives the fused
head back its place: `raw_2` was quoted once in fourteen probes, and the fused first candidate kept the head in
14 of 37 captures against none of 22 when unbounded.

It is also the only arm with no `retrieved-not-conveyed` at all, and it recovered all five dropped details it
probed - `d-manner` through `用指节敲`, `d-arm` through `小臂上`, and `d-promise` through a **verbatim**
`三天内补齐船底`. **That is five samples, not a rate**, and it is the reason to keep measuring rather than to
declare the stage fixed.

So the shipped default is `maxRise = 4` with `maxDrop` unbounded. One interaction is unmeasured and is recorded
here as the open risk: the situation channel's late-ranked rescue - the returning character whose introduction the
fusion ranked low, which `RERANK_ENTITY_EXTRA` exists to seat - now has its rise bounded too, so a row the fusion
put at twenty can no longer be lifted to the head. None of these probes covers that case; a returning-character
fixture would.

What the runs already recorded can say about that risk is narrower than the case itself, and it is worth writing
down because it points the other way. Every build reports the profiles its query named and whether each was
quoted into the evidence (`profile_terms[].quoted`):

| arm | named profiles | quoted |
| --- | --- | --- |
| rise <= 4 (ab-rise-1..3) | 5 (瑟拉菲娜, 石原 x2, Seraphina, 小姑娘) | **5** |
| drop <= 4 (ab-bound-1..2) | 3 (石原 x2, 瑟拉菲娜) | **3** |
| unbounded (ab-on-1..3) | 3 (石原 x2, Seraphina) | 3 |
| unbounded (path1-a, path1-c, 2g) | 满仓, 阿婆, 渔妇 among others | **3 not quoted** |

The only named profiles that failed to reach the evidence anywhere in the twenty-three runs - 满仓 in `path1-a`,
阿婆 in `path1-c`, 渔妇 in `2g` - are all in the **unbounded** arm, the arm the bound was supposed to be safer
than. The rise-bound arm quoted every profile its query named.

That is not the test the risk needs. `quoted` is per profile, not per row: it says some row of that profile
reached the evidence, not that the *introduction* row did, so it does not exercise a character who has been
absent for many turns and whose only relevant row is the one that introduced him long ago. That case needs a
purpose-built fixture with a second thread and a probe that names the returning character without naming the
value it is testing.

**That fixture is written, and it could not settle the risk, for a reason that belongs to the instrument.**
The wider sandbox mode came back, so a two-thread fixture was built: 石原 is introduced with a copper whistle in
the first ten floors, leaves for the whole second section, and every question that tests him names him and never
the value, so the profile channel is the only path to those far-back rows. The first version declared four
details; the merge kept all four in two runs of three, and the third run's second batch never settled. A second
version declared ten, and the merge kept ten of ten in two runs and nine of ten in the third.

The adaptive probe set only asks about details the committed summary **dropped**, so five of the six runs produced
exactly one probe - the positive control - and no rescue sample at all:

| run | details | retained | dropped | probes | rescue outcome |
| --- | --- | --- | --- | --- | --- |
| ret-a | 4 | 4 | - | 1 | none |
| ret-b | 4 | 3 | d-place | 4 | **invalid**: folded only 21 rows |
| ret-c | 4 | 4 | - | 1 | none |
| ret2-a | 10 | 10 | - | 1 | none |
| ret2-b | 10 | 9 | d-manner | 4 | **recovered** |
| ret2-c | 10 | 10 | - | 1 | none |

The one usable sample is a real rescue and it survived the bound. `d-manner` was written on floor 5, dropped by
the merge, and the question `石原怎么检查船板有没有进水？` - naming a character absent since floor 11 - came back
with the evidence quoting `raw_29` (floor 28) and a reply that reproduces it: 石原是用手指敲船壳听的。他走到船腰，屈起食指和中指在船壳上敲了两下. The row is 23 floors past the one that introduced the detail, so it was promoted a long way, and a rise bound of four did not stop it.

**One sample is not a measurement of the risk**, and the reason is structural rather than a matter of running
more: this acceptance can only ask about a detail the summary dropped, and this summary keeps almost everything -
ten declared details, ten retained, twice. Testing the rescue properly needs a probe mode that asks about a
declared detail the summary is *known* not to carry, or a fixture whose details are numerous enough that drops
are the rule rather than the exception. That is the next instrument change, not another batch of runs.

#### A fold that hid only the first batch no longer passes the gate (2026-09-16)

The two invalid runs above failed the same way: the second batch's request never settled, so only the first ten
floors were folded (`folded: 21`), the last ten stayed visible, and three probes answered from a transcript that
still showed the needles. `summaryGate` passed both, because it only asked whether *any* row had been folded.
The per-outcome `visible-in-prompt` classification caught them, which is after the run has been paid for.

The gate now requires the fold to cover the phase - `folded >= 2 x completeTurns`, one user and one assistant row
per finished floor - and says 有一批没有提交 when it does not. The greeting need not be folded, so a run that
leaves it visible still passes on 40 rows for 20 floors. Two witnesses, both recorded above.

#### The density lever settles the rescue question (2026-09-16, runs ret3-a..c)

The instrument change the section above asked for was not needed. The reason five runs produced no rescue sample
was the number of declared details, not the probe mode: the merge keeps ten of ten, but it cannot keep
twenty-one. Naming **two needles in each of the first ten turns** takes the same fixture to 21 declared details,
and the merge then drops two to four of them per run:

| run | retained | dropped | probes | rescue probes (question names the absent 石原) |
| --- | --- | --- | --- | --- |
| ret3-a | 18/21 | d-polish, d-manner, d-hollow | 6 | 3 recovered |
| ret3-b | 19/21 | d-polish, d-voice | 5 | 1 recovered, 1 asserted-with-no-channel |
| ret3-c | 17/21 | d-polish, d-manner, d-hollow, d-belt | 7 | 2 recovered, 1 refused, 1 asserted-with-no-channel |

**Six of nine rescue probes recovered**, and `d-polish` - written on floor 1, about a character absent since
floor 11 - came back in **all three runs**, verbatim in two of them. With `ret2-b`'s floor-28 rescue that is
**ten rescue probes and seven recovered**, and the three failures are answer-level: one refusal, one confusion,
and one wording gap. **None of them is "the row was ranked too low".** The rise bound is not the failure mode
here, and the open risk recorded above is closed as not observed.

Two of those failures are worth keeping. `ret3-b`'s `d-voice` reply says 哨子哑了……吹不出声 while the needle is
`吹不响`: the prompt carried the fact under other words, so the channel matched nothing and the instrument
counted it as asserted-with-no-channel. That is a **false positive of the needle-based channel test**, the same
tolerance gap this log has recorded elsewhere. `ret3-c`'s `d-belt` is the real thing: asked what the belt is
made of, the reply moves the reed-weaving from the straw shoes onto the belt and keeps the brass buckle.

One reading from this fixture qualifies an earlier result. In the dense fixture the opening instruction row
reached the evidence in **six of eighteen probes** (every one `raw_2`), against one of fourteen on
`path2-shiyuan`. Every needle there is named inside an instruction, so the demoted row can still sit inside a
five-slot budget. The instruction-slot benefit the rise bound was chosen for is therefore real but
fixture-dependent, and the dense fixture is the harder case.

#### The window is not the failing stage (2026-09-16)

The next change was going to be window placement. The log's own trim geometry (2026-09-15) had counted ten needle
occurrences 63-207 characters outside the span quoted for the row that carries them, and two live misses -
`path2-a`'s refusal and `2f`'s decline - read as "the right row, the wrong region". Before writing a rule, the
whole recorded corpus was re-read against the needle each probe was actually asking about: 37 runs, 92 probes
with a quoted block, looking up the needle's own row in that run's snapshot and asking whether the needle lies
inside the span quoted for that row.

| reading | count |
| --- | --- |
| probes with a quoted evidence block | 92 |
| ... a needle-carrying row was quoted, needle inside its span | 36 |
| ... a needle-carrying row was quoted, needle outside its span | **0** |
| positive probes with no channel at all | 3, every one a selection miss |

**Zero window misses.** Whenever a row carrying the needle was quoted, the quote contained the needle. The
2026-09-15 geometry predates the seat and placement work, and it counted every declared needle against every
quoted row rather than the needle the probe was asking about - a row quoted for another reason can hold a
*different* needle outside its span, which costs nothing. The three retrieval failures in the whole corpus are
selection: the detail's own rows were never quoted at all (`ret3-b`'s `d-voice`, `ret3-c`'s `d-hollow` and
`d-belt`). **The window rule planned for this change was therefore not written**, and the query-term coverage
signal that would have driven it separates the correct window from the quoted one in only 5 of 80 near-misses -
none of them the cause of a wrong answer.

#### A quotation is now read as a quotation (2026-09-16)

The re-read turned up the reading that does need fixing. Over the same 37 runs, **73 of 82 positive probes had the
evidence channel matched, but only 53 were the needle itself**; the other 20 were a partial run (8 `run2`, 8
`run3`, 4 `run4`). Of the 28 recorded `retrieval-recovered` outcomes, **12 rested on a partial run** - the quote
did not contain the detail, so the model could not have copied it and the recovery claim is not the one the
number looks like. The summary is a derived paraphrase and the tolerant match is right for it; the evidence block
is a *quotation* of the original, and a quotation either contains the detail or it does not.

`attributeChannel` now returns `evidenceFull` (the needle itself) beside `evidence` (the tolerant tier), the
driver carries it into the summary, and the report prints 其中原文含完整 needle N 个 next to 检索取回 N 个. The
classification is unchanged, so the split is visible without re-reading the old numbers as new.

#### The rise-bound control could not be run (2026-09-16, runs ret4-b1..u3)

The control called for above needs the bound to be flippable without a deploy, so `narrative-runtime.js` now
reads an optional `narrative_rerank_max_rise`: unset means the bound `rerankHead` ships with, and a value that is
not a finite number at or above zero is treated as unset, because a typo must not silently remove the bound. Six
runs were taken with it, interleaved 4 / unbounded / 4 / unbounded / 4 / unbounded.

**Three of the six never reached the probes.** The provider answered the summary-batch request with 404
(`deepseek-v4-flash`; one run recorded eleven failing calls, every one of them), the second batch never
committed, the fold stayed at the first ten floors, and the tightened gate refused the run instead of spending
its probe phase on a transcript that still showed the needles. That is the gate fix from earlier the same day
paying for itself three times over - and it is also why there is no control: two bounded runs and one unbounded
one are not a comparison.

The question the control was built for was therefore still open at that point. **The corpus's only three
retrieval failures sat in the rise-bound arm**, and whether the bound caused them was not settled. With the
balance restored the control was taken the same day - see "The rise-bound control ran" below.

#### The live 404 toast was the reranker's own probe (2026-09-16)

The toast the install showed on every generation - "Failed to generate chat completion: Internal error: Custom
OpenAI endpoint failed with status 404: Generation request failed" - was not the summary call and not a provider
fault. It is the rerank stage's **expected** first attempt: Aliyun does not serve `{base}/rerank`, the stage asks
for it anyway, the 404 triggers the retry that works, and every one of those requests goes through the host's own
`generate_chat_completion` shim - so the host raised the failure to the UI even though the plugin caught it and
the story kept being written. "It keeps erroring but the text still comes out" is exactly this: two different
requests, one of which is designed to 404.

The captured summary calls were a separate, real failure in the same window - `status 402: Insufficient Balance`
on the DeepSeek endpoint, which is why three of the six control runs never committed a second batch - and that is
a balance problem, not a code one.

`requestRerank` now remembers per base URL which path answered and tries it first, so the probe happens once
instead of once per generation; a later 404 on the remembered path clears the memory and probes again. The first
call in a session is unchanged, and a test pins that the second call goes straight to the path that answered.

That memory was per page, so a reload forgot it and the next generation probed again - one toast per page load,
not one per install. It is now seeded from the settings on install (`bindRerankSettings`) and written back to
`narrative_rerank_native_paths` when a path answers.

The write could not be assumed. The host persists extension settings on its own debounce, and mutating the
object does not schedule one: the path the plugin discovered was still **absent from the settings file fifteen
minutes later**, and the delete of `narrative_rerank_max_rise` below did not reach the file at all until
`ctx.saveSettingsDebounced()` was called for it. The discovery therefore asks for the write itself, and only
when the memory actually changed. And the toast is a *request*, so the reading that settles it is a request
count: a bounded ring of the native shim's own failures (`globalThis.__aetheriaNativeFailures` - last eight,
with label, endpoint and message) now sits beside the memory it measures.

Across the three runs below and the refused attempt before them - eighty-odd generations - that ring held
**one** entry, the first discovery, and the settings carried the Aliyun base URL. Then the page was reloaded and
twelve more floors were played on a fresh chat: three of those generations reranked on the native path (21-22
documents, 142-245 ms, 5,819-7,823 provider tokens, no error) and the ring stayed **empty**. The probe is once
per install, and an install no longer raises a 404 toast for a call it designed to fail.

#### The rise-bound control ran (2026-09-16, runs ret5-u1..u3)

The control the earlier section could not take was taken once the balance was restored:
`narrative_rerank_max_rise = 999`, at or past `pick.length - 1` and therefore free in both directions, on the
same `path3-return` fixture, three runs, each on its own fresh chat. Every capture in the three runs reports a
free `max_rise` (9 to 21), so the arm is the one it claims to be. One attempt was lost before its probes: the
second summary batch was refused `over_budget` twice - a 1,210-token body against the 900-token ceiling the
600-token target derives, and its one body repair over as well - so the fold stayed on the first ten floors and
the tightened gate refused the run instead of spending probes on a transcript that still showed the needles.

| arm | runs | detail probes | recovered | verbatim needle | retrieved-not-conveyed | other detail failures | `raw_2` sections quoted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rise = 4, shipped (`ret3-a..c`) | 3 | 9 | 6 | not readable | 0 | 2 fabricated, 1 refused | 6 of 90 |
| rise = 4 (`ret4-b2`, `b3`) | 2 | 12 | 6 | 5 | 3 | 1 fabricated, 2 refused | 8 of 90 |
| free (`ret5-u1..u3`) | 3 | 16 | 12 | 8 | 0 | 1 fabricated, 2 refused, 1 instruction-only | 3 of 125 |

The `verbatim needle` column is not readable for `ret3` because the instrument that separates a quotation from
a tolerant run was added after it; `ret4-b2` and `b3` are the bounded arm that can be read that way. Two runs
from the aborted `ret4` batch also carry a free bound and agree with the three above - `ret4-u2` recovered 3 of
5 probed details, 2 of them verbatim - while `ret4-u3` is excluded: its captures report `max_rise` 4 beside
free values, so a mid-run flip is in its record and the run is not one arm.

**The bound is not what failed those three details.** `d-voice` failed in every arm it was probed in -
fabricated in `ret3-b`, `ret4-b2` and `ret5-u1`, refused in `ret4-b3` - so none of it is a rise-bound effect.
Removing the bound did bring `d-hollow` back once with the needle itself (`ret5-u1`) and `d-belt` once through
a partial run (`ret5-u3`), and both failed in the other free runs, so the ceiling was at most a contributing
factor. The free arm recovered 12 of 16 probed details against 6 of 12 in the instrument-comparable bounded arm,
and zero `retrieved-not-conveyed` against three.

What the bound still buys is the opening instruction row's place, and on this fixture it buys less than it did on
`path2-shiyuan`: `raw_2` is quoted in 8 of 90 evidence sections under the bound (`ret4-b2`, `b3`) and 6 of
90 in `ret3-a..c`, against 3 of 125 with the bound free. The direction matches the `path2` arm (0 of 22
unbounded); the size does not.

One reading reverses between fixtures and must not be carried as a property of the bound: on `path2-shiyuan` the
bounded arm was the only one with no `retrieved-not-conveyed`, and on the dense fixture it is the free arm that
has none. Two fixtures, single-digit samples, opposite signs.

**That decision was reversed later the same day.** The instruction-row benefit this paragraph rests on does not
survive a per-probe ruler - see "The rise bound is removed" below - and neither does the rescue reading.
`narrative_rerank_max_rise` stays implemented and read as the lever these measurements needed, and stays out of the
settings panel: nothing here makes the bound a choice a user should be asked to make.

#### Where a failed detail was lost (2026-09-16, 53 runs, 157 positive probes)

Stage 3 asks which stage lost the fact before anything is changed. The build already records what that needs:
the ranking it handed the packer (`evidence_candidates`), what the packer did with every candidate
(`evidence_trace`), the spans it quoted (`sources`), and the run's own chat is in the snapshot beside them. So
the whole recorded corpus was re-read against those, with no model call: for every positive probe whose reply
did not convey its detail, the rows of that run's chat that carry the needle were located, and each was followed
through the record.

157 positive probes, **34 did not convey their detail**:

| loss | probes | what the record says |
| --- | --- | --- |
| the prompt held the needle and the reply did not use it | 10 | the needle was inside a quoted span: 3 `retrieved-not-conveyed`, 3 `summary-kept`, 3 refused, 1 instruction-only |
| the carrier was ranked, but outside the five-entry block | 17 | 15 of these have exactly one row in the whole chat carrying the needle |
| the carrier was never a candidate | 4 | one such row each; the row is folded, so retrieval is the only route to it and the ranking did not return it |
| no per-turn snapshot (older runs) | 3 | - |

**Nothing was lost to the stages this log suspected.** Over 96 carrier rows: zero `budget`, zero `too_long`,
zero chunk misses, zero span misses. The token budget never bound, no window or trim cut the needle out of a
span that was quoted, and the chunker never separated the needle from its own candidate. Five carrier rows (in
four probes) were never in the ranking; every other loss is one mechanism: the block holds **five** entries and the carrier was not
among them.

The packer is greedy (`SHIPPED_PACK_POLICY`), so the block is the first five candidates of the order it is
given, after dropping repeated text and a second chunk of the same message. Across 218 recorded probes the first
non-included row is at trace position 6 in **217** of them, and `included` is 5 in 217: the entry count is what
runs out, never the budget - over 5,099 candidate rows the outcomes are 1,085 included, 3,952 `entry_cap`, 62
deduplicated, and no `budget` or `too_long` at all.

Where the carriers sit in that order:

| arm | runs | carrier rows | position 1-5 | position 6 or later |
| --- | --- | --- | --- | --- |
| rerank off (the fused order is what the packer gets) | 7 | 37 | 6 | **31** |
| rerank on (the reranked order) | 14 | 54 | 17 | **37** |

A detail that failed is normally a row the fusion ranked somewhere between 8th and 25th. With five entries and
`maxRise = 4` a row the fusion placed at position 10 or later **cannot** enter the block even if the reranker
ranks it first, because its earliest release is `from - 4` and the quoted window is positions 0-4: 24 of the 37
carrier rows measured with the reranker off sit at position 10 or later, so two thirds of them are out of reach
under the shipped combination for that reason alone.

That was as far as the record went, and the gap was one field. `evidence_candidates` is the order the packer
was given - post-rerank - and each row's position in the **fused** order was recorded nowhere, so "the reranker
ranked it thirtieth" could not be told apart from "the reranker ranked it second and the rise bound held it at
`from - 4`", the difference between a ranking problem and a bound problem. Every candidate row now carries
both numbers: `fused`, the position the fusion gave it, and `rerank`, the provider's score for it (null when
the shortlist did not send it). `rerankHead` is a pure function of exactly those two and a bound, so a recorded
build replays at any bound offline; the test pins that the replay reproduces the head the build produced, before
the replay is used to ask what another bound would have quoted.

#### What the rise bound costs, measured by replay (2026-09-16, attr-1..3)

Three more runs of the dense fixture with the field recorded - 24 probes, 16 of them not conveyed - were
replayed at the shipped bound and at a free one. **Every replay reproduced the order the build recorded, 16 of
16**, which is what makes the numbers below a measurement rather than a guess.

Each row of a failed probe's chat that carries the needle, against the five-entry block:

| what happened to the carrier | carrier rows | failed probes |
| --- | --- | --- |
| it was in the block, so the prompt held the needle and the reply did not use it | 7 | 4 |
| **a free rise bound would have put it in the block; the bound kept it out** | **12** | **6** |
| the provider's own ranking put it outside the top five even unbounded | 15 | 4 |
| the fusion put it past the shortlist (positions 23-27), so no provider saw it | 5 | 2 |
| the row was not a candidate at all | 1 | 0 |

Six of the sixteen failures are the bound's rather than the ranking's, and two of them are worth keeping:
`d-chipped`'s build had `raw_19` as the provider's **highest-scoring** document (0.935, fused position 14) and
the four-place release bound kept it out of a five-entry block, and `d-whistle`'s had `raw_15` first (0.959,
fused 11) and did the same. The bound does not only hold the opening instruction row down.

The same replay forecasts the trade before anyone pays for it, over the same 24 probes:

| rise bound | carrier rows quoted | failed probes that gain a carrier | blocks quoting the opening instruction row |
| --- | --- | --- | --- |
| 4 (shipped) | 7 | 4 | 9 of 24 |
| 8 | 10 | 5 | 8 of 24 |
| 12 | 12 | 8 | 6 of 24 |
| free | 17 | 10 | 4 of 24 |

**This is prompt composition, not answers.** A replay says which rows the block would quote and nothing about
whether a reply would then use them, so it is the ruler for a decision taken with a live arm rather than the
decision itself. What it already shows is that the trade is roughly one regained carrier per instruction-row
block given up - over three runs and sixteen failures, which is a number to grow, not a rate to ship.

#### What the summary refuses, across the record (2026-09-16, 66 runs, 129 batch captures)

The same pass counted the other half of the contract. Every recorded summary failure, by stage:

| stage | batches left uncommitted | body repairs recorded | repairs that saved the batch |
| --- | --- | --- | --- |
| `over_budget` (a body past the ceiling) | 7 | 7 | 2 |
| `format` (no body at all) | 3, all one older run | 14 | 14 |
| `transport` | 4 | 0 | - |

No `truncated`, `empty_body`, `input_budget` or `anchor_ops` refusal is recorded anywhere in the corpus.
The four transport failures are the 402/404 window already written down. The `format` repair works - every one of
its fourteen recorded repairs committed, and the three batches that stayed uncommitted are three failures in a
single older run that recorded no repair.

**`over_budget` is the refusal that repeats, and it is what stalls a dense chat.** Seven batches were left
uncommitted, and the one body repair that exists for this refusal saved two more of them. `ret5-f1` is the case
with numbers: a 1,210-token body against the 900-token ceiling that the 600-token target derives, and a repair
that came back 2,254 characters - still over. Nothing is folded when a batch is refused, so the source stays
visible (correct), the backlog keeps growing, and the next pass asks the same frozen batch again. Every recent
instance is dense material: twenty-one declared details in twenty floors is more than a 900-token body holds, and
the repair is a second attempt at the same request rather than more room or a smaller batch.

#### The rise bound is removed (2026-09-16, runs b12-1..3, and the whole dense corpus)

The control got its third arm: `narrative_rerank_max_rise = 12`, three runs of the dense fixture, same fixture and
same instrument as the two arms above. The bound was set for the run and read back from its captures:
`max_rise` reaches exactly 12 in two of the three runs, so it was binding there, and never exceeds it.

**Its benefit does not reproduce.** The opening instruction row, quoted per probe, over every run this log has:

| arm | probes | ... quoting `raw_2` | `raw_2` sections |
| --- | --- | --- | --- |
| rerank off (`path2-shiyuan`) | 13 | 6 (46%) | 6 of 65 |
| rise <= 4 (`path2-shiyuan`) | 14 | 1 (7%) | 1 of 70 |
| unbounded (`path2-shiyuan`) | 13 | 0 | 0 of 65 |
| rise = 4 (dense) | 66 | 24 (36%) | 24 of 330 |
| rise = 12 (dense) | 21 | 5 (24%) | 5 of 105 |
| unbounded (dense) | 33 | 6 (18%) | 6 of 165 |

The rerank stage as a whole is what clears that row out - 46% of probes without it against 0-36% with it - and
**inside** the stage the bound makes it worse, not better, on both fixtures. The mechanism is not mysterious: a
bounded rise fills the head from the fusion's own leaders, and the fusion's leader is often the user's own
instruction, which is lexically close to the query, while the cross-encoder - the component measured to raise
answer-in-context from 69% to 87% - prefers the rows that read like the story.

**Its cost is structural and measured.** The block holds five entries, so a candidate the fusion placed at
position `maxRise + 5` or later cannot enter it whatever the provider scores it; the replay above attributed 6 of
16 failed probes to the bound, two of them cases where the provider's **highest-scoring** document was the
one held out. Per probed detail, over the dense corpus:

| detail | rise = 4 | rise = 12 | unbounded |
| --- | --- | --- | --- |
| d-manner | 3 of 6 | 3 of 3 | 2 of 2 |
| d-hollow | 1 of 7 | 1 of 3 | 1 of 4 |
| d-polish | 7 of 8 | 1 of 1 | 3 of 3 |
| d-voice | 0 of 5 | 1 of 1 | 0 of 1 |
| d-jar | 0 of 2 | - | 1 of 1 |
| d-free | 0 of 1 | - | 1 of 1 |
| d-reed | 1 of 2 | - | 2 of 2 |
| d-belt | 0 of 2 | - | 1 of 3 |
| total | 15 of 42 | 10 of 12 | 15 of 21 |

The one place the bound looks good is the row that lives in the opening instruction: `d-polish` is declared in
floor 1's instruction and `raw_2` is the carrier the bound keeps in the head. That is the trade in one
line - it buys back early details by giving up later ones, and the later ones are what retrieval is for.

The arm-level recovery is the noisy part and is written down as such: at rise = 4 the dense batches came out 6 of
12 (`ret4-b2`, `b3`) and 3 of 21 (`attr-1..3`) on the same setting, so no single arm's rate is a
finding. What is not noisy is the direction of the two rulers above, and both point the same way.

**The shipped default is `maxRise = Infinity` again** - the stage as it was first shipped, and what the offline
experiments in this log were measured with. `narrative_rerank_max_rise` still sets a bound for a measurement,
`rerankHead`'s parameter and `rerank_cost.max_rise` stay, so the next question about this stage can be asked
without re-shipping the bound.

