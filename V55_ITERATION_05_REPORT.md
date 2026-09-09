# Aetheria Unified Memory v5.5-dev — Iteration 05 Report

Date: 2026-09-09  
Runtime identity: **v5.4 remains unchanged intentionally**  
Implemented scope: **Commit F — Context Assembler + Dual Injection**

## 1. Iteration goal

Iteration 05 makes the plugin-owned setting library visible to the main model without collapsing world settings, current truth and historical memory back into one undifferentiated prompt.

The main-generation path is now:

```text
current dialogue
   ├─ plugin Setting retrieval
   └─ story-memory recall
            ↓
     context-assembler.js
        ├─ Reference Block
        │    ├─ bounded constant/core setting reserve
        │    ├─ relevant setting entries
        │    └─ historical memory recall
        │         → System / IN_CHAT / depth 4
        │
        └─ Current State Block
             └─ Canonical ACTIVE_STATE + relevant active slots
                  → System / IN_CHAT / depth 1
```

No fake dialogue rows are inserted. The interceptor continues to use only SillyTavern `setExtensionPrompt(...)` and leaves the supplied chat array unchanged.

## 2. New pure module: `context-assembler.js`

The module has no SillyTavern globals and no network I/O. Its public entry point is:

```js
assembleGenerationContext({
  scope,
  latestMessages,
  currentState,
  activeMemories,
  settingResults,
  historyResults,
  hostContextBudget,
  replyReserve,
  maxReferenceChars,
  maxCurrentStateChars,
  includeEvidence,
  constantLimit,
})
```

It returns:

```js
{
  referenceBlock,
  currentStateBlock,
  diagnostics: {
    settingIds,
    memoryIds,
    droppedIds,
    referenceChars,
    currentStateChars,
    estimatedTokens,
    referenceBudgetChars,
    allocationChars,
    effectiveCapsAfterSpillChars,
    usedAllocationChars,
    scope,
  },
}
```

This makes the assembler the single formatting/budget boundary instead of allowing `index.js`, memory formatting and Setting formatting to independently spend prompt budget.

## 3. Reference Block

The main reference prompt is labeled:

```text
[PLUGIN REFERENCE DATA — NOT DIALOGUE]
```

It can contain:

```text
[BASELINE / CRITICAL-CONSTANT SETTING]
[BASELINE / RELEVANT SETTING]
[HISTORICAL MEMORY — PAST EVENTS, NOT NECESSARILY CURRENT]
```

Important semantics:

- imported Setting text is source/reference data, not dialogue;
- instruction-like wording contained inside imported material is explicitly declared **not** to be plugin/system instruction;
- XML-like source tags are escaped before prompt insertion;
- objective world facts do not imply universal character knowledge;
- historical memory is explicitly labeled as past and cannot silently become current truth.

### Initial budget policy

Reference payload uses the architecture's initial split:

```text
constant / critical setting   25%
relevant setting              45%
historical memory             30%
```

Unused constant budget may spill into relevant setting, and unused relevant budget may spill into history. The total block is still bounded by one central Reference character cap. `constantLimit` also prevents the constant channel from becoming an unlimited resident worldbook dump.

`hostContextBudget` and `replyReserve` are accepted by the assembler. At this stage they only lower the configured Reference cap on unusually small contexts; they do not attempt to replace SillyTavern/provider token accounting.

## 4. Current State Block

The shallow prompt is labeled:

```text
[PLUGIN CURRENT STATE — EFFECTIVE FOR THE PREVIOUS COMPLETED TURN]
```

It contains only current Canonical state material:

- latest stored `ACTIVE_STATE` summary;
- current location slots;
- present/scene slots where explicitly represented;
- active state/relation/ownership records;
- open commitments / intentions;
- active knowledge changes;
- other active facts.

It does **not** contain world-setting bodies or historical recalled memories.

The block explicitly states that it is structured data rather than dialogue/instruction, and that newer explicit user/assistant text wins if it conflicts with the previous completed turn's state. State text is also escaped when it resembles markup.

## 5. Two prompt keys

Commit F replaces the old single payload with two independent keys:

```text
aetheria_unified_memory_v5_4_reference
aetheria_unified_memory_v5_4_current_state
```

Defaults:

```text
Reference      IN_CHAT / System / depth 4
Current State  IN_CHAT / System / depth 1
```

The existing `injection_depth` setting now controls Reference depth. A new `current_state_injection_depth` controls the shallow state block. Both pass through the same safe normalization, so legal depth `0` remains valid.

The legacy key:

```text
aetheria_unified_memory_v5_4
```

is retained only for cleanup during staged/in-place upgrade and no longer carries the main context payload.

## 6. Cleanup lifecycle

Commit F adds centralized prompt cleanup for:

- plugin disabled;
- quiet generation;
- impersonate generation;
- chat switch;
- in-place startup cleanup of the legacy single-block key.

quiet/impersonate/disable/chat-switch clear:

```text
legacy single-block key
Reference key
Current State key
```

This prevents stale state/reference prompts from surviving a chat boundary or background generation.

## 7. Main runtime integration

`buildInjectedMemoryContext()` has been replaced by a bundle-producing path:

```text
waitForExtractionFreshness()
→ operationQueue
→ Canonical active state lookup
→ retrieveGenerationSettings()
→ recallMemories()
→ assembleGenerationContext()
→ setExtensionPrompt(reference)
→ setExtensionPrompt(currentState)
```

Setting retrieval and story-memory recall remain separate until the final assembler call. The Setting vector collection is still never mixed with the per-chat episodic memory collection.

## 8. Settings UI

The settings panel now exposes:

- Reference total character budget;
- Current State character budget;
- Reference injection depth;
- Current State injection depth;
- reply-reserve token hint.

The UI text now identifies Commit F as active and explains that two independent System extension prompts are used.

## 9. Diagnostics

The existing diagnostics panel now includes `[ContextAssembler]` with:

- selected setting IDs;
- selected memory IDs;
- dropped IDs;
- Reference/current character counts;
- approximate token count;
- configured Reference cap;
- initial 25/45/30 allocation;
- effective post-spill caps;
- actual used characters;
- prompt keys and depths.

These diagnostics are designed for Commit H final-request calibration rather than being treated as provider-authoritative token counts.

## 10. Automated tests

New/updated tests include:

### `test-context-assembler.mjs`

Validates:

- Setting + history enter Reference;
- current state does not enter Reference;
- current state enters Current State;
- history and Setting bodies do not enter Current State;
- imported XML-like markup is escaped;
- instruction-like imported text is demoted to source data;
- central budget is honored;
- drops are diagnosed.

### `test-context-injection-lifecycle.mjs`

Validates mock interceptor behavior for:

```text
normal
continue
regenerate
group
quiet
impersonate
disabled
```

Also verifies `current_state_injection_depth = 0` stays `0`.

### `test-index-mock.mjs`

Now verifies:

- Reference key at depth 4;
- Current State key at depth 1;
- state/reference separation;
- real chat array is not mutated;
- quiet clears both new keys plus the legacy key.

### Updated Setting/runtime tests

`test-setting-retrieval-host.mjs` now confirms the retrieved imported world-setting text actually reaches the main-model Reference Block while unrelated setting entries remain absent. Existing plugin baseline dedup and `knowledge` exception continue to pass.

Existing hybrid recall / migration tests were updated to read historical memory from the Reference key rather than the removed single block.

## 11. Full regression result

Environment used in this iteration:

```text
Node.js v22.16.0
```

Results:

```text
npm run check  PASS
npm test       PASS

memory-core                         29/29 PASS
memory extractor                    PASS
baseline pure core                  PASS
depth normalization                 PASS
Setting Store / Host                PASS
Importer / Host                     PASS
Setting Index / cross-chat Host     PASS
Setting Retriever                   PASS
Context Assembler                   PASS
Context injection lifecycle         PASS
Setting runtime integration         PASS
Setting dense runtime               PASS
Interceptor mock                    PASS
Story vector mock                   PASS
Migration fallback                  PASS
Autonomous extraction               PASS
Host Baseline Gate                  PASS
Host Baseline Vector Gate           PASS
```

No dependency or environment change was required.

## 12. Real 41-entry Aetheria acceptance

External sample used:

```text
艾瑟瑞亚_世界书_v5_势力深化与区域强权扩展版.json
```

Observed again:

```text
41 imported SettingEntry
91 SettingChunk
2 constant
0 disabled
```

Query:

```text
我们准备去一片世界书没写过的新地区，还会遇到一个全新的地方组织。
生成这些内容应该遵守哪些边界？
```

Rank 1 remained:

```text
uid = 27
世界扩展规则｜新地区与新组织生成
```

The assembled result verified:

```text
Reference contains uid=27 tail rule        YES
Reference contains synthetic past memory   YES
Reference contains synthetic current state NO
Current State contains current location     YES
Current State contains past memory          NO
```

So the earlier "large-file tail retrieval" result now survives the full path through final context assembly rather than ending at retrieval diagnostics.

## 13. Deliberate scope boundary

Iteration 05 does **not** claim Commit H real SillyTavern final-request validation. The mock tests prove plugin-side prompt key/depth behavior; actual provider message placement/merging must still be inspected in a live SillyTavern instance.

Also not implemented yet:

- per-entry Setting vector diff;
- staging a replacement collection before switching;
- no-purge update window;
- embedding-profile generation lifecycle / old-index GC.

Those belong to **Commit G — Incremental Index Lifecycle**.

## 14. Next step

```text
Commit A  depth=0                         DONE
Commit B  Setting Store                   DONE
Commit C  Import + Preview                DONE
Commit D  Setting Index                   DONE
Commit E  Relevant Setting Retrieval      DONE
Commit F  Context Assembler + Dual Inject DONE
Commit G  Incremental Index Lifecycle     NEXT
Commit H  SillyTavern real acceptance     TODO
```

The next iteration should therefore focus on **safe per-entry index updates and collection switching**, not add another retrieval algorithm.
