## r11 执行路径更新

先检查 catia_policy_status 的 revision=r11。catia_prepare_plan 是只读候选准备，catia_model_plan 默认采用 sketch_first，精确将平面直线放样截面变为带尺寸/方向约束的 sketch，保持输出 ID、端点和截面顺序。需要逐字执行已有计划时，显式 routeMode:literal 并给出 routeReason；结果和审计保留该理由。
可直接调用 catia_sketch。草图支持闭合直线多边形和开放折线，length/horizontal/vertical/parallel/perpendicular；原生重合约束连接相邻线端点。只增加没有下游引用的装饰草图不能获得“已参与建模”的结论。圆弧、翼型、真实自由曲线仍用合适 GSD；不折线化曲线换奖励。
核对 routeAudit 中 consumedBy、请求约束及采样曲线清单。实机时再核对 nativeSketches 的约束数、状态和端点读取，截图中没看到尺寸标注不证明没创建草图。代码不保证显示所有草图，也不认证完全约束。若读取接口失败，应报告失败，不能用输入坐标冒充求解后的测量。
曲面试件允许开放截面；材料应闭合的轮廓需 geometryRequirements。开放曲面、Join 面积和低惩罚均不能证明闭壳。端板前部的自由曲线/圆角仍须独立重新规划与检查。

# Front Wing Component Skill (v1.2.0 r11)

只包含最基础、成熟、可靠的知识。权重一律来自 `scoring/front_wing_weights.json`。

## 1. 作用
前翼可能负责：前轴下压力、整车气动平衡、前轮附近流动管理、下游来流管理。
**不得只优化"最大下压力"**；同时考虑 drag、aero balance、robustness、downstream flow、manufacturability。

## 2. Mainplane
关注 profile、chord、AoA、span、twist、taper、surface quality。
跨展向连续的主翼优先：`Plane -> Section -> Guide -> MultiSectionSurface`（方法先验，必须通过真实更新和扰动测试确认稳定性）。

## 3. Flap
关注 chord、AoA、span、gap、overlap、relative position。**禁止"襟翼越多越好"**；元素数量必须能说明收益。

## 4. Gap
必须保持有效间隙、避免几何穿插、避免极端值；**最佳值需 CFD/实验之后再判断**。

## 5. Overlap
维护正常翼元流向关系：`Mainplane -> Flap1 -> Flap2`（逐级相对父级定位，不得两级都挂主翼）。

## 6. 多段翼
常用 Single / Two Element / Three Element。为兼容 r1，API 至多支持 3 级串联襟翼，即主翼加襟翼最多 4 个翼元；第四翼元必须说明用途和复杂度，容量上限不是设计推荐。

## 7. 跨展向变化
允许 chord/AoA/twist/taper 变化，但要求平滑、参数化、可解释、可制造。

## 8. Endplate
基础作用：翼端流动管理、压差流控制、局部涡结构管理、轮胎附近流场管理。
**禁止"端板越大越好""涡越强越好"。** 端板与翼面之间允许 G0。

## 9. Front Wheel Interaction
认识 wheel blockage、tire wake、wheel-induced flow；**当前版本不要求自主发明复杂外洗结构**。

## 10. 默认优先级（绝对顺序）
```
规则合法 > 几何正确 > 模型稳定 > 参数化 > 气动逻辑合理 > 制造可行 > 性能优化 > 复杂创新
```

## 11. 固定拓扑 vs 自由拓扑
Agent **可以**自由改：chord、AoA、span、twist、gap、overlap、section 位置。
Agent **不得**默认自由决定：全新翼元拓扑、随机增加翼片、把襟翼放到异常位置、反转翼元关系、创造无法解释用途的部件。
默认策略：`Known Topology + Parameter Exploration`，而非 `Free Topology Generation`。

## 12. 工具-任务匹配（评分依据）
- 平面二维约束轮廓 / 封闭轮廓 / 简单端板轮廓 / 参数化二维截面 → **优先 Sketcher**（已实现封闭多边形、共享端点和 length 约束；曲线草图未实现，曲线翼型不能改折线骗取奖励）
- 空间曲线、导向线、投影线、曲面交线、多截面翼面、自由曲面、Trim/Split/Join/Extrapolate → **优先 GSD**
- 复杂翼面标准路径：`Parameters -> Reference Planes -> Sketch/Airfoil Sections -> Named Guide Curves -> Multi-Section Surface -> Trim/Split -> Join -> Validation`
- 单个截面统一表达为：`{profile, chord, aoa, twist, position, thickness_scale}`

## 13. 硬拒绝（不进入奖惩）
H01 官方规则违规、H02 禁止区域侵入、H03 非法几何穿插（如 flap 与 mainplane 实体穿透）、H04 必要几何缺失、H05 参数非法（chord<=0、NaN、Infinity）、H06 无法修复的 Update 失败、H07 非法文件写入、H08 默认覆盖唯一源文件、H09 高风险未知脚本执行、**H10 调用不存在或未实现的工具/能力（必须 BLOCKED / NOT_IMPLEMENTED，不得模拟执行）**。
## r2 执行与证据边界
- 已注册 `catia_evaluate_plan`：按实际 builder 校验计划，再读取权重和规则库，返回分项评分、证据缺失与人工审核提示；离线工具不调用 CATIA。
- `multiSectionWing` 使用现有 wing builder 的内部截面放样；不产生未被主翼消费的平面/导向线。不把高层返回的内部截面 ID 当作可绑定账本引用。需要独立截面和导向线时，显式使用 section/guide_curve 与 AddNewLoft 的配置。
- 默认主翼和襟翼均传入 invertProfile:true；负攻角只是几何候选，不证明下压力。用户可明确选择其他朝向。
- 参数化评分只表示可编辑账本变量覆盖，不代表 CATIA 已有原生公式和二维约束。
- 未确认条款保持 UNVERIFIED；250/50 等历史项目数值不是普遍赛事硬规则。规则缺失、缺车轴/轮胎基准、几何未测量，均不得宣布完整赛事合规。
- D3 距离类型不匹配、D4 截面 Update 失败仍需实机定位；r2 只有诊断改进，不能声称已修复或复测通过。
- **成熟习惯小奖励（r5）**：平行于默认轴系面的二维绘图优先 **Sketcher**（当前仅封闭多边形；曲线翼型保留其原生曲线，不为奖励折线化）；能用命名默认基准面就不用临时偏移面；左右对称建模；先基准后曲面；一个零件一个闭合体。详见 Global Skill Part D。


### r5 草图与端板前缘

先读取 R5_FRONT_CLOSURE_GUIDE.md。前缘 wall/shoulder/round/lip 单独成体后，需要按连接顺序 AddNewAdd 合并；新增候选计划必须 dryRun。原生 Boolean 失败时记录具体步骤，不自动扩大 Join 容差、不挪动母版、不填掉足板开口。当前离线测试不证明 外部参考工程的原生 NURBS 精确重建、G2、端板闭合或规则实测合规。


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
