# 构建与产物

编译 CLI 后，使用 `node dist-tool/cli.js`；安装了本项目 bin 的环境也可使用 skcb。以下命令在工具仓库根执行，workspace 始终指向同一个文件。

## CLI

```sh
node dist-tool/cli.js --help
node dist-tool/cli.js catalog --workspace my-config/surfingkeys.workspace.json --json
node dist-tool/cli.js validate --workspace my-config/surfingkeys.workspace.json --profile personal --json
node dist-tool/cli.js explain --workspace my-config/surfingkeys.workspace.json --profile personal --json
node dist-tool/cli.js build --workspace my-config/surfingkeys.workspace.json --profile personal --json
node dist-tool/cli.js build --workspace my-config/surfingkeys.workspace.json --all --json
```

catalog 读取静态元数据，仍要求受支持上游 SHA，但不验证来源锁或分析所选实现。validate/explain 复核锁、解析方案、做 AST 依赖分析和有效注册冲突检查，不执行贡献代码。查看 requested/resolved、reasons、retainedSymbols、registrationIR、provenance 与 optimizationDebt。

codeAnalysis/registrationConflictChecks complete、buildReady true 表示静态构建条件满足。build 成功表示脚本和报告已发布；工厂及完整回调预检发生在浏览器初始化，不是 Node 构建结果。首版没有 watch/install/fetch/rollback 命令。

## 单方案和批量构建

默认 production；可用 `--mode development` 明确切换。两种模式都输出单个 IIFE，无 sourcemap、动态分块和磁盘编译缓存，保留注释而不压缩。不同模式进入构建身份。

build-all 跳过 abstract 方案，每个方案独立报告成功或失败。某方案失败不撤销其他方案已完成发布；批量退出非零。单方案同时构建返回 BUILD_BUSY；不同方案可以并行。

成功 BuildResult 包含 profileId、buildId、inputHash、outputHash、scriptPath、reportPath 和 current 路径。编程接口 `buildWithSelectives({workspacePath, profileId, mode?})` 定义在 [build.ts](../src/build.ts)；CLI 不接受测试故障注入钩子。

## 输出目录

```text
dist/<profile>/
  current.json
  builds/<buildId>/
    surfingkeys.js
    report.json
    THIRD_PARTY_NOTICES.txt
    generated/
```

dist 由 workspace.outDir 决定。generated 是源码副本，不手改；修改输入后重建。current 含相对 artifacts 路径及摘要，按 [current schema](../schemas/current.schema.json)读取。report 按 [report schema](../schemas/report.schema.json)记录有效方案、输入身份、依赖图/原因、贡献/覆盖、实际打包依赖、生成文件和输出摘要。交付脚本时保留许可入口和 notices。

构建先写同方案独立 staging，验证全部文件后发布不可变 build 目录，最后原子 rename 替换 current。失败保持旧指针；旧目录不自动删除。重复 buildId 复用前仍校验既有 script/report/notices，坏产物明确报错。输出各级目录必须为真实目录，拒绝 symlink 祖先。

## Compare

取得已有同方案 buildId 后，替换下列命令中的 `<buildId>`：

```sh
node dist-tool/cli.js compare --workspace my-config/surfingkeys.workspace.json --profile personal --against <buildId> --json
```

compare 校验旧 report 的 schema、身份与分析一致性、图结构及输出摘要，再与当前静态分析比较。它不要求旧源码仍在磁盘，也不创建新 build。无旧产物、坏报告或错误 buildId 会失败。

旧 packages 是实际打包依赖，当前 currentStaticDependencies 是静态分析依赖；输出将二者分层展示，不承诺它们是相同层次的完整包差异。比较后仍需 build 和浏览器验证。

## 诊断与恢复

所有 CLI 结果为 JSON。成功写 stdout；失败带 diagnostics，不混入普通通知。

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 2 | 配置/schema、路径、选择、冲突、来源摘要或旧 compare 产物问题 |
| 3 | 上游 SHA/AST 形状或适配规则不支持 |
| 4 | I/O、工具链、打包、发布或锁占用问题 |

锁和来源读标记只协调本工具进程，不能阻止编辑器改来源；构建捕获后和发布前仍复核摘要。中断 marker 不自动按 PID 清理。恢复前确认没有活动构建、旧产物完整、具体 marker/staging 的归属，再处理遗留文件；没有自动恢复命令。

buildId 绑定规范方案/分析、逻辑来源 SHA与内容、工具链锁、builder实现、Node精确版本和模式，不包含机器绝对路径或时间。复现时保持全部身份输入一致；公共 util/已选入口可保守留存，并在报告中解释。
