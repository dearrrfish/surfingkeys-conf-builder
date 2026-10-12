# 扩展模组

在 workspace.extensions 显式列出扩展根目录。每个根包含 selective.json，可以是普通本地目录或 Git submodule；构建器不自动拉取或更新它们。

## 清单与功能 ID

[manifest schema](../schemas/manifest.schema.json)规定静态目录。namespace 使用小写字母开头的字母/数字/下划线，upstream/core 保留。entry 的局部名使用 actions.<slug> 或 search-engines.<slug>。

```json
{
  "schemaVersion": 1,
  "namespace": "example_notes",
  "entries": {
    "actions.notes": {
      "entry": "./notes.js",
      "capabilities": ["core.openLink"],
      "contributions": [
        {
          "id": "home",
          "kind": "mapkey",
          "domain": "notes.example.com",
          "alias": "h",
          "description": "Open notes home"
        }
      ]
    }
  }
}
```

功能 ID 为 example_notes/actions.notes，贡献 ID 为 example_notes/actions.notes#home。profile 选择功能 ID；overrides 使用贡献 ID。requires 声明其他功能依赖，capabilities 声明实现能力，引用能力不会自动启用提供者站点的注册。

| kind | 必需行为字段 | 注册 |
| --- | --- | --- |
| mapkey | alias；工厂提供同 id 回调 | 有效键、说明和可选站点范围 |
| map | alias、target | 全局重映射，无回调 |
| search | alias、name、search | 搜索 alias 与两条生成搜索键 |

search 可提供 compl/favicon；有 compl 时必须声明 callbackRequired:true 并提供回调。无 compl 的 search 回调可选；mapkey 回调始终必需。domain 省略时为 global；站点域匹配该域及子域，允许端口且限制主机边界。path 是接在主机边界后的字面正则，不能依赖自动添加 `/`；例如 `(/foo)` 匹配 /foo 前缀，`(?:/a|/b)` 匹配两个路径前缀。

## 同步工厂与回调

notes.js：

```js
export default function create({ openLink }) {
  return {
    callbacks: {
      home: () => openLink('/'),
    },
  };
}
```

当前工厂需是默认导出的同步非 generator 函数/箭头函数，或可静态识别的本地函数标识符；直接返回字面量 callbacks 对象。块体允许声明后的一次最终直接返回；提前返回、工厂内 if/循环/try、异步工厂、动态返回对象不支持。回调内部可以有控制流。

静态相对 ESM 导入与带来源的具名再导出受支持；export *、默认再导出、导入的工厂标识符、动态 import、require/eval 和扩展 npm 导入不支持。入口/helper 须在来源根内；顶层 DOM、注册调用或未知副作用会失败。相同物理模块只实例化一次，多个工厂共享其模块状态。

当前能力只有 core.openLink，注入服务名为 openLink，接口为 `openLink(url, {newTab?, active?})`。每个工厂只收到它声明的服务，services 冻结。扩展源码受信任；这些约束不阻止恶意回调在浏览器中使用全局能力。

## 初始化校验

Node 中分析、生成和打包不执行扩展工厂或回调。浏览器初始化先执行保留工厂，再对完整清单预检：必需回调缺失、未知 id、非函数、accessor 或非法对象原型均失败；被覆盖贡献仍属于保留工厂的完整清单。全部工厂通过后才写入 builder 设置和注册贡献。

入口中被覆盖回调的代码可能保守保留，不等于注册仍有效。explain/report 的 optimizationDebt 显示这类留存。修改清单/实现后显式刷新来源锁，再 validate/explain/build；来源更新与配置方案编辑应分开处理。
