# 快速开始

需要 Node 24+、npm，以及已有的 [b0o/surfingkeys-conf](https://github.com/b0o/surfingkeys-conf) Git checkout。当前 `b0o-v1` 适配器只接受 SHA `80176490f6d04c61d10bcbc20618bd283b94ca23`；其他版本会失败。构建器不会自动克隆、下载或切换上游。

## 1. 安装并编译工具

在本仓库根目录运行：

```sh
npm ci --cache .cache/npm
npm run build
node dist-tool/cli.js --help
```

`npm run build` 编译 CLI 到 dist-tool，不生成浏览器配置。

## 2. 准备独立配置工作区

复制版本化示例，保留其 custom/notes 和 profiles：

```sh
cp -R examples/basic my-config
```

编辑 `my-config/surfingkeys.workspace.json` 的 `upstream.path`，指向你的固定版本 checkout。相对路径以 workspace 文件所在目录为基准；也可使用绝对路径。不要直接沿用示例中的路径而跳过检查。可先核对上游版本：

```sh
git -C /path/to/surfingkeys-conf rev-parse HEAD
```

该路径需替换为实际 checkout。Git 来源必须干净；来源根不能等于或包含配置工作区根。workspace 的扩展、方案和输出路径说明见 [配置方案](configuration.md)。

示例中的 common 是 abstract 父方案，选择 DDG；personal 增加 Amazon 和 notes 动作；work 增加 notes 搜索并使用其 alias nt。notes.example.com 是演示域名，需替换为自己的站点时按 [扩展契约](extensions.md)修改清单与实现。

## 3. 建立来源锁并检查方案

以下命令均在工具仓库根目录执行，并显式指定同一个 workspace：

```sh
node dist-tool/cli.js catalog --workspace my-config/surfingkeys.workspace.json --json
node dist-tool/cli.js sources lock --workspace my-config/surfingkeys.workspace.json --refresh --json
node dist-tool/cli.js validate --workspace my-config/surfingkeys.workspace.json --profile personal --json
node dist-tool/cli.js explain --workspace my-config/surfingkeys.workspace.json --profile personal --json
```

首次初始化或有意更新来源后才刷新锁。摘要不匹配时先确认具体变化；锁刷新只记录现有输入，不升级代码。

## 4. 构建并安装

```sh
node dist-tool/cli.js build --workspace my-config/surfingkeys.workspace.json --profile personal --json
node dist-tool/cli.js build --workspace my-config/surfingkeys.workspace.json --all --json
```

成功输出包含 buildId、scriptPath 和 reportPath。读取对应 surfingkeys.js，按 [浏览器使用](browser.md)安装到 SurfingKeys。build-all 排除 abstract 父方案，各方案分别发布。

`validate/explain` 成功和 `buildReady: true` 只表示静态分析通过。工厂检查、浏览器键盘行为和网站服务仍需分别验证。详细诊断和产物格式见 [构建与产物](building.md)。

## 5. 网页视觉配置方案 (Web UI)

除了命令行外，项目还提供网页视觉交互方案，供用户通过图形界面选择网站适配、搜索引擎及 Omni Bar 交互，支持方案创建与更新：

```sh
npm run ui
# 或
npm run serve
# 或直接运行可执行脚本
./dist-tool/server.js --workspace my-config/surfingkeys.workspace.json
```

或直接在浏览器打开本地 `ui/index.html`。详细使用方法与 API 请参见 [HTML 视觉配置方案](visual-interface.md)。
