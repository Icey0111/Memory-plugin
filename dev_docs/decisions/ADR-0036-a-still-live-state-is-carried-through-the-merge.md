# ADR-0036: A still-live state or condition is carried through the merge

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

The first fact-survival measurement (chat FactSurvival2, 11 facts crossing two merges) showed the floor-20
merge keeping 9/11 and dropping a still-live state - the west road was blocked by a landslide - while three
incidental details stayed in the summary. The raw summary output for that batch did not contain the state,
so the model omitted it. The request's retention rule said "保留否定、条件和状态变化；删除已解决或无后续影响
的细节", which reads as "changes only" and let a standing constraint be pruned as soon as nobody was
discussing it.

## Decision

The summary request's retention rule now names standing state explicitly: a still-live state or condition
must be carried through even when the batch does not change it and nobody mentions it, as long as it
constrains later action; it is not a detail with no further effect. A detail is deleted only when it is both
resolved and no longer affecting later action. No new section, layer or injection channel is added, and the
request keeps its four-section shape and its soft target.

## Consequences

- The second measurement with the same 11 facts and both merges kept every must-keep fact through the merge
  (`state` 1/1, `condition` 1/1); must-keep merge losses went from 1/7 to 0/7, and incidental occupation of
  the summary fell from three facts to one.
- The place name `k-place` was absent at the last merge, but it was already absent from the floor-10
  summary and the raw output never wrote it - an initial omission, not a merge loss - and one chat's
  variance does not establish a rate.
- The instruction block grew from 1018 to 1082 characters. The default 40,000-character input budget still
  blocks a ten-turn batch whose replies average about 1,800 characters (measured at 43,658 needed).
- This is a prompt change, not a new mechanism. Frozen evidence and fixtures stay outside the repository.
