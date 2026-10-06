# 移植与交付说明

## 来源与版本

基于用户提供的 catia-aero-kit-v1.1-r6-patched.zip，2026-10-06 完成移植整理。包版本 1.1.0 / 显示版本 v1.1 / revision r6 均保留。

## 目录与依赖

- projectRoot 留空，使用 index.js 的目标用户目录选择逻辑；不嵌入开发机用户、盘符或工程路径。
- doctor.mjs 与运行时共用目录解析，不会创建项目目录；doctor.ps1 探测 Windows 工具与 COM 注册。
- Node 标准库自包含；不下载、安装或复制任何依赖。
- CATIA/Node/DSH 的安装、许可和宿主兼容由目标机器满足，诊断无法代替实时验证。
- 示例中的绝对路径均为需要用户在目标主机提供的输入，不是固定默认路径。
- STEP 保留源单位，CATIA 与建模参数按毫米使用，坐标系需显式对齐。
- 其他 Agent 可适配工具定义或模块；本包没有通用 MCP 入口。

## 交付内容

源码、原有离线检查、中英文 README、更新记录、发布说明、操作规范、历史审查、GPL-3.0-only 许可证、GitHub 工作流和打包/校验脚本。压缩包采用统一 catia-aero-kit/ 顶层目录与斜杠路径。

GitHub 仓库根目录应放置此顶层目录内的文件，使 README、package.json 和 .github 位于仓库根目录。无需把 ZIP 作为唯一仓库内容；ZIP 可在确认发布后作为 Release 附件。

checksums.sha256 记录交付文件哈希；外部 ZIP.sha256 校验整个压缩包。任何源码或说明变更后都应重新打包生成清单。

## 验证记录

推送前的本地整理未安装插件、未启动 CATIA、未操作现有装配，也未运行回归测试。检查了 28 个 JavaScript 文件和 2 个 PowerShell 文件的语法；交付清单与压缩包完整性在打包时核对。

Windows 默认执行策略在此环境阻止直接运行 PowerShell 文件，因此使用单次进程的 -ExecutionPolicy Bypass 运行诊断和打包；没有修改系统策略或安装软件。Node 诊断与插件使用同一目录解析逻辑。

配置的 GitHub Actions 在 Windows/Linux 运行离线检查，尚未执行；本机结果不能证明 Linux 或目标 CATIA 上通过。

## 历史报告

REVIEW_r6.md、REVIEW_v1.1.0.md、CODE_REVIEW.md、VERIFICATION-real-vehicle.md 保留作来源历史。报告中的实车数字、接口版本和原会话检查结果不属于本次候选版验证。README 和本说明描述当前交付范围；历史报告不能扩大它。
