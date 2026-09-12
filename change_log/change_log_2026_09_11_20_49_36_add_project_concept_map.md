# Add project concept map

- Date: 2026-09-11 20:49:36
- Session: user asked for a single concept diagram of the whole project

## Problem / Requirement

The repository documented the memory system as a module map (`01_architecture.md`), a field list
(`03_data_model.md`) and a measured audit (`07_functional_check.md`), but had no single artefact
showing how the concepts relate to each other. Requested: "请你给我一个项目的概念图示."

## Purpose of Change

Give the project one page that answers "what is this system, in concepts" - the four kinds of data,
the two stores, the extract/apply path, the inject path, the irreversibility ranking and the
invariants - so a reader can hold the design in their head before opening the file map.

## How It Was Changed

- [dev_docs/08_concept_map.md L1-L171](file:///D:/memory_plugin/dev_docs/08_concept_map.md#L1-L171) - new document. Three Mermaid diagrams (four data kinds, full system concept map, concept-to-module table) plus the two-store table, the irreversibility ladder and the invariants. Written under the `<!-- VERSION 1 -->` anchor per `dev_docs/header.md`.
- [dev_docs/header.md L40-L48](file:///D:/memory_plugin/dev_docs/header.md#L40-L48) - registered `08_concept_map.md` in the documentation-structure table, as the header requires for a new document.

No existing `dev_docs` content was edited or versioned; the new file is additive and the header edit
only extends the index table.

## Result

The project now has a concept-level entry point: `dev_docs/08_concept_map.md`. It is consistent with
`01_architecture.md` section 1 (four data kinds), `03_data_model.md` (canonical vs derived, spine,
invariants I1-I3/C1-C2) and `07_functional_check.md` (the measured quality metrics). Nothing in the
runtime code was touched, so no test run was required.

Follow-up: none. If the architecture moves, extend the concept map as `v2` rather than editing `v1`.
