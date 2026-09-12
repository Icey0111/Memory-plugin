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
5. **Measure the pipeline end to end on a long chat**: tokens per turn (resident summary, quoted
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
3. **Re-measure the archive on a long chat before giving it a growth policy.** The first measurement
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
| The replayable fact set left the chat file, measured at 53-188 KB per chat | ADR-0004, test-v55-derived-store.mjs |
| Lexical recall over original text has a committed baseline | recall-baseline.mjs, ADR-0004 |
| Continuity anchors survive an arbitrary number of summary rewrites | ADR-0005, test-narrative-pipeline.mjs |
| The two quiet failures (repeated failure, unsummarized tail) are counted and announced | ADR-0005, test-narrative-pipeline.mjs |
| Evidence packing merges, shares and trims; oblique recall 17% -> 67% | ADR-0006, test-narrative-pipeline.mjs |

### Next, in order

1. **Excise the legacy generation path from index.js.** It is unreachable while the narrative
   pipeline is on, but it is still the largest file in the repository and still imports the context
   assembler, the spine, the certificate and the cold-snapshot cache. The host adapters must survive
   the surgery; `createNarrativeHostServices` is already the seam.
2. **Grow the paraphrase set, then decide about dense retrieval.** The packer, not the ranking channel,
   was the bottleneck: oblique recall went from 17% to 67% by fixing packing alone, and the residual
   ranking miss rate is 1 of 6 on a six-question sample (ADR-0006). Six questions decide nothing; write
   50+ and re-run before spending a backend, an index and a rebuild lifecycle on partial credit.
   925 tokens per query (ADR-0004), measured with the needle in its own sentence. What is still
   unmeasured is the oblique question, which is the case dense retrieval exists for: build a paraphrase
   set, measure the lexical floor on it, and only then decide whether an embedding backend is worth its
   cost. Do not add reranking before that number exists.
   an embedding backend is configured, and nothing has measured whether dense recall actually
   improves evidence selection over the lexical baseline. Measure before adding reranking.
3. **Re-measure the archive on a long chat before giving it a growth policy.** The first measurement
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
| Lexical-only recall on Chinese dialogue | Measured: 93-100% in-words, 100% entity, 67% oblique after the packing fix (ADR-0006). The oblique sample is six questions, which is the open weakness |
| The unsummarized tail | If the summary job keeps failing, the prompt grows until the host trims it, and only the diagnostic says so |

### Explicitly not planned

- No model training or fine-tuning.
- No external memory service or server-side database.
- No function calling from inside the story: the model reads and writes text, the host parses it.
- No revival of the layered summary stack without a superseding ADR.
