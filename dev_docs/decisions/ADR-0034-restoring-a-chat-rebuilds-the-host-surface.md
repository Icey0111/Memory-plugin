# ADR-0034: Restoring a chat rebuilds the host's bounded surface

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

An acceptance harness restored a snapshot by replacing `ctx.chat` and re-applying the plugin's fold
styling. From the third round the host refused every generation with `ChatSurface projection has 3 ranges;
maximum is 2`. The host's loaded source shows why: its ChatSurface keeps at most one contiguous viewport
plus the canonical true tail (`kernel/chat-surface/projection.js`, `projection-layout.js`), the mounted set
is derived from the live `root > .mes` roots, and the validator refuses an ambiguous projection instead of
sorting, deduplicating or clamping it. Replacing the array without rebuilding the surface leaves the old
roots mounted, and the next reconcile's surviving set is not `V ∪ T`.

The missing step had been recorded as `syncFloorFoldDom`. That function only toggles a CSS class on
existing nodes; it can neither create nor remove a range.

## Decision

A restore goes through the host's own entry points, in order:

1. mutate `ctx.chat` in place - the host's redisplay refuses any array but the canonical one - and write the
   derived plugin state;
2. reset the surface epoch (`resetChatSurfaceView`) so the stale residencies and projection are dropped;
3. redisplay the canonical chat (`redisplayChat`) so the surface mounts a valid viewport union tail;
4. only then re-apply the plugin's fold classes (`syncFloorFoldDom`).

`acceptance-capture.js` owns the sequence (`resetChatSurface`, `restoreSnapshot`) and imports the host module
by the URL the page actually loaded; a partial host, a mismatched URL and a second host instance are refused
rather than used. Persistence is opt-in: a restore does not save a chat unless asked. A full
`deepSnapshot` now carries `chat`, so a saved snapshot is a restore point rather than only a reading.

## Consequences

- The 3-range refusal is not a plugin defect, and it is not worked around by loosening the host validator.
- The harness becomes order-sensitive and reports what it did (`reset`, `redrawn`, `folded`).
- The archive is not restored; the runtime recaptures it from the transcript on the next generation.
- Nothing in the plugin's runtime path changes. The sequence is proved offline against a fake host; the
  live confirmation remains to be run.
