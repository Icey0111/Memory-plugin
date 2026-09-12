# ADR-0013: The background summary must budget for reasoning

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

The first live acceptance run on this host (20 user turns, 40 floors) produced no summary at all. The
diagnostics said only "No message generated", and the same host setting produced empty assistant
replies on some turns.

The host's completion endpoint is a reasoning model. The log for one background summary call:

    finish_reason: "length"
    message.content: ""                    (empty)
    message.reasoning_content: 6,138 chars
    usage.completion_tokens: 6,569 of which reasoning_tokens: 5,798

The plugin asked for `summary_max_tokens` (2,048 by default, 4,096 in that install). The model spent
every token of the budget on reasoning and had none left for the answer, so the call "succeeded" with an
empty body, the summary never formed, and nothing in the prompt said why.

## Decision

1. **Budget the quiet call for reasoning, not for the answer.** The default `summary_max_tokens` is
   8,192 and the clamp allows 16,384. A reasoning model needs headroom before it writes anything, and an
   unused budget costs nothing: the model stops at `stop`.
2. **Say what happened when the body is empty.** The failure message now names the likely cause
   (a reasoning model consuming the budget) and the two ways out (raise the budget, or give the summary
   its own non-reasoning connection profile).
3. **Keep the safe direction.** A failed summary still leaves the original floors visible and the
   previous summary in place; this ADR changes the budget and the message, not the fallback.

## Consequences

- The same 40-floor run, with the budget raised, produced a 500-character summary covering 21 chunks,
  eight continuity anchors, and 18 folded rows - and the second pass extended coverage to 41 chunks.
- An install whose summary model is not a reasoning model is unaffected: the budget is a ceiling, not a
  target.
- The failure is now diagnosable from the panel alone, which is what the earlier default denied.

### What this does not fix

- The main generation path has the same failure mode and the same host-level setting
  (`openai_max_tokens`). That is the user's setting, not the plugin's; three of the twenty turns in the
  run returned an empty reply before the host budget was raised.
- A model that reasons for more than 16,384 tokens still fails, now with a message that says so.
