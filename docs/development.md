# 开发与测试

Node 24+，依赖由 package-lock.json 固定，安装到项目本地。精确 Node 版本进入 buildId；跨环境复现需统一该版本与依赖锁。源码和编译后的 CLI 分开，`npm run build` 输出 dist-tool。

## 源码布局

| 文件 | 责任 |
| --- | --- |
| src/cli.ts、input.ts、types.ts | CLI、路径/JSON/schema/诊断与数据类型 |
| src/catalog.ts、profiles.ts | 静态功能目录、功能依赖与方案继承 |
| src/source-paths.ts、sources.ts | 私有/排除输入、摘要锁与来源读写协调 |
| src/code-analysis.ts | Babel AST、绑定/成员依赖、ESM及未知模式检查 |
| src/generation.ts、registration.ts | 生成副本、回调预检与有效键位/冲突计划 |
| src/bundler.ts、build.ts | Webpack、身份/report校验、发布与compare |
| schemas/ | workspace/profile/manifest/lock/current/report 的 JSON schema |
| examples/basic/ | 多方案与本地 notes 扩展示例 |
| tests/ | 行为、路径边界、发布、复现和真实浏览器测试 |

## 常规检查

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

npm test 的 pretest 会编译工具。实际上游集成用例需要固定版本 checkout；tests/helpers.ts 默认查找项目相邻的 surfingkeys-conf，也可用 SKCB_TEST_UPSTREAM 指定路径。来源缺失时对应测试跳过，应核对结果中的 skip，不能把跳过称为通过。

可按修改范围使用 test:profiles、test:extensions、test:cli、test:adapter、test:upstream-integrity、test:publication、test:build、test:generator、test:registration、test:reproducibility。完整入口以 [package.json](../package.json)为准。

测试应验证可观察结果：选择不自动注册依赖提供者、完整回调预检失败时零注册、闭包/模块身份保留、路径与来源不逃逸、失败保持旧 current、不同方案隔离。公共模块保守保留、未知 AST 模式失败和许可输出属于维护契约。

## 真实浏览器测试

准备官方 SurfingKeys 的 unpacked 扩展目录和支持 CDP Extensions.loadUnpacked 的 Chrome 测试浏览器；该 CDP 能力取决于浏览器版本。扩展来源与内容需由操作者核对，测试不会自动下载。使用现有 google-chrome，或通过 SKCB_BROWSER_BINARY 指定兼容可执行文件。

```sh
SKCB_TEST_UPSTREAM=/path/to/surfingkeys-conf SKCB_BROWSER_EXTENSION=/path/to/unpacked-surfingkeys npm run test:browser
```

替换两个路径为实际输入。显式 test:browser 没有扩展目录时退出 2；普通 npm test 未设置该目录时跳过浏览器项。测试要求 MV3 扩展，在项目 .cache 中创建独立 profile，通过真实扩展设置消息加载生成脚本并发送 CDP 键盘事件；不读取个人 profile。

HTTPS 文档和补全响应由受控 fixture 提供，验证 hints、导航、Omnibar、有效范围、默认键、前缀和方案恢复。购物回调只作用于 fixture。真实网站 DOM与实时网络服务仍需单独检查；受控测试不能替代它们。测试结束只终止自己创建的 Chrome 进程。

## 维护边界

复现用例覆盖不同 workspace/扩展根及目录层级，但共享同一物理上游 checkout；不同上游物理根的复现仍需单独验证。发布失败用内部故障钩子验证，不等同于 OS rename 故障注入。来源标记不自动恢复，旧产物不自动清理。

新增上游功能先定义目录与适配规则，再补形状/依赖/生成/注册行为测试。JSON schema 接受不代表解析器已支持该功能；不要让 SKILL 暴露尚未实现的 ID。依赖审计单独运行和处理，不从编译/测试通过推断审计清零。
