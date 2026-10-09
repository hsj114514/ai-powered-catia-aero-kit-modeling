# GitHub 候选交付 — 1.2.0 / r11

- 版本与修订不变，建模运行时、评分权重和规则参数沿用输入 r11。
- 新增公开版中英文 README、v1.1.0/r6 → v1.2.0/r11 对照、已知问题与 v1.3 前目标。
- 加入作者指定自嘲原话，明确工具接入不等于主动使用或闭合成功。
- 排除私有 CAD 派生轮廓与历史实测记录；重新生成独立数学例子，旧文件名仅用于回归查找。
- 补充移植、贡献、安全与离线 GitHub CI；打包白名单包含隐藏元数据，统一 LF 并重算摘要。
- 打包检查阶段仅离线检查，未安装或启动 CATIA；后续单独授权后提交 GitHub 源码版本更新，未创建 Release。

详细说明见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。以下为旧代码修订日志；其中私有例子、历史文件与实测结论不适用于当前公开试件，参考 [HISTORY.md](HISTORY.md)。

---

# v1.2.0 / r11

- Native straight Sketcher profiles enter the effective plan and downstream GSD Loft.
- Added catia_sketch / catia_prepare_plan and an offline prepare-plan script.
- Correct line construction, geometric constraints, native coincidence and fail-closed endpoint readback.
- Explicit routing audit and native sketch execution fields; no inflated reward/tool-count bonus.
- Open-sketch closure/source contracts and updated Skill examples.
- No live CATIA/install/GitHub action; curved front seam and D3/D4 unverified.

# v1.2.0-r10

- Reconcile stale Sketcher, GSD and partial Part Design capability descriptions.
- Evaluate consumed profile tasks; add task routing advice and meaningful-constraint/tool-match priors.
- Add explicit/inferred closure obligations and capped penalty relief for relevant exact-build journal attempts.
- Add registration/resource fingerprint diagnostics and offline plan evaluation CLI.
- Preserve chained Boolean Body handles and activate the resolved target Body.
- Reject non-boolean guide closure flags and bound guide point counts.
- Correct front 250 mm zone semantics; map supplied 2026 geometry clauses without claiming official authentication.
- Add portable package/reinstall instructions and 75 policy regression checks; package version remains 1.2.0.

# Changelog

## v1.2.0 / r5 — 2026-10-09

- Sketcher: Body.Sketches, explicit axes/origin support, validated closed polygons, shared endpoints, catCstTypeLength=5, native Reference constraints, stable bound checks and CloseEdition on failure. Persisted sketches and AxisSystems are now discoverable.
- Editable sketch points/origin/constraints rebuild the ledger; edge lengths must match the edited coordinates. Native sketch length is measured through Line2D endpoints rather than assuming SPA accepts an entire Sketch.
- Habit priors: per eligible profile, per part and evidence aware; no name/prose-only reward. Fixed positive bonus scale, maximum 3 points. Pure evaluator validates emitted builder contracts before scoring.
- Added bilingual command dispatch and 6 factory adapters (139→145): MidSurface / auto threshold, Datums, SewSurface, RemoveFace and Add. Five requested command adapters remain NOT_IMPLEMENTED. Added axis_system ledger support for Axis to Axis.
- Added front Body union plans (66 steps), kept existing private-reference approximate geometry and requested foot/rib/tail elements; no native closure or exact NURBS claim. Plan step limit aligned to 2048 with existing point/script/depth budgets retained.
- 30 offline suites passed, including 265 new r5 cross-review checks. Windows Script Host syntax parsing passed with every modelling invocation disabled. No CATIA, installation or GitHub push.

# v1.2.0 / r2

配置继承、有界评分、真实依赖图、硬规则接入、Skill 注入、高层翼型朝向修复、离线评分工具、历史数据验证和 D3/D4 分阶段诊断。27 套离线测试；无 CATIA、安装或发布操作。详见 HISTORY.md。

# Change log

## v1.1.1 / r8 - 2026-10-09
- model-review 新增 prefer-native-gsd / sampled-approximation / separate-bodies-no-boolean 三条 GSD 优先 finding。
- prompt 人员策略加入 GSD 优先与单一闭合体优先条款。
- KIND_LEVEL 注册 part_api / asm_api（目录驱动机制沿用 gsd_api）。
- 新增 examples/r8-single-foot-rib-solid.plan.json（原生闭合轮廓 -> capped_extrude -> 单一闭合体，截面 270.053910 mm2，预测体积 121962.254 mm3）与 test/r8.mjs；门禁加入 r8。
- 未安装、未推送；part_api/asm_api 目录条目与生成器待下一版。


## v1.1.1 / r7 - 2026-10-09
- 新增catia_closed_loft / closed_loft与catia_capped_extrude / capped_extrude：共享边界封盖、独立Body及正体积判据。
- 新增左右各62步的端板实体候选，每侧9个Body；保留R2连接与足板开口，标明爬升圆角的参数近似范围，未做布尔合并或实机验证。
- 暴露已有AddNewHybridSplit接口为catia_gsd_split并增加类型/方向检查与示例。
- planFile未显式传dryRun时继承文件值；显式调用参数优先，拒绝文件中的非布尔值。
- 39个注册工具、15组离线门禁；版本1.1.1不变，修订r7；未安装、未推送。

## v1.1.1 / r6 - 2026-10-08
- catia_model_plan 新增 planFile 入参：绝对 .json 路径、<=8 MiB、必须含 steps 数组；与内联 steps 互斥；计划里的 project 必须与调用一致；计划里的 dryRun 只上报不覆盖参数。
- 大计划（01 63 步 / 02 30 步）因此可通过工具路径预检与实机执行。
- 新增 test/plan-file.mjs（离线；可选 FW_QY_TESTSET 环境变量时校验交付的四个计划）并加入 scripts/verify.mjs 门禁。
- 功能面与 r5 一致；本次未安装、未推仓库。


## v1.1.1 / r5 - 2026-10-08
- 修复结果回传：新增 lib/validation.js 的 toLossless()，并在 lib/tools.js 的 tool() 包装器两条路径统一清洗（丢弃 undefined 属性、-0 归零、非有限数转 null、非普通对象转标签），修掉实机复现的 	ool returned invalid output: value is not lossless JSON	。
- test/tool-schema.mjs 增加离线无损回归，含真实工具边界的拒绝路径（catia_g2_solve, count=7）。
- 修订号统一 r5；功能面与 r4 一致。
- 本次修复未做实机验证。


## v1.1.1 / r4 - 2026-10-08
- 修正 test/schema.mjs 的工具数期望（32 -> 36），该套件此前为红；把 schema 加入 scripts/verify.mjs 门禁，使同类漂移立即暴露。
- 修订号统一为 r4（package.json / gsd-catalog.json / 打包器守卫与默认文件名 / verify-live 报告 / README.en / r2.mjs 断言）。
- 打包器白名单加入 HISTORY.md。
- 本机部署：cordis.patch.yml 的 projectRoot 设为 <local-project-directory>（对外分发应改回空值以保留宿主发现）。
- 功能层面与 r3 完全一致：139 条接口、gsd-api、g2、model-review、闭合壳、gapSide 等均未改动。
- 仍未做实机验证。


## v1.1.1 / r3 — 2026-10-08

- 新增 139 个文档化 Automation 构造接口白名单、结果类配置方法与参数，覆盖线框、曲面、操作和16个圆角接口；新增 catia_gsd_catalog / catia_gsd_operation。
- 新增离线五次 Bézier 端点 G2 求解与 catia_model_review；原生 Connect/Blend/Fill 连续性配置不宣称已实测 G2。
- ShapeFactory 圆角要求 bodySource，保证基体先生成；圆弧和 Sweep 类型分类修正；参数类型、数组、字符串、方向、枚举与依赖严格预检。
- 增加 invertProfile 和 gapSide，支持倒置弯度及按父翼法向选择间隙方向，保留旧默认行为。
- 重新打开后读取实体时搜索 Bodies.Shapes 与嵌套几何集；失败时持有新建文档对象可直接丢弃，减少密集点逐个回滚开销，既有文档不按名称关闭。
- 增加 外部私有参考工程 前部结构独立候选、圆弧保压条、末尾圆弧外抛、明确坐标与下压力候选襟翼示例；不是完整整车复制。
- 本次只做离线验证，不安装、不启动 CATIA、不推送 GitHub。历史复杂圆角闭合/加厚失败仍保留，不能视为已实机修复。

## v1.1.1 / r2 — 2026-10-08

- Reproduced missing r1 endplate caps in CATIA; replaced periodic contour lofts with straight polygon wires, filled caps, extruded walls and a closed joined shell.
- Corrected extrusion directions/signatures, AddNewOffset, ThickSurface orientation, Join deviation/connexity and MainBody activation.
- Added ordered 3-D section surfaces and dependency-aware batch model plans with write-free dry runs.
- Enforced feature updates and positive area/volume checks before success; guarded failing GSD steps and tracked solid features.
- Added valid specimen probes with unique generated procedure scopes and explicit cleanup status.
- Strengthened source-type, duplicate/internal-ID, dependency-cycle and input-budget validation.
- Updated agent guidance, documentation and a generic complex endplate example.
- Removed fixed project-directory defaults, restored portable discovery/checksum scripts and GPL-3.0-only licensing.
- Added offline regressions and explicit live verification; version stays 1.1.1, revision is r2.

## Earlier versions

v1.1 introduced component-position reading and assembly operations; r1 expanded GSD and solid tools. Earlier reports describe their own historical scope and do not establish current capability or endplate correctness.
