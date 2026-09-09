# Aetheria Unified Memory v5.4 — Architecture

## 1. 四种不同性质的数据

v5.4 不把所有“上下文”混成一份摘要：

```text
A. Canonical Baseline
   Persona / Character / World Info
   “本来是什么”

B. Extraction Transactions
   每个有效 user+assistant pair 的后台抽取结果
   “这一轮记忆系统认为发生了什么变化”

C. Canonical Memory Store
   replay(transactions) 的剧情真相
   “故事后来改变了什么 / 现在什么仍成立”

D. Derived Indices
   Memory Vector + Baseline Vector
   “怎样快速找到相关信息”
```

Canonical 与 Vector 不互相替代。

## 2. v5.4 写入管线

```text
AI reply finalized
       ↓
Dialogue-pair fingerprint
       ↓
collect current semantic baseline
       ↓
quiet extraction
       ↓
JSON parse + operation schema validation
       ↓
branch/fingerprint re-check
       ↓
refresh baseline fingerprint
       ↓
┌──────────────────────────────┐
│ Semantic Baseline Write Gate │
│ 1. lexical hard gate         │
│ 2. semantic vector gate      │
│ 3. story-delta exemptions    │
└──────────────────────────────┘
       ↓
accepted operations only
       ↓
extraction transaction
       ↓
Canonical apply/replay
       ↓
indexable memories → Memory Vector
```

Baseline rejected ops are stored in extraction diagnostics but are not applied to Canonical Memory.

## 3. Baseline source scope

`baseline-host.js` is intentionally conservative.

Included:
- active Persona description;
- current character or resolvable group-member character card fields;
- embedded character book;
- Persona-bound lorebook;
- character-bound lorebook;
- chat-bound lorebook;
- current dry-run activated World Info.

Excluded by design:
- every lorebook merely existing in the account;
- disabled World Info entries;
- unrelated character cards;
- API credentials / connection secrets.

This follows a core rule: **baseline must represent the current RP's canonical prior, not the user's whole SillyTavern library.**

## 4. Baseline record model

Raw sources are deterministically split into focused chunks:

```text
BaselineRecord
- id
- source_type
- source_id
- title
- chunk_index
- text
- normalized
- tokens (local only)
```

The full record list is regenerated from host sources. It is not copied wholesale into chat metadata.

Fingerprint:

```text
baseline54:<fnv1a32(sorted source/chunk semantics)>:<record_count>
```

The fingerprint is deterministic and detects Persona / card / lore changes.

## 5. Why lexical + semantic instead of semantic-only

Semantic-only deletion is unsafe:

```text
baseline: 平成喜欢植物
story:    平成今天去植物店认识了璃月
```

The two are semantically close, but the second is a real event.

v5.4 therefore uses:

1. kind/lifecycle eligibility;
2. explicit change-signal exemption;
3. lexical duplicate score;
4. optional vector high-similarity hit;
5. lexical/entity/topic anchor for semantic hit.

Only then is an op blocked.

## 6. Eligible vs exempt operations

Hard-gate candidates:
- stable `state` (not obvious temporary state);
- `relation`;
- `commitment`;
- `ownership`.

Default exemptions:
- `event` — occurrence is a new historical fact;
- `knowledge` — “角色现在知道 X” differs from “X exists”;
- `belief` — epistemic state, may be wrong;
- `intention` — plan, not baseline fact;
- `world_delta` — explicit story/world change.

Explicit change phrases also bypass baseline duplicate deletion so “搬家 / 失去 / 获得 / 解除 / 改专业”等不会被旧基线吞掉。

## 7. Baseline Vector projection

Collection:

```text
aetheria_v54_baseline_<chat hash>
```

Item text:

```text
[source_type:title] baseline chunk text
```

Activated/keyword World Info is treated as volatile: it participates in the lexical gate and extraction hint, but is excluded from the stable Baseline Vector corpus so keyword activation does not trigger a full rebuild every turn.

The stable collection is rebuilt when:
- stable Persona/card/bound-lore baseline fingerprint changes;
- provider fingerprint changes;
- manual rebuild is requested;
- stored index is marked stale.

If vector is unavailable, lexical hard gate remains operational.

## 8. Current Truth remains independent of vector recall

v5.4 preserves the original v5 principle:

```text
Current Truth
= exact active slots / ACTIVE_STATE

Past Recall
= semantic + lexical retrieval of historical memory
```

A recalled closed/superseded memory never becomes current merely because it is similar to the query.

## 9. Recall pipeline inherited from v5.2/v5.3

Current implementation keeps:

```text
focus/context query variants
      ↓
Dense candidates + local Lexical candidates
      ↓
Dense Gate / Entity bypass
      ↓
Weighted RRF
      ↓
rare-entity/topic graph diffusion
      ↓
MMR-like diversity
      ↓
Evidence Gate + recent protection + cooldown
      ↓
dynamic prompt budget
```

This is conceptually informed by LittleWhiteBox's public Recall v9 design, but v5.4 does not claim feature parity. In particular, a true external Cross-Encoder reranker is not implemented here.

## 10. “Soul / Brain” interpretation

LittleWhiteBox publicly describes core metadata as portable memory and large vector indices as rebuildable derived data. v5.4 adopts the same engineering principle in an independent form:

```text
Portable / authoritative
- chat正文
- extraction transactions
- Canonical Memory
- Persona / World Info originals

Rebuildable
- Memory Vector index
- Semantic Baseline Vector index
```

## 11. Branch safety

Each autonomous extraction is keyed by stable user+assistant pair fingerprint.

- identical finalized reply: no duplicate extraction;
- swipe/edit/delete: replay from still-valid transactions;
- branch changes during quiet LLM call: result rejected;
- forced re-extraction: replaces transaction then replays;
- Baseline rejection is part of the transaction/debug record, so it is auditable.

## 12. Known limitations

1. Global World Info that is selected but not currently activated is not blindly enumerated; current active prompt is used as conservative fallback.
2. Group member resolution is best-effort because card/member identifiers vary by ST build and card format.
3. Semantic Baseline threshold needs real provider calibration.
4. Legacy v5.3 memories already stored before v5.4 are not destructively rewritten solely by a semantic heuristic.
5. No direct mutation of real chat history for context pruning.
6. No external Cross-Encoder reranker yet.
