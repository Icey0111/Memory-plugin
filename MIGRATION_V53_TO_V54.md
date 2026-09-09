# v5.3 → v5.4 Migration

## 目标

从：

```text
后台抽取器主要靠 prompt 避免 Persona / World Info 重复
```

迁移到：

```text
后台抽取
→ schema/evidence
→ Semantic Baseline hard gate
→ Canonical Memory
```

## 1. 安装

用 `aetheria-unified-memory-v5_4` 替换/并行测试 v5.3 扩展目录，启用 SillyTavern `vectors`。

v5.4 会读取：
- `aetheriaUnifiedMemoryV53`
- `aetheriaUnifiedMemoryV52`
- `aetheriaUnifiedMemoryV51`

设置和 chat metadata 会在当前 v5.4 key 下规范化。

## 2. 不需要恢复旧摘要预设

v5.4 延续 v5.3：主模型无需输出 `<summary>` / `<active_state>` / `<memory_ops>`。

## 3. 第一次运行

插件会从当前上下文收集：
- Persona；
- 当前角色卡/可解析群成员；
- Persona/角色/chat 绑定 World Info；
- 当前激活 World Info。

然后生成 Baseline fingerprint，并在 provider 可用时构建独立 Baseline Vector collection。

## 4. 旧记忆

v5.3 的 autonomous extraction transactions 与 Canonical Memory 可继续迁移/重放。

v5.4 **不会仅凭语义相似度破坏性地批量删除所有旧记忆**。硬 Baseline Gate 从新的/重新抽取的 transaction 开始保证写入质量。

如果旧聊天本来存在明显基线污染，建议：
1. 先导出 JSON 备份；
2. 使用“重新抽取最新回复”或“补建缺失历史记忆”逐步修正；
3. 对关键旧污染项人工确认后再清理。

未来可增加带预览/确认的 legacy baseline audit，而不是自动不可逆删除。

## 5. Provider 切换

Embedding provider/model 改变后：
-剧情 Memory Vector 会按原机制 stale；
- Baseline Vector 也会依据 provider fingerprint 自动 stale/rebuild；
- Canonical Memory / Persona / World Info 原文不受影响。

## 6. 回退

v5.4 不删除聊天正文，也不会改写 Persona/World Info。

停用 v5.4 后，正文仍完整；Baseline Vector 只是派生索引。
