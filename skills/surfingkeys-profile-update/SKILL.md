---
name: surfingkeys-profile-update
description: Update an existing SurfingKeys builder configuration profile while preserving inheritance, user selections, fine-grained contribution suppressions and explicit overrides; explain catalog changes and before/after effects. Use for profile maintenance, not automatic upstream upgrades or browser installation.
---

# 更新 SurfingKeys 配置方案 (v2 Monorepo)

维护现有方案时，必须基于目标方案与父方案的真实内容工作。先核对当前方案的 `schemaVersion`、继承链与选择范围。参考 [v2 架构契约速查](references/v2-schema.md)。

## 更新工作流

1. **审阅当前配置**：
   - 检查目标方案文件 `profiles/<id>.json` 的 `extends`、`selectAdd`、`selectRemoveContributions` 与 `conflictResolution`。
   - 运行 `skcb explain --profile <id> --json` 获取当前生效按键列表与冲突状态。

2. **按需调整**：
   - **新增功能模组**：在 `selectAdd` 中追加目标模组 ID（如 `ent/actions.bilibili`）。
   - **细粒度关闭快捷键**：在 `selectRemoveContributions` 中追加目标按键（如 `ent/actions.bilibili#danmaku`）。
   - **冲突仲裁升级**：若多个模组覆盖同一站点或快捷键，配置 `conflictResolution: { mode: "module-precedence", modulePrecedence: ["tech", "b0o"] }`。
   - **国际化语言变更**：设置 `locale: "en"` 或 `locale: "zh-CN"`。

3. **校验与验证**：
   - 运行 `skcb validate --profile <id> --json`。
   - 确认无 schema 报错后运行 `skcb build --profile <id>`。
