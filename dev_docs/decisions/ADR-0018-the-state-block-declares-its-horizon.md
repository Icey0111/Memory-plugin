# ADR-0018: The state block declares its horizon, and knowledge is one line per character

- Status: accepted
- Date: 2026-09-12
- Supersedes: -
- Superseded by: -

## Context

ADR-0017 measured the state block on 60 live turns and named two defects: the block can contradict the
transcript for up to one cadence, and the knowledge list spends its entries on several lines per character
until two of them contradict each other. Both come from the restatement protocol, not from the model
forgetting - `anchors_unconfirmed` and `knowledge_unconfirmed` were 0 on all 60 turns, so the model
re-states everything it is given.

Two cheap changes follow, and neither adds a background call.

The knowledge section asked for `- 角色 | 知道或不知道 | 事实`, one fact per line, while the merge rule
retires a subject's *carried* line. The model wrote one line per statement, so a character accumulated
lines and the oldest of them went stale without being retired: 韩铮 held both `不知道 账本存在` and
`知道 账本在林昭手中`.

The block also asserted its contents without saying how current they were. A reader cannot tell a state
that is still true from one the transcript has already changed.

## Decision

1. **One line per character.** The knowledge section asks for a single line per character that bundles
   what that character knows and does not know, separated by `；`, and says why: two lines for one
   character can contradict each other. A statement that has been replaced is rewritten in that line.
2. **The host reports the shape it got rather than merging it.** `mergeKnowledge` counts the subjects
   with more than one line (`duplicate_subjects`, `max_per_subject`) and the panel warns. The host does
   not guess which of two statements is current, because only the summary knows.
3. **Every injected block states its horizon**: `... — current as of floor N; anything later in the
   transcript wins`, where N is the last floor of the covered chunk prefix. The blocks are snapshots of
   the last accepted summary and now say so.
4. **No second model call and no per-turn refresh.** ADR-0017 stands: the write path stays at one
   background call per cadence.

## Consequences

Verified on a fresh 30 user turns (60 floors), same cadence, model and reranker, three summary passes,
0 summary failures and 3 generator retries:

| observation | measurement |
| --- | --- |
| subjects with more than one line | 0 on all 30 turns |
| most lines on one subject | 1 on all 30 turns |
| knowledge at turn 30 | 7 characters, 7 lines, each bundling known and unknown facts |
| probes answered | 6 of 6 |

The contrast is the point. At the same turn of the earlier 60-turn run the block held 9 knowledge entries
with up to two lines on one character, and by turn 60 it held 20 entries over eight subjects with six
lines on one character. A bundled line also reads better: 林昭's single line ends
`...；不知道白先生死活、三包药如何使用、白先生是否更换暗号规矩...`.

- The horizon header costs about a dozen tokens per block and is present whenever a summary is injected
  (20 of 30 turns; there is no summary in the first cadence).
- **The stale window is unchanged.** The key handover on turn 12 stayed wrong in the block until the
  turn-20 pass, a lag of 9 turns, and a change made two turns before the end of a chat still never
  reaches a block. The header makes the window visible; it does not close it.

### What this does not prove

- **That the header changes an answer.** Both runs answered the stale-window probes correctly, so the
  header's benefit is unmeasured. It is kept because it removes an ambiguity for about a dozen tokens,
  not because a measurement showed a gain.
- **That one line per character is stable across models.** Three passes of one model followed the
  instruction. The host-side counter exists so a model that does not can be detected rather than argued
  about.
