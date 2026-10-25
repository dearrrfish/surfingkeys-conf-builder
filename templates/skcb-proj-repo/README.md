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
