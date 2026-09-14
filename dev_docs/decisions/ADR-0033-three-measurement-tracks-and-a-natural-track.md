# ADR-0033: Three measurement tracks, and a natural query for the ruler

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

The retrieval ruler (`recall-baseline.mjs`) has measured with questions this project wrote. The default
probe set cuts a needle out of an answer and asks the sentence back; `--paraphrases` writes a question
against a literal chosen from the original. Both answer a mechanism question, and neither is product
evidence: a user does not type the probe.

An external gold-eval contract names the failure directly - a question passed in as the query is exactly
the kind it forbids from deciding a shipping policy. A one-off natural run had to be written outside the
ruler, so its result could not be reproduced by the next person.

## Decision

Name three tracks and keep them separate in naming and output.

1. **Synthetic probe** - default. The query is cut from the answer; it measures mechanism and budget
   pressure. Not product evidence.
2. **Source-first labelled** - `--paraphrases`. An authored question against a literal chosen from the
   original before the run; it measures answer-in-context.
3. **Natural capture** - `--natural`. The query is the real user message, planned by
   `planRetrievalQuery` with the shipped default strategy. It is the only product evidence.

The natural track lives in `natural-track.mjs`, reuses the ruler's scorer and packer, and counts three
targets derived from the prefix history rather than from an author: the rare situation terms
(`entityRecall`), the asked thing (`askedThingRecall`) and the named characters' descriptions
(`profileRecall`). It folds synthetic batches at the configured cadence, keeps the newest complete pair
visible exactly as `retrieval-audit.mjs` does, and never feeds a summary to an earlier turn. A natural run
declares its real queries and prefix chunks as cassette inputs, so a dense natural measurement is
replayed and invalidated the same way a probe one is.

## Consequences

- Every printed number is attributable to a track; the run banner and each line name it.
- A policy change is decided on natural-capture evidence, with the synthetic tracks for mechanism and the
  source-first set for answer-in-context.
- The natural track measures lexical, situation and profile recall, not generated-answer correctness and
  not narrative continuity. Its targets are derived from the system's own tokenizer, so they are proxies,
  not answer labels.
- No live natural run is recorded on this branch. This ADR fixes the instrument, not a result.
