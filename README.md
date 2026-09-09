# Aetheria Unified Memory v5.4 — Semantic Baseline Index

v5.4 在 v5.3 **Autonomous Memory Plugin** 基础上新增一个独立的 **Persona / Character / World Info Semantic Baseline Index**，把“不要重复记住本来就在角色卡/世界书里的东西”从主要依赖提示词，升级成 **LLM 抽取 + 写入层硬过滤** 的双保险。

## 运行链路

```text
主 AI 正常回复
    ↓
后台 generateQuietPrompt
    ↓
EVENT / ACTIVE_STATE / operations[]
    ↓
Schema / Evidence validation
    ↓
Semantic Baseline Gate  ← Persona / Character / bound+active World Info
    ↓
Canonical Memory Store
    ├─ Current Truth：active slot 精确查询
    └─ Past Recall：indexable memory → Vector Storage
                                  ↓
                  Dense + Lexical Hybrid Recall
                                  ↓
                          下一次主对话注入
```

## v5.4 解决的问题

v5.3 已经在后台抽取 prompt 中要求 Baseline Filter，但模型仍有可能偶发输出：

- 平成住在幸福家园10栋1015室；
- 平成主修辅助魔法、辅修魔导机械工程；
- 平成喜欢植物；
- 平成拥有“上帝的骰子”；
- 平成本来就有 A 网络终端。

这些不是剧情产生的新记忆，而是 Persona / 世界书的基线。

v5.4 在 operations 真正进入 Canonical Store **之前** 再做一次独立过滤。即使抽取模型犯错，明显基线重复也不会落库。

## Baseline 来源

默认只收集当前聊天真正相关的来源，而不是扫描账号里所有世界书：

1. 当前 Persona description；
2. 当前角色卡 description / personality / scenario；
3. 当前群聊中可解析到的成员角色卡；
4. Persona 绑定 lorebook；
5. 角色绑定 lorebook；
6. 角色卡 embedded character_book；
7. chat-bound World Info；
8. 当前通过 SillyTavern `getWorldInfoPrompt(..., isDryRun=true)` 激活的 World Info。

**故意不做**：把 `getWorldInfoNames()` 返回的所有世界书全部索引。这样避免无关角色卡/无关世界观误伤当前剧情记忆。

## Baseline 两级门控

### 1. 本地词法硬过滤

无需 embedding，始终可用：

- NFKC 归一化；
- 中文 bigram / trigram + 拉丁词元；
- containment / token overlap；
- 默认阈值 `0.78`。

### 2. Semantic Baseline Vector Gate

若 SillyTavern Vector Storage provider 可用，则建立独立集合：

```text
aetheria_v54_baseline_<chat-hash>
```

为了避免关键词型 World Info 每轮激活集合变化导致 Baseline 向量反复全量重建，**当前激活 World Info 只进入词法硬门和抽取器 Baseline hint；稳定的 Persona/角色卡/绑定 lorebook 才进入 Baseline Vector corpus**。

候选记忆先通过稳定基线向量检索寻找高相似项，再要求词法/实体/主题锚点，默认：

- semantic threshold = `0.84`
- semantic lexical floor = `0.16`

这样比“向量相似就删”更保守，减少误伤。

## 哪些记忆默认不被 Baseline Gate 拦截

为了避免把“剧情增量”误判成“静态基线”，以下种类默认豁免：

- `event`
- `knowledge`
- `belief`
- `intention`
- `world_delta`

例如世界书早就写着秘密 X：

```text
X 是世界基线
```

剧情中平成第一次得知 X：

```text
kind = knowledge
平成已经知道 X
```

这仍然应该存，因为变化的是**平成的知识状态**。

同样，“搬离旧住所 / 换专业 / 解除契约 / 新获得权限”等明确变化信号也不会按普通基线重复拦截。

## Baseline 是派生索引，不是记忆本体

v5.4 继续坚持“核心数据 / 可重建索引”分离：

```text
Canonical Memory + extraction transactions
= 剧情记忆事实源，可重放

Persona / Character / World Info
= 基线事实源

Memory Vector Index
= 剧情记忆的派生检索层

Baseline Vector Index
= 基线的派生去重层
```

Baseline 原文不会复制一整份进 chat metadata。metadata 只保存：

- baseline fingerprint；
- 来源摘要；
- record count；
- vector provider fingerprint；
- stale/sync 状态；
- 最近一次 gate rejection 诊断。

## 指纹与自动重建

以下变化会使 Baseline 派生索引重建：

- Persona 内容变化；
- 角色卡/绑定世界书内容变化；
- 当前激活 World Info 变化；
- embedding provider/model 变化。

向量 provider 变化时，Baseline 与剧情 Memory Vector 使用各自独立状态，避免不同 embedding 空间混用。

## v5.3 功能全部保留

- 主回复不再输出 `<summary>` / `<memory_ops>`；
- AI 回复后后台静默抽取；
- extraction transaction + pair fingerprint；
- swipe/edit/delete 分支重放；
- 强制重抽 transaction replacement；
- Current Truth 与 Past Recall 分离；
- Dense + Lexical；
- CJK bigram/trigram；
- Entity exact bypass；
- Dense Gate；
- focus/context query variants；
- Weighted RRF；
- 稀有实体/主题图扩散；
- MMR-like 去重复；
- Recall cooldown；
- Evidence Gate；
- 动态字符预算；
- provider fingerprint + stale/rebuild。

## 安装

推荐在 SillyTavern 的 **Extensions / 扩展 → Install Extension / 安装扩展** 中直接粘贴：

```text
https://github.com/Icey0111/Memory-plugin
```

SillyTavern 会把仓库克隆为 `third-party/Memory-plugin`。也可以手动把整个仓库放入 SillyTavern 第三方扩展目录。

依赖：

```json
"dependencies": ["vectors"]
```

需要启用 SillyTavern 内置 Vector Storage。

设置入口：

**扩展设置 → 艾瑟瑞亚统一记忆 v5.4**

## 推荐默认值

Baseline：

- Baseline 写入硬过滤：开
- Baseline Vector Gate：开
- 自动重建：开
- 纳入当前激活 World Info：开
- lexical threshold：0.78
- semantic threshold：0.84
- semantic lexical floor：0.16
- chunk chars：420
- baseline hint chars：12000

Recall：延续 v5.3 默认参数。

## 迁移

v5.4 会读取旧设置/metadata：

- `aetheriaUnifiedMemoryV53`
- `aetheriaUnifiedMemoryV52`
- `aetheriaUnifiedMemoryV51`

旧 `<memory_ops>` 仍只作为迁移兼容层。详情见 `MIGRATION_V53_TO_V54.md`。

## 安全边界

v5.4 仍然**不直接 splice SillyTavern 的真实聊天数组**。上下文无损裁剪继续保持禁用，直到有经过实机验证的安全 host API。

v5.4 也不会把 API Key 写入 metadata 或 provider fingerprint。

## 参考项目

v5.2–v5.4 的检索分层与“核心记忆可携带 / 向量索引可重建”方向参考了 LittleWhiteBox 的公开文档与仓库：

- https://docs.littlewhitebox.qzz.io/
- https://github.com/RT15548/LittleWhiteBox

尤其参考其公开的 Hybrid Recall、Dense Gate、W-RRF、PPR/图扩散、动态预算、AI 回复后自动后台总结，以及 L0/L1/L2/L3 的分层思路。

本项目根据艾瑟瑞亚 AIRP 的需求独立设计和实现，没有复制 LittleWhiteBox 源码。

## 当前验收边界

自动化测试已覆盖 Semantic Baseline 的纯逻辑、来源范围、硬写入门、向量门控、provider/source fingerprint 重建和 v5.3 既有功能回归。

仍需要真实 SillyTavern 实机测试：

- 多种 Chat Completion provider 的 quiet extraction；
- 实际 Persona / character lore / chat lore / global selective World Info 组合；
- 远程 embedding provider；
- streaming / regenerate / swipe / edit / delete；
- group chat；
- 1000+ / 10000+ memory 性能。
