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
