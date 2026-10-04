# @local/catia-aero-kit

面向**赛车空气动力学套件**的受控 CATIA V5 参数化建模插件。给 DSH Agent 一套固定白名单的气动领域建模工具，用它把「弦长 300、展长 1200、襟翼偏转 25°、gap 5mm」这类参数直接变成 CATIA 里可编辑、可复现、可回滚的参数化曲面。

- 完整行为规范：[CHARTER.md](CHARTER.md)
- 工具清单：见 CHARTER 附录 A
- CATIA 自动化能力与限制：见 CHARTER 附录 B

---

## 1. 运行要求

- Windows + 已安装并可通过 COM 自动化访问的 CATIA V5
- CATIA 的 COM 自动化接口可注册（注册表存在 `CATIA.Application`）
- DSH 任一 profile

插件本身**没有任何 npm 依赖**，只用 Node 内置模块；不需要构建步骤。

## 2. 安装

在 DSH 会话中安装（`target` 指向本目录的绝对路径）：

```
plugin_manager  action: install_bundle
                target: <解压后的插件目录绝对路径>
```

安装后插件按 `cordis.patch.yml` 中的 `config` 激活。可用
`cordis_inspect_query(platform: host, provider: Tool, method: listTools)` 确认 `catia_*` 工具已出现。

## 3. 配置

`cordis.patch.yml` 的 `config` 字段（全部可选，均有安全默认值）：

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 关闭时插件不注册任何工具或提示段落 |
| `projectRoot` | `<工作目录>/catia-projects` | 所有项目、版本文件、导出与审计日志的根目录；工具无法越出此目录 |
| `maxLevel` | `2` | 允许执行的最高安全等级；超过即被工具拒绝 |
| `allowOverwrite` | `false` | **保持 false**：目标文件已存在时自动改用 `_AgentNN` 后缀 |
| `allowDeleteOwnFeature` | `true` | 是否允许删除本插件自己刚创建的特征（失败回滚用） |
| `scriptTimeoutMs` | `900000` | 单次 CATIA 自动化脚本的硬超时（毫秒） |
| `persona` | `true` | 是否注册安全宪章系统提示段落 |

## 4. 快速开始

```
catia_env                  project: "FW_AERO", checkWrite: true
catia_multi_element_wing   project: "FW_AERO", id: "rear_wing",
                           naca: "2412", span: 1200, zStart: -600,
                           chordRoot: 300, chordTip: 220, aoaRoot: 8, twist: -2,
                           sweepDeg: 5, dihedralDeg: 2, stations: 5,
                           flaps: [{ chordRatio: 0.3, deflectionDeg: 25, gap: 5, overlap: 3 }]
catia_check_rules          project: "FW_AERO",
                           rules: { maxSpan: 1600, maxHeight: 900, minGroundClearance: 50 }
catia_export               project: "FW_AERO", format: "step"
```

建模坐标约定：**毫米**，**+X 向后（前缘在 x=0）、+Y 向上、+Z 向外**；攻角正值为前缘抬高。

## 5. 工作方式（为什么这样设计）

**所有设计变更 = 改账本 + 重建成新的编号版本。** 插件从不原地修改几何，也从不覆盖已存在的文件。

```
<projectRoot>/<项目>/
  ledger.json                 设计账本：元素参数、版本快照、约束
  audit.jsonl                 审计流水：每次工具调用的级别/参数/改前改后/结果
  FW_AERO_GEN_001.CATPart     版本 1（永久保留）
  FW_AERO_GEN_002.CATPart     版本 2（永久保留）
  exports/                    导出的 STEP/STL，永不覆盖
  .dsh-catia/scripts/         每次实际执行的自动化脚本
  .dsh-catia/reports/         每次执行的逐步报告
```

由此得到几个直接好处：

- **可复现**：账本就是模型定义，重放账本必然重建出同一模型。
- **可回滚**：`catia_rollback` 恢复旧版参数重建成新版本，旧文件一个都不删。
- **可审计**：`catia_audit` 给出时间、工具、等级、参数、改前改后、错误、回滚情况。
- **事务性**：某个元素的构建失败时，本次脚本创建的特征会在同一脚本内回滚，文档停留在上一个有效状态；账本也会回滚，不记录这次失败的改动。
- **不破坏原始数据**：用户的母版文件只被读取，从不被写入。

**为什么不做原地编辑**：在已有版本文件上删改特征，一旦重建失败就会毁掉最后一个有效状态。新版本重建虽然文件多一点，但任何一步失败都不会损失已有成果——这符合宪章里「安全失败优于错误成功」。

## 6. 迁移 / 复制到别的机器

本插件是自包含的：整个目录复制过去即可。

1. 复制整个 `catia-aero-kit/` 目录到目标机器（保持目录结构：`index.js`、`lib/`、`cordis.patch.yml`、`CHARTER.md`、`locale/`、`icon.svg`）。
2. （可选）在 `cordis.patch.yml` 的 `projectRoot` 中填写目标机器上允许写入的工程目录；留空时默认使用 DSH 当前工作目录下的 `catia-projects/`。
3. 在目标机器的 DSH 会话里执行 `plugin_manager action: install_bundle, target: <复制后的绝对路径>`。
4. 用 `catia_env` + `checkWrite: true` 确认该机器上的 CATIA 允许写盘，然后跑一次上面的快速开始流程。

无需 npm 安装、无需编译；目标机器只需有 CATIA V5 和 DSH。CATIA 安装位置由插件按当前主机的环境变量、常见安装根目录和 Windows 注册信息自动探测，不需要在配置中填写开发机路径。

## 7. 已知限制（实测，非猜测）

- **需要 CATIA 允许写盘。** 如果 CATIA 实例所在会话不允许写文件，`SaveAs`/`ExportData` 可能失败。此时 `catia_env` 的 `checkWrite` 会如实返回 `canWriteFiles: no`，建模类工具会报告保存失败，而不会谎报成功。请在目标 CATIA/DSH 会话中确认文件写入权限。
- **翼型默认带有限厚度的后缘。** 数学上零厚度的尖后缘会让 CATIA 的多截面放样必然 Update 失败（实测，见 CHARTER 附录 B）。默认使用有限后缘（0.21% 弦长）既符合真实坐标文件的定义，也保证可放样；`naca4Loop` 仍保留 `closedTrailingEdge` 选项供对照实验。
- **`gap` 是「父级后缘 → 襟翼前缘」的垂直距离，不等于最小面间距。** 样例中 `gap: 5 mm` + `overlap: 3 mm` 的实测最小面间距为 2.95 mm（25° 偏转）/ 3.16 mm（30° 偏转），因为襟翼前缘被 overlap 推入主翼下方后，最近点出现在襟翼上表面与主翼下表面之间。若设计意图是「最小通道 5 mm」，请用 `catia_measure` / `catia_check_clearance` 复核后调整 `gap`。
- **修改插件自身的 JS 后需要重启 DSH，或同时更换包名与目录路径。** DSH 的加载器按包标识缓存插件的入口模块，Node 又按真实文件路径缓存 `lib/*`；只改其中一项会让宿主继续运行旧代码（`plugin_manager` 的启用/禁用与重装都不足以刷新）。这是 DSH 的模块代机制，不是本插件的缺陷。改完 JS 后：重启 DSH 最省事；若不想重启，则同时改 `package.json` 的 `name`、`cordis.patch.yml` 的 `name`，并把目录换成一个新路径后再 `install_bundle`。
- **STL 需要闭合实体。** 本插件的机翼/襟翼是曲面，STL 导出可能合理地失败；STEP 不受影响。
- **功能受 CATIA 版本和自动化接口影响。** 插件只调用实现中明确支持的自动化接口；目标环境差异可能导致个别操作不可用。端板/扩散器通过多截面曲面放样构建。
- **翼型坐标不内置。** NACA 4 位翼型由解析公式生成；S1223 等真实翼型必须由用户提供坐标文件或坐标数组（可通过 `catia_airfoil` 的 `coordinates` 传入），以避免伪造工程数据。
- **串行执行。** 所有工具都标记为非并发安全，Harness 会串行调用；同一时刻只有一个自动化脚本驱动 CATIA。
- **一次设计迭代一个文件。** 版本文件会随迭代增多（这是刻意的版本隔离）；不需要的旧版本由用户自行归档删除。

## 8. 安全边界

插件在代码层面（不只是提示里）强制执行：

- 超过 `maxLevel` 的操作直接拒绝并记入审计。
- 所有项目路径经 `safeName` + 目录围栏校验，模型无法让插件写到项目目录之外（例如用 `..\..` 或绝对路径）。
- 目标文件已存在时自动改名，绝不覆盖。
- 每次调用的输入参数、级别、结果、错误都写入 `audit.jsonl`。
- 运行时会再次校验工具输入；参数 schema 主要用于描述接口，不能单独视作运行时安全边界。坐标、导向线点和端板轮廓分别限制数量，超限请求会拒绝，不会静默截断。
- 插件不含第三方运行依赖、安装生命周期脚本或网络访问代码。生成的 VBScript 通过 CATIA COM 建模，并使用文件系统对象写入插件自己的报告文件。
- 调用建模工具会允许 AI Agent 在当前用户权限下驱动已运行的 CATIA，并在配置的项目目录中创建新版本文件；CATIA 的文件提示会由自动化关闭。请只对可信任的 Agent 和工程目录启用本插件。
- 输入校验或执行前错误会返回 `BLOCKED` 并尝试写入审计日志；项目名本身无效时，错误会记入默认 `_scratch` 项目的日志。

模型侧的规则（分级、白名单、事实边界、人工确认节点）见 [CHARTER.md](CHARTER.md)。

