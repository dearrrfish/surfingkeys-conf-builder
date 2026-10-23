# 功能模组开发与官方生态库

## 1. 官方模组库总览

| 模组包 | 命名空间 | 核心适配站点 / 引擎 | 特色能力 |
| --- | --- | --- | --- |
| `@skcb/lib-b0o` | `b0o` (兼容 `upstream`) | Amazon, GitHub, Google, DDG, Wikipedia, StackOverflow | 上游 commit 强绑定 AOT 转写，中英双语描述，MV3 存储安全守卫 |
| `@skcb/lib-ent` | `ent` | Bilibili (`actions.bilibili`), YouTube (`actions.youtube`), Twitter/X (`actions.twitter`) | 修复播放器引号 bug，Piped/Invidious/Nitter 镜像惰性 URL 跳转 |
| `@skcb/lib-tech` | `tech` | GitHub (`actions.github`, `omnibar.github`), sspai, SearXNG | 修复剪贴板调用 bug，Star 补全，`parseGithubRepo` 通用工具 |
| `@skcb/lib-prod` | `prod` | Gmail HTML (`actions.gmail`), Pinboard (`actions.pinboard`) | 拆分域名与 path 正则，修复 `gC` 导航 bug 与 CSS 选择器括号 bug |

## 2. 编写自定义模组 (SDK)

使用 `@skcb/core` 提供的 `defineSite` 与 `defineModule` 可以快速创建类型安全的扩展模组：

```typescript
import { defineSite, defineModule } from '@skcb/core';

export const bilibiliSite = defineSite({
  id: 'bilibili',
  name: 'Bilibili',
  domain: 'bilibili.com',
  actions: {
    toggleFullscreen: {
      keys: 'f',
      description: {
        en: 'Toggle windowed fullscreen',
        'zh-CN': '网页全屏'
      },
      code: () => {
        document.querySelector('.bpx-player-ctrl-web')?.click();
      }
    }
  },
  searchEngines: {
    video: {
      alias: 'bv',
      name: 'Bilibili Search',
      url: 'https://search.bilibili.com/all?keyword='
    }
  }
});
```

## 3. 跨模组冲突与优先级仲裁

当配置中同时启用了 `@skcb/lib-b0o` 与 `@skcb/lib-tech`（两者均包含 `github.com` 快捷键）时，可通过 Profile 的 `conflictResolution` 声明消解规则：

```json
{
  "conflictResolution": {
    "mode": "module-precedence",
    "modulePrecedence": ["tech", "b0o"]
  }
}
```

在上述配置下，`tech/actions.github` 中的按键将优先保留，与其实际冲突的 `b0o/actions.github` 按键将被自动压制并记录在构建报告中。用户也可以使用 `selectRemoveContributions` 自由开关个别快捷键：

```json
{
  "selectRemoveContributions": [
    "ent/actions.bilibili#danmaku"
  ]
}
```
