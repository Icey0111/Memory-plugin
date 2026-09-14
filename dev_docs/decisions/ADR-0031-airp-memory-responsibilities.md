# ADR-0031: Continuity and Original Evidence Define AIRP Memory

Status: Accepted product direction; the budget policy is implemented by [ADR-0032](ADR-0032-a-soft-summary-target-and-an-emergency-ceiling.md).

## Context

The user reaffirmed that structured summaries provide the logical structure
needed for ongoing roleplay, and retrieval supplies precise original details
and the evidence needed to verify facts. The original Chinese statement is
preserved near the top of root AGENTS.md so later AI sessions can recover it.

An unconditional small, fixed summary cost conflates resource control with
semantic sufficiency. Equal completed-turn counts can carry different amounts
of information, and older unresolved state also consumes space. The current
implementation carries an old summary into the next summary request; it does
not regenerate the entire summary from all historical originals every pass.

## Decision

Treat structured continuity and original-text retrieval as cooperating parts
of one memory system. Original history is authoritative; summaries and state
records are derived interpretations. Stored, selected, injected and correctly
used information are distinct outcomes.

Preserving necessary causes, conditions, negations and unresolved state takes
priority over minimizing summary length. The intended policy uses a soft
summary target and an explicit upper bound, with the total injection budget
accounted for separately. Do not replace it with unbounded history injected
on every turn, or a promise that more tokens eliminate semantic errors.

Trace an observed failure to its first information loss before changing the
responsible stage. A source reference, valid operation or successful retrieval
does not alone prove narrative correctness.

## Consequences and implementation status

This decision revises the fixed-cost product objective. The target/ceiling split
that implements it is [ADR-0032](ADR-0032-a-soft-summary-target-and-an-emergency-ceiling.md);
folding rules, source/version checks and operation validation are unchanged.
Existing protocol ADRs still describe the current behavior; their implementation
is not silently superseded here.

The detailed sequence, acceptance cases and call limits belong to
[Issue #2](https://github.com/Icey0111/Memory-plugin/issues/2), not a second
repository-local task ledger. A larger summary is a resource choice whose
semantic benefit must be observed, not assumed.
