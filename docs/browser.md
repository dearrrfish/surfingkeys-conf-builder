# 浏览器使用、切换与回退

构建产物是 SurfingKeys 的自定义配置脚本，不是浏览器扩展安装包。先检查 explain 的有效键与 alias，再构建目标 profile。minimal 不清除 SurfingKeys 默认映射；所选贡献可能覆盖已有默认键。

## 安装配置

在 SurfingKeys 选项中开启 Advanced mode，安装 build 输出 scriptPath 对应的完整 surfingkeys.js；也可按宿主支持的 Load settings from 配置 URL，来源文件访问权限由浏览器决定。MV3 宿主需要开启 Developer mode 和该扩展的 Allow User Scripts 才能执行高级用户脚本。保存后重载测试页面，检查初始化错误和关键快捷键。

构建和项目 SKILL 不自动操作你的浏览器配置。个人浏览器中的安装由用户显式执行，先保存旧 snippets 或原配置 URL。

## 多方案切换与快捷键

personal 与 work 是两份完整脚本；切换时完整替换，不拼接。重载目标页面后验证有效域名、站点键、搜索 alias 和默认引擎。示例默认 site leader 为 Space，Amazon 添加购物车键为 Space+c，notes 导航为 Space+h；DDG alias du 的搜索键为 adu/cadu。

site 域匹配子域和可选端口；path 是字面正则。非匹配范围不注册对应站点键。map 是全局重映射，search 也生成全局键，不按站点范围隔离。

KEY_PREFIX 表示有效键有前缀关系。短键可能立即执行，从而使长键不可达；宿主中的 p/pp 组合可能将 pp 分派为两次 p。避免重叠或明确调整 alias，警告不会自动删除任一注册，也不保证长键可达。

## 浏览器检查

每次安装或来源升级，至少检查工厂初始化、关键键位、匹配/非匹配域与路径、搜索补全和方案切换。静态分析和 JSDOM 测试不能证明宿主键盘行为；受控补全响应也不能证明实时服务长期可用。Amazon DOM、搜索服务和宿主 API 都可能变化，使用实际目标环境复核。

Chrome MV3 的用户脚本可能暴露 browser 但不暴露 browser.storage。生成器对固定上游 util 的可选存储初始化做严格形状匹配的接口存在检查；未增加 storage capability，当前功能不依赖该存储接口。

开发者可使用隔离的自动浏览器测试，前置条件和命令见 [开发与测试](development.md)。

## 升级与回退

上游版本变化要在独立候选 checkout 中更新适配器和来源锁，核对 catalog、全部方案的 validate/explain/compare，再构建和浏览器检查。当前适配器固定 SHA，不能仅刷新 lock 就使其他版本兼容。缺失 ID 或未知形状必须处理，不静默删功能。

安装新脚本前保留旧 buildId、script/notices 和浏览器配置备份。失败时恢复旧 snippets 或配置 URL，再重载页面验证。需要重建旧产物时恢复对应 builder、上游和 lock。旧 build 目录会保留，但 CLI 没有 rollback 命令；不要把浏览器配置恢复与文件系统 current 指针恢复视为同一操作。
