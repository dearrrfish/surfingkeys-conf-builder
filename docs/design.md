# SurfingKeys 选择编译架构

流程为“只读来源 → 静态功能目录 → 方案解析 → 功能/代码依赖闭包 → 冲突检查 → 生成副本 → 单文件打包 → 分方案发布”。项目范围见 [requirements](requirements.md)，操作文档从 [quickstart](quickstart.md)开始。

## 1. 上游与适配边界

`b0o-v1` 绑定上游 SHA `80176490f6d04c61d10bcbc20618bd283b94ca23`，当前只暴露 Amazon/DDG 和 core.openLink。动作对象、站点注册与搜索alias是不同结构，不能通过运行上游或简单对象pick发现/裁剪功能。

源码参考：[keys.js](https://github.com/b0o/surfingkeys-conf/blob/80176490f6d04c61d10bcbc20618bd283b94ca23/src/keys.js)、[search-engines.js](https://github.com/b0o/surfingkeys-conf/blob/80176490f6d04c61d10bcbc20618bd283b94ca23/src/search-engines.js)。版本兼容必须通过SHA、内容锁和AST形状共同验证，未知形状不自动猜测。

## 2. 输入与模块布局

workspace/profile/manifest/lock 均为版本化JSON，schema在 [schemas](../schemas)。输入路径、继承与摘要规则见 [配置方案](configuration.md)。来源根只读；生成文件指向独立副本，不能绕回原actions/keys/search或私有模块。

实现采用扁平src模块，职责见 [开发文档](development.md)。catalog/profiles处理静态目录和方案，code-analysis追踪源码，generation/registration生成统一计划，bundler/build打包与发布。

## 3. 多配置方案

单父链从根到子合并：选择去重增加后移除；settings按顶层字段替换/unset；leaders按字段继承；overrides整数组替换。minimal不加载上游global/unmaps/theme，abstract仅影响目标构建资格。详情与例子见 [configuration](configuration.md)。

有效profile保留provenance。每个方案独立输入身份、staging、锁和current；build-all不是跨方案事务。共享父修改需要重新验证所有受影响后代。

## 4. 两个依赖图

功能图连接profile选择、requires与capabilities，用于说明用户功能和有效注册。代码图连接声明、属性读写、闭包、import及初始化，实现根来自有效贡献和能力。代码依赖不追加功能注册；选中core.openLink不自动注册Amazon。

报告分别显示requested/resolved、贡献、能力和原因。绑定与成员依赖按词法作用域解析，保留父容器初始化、必要赋值顺序和强连通分量。公共api/util与已选扩展入口可保守留存，optimizationDebt解释代码保留与注册启用的区别。

## 5. 扩展与运行时边界

扩展声明静态注册元数据，默认导出同步工厂和callbacks映射。受支持ESM形状、清单字段与注入能力见 [extensions](extensions.md)。Node分析/生成/打包不执行来源工厂或回调，扩展源码仍是受信任输入。

浏览器先执行所有保留工厂，再按完整清单检查必需/未知回调、函数类型、own descriptors和对象原型，包括被覆盖贡献。全部预检通过后builder才写settings、注册有效贡献。每项工厂services冻结，只含声明能力；不提供任意导入的沙箱。

## 6. 注册、范围和覆盖

统一Registration IR同时服务静态冲突检查和生成调用。map是全局原alias；mapkey使用有效leader/域；search生成alias和两条全局键。站点正则转义字面域，限制主机边界、接受子域/端口，字面path直接接在边界后并分组。

global、同域或父子域的相同有效键冲突；路径保守重叠，search alias重复失败。显式override须关联闭包内同kind的真实冲突贡献。覆盖压制注册，不能删掉其他回调仍需的代码。KEY_PREFIX保留注册并警告；短键遮蔽语义见 [browser](browser.md)。

## 7. AST与源码生成

固定Babel工具建立绑定/成员索引，递归追踪声明、自由变量、工厂默认参数、初始化读写和静态import，保留原作用域与必要语句顺序；不会序列化function.toString。按受支持规则切片上游注册，不把未知动态访问、副作用、对象逃逸或整对象spread当作安全删除依据。

生成相对ESM图，全部存活导入指向生成副本或builder许可依赖。上游公共模块外部依赖仅许可uhtml/dompurify；扩展npm导入不支持。相同物理入口/helper保持单模块身份。无私有输入的支持路径不会读取conf.priv；含私有或未知模式的选择失败。

MV3用户脚本可能提供browser而没有storage。生成util副本只针对固定localStorageFns的已识别首条件增加browser.storage/local存在性检查；AST形状改变则ADAPTER_SHAPE_CHANGE。不增加存储capability，缺少接口时沿用上游不可用分支。上游文件仍不修改，生成变换受builder实现摘要约束。

## 8. 打包、身份与发布

Webpack Node API打包一个IIFE，检查run/stats/close错误。production/development都不压缩、无sourcemap/动态分块/磁盘cache。逻辑模块ID与pathinfo关闭避免绝对路径影响输出；许可和实际打包包写入notices。

buildId来自规范有效方案/分析、逻辑来源SHA/内容摘要、工具链lock、builder实现、Node精确版本和mode。规范report/JS不包含运行时间或机器绝对路径。产物、current/report schema与compare规则见 [building](building.md)。

来源读标记和refresh writer标记协调本工具；外部编辑靠捕获后/发布前摘要复核检测。各方案staging验证完整后发布不可变build，最后原子更新current。重复ID仍须校验已有文件；失败保留旧current，旧build不自动清理，marker不自动恢复。

## 9. 配置方案SKILL

[create](../.agents/skills/surfingkeys-profile-create/SKILL.md)与 [update](../.agents/skills/surfingkeys-profile-update/SKILL.md)按实际catalog编辑profile，使用validate/explain核对选择、provenance、依赖和有效键；有旧同方案buildId时用compare表达影响。

创建不覆盖现有方案；更新保持未授权父/扩展/锁不变。未知ID需目录和迁移证据，不能猜alias或静默替换行为。build和浏览器安装是独立动作；SKILL不自动刷新来源。客户端自动发现项目技能取决于加载规则，显式按项目路径读取可用。

## 10. 验证与维护

静态分析成功、打包成功、浏览器初始化、真实键盘/DOM和外部服务是不同验证层。测试方法见 [development](development.md)，安装与来源升级见 [browser](browser.md)。规范需求描述应保持当前能力；具体运行结果不作为操作指南的一部分。

增加来源/上游功能时先实现适配规则和形状/语义/注册测试，再暴露ID与迁移说明。新SHA在独立候选中验证，逐方案比较catalog/explain，失败保留旧来源与产物。主题、DOI、扩展npm与公共util精细裁剪属于后续方向。
