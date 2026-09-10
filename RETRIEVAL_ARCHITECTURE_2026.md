# Aetheria Retrieval Architecture 2026

Status: implemented baseline for v5.5-dev Iteration 09

## Core invariant

Aetheria does not define memory as a vector database. Chat source text, extraction transactions, Canonical Memory, Current State and plugin Setting Store are authoritative. Dense embeddings, lexical indexes, graph associations, fused rankings and retrieval diagnostics are derived and replaceable.

Changing an embedding model may invalidate a derived index. It must never rewrite, delete, or reinterpret Canonical Memory merely because vector geometry changed.

## Embedding Space Profile

`embedding-profile.js` defines a provider-neutral profile. Space-semantic fields are provider/model/endpoint, family, role strategy, query/document prefixes, dimension hint and normalization hint. Retrieval-policy fields are Memory/Setting/Baseline thresholds, Setting multi-query fusion and RRF K.

They produce two independent fingerprints:

```text
space_fingerprint
retrieval_policy_fingerprint
```

Only `space_fingerprint` changes require re-embedding. Threshold/RRF changes alter ranking policy only.

## Provider portability

- E5 auto mode uses `query: ` and `passage: ` prefixes.
- Generic/BGE/Qwen3/OpenAI/Voyage auto mode stays symmetric unless explicitly configured otherwise.
- Jina auto mode stays symmetric through the current SillyTavern vLLM bridge. The bridge does not expose a reliable generic way to forward `task=retrieval.query/retrieval.passage`, so Aetheria does not pretend that it does.
- Manual prefix mode is available for models whose public interface documents role prefixes.

Model-specific optimization is allowed, but the memory core never imports model names or provider task enums.

## Model switching

For Aetheria's optional private OpenAI-compatible embedding connection, physical collection identity additionally includes the embedding-space fingerprint. Changing endpoint/model/role semantics therefore cannot silently query vectors from the previous space. Canonical Memory remains intact and the mature rebuild path regenerates the required projection.

A one-time Iteration 09 policy migration marks pre-profile derived vectors stale because older vectors do not carry a trustworthy representation-space identity.

## Score calibration

A fixed cosine threshold is not universal across embedding models. Iteration 09 keeps existing thresholds as fallback defaults and allows optional profile-calibrated values for Memory, Setting and Baseline. Blank means inherit the current Aetheria default.

`retrieval-eval.js` provides pure helpers for Recall@K, Precision@K, MRR, hit rate, minimum-recall threshold calibration and baseline/candidate metric deltas. Calibration evidence belongs to evaluation artifacts, not Canonical Memory.

## Multi-view retrieval

Aetheria already uses separate focus/context query variants for story history. Iteration 09 extends this principle to labelled Setting queries. A Setting query can be projected into independent views:

```text
focus
assistant_context
entity_scene
state_objective
```

Each view is embedded and retrieved independently, then combined by weighted reciprocal rank fusion. Raw cosine scores from different views are not averaged as though they were globally calibrated. If multi-view transport fails, retrieval falls back to the mature single-query path.

## Hybrid architecture

Embedding is one association channel, not the final judge:

```text
Canonical truth
    ↓
representation/index projections
    ├─ Dense semantic
    ├─ Lexical / rare terms
    ├─ Entity/topic associations
    └─ lifecycle/time metadata
            ↓
        rank fusion
            ↓
     graph diffusion
            ↓
       diversification
            ↓
 evidence/context assembly
```

Current State remains outside historical recall ranking.

## Deliberate boundaries

Iteration 09 does not claim provider-native Jina task forwarding through the current generic ST vLLM vector bridge, a universal Cross-Encoder rerank transport, universal cosine thresholds, dimension/normalization forcing when the host backend does not expose those parameters, or real SillyTavern browser acceptance in this coding environment.

These are explicit boundaries, not silent fallbacks.

## Research direction

The design follows the broad direction found in LittleWhiteBox/Recall v9 and newer long-memory work: authoritative memory should be separate from derived vector state; stable profile/current-state/source-grounded records should not be flattened into one vector store; semantic retrieval should coexist with lexical/entity/temporal/graph evidence; and relevant context should be reconstructed rather than equating nearest vectors with memory truth. Aetheria remains an independent implementation.
