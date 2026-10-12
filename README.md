# SurfingKeys 配置编译器

从固定上游源码和扩展清单选择功能，为 personal、work 等多个配置方案生成独立的单文件 SurfingKeys 脚本。方案支持单父继承、差量选择、显式覆盖和可解释的依赖闭包；上游保持只读。

当前支持固定版本的 Amazon 站点功能、DuckDuckGo 搜索、本地目录或 Git submodule 扩展，以及 `catalog`、`validate`、`explain`、`build`、`compare` 和显式来源锁刷新。默认 minimal，保留浏览器默认映射。扩展是受信任的 JavaScript；静态校验不提供安全沙箱。

使用 Node 24+。在仓库根目录运行：

```sh
npm ci --cache .cache/npm
npm run build
node dist-tool/cli.js --help
```

准备上游 checkout、配置 workspace 和首次构建的完整步骤见 [快速开始](docs/quickstart.md)。

| 文档 | 内容 |
| --- | --- |
| [配置方案](docs/configuration.md) | workspace、多方案继承、settings、leaders、覆盖与来源锁 |
| [扩展模组](docs/extensions.md) | selective.json、功能 ID、回调工厂和 capability |
| [构建与产物](docs/building.md) | CLI、诊断、build-all、compare、发布与复现 |
| [浏览器使用](docs/browser.md) | 安装、方案切换、前缀键、升级与回退 |
| [开发与测试](docs/development.md) | 实际源码布局、测试入口与验证边界 |
| [项目需求](docs/requirements.md) | 支持范围、质量要求与非目标 |
| [架构设计](docs/design.md) | 功能图/代码图、AST 生成、运行时注册与产物协议 |
| [设计决策](docs/decisions.md) | 长期取舍及兼容性策略 |

项目提供 [创建配置方案 SKILL](.agents/skills/surfingkeys-profile-create/SKILL.md) 和 [更新配置方案 SKILL](.agents/skills/surfingkeys-profile-update/SKILL.md)。它们按真实 catalog 编辑 profile 并调用 CLI，不自动刷新来源、修改共享父方案或安装浏览器配置。
