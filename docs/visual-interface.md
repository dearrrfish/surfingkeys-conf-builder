# HTML 视觉配置方案 (Visual Profile Builder)

为了让用户更直观地选择网站适配、搜索引擎及 Omni Bar 交互，本项目提供了基于 Web 的可视化配置构建器界面（Web UI）。该方案与项目的 `surfingkeys-profile-create` 和 `surfingkeys-profile-update` 两个技能紧密协同，支持配置的新建、探索、差量维护与 Schema 验证。

> **架构与主维护路径说明**：
> - **`packages/ui` (`@skcb/ui`)** 是当前 Monorepo 的主要可视化配置面板、静态导出工具与本地脚本分发服务（提供 `skcb-ui` CLI 及 `packages/ui/ui/index.html`）。
> - 仓库根目录下的 `ui/index.html` 与 `src/server.ts`（编译至 `dist-tool/server.js`）为早期单包阶段的兼容遗留实现，仅用于向后兼容旧测试，新特性（如静态站点导出、GitHub Pages 托管与双模 PR 保存）均在 `@skcb/ui` 中提供。

## 核心特性与架构

1. **三模运行能力**：
   - **本地工作区联动服务模式 (`npx skcb-ui` / `npm run ui`)**：
     通过本地内置的 Node.js 极简服务（无第三方依赖，原生 HTTP 驱动），实时读取工作区 `surfingkeys.workspace.json`、上游与扩展的真实 catalog 目录，以及 `profiles/` 目录中的全部现有方案；支持在前端实时校验并将新方案或修改一键安全写入工作区文件，同时提供编译后脚本的本地分发。
   - **GitHub Pages 静态 SPA 模式 (`npx skcb-ui --export-static --out .pages`)**：
     将可视化配置器导出为纯静态单页应用（含 `index.html`、`data/catalog.json`、`data/profiles.json`、`manifest.json` 与 `.nojekyll`），天然支持挂载在 `https://<owner>.github.io/<repo>/` 等子路径下运行。静态模式零 `/api/*` 调用，支持通过 **PAT 直连模式** 或 **GitHub 网页模式（零 Token）** 将新建/修改的 Profile 提交为 GitHub Pull Request。
   - **离线独立模式 (`file://`)**：
     整个前端页面为 100% 自包含的 HTML5/CSS3/ES6+ 单页应用，**零远程 CDN 依赖**，完全可在断网、本地文件系统协议下直接双击打开运行。支持本地上传已有 profile JSON，并在浏览器内直接导出/下载配置。

2. **两大核心工作流**：
   - **Create 技能流（创建新方案）**：
     - 选择组合 -> 实时有效键预览与 Schema 校验 -> 保存新方案。
     - 支持配置方案 ID（严格 kebab-case 校验）、单父继承（`extends`）、`base: minimal`、快捷键前缀（`leaders.site` 与 `leaders.search`）。
     - 提供卡片式多选：网站专属适配（如 Amazon 等）与搜索引擎（如 DuckDuckGo 等）。
     - Omni Bar 支持联动：展示激活键（`leaders.search + alias`）及剪贴板搜索键（`c + leaders.search + alias`），并根据勾选的引擎动态限制 `defaultSearchEngine` 下拉选项。
   - **Update 技能流（更新已有配置）**：
     - 选择已有配置 -> 载入继承链与直接选择 -> 差量编辑与 Diff 对比 -> 保存更新。
     - 能够直观区分从父方案继承而来的功能和当前子方案的增量功能。
     - 支持添加新功能（`selectAdd`）、差量剔除父方案功能（`selectRemove`）、配置重置（`unsetSettings`）与按键覆盖（`overrides`）。
     - 提供实时 JSON Diff 视图，清晰掌握改动细节。

## 启动与使用方式

### 方式一：命令行与 npm 脚本启动（推荐）

项目在 `package.json` 与 `bin` 中内置了多种命令模式，供用户快速进入网页视觉构建器：

1. **npm script 快速启动**（开发/维护常用）：
   ```sh
   npm run ui
   # 或
   npm run serve
   ```
   该命令会自动完成 TypeScript 增量编译并启动本地 HTTP 服务（默认端口 3000）。

2. **直接执行 CLI 可执行命令**：
   ```sh
   ./dist-tool/server.js
   # 或指定工作区与端口
   ./dist-tool/server.js --port 8080 --workspace ./my-config/surfingkeys.workspace.json
   ```

3. **包管理器 bin 链接命令**：
   在 `package.json` 的 `bin` 中已注册 `skcb-ui`（与核心编译器 `skcb` 并列）：
   ```sh
   npx skcb-ui
   ```

服务启动后，终端将输出：
```
⚡ SurfingKeys Visual Configuration Web UI ready: http://127.0.0.1:3000
   Workspace: surfingkeys.workspace.json
```
在现代浏览器中访问 `http://127.0.0.1:3000` 即可开始使用。

### 方式二：浏览器离线直接打开（零安装/零服务）

直接在浏览器中打开工作区内的本地 HTML 文件：
```sh
xdg-open ui/index.html
# 或在文件管理器中双击 ui/index.html
```

页面右上方状态药丸会显示为 `离线/独立模式 (file://)`。在此模式下：
- 使用内置的 Amazon、DuckDuckGo 及笔记插件功能目录。
- 能够填写表单、选择功能并实时校验生成的 JSON。
- 通过【下载】按钮导出为 `.json` 文件并放置到工作区的 `profiles/` 目录下。

## REST API 契约（工作区服务端）

本地服务提供以下只读与受限写入端点：

| 方法与路径 | 说明 | 输入/输出格式 |
| --- | --- | --- |
| `GET /api/workspace` | 获取当前工作区元信息与目录路径 | `{ ok: true, workspace: { root, upstream, profilesDir, outDir } }` |
| `GET /api/catalog` | 获取所有网站适配与搜索引擎的元数据目录 | `{ ok: true, catalog: { entries: [...], capabilities: {...} } }` |
| `GET /api/profiles` | 扫描并列出 `profilesDir` 下的所有已有 profile | `{ ok: true, profiles: [ { id, abstract, extends, file } ] }` |
| `GET /api/profiles/:id` | 获取指定 profile 的原文及 JSON 对象 | `{ ok: true, profile: {...}, raw: "..." }` |
| `POST /api/validate` | 对提交的 profile JSON 进行 Schema 与冲突校验 | 请求: `{ profile: {...} }`；响应: `{ ok: boolean, diagnostics?: [...] }` |
| `POST /api/profiles/:id` | 将合法 profile 写入 `profilesDir/<id>.json`（防目录穿越） | 请求: `{ profile: {...} }`；响应: `{ ok: true, saved: "profiles/<id>.json" }` |
| `POST /api/build` | 根据前端实时配置执行完整切片打包并生成最终 `surfingkeys.js` | 请求: `{ profile: {...}, mode?: "production" }`；响应: `{ ok: true, buildId, scriptPath, scriptContent, outputs, ... }` |

## 根据实时配置构建最终 SurfingKeys 脚本

在网页界面中设计或编辑好方案后，用户无需返回终端敲击 CLI 命令，即可直接点击右侧预览区的 **【🔨 构建脚本】** 按钮：

1. **自动前置保存与全量编译**：
   - 服务端接收实时 profile 配置，自动校验 schema 并在工作区 `profiles/` 写入合法配置。
   - 触发全套 AST 代码切片分析、上游许可提取与 Webpack IIFE 打包流程，产出独立哈希签名的不可变 build 目录。
2. **构建成果浮层与即时验证**：
   - 弹出“🎉 最终 SurfingKeys 脚本构建成功”浮层。
   - 展现 Build ID、脚本大小（KB/字节）、包含功能数、第三方打包依赖库（如 dompurify, uhtml）及落盘路径（`dist/<id>/builds/<buildId>/surfingkeys.js`）。
   - 内置代码预览查看器，可直接查看生成的完整 JavaScript 脚本。
3. **一键复制与下载安装**：
   - **【📋 复制脚本内容】**：将整份 `surfingkeys.js` 复制到剪贴板，直接粘贴到浏览器 SurfingKeys 选项页的配置框中保存生效。
   - **【💾 下载 surfingkeys.js】**：直接下载编译好的脚本文件。
4. **离线独立模式兼容**：
   - 在未启动后台服务的离线静态模式下，点击构建会自动调用前端内置的代码生成器，生成可直接在 SurfingKeys 中运行的客户端 JavaScript 配置片段，同样支持一键预览、复制与下载。

## 安全性与代码完整性

- **零外部请求（本地/离线模式）**：HTML 和 CSS/JS 均内联在本地静态页面中，不使用任何外部 CDN 资源；页面内建严格 CSP（`connect-src 'self' https://api.github.com`），在静态模式下仅允许连接同源静态数据与 `https://api.github.com`。
- **安全路径边界**：`POST /api/profiles/:id` 与 `POST /api/profiles/save` 严格校验 ID 规范并使用 `inside()` 限制在 `profilesDir` 目录内，严防路径穿越漏洞。
- **静态导出安全与原子替换**：`exportStaticSite()` 校验输出目录不得等于或包含工作区根目录、不得位于 `profilesDir` 或扩展源码目录内、不得包含符号链接祖先；仅允许覆盖空目录或带有 `manifest.json` (`generator: "skcb-static"`) 的历史导出目录，并通过临时目录原子替换。
- **无破坏性修改**：UI 工具仅生成和更新 `profiles/` 下的 JSON 数据，不擅自修改上游代码、扩展源码或来源锁。

## 静态站点导出与 GitHub Pages 部署 (`@skcb/ui`)

### 1. 静态导出命令 (`--export-static`)

`@skcb/ui` 支持在不启动常驻 HTTP 服务的情况下，将工作区元数据与前端 SPA 导出为纯静态目录：

```sh
npx skcb-ui --export-static --out .pages \
  --workspace surfingkeys.workspace.json \
  --repository <owner>/<repo> \
  --base-branch main \
  --json
```

如果在 GitHub Actions 中运行，若未显式传入 `--repository` 与 `--base-branch`，工具会自动回退读取环境变量 `GITHUB_REPOSITORY` 与 `GITHUB_REF_NAME`。

导出的静态目录固定包含以下 5 个文件（均使用相对路径，兼容任意子路径托管）：
- `index.html`：注入了 `<script id="skcb-static-config" type="application/json">` 静态配置与严格 CSP 的单页应用。
- `data/catalog.json`：站点适配、搜索引擎与原子能力的公开元数据目录（已剥离本地绝对路径）。
- `data/profiles.json`：工作区现有方案的轻量级元数据列表（仅含 `id`、`abstract`、`extends`、`locale`、`file`）。
- `manifest.json`：标识 `generator: "skcb-static"`、导出时间、仓库与文件清单。
- `.nojekyll`：避免 GitHub Pages 进行 Jekyll 处理。

### 2. 公开数据与隐私安全边界

- **GitHub Pages 公开性提醒**：即使源码仓库为私有仓库，GitHub Pages 默认也是公开可访问的站点（除非使用 GitHub Enterprise 私有 Pages）。
- **最小公开数据原则**：静态导出绝不包含各 Profile 的完整正文（`settings`、`selectAdd`、`selectRemove`、`keybindings`、`overrides` 等）、编译产物 `dist/**/surfingkeys.js`、`report.json`、`builds/`、`sources.lock.json`、本地绝对路径或任何凭证。
- **按需读取已有 Profile 正文**：在静态 SPA 中切换已有 Profile 时，前端不会从静态站点加载完整配置；若已配置 PAT，前端通过 GitHub REST API (`GET /repos/{owner}/{repo}/contents/{path}?ref={baseBranch}`) 实时拉取并解码 Base64 内容；若未配置 PAT，则提示用户输入 PAT 加载正文或使用 GitHub 网页模式直接编辑。

### 3. 双模保存与 PR 提交流程

静态模式下，页面禁用所有 `/api/*` 请求（编辑操作不会触发 `/api/profiles/save`，点击构建按钮不会请求 `/api/build`，而是提示脚本分发仍由本地服务或 Gist 负责）。用户可通过顶部栏或构建器底部的 **【🔀 保存并创建 PR】** 按钮打开保存浮层，在两种模式间自由切换（切换模式不会丢失当前编辑草稿）：

#### 模式 A：PAT 直连模式 (GitHub API Direct Mode)
- **适用场景**：频繁新建/修改配置，希望在页面内一键读取远端 Profile 正文并自动创建分支、提交文件与发起 Pull Request。
- **最小权限要求（推荐 Fine-grained PAT）**：
  - **Repository access**：仅勾选目标配置仓库（`Only select repositories`）。
  - **Repository permissions**：
    - `Contents`: **Read and write**（读取已有 Profile、创建分支与提交 JSON 文件）
    - `Pull requests`: **Read and write**（创建与查询 Pull Request）
    - `Metadata`: **Read**（默认自动勾选）
  - 建议设置较短有效期（如 7–30 天）。
- **安全存储策略**：
  - **默认仅保存在当前页面内存中**（`#pr-check-remember` 默认不勾选），刷新或关闭标签页后自动失效。
  - 仅当用户显式勾选“记住 PAT”时，才写入 `localStorage`（键名为 `skcb.github.pat.<owner>/<repo>`）。
  - **同源与 XSS 风险提示**：所有托管在 `https://<owner>.github.io/<repo>/` 下的项目站点共享同一个浏览器源 `https://<owner>.github.io`，这意味着同一账号下其他项目 Pages 或任何 XSS 脚本均可读取 `localStorage`。界面内置 **【清除 PAT】** 按钮，可随时一键清空内存与 `localStorage` 中的凭证。
- **幂等保护与错误恢复**：
  - 若远端同名 Profile 已存在但当前会话尚未通过 PAT 加载正文，拒绝直接覆盖（`ALREADY_EXISTS`）。
  - 若远端文件在加载后已被他人修改，拒绝盲目覆盖（`REMOTE_CHANGED`）并提示重新加载。
  - 若提交内容与远端基线规范化后完全一致，直接提示无变更（`noop`），不创建空分支或重复 PR。
  - 使用确定性分支名 `skcb/profile/<id>-<hash12>`；若分支已存在且内容一致则自动复用，若 PR 已存在则返回现有 PR 链接；若分支与文件提交成功但创建 PR 失败，界面绝不谎报保存成功，而是展示已推送分支名与一键手动开启 PR 的恢复链接（`https://github.com/<owner>/<repo>/compare/<base>...<branch>?expand=1`）。

#### 模式 B：GitHub 网页模式 (Token-Free Web Mode)
- **适用场景**：偶尔修改配置、不想创建或输入任何 PAT。
- **零凭证保证**：此模式不读取、不保存、不发送任何 Token，也不向 `api.github.com` 发起任何写请求。
- **工作流与防覆盖保护**：
  - **新建 Profile** 或 **已通过 PAT 加载正文的已有 Profile**：自动将当前规范化 Profile JSON 复制到剪贴板，并在新标签页打开 GitHub 网页新建页（`https://github.com/<owner>/<repo>/new/<branch>?filename=profiles%2F<id>.json`，URL 仅携带文件名而不携带配置正文）或编辑页（`https://github.com/<owner>/<repo>/edit/<branch>/profiles/<id>.json`），引导用户粘贴、选择“Create a new branch for this commit and start a pull request”并提交。
  - **未加载正文的已有 Profile**：仅打开远端文件的 GitHub 网页编辑页，**不会**用前端默认空模板覆盖剪贴板，并明确提醒用户先在 GitHub 网页中查看/编辑原文件，或先通过 PAT 加载远端正文，防止误将远端配置覆盖为空白模板。
  - **剪贴板与弹窗降级**：提醒用户剪贴板内容可能被系统其他应用读取；若浏览器拦截弹窗（`window.open` 返回 `null`），浮层内提供显式可点击的跳转链接；若剪贴板写入失败，自动展开只读文本框供手动全选复制。

### 4. 内置帮助与安全指南 (`#help-dialog`)

点击顶部导航栏的 **【? 帮助指南】** 按钮（或静态模式首次访问横幅中的指南入口），可随时打开支持中英双语的帮助浮层，查阅：
1. 快速开始工作流
2. Fine-grained PAT 创建步骤与最小权限表
3. GitHub Pages 启用步骤（`Settings -> Pages -> Source: GitHub Actions` 及仓库变量 `PAGES_DEPLOY_ENABLED=true`）
4. 双模保存对比（PAT 直连模式 vs GitHub 网页模式）
5. 安全与隐私风险说明（Pages 公开性、敏感配置提醒、`localStorage` 同源共享与 XSS 风险、清除 PAT 方法）
6. 常见错误排查与恢复（401/403 限流或权限不足/404/409/422/429、弹窗拦截、剪贴板失败恢复）
