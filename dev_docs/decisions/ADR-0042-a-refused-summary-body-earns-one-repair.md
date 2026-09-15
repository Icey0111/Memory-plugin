# ADR-0042: A refused summary body earns one repair, and the ceiling is stated

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

Three recorded acceptance runs had a summary batch that never committed, at three different stages:

- `input_budget`: the request did not fit the configured character budget, so nothing was sent (ADR-0024
  records that as a block, not a failure).
- `over_budget`: the body overran a hard ceiling **the model had never been told about** - the instruction
  named the soft target and not the ceiling or its consequence.
- `format`: the answer carried the anchor sections and no body the parser could find.

The one-targeted-repair mechanism existed only for an anchor section that failed validation. A body refusal
therefore waited for a later batch to cover the same floors again - which never happens if the story stops - and
the floors stay unfolded in the meantime.

## Decision

1. The summary request states the hard ceiling and what happens past it: `正文超过 N token 会被整批退回，本轮不
   提交。` The target alone read as advice; the consequence is what the model can act on.
2. A `format` or `over_budget` refusal earns **one** body repair: the same request again, a correction naming
   what was refused, and the refused text itself (bounded to 1,600 characters) so an oversized body can be cut
   rather than written from nothing. It is not a retry loop.
3. The repair is recorded as `body_repair` - never as `anchor_repair`, because a reader chasing which stage
   was refused must not be sent to the anchor section - with its own prompt and completion cost, checked against
   the input budget before it is sent, and subject to the same frozen-state check as the first answer.
4. The second answer is evaluated exactly like the first: body present, ceiling, section shape, and every anchor
   reference re-checked against the frozen request. A repair cannot commit through a weaker path than the
   answer it replaces, and a repair that is still wrong leaves the batch as refused as it was, with
   `stage_after` and `reason_after` recorded.
5. A repair that commits is marked `recovered: true`. This applies to the anchor repair too, which previously
   kept `recovered: false` even when it was the reason the batch committed.

## Consequences

- **Live, forced** (target and ceiling both 100 tokens on a ten-turn batch, so the material is far too dense to
  fit): the path fired. Two summary calls, the second carrying `（补交）` and the ceiling; the repaired answer was
  172 tokens against a 100-token ceiling, so the batch stayed refused with `body_repair.recovered: false`,
  `stage_after: over_budget` and `summary_failures: 1`. The repair's own cost is recorded (6,684 prompt tokens,
  636 completion). The mechanism is exercised; whether it saves a batch depends on a ceiling the material can
  meet.
- Offline, both stages commit: a first answer with no body and a first answer over the ceiling each commit from
  one repair, with the record marked recovered (`test-anchor-repair.mjs` 4b, 4c).
- The first forcing attempt (target 200, ceiling 300) needed no repair at all - the model obeyed the stated
  ceiling on its first answer. One run is not evidence that the sentence prevents over_budget; it is evidence
  that stating it cost nothing.
- `input_budget` is unchanged and is not repaired: nothing was sent, and re-checking the same frozen batch with
  the same budget is the same event. Raising that budget is a separate, configured decision (ADR-0024).
- A repair is one extra model call on a path that previously lost the merge. It is bounded, costed apart and
  recorded, so the price of a refusal stays visible.
