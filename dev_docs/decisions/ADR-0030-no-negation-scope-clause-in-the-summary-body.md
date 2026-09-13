# ADR-0030: The summary body does not get a negation-scope clause, and the long-chat result is a floor, not a clearance

- Status: accepted
- Date: 2026-09-13
- Relates to: ADR-0023, ADR-0024, ADR-0025, ADR-0028, ADR-0029

## Problem

The long-chat acceptance run left one live defect. In the batch-4 answer the summary body listed a real place
among the seed-added items - '`抄本、钥匙、黑石滩与“我们”均系种子新增`' - while the anchor and the knowledge
boundary written by the same answer said the place was real ('`黑石滩是真的`'). The host checks references,
structure and budget, not whether a body sentence is entailed by the same answer's ledger, so both readings
were injected together. The question was whether this is a prompt defect worth a targeted clause.

The framing that made it testable: the denied proposition is the agreement and the departure plan, not the
place. '`地点真实存在`' and '`我们约好去那里是虚构经历`' can both be true, and the body compressed the second
into the first. `b4-verification.md` in the ignored acceptance directory separates the four cited floors into
place existence, who went, whether the departure was agreed, and what is only the character's judgement.

## Decision

- The instruction prefix keeps its 1,018 characters. The clause
  '`否定或怀疑某段经历时，保留被否定的完整命题与判断者，不将其扩大为相关人物、地点或物品不存在。`' is **not**
  added.
- A summary body that contradicts the anchors of the same answer stays a recorded, low-frequency risk. It is not
  repaired by prompt text, by a second reviewer model, by automatic semantic merging, or by a new refusal rule.
- The experiment is the evidence for the rejection, and it is reproducible: `build-spec.mjs` and `run-negation.mjs`
  in the ignored acceptance directory freeze and replay the three materials.
- The reusable acceptance runner is versioned: `acceptance-longchat.mjs` with `acceptance-capture.js`. Chat text,
  raw model responses and credentials stay outside the repository; the loader refuses an `--out` inside it.

## Evidence

Three materials x two prefixes x three runs, 18 calls, all responses saved, annotations frozen before the
first call (`spec.sha256` `a040bbe5…`). M1 is the verbatim B4 long-chat request; M2 is a held-out variant with a
different place name and reworded real-place testimony; M3 rewrites the two floors that assert the place so the
character denies the place itself.

- On M1 and M2 both prefixes kept the place real in all six replays each. The added clause changed none of the
  real-place outcomes, so there was nothing for it to fix.
- The B4 body-level compression did not reproduce. The identical frozen prompt, replayed three times,
  scoped the denial to the agreement every time. The original failure was selected after the fact - it is the
  case that prompted the probe - so it must not be pooled with the replays as an error rate. The accurate
  statement is: one failure was observed once, three frozen replays afterwards did not reproduce it, and
  neither the cause nor the rate is known.
- On M3 the clause changed the failure mode without removing it. The old prefix once wrote in the body that the
  denied place was real while its own ledger said the opposite; the new prefix once produced both readings in
  one answer. This is the uniform-'preserve everything' risk the clause was meant to avoid.
- No refusal and no parse error in any of the 18 calls.

## Alternatives

- Add the clause and keep it if it does not regress. Rejected by the measurement: no gain on the real-place
  material and a new internal contradiction on the denied-place material.
- A general consistency checker between the body and the anchors. Deferred, not adopted. Reference checking
  cannot decide entailment, and a semantic checker is a different feature with its own acceptance; the observed
  defect is narrow enough to record first.
- A second model to review the summary. Out of scope; it doubles the cost of every batch to police a
  low-frequency body compression.
- Relaxing the parser or the budget to absorb the case. Unrelated to the defect.

## Validation

- `node test-anchor-repair.mjs` pins the two prompt openers the acceptance harness keys on: the summary request
  keeps '`你是剧情续接摘要器`' and the repair request keeps '`你上一轮答案的`'. The repair is not a summary and
  never carried the summary marker, which is how the 421757c long-chat run lost its raw request. That test only
  protects the openers.
- `node test-acceptance-capture.mjs` is what proves the runner actually captures: it drives the versioned
  boundary with a simulated transport and asserts that the summary call and the repair call both record request,
  response and elapsed time, that the story prompt is counted but never captured, and that two consecutive turns
  keep separate injected blocks.
- The long-chat result is recorded in `04_roadmap.md` at the strength the run supports: four batches ended
  committed, hidden original floors were recalled, and the run is not evidence that the system is free of
  structural problems or that plot continuation is reliable, because the character overrode the staged script
  and one body contradicted its own ledger.
