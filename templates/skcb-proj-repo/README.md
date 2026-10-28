# My SurfingKeys Configuration

基于 [SurfingKeys Config Builder (skcb)](https://github.com/b0o/surfingkeys-conf-builder) 构建的模块化、类型安全的个人 SurfingKeys 配置项目。

## 快速开始

```bash
# 1. 安装依赖
pnpm install # or npm install

# 2. 检查可用模组
npm run catalog

# 3. 校验并分析方案
npm run explain

# 4. 构建所有目标方案 (输出至 dist/<profile>/surfingkeys.js)
npm run build

# 5. 启动可视化 Web UI 与配置分发服务
npm run ui
```

## 在 SurfingKeys 中加载配置

1. 打开浏览器扩展设置页面（`chrome-extension://.../pages/options.html`）。
2. 在 **Load settings from** 填入生成的本地文件 URL 或分发服务器地址：
   - 本地文件模式：`file:///path/to/my-surfingkeys-config/dist/personal/surfingkeys.js`
   - 服务器模式：`http://127.0.0.1:3000/script/personal`
   - GitHub Gist 自动分发模式：`https://gist.githubusercontent.com/<用户名>/<gist_id>/raw/personal.js`

## GitHub Actions 自动发布到 Gist (可选)

本项目预置了 GitHub Actions 工作流（`.github/workflows/publish-gist.yml`），支持在修改 `profiles/` 配置后自动重新编译所有方案并发布到同一个 GitHub Gist 项目中。

### 特性与设计
- **默认不启用**：避免在未配置访问令牌或克隆仓库中无故触发失败。
- **单一 Gist 统一托管**：所有 Profile（如 `personal.js`、`work.js`）以及说明文档汇总发布在同一个 Gist 项目内。
- **公开 / 私有可控**：默认发布为公开（Public）Gist，亦支持配置为私有（Secret）Gist。

### 如何启用
1. 前往 GitHub [Personal access tokens](https://github.com/settings/tokens) 创建一个具有 `gist` 权限的 Token。
2. 在您的 GitHub 仓库中，进入 **Settings -> Secrets and variables -> Actions**：
   - 在 **Secrets** 中添加 `GIST_TOKEN`，填入刚刚生成的 Token。
   - 在 **Variables** 中添加 `GIST_PUBLISH_ENABLED`，值设为 `true`（或直接将 `.github/workflows/publish-gist.yml` 中的 `ENABLED` 改为 `'true'`）。
3. （可选）配置项：
   - `GIST_PUBLIC`: 默认为 `'true'`（公开）。若需要创建私有 Gist，在 Variables 中添加 `GIST_PUBLIC` 设为 `'false'`。
   - `GIST_ID`: 首次发布后若希望锁定并持续更新特定的 Gist，可在 Variables 中添加该 Gist ID。

### 本地测试与手动发布
也可以直接在本地通过 NPM 脚本测试或发布：
```bash
# 模拟执行（检查构建并生成 Gist 内容预览，不发送网络请求）
npm run publish:gist -- --dry-run

# 使用 Token 发布
GIST_TOKEN="ghp_xxx" npm run publish:gist
```

## GitHub Pages 静态 SPA 与 PR 保存 (可选)

本项目预置了 GitHub Pages 工作流（`.github/workflows/pages.yml`），支持将可视化配置构建器作为纯前端静态 SPA 导出并托管在 GitHub Pages 上，无需常驻 Node.js 服务器即可浏览可用模组、配置与管理 Profile。

### 如何启用 GitHub Pages 部署
1. 在您的 GitHub 仓库中，进入 **Settings -> Pages**，将 **Build and deployment -> Source** 设置为 **GitHub Actions**。
2. 进入 **Settings -> Secrets and variables -> Actions -> Variables**：
   - 添加变量 `PAGES_DEPLOY_ENABLED`，值设为 `true`（或直接将 `.github/workflows/pages.yml` 中的 `ENABLED` 改为 `'true'`）。
3. （可选）支持在 GitHub Actions 页面通过 **workflow_dispatch** 手动触发部署。

### 本地预览与静态校验
在推送代码前，可以在本地校验配置文件和预览静态站点：
```bash
# 校验所有 Profile 的继承关系与模组选择
npm run validate:profiles

# 导出静态 SPA 站点到 .pages/ 目录
npm run pages:build
```
导出后可使用任意静态服务器预览 `.pages/` 目录（例如 `npx serve .pages` 或 `python3 -m http.server -d .pages`）。

### 公开数据与隐私说明
- **最小化元数据导出**：静态站点仅包含模组 Catalog 元数据与 Profile 元数据（`id`、`abstract`、`extends`、`file`、`locale`），**绝不包含** Profile 正文设置（`settings`）、快捷键定制（`keybindings`）、覆盖项（`overrides`）或构建后的 JavaScript 脚本。
- **公开访问风险**：GitHub Pages 站点公开可访问，即使您的源码仓库是私有的，Pages 站点上的上述元数据也是公开的。
- **不发布编译脚本**：GitHub Pages 静态模式仅作为配置编辑器使用，SurfingKeys 编译脚本仍由本地分发服务或 GitHub Gist 负责提供。

### 两种保存模式
在静态 SPA 页面中编辑配置后，提供两种保存与发起变更的方式：

1. **PAT 直连模式**：
   - 适合需要一键自动创建分支与 Pull Request 的场景。
   - 需要在 GitHub **Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens** 创建细粒度访问令牌，目标仓库授予以下权限：
     - `Contents: Read and write`
     - `Pull requests: Read and write`
     - `Metadata: Read`
   - **安全性与存储**：PAT 默认仅保存在浏览器页面内存中，刷新后自动失效。若显式勾选“记住 PAT”则保存在浏览器的 `localStorage` 中。**请注意**：同域名（例如 `<owner>.github.io`）下的所有 Pages 站点共享同一个 `localStorage`，存在潜在的跨站脚本读取风险。站点提供了“清除 PAT”按钮，可随时删除本地保存的凭据。

2. **GitHub 网页模式 (零 Token)**：
   - 适合不愿向网页提供任何 Token 凭据的场景。站点完全不接触 Token，不发起任何 GitHub API 写请求。
   - 点击保存后，站点会自动将格式化后的 Profile JSON 复制到剪贴板，并在新标签页中打开 GitHub 网页的新建文件或编辑页面。
   - **覆盖保护**：对于尚未从远端加载正文的现有 Profile，站点仅会打开 GitHub 页面供查看，**不会**复制默认内容到剪贴板，避免意外覆盖远端既有配置。用户在 GitHub 页面上粘贴内容并提交至新分支，然后创建 Pull Request。

### PR 自动化校验
当发起涉及 `profiles/**` 或 workspace 配置的 Pull Request 时，GitHub Actions 会自动触发 `validate` 作业，执行 `npm run validate:profiles` 和 `npm run pages:build`。
您可以在仓库的 **Settings -> Branches** 中将 `Validate profiles and static export` 设置为 Required Status Check，确保只有通过校验的配置才能合并入主分支。
