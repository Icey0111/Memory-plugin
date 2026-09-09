# Aetheria Unified Memory v5.4 — Test Plan

## Automated

### Existing regression
- memory op parser/schema
- add/update/close/supersede/reinforce/invalidate/noop
- slot lifecycle
- branch replay
- evidence gate
- hybrid lexical/dense/entity bypass
- graph diffusion
- MMR-like diversity
- query variants
- dynamic budget
- v5.3 autonomous extraction transaction behavior

### v5.4 baseline pure core
- deterministic chunk/fingerprint
- baseline source change alters fingerprint
- exact duplicate blocked
- semantic paraphrase + topic/entity anchor blocked
- knowledge acquisition preserved
- world_delta/change preserved
- temporary active state preserved

### host source collection
- Persona collected
- character description/personality/scenario collected
- embedded character book collected
- Persona/character/chat bound books loaded
- current activated World Info included
- unrelated account lorebook names NOT enumerated
- group context does not crash and resolves known members best-effort

### integration
- real baseline hint reaches quiet extractor
- rejected operation never reaches Canonical Store
- event and knowledge survive gate
- transaction/debug records rejection
- baseline vector collection rebuilds
- semantic vector query can reject paraphrase
- provider fingerprint change rebuilds baseline projection
- Persona source change rebuilds baseline projection

## Real SillyTavern acceptance still required

1. Persona switching.
2. Character switching.
3. Character-bound lorebook.
4. Persona-bound lorebook.
5. Chat lore.
6. Global constant + keyword/selective World Info.
7. Group chat.
8. Streaming and non-streaming generation.
9. Regenerate/swipe/edit/delete while extraction is queued.
10. Local Transformers vector source.
11. At least one remote embedding provider.
12. 1k / 10k memory stress and latency measurements.
13. False-positive Baseline gate adversarial cases:
    - baseline likes plants vs story buys a plant;
    - baseline owns house vs story returns home;
    - baseline pet contract vs contract renegotiation;
    - world fact X vs character newly learns X.
