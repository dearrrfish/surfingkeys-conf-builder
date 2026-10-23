---
name: surfingkeys-profile-create
description: Generate a new SurfingKeys builder configuration profile from user requirements and a supported feature catalog, including parent inheritance and selection diagnostics. Use for creating builder profile JSON, not standalone SurfingKeys JavaScript.
---

# 创建 SurfingKeys 配置方案

先找到目标仓库的 `surfingkeys.workspace.json` 和设计契约。先读 [配置方案](../../../docs/configuration.md)；涉及模组时读 [扩展契约](../../../docs/extensions.md)，诊断/构建见 [构建与产物](../../../docs/building.md)。架构依据位于 [design.md](../../../docs/design.md)。配置方案是 profiles 中的 JSON 数据；回调代码属于扩展，不写进 JSON。

使用真实目录决定功能 ID。先检查目标项目的 CLI 顶层 `--help` 和 package.json。已构建但未安装 bin 时使用 `node <项目绝对路径>/dist-tool/cli.js`，替代本文命令中的 `skcb`。当前提供 catalog、validate、explain、sources lock、build 和 compare。validate/explain 成功表示配置、来源锁、所选源码静态分析与注册冲突检查通过；查看 retainedSymbols 的依赖、保守保留债务和 registrationIR 的有效键及警告。registrationConflictChecks complete、buildReady true 仅表示静态构建条件满足，不能证明工厂预检或浏览器行为。build 成功表示脚本和 report 已发布，浏览器初始化时才执行工厂及完整 callbacks 清单预检。锁缺失或变化时报告原因，不为生成/更新方案擅自刷新 source lock。

执行 CLI 前将 cwd 切换至目标 workspace 文件所在项目根目录，或对每个命令都传同一个 `--workspace <绝对路径>`；所有省略该参数的示例均假定已正确切换 cwd。CLI 就绪时运行 `skcb catalog --workspace <path> --json`；未就绪时只依据已有 manifest、适配器映射或设计已列出的 ID 生成草案，不捏造能力或认为所有上游项都已支持。输入缺失但不阻碍草案时记录依据和限制；只有缺失会改变用户所需功能才请求澄清。

创建唯一 kebab-case id 的新文件，不覆盖现有方案。优先复用合适的父方案，按单父继承写 `selectAdd/selectRemove`；默认 minimal。检查继承后的选择和字段来源；选搜索不等于选站点功能，capability 不等于自动注册。显式 defaultSearchEngine 必须匹配有效选择中的搜索 alias，不从 feature ID 猜 alias。

配置信息来自本文契约：schemaVersion、id、abstract、extends、base、selectAdd/selectRemove、settings/unsetSettings、leaders、overrides。没有需求就省略可选项，不追加未知字段。扩展未存在时说明目录缺口，不能顺手创造其实现或更新 sources lock。冲突用实际有效键及 contribution ID 解释；只有用户明确指定替换才能加入 override。

所需命令已在 CLI 帮助中提供时运行 `skcb validate --profile <id> --json` 和 `skcb explain --profile <id> --json`；消除输入错误后展示用户直接选择、自动依赖、字段来源、静态贡献及 alias、剩余警告；完整有效键/注册冲突分析未实现时明确待验证。用户要求构建且 build 已实现时再运行 `skcb build --profile <id>`；配置生成本身不授权安装到浏览器、下载来源或修改上游。

CLI 未实现时做 JSON 语法与本文合并规则的静态检查，在伴随说明写 `# VERIFY: CLI 就绪后对 <id> 运行 validate/explain；目前只完成草案静态检查`。JSON 文件不能含注释，不声称语义验证或构建已通过。

## 视觉方案支持 (Visual Profile Builder)

除了命令行与文本模式，项目提供 HTML 网页视觉方案供用户可视化选择网站适配与搜索引擎、Omni Bar 支持来组合并保存新方案：
- 启动工作区视觉服务：`npm run ui`（或 `node dist-tool/server.js`，默认运行在 `http://127.0.0.1:3000`）。
- 离线独立模式：直接在浏览器打开 `ui/index.html`（无需后端，支持本地导出与导入）。
- 在“创建新方案 (Create)”视图中：
  1. 输入 kebab-case 方案 ID、选择父级方案（如 `./common.json`）与快捷键前缀（`leaders.site` 与 `leaders.search`）。
  2. 在“网站专属适配”区可视化勾选 Amazon 等站点功能，卡片展示域名与生效快捷键。
  3. 在“搜索引擎与 Omni Bar 支持”区勾选 DuckDuckGo 等，自动展示 Omni Bar 激活键（`adu`/`cadu`）并联动选择 `defaultSearchEngine`。
  4. 实时核对有效按键预览与 Schema 校验，通过“保存到工作区”或“下载”保存为 `profiles/<id>.json`。

交付实际 profile 文件和简洁影响说明，记录验证命令及结果。仅编辑目标新方案；不修改共享父方案、扩展源码、source lock 或用户私有配置。
