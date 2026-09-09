# LittleWhiteBox reference notes — Aetheria Unified Memory v5.4

Reference material explicitly chosen by the user:

- Documentation: https://docs.littlewhitebox.qzz.io/
- Repository: https://github.com/RT15548/LittleWhiteBox

This project is an independent implementation. The purpose of this file is to record concepts studied from the public project, not to copy its source.

## Public LittleWhiteBox concepts used as reference

### Hybrid recall
LittleWhiteBox's public Story Summary documentation describes:
- Dense semantic retrieval;
- lexical retrieval;
- entity protection;
- Dense Gate;
- floor-level weighted reciprocal rank fusion (W-RRF);
- Cross-Encoder reranking;
- PPR diffusion;
- dynamic prompt budgeting.

Its repository `modules/story-summary/vector/retrieval/recall.js` further exposes a staged Recall v9 pipeline with two-round dense retrieval, dense-gated lexical merge, W-RRF, PPR diffusion and causation tracing.

Aetheria v5.2/v5.3 already adapted the general direction with its own:
- Dense + lexical;
- CJK bigram/trigram;
- entity exact bypass;
- Dense Gate;
- query variants;
- W-RRF;
- lightweight graph diffusion;
- MMR-like diversification;
- evidence gate;
- dynamic budget.

We do **not** claim exact parity with LittleWhiteBox Recall v9 and do not currently implement its Cross-Encoder stage.

### Layer separation
LittleWhiteBox documentation describes L0/L1/L2/L3 memory layers and a “core memory in chat metadata / large index rebuildable locally” split. Its repository also describes StateAtoms as fact data while StateVectors are derived/rebuildable.

Aetheria keeps different semantics but adopts the engineering lesson:

```text
Authoritative data != retrieval index
```

In v5.4:
- Canonical Memory and extraction transactions are authoritative story-memory data;
- Persona / Character / World Info are authoritative baseline data;
- Memory Vector and Baseline Vector are rebuildable projections.

### Automatic background memory work
LittleWhiteBox documents automatic post-AI summary operation. v5.3 independently moved Aetheria from visible `<memory_ops>` output to post-AI `generateQuietPrompt` extraction. v5.4 keeps this architecture.

## Why v5.4 does not copy L0/L1/L2/L3 directly

Aetheria's main problem is not generic story summarization; it is AIRP continuity with strict epistemic boundaries and worldbook baseline separation.

Therefore its canonical kinds remain:

```text
event / state / knowledge / belief / relation /
commitment / ownership / intention / world_delta
```

and its lifecycle remains:

```text
active / closed / superseded / invalid
```

The new Semantic Baseline Index exists specifically to distinguish:

```text
“世界/角色本来就这样”
vs
“剧情后来发生了变化”
vs
“某角色现在知道了某件原本存在的事”
```

This distinction is central to Aetheria and is not replaced by copying another project's memory layers.
