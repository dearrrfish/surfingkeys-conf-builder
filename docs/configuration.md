# 配置方案

workspace、profile 和扩展清单均为 JSON 数据。schemaVersion 当前为 1，未知字段会被拒绝。回调实现放在扩展 ESM 中，不写入 profile。

## Workspace 与路径

[workspace schema](../schemas/workspace.schema.json)规定来源、方案目录和输出根：

```json
{
  "schemaVersion": 1,
  "upstream": { "path": "../surfingkeys-conf", "adapter": "b0o-v1" },
  "extensions": ["./custom/notes"],
  "profilesDir": "./profiles",
  "outDir": "./dist"
}
```

workspace 路径是相对该文件的路径；profile 的 extends 相对该 profile 文件；扩展 entry 相对 selective.json。来源根可显式位于工作区外，构建器仅读取。profilesDir/outDir 必须位于工作区内。入口解析 realpath 后必须仍在声明来源根内，且不能是私有或摘要排除输入。

## Profile 与单父继承

[profile schema](../schemas/profile.schema.json)支持以下字段：

| 字段 | 规则 |
| --- | --- |
| id | 工作区内唯一的 kebab-case，CLI 通过 id 选择 |
| abstract | 当前方案是否只作为父方案；不继承该标记，build-all 跳过 abstract |
| extends | 一个相对 JSON 路径，父文件须在 profilesDir 内被索引 |
| base | 当前只支持 minimal；schema 预留的 upstream-global 会被解析器拒绝 |
| selectAdd / selectRemove | 增加或移除直接选择；ID 必须来自实际 catalog |
| settings / unsetSettings | 按顶层字段替换或删除，不深合并 |
| leaders | 单独继承 site/search；默认 `<Space>` 和 `a` |
| overrides | 子方案显式提供时替换完整数组，不追加父数组 |
| searchGroups | 聚合搜索与多引擎批处理组配置；继承合并同名 ID，详见 [聚合搜索文档](aggregated-search.md) |

父方案 common.json：

```json
{
  "schemaVersion": 1,
  "id": "common",
  "abstract": true,
  "base": "minimal",
  "selectAdd": ["upstream/search-engines.ddg"],
  "settings": { "defaultSearchEngine": "du" },
  "leaders": { "site": "<Space>", "search": "a" }
}
```

子方案 personal.json：

```json
{
  "schemaVersion": 1,
  "id": "personal",
  "extends": "./common.json",
  "selectAdd": ["upstream/actions.amazon", "example_notes/actions.notes"]
}
```

子方案 work.json：

```json
{
  "schemaVersion": 1,
  "id": "work",
  "extends": "./common.json",
  "selectAdd": ["example_notes/search-engines.notes"],
  "settings": { "defaultSearchEngine": "nt" }
}
```

合并沿父链从根到子进行。直接选择保持去重后的顺序；先增加再移除，同一层同时 add/remove 报错。移除未选择项、删除不存在设置、同层 set/unset、父链循环或越界均失败。settings 的嵌套对象和数组作为整个字段替换；unsetSettings 不接受嵌套路径语义。

移除直接选择不能强制删掉其他功能仍依赖的实现。explain 分别显示 requested、resolvedFeatures、resolvedCapabilities、注册贡献及 provenance。abstract 仅影响构建资格，不阻止读取其继承配置。

## 有效键与覆盖

全局 map 使用原 alias，不应用 site leader/domain。mapkey 使用显式 leader，或按域选择默认 leader：global 为空，站点为 leaders.site。search 以 leaders.search 和 alias 生成两条全局键：alias du、leader a 对应 adu/cadu；后者读取剪贴板作为搜索前缀。

defaultSearchEngine 必须是覆盖后仍有效的搜索 alias，不能填写 feature ID。同域、父子域、global/site 的相同有效键会冲突；不同路径正则按可能重叠保守处理。搜索 alias 重复也失败。

有意替换时，在 overrides 中填写完整 contribution ID `namespace/feature#local-id`。target/with 都须在已选功能闭包内、kind 一致且确实冲突；不允许自覆盖、循环或重复目标/替代项。覆盖压制注册，仍被其他功能引用的代码继续保留。有效前缀关系输出 KEY_PREFIX；短键可能使长键不可达，见 [浏览器使用](browser.md)。

## 来源锁

sources.lock.json 位于 workspace 旁，记录上游 SHA/公共源码摘要、扩展 namespace/内容摘要/Git SHA（如有）与工具链锁摘要。使用显式命令刷新：

```sh
node dist-tool/cli.js sources lock --workspace my-config/surfingkeys.workspace.json --refresh --json
```

普通扩展目录按可接受内容摘要；Git 扩展还要求工作树干净，摘要包含被允许的 Git 忽略源码。私有路径、conf.priv、.env、secrets/credentials 和构建依赖/缓存目录不作为来源输入。改 profile 不必刷新来源锁；改来源实现或工具链锁后须先确认变化，再刷新。摘要协议见 [lock schema](../schemas/lock.schema.json)与 [来源实现](../src/sources.ts)。

## 网页视觉方案 (Web UI)

针对新方案的创建（`create` 技能）及已有方案的审查与编辑（`update` 技能），可使用网页视觉构建器：
- 启动服务：`npm run ui` 或打开 `ui/index.html`。
- 可视化选择网站适配、搜索引擎及 Omni Bar 键位联动。
- 详情参见 [HTML 视觉配置方案](visual-interface.md)。
