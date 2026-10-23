# SurfingKeys Config Builder v2 契约速查

## 1. `surfingkeys.workspace.json` (v2)

```json
{
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

## 2. 官方模组库命名空间

- `b0o/*`: 上游 b0o/surfingkeys-conf 转写模组（兼容 `upstream/*` 别名）
  - `b0o/actions.amazon`, `b0o/actions.github`
  - `b0o/search-engines.ddg`, `b0o/search-engines.google`
- `ent/*`: 原生娱乐向模组
  - `ent/actions.bilibili`, `ent/search-engines.bilibili`
  - `ent/actions.youtube`, `ent/actions.twitter`
- `tech/*`: 原生科技向模组
  - `tech/actions.github`, `tech/search-engines.github`, `tech/omnibar.github`
  - `tech/search-engines.sspai`, `tech/search-engines.searx`, `tech/utils.index`
- `prod/*`: 原生生产力向模组
  - `prod/actions.gmail`, `prod/actions.pinboard`, `prod/search-engines.pinboard`

## 3. `profiles/*.json` (v2 示例)

```json
{
  "schemaVersion": 2,
  "id": "personal",
  "extends": "common.json",
  "locale": "zh-CN",
  "selectAdd": [
    "b0o/actions.amazon",
    "ent/actions.bilibili",
    "tech/actions.github"
  ],
  "selectRemoveContributions": [
    "ent/actions.bilibili#danmaku"
  ],
  "conflictResolution": {
    "mode": "module-precedence",
    "modulePrecedence": ["tech", "b0o"]
  },
  "leaders": {
    "site": "<Space>",
    "search": "a"
  },
  "settings": {
    "defaultSearchEngine": "du"
  }
}
```
