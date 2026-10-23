---
name: surfingkeys-profile-create
description: Generate a new SurfingKeys builder configuration profile from user requirements and a supported feature catalog, including parent inheritance, granular contribution toggling, conflict resolution modes and selection diagnostics. Use for creating builder profile JSON, not standalone SurfingKeys JavaScript.
---

# 创建 SurfingKeys 配置方案 (v2 Monorepo)

先找到目标仓库的 `surfingkeys.workspace.json` 和设计契约。参考 [v2 架构契约速查](references/v2-schema.md)。配置方案是 profiles 中的 JSON 数据；回调代码属于功能模组（`@skcb/lib-*` 或本地扩展），不直接写进 JSON。

## 方案结构与字段 (Profile Schema v2)

1. **基本元数据**：
   - `schemaVersion`: 必须为 `1` 或 `2`（推荐 `2`）。
   - `id`: 方案唯一标识符（kebab-case，如 `personal`, `work-laptop`）。
   - `abstract`: 布尔值。若为 `true` 则作为基类方案供继承，CLI `build --all` 时自动忽略构建。
   - `extends`: 相对路径指向父级方案（如 `common.json`）。
   - `base`: 目前仅支持 `"minimal"`。
   - `locale`: 描述目标语言，支持 `"en"` 或 `"zh-CN"`（默认 `"zh-CN"`）。

2. **功能模组选择与细粒度按键裁剪**：
   - `selectAdd`: 数组，选取的原子 Entry ID（如 `["b0o/actions.amazon", "ent/actions.bilibili", "tech/actions.github", "prod/actions.gmail"]`）。
   - `selectRemove`: 数组，在继承父级方案时完全移除某个 Entry。
   - `selectRemoveContributions`: 数组，一等公民的 Contribution 细粒度禁用（如 `["ent/actions.bilibili#danmaku", "b0o/actions.amazon#fakespot"]`），无需移除整个模组即可自由关闭个别快捷键。

3. **冲突解决策略 (Conflict Resolution)**：
   - `conflictResolution.mode`:
     - `"strict"`: 严格模式，存在相同域名同按键冲突时中断并报错 `REGISTRATION_CONFLICT`。
     - `"module-precedence"`: 按模组优先级自动仲裁冲突，配合 `modulePrecedence: ["tech", "b0o"]`。
     - `"prefer-later"`: 优先保留后声明的模块。

4. **快捷键前缀与设置**：
   - `leaders`: `{ "site": "<Space>", "search": "a" }`。
   - `settings`: 自定义全局设置（如 `theme`, `defaultSearchEngine`）。
   - `overrides`: 显式快捷键替换规则。

## 验证与构建命令

- `skcb catalog`: 检查当前工作区已声明的全部功能模组。
- `skcb explain --profile <id> --json`: 检查解析结果、有效键位分布与冲突诊断。
- `skcb build --profile <id>`: 生成最终的 `surfingkeys.js` 脚本与 `report.json`。
- 启动可视化配置服务：`skcb-ui --workspace surfingkeys.workspace.json --port 3000`。
