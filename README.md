# AI-Powered CATIA Aero Kit Modeling

[English](README.en.md) · **v1.1 / 1.1.0 · r6** · GPL-3.0-only

用于赛车空气动力学套件的 CATIA V5 参数化建模工具。v1.1 增加了**读取部件位置**和**装配操作**，帮助把翼面设计放入整车布局中。本包是 GitHub 源码交付版，保留 patched 包的修复。仓库：[hsj114514/ai-powered-catia-aero-kit-modeling](https://github.com/hsj114514/ai-powered-catia-aero-kit-modeling)。

## v1.1 能做什么

- 根据 NACA 四位翼型或坐标构建翼型、翼面、多级襟翼、端板、扩散器，以及点、线、平面和导引曲线。
- 以项目账本管理参数，重建编号版本，查看历史、回滚参数并导出几何。
- 离线读取 STEP 装配层级、实例和位置，导出 CSV；按需计算带质量标记的近似包络。
- 从 CATIA 当前产品树读取部件在装配坐标系中的绝对位置，组合嵌套装配的局部变换。
- 在 CATProduct 中插入、移除或替换实例；检查刚体放置矩阵，支持保存为新的总装文件。
- 根据用户提供的车轴、轮胎、地面及区域基准，初筛部分几何规则。

**几何范围：**不评价安装刚度、约 200 N 加载变形、结构强度或气动性能。端板和扩散器生成曲面，不自动保证封闭实体。规则初筛不能代替最终模型测量、官方规则与车检。

## 运行要求与兼容性

| 使用方式 | 需要 | 说明 |
|---|---|---|
| 离线几何/STEP 模块与规则筛查 | Node.js 18+ | 仅使用 Node 内置模块，无需 npm 安装或构建 |
| CATIA 实时建模、位置读取及装配 | Windows、CATIA V5、可用 COM 自动化与相应许可 | 需要目标机器验证接口和许可；包内不包含 CATIA |
| 作为 Agent 插件 | 提供 tools 服务的 DSH/Cordis 宿主 | 内部包名保留 `@local/catia-aero-kit`，避免破坏加载配置 |
| 其他 Agent | 自行接入模块或适配工具定义 | 本包没有通用 MCP 服务入口，不能直接当成任意 Agent 的即装即用插件 |

`package.json` 的 `private: true` 防止误发 npm，不影响 GitHub 下载或 DSH 本地包加载。

## 新机器快速开始

1. 下载并完整解压，找到同时包含 `index.js`、`package.json` 和 `cordis.patch.yml` 的目录。
2. 在该目录运行只读环境诊断和文件完整性检查：

```powershell
node scripts/doctor.mjs
node scripts/checksums.mjs
# Windows 可额外检查脚本宿主与 CATIA COM 注册：
powershell -NoProfile -File scripts/doctor.ps1
```

诊断不会安装软件、注册 COM 或启动 CATIA。COM 注册存在不代表实际建模可用。SHA256 清单用于检查交付文件是否改变，不提供发布者身份验证。

若 Windows 提示禁止运行脚本，可在检查源码后为上述命令加入 `-ExecutionPolicy Bypass`。该参数仅作用于本次 PowerShell 进程，不修改系统执行策略。Node 诊断与完整性检查无需此参数。

3. 在目标 DSH 会话中，通过宿主的包管理工具导入目录：

```text
plugin_manager action: install_bundle, target: <解压后的包目录绝对路径>
```

安装命令由宿主提供；不同宿主版本应以其帮助为准。导入后确认 `catia_*` 和 `step_assembly_components` 已注册。纯离线模块无需安装插件。

4. 在 Windows 启动 CATIA，在独立项目与工作副本上开始设计。先运行 `catia_env project: "AERO_DEMO"`；只有准备执行写盘探测时才加 `checkWrite: true`，该选项会创建并删除探测文件。

### 自动发现路径

随包 `projectRoot: ''`，运行时按顺序选择当前主机中非空、绝对的目录：

`LOCALAPPDATA → XDG_DATA_HOME → HOME/.local/share → TEMP → 系统临时目录`

随后追加 `catia-aero-kit/projects`。不使用开发机路径或宿主工作目录。数据目录不能写入时，可在 `cordis.patch.yml` 显式指定本机可写的绝对路径。回退到临时目录时应定期备份账本和几何文件。

Node 根据 PATH 发现，Windows 诊断还探测当前机器常见的用户/系统安装位置；脚本宿主根据 SystemRoot 定位。软件缺失时给出诊断，不会自动下载安装。

### 配置

| 配置 | 运行时默认值 | 随包值/用途 |
|---|---|---|
| enabled | true | 注册工具 |
| projectRoot | 自动发现 | 空字符串，自动定位当前用户目录 |
| maxLevel | 2 | 随包为 3，保留装配移除/替换；只用建模和插入可改为 2 |
| allowOverwrite | false | 保留 false，避免覆盖已有输出 |
| allowDeleteOwnFeature | true | 失败时清理本次创建的特征 |
| scriptTimeoutMs | 900000 | 单次自动化超时，毫秒 |
| persona | true | 宿主支持时注册操作规范 |

装配移除/替换为 Level 3：除配置上限外，还要求 `confirm` 精确重复实例名并填写 `reason`。这些字段用于防误操作，不能代替操作人的授权。

## 建模示例

以下是 Agent 工具参数示例，不是终端命令：

```text
catia_multi_element_wing project: "AERO_DEMO", id: "rear_wing",
    naca: "2412", span: 1200, zStart: -600,
    chordRoot: 300, chordTip: 220, aoaRoot: 8, twist: -2,
    sweepDeg: 5, dihedralDeg: 2, stations: 5,
    flaps: [{ chordRatio: 0.3, deflectionDeg: 25, gap: 5, overlap: 3 }]

catia_check_rules project: "AERO_DEMO",
    rules: { groundY: 0, maxSpan: 1600, maxHeight: 900, minGroundClearance: 50 }

catia_export project: "AERO_DEMO", format: "step"
```

示例尺寸是演示参数，不代表赛事规定。建模单位为毫米，+X 向后、+Y 向上、+Z 向外；正攻角抬高前缘。多级襟翼逐级串联：后一级的弦长比、偏转、gap 和 overlap 相对其父级。旧账本保留原 parentId。

## 读取部件位置

```text
step_assembly_components project: "AERO_DEMO",
    file: <整车.step绝对路径>, includeBounds: false, exportCsv: true

catia_open_document project: "AERO_DEMO", path: <总装.CATProduct绝对路径>
catia_assembly_positions project: "AERO_DEMO", maxDepth: 12, maxComponents: 500
```

STEP 不需要启动 CATIA；CATIA 位置读取使用当前活动产品文档。查看位置状态、未解析实例和截断标记；工具最多显示 80 个结构化预览，STEP 可用 CSV 查看保留的完整表。

读取输出统一为**行主序 3×4**：

```text
[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]
```

平移位于索引 3、7、11。STEP 数值使用源文件单位，尚未自动换算；建模、CATIA placement 和以 mm 命名的包络阈值按毫米使用。必须先核对导出单位，并把整车坐标、地面和车轴基准变换到同一坐标系。

`includeBounds: true` 返回近似包络；其 `boundsStatus`、`boundsWarnings` 和 `boundsUsableForCompliance: false` 必须保留。不完整、有理或不支持几何、过滤及资源上限均可能降低可信度。分配预算限制部分内部数组，不等于进程总内存限制。位置只是部件原点与方向，不能证明完整外形无干涉。

## 装配操作

```text
catia_assembly_insert project: "AERO_DEMO",
    product: <总装.CATProduct绝对路径>, component: <翼面.CATPart绝对路径>,
    instanceName: "Wing.1",
    placement: [1,0,0, 0,1,0, 0,0,1, 100,200,300],
    saveAs: <新的总装.CATProduct绝对路径>

catia_assembly_replace project: "AERO_DEMO",
    product: <总装.CATProduct绝对路径>,
    componentPath: ["RearAssembly.1","Wing.1"], component: "Wing.1",
    withFile: <新版翼面.CATPart绝对路径>, confirm: "Wing.1",
    reason: "替换已经人工确认的新版翼面",
    saveAs: <另一个新的总装.CATProduct绝对路径>
```

插入的 `placement` 使用 CATIA 原始轴格式：

```text
[X轴x,X轴y,X轴z, Y轴x,Y轴y,Y轴z, Z轴x,Z轴y,Z轴z, 原点x,原点y,原点z]
```

它与读取输出的行主序矩阵不同，不能直接混用。示例为无旋转、平移 [100,200,300] mm。矩阵必须是正交、右手刚体变换。嵌套 componentPath 逐级精确匹配唯一实例。替换保留旧件局部放置，但新旧部件的局部原点、约束和发布引用仍需检查。

- 不传 saveAs 时只修改 CATIA 会话；保存失败时会话也可能已经改变，应检查后再重试。
- saveAs 必须指向不存在的新文件。装配输入和输出可在项目目录之外，应仅操作已授权的工作文件。
- CATProduct 仍引用原部件文件。本工具不自动收集引用；跨机器交付装配须在 CATIA Save Management 中收集外部引用。

## 几何与规则筛查

```powershell
node scripts/geometry-check.mjs <ledger.json路径> <rules.json路径>
```

退出码：0 表示所选精确几何通过给定检查；2 表示冲突、采样不确定或缺失数据；1 表示输入错误。只适用于工具实现的几何范围。

点/直线可按实际区域裁切；样条和放样筛查输入点，不能保证最终曲面完全在区域内，此时返回 PARTIAL_SUCCESS、screeningOnly 和 uncertainElements。T9.4/T9.5/T9.6 的部分检查依赖调用者提供正确基准；本包没有完整赛事规则数据库。最终曲面、间隙和区域边界必须在 CATIA 中测量确认。

## 开发、交付与文档

```powershell
node scripts/verify.mjs
powershell -NoProfile -File scripts/package.ps1 -OutputFile <新的zip绝对路径>
```

离线检查不会启动 CATIA。打包脚本只收集源码、文档、许可证、检查脚本和 GitHub 工作流，生成 SHA256 清单；不携带本机项目、CAD 文件或生成报告。Windows/Linux 的 GitHub 离线检查已配置，实际执行结果需发布后查看 Actions。

本次本地准备检查了源码语法与交付完整性，未运行回归测试或实时 CATIA 验证；不能据此确认全部功能已通过。

- [v1.1 更新记录](CHANGELOG.md)
- [v1.1 更新说明](RELEASE_NOTES.md)
- [本次移植交付说明](PORTABILITY.md)
- [贡献指南](CONTRIBUTING.md)、[安全问题](SECURITY.md)
- [工具与操作规范](CHARTER.md)
- 历史审查：[REVIEW_r6.md](REVIEW_r6.md)、[REVIEW_v1.1.0.md](REVIEW_v1.1.0.md)、[CODE_REVIEW.md](CODE_REVIEW.md)、[实车记录](VERIFICATION-real-vehicle.md)

历史记录描述原开发时的环境和数据，不是本候选版的实时 CATIA 或实车验证结果。

## 许可证

源码按 **GNU GPL v3 only（GPL-3.0-only）** 发布，全文见 [LICENSE](LICENSE)。CATIA、DSH/Cordis、Node.js 不包含在包内，分别遵循各自的许可。公开源码不会提供 CATIA 软件或许可。
