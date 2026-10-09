# v1.1.1 / r3 GSD 接口与使用边界

## r7 补充：闭合实体与分割

详见 [R7_CLOSED_ENDPLATE_GUIDE.md](R7_CLOSED_ENDPLATE_GUIDE.md)。新增catia_closed_loft（closed_loft）和catia_capped_extrude（capped_extrude），复用截面边界、Fill两端封盖、CloseSurface到独立Body，并检查有限正体积。多Body未布尔合并；r7仅离线验证。GSD分割使用catia_gsd_split或AddNewHybridSplit，方向±1，曲线/曲面源，保留侧基于支撑方向；分割不自动封盖。新例子examples/r7-*.plan.json均dryRun:true。planFile省略调用dryRun时继承文件值，显式调用参数优先。


r3 新增四个入口：`catia_gsd_catalog`（离线目录）、`catia_gsd_operation`（新建）、`catia_g2_solve`（离线曲线解）、`catia_model_review`（离线风险检查）。保留原有七种 GSD 简化操作和装配、位置读取工具。

目录收录 **139 个 Automation 构造接口**，包括 **16 个圆角构造接口**。这些是接口白名单覆盖数，不能视为 139 个经过 CATIA 实机验证的功能，也不能代表某一 CATIA 版本所有 GUI 按钮都已覆盖。

## 参数形式

先查询 `catia_gsd_catalog {factory:"AddNewBlend"}`。返回有序 slots、结果类的 calls / properties / valueParameters 和原文档链接。使用 JSON 数字、布尔值，不能用字符串代替。每个构造函数的 arguments 数量和顺序必须完全匹配文档。

`catia_gsd_operation` 参数包含 project、id、factory、arguments、configure；ShapeFactory 圆角还必须填写 bodySource（现有账本中的基体 ID）。完整计划使用 kind:`gsd_api`，同样的参数写在 params 中。

| 输入 | 含义 |
|---|---|
| `{"ref":"ID"}` | 引用已登记特征；依赖排序支持前向引用 |
| `{"ref":"ID","brep":"实际拓扑名称"}` | 引用该特征的边/面，不能把整个实体当作一条边 |
| `{"direction":[1,0,0]}` | 自动规范化的非零方向，用于 HybridShapeDirection 参数 |
| `{"empty":true}` | 显式空 Reference，仅适合文档允许的可选引用 |
| `null` | 显式 Nothing；是否允许取决于具体接口，非缺省万能值 |
| `{"ref":"ID","parameter":"Radius"}` | 已记录特征的长度/角度/实数参数对象，不等同于普通数字 |
| `{"method":"SetContinuity","arguments":[1,2]}` | 顺序调用白名单配置方法 |
| `{"property":"Continuity","value":2}` | 写入文档列出的可写属性 |
| `{"parameter":"Radius","value":5}` | 写参数对象的 Value，派生或受约束参数可能拒绝写入 |

单操作参数预算128 KiB，项目生成脚本预算8 MiB；长拓扑字符串与引用数组分段生成。

禁止任意代码、任意 COM 成员和外部宏。BRep 与字符串进行 VB 字符串引用；控制字符、超长输入、非有限数字、未知字段/接口被拒绝。构造、配置、更新均检查错误。对结果按类型检查实际几何；G0/G1/G2 参数不等同于连续性实测。

普通建模工具坐标为 mm，+X 向后、+Y 向上、+Z 向外。通用 Automation 适配器保留**每个接口文档自己的单位和枚举**，尤其角度/参数对象，不能把所有 double 都当成 mm。圆角传播、变化、边界修剪等枚举见目录。

## 曲面 / 操作 / 线框 / 圆角

四类目录涵盖 Fill、Loft、Blend、Extrude、Revol、Sphere、Cylinder、各类 Sweep、Offset、WrapSurface；Join、Split、Trim、Boundary、Extract、Healing、Extrapolate、Project、Intersect、Transform、Unfold、Develop 等；点、线、平面、圆/弧、Conic、Spline、Connect、Helix、Spiral、Spine 等；自动、恒半径、变半径、面间和三切圆角及曲面/实体变体。下表逐项列出实际收录接口。

多选数组结果（如 AddNewDatums）、没有对应 Automation 接口的 GUI 功能和图形界面选择/交互命令未包装。Direction 通过类型包装器提供。GSO/DL1 等相关许可、版本差异和几何有效性仍由目标 CATIA 决定；目录存在不意味着许可可用。bodySource 只表达基体依赖，真实边/面仍须提供正确 BRep。

## G2

- Connect：两个端点的 continuity=2；Blend：两边 SetCurve、SetSupport、SetContinuity(side,2)；Fill：边界加支撑，再设置整体或边界连续性。配置顺序由调用者显式指定。
- `catia_g2_solve` 计算五次 Bézier 曲线，输入位置、切向、曲率向量（1/mm）和参数速度，返回六控制点、采样点、端点残差。曲率必须垂直切向。
- **Bézier 解析端点 G2 不等于 CATIA 插值这些采样点后的 G2。** 采样速度检查也不证明全局无尖点/自交。r3 不含曲面 G2 数值求解器或完整连续性测量器；原生连续性由 CATIA 求解，工具只提交请求和报告更新结果。

## 前翼经验与新例子

公开端板例子现为独立合成能力试件，参考 [闭合路径](R7_CLOSED_ENDPLATE_GUIDE.md) 与 [前缘合并](R5_FRONT_CLOSURE_GUIDE.md)。私有 CAD 轮廓和实测数据未公开。

| 参数 | 数据（mm，默认建模轴） |
|---|---|
| 整车定位约定 | 前轴中心为 [0,0,0]，地面 Y=0；这是测试约定，不修改 CATIA 默认轴 |
| 右端板局部基准 | [-950,70,580]；局部+X向后、+Y向上、+Z向外 |
| 主板 | 局部 X=0..400；前低墙120，爬升 X=160..240 / Y=120..180；后高180 |
| 前部肩 / 上翻唇边 | 外向50；上缘局部Y=250；圆角目标半径5 |
| 足板 | 局部 X=0..452，Y=0，Z=0..55 |
| 圆弧保压条 | 半圆半径10；截面起于局部X=20，Y=0..10，Z=18..38，沿+X延伸400 |
| 后缘圆弧外抛 | 局部从[400,0,0]开始，半径90，转35°，沿+Y拉伸180 |
| 主翼定位 | [-930,145,-560]，跨Z=-560..560；根弦280、梢弦260、AoA=-3°，invertProfile=true |
| 一级襟翼 | 相对主翼弦比0.32，偏转-18°，gap=8，overlap=4，gapSide=positive |
| 二级襟翼 | 相对一级弦比0.72，偏转-12°，gap=6，overlap=3，gapSide=positive |

主翼/襟翼的角度按父部件逐级累加。翼型先倒置弯度再定位；不能仅凭下压力候选朝向宣称有实际下压力。模型与赛事规则无默认绑定，示例不证明合规。

示例输入：`r3-front-wing.plan.json`、`r3-g2-connect.plan.json`、`r3-arc-sweep.plan.json` 使用 catia_model_plan，先 dryRun:true；`r3-g2-solver.json` 用于 catia_g2_solve。`r3-fillet-templates.json` 是有占位拓扑引用的模板，不是能直接执行的完整计划。

## 完整接口目录

| 类别 | 构造接口 | 结果 / 配置文档 |
|---|---|---|
| wireframe | `AddNew3DCorner` | [HybridShapeCorner](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCorner_25773.htm) |
| wireframe | `AddNew3DCurveOffset` | [HybridShape3DCurveOffset](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShape3DCurveOffset_39249.htm) |
| operation | `AddNewAffinity` | [HybridShapeAffinity](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeAffinity_29558.htm) |
| wireframe | `AddNewAxisLine` | [HybridShapeAxisLine](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeAxisLine_28981.htm) |
| operation | `AddNewAxisToAxis` | [HybridShapeAxisToAxis](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeAxisToAxis_33069.htm) |
| surface | `AddNewBlend` | [HybridShapeBlend](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeBlend_23718.htm) |
| operation | `AddNewBoundaryOfSurface` | [HybridShapeBoundary](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeBoundary_29630.htm) |
| operation | `AddNewBoundary` | [HybridShapeBoundary](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeBoundary_29630.htm) |
| surface | `AddNewBump` | [HybridShapeBump](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeBump_22458.htm) |
| wireframe | `AddNewCircle2PointsRad` | [HybridShapeCircle2PointsRad](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircle2PointsRad_46443.htm) |
| wireframe | `AddNewCircle3Points` | [HybridShapeCircle3Points](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircle3Points_39467.htm) |
| wireframe | `AddNewCircleBitangentPoint` | [HybridShapeCircleBitangentPoint](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleBitangentPoint_59726.htm) |
| wireframe | `AddNewCircleBitangentRadius` | [HybridShapeCircleBitangentRadius](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleBitangentRadius_62710.htm) |
| wireframe | `AddNewCircleCenterAxisWithAngles` | [HybridShapeCircleCenterAxis](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleCenterAxis_47430.htm) |
| wireframe | `AddNewCircleCenterAxis` | [HybridShapeCircleCenterAxis](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleCenterAxis_47430.htm) |
| wireframe | `AddNewCircleCenterTangent` | [HybridShapeCircleCenterTangent](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleCenterTangent_56299.htm) |
| wireframe | `AddNewCircleCtrPtWithAngles` | [HybridShapeCircleCtrPt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleCtrPt_34873.htm) |
| wireframe | `AddNewCircleCtrPt` | [HybridShapeCircleCtrPt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleCtrPt_34873.htm) |
| wireframe | `AddNewCircleCtrRadWithAngles` | [HybridShapeCircleCtrRad](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleCtrRad_36714.htm) |
| wireframe | `AddNewCircleCtrRad` | [HybridShapeCircleCtrRad](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleCtrRad_36714.htm) |
| wireframe | `AddNewCircleDatum` | [HybridShapeCircleExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleExplicit_42647.htm) |
| wireframe | `AddNewCircleTritangent` | [HybridShapeCircleTritangent](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCircleTritangent_48255.htm) |
| operation | `AddNewCombine` | [HybridShapeCombine](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCombine_27253.htm) |
| wireframe | `AddNewConic` | [HybridShapeConic](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeConic_23797.htm) |
| wireframe | `AddNewConicalReflectLineWithType` | [HybridShapeReflectLine](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeReflectLine_35050.htm) |
| wireframe | `AddNewConnect` | [HybridShapeConnect](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeConnect_27453.htm) |
| wireframe | `AddNewCorner` | [HybridShapeCorner](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCorner_25773.htm) |
| wireframe | `AddNewCurveDatum` | [HybridShapeCurveExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCurveExplicit_40502.htm) |
| wireframe | `AddNewCurvePar` | [HybridShapeCurvePar](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCurvePar_29114.htm) |
| wireframe | `AddNewCurveSmooth` | [HybridShapeCurveSmooth](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCurveSmooth_35925.htm) |
| surface | `AddNewCylinder` | [HybridShapeCylinder](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeCylinder_29425.htm) |
| operation | `AddNewDevelop` | [HybridShapeDevelop](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeDevelop_27551.htm) |
| operation | `AddNewEmptyRotate` | [HybridShapeRotate](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeRotate_25799.htm) |
| operation | `AddNewEmptyTranslate` | [HybridShapeTranslate](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeTranslate_31545.htm) |
| operation | `AddNewExtractMulti` | [HybridShapeExtractMulti](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeExtractMulti_38172.htm) |
| operation | `AddNewExtract` | [HybridShapeExtract](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeExtract_27657.htm) |
| operation | `AddNewExtrapolLength` | [HybridShapeExtrapol](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeExtrapol_29724.htm) |
| operation | `AddNewExtrapolUntil` | [HybridShapeExtrapol](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeExtrapol_29724.htm) |
| operation | `AddNewExtremumPolar` | [HybridShapeExtremumPolar](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeExtremumPolar_40620.htm) |
| operation | `AddNewExtremum` | [HybridShapeExtremum](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeExtremum_29856.htm) |
| surface | `AddNewExtrude` | [HybridShapeExtrude](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeExtrude_27718.htm) |
| surface | `AddNewFill` | [HybridShapeFill](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeFill_22289.htm) |
| fillet | `AddNewFilletBiTangent` | [HybridShapeFilletBiTangent](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeFilletBiTangent_44647.htm) |
| fillet | `AddNewFilletTriTangent` | [HybridShapeFilletTriTangent](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeFilletTriTangent_47831.htm) |
| operation | `AddNewHealing` | [HybridShapeHealing](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeHealing_27206.htm) |
| wireframe | `AddNewHelix` | [HybridShapeHelix](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeHelix_24021.htm) |
| operation | `AddNewHybridScaling` | [HybridShapeScaling](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeScaling_27303.htm) |
| operation | `AddNewHybridSplit` | [HybridShapeSplit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSplit_24214.htm) |
| operation | `AddNewHybridTrim` | [HybridShapeTrim](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeTrim_22526.htm) |
| operation | `AddNewIntegratedLaw` | [HybridShapeIntegratedLaw](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeIntegratedLaw_39880.htm) |
| operation | `AddNewIntersection` | [HybridShapeIntersection](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeIntersection_38492.htm) |
| operation | `AddNewInverse` | [HybridShapeInverse](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeInverse_27681.htm) |
| operation | `AddNewJoin` | [HybridShapeAssemble](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeAssemble_29204.htm) |
| operation | `AddNewLawDistProj` | [HybridShapeLawDistProj](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLawDistProj_35281.htm) |
| wireframe | `AddNewLineAngle` | [HybridShapeLineAngle](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineAngle_30632.htm) |
| wireframe | `AddNewLineBiTangent` | [HybridShapeLineBiTangent](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineBiTangent_39486.htm) |
| wireframe | `AddNewLineBisectingOnSupportWithPoint` | [HybridShapeLineBisecting](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineBisecting_39921.htm) |
| wireframe | `AddNewLineBisectingOnSupport` | [HybridShapeLineBisecting](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineBisecting_39921.htm) |
| wireframe | `AddNewLineBisectingWithPoint` | [HybridShapeLineBisecting](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineBisecting_39921.htm) |
| wireframe | `AddNewLineBisecting` | [HybridShapeLineBisecting](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineBisecting_39921.htm) |
| wireframe | `AddNewLineDatum` | [HybridShapeLineExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineExplicit_37818.htm) |
| wireframe | `AddNewLineNormal` | [HybridShapeLineNormal](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineNormal_33132.htm) |
| wireframe | `AddNewLinePtDirOnSupport` | [HybridShapeLinePtDir](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLinePtDir_30551.htm) |
| wireframe | `AddNewLinePtDir` | [HybridShapeLinePtDir](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLinePtDir_30551.htm) |
| wireframe | `AddNewLinePtPtExtended` | [HybridShapeLinePtPt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLinePtPt_28787.htm) |
| wireframe | `AddNewLinePtPtOnSupportExtended` | [HybridShapeLinePtPt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLinePtPt_28787.htm) |
| wireframe | `AddNewLinePtPtOnSupport` | [HybridShapeLinePtPt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLinePtPt_28787.htm) |
| wireframe | `AddNewLinePtPt` | [HybridShapeLinePtPt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLinePtPt_28787.htm) |
| wireframe | `AddNewLineTangencyOnSupport` | [HybridShapeLineTangency](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineTangency_37679.htm) |
| wireframe | `AddNewLineTangency` | [HybridShapeLineTangency](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLineTangency_37679.htm) |
| surface | `AddNewLoft` | [HybridShapeLoft](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeLoft_22461.htm) |
| operation | `AddNewNear` | [HybridShapeNear](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeNear_22270.htm) |
| surface | `AddNewOffset` | [HybridShapeOffset](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeOffset_25743.htm) |
| wireframe | `AddNewPlane1Curve` | [HybridShapePlane1Curve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlane1Curve_34511.htm) |
| wireframe | `AddNewPlane1Line1Pt` | [HybridShapePlane1Line1Pt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlane1Line1Pt_37368.htm) |
| wireframe | `AddNewPlane2Lines` | [HybridShapePlane2Lines](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlane2Lines_34342.htm) |
| wireframe | `AddNewPlane3Points` | [HybridShapePlane3Points](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlane3Points_37170.htm) |
| wireframe | `AddNewPlaneAngle` | [HybridShapePlaneAngle](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneAngle_32671.htm) |
| wireframe | `AddNewPlaneDatum` | [HybridShapePlaneExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneExplicit_40204.htm) |
| wireframe | `AddNewPlaneEquation` | [HybridShapePlaneEquation](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneEquation_40306.htm) |
| wireframe | `AddNewPlaneMean` | [HybridShapePlaneMean](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneMean_30620.htm) |
| wireframe | `AddNewPlaneNormal` | [HybridShapePlaneNormal](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneNormal_35301.htm) |
| wireframe | `AddNewPlaneOffsetPt` | [HybridShapePlaneOffsetPt](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneOffsetPt_39738.htm) |
| wireframe | `AddNewPlaneOffset` | [HybridShapePlaneOffset](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneOffset_35310.htm) |
| wireframe | `AddNewPlaneTangent` | [HybridShapePlaneTangent](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePlaneTangent_37647.htm) |
| wireframe | `AddNewPointBetween` | [HybridShapePointBetween](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointBetween_37883.htm) |
| wireframe | `AddNewPointCenter` | [HybridShapePointCenter](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointCenter_35587.htm) |
| wireframe | `AddNewPointCoordWithReference` | [HybridShapePointCoord](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointCoord_33323.htm) |
| wireframe | `AddNewPointCoord` | [HybridShapePointCoord](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointCoord_33323.htm) |
| wireframe | `AddNewPointDatum` | [HybridShapePointExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointExplicit_40569.htm) |
| wireframe | `AddNewPointOnCurveAlongDirection` | [HybridShapePointOnCurve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnCurve_37743.htm) |
| wireframe | `AddNewPointOnCurveFromDistance` | [HybridShapePointOnCurve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnCurve_37743.htm) |
| wireframe | `AddNewPointOnCurveFromPercent` | [HybridShapePointOnCurve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnCurve_37743.htm) |
| wireframe | `AddNewPointOnCurveWithReferenceAlongDirection` | [HybridShapePointOnCurve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnCurve_37743.htm) |
| wireframe | `AddNewPointOnCurveWithReferenceFromDistance` | [HybridShapePointOnCurve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnCurve_37743.htm) |
| wireframe | `AddNewPointOnCurveWithReferenceFromPercent` | [HybridShapePointOnCurve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnCurve_37743.htm) |
| wireframe | `AddNewPointOnPlaneWithReference` | [HybridShapePointOnPlane](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnPlane_37298.htm) |
| wireframe | `AddNewPointOnPlane` | [HybridShapePointOnPlane](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnPlane_37298.htm) |
| wireframe | `AddNewPointOnSurfaceWithReference` | [HybridShapePointOnSurface](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnSurface_42308.htm) |
| wireframe | `AddNewPointOnSurface` | [HybridShapePointOnSurface](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointOnSurface_42308.htm) |
| wireframe | `AddNewPointTangent` | [HybridShapePointTangent](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePointTangent_38012.htm) |
| wireframe | `AddNewPolyline` | [HybridShapePolyline](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePolyline_29641.htm) |
| operation | `AddNewPositionTransfo` | [HybridShapePositionTransfo](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapePositionTransfo_46008.htm) |
| operation | `AddNewProject` | [HybridShapeProject](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeProject_27589.htm) |
| wireframe | `AddNewReflectLineWithType` | [HybridShapeReflectLine](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeReflectLine_35050.htm) |
| wireframe | `AddNewReflectLine` | [HybridShapeReflectLine](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeReflectLine_35050.htm) |
| surface | `AddNewRevol` | [HybridShapeRevol](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeRevol_24165.htm) |
| operation | `AddNewRotate` | [HybridShapeRotate](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeRotate_25799.htm) |
| operation | `AddNewSection` | [HybridShapeSection](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSection_27600.htm) |
| surface | `AddNewSphere` | [HybridShapeSphere](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSphere_25692.htm) |
| wireframe | `AddNewSpine` | [HybridShapeSpine](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSpine_24020.htm) |
| wireframe | `AddNewSpiral` | [HybridShapeSpiral](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSpiral_25744.htm) |
| wireframe | `AddNewSpline` | [HybridShapeSpline](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSpline_25740.htm) |
| surface | `AddNewSurfaceDatum` | [HybridShapeSurfaceExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSurfaceExplicit_45363.htm) |
| surface | `AddNewSweepCircle` | [HybridShapeSweepCircle](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSweepCircle_35162.htm) |
| surface | `AddNewSweepConic` | [HybridShapeSweepConic](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSweepConic_33005.htm) |
| surface | `AddNewSweepExplicit` | [HybridShapeSweepExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSweepExplicit_40460.htm) |
| surface | `AddNewSweepLine` | [HybridShapeSweepLine](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSweepLine_30991.htm) |
| operation | `AddNewSymmetry` | [HybridShapeSymmetry](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeSymmetry_30138.htm) |
| operation | `AddNewTransfer` | [HybridShapeTransfer](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeTransfer_29562.htm) |
| operation | `AddNewTranslate` | [HybridShapeTranslate](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeTranslate_31545.htm) |
| operation | `AddNewUnfold` | [HybridShapeUnfold](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeUnfold_25698.htm) |
| surface | `AddNewVolumeDatum` | [HybridShapeVolumeExplicit](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeVolumeExplicit_43117.htm) |
| wireframe | `AddNewWrapCurve` | [HybridShapeWrapCurve](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeWrapCurve_31355.htm) |
| surface | `AddNewWrapSurface` | [HybridShapeWrapSurface](https://catiadesign.org/_doc/V5Automation/generated/interfaces/GSMInterfaces/interface_HybridShapeWrapSurface_35332.htm) |
| fillet | `AddNewAutoFillet` | [AutoFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_AutoFillet_17951.htm) |
| fillet | `AddNewEdgeFilletWithConstantRadius` | [ConstRadEdgeFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_ConstRadEdgeFillet_28558.htm) |
| fillet | `AddNewEdgeFilletWithVaryingRadius` | [VarRadEdgeFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_VarRadEdgeFillet_25223.htm) |
| fillet | `AddNewFaceFillet` | [FaceFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_FaceFillet_17867.htm) |
| fillet | `AddNewSolidEdgeFilletWithConstantRadius` | [ConstRadEdgeFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_ConstRadEdgeFillet_28558.htm) |
| fillet | `AddNewSolidEdgeFilletWithVaryingRadius` | [VarRadEdgeFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_VarRadEdgeFillet_25223.htm) |
| fillet | `AddNewSolidFaceFillet` | [FaceFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_FaceFillet_17867.htm) |
| fillet | `AddNewSolidTritangentFillet` | [TritangentFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_TritangentFillet_25776.htm) |
| fillet | `AddNewSurfaceEdgeFilletWithConstantRadius` | [ConstRadEdgeFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_ConstRadEdgeFillet_28558.htm) |
| fillet | `AddNewSurfaceEdgeFilletWithVaryingRadius` | [VarRadEdgeFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_VarRadEdgeFillet_25223.htm) |
| fillet | `AddNewSurfaceFaceFillet` | [FaceFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_FaceFillet_17867.htm) |
| fillet | `AddNewSurfaceTritangentFillet` | [TritangentFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_TritangentFillet_25776.htm) |
| fillet | `AddNewSurfacicAutoFillet` | [AutoFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_AutoFillet_17951.htm) |
| fillet | `AddNewTritangentFillet` | [TritangentFillet](https://catiadesign.org/_doc/V5Automation/generated/interfaces/PartInterfaces/interface_TritangentFillet_25776.htm) |
