# ADR-0038: A run freezes the turns file it played

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

The fixture behind the fact-survival measurements was authored outside the repository - correctly, it holds
real chat text and raw model responses - and it no longer exists. Its runs stay replayable from the recorded
chat, but they cannot be **re-run as the same fixture**, and that is the comparison a retrieval or summary
change needs: same turns, same declared needles, same probe selection, one code difference. Only six of the
eleven declared facts survive in the recorded evidence (the probed needles in `detail-survival.json`, the
kinds in `fact-survival.json`); the rest of the declaration is gone, and a re-authored file would change what
the probe asks and therefore what the number means.

## Decision

A run that plays a turns file freezes the input it actually used into `<out>/turns.fixture.json` before the
first model call. The frozen file is an ordinary turns file in the schema `parseTurnsFile` already accepts,
so the replay is the ordinary command with `--turns <out>/turns.fixture.json`; the source path, byte count and
sha256 are recorded beside it as identity, and the run's meta file names the artifact. The freeze is a pure
function (`freezeTurnsFixture`) so the round trip is proved offline rather than during a paid run, and the
caller reads the bytes and computes the hash so the module stays file-free. A restore-only action freezes
nothing, because it has no turns file and its snapshot is already written.

## Consequences

- `test-detail-survival.mjs` proves the property that matters: the frozen file reloads to the same turns,
  needles, kinds, expectations, controls, cadence, phase1Turns and probeMode, and a bare legacy array of turn
  strings freezes into the detailed schema with no declared details.
- The hash, not the copy, is the identity. A replayed run can be attributed to the file it came from after
  that file is gone, and two runs of one fixture can be told apart from two runs of two files that look alike.
- The artifact is written before the host connection, so a run that dies at the CDP step still leaves a
  fixture behind.
- Past runs are not retro-fitted. The FactSurvival3 fixture remains unrecoverable, and the limits already
  recorded for it - a small labelled A/B replayed from the chat, no second paid run - stand.
