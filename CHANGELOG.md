# Changelog

## 5.4.0 — Semantic Baseline Index

### Added
- `baseline-index.js`: deterministic Persona/Character/World Info chunking, fingerprinting and duplicate evaluation.
- `baseline-host.js`: conservative SillyTavern context source collection.
- Independent Baseline vector collection (`aetheria_v54_baseline_*`).
- Hard post-extraction write gate before Canonical Memory application.
- Lexical duplicate gate + optional semantic vector gate.
- Story-delta exemptions for event/knowledge/belief/intention/world_delta and explicit change semantics.
- Baseline fingerprint/provider fingerprint stale/rebuild lifecycle.
- Real baseline content supplied to quiet extraction prompt rather than macro placeholders when available.
- Baseline rejection audit data in extraction transaction/debug metadata.
- Baseline status and rebuild controls in settings UI.
- Tests for source scoping, group fallback, deterministic fingerprint, lexical duplicate blocking, semantic paraphrase blocking, knowledge/world-delta preservation, provider/source rebuild.

### Preserved
- v5.3 autonomous after-AI extraction and branch-safe transaction replay.
- v5.2 hybrid recall stack.
- v5.1/v5.2/v5.3 migration compatibility.
- no direct mutation of SillyTavern chat history.

### Not implemented / deferred
- destructive semantic cleanup of all pre-v5.4 legacy memories;
- Cross-Encoder reranking;
- safe host-level old-message prompt pruning;
- exhaustive indexing of every globally selected but currently inactive lorebook.
