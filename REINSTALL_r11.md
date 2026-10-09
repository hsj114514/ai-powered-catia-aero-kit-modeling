# r11 Skill / 规则库重装说明

本次仅提供压缩包，未进行安装、CATIA 操作或 GitHub 发布。

## 更新单位

这是 DSH/Cordis 插件包。`skills/global_aero_design.md` 与 `skills/front_wing_design.md` 是插件内嵌的设计 Skill；`lib/prompt.js` 会把它们加入系统提示。`rules/` 和 `scoring/` 由代码读取。不要只更新两份 Skill 而留下旧 evaluator，也不要把这些普通 Markdown 当作另一个 Agent 平台的自动安装入口。

## 操作顺序（由用户后续执行）

1. 保留原安装包、宿主插件配置和项目账本备份；CAD 工程与本插件源码分开。
2. 解压 r11，运行 `node scripts/checksums.mjs` 和 `node scripts/verify.mjs`。前者检查交付文件，后者只执行离线检查。
3. 使用宿主已有的插件更新/安装入口，选择解压后的整个 `catia-aero-kit` 目录；README 的 install_bundle 示例只适用于支持该入口的宿主。
4. 保留原来的 `projectRoot`、权限配置；确认 `enabled:true`、`persona:true`。本包没有自动安装脚本，不扫描或覆盖未知安装目录。
5. 停用重复的旧 CATIA 插件实例，重启或重新加载插件，并使用一个加载了新提示段落的会话。只替换磁盘文件，已缓存的模块和系统提示可能仍为旧版。
6. 调用 `catia_policy_status {}`：`registration.revision` 和 `currentFiles.revision` 都应为 r11；资源指纹应一致。若不一致，继续处理宿主加载问题，勿通过增加奖励掩盖旧代码。
7. 确认工具中出现 `catia_sketch`、`catia_prepare_plan`、`catia_policy_status`、`catia_model_plan`、`catia_evaluate_plan`、`catia_gsd_catalog`、`catia_gsd_command`。先检查 `examples/r11-sketch-foot-prepared.plan.json` 的 dryRun 结果及建议；这不是完整前翼或实机闭合测试。

`catia_policy_status` 无法证明宿主已经把 persona 注入当前聊天，需查看宿主提示配置。没有宿主环境读取证据时，不宣称重装已完成。

## 需要一起更新的资源

- `index.js` 与整个 `lib/`：工具、能力、提示、评分、引用解析和执行记录。
- `skills/`：两份设计 Skill。
- `rules/`：内部规则、几何策略和用户提供的 2026 条文来源映射。
- `scoring/`：全局与前翼权重，新增约束/工具匹配奖励和闭合处罚配置。
- `scripts/`、`examples/`、`test/`、说明与校验清单。

Node 18+；离线模块不需要 CATIA。实机仍需要 Windows、CATIA V5、相应许可和自动化权限。其他 Agent 需要适配工具注册与提示资源，不具备通用 MCP 即装即用能力。当前版本仍不支持曲线草图、Pad/Pocket，以及目录列出的五项未实现 GSD 命令。
