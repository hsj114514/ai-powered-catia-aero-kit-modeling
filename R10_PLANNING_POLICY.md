# r10：工具选择、约束与闭合奖惩

## 本版解决什么

旧版 Front Wing Skill 写着 Sketcher 未实现，CHARTER 和内核也残留过期能力描述；评分又排除了参考轮廓。这些冲突会诱导 Agent 继续只用样条。r10 统一说明、增加轮廓评分和结构化建议，但没有模型训练或强制保证 Agent 每次遵循建议。

二维**多边形**轮廓优先 `kind:sketch`。曲线翼型保持曲线；准确圆弧使用 GSD 解析圆弧。当前草图只有闭合多边形、共享端点和 `length` 约束；不能虚构相切、水平、半径约束、完全约束求解、Pad/Pocket。空间导向线、投影、交线、扫掠、修剪和曲面连接依照 `catia_gsd_catalog` 选择。

## 推荐工作顺序

1. `catia_policy_status {}`：核对 r10、资源指纹、persona 开关和工具状态。
2. 给适用步骤写 `task`；给必要的闭合目标写 `geometryRequirements`。
3. `catia_model_plan {project,steps,geometryRequirements,dryRun:true}`：验证全部依赖和输入，阅读 `toolAdvice/closure`。
4. `catia_model_review`、`catia_evaluate_plan`：按问题修订方案，比较相同规则、权重、闭合目标和证据覆盖下的方案。
5. 用户只要求离线时，交付候选计划和检查结果。实机执行、安装、发布需要相应授权。

`task` 支持：planar_profile、planar_closed_profile（本版表示可由多边形草图等价表达的闭合二维轮廓）、spatial_curve、multi_section_surface、surface_trim、solid、closure_repair、projection、intersection、surface_sweep、curve_blend、surface_fillet。没有任务语义的通用 GSD 不假设满分。

## 约束和更多工具的奖励

H7：下游实际消费的合法草图有兼容尺寸约束时，小额加分；只按有无合理约束，不按约束数量。值必须与输入边长相符，修改尺寸时同步修改点与约束。共享端点已经连接多边形，不能重复约束骗分。

H8：按不同的**实际相连任务**分组评价工具匹配，再取平均；多次执行同一工具不增加额外奖励。无关节点不获得这项奖励。H1 也排除了混合计划中不被消费且未声明为输出的无关草图。空间曲线和曲线翼型不因没有草图被强行折线化。

所有习惯奖励共同最多 3 分，仍不能覆盖硬拒绝。

## 闭合目标与状态

```json
"geometryRequirements": [
  {"target":"EndplateProfile","type":"closed_wire","reason":"端板材料轮廓必须闭合"},
  {"target":"EndplateSolid","type":"solid","reason":"需要最终端板材料实体"}
]
```

类型为 closed_wire、closed_shell、solid。单边界 Fill 的线框、CloseSurface 的壳、capped_extrude 的源线框和实体输出自动产生必要目标；planar_closed_profile 任务、endplate 以及实体构造器也自动产生相应目标。任意曲面的用途仍需用户意图和显式声明，系统不能猜出所有缺失的交付目标。省略声明不能证明交付完成。

| 状态 | 含义 |
|---|---|
| OPEN | 已知开放、目标类型不符，或有出处的检查报告开放 |
| CLOSED_INPUT | 多边形输入合同闭合；没有证明原生几何闭合 |
| UNKNOWN | 缺少原生闭合检查 |
| CLOSED_NATIVE | 受信任模块调用方提供符合契约的闭合检查记录 |

`surface.closed:true` 只闭合截面曲线，不封闭放样两端。Join、Healing 成功和正面积均不证明闭壳；正体积不能独立证明整件端板无外露缝隙或单域。最终材料体应根据需要连接和合并，保留足板开口、圆弧保压条、连接圆角与后缘外抛。

注册的只读 evaluator 可通过可选 `project` 读取本插件日志中的**同一构建指纹**，采集实际到达修复构造调用的记录；不接受 Agent 自填 `evidence`。这不启动 CATIA。日志不是防篡改签名，也不产生闭合、G2 或实际建模奖励。旧日志缺少指纹/尝试标记时不给减罚。

原生几何检测接口未在本版自动补全。纯模块的 `options.evidence.closure[target][type]` 仅为调用方证据契约：需要 updated、measurementId、closed、boundaryCount=0、manifold、oriented、connectedComponents=1；solid 还需有限正体积和 bodyCount=1。这些字段须来自实际检测，不能由面积/体积推断。注册离线工具不会自填它们。

## 惩罚公式

配置默认：已知开放处罚上限 6 分，闭合未知处罚 1 分，实际修复尝试最多减轻开放处罚的 25%。

`C_open = 6 × mean(1 - repairMitigation)`，均值只对 OPEN 目标取值；没有 OPEN 时为 0。

`C_unknown = 存在 UNKNOWN 或 CLOSED_INPUT 时取 1，否则取 0`。

`score100 = clamp(baseScore100 + habitBonusPoints - C_open - C_unknown, 0, 100)`。

仅写入计划的 Join 不减罚；日志中的相关修复调用最多将 6 减到 4.5。同一目标的重复尝试不累计减免。无关修复、错误类型、旧构建、被权限拒绝的调用不给减免。减罚后仍保留 OPEN 和 `readyForDelivery:false`，不能交付成已闭合模型。必要几何缺失、非法参数、已确认硬规则违规或不支持接口仍直接拒绝，不进入奖励或减罚。

`total` 保留原始权重贡献，闭合处罚作用于 `score100`，勿用 raw total 排序绕开闭合处罚。`readyForDelivery` 仅说明声明目标的闭合证据契约，不能代替赛事规则、全部用户需求或实机证据真实性审核。
