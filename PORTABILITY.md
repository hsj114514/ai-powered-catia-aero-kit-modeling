# 可移植性、宿主兼容与路径

## 前提

| 能力 | 条件 |
| --- | --- |
| 准备/评分/回归/STEP 离线读取 | Node.js 18+；仅标准库，无 npm 安装步骤 |
| Windows 环境检查 | PowerShell 与 scripts/doctor.ps1；仅读取，不安装、不启动 CATIA |
| CATIA 实时建模、测量、装配 | Windows、CATIA V5、注册的 COM 与对应许可；目标版本需另行验证 |
| 注册全部 Agent 工具 | DSH/Cordis 的 tools 服务；Skill 注入还需要 systemPrompt 支持 |
| 其他 Agent | 需要适配注册、Schema、结果与提示接口；不是通用 MCP 安装包 |

嵌入的 `skills/*.md` 是本插件的设计知识资源，不是可直接装入所有 Agent 的独立 Skill。必须连同 lib、rules、scoring 和宿主配置更新；之后用 catia_policy_status 确认资源指纹。它无法证明宿主确实在当前会话注入了提示。

## 自动发现

projectRoot 留空时依次考虑 LOCALAPPDATA、XDG_DATA_HOME、HOME 下的 .local/share、TEMP 和系统临时目录，选择有效绝对路径，并追加 catia-aero-kit/projects。实际写入时仍可能受权限或磁盘限制；可以显式配置自己的 projectRoot。

Node 脚本使用当前运行时；doctor.ps1 从 PATH 与新主机常见的 Node 安装目录查找 Node。cscript.exe 从 SystemRoot 下的 System32 定位。COM 注册检查不证明 CATIA 可启动，也不安装、注册或激活软件/许可。临时目录作为最后回退时，工程可能随系统清理，建议配置持久目录。

运行 doctor 会输出当前电脑路径；这些输出不随发布包提供，不要公开。输入文件和装配部件路径由使用者提供；没有开发机用户名、私人绝对路径或源 CAD 文件。

## 坐标、装配与工程交付

默认毫米、+X 向后、+Y 向上、+Z 右侧外向。STEP 保留源文件单位，不自动换算；其他来源坐标须明确转换。嵌套装配组合刚体变换，位置/近似包络不能独立证明无干涉或合规。

保存 CATProduct 不会自动收集全部外部零件引用。交付真实工程时应另行收集外部引用并检查新主机解析结果。插件发布 ZIP 只包含源码、知识资源和合成例子。

## 配置与迁移

本次保留 r11 配置 maxLevel:3；移除/替换还需 confirm/reason。需要禁用这类操作可改为2。这些字段不能代替人授权。allowOverwrite:false 保留。

卸载/重装方式由具体宿主决定，见 REINSTALL_r11.md。本轮没有执行安装或迁移，也没有在新主机验证 CATIA。GitHub CI 只检查离线合同，不能替代本表中的运行前提。
