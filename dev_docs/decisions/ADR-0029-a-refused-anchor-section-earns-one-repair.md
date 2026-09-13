# ADR-0029: A refused anchor section earns one repair, and a source names every row it depends on

- Status: accepted
- Date: 2026-09-13
- Relates to: ADR-0023, ADR-0024, ADR-0025, ADR-0026, ADR-0027, ADR-0028

## Problem

The 421757c acceptance run separated four failures the numbered-operation protocol had left open.

1. Single-source syntax was too narrow. A fact is normally established by a conversation, and the model
   wrote '来源 raw_15、raw_17'. The field regex accepted one token, so a valid line and its whole batch were
   refused as 'missing_source'. The same happened to comma-separated lists and to a bare 'raw_63, raw_65' cell.
2. A refused batch lost its valid content. The model's retry after a refusal answered '无', and the necessary
   facts in the first answer never reached the ledger. The run proves the retry lost the facts; it does not
   prove the model deliberately learned to avoid the format, so the response is a host-side repair that keeps
   the valid content, not a claim about model behaviour.
3. The heading was treated as the meaning. A probe answer carried a correct '更新 A1 | 来源 raw_79 | ...' line
   but omitted the '【锚点变更】' heading; the parser filed it as prose and the answer would have been refused.
4. 'anchors_same_subject' was read as a contradiction detector. It only counts records that share a label; the
   live run showed two contradictory key anchors under different labels scoring zero, so it detects neither
   agreement nor contradiction.

## Decision

- A source cell names one or more original rows. The enumeration comma, ASCII comma, semicolon, slash and
  whitespace separate tokens. Every token must be a 'raw_N' and must be in the frozen batch; one foreign or
  malformed token refuses the whole batch exactly as a single bad source does. All tokens are kept, the record
  keeps the array, and the display string keeps the joined list.
- An operation whose first cell is exactly '新增'/'更新'/'结束' (with an optional alias) and which carries a real
  source list is recovered even when its heading is missing. The section is reported as 'inferred', distinct
  from 'ok', 'none', 'empty' and 'missing'. Anything less certain stays prose, so a genuinely missing section
  still refuses the batch. Prose that merely mentions 更新 does not match.
- A batch refused for 'anchor_ops' earns exactly one repair request. It carries the original answer, the lines
  the host rejected with their reasons, the frozen alias table and the batch's source list, and names the valid
  content to preserve. The repaired answer goes through the same atomic parse and check. A failed repair still
  refuses the batch, keeps the original refusal as the reported reason and records the repair's own errors. The
  repair is a second model call with its own cost record, never folded into the batch request cost.
- The prompt teaches the supported source shape and adds three ledger checks inside the same summary: an empty
  ledger should extract the new facts later batches need, an update should check whether another live value
  contradicts the new state, and objective facts, character beliefs and unproven guesses must be told apart in
  the statement. Neither rule is a mandate: an empty ledger with no new fact may still answer '无', and the host
  adds nothing on its own. Label-based merging is not restored.
- 'anchors_same_subject' is documented and reported as a same-label record count. It is not a contradiction
  detector.

The instruction block grew from 760 characters (ADR-0028's measurement) to 977 with the three ledger checks and
the multi-source shape. The input-budget pressure the acceptance run recorded is therefore slightly worse by
construction. Raising the input budget or adding an explicit capacity setting is a separate decision and is not
made here; a blocked batch still calls no model, hides no floor and stays visible.

## Runtime precondition

A live acceptance run may start only after the repository, the deployed directory and the loaded module agree.
'runtime-precheck.mjs' compares all three: the CRLF-normalised '.js' files, then the watched function sources
imported from the deployed disk, then the same functions imported from the running page. A served-file re-read
is not evidence about the loaded module; the 421757c run had disk and repo identical while the page still
executed the pre-421757c 'parseAnchorChanges' with its 'bad_subject' check. The command exits 0 only when all
three agree, 1 when the disk is stale or the loaded module differs, and 2 when the page or directory cannot be
reached. Exit 2 is unknown, never a pass.

## Validation

'test-anchor-changes.mjs' covers multi-source validation, the inferred-heading recovery, the prose
counterexample and the prompt's ledger-check text. 'test-anchor-repair.mjs' covers one-repair-only, valid
content preserved, an atomic refusal after a failed repair, the separate cost record and the non-format failure
that is not repaired. 'test-runtime-precheck.mjs' pins the comparison with the stale signature this run
recorded. 'replay-anchor-evidence.mjs' replays the run's frozen requests and responses through the current
parser with no model call: the five probe cases pass, seven multi-source operations that were refused now
parse, none remain refused, and prose mentioning 更新 stays prose. Whether the new ledger checks reduce
semantic omission or contradiction in a live summary is not established by offline replay and remains for a
fixed-material live probe and a later acceptance task.

## Alternatives

- Loosening the source field to any text was rejected: it would accept '来源不明' and every prose line as
  provenance.
- Treating any line containing an operation word as an operation was rejected; the run's own narrative uses
  those words.
- A general retry loop was rejected: one targeted repair with the errors is bounded, and a third call would pay
  again for the same format failure.
- Retrying without the original answer was rejected: that is the behaviour that lost the valid facts.
- Restoring label-based merging was rejected again (ADR-0028): a label cannot decide which of two statements
  is current.
