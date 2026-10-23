# HTML 视觉配置方案 (Visual Profile Builder)

为了让用户更直观地选择网站适配、搜索引擎及 Omni Bar 交互，本项目提供了基于 Web 的可视化配置构建器界面（Web UI）。该方案与项目的 `surfingkeys-profile-create` 和 `surfingkeys-profile-update` 两个技能紧密协同，支持配置的新建、探索、差量维护与 Schema 验证。

## 核心特性与架构

1. **双模运行能力**：
   - **本地工作区联动服务模式 (`npm run ui`)**：
     通过本地内置的 Node.js 极简服务（无第三方依赖，原生 HTTP 驱动），实时读取工作区 `surfingkeys.workspace.json`、上游与扩展的真实 catalog 目录，以及 `profiles/` 目录中的全部现有方案；支持在前端实时校验并将新方案或修改一键安全写入工作区文件。
   - **离线独立模式 (`file://ui/index.html`)**：
     整个前端页面为 100% 自包含的 HTML5/CSS3/ES6+ 单页应用，**零远程 CDN 依赖**，完全可在断网、本地文件系统协议下直接双击打开运行。内置核心 catalog 数据，支持本地上传已有 profile JSON，并在浏览器内直接导出/下载配置。

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

- **零外部请求**：HTML 和 CSS/JS 均位于本地 `ui/` 目录下，不使用任何外部 CDN 资源，确保安全隔离与私密性。
- **安全路径边界**：`POST /api/profiles/:id` 严格校验 ID 规范并使用 `inside()` 限制在 `profilesDir` 目录内，严防路径穿越漏洞。
- **无破坏性修改**：UI 工具仅生成和更新 `profiles/` 下的 JSON 数据，不擅自修改上游代码、扩展源码或来源锁。
