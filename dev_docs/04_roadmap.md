# Roadmap

<!-- Versioned & append-only: never edit past versions; newest is last. -->

<!-- VERSION 1 -->
## v1 - 2026-09-12 18:11:03 - what shipped, what is next, and what is explicitly not planned

### Shipped (2026-09-12, branch codex/narrative-raw-retrieval)

| Item | Evidence |
| --- | --- |
| One generation entry, replacing four layered installs | index-v55.js, test-extension-frontend-contract.mjs |
| The original text is archived with versions, chunked and indexed | raw-history.js, test-narrative-pipeline.mjs |
| One continuity summary every N floors, bounded and validated | narrative-runtime.js, test-narrative-pipeline.mjs |
| A floor is hidden only while the summary covers all of it | test-narrative-pipeline.mjs, test-narrative-bootstrap-lifecycle.mjs |
| Evidence quoting cites the original span and skips what the prompt still shows | packRawEvidence, test-narrative-pipeline.mjs |
| The layered summary/consistency/provenance stack is retired | ADR-0002, remove/ |
| The syntax gate is a discovered file list, not a hand-maintained one | check-syntax.mjs |

### Next, in order

1. **Excise the legacy generation path from index.js.** It is unreachable while the narrative
   pipeline is on, but it is still the largest file in the repository and still imports the context
   assembler, the spine, the certificate and the cold-snapshot cache. The host adapters must survive
   the surgery; `createNarrativeHostServices` is already the seam.
2. **Verify dense retrieval over original text on a real chat.** The pipeline is lexical-only until
   an embedding backend is configured, and nothing has measured whether dense recall actually
   improves evidence selection over the lexical baseline. Measure before adding reranking.
3. **Give the archive a growth policy.** `raw_history.records` keeps every superseded version
   forever. Either bound the retained versions per message, or state the cost and leave it; do not
   prune text without a measurement.
4. **Decide the knowledge-boundary story.** Text-only boundaries are the current answer. If
   per-character knowledge matters, it needs its own design; the retired filter is not a drop-in.
4. **Measure the pipeline end to end on a long chat**: tokens per turn (resident summary, quoted
   evidence, unsummarized tail), summary quality after N regenerations, and evidence precision.

### Open risks

| Risk | Why it is still open |
| --- | --- |
| Summary drift over many regenerations | Each pass rewrites the previous summary; nothing yet checks that an old detail survives ten rewrites |
| Chat file size | The archive duplicates the transcript in chat metadata (ADR-0003) |
| Lexical-only recall on Chinese dialogue | The tokenizer is the floor; its recall on real questions is unmeasured |
| The unsummarized tail | If the summary job keeps failing, the prompt grows until the host trims it, and only the diagnostic says so |

### Explicitly not planned

- No model training or fine-tuning.
- No external memory service or server-side database.
- No function calling from inside the story: the model reads and writes text, the host parses it.
- No revival of the layered summary stack without a superseding ADR.

<!-- VERSION 2 -->
## v2 - 2026-09-12 18:37:24 - replace two unmeasured roadmap items with their measured result


### Shipped (2026-09-12, branch codex/narrative-raw-retrieval)

| Item | Evidence |
| --- | --- |
| One generation entry, replacing four layered installs | index-v55.js, test-extension-frontend-contract.mjs |
| The original text is archived with versions, chunked and indexed | raw-history.js, test-narrative-pipeline.mjs |
| One continuity summary every N floors, bounded and validated | narrative-runtime.js, test-narrative-pipeline.mjs |
| A floor is hidden only while the summary covers all of it | test-narrative-pipeline.mjs, test-narrative-bootstrap-lifecycle.mjs |
| Evidence quoting cites the original span and skips what the prompt still shows | packRawEvidence, test-narrative-pipeline.mjs |
| The layered summary/consistency/provenance stack is retired | ADR-0002, remove/ |
| The syntax gate is a discovered file list, not a hand-maintained one | check-syntax.mjs |
| The replayable fact set left the chat file, measured at 53-188 KB per chat | ADR-0004, test-v55-derived-store.mjs |
| Lexical recall over original text has a committed baseline | recall-baseline.mjs, ADR-0004 |

### Next, in order

1. **Excise the legacy generation path from index.js.** It is unreachable while the narrative
   pipeline is on, but it is still the largest file in the repository and still imports the context
   assembler, the spine, the certificate and the cold-snapshot cache. The host adapters must survive
   the surgery; `createNarrativeHostServices` is already the seam.
2. **Make dense retrieval earn its place.** Lexical-only recall is 88-100% at median rank 0 for about
   925 tokens per query (ADR-0004), measured with the needle in its own sentence. What is still
   unmeasured is the oblique question, which is the case dense retrieval exists for: build a paraphrase
   set, measure the lexical floor on it, and only then decide whether an embedding backend is worth its
   cost. Do not add reranking before that number exists.
   an embedding backend is configured, and nothing has measured whether dense recall actually
   improves evidence selection over the lexical baseline. Measure before adding reranking.
2. **Re-measure the archive on a long chat before giving it a growth policy.** The first measurement
   says the archive costs one copy of the conversation text (41-351 KB, 4-33% of the file) and is not the
   biggest cost in the file; the retired fact set was, and it has moved out (ADR-0004). Bound the
   archive only if a long chat shows it dominating; do not prune text without that measurement.
   forever. Either bound the retained versions per message, or state the cost and leave it; do not
   prune text without a measurement.
4. **Decide the knowledge-boundary story.** Text-only boundaries are the current answer. If
   per-character knowledge matters, it needs its own design; the retired filter is not a drop-in.
5. **Measure the pipeline end to end on a long chat**: tokens per turn (resident summary, quoted
   evidence, unsummarized tail), summary quality after N regenerations, and evidence precision.

### Open risks

| Risk | Why it is still open |
| --- | --- |
| Summary drift over many regenerations | Each pass rewrites the previous summary; nothing yet checks that an old detail survives ten rewrites |
| Chat file size | Measured: the archive adds about one copy of the text (4-33% of the file). The retired fact set, which was 18-53%, now lives in the derived record (ADR-0004) |
| Lexical-only recall on Chinese dialogue | The tokenizer is the floor; its recall on real questions is unmeasured |
| The unsummarized tail | If the summary job keeps failing, the prompt grows until the host trims it, and only the diagnostic says so |

### Explicitly not planned

- No model training or fine-tuning.
- No external memory service or server-side database.
- No function calling from inside the story: the model reads and writes text, the host parses it.
- No revival of the layered summary stack without a superseding ADR.

<!-- VERSION 3 -->
## v3 - 2026-09-12 18:49:43 - record the anchors, the guards, and the retrieval decision the paraphrase set produced



### Shipped (2026-09-12, branch codex/narrative-raw-retrieval)

| Item | Evidence |
| --- | --- |
| One generation entry, replacing four layered installs | index-v55.js, test-extension-frontend-contract.mjs |
| The original text is archived with versions, chunked and indexed | raw-history.js, test-narrative-pipeline.mjs |
| One continuity summary every N floors, bounded and validated | narrative-runtime.js, test-narrative-pipeline.mjs |
| A floor is hidden only while the summary covers all of it | test-narrative-pipeline.mjs, test-narrative-bootstrap-lifecycle.mjs |
| Evidence quoting cites the original span and skips what the prompt still shows | packRawEvidence, test-narrative-pipeline.mjs |
| The layered summary/consistency/provenance stack is retired | ADR-0002, remove/ |
| The syntax gate is a discovered file list, not a hand-maintained one | check-syntax.mjs |
| The legacy generation runtime and the fact subsystem are retired | ADR-0007, ADR-0009 |
| Knowledge boundaries are an explicit, injected section of the summary | ADR-0008, test-narrative-pipeline.mjs |
| The replayable fact set left the chat file, measured at 53-188 KB per chat | ADR-0004, test-v55-derived-store.mjs |
| Lexical recall over original text has a committed baseline | recall-baseline.mjs, ADR-0004 |
| Continuity anchors survive an arbitrary number of summary rewrites | ADR-0005, test-narrative-pipeline.mjs |
| The two quiet failures (repeated failure, unsummarized tail) are counted and announced | ADR-0005, test-narrative-pipeline.mjs |
| Evidence packing merges, shares and trims; oblique recall 17% -> 67% | ADR-0006, test-narrative-pipeline.mjs |

### Next, in order

The four items this roadmap carried are closed. The paraphrase set was grown from 6 countable
questions to 12 and the retrieval decision made (ADR-0010); the archive rate was measured and the
growth policy is "no pruning, because superseded versions measured zero" (ADR-0011); the end-to-end
questions were answered offline - the resident block stays inside its budget across ten rewrites, and
evidence precision is a measured 15% (ADR-0010) - and the boundary question is decided as a record
rather than a filter (ADR-0012).

What is left needs a live model, and it is the owner’s to run:

1. **A dense A/B with a configured backend.** The two channels are reported separately now, so this is
   a before/after on the same question set rather than a judgement call.
2. **A drift run against the real summarizer**: ten rewrites on a long chat, checking the same anchors
   and boundaries the offline experiment checks with a stub summarizer.
3. **Re-run the ruler once a story passes a few hundred floors.** The per-floor rates are in its output,
   and the assumption they carry - superseded versions stay negligible - is stated in ADR-0011.

### Open risks

| Risk | State |
| --- | --- |
| Summary drift over many regenerations | Bounded offline: anchors and boundaries survive ten lossy rewrites (ADR-0005, ADR-0012). A run against the real summarizer is outstanding |
| Chat file size | Closed by measurement: the archive costs 3.8 KB per floor and superseded versions measured zero, so nothing is pruned (ADR-0011) |
| Lexical-only recall on oblique questions | Measured at 45% with 15% span precision; the dense channel already exists and is the answer (ADR-0010) |
| The unsummarized tail | Guarded: counted, thresholded and announced (ADR-0005) |
| Evidence precision | 15% of quoted spans carry the answer. The share is a proxy, but it is low enough to be worth re-measuring after the dense A/B |
### Explicitly not planned

- No model training or fine-tuning.
- No external memory service or server-side database.
- No function calling from inside the story: the model reads and writes text, the host parses it.
- No revival of the layered summary stack without a superseding ADR.

<!-- VERSION 4 -->
## v4 - 2026-09-12 20:32:10 - record the measured retrieval layers and what they leave open




### Shipped (2026-09-12, branch codex/narrative-raw-retrieval)

| Item | Evidence |
| --- | --- |
| One generation entry, replacing four layered installs | index-v55.js, test-extension-frontend-contract.mjs |
| The original text is archived with versions, chunked and indexed | raw-history.js, test-narrative-pipeline.mjs |
| One continuity summary every N floors, bounded and validated | narrative-runtime.js, test-narrative-pipeline.mjs |
| A floor is hidden only while the summary covers all of it | test-narrative-pipeline.mjs, test-narrative-bootstrap-lifecycle.mjs |
| Evidence quoting cites the original span and skips what the prompt still shows | packRawEvidence, test-narrative-pipeline.mjs |
| The layered summary/consistency/provenance stack is retired | ADR-0002, remove/ |
| The syntax gate is a discovered file list, not a hand-maintained one | check-syntax.mjs |
| The legacy generation runtime and the fact subsystem are retired | ADR-0007, ADR-0009 |
| Knowledge boundaries are an explicit, injected section of the summary | ADR-0008, test-narrative-pipeline.mjs |
| The replayable fact set left the chat file, measured at 53-188 KB per chat | ADR-0004, test-v55-derived-store.mjs |
| Lexical recall over original text has a committed baseline | recall-baseline.mjs, ADR-0004 |
| The ruler reports per-channel entropy and margin, the drop rule and the carrying slot, and compares two runs as paired questions | recall-baseline.mjs |
| The lexical score is BM25: recall is unchanged and the probe set costs 18% fewer evidence tokens | raw-history.js, test-narrative-pipeline.mjs |
| Budgeted submodular packing is implemented and measured; it loses the A/B, so it is not the default | dev_docs/06_retrieval_research.md, test-narrative-pipeline.mjs |
| Continuity anchors survive an arbitrary number of summary rewrites | ADR-0005, test-narrative-pipeline.mjs |
| The two quiet failures (repeated failure, unsummarized tail) are counted and announced | ADR-0005, test-narrative-pipeline.mjs |
| Evidence packing merges, shares and trims; oblique recall 17% -> 67% | ADR-0006, test-narrative-pipeline.mjs |

### Next, in order

The four items this roadmap carried are closed. The paraphrase set was grown from 6 countable
questions to 12 and the retrieval decision made (ADR-0010); the archive rate was measured and the
growth policy is "no pruning, because superseded versions measured zero" (ADR-0011); the end-to-end
questions were answered offline - the resident block stays inside its budget across ten rewrites, and
evidence precision is a measured 15% (ADR-0010) - and the boundary question is decided as a record
rather than a filter (ADR-0012).

What is left needs a live model, and it is the owner’s to run:

1. **The entropy and margin layer needs a second channel.** Layer 1 measured recall-neutral and layer 3 lost
   its A/B; layer 2 fuses channels by their margin, so it waits on a configured backend. Both channels are
   reported separately, so it is a before/after on the same question set rather than a judgement call.
2. **A drift run against the real summarizer**: ten rewrites on a long chat, checking the same anchors
   and boundaries the offline experiment checks with a stub summarizer.
3. **Re-run the ruler once a story passes a few hundred floors.** The per-floor rates are in its output,
   and the assumption they carry - superseded versions stay negligible - is stated in ADR-0011.

### Open risks

| Risk | State |
| --- | --- |
| Summary drift over many regenerations | Bounded offline: anchors and boundaries survive ten lossy rewrites (ADR-0005, ADR-0012). A run against the real summarizer is outstanding |
| Chat file size | Closed by measurement: the archive costs 3.8 KB per floor and superseded versions measured zero, so nothing is pruned (ADR-0011) |
| Lexical-only recall on oblique questions | Measured at 49-60% with 15-16% span precision on a rebuilt 52-question set (dev_docs/06_retrieval_research.md v2). The older 45% is not comparable: the denominator changed with the needle rule |
| The unsummarized tail | Guarded: counted, thresholded and announced (ADR-0005) |
| Evidence precision | 15% of quoted spans carry the answer. The share is a proxy, but it is low enough to be worth re-measuring after the dense A/B |
### Explicitly not planned

- No model training or fine-tuning.
- No external memory service or server-side database.
- No function calling from inside the story: the model reads and writes text, the host parses it.
- No revival of the layered summary stack without a superseding ADR.

<!-- VERSION 5 -->
## v5 - 2026-09-12 21:05:40 - record the budget frontier and the slot count it decided





### Shipped (2026-09-12, branch codex/narrative-raw-retrieval)

| Item | Evidence |
| --- | --- |
| One generation entry, replacing four layered installs | index-v55.js, test-extension-frontend-contract.mjs |
| The original text is archived with versions, chunked and indexed | raw-history.js, test-narrative-pipeline.mjs |
| One continuity summary every N floors, bounded and validated | narrative-runtime.js, test-narrative-pipeline.mjs |
| A floor is hidden only while the summary covers all of it | test-narrative-pipeline.mjs, test-narrative-bootstrap-lifecycle.mjs |
| Evidence quoting cites the original span and skips what the prompt still shows | packRawEvidence, test-narrative-pipeline.mjs |
| The layered summary/consistency/provenance stack is retired | ADR-0002, remove/ |
| The syntax gate is a discovered file list, not a hand-maintained one | check-syntax.mjs |
| The legacy generation runtime and the fact subsystem are retired | ADR-0007, ADR-0009 |
| Knowledge boundaries are an explicit, injected section of the summary | ADR-0008, test-narrative-pipeline.mjs |
| The replayable fact set left the chat file, measured at 53-188 KB per chat | ADR-0004, test-v55-derived-store.mjs |
| Lexical recall over original text has a committed baseline | recall-baseline.mjs, ADR-0004 |
| The ruler reports per-channel entropy and margin, the drop rule and the carrying slot, and compares two runs as paired questions | recall-baseline.mjs |
| The lexical score is BM25: recall is unchanged and the probe set costs 18% fewer evidence tokens | raw-history.js, test-narrative-pipeline.mjs |
| Budgeted submodular packing is implemented and measured; it loses the A/B, so it is not the default | dev_docs/06_retrieval_research.md, test-narrative-pipeline.mjs |
| The evidence slot count derives from the evidence budget, one slot per 400 tokens (ADR-0014) | raw-history.js, test-narrative-pipeline.mjs |
| Continuity anchors survive an arbitrary number of summary rewrites | ADR-0005, test-narrative-pipeline.mjs |
| The two quiet failures (repeated failure, unsummarized tail) are counted and announced | ADR-0005, test-narrative-pipeline.mjs |
| Evidence packing merges, shares and trims; oblique recall 17% -> 67% | ADR-0006, test-narrative-pipeline.mjs |

### Next, in order

The four items this roadmap carried are closed. The paraphrase set was grown from 6 countable
questions to 12 and the retrieval decision made (ADR-0010); the archive rate was measured and the
growth policy is "no pruning, because superseded versions measured zero" (ADR-0011); the end-to-end
questions were answered offline - the resident block stays inside its budget across ten rewrites, and
evidence precision is a measured 15% (ADR-0010) - and the boundary question is decided as a record
rather than a filter (ADR-0012).

What is left needs a live model, and it is the owner’s to run:

1. **The entropy and margin layer needs a second channel.** Layer 1 measured recall-neutral and layer 3 lost
   its A/B; layer 2 fuses channels by their margin, so it waits on a configured backend. Both channels are
   reported separately, so it is a before/after on the same question set rather than a judgement call.
2. **A drift run against the real summarizer**: ten rewrites on a long chat, checking the same anchors
   and boundaries the offline experiment checks with a stub summarizer.
3. **Re-run the ruler once a story passes a few hundred floors.** The per-floor rates are in its output,
   and the assumption they carry - superseded versions stay negligible - is stated in ADR-0011.

### Open risks

| Risk | State |
| --- | --- |
| Summary drift over many regenerations | Bounded offline: anchors and boundaries survive ten lossy rewrites (ADR-0005, ADR-0012). A run against the real summarizer is outstanding |
| Chat file size | Closed by measurement: the archive costs 3.8 KB per floor and superseded versions measured zero, so nothing is pruned (ADR-0011) |
| Lexical-only recall on oblique questions | Measured at 49-60% with 15-16% span precision on a rebuilt 52-question set (dev_docs/06_retrieval_research.md v2). The older 45% is not comparable: the denominator changed with the needle rule |
| The unsummarized tail | Guarded: counted, thresholded and announced (ADR-0005) |
| Evidence precision | Measured at 32% of quoted spans at the shipped two slots, falling to 13% at six (ADR-0014). It rises when fewer, larger spans are quoted, so it is a proxy for signal-to-noise rather than for recall |
### Explicitly not planned

- No model training or fine-tuning.
- No external memory service or server-side database.
- No function calling from inside the story: the model reads and writes text, the host parses it.
- No revival of the layered summary stack without a superseding ADR.

<!-- VERSION 6 -->
## v6 - 2026-09-12 21:18:58 - record the dense A/B and the fusion weight it decided






### Shipped (2026-09-12, branch codex/narrative-raw-retrieval)

| Item | Evidence |
| --- | --- |
| One generation entry, replacing four layered installs | index-v55.js, test-extension-frontend-contract.mjs |
| The original text is archived with versions, chunked and indexed | raw-history.js, test-narrative-pipeline.mjs |
| One continuity summary every N floors, bounded and validated | narrative-runtime.js, test-narrative-pipeline.mjs |
| A floor is hidden only while the summary covers all of it | test-narrative-pipeline.mjs, test-narrative-bootstrap-lifecycle.mjs |
| Evidence quoting cites the original span and skips what the prompt still shows | packRawEvidence, test-narrative-pipeline.mjs |
| The layered summary/consistency/provenance stack is retired | ADR-0002, remove/ |
| The syntax gate is a discovered file list, not a hand-maintained one | check-syntax.mjs |
| The legacy generation runtime and the fact subsystem are retired | ADR-0007, ADR-0009 |
| Knowledge boundaries are an explicit, injected section of the summary | ADR-0008, test-narrative-pipeline.mjs |
| The replayable fact set left the chat file, measured at 53-188 KB per chat | ADR-0004, test-v55-derived-store.mjs |
| Lexical recall over original text has a committed baseline | recall-baseline.mjs, ADR-0004 |
| The ruler reports per-channel entropy and margin, the drop rule and the carrying slot, and compares two runs as paired questions | recall-baseline.mjs |
| The lexical score is BM25: recall is unchanged and the probe set costs 18% fewer evidence tokens | raw-history.js, test-narrative-pipeline.mjs |
| Budgeted submodular packing is implemented and measured; it loses the A/B, so it is not the default | dev_docs/06_retrieval_research.md, test-narrative-pipeline.mjs |
| The evidence slot count derives from the evidence budget, one slot per 400 tokens (ADR-0014) | raw-history.js, test-narrative-pipeline.mjs |
| The dense A/B ran offline on the configured backend; the dense channel gets a weak vote (ADR-0015) | raw-history.js, recall-embed.mjs, dev_docs/06_retrieval_research.md |
| Answer-in-context on the 52-question set went from 56% to 69% at 4% fewer evidence tokens | ADR-0015 |
| Continuity anchors survive an arbitrary number of summary rewrites | ADR-0005, test-narrative-pipeline.mjs |
| The two quiet failures (repeated failure, unsummarized tail) are counted and announced | ADR-0005, test-narrative-pipeline.mjs |
| Evidence packing merges, shares and trims; oblique recall 17% -> 67% | ADR-0006, test-narrative-pipeline.mjs |

### Next, in order

The four items this roadmap carried are closed. The paraphrase set was grown from 6 countable
questions to 12 and the retrieval decision made (ADR-0010); the archive rate was measured and the
growth policy is "no pruning, because superseded versions measured zero" (ADR-0011); the end-to-end
questions were answered offline - the resident block stays inside its budget across ten rewrites, and
evidence precision was a measured 15% at the time (ADR-0010) - and the boundary question is decided as a
record
rather than a filter (ADR-0012).

What is left needs a live model, and it is the owner’s to run:

1. **The remaining 12 losses, which are a ranking question.** They are candidates at every budget and never
   rank into the selected slots. The dense half of layer 2 is measured and shipped (ADR-0015); whether these
   twelve need the ranker, the fusion or layer 5 is the next measurement.
2. **A drift run against the real summarizer**: ten rewrites on a long chat, checking the same anchors
   and boundaries the offline experiment checks with a stub summarizer.
3. **Re-run the ruler once a story passes a few hundred floors.** The per-floor rates are in its output,
   and the assumption they carry - superseded versions stay negligible - is stated in ADR-0011.

### Open risks

| Risk | State |
| --- | --- |
| Summary drift over many regenerations | Bounded offline: anchors and boundaries survive ten lossy rewrites (ADR-0005, ADR-0012). A run against the real summarizer is outstanding |
| Chat file size | Closed by measurement: the archive costs 3.8 KB per floor and superseded versions measured zero, so nothing is pruned (ADR-0011) |
| Oblique recall | 69% with 23% span precision on the 52-question set, after the dense channel was weighted correctly (ADR-0015). The lexical channel alone is 58-60%, so the residual is the lexical gap this measurement identified |
| The unsummarized tail | Guarded: counted, thresholded and announced (ADR-0005) |
| Evidence precision | 23% of quoted spans at the shipped three slots with the corrected fusion (ADR-0015); 13% at six slots, 32% at two. It rises when fewer, larger spans are quoted, so it is a proxy for signal-to-noise rather than for recall |
### Explicitly not planned

- No model training or fine-tuning.
- No external memory service or server-side database.
- No function calling from inside the story: the model reads and writes text, the host parses it.
- No revival of the layered summary stack without a superseding ADR.
