# v1.1-r6 修订与验证

基于用户提供的 r5 压缩包修改，`package.json.version` 保持 **1.1.0**，`catiaAeroRevision` 为 **r6**。交付仅包含源代码、文档、脚本与离线测试；未安装、未推送 GitHub、未操作真实 CATIA 装配体。范围仍为几何设计，不包含安装刚度、约 200 N 加载变形或 CFD 性能判断。

## 建模与几何

| r5 问题 | r6 处理 |
|---|---|
| 默认钝尾缘 NACA 丢掉下表面末点，闭合时直接跨到上表面 | 保留两个有限厚度尾缘点；重采样只去掉真正重复的闭合点 |
| Lednicer 文件的上下表面点数头会被当成坐标 | 按计数分离两个 LE→TE 表面，转换为 TE→LE→TE；非法数据拒绝 |
| 非有限数、null、字符串或小数站数可能被转换、默认或截断 | 公共数值/向量/整数验证，尺寸要求真实有限数，站数不再静默截断 |
| 省略 chordTip 的库调用可能失败；quarterChord 的父翼和襟翼锚点不一致 | tip 弦长默认 root；剖面与尾缘使用相同枢轴 |
| 组合翼每个襟翼都指向主翼 | 新组合请求按流动顺序串联；比例、偏转、间隙相对前一级。已有账本保持原 parentId |
| 循环依赖、重排账本、深层依赖缺乏明确处理 | 显式检查依赖循环，按父级先行重建，重建依赖深度限制为 64 |
| 端板规则盒漏掉 sweepDeg，扩散器建模/检查有重复公式 | 共用 elementGeometry / 端板轮廓 / 扩散器截面计算；拒绝自交或零面积端板输入 |
| 特征名已经输出但最后更新失败，可能仍被记录为“未保存成功” | geometryReady 只在全部更新完成后输出；构建失败恢复账本，保存失败才保留完整的未保存几何，未保存版本不虚构文件名 |

端板和扩散器仍为样条截面放样曲面；没有新增封盖、实体化、壁厚或制造能力。验证输入多边形不代表插值曲线一定没有自交。指定弦长、站数与轮廓也不保证每个 CATIA 版本都能成功更新。

## 装配

- CATIA `Position` 原始 12 项为 X/Y/Z 三根轴列和原点，原点位于 9/10/11；转换成内部行主序 3×4 后，平移才位于 3/7/11。原包“原样写回读回即证明布局”的论证不足。本实现依据 [Dassault Systèmes Position 接口文档（文档镜像）](https://catia-v5-help.anarkia333data.center/online/interfaces/InfInterfaces/interface_Position_14902.htm)，用带 90° 旋转的父节点和非零子节点平移验证复合算术；未声称本次做过 CATIA 实机位置核对。
- 位置报告改为完整 9 字段、12 项内部矩阵和 `resolved/unresolved` 状态。读取失败时保留未知位置，并向子树传播；不伪装成原点。深度或数量限制实际省略节点时标记截断；失败结果不返回 SUCCESS。
- 插入显式应用刚体矩阵，默认为原点恒等放置；可传 `placement`。拒绝缩放、反射及非正交轴。
- 删除/替换共享参数检查和脚本生成。`componentPath` 逐级按精确且唯一的实例名定位，支持嵌套装配；重名、多匹配、缺失实例均拒绝。
- 替换改为先插入，继承旧件局部位置，确认成功后才删除旧件。放置/重命名失败时尝试删除本次新插入件。插入/替换在 `Product.Update` 后再次读取位置，确认未漂移才继续保存。
- 每个 COM 阶段失败即退出当前过程；检查部件数量；保存前再次检查目标存在性。保存失败或后续更新失败时明确报告会话可能已修改，不能承诺装配操作全事务回滚。
- 替换仍会改变实例身份，不能保证原约束、发布对象、关联引用继承。新零件必须采用与旧件相容的局部坐标基准；相同位置矩阵不证明几何对齐。
- `saveAs` 保留原文件，只保存新 CATProduct。外部 CATPart/CATProduct 引用不会自动复制：交付实际整车装配需另行使用 CATIA Save Management。

## 几何规则

规则计算移到独立 `lib/rules.js`。点和直线使用精确线性几何，按区域裁切后判断头枕限高、前部限高、轮胎横向限制和禁入盒，避免把区域外的高度或只有盒重叠的直线误报为区域内冲突。

样条和放样的输入点盒不能证明最终曲面包含性。此类结果带 `uncertainElements`、`geometryQuality`、`screeningOnly: true`，即使采样未发现冲突也返回 PARTIAL_SUCCESS。现有 STEP 包络保持 `boundsUsableForCompliance: false`。

新增 `groundY`（默认 0）作为离地高度基准，`elementIds` 可显式限定气动元素；未检查元素列入 `skippedElements`，未能计算元素仍列入 `uncheckedElements`。轮胎内/外半宽矛盾、非有限值、不完整的规则请求继续拒绝。间隙实测使用选定版本的特征名；缺少测量结果不返回完整成功。

500/1200 mm 分区等仍沿用用户此前提供的图示。T9.3.2 文字与图示的解释歧义没有得到赛事官方确认，不新增“完整规则合规”结论，`fullCompetitionCompliance` 始终为 false。边缘圆角、真实曲面极值、整车碰撞、轮胎转向/悬架运动范围仍需要实测或独立审查。

## 移植与交付

- 随包 projectRoot 留空，按绝对用户数据路径自动选择；显式配置必须是绝对路径。未把开发机盘符、用户名或真实 CAD 文件打入交付。
- 仅依赖 Node 内置模块，最低 Node 18。离线数学、STEP 与规则模块可在其他系统运行；实时 CATIA 需要 Windows、Windows Script Host、注册的 CATIA COM 服务及相应许可。
- `index.js` 是 DSH/Cordis 插件入口，需要宿主 tools 服务。其他 Agent 可复用纯模块或接入 buildToolDefinitions 的 JSON Schema 和 execute，但本包没有新增通用 MCP 服务。
- 中文脚本与报告使用 UTF-16LE；字符串引号和换行转义；执行完恢复原 DisplayFileAlerts。项目名拒绝 Windows 保留设备名、尾点/空格及特殊对象键；拒绝项目内已有符号链接/junction。目录检查不是抵御恶意并发文件系统替换的隔离机制。
- doctor.ps1 为只读环境发现；verify.mjs 为离线验证；geometry-check.mjs 可脱离 DSH 做账本筛查；package.ps1 使用白名单、标准 `/` ZIP 条目名、每文件 SHA256 清单。

## 本次验证

`node scripts/verify.mjs` 包含 9 组：smoke、assembly、rules、tool-schema、envelope-regression、chain、assembly-write、project-root、r6。全部通过。r6 用数学见证验证尾缘、Lednicer、串联襟翼、枢轴、端板扫掠、区域裁切、非零嵌套变换、未保存状态与跨目录 CLI；装配调用使用记录桥，未触碰 CATIA。

交付检查确认版本号/修订号、文件白名单、ZIP 条目分隔符和 SHA256 清单。原包实车 STEP 数据与性能测量属于用户提供的历史记录，未在本次复现；CATIA 端到端与 DSH 编译器对照未运行。
