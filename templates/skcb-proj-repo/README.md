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
