---
name: surfingkeys-profile-update
description: Update an existing SurfingKeys builder configuration profile while preserving inheritance, user selections and explicit overrides; explain catalog changes and before/after effects. Use for profile maintenance, not automatic upstream upgrades or browser installation.
---

# 更新 SurfingKeys 配置方案

读取目标方案、完整父链、workspace/来源 lock，并按 [配置方案](../../../docs/configuration.md)核对合并规则；涉及贡献变动时读 [扩展契约](../../../docs/extensions.md)，compare/构建见 [构建与产物](../../../docs/building.md)。架构依据见 [design.md](../../../docs/design.md)。先确定用户指定的 profile ID；只有多个方案且目标不明时才澄清，不对所有方案批量套用同一变化。

先检查目标项目的 CLI 顶层 `--help` 和 package.json。已构建但未安装 bin 时使用 `node <项目绝对路径>/dist-tool/cli.js`，替代本文命令中的 `skcb`。当前提供 catalog、validate、explain、sources lock、build 和 compare。validate/explain 成功表示配置、来源锁、所选源码静态分析与注册冲突检查通过；查看 retainedSymbols 的依赖、保守保留债务和 registrationIR 的有效键及警告。registrationConflictChecks complete、buildReady true 仅表示静态构建条件满足，不能证明工厂预检或浏览器行为。build 成功表示脚本和 report 已发布，浏览器初始化时才执行工厂及完整 callbacks 清单预检。锁缺失或变化时报告原因，不为生成/更新方案擅自刷新 source lock。

执行 CLI 前将 cwd 切换至目标 workspace 文件所在项目根目录，或对每个命令都传同一个 `--workspace <绝对路径>`；所有省略该参数的示例均假定已正确切换 cwd。CLI 就绪时先运行 catalog、validate 和 explain 保存旧有效配置及 provenance。CLI 未就绪时以真实 JSON/清单和契约做静态解析，明确没有运行语义验证。保留旧说明和前后差异，不把操作前已有错误归因于这次变更。

按用户要求修改目标子方案的差量：selectRemove 删除继承的直接选择，不能强制移除其他功能仍需的代码；unsetSettings 删除父字段；overrides 以完整数组替换。用户未要求修改共享父方案时保持它不变；明确要求改父方案时索引全部后代，报告并验证影响。不以减少文件数量为由把子配置上移到父方案。

ID 失效时检查 adapter 映射、来源版本及 catalog migration 证据。只有证据证明同义重命名且符合用户请求才迁移；替代功能会改变行为时提供具体候选和差异供用户决定，不猜 alias/域名，也不静默删除功能。调整 search 或 override 后重新核对 defaultSearchEngine 和两条自动搜索键。

CLI 可用时重新 validate/explain；compare 命令已实现且有上一 buildId 时运行 `skcb compare --profile <id> --against <buildId> --json`，否则比较前后 explain。共享父修改则验证全部后代。展示直接选择、依赖、注册、有效键/alias 和字段来源的变化；report 差异不能替代 build。仅当用户要求构建且 build 已实现时运行 build；source 升级、lock 刷新、扩展实现变化须属于另行授权的任务。

CLI 未实现时做 JSON 语法与静态合并检查，在伴随报告写 `# VERIFY: CLI 就绪后对受影响方案运行 validate/explain/compare；当前未验证构建或浏览器行为`。JSON 不写注释。无法确认的 catalog 项明确标成未验证，不报告成功。

## 视觉方案支持 (Visual Profile Builder)

更新已有配置方案时，亦可通过 HTML 网页视觉方案进行直观审查与差量维护：
- 启动工作区视觉服务：`npm run ui`（或 `node dist-tool/server.js`，运行在 `http://127.0.0.1:3000`），或浏览器直接打开 `ui/index.html`。
- 在“更新已有配置 (Update)”视图中：
  1. 在“选择目标已有配置方案”下拉菜单中载入已有方案（例如 `personal.json` 或 `work.json`），或上传自定义 JSON。
  2. 观察继承自父方案的选择与当前方案的直接选择。
  3. 通过反选或勾选调整 `selectAdd`，在高级区勾选要从父方案移除的功能（`selectRemove`）。
  4. 调整 `settings`、`unsetSettings`、`leaders`、`defaultSearchEngine` 及 `overrides`。
  5. 实时在“前后修改差异 (Profile Diff)”与“有效快捷键概览”中核验变化与有效键，确认无误后点击“保存到工作区”更新方案文件。

交付更新后的实际文件、前后影响和执行过的验证结果。用户没有要求的父方案、扩展源码、来源 lock、上游和 private 文件保持不变；不自动部署或清理旧产物。
