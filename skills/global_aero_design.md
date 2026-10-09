## r11 执行路径更新

先检查 catia_policy_status 的 revision=r11。catia_prepare_plan 是只读候选准备，catia_model_plan 默认采用 sketch_first，精确将平面直线放样截面变为带尺寸/方向约束的 sketch，保持输出 ID、端点和截面顺序。需要逐字执行已有计划时，显式 routeMode:literal 并给出 routeReason；结果和审计保留该理由。
可直接调用 catia_sketch。草图支持闭合直线多边形和开放折线，length/horizontal/vertical/parallel/perpendicular；原生重合约束连接相邻线端点。只增加没有下游引用的装饰草图不能获得“已参与建模”的结论。圆弧、翼型、真实自由曲线仍用合适 GSD；不折线化曲线换奖励。
核对 routeAudit 中 consumedBy、请求约束及采样曲线清单。实机时再核对 nativeSketches 的约束数、状态和端点读取，截图中没看到尺寸标注不证明没创建草图。代码不保证显示所有草图，也不认证完全约束。若读取接口失败，应报告失败，不能用输入坐标冒充求解后的测量。
曲面试件允许开放截面；材料应闭合的轮廓需 geometryRequirements。开放曲面、Join 面积和低惩罚均不能证明闭壳。端板前部的自由曲线/圆角仍须独立重新规划与检查。

# Global Aero Design Skill (v1.2.0 r11)

职责边界：**Skill 负责设计理解；硬规则由 /rules 判定；权重由 /scoring 提供；奖惩由 /evaluator 计算。** Agent 不得自行修改评分公式或权重。

## Part A - 空气动力学基础

- **动压**：`q = 1/2 rho V^2`。固定密度、参考面积及相应气动系数时，载荷随速度平方增长；不能忽略姿态、雷诺数或分离对系数的影响。
- **升力/下压力**：`L = q S CL`；赛车用下压力近似为 `-L`。
- **阻力**：`D = q S CD`。
- **气动效率**：本项目统一定义并始终使用 `|CL| / CD`（需 CD>0，正负号约定必须明确）。
- **压力差**：翼面载荷主要来自上下表面压力差；几何形状的目的是制造并维持该压差。
- **边界层**：需理解 attached flow / separation / adverse pressure gradient；逆压梯度过长会导致分离。
- **攻角**：通常增大攻角增加载荷，但同时增加阻力与分离风险。**禁止"攻角越大越好"。**
- **多翼元**：可能用于增加有效弯度、控制压力恢复、提高高载荷能力；元素越多并不自动更好。
- **Gap**：影响翼元之间的槽道流动；**不存在无需验证的唯一最佳值**。
- **Overlap**：影响多翼元相对流向关系与压力恢复。
- **三维流动**：finite span、tip effect、spanwise flow、vortices。
- **地面效应**：赛车近地运行，地面强烈影响底部气流。
- **Yaw**：不应只按零偏航评估。
- **Aero Balance**：必须同时关注 front downforce、rear downforce、total downforce、drag、balance。
- **Robustness**：性能必须考虑 ride height、yaw、制造公差、几何变化。

## Part B - 整车气动部件基础

Front Wing、Rear Wing、Floor、Diffuser、Sidepod、Endplate、Winglet、Turning Vane、Deflector、Cooling Duct、Bodywork、Wheel Wake Management Device。
此处只描述最基础功能；详细设计知识属于各 Component Skill（当前仅建立 Front Wing）。

## Part C - 奖惩指标解释（数值见 /scoring）

**奖励**：R1 Tool Suitability（是否选了合适的工具，而非"用了很多 GSD 命令"）、R2 Semantic Reference（命名参数/平面/点/截面/导向线优于 `Edge.3`/`Face.7`）、R3 Parameterization（关键变量由参数驱动）、R4 Canonical Path（成熟人工路径，**只是方法先验、不是最高权重**）、R5 Build Success、R6 Update Success、R7 Rebuild Success（**核心稳定性指标**，`successful/total`）、R8 Surface Quality（按语义要求 G0/G1/G2，**不是所有非 G2 都扣分**）、R9 Low Topology Risk（初始风险表见配置）、R10 Historical Reliability（低样本期用 Beta-Binomial，不训练大模型）。

**惩罚**：P1 Generated Edge/Face 依赖、P2 Fragile Dependency Chain（越长越罚）、P3 Unnecessary Complexity（**不是特征越少越好**，而是不必要复杂度越低越好）、P4 Fill Abuse、P5 Extract Abuse、P6 Tool Misuse（例如本该用 Multi-Section Surface 却用 Pad+Boolean+Extract Face 绕出来）、P7 Continuity Mismatch（要求 G2 实际 G1/G0；**intentional G0 不罚**）、P8 Parameter Hardcoding、P9 Historical Failure、P10 Unexplained Design Complexity（无法说明用于 load generation / flow conditioning / wheel wake management / pressure control / sealing / vortex control 的新增几何）。

**代码原则**：R5/R6/R7 只能来自**真实 CATIA 结果**（测量/Update/Rebuild 记录），缺失时必须为 `null` 并注明"未提供"，**不得假设**。
## r2 公式与事实边界
- 正奖励权重、负惩罚权重均来自配置；前翼配置实际继承全局配置。所有可用指标规范到 [0,1]，硬拒绝时 total/score100=null，不进入排序。
- 数量与依赖深度列入 facts；评分使用有界惩罚，真实依赖图不受步骤排列影响。命名/标签不能冒充参数绑定，说明文本里的 Edge/Face 不算拓扑引用。
- 通用 GSD 工具缺少任务语义时不假设 Tool Suitability=1；标注 task 后按类别匹配。Fill/Extract 是合法工具，合理允许量来自配置。
- 连续性要求由部件语义决定，缺少实测不得假设 actualContinuity。一个全局 intentionalG0 标签不能免除主翼跨展向 G2 要求。
- 真实指标需可追溯的 CATIA runId 与证据；单独传数字不会获得实机奖励。纯函数只能检查调用方证据契约，不能独立认证证据真实性。
- RebuildSuccess=完成 Update、Validate、Rollback 的成功次数 / 有出处的已执行扰动次数；updated 标记本身不算完整成功。扰动执行器尚未自动接入 CATIA，仅提供网格和记录计算。
- score100 是 CAD 方案启发式评分，不能跨权重或证据覆盖率直接比较，不能用作气动性能、制造质量或合规证书。

## Part D - 成熟习惯先验：条件性小奖励（v1.2.0 r5）

这些先验不能覆盖硬拒绝、几何需求、规则或实际功能；权重仍由 scoring 配置维护。

| 项目 | 适用条件和证据 |
|---|---|
| H1 Sketcher | 当前草图适配仅支持封闭多边形；逐个评估 sketch/endplate 的等价轮廓。不把 section/样条变成折线换取奖励。首选能力确实不可用时，只有带结构化 substitute={preferred:"sketcher",reason:"..."} 的同一轮廓才获得半额。模块调用方必须提供不可用状态；注册离线工具不接受自报不可用。 |
| H2 默认基准面 | 命名默认面且 offset=0；任意偏移面不能冒充默认面。 |
| H3 中面对称 | 比较参数生成的镜像轮廓，或使用零偏移 XY 基准面的原生 Symmetry；L/R/mirror 名称不构成证据。该奖励仍不证明原生结果对称。 |
| H4 基准先行 | 实际基准依赖按 DAG 排序；输入数组顺序不影响分数。 |
| H5 声明替代 | 仅首选功能已被确认不可用时评估该轮廓的结构化替代声明，任意备注不加分。 |
| H6 单一闭合体 | 按 part 分组，需要带 CATIA runId、最终 bodyId 的正体积证据；同 part 按最终 Body 身份去重，而非按构造步骤计数；离线数量或构造器名称不证明闭合。 |

基础分排除所有习惯项；r11 新增 H7 适用尺寸约束、H8 实际相连步骤的任务工具匹配。重复命令与无关草图不增加新奖励；小奖励使用固定尺度相加，最大 3 分。零奖励或不适用不会降低基础分。名称、空草图、无关特征、解释文字不得被当作实际实现。

Sketcher 在代码层已经实现封闭多边形、边长约束和编辑账本重建，状态是 IMPLEMENTED / NOT_LIVE_VERIFIED。使用 catia_model_plan 的 sketch 种类创建，使用 catia_set_aero_param 编辑 points/origin/constraint(s)。XY 的 u=X/v=Y，YZ 的 u=Y/v=Z，ZX 的 u=Z/v=X；origin 为世界毫米坐标，设置明确轴向。曲线草图、圆弧、完整约束求解和交互 UI 没有实现。

查询 catia_gsd_catalog 获得中英文命令与接口状态；catia_gsd_command 使用命令名并转到同一白名单调用器。不得将 NOT_IMPLEMENTED 功能改名为别的功能或生成猜测的 COM 调用。端板先闭合各材料体，再显式合并相邻实体；多个封闭 Body、Join 面积或正体积均不能单独证明整件端板没有外露缝隙或满足规则。


## r11 执行顺序与闭合纪律

先核对 `catia_policy_status` 的注册版本和资源指纹；宿主应启用 persona 并重载新提示。使用 `R11_SKETCH_ROUTING.md`（奖惩沿用 `R10_PLANNING_POLICY.md`），工具支持状态以实际目录和注册定义为准，不沿用历史未实现清单。

1. 识别几何语义：可等价表达的二维多边形优先草图；曲线翼型保留原生曲线，精确圆弧用解析 GSD，空间导向线与曲面操作用 GSD。给相关步骤标 task，不默认只发样条。
2. 草图尺寸需求可用合法 length 约束时尝试；当前支持尺寸、水平/竖直、平行/垂直；没有相切、半径或完整约束认证，不宣称全约束。不能添加无关草图和约束来获取奖励。
3. 显式列出 geometryRequirements（closed_wire / closed_shell / solid），每项有目标和理由。设计足板开口保留，闭合的是周围材料边界；保压条圆弧、与足板圆角连接、条下开口、后缘圆弧外抛均不因奖励而删除。
4. 先 dryRun、model_review、evaluate_plan，阅读 toolAdvice 与 closure；对已知开口提出相关的 Join/Healing/Fill/CloseSurface/Boolean Add 路线，查询参数和引用类型再构建。
5. OPEN 必须扣分；UNKNOWN/CLOSED_INPUT 需保留验证缺项。计划里的修复不减罚，实际同一构建的日志修复尝试最多减轻 25%。重复命令不累计奖励或减免，减罚不能让 OPEN 变成闭合或交付完成。
6. H7 只奖励被下游实际消费的兼容尺寸约束，H8 按任务分组评价工具适用性；加起来与其他习惯项最多 3 分。不按工具种类数、命令数或文字解释加分。
7. 原生 Update、正面积/体积、无缝闭合、G2 和规则合规是不同证据。不能把样条闭合标记或 Join 成功当作最终整件端板闭合。原生检查没有执行时如实报告候选方案和缺项。

规则几何来源映射见 `rules/source_2026_geometry.json`；250 mm 区域在前轴以前、前轮内侧平面以外，不是两轴之间的通用高度限制。原始文档为用户提供的答题版，未核验官方来源；50 mm 离地高度仍只是历史项目偏好。规则缺项不能被工具奖励或闭合减罚抵消。
