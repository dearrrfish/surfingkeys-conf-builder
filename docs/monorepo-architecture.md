# skcb Monorepo 架构与生态指南

## 1. 架构概览

SurfingKeys Config Builder (skcb) v2 采用基于 pnpm 的 Monorepo 模块化架构，将原本耦合的编译器、转写器、原生站点适配与分发工具拆分为高内聚、零循环依赖的独立功能包：

```mermaid
flowchart TD
  subgraph Monorepo ["skcb Monorepo 生态"]
    CORE["@skcb/core\n(编译器 / Schema v2 / CLI)"]
    UI["@skcb/ui\n(可视化面板 / 脚本分发服务)"]
    B0O["@skcb/lib-b0o\n(上游 b0o AOT 转写原子模组)"]
    ENT["@skcb/lib-ent\n(原生娱乐模组: Bilibili/YouTube/Twitter)"]
    TECH["@skcb/lib-tech\n(原生科技模组: GitHub/sspai/SearXNG)"]
    PROD["@skcb/lib-prod\n(原生生产力模组: Gmail/Pinboard)"]
    TEMPLATES["templates/\n(skcb-proj-repo & skcb-lib-repo)"]
    SKILLS["skills/\n(npx skills 兼容 AI 技能)"]
    INIT["scripts/init.sh\n(互动式初始化脚本)"]
  end

  subgraph Consumer ["下游用户个性化项目 (skcb-proj)"]
    USER_PROJ["my-surfingkeys-config"]
    USER_PROFILES["profiles/{common,personal,work}.json"]
    USER_DIST["dist/{personal,work}/surfingkeys.js"]
  end

  CORE --> UI
  CORE --> B0O
  CORE --> ENT
  CORE --> TECH
  CORE --> PROD
  B0O --> USER_PROJ
  ENT --> USER_PROJ
  TECH --> USER_PROJ
  PROD --> USER_PROJ
  CORE --> USER_PROJ
  UI --> USER_PROJ
  TEMPLATES -. degit / init.sh .-> USER_PROJ
```

## 2. Monorepo 组织结构

- **`packages/@skcb/core`**：核心基础库，提供 `surfingkeys.workspace.json` v2、Profile v2 解析器、冲突仲裁引擎、AST 代码分析、增量打包构建器及 `skcb` 命令行工具。
- **`packages/@skcb/ui`**：可视化配置面板、静态 SPA 导出器与脚本分发服务器，提供 `skcb-ui` 命令行工具，支持 `--serve-only` 只读模式、`--token` 访问鉴权以及 `--export-static --out <dir>` 纯静态站点导出（支持 GitHub Pages 子路径托管与双模 PR 保存）。
- **`packages/@skcb/lib-b0o`**：通过 Git Submodule 绑定 `b0o/surfingkeys-conf`（SHA `80176490f6d04c61d10bcbc20618bd283b94ca23`），在 Prepack 编译期将其转写为标准 ESM 原子站点模组与搜索引擎。
- **`packages/@skcb/lib-ent`**：原生娱乐向模组（Bilibili 视频全屏/投币/弹幕、YouTube Piped/Invidious 镜像、Twitter Nitter 镜像）。
- **`packages/@skcb/lib-tech`**：原生科技向模组（GitHub 深度导航与剪贴板打开、sspai 搜索、SearXNG 元搜索、`parseGithubRepo` 工具）。
- **`packages/@skcb/lib-prod`**：原生生产力向模组（Gmail HTML 视图文件夹导航与会话操作、Pinboard 书签保存与阅读清单）。
- **`templates/`**：包含 `skcb-proj-repo`（配置项目模板，内置默认关闭的可选 GitHub Actions Gist 自动化脚本分发 `publish-gist.yml`、GitHub Pages 静态 SPA 部署与 PR 校验工作流 `pages.yml` 及 `scripts/validate-profiles.mjs`）与 `skcb-lib-repo`（第三方模组库模板），零 `workspace:*` 依赖。
- **`scripts/init.sh`**：支持 `curl -fsSL ... | bash` 远程执行的互动式初始化脚本，支持 `/dev/tty` 交互式参数裁剪、`--yes` 静默模式，以及相互独立的 `--gist-action / --no-gist-action` 与 `--pages-action / --no-pages-action` 工作流开关。
- **`skills/`**：兼容 `npx skills` 的 AI 编程助手专属技能，包含 `surfingkeys-profile-create` 与 `surfingkeys-profile-update`。

## 3. 工作区 Schema v2 规范

在用户的配置项目根目录下，`surfingkeys.workspace.json` 使用 v2 规范：

```json
{
  "$schema": "node_modules/@skcb/core/schemas/workspace.schema.json",
  "schemaVersion": 2,
  "libraries": [
    "@skcb/lib-b0o",
    "@skcb/lib-ent",
    "@skcb/lib-tech",
    "@skcb/lib-prod",
    "./extensions/custom"
  ],
  "profilesDir": "profiles",
  "outDir": "dist"
}
```
