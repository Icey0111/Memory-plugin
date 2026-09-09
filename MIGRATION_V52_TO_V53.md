# v5.2 → v5.3 Migration

## 目标

从：

```text
主预设要求 AI 输出 <memory_ops>
```

迁移到：

```text
主 AI 正常回复
→ 插件后台静默抽取
→ Canonical + Vector
```

## 1. 安装 v5.3 插件

安装 `aetheria-unified-memory-v5_3`，并启用 SillyTavern 内置 `vectors`。

## 2. 停用旧预设记忆输出

v5.3 稳定运行后，可以关闭 Kemini 里专门生成：

- `<summary>`
- `<active_state>`
- `<memory_ops>`

的记忆提示词/正则依赖。

主预设恢复只负责角色扮演和正文。

## 3. 旧记忆不会直接丢失

v5.3 会读取 legacy settings/metadata：

- `aetheriaUnifiedMemoryV52`
- `aetheriaUnifiedMemoryV51`

旧聊天中已有 `<memory_ops>` 的 assistant message 可以作为 legacy transaction 重放。

为了避免双份记忆，自动抽取发现该 assistant reply 已携带旧 `<memory_ops>` 时默认跳过 quiet LLM extraction。

## 4. 旧聊天补建

在设置面板点击：

**补建缺失历史记忆**

插件会：

- 跳过已经有 v5.3 extraction record 的 turn；
- 跳过已有 legacy `<memory_ops>` 的 turn；
- 对剩余 assistant turn 逐条 quiet extraction；
- 最后重放 Canonical Store 并同步向量。

注意：大型旧聊天会产生多次 LLM 调用，应按自己的 API 配额使用。

## 5. v5.3 后的新聊天

新聊天无需任何摘要预设支持。

AI 回复结束后自动：

```text
extract → validate → canonical → vector
```

## 6. 回退

v5.3 不删除正文。

Canonical 数据保存在 chat metadata 中，向量只是可重建索引。若要暂时停用 v5.3，可以关闭插件；正文聊天不会因此被修改。
