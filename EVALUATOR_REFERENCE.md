# v1.2.0 / r10 奖惩公式

[闭合与工具策略](R10_PLANNING_POLICY.md) 是当前流程说明。注册的 `catia_evaluate_plan` 只读，先验证生成器、共享源类型合同、规则和依赖，再评分。非法输入、未知工具及已确认的硬规则拒绝不进入排名；total/score100=null。

## 当前公式

- 非习惯指标贡献 `T = sum(weight × metric)`；只对可评估的非习惯指标统计正权重 P 与负权重绝对值 N。
- `baseScore100 = 100 × (T + N)/(P + N)`；无可评估权重时为 null。
- 习惯贡献 `B = sum(habitWeight × habitValue)`；单项权重不超过 0.5、总权重不超过 2。`habitBonusPoints = min(config.habitBonusCapPoints, 3×B/2)`，共同最多 3 分。
- `closurePenaltyPoints = C_open + C_unknown`；默认已知开放目标的 C_open=6×mean(1-减免率)，有未知/仅输入闭合目标时 C_unknown=1。减免率最多 0.25，只取实际相关尝试一次，重复不累积。
- `score100 = clamp(baseScore100 + habitBonusPoints - closurePenaltyPoints,0,100)`。
- `total=T+B` 保留原始权重贡献，闭合处罚不写入 raw total；方案排名应使用 score100 和闭合报告。

配置来自 `scoring/`，前翼继承全局配置。闭合处罚上限配置限定 [4,10]，未知处罚 [0,2]，减免率 [0,0.25]。零/不适用习惯奖励不改变基础分母。最多的习惯奖励仍小于开放处罚减免后的最低上限，不保证不同风险结构的分数可直接比较。

H7 评价下游实际消费的合法草图约束；H8 对实际相连步骤按任务分组评价工具匹配，不按工具数量。H1 排除混合计划中无关且未声明为输出的草图。曲线翼型不为了加分改成多边形。R1/P6 现在也检查被消费的轮廓和显式 task，未知 task 被拒绝。

## 证据与比较

只比较相同权重、相同几何意图/闭合要求、相同证据覆盖集合的候选。规则缺项不能当作通过。source=CATIA 和 runId 只构成模块调用方证据契约，不认证真实性；面积、体积、Update、闭合、连续性、完整赛事合规分别检查。

注册工具不接受模型自填实机 evidence；可选 project 只读取宿主同一构建指纹的修复尝试日志。实际日志减罚不会产生 Build/Update/Rebuild 成功指标或闭合证据。离线几何输入、计划中的 Join 和 old reports 不能获得实际闭合证明。

score100 是 CAD 计划启发式指标，不是气动力、成功概率、训练奖励已生效的证明或赛事合规证书。实际 Agent 是否选择工具还取决于宿主加载与提示遵循，使用 policy_status 和新的提示会话核对。

---

## 历史 r2/r5 指标详解（公式以 r10 为准）

# v1.2.0 / r2 奖惩公式与使用边界

## 调用

注册工具 `catia_evaluate_plan {steps:[...], component:"front_wing", candidate:{...}}`：先用既有 builder 校验完整计划，再评估内部规则、启发式质量和人工审核提示。只读，不写账本、不调用 CATIA。`candidate` 可提供实际测得的离地高度等标量；规则缺项均明示，未确认条款不拒绝。不能独立证明整车包络或干涉合规。

纯模块 `evaluateBuildPlan(plan, loadWeights(...), options)` 只检查计划结构、依赖和参数规则。需要完整 GSD 参数/几何输入校验时，使用上述工具或 `catia_model_plan dryRun:true`。Skill 解释知识，不修改评分配置。任何 H 拒绝都令 eligible=false、total=null、score100=null。

## 配置与公式

`front_wing_weights.json` 的 extends 实际继承同目录全局配置，再覆盖同名指标。禁止循环、越目录继承、未知指标、非有限权重及反向奖惩符号。Fill/Extract 允许量和风险表从配置顶层读取。

所有已评估指标均在 [0,1]。`total = Σ(weight × metric)`；未测量/无法判断的指标为 null，不贡献分数、不假设通过。`score100 = 100 × (total + N) / (P + N)`，P 是可用奖励权重之和，N 是可用惩罚权重绝对值之和。无可用权重时 score100=null。证据覆盖率为可用绝对权重 / 配置绝对权重。

**只能比较相同权重和相同证据覆盖集合的计划。** score100 不是气动性能、规则通过率或训练得到的成功概率。不能与 r1 的无界原始分直接比较。

| 指标 | r2 实际依据与限制 |
|---|---|
| R1 Tool Suitability | 已知部件 builder 的任务匹配；通用 GSD 缺少 task 时不假设满分。顶层 task 可为 planar_profile / spatial_curve / multi_section_surface / surface_trim / solid |
| R2 Semantic Reference | 实际引用中的命名引用比例；无引用时看元素命名。说明文字中的 Edge/Face 不计入 |
| R3 Parameterization | 具有 builder 实际消费的可编辑标量的元素比例；不是 CATIA 原生参数、公式或约束验证 |
| R4 Canonical Path | AddNewLoft 实际依赖 section 和 guide_curve；无关辅助特征不加分 |
| R5/R6/R7 Build/Update/Rebuild | 有出处的 CATIA 证据；离线调用均为 null |
| R8 Surface Quality | [0,1] 的测量评价，不直接用 G2 等级 2 当作归一化分数 |
| R9 Low Topology Risk | 实际引用风险按配置平均；Face/Edge/BRep/索引明确区分 |
| R10 Historical Reliability | 经验证的历史计数产生 Beta-Binomial 后验；缺样本为 null |
| P1 Generated Topology Dependency | min(1, 有风险引用数量 / generatedDependencyScale)，原始数量另记 facts |
| P2 Fragile Chain | min(1, 实际连续脆弱依赖深度 / fragileChainScale)，与输入排列无关 |
| P3 Unnecessary Complexity | 完全相同形状构建输入的重复比例，只是重复特征启发式，不是最少特征竞赛 |
| P4/P5 Fill/Extract Abuse | min(1, max(0, 数量-allowance)/(allowance+1))；不禁止合理 Fill/Extract |
| P6 Tool Misuse | 已知任务与所选工具类别不匹配的比例；缺任务证据不能认定滥用 |
| P7 Continuity Mismatch | 按语义选 requiredContinuity；实测 actual 缺失为 null；已知 G0 需求无惩罚 |
| P8 Hardcoding | 1-R3，含上述账本层代理指标的限制 |
| P9 Historical Failure | 有出处的历史失败率，否则 null |
| P10 Unexplained Complexity | 仅 requireFunctionLabels=true 时，对缺 function/purpose 的形状计分；默认关闭 |

R9、P1、P2 都体现拓扑稳健性，是配置中有意重叠的风险项；它们不是独立概率，不能把总分解释为风险发生率。类别匹配不证明所选工艺对任意复杂几何最优。

## 真实结果、历史与连续性

纯模块的实时证据格式是 `options.evidence={source:"CATIA",runId:"可追溯记录",metrics:{buildSuccess:...,updateSuccess:...,rebuildSuccess:...,surfaceQuality:...},actualContinuity:0|1|2}`。这只是受信任调用方的证据契约，模块不能独立认证文件、签名或 runId。注册离线工具不接受自报的实时 metrics。直接传 `options.buildSuccess=1` 不获得奖励；越界数字直接拒绝。

选择 front_wing 的 mainplane_spanwise / flap_spanwise 语义需要 G2；独立 mainplane_to_flap、wing_to_endplate、intentional_sharp_edge 语义要求为 G0。全局 intentionalG0 标签不能覆盖 G2 需求。Area/Volume/Update 成功均不证明连续性。

HistoryStore 区分 GSD factory/op，拒绝原型键及无效计数，损坏 JSON 明确报错；持久化采用同目录临时文件和重命名，权限/文件占用失败不会伪造成功。历史模式仍不包含 CATIA 版本、许可或几何尺度，跨环境复用须人工判断，不把低样本后验当可靠证书。

Rebuild 仅定义 20 项扰动：Chord/Span/Gap 为比例，AoA/Twist 为角度加减。没有自动扰动执行器；successful 是完成 Update、Validate、Rollback 的 pass，total 是有 CATIA runId 的已执行尝试。仅 updated、重复 runId、无出处数据都不能产生满分。r1 历史案例与 r2 新几何分开，本版没有实机重建率。


## r5 条件性习惯奖励

基础归一化公式仅包含非习惯指标，返回 baseScore100。习惯项总贡献 B=sum(weight*value)，单项权重<=0.5，总权重<=2；habitBonusPoints=min(habitBonusCapPoints, 3*B/2)，上限配置必须在 [0,3]。score100=min(100,baseScore100+habitBonusPoints)，total 仍包含原始习惯贡献。没有可评估基础指标时 score100=null。未取得奖励为 0，不适用为 null，两者都不稀释基础归一化分母。不要拿 r4 的分数与 r5 直接比较。

H1 只比较当前 polygon Sketcher 能等价表达的二维多边形；曲线翼型 section 和样条不适用。逐轮廓评估防止一个无关草图给整套模型加满奖励。H3 的参数镜像仍是离线启发式，不是 CATIA 几何证明。H6 需要 part 标签及 evidence.bodies[id].volumeMm3>0 以及非空 bodyId（最终原生 Body 身份），source=CATIA 且 runId 非空；调用方应提供可追溯证据，模块本身不能认证来源。注册离线工具不接受自报实时证据。

纯 evaluator 现在也在打分前检查排序后的生成器输入合同；注册工具另外检查源类型、预算和相应操作的几何条件。结果仍只表示计划评价，不能代替 CATIA 更新、实体闭合和赛事测量。
