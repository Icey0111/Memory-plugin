# ADR-0040: A per-turn probe restores the state between questions

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

The detail-survival probe asked every selected item in one turn. That composition is not a per-item
measurement: the packer has five evidence slots, so four to six questions compete for the same budget. The
live run on 2026-09-14 quoted five rows and answered one of four items, and the trace showed why - the jasmine
row ranked 7th of 40 and lost to the entry cap while the window spent its slots elsewhere. One reply from that
composition is one sample of a contended budget, not four samples of retrieval.

`perTurn` already existed in the schema, but the driver's own notice said later turns see the earlier replies
and may contaminate each other, so it was not a usable alternative: without a restore, question two is a
follow-up to question one, and the two cannot be told apart in the reply.

## Decision

In `perTurn` mode the harness restores the phase-1 snapshot before each later question, through the host
restore path ADR-0034 already describes (reset the surface epoch, redisplay the canonical chat, re-apply the
fold classes) and without saving the chat file. Every question then starts from the identical state, so N
questions are N independent samples and the retrieval budget is spent on one question at a time.

The saved record says which kind of number it holds: `probeMode`, an `independence` reading (mode,
independent, samples, competing, reason) and, per probe, the item ids it asked and whether the state was
restored before it. `single` stays the default, because one turn is cheaper and it still measures the real
shared budget; it is now labelled as one sample instead of being read as a per-item result.

## Consequences

- Measured live on 2026-09-14, same fixture, one run per mode: `single` asked four items in one turn and
  recovered none of the three answerable ones - the tea and the scar were quoted and then cut by the trim, and
  the bell was conveyed - while `perTurn` asked one item per turn and recovered all three dropped details
  through the evidence channel, refused the negative control, and quoted each of its rows whole. One run per
  mode is not a rate and the two runs have different replies; what it establishes is that a mixed question was
  what made the evidence unreachable in the single-turn composition.
- A `perTurn` run of N questions costs N generations and N-1 restores. The restore is the same tested path the
  `--restore-snapshot` action uses, and it does not persist.
- `probeIndependence` is pure and covered offline: `single` reports one sample and the number of competing
  questions, `perTurn` reports independent only when every later probe was restored, and a partially restored
  run says how many were not.
- Numbers from earlier `single` runs keep their meaning and are now explicitly one sample per run; they are
  not retro-fitted, and no earlier reading is restated as a per-item rate.
- Nothing here changes the summary, the ranking or the packer. It changes what one probe answer is evidence of.
