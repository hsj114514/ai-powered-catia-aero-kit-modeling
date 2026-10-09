# GSD 命令能力表 — v1.2.0 / r5

范围：29 个中英文命令。IMPLEMENTED 只表示代码适配已接入，不代表原生 CATIA 运行、许可证、几何或连续性已经验证。

| English | 中文 | 功能 | 实际调用 | 状态 |
|---|---|---|---|---|
| Extrude | 拉伸曲面 | 沿方向拉伸曲线 | AddNewExtrude | 已适配，未实机验证 |
| Revolve | 旋转曲面 | 绕轴旋转截面 | AddNewRevol | 已适配，未实机验证 |
| Sphere | 球面 | 完整或部分球面 | AddNewSphere | 已适配，未实机验证 |
| Cylinder | 圆柱面 | 创建圆柱曲面 | AddNewCylinder | 已适配，未实机验证 |
| Offset | 偏移曲面 | 沿法向偏移曲面 | AddNewOffset | 已适配，未实机验证 |
| Variable Offset | 可变偏移曲面 | 按位置改变偏移量 | — | 未实现 |
| Rough Offset | 粗略偏移 | 近似偏移曲面 | — | 未实现 |
| Mid Surface | 中间曲面 | 从适用实体提取中间面 | AddNewMidSurface / AddNewMidSurfaceWithAutoThreshold | 已适配，未实机验证 |
| Sweep | 扫掠曲面 | 沿引导线生成曲面 | AddNewSweepExplicit / AddNewSweepCircle / AddNewSweepConic / AddNewSweepLine | 已适配，未实机验证 |
| Adaptive Sweep | 自适应扫掠 | 沿路径改变截面参数 | — | 未实现 |
| Fill | 填充曲面 | 根据封闭边界填充曲面 | AddNewFill | 已适配，未实机验证 |
| Multi-Sections Surface | 多截面曲面 | 多个截面生成曲面 | AddNewLoft | 已适配，未实机验证 |
| Blend | 混合曲面 | 在边界间生成过渡曲面 | AddNewBlend | 已适配，未实机验证 |
| Join | 接合 | 连接曲面或曲线 | AddNewJoin | 已适配，未实机验证 |
| Healing | 修复 | 修复间隙或连续性 | AddNewHealing | 已适配，未实机验证 |
| Curve Smooth | 曲线平滑 | 平滑曲线连接 | AddNewCurveSmooth | 已适配，未实机验证 |
| Surface Simplification | 曲面简化 | 简化复杂曲面表示 | — | 未实现 |
| Untrim | 取消修剪 | 恢复未裁剪的支持几何 | — | 未实现 |
| Disassemble | 分解 | 分离多域几何的指定域 | AddNewDatums | 已适配，未实机验证 |
| Split | 分割 | 切割目标并保留指定侧 | AddNewHybridSplit | 已适配，未实机验证 |
| Trim | 修剪 | 相互修剪并保留区域 | AddNewHybridTrim | 已适配，未实机验证 |
| Sew Surface | 缝合曲面 | 将曲面缝合到当前实体 Body | AddNewSewSurface | 已适配，未实机验证 |
| Remove Face | 移除面 | 移除指定面并重构实体 | AddNewRemoveFace | 已适配，未实机验证 |
| Translate | 平移 | 沿方向移动或复制几何 | AddNewTranslate | 已适配，未实机验证 |
| Rotate | 旋转 | 绕轴旋转几何 | AddNewRotate | 已适配，未实机验证 |
| Symmetry | 对称 | 关于支持元素对称 | AddNewSymmetry | 已适配，未实机验证 |
| Scaling | 缩放 | 等比例缩放几何 | AddNewHybridScaling | 已适配，未实机验证 |
| Affinity | 仿射变换 | 非均匀比例变换 | AddNewAffinity | 已适配，未实机验证 |
| Axis to Axis | 轴系到轴系 | 在两个轴系间变换 | AddNewAxisToAxis | 已适配，未实机验证 |

## 使用方式

1. `catia_gsd_catalog({command:"分割"})` 或英文 `Split` 查询签名和限制。
2. `catia_gsd_command` 用英文或中文 command，其他参数 arguments / configure / bodySource 与白名单一致。
3. Sweep 和 Mid Surface 有多个构造入口，必须显式选择 factory；不能猜测缺省模式。
4. 使用 `catia_model_plan`、`dryRun:true` 检查整个引用链。这个检查不会建立 CATIA 几何。

例如偏移曲面的参数：

```json
{"project":"DEMO","id":"SurfaceOffset","command":"Offset","arguments":[{"ref":"ExistingSurface"},2,false,0.001]}
```

ExistingSurface 必须先存在于该项目账本；上面的 JSON 是调用示例，不会自动运行。Offset 的精度参数在参考文档中已不再用于改变输出，不能用它保证几何精度。

## 新增入口限制

- Mid Surface：只支持自动创建模式和适合的实体；从源实体特征取得所属 Body 后创建 Reference，不接受任意曲面冒充实体。当前未对创建模式做枚举猜测，调用方应依据主机版本文档明确填写。
- Disassemble：原生 AddNewDatums 返回数组。适配器按 domainIndex 选出一个域，expectedDomains 限定域数量，其他域使用不同 ID 分别建账。原源特征保留。只支持 HybridBody 内的 shape design 源，不接受 datum 源保证；原生不支持会报错。域数量一致仍不能证明域顺序/身份一致，修改源拓扑后必须复查身份。
- Sew Surface / Remove Face：ShapeFactory 入口，必须给 bodySource 以指定当前实体；面引用使用已有特征及真实 BRep，不能伪造 Face 索引。不是任意 GSD 面的万能修复。
- Axis to Axis：先创建两项 axis_system，明确 origin、xDirection、yDirection。默认正交右手轴，拒绝零向量和非正交方向。不会偷偷转换用户来源坐标。
- 前缘 Body 合并：新增 AddNewAdd，源仅允许插件生成的独立 closed_loft/capped_extrude Body，目标必须实体；同 Body 合并拒绝，原生更新失败即保留错误，不自动改形。

## 五项缺口

Variable Offset、Rough Offset、Adaptive Sweep、Surface Simplification、Untrim 没有本包已核实的公开 Automation 适配。命令目录会显示 NOT_IMPLEMENTED，调用不运行 CATIA。查阅的文档未找到可直接实现的完整入口，不能据此断言所有 CATIA 版本都不支持，也不能把普通 Offset/Loft/Join 改名充数。后续需要匹配主机版本的接口文档或另行设计并验证专用模板。

## 文档来源

以下为 Dassault Systèmes 的 CAA 文档镜像；文档不是主机实测证据。

- [HybridShapeFactory](https://catia-v5-help.anarkia333data.center/online/interfaces/CATGSMIDLItf/interface_HybridShapeFactory_25308.htm)
- [ShapeFactory](https://catia-v5-help.anarkia333data.center/online/interfaces/PartInterfaces/interface_ShapeFactory_20269.htm)
- [AxisSystem](https://catiadesign.org/_doc/V5Automation/generated/interfaces/MecModInterfaces/interface_AxisSystem_20968.htm)
- [Sketch](https://catiadesign.org/_doc/V5Automation/generated/interfaces/SketcherInterfaces/interface_Sketch_21197.htm)
- [CatConstraintType](https://catiadesign.org/_doc/V5Automation/generated/interfaces/MecModInterfaces/enum_CatConstraintType_27587.htm)
