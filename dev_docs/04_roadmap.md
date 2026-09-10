# Roadmap

<!-- Versioned & append-only: never edit past versions; newest is last. -->


<!-- VERSION 1 -->
## v1 - baseline (pre-versioning)

> Milestones, phases, open questions, risks.


<!-- VERSION 2 -->
## v2 - 2026-09-11 00:22:40 - point the roadmap at the v5.5 plan document

### Where the real plan lives

The authoritative plan, including the acceptance criteria and the explicit non-goals, is
[MEMORY_PLAN_2026.md](MEMORY_PLAN_2026.md). It is kept in Chinese because it is the shared working
document with the maintainer; everything else in `dev_docs/` is English.

Its shape:

| Section | Content |
| --- | --- |
| 0 | Scope: why three different projects (this one, a highly agentic tool platform, and a model-training effort) cannot share conclusions |
| 1 | Goals and acceptance criteria, taken from the user rather than from a feature list |
| 2 | The **unified execution list** (S tier): highest value, most stable, lowest verifiable risk |
| 3 | Self-designed proposals (A tier): plausible but unverified risk |
| 4 | Explicitly excluded work (B tier) |
| 5 | Data model draft |
| 6 | Phasing |
| 7 | Open problems, honestly recorded |
| 8 | Corrections recorded after the S tier landed |

### Status

| Tier | Status |
| --- | --- |
| S1-S8 | Implemented and verified offline; S5 deliberately downgraded (see plan section 8.1) |
| A1-A8 | Designed, not implemented |
| B | Excluded |

### Open risks still on the table

- `cold_turns` reaching the external derived record is still unexplained and unproven.
- Extraction coverage needs a clean end-to-end run without a mid-run repair to be trusted.
- Supersede edges are unit-tested but have not yet been observed in a live story.
- The mandatory baseline is currently a small fixed set; whether it stays bounded at story length is
  the main thing acceptance testing has to answer.
