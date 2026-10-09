# v1.2.0 / r11：草图进入真实生成链

## 这次记录为什么没出现草图

用户提供的 r10 实机记录明确说：重放旧 v1.1.1r3 / private legacy front-wing fixture 的六份计划，仅替换 project。六份 JSON 均为 0 个 sketch、0 项草图约束、0 项 task、0 项 geometryRequirements。奖励是计划评价，不会自动重写已经固定的 kind/params。该记录证明旧曲面试件的构建结果，未证明 Agent 根据 r10 Skill 重新选择工具。

旧代码还把两端点直线截面交给 MakeSpline。r11 用 MakeLine 直接建立直线；默认准备路径进一步把可严格表达的平面直线截面变为真实 Sketcher 线段，再由 GSD Loft 引用。自由曲线和翼型不自动改形。

## 使用顺序

1. 整包替换后重载宿主，调用 catia_policy_status，确认 revision=r11、26 项资源指纹和 44 个已注册工具。宿主安装方式见 REINSTALL_r11.md。当前交付未执行安装。
2. 新设计先给出部件任务和需要闭合的材料边界。调用 catia_prepare_plan 得到完整候选 steps、changes、routeAudit；再 review/evaluate。只增加无下游引用的草图不代表使用了草图建模。
3. catia_model_plan 默认 routeMode=sketch_first，对直线平面截面采用上述准备路径。dryRun 返回 preparedSteps，供检查、评分和再次调用。批量生成的草图计入 2048 元素限额，名称碰撞、预算超限会拒绝。
4. 需要原样比较旧路线时显式 routeMode=literal 和 routeReason。理由会作为结构化 routing 写入执行审计，即使关闭 verboseAudit 仍保留；不能用于宣称旧计划已重新规划。
5. 离线请求到 dryRun 为止。真实运行需用户另行要求。核对 nativeSketches 中 attempted、constraints、constraintStatuses、endpointsVerified、constraintsSatisfiedVerified、plannedConsumers 和 updatedConsumers；最后一项要求对应下游特征返回更新/测量成功。

离线命令示例（在解压目录执行；输出文件必须不存在）：

```sh
node scripts/prepare-plan.mjs examples/r11-sketch-foot-input.plan.json prepared.plan.json
node scripts/evaluate-plan.mjs prepared.plan.json
node scripts/verify.mjs
node scripts/checksums.mjs
```

## 草图参数

catia_sketch 或 plan 中 kind=sketch：plane=XY/YZ/ZX，origin 为世界坐标毫米，points 是局部 [u,v]。XY=(X,Y)、YZ=(Y,Z)、ZX=(Z,X)。closed 默认 true；closed=false 支持开放直线折线，最少两个点。

| type | 参数 | 原生约束 |
| --- | --- | --- |
| length | edge, value | AddMonoEltCst(5) |
| horizontal | edge | AddMonoEltCst(10) |
| vertical | edge | AddMonoEltCst(13) |
| parallel | edge, otherEdge | AddBiEltCst(8) |
| perpendicular | edge, otherEdge | AddBiEltCst(11) |

edge 是从 0 起的边索引。尺寸必须与输入端点长度一致；方向/关系也必须满足输入几何。相邻线段端点自动建立重合约束 AddBiEltCst(2)，不再创建未被线段引用的独立点。r5 曾失败的端点 setter 没有重新启用；当前通过 getter 得到真实端点。

原生 Update 后读取轴系、约束数量/状态和端点；不满足（Status 非 0）或被停用的约束会中止，不能只凭创建数量判成功。GetEndPoints 失败时尝试 StartPoint/EndPoint.GetCoordinates。两种读取都失败则中止，不能把输入坐标当成求解后的测量。仍允许欠约束，没有完整自由度认证。新增读取、重合约束和放样引用需在目标 CATIA 版本另行实测。

## 输入 r11 的私有测试候选历史（本公开包未包含）

输入版本曾单独交付的私有前翼测试计划保留旧尺寸、默认坐标系、翼元相对位置、圆弧保压条、连接圆角、条下足板开口及尾部外抛；只改变平面直线截面的建模路径。

| 计划 | 原草图数 | 新草图数 | 被下游引用 | 请求尺寸/方向约束 |
| --- | ---: | ---: | ---: | ---: |
| 01a 基础前翼 | 0 | 0 | 0 | 0 |
| 01b 双侧足板与保压条 | 0 | 16 | 16 | 32 |
| 02 右端板 | 0 | 8 | 8 | 16 |
| 03 翼元 | 0 | 0 | 0 | 0 |
| 04 圆角 | 0 | 0 | 0 | 0 |
| 05 单侧足板与保压条 | 0 | 8 | 8 | 16 |

这些数量是代码合同结果，尚未生成 CATIA 模型。开放截面是构造曲面所需的中间元素，不应强行闭合换奖励。圆弧、肩部曲线和前部密集采样没有被任意替换，因此这一测试候选不是端板缺口闭合修复集。旧报告确认这些为零厚度曲面试件；不能称为封闭端板或完整赛事合规模型。

## 评分、规则和剩余限制

奖惩权重保持 r10：有下游引用的合理约束获得小奖励，开放/未知闭合分别处罚，有限原生修复尝试减罚不等于通过。开放 sketch 不能满足 closed_wire，不能作为单边界 Fill 或 capped_extrude 的闭合源。保留设计足板开口，不用虚构封盖填孔。

本版未新增官方规则，也未把未核验规则改成硬规则。曲线草图、相切/半径草图约束、Pad/Pocket、全约束证明、原生 G2/整体闭合认证仍未实现。D3 距离类型不匹配和 D4 截面 Update 根因仍未确认，本版不声明修复。图片不能单独证明特征树和拓扑状态。

## 查阅的原生文档

接口依据为 Dassault Systèmes V5 Automation 参考文档的镜像；文档不是当前 CATIA 的运行结果：

- [Curve2D 端点读取](https://catiadesign.org/_doc/V5Automation/generated/interfaces/SketcherInterfaces/interface_Curve2D_21385.htm)
- [Point2D 坐标读取](https://catiadesign.org/_doc/V5Automation/generated/interfaces/SketcherInterfaces/interface_Point2D_21397.htm)
- [Factory2D](https://catiadesign.org/_doc/V5Automation/generated/interfaces/SketcherInterfaces/interface_Factory2D_22901.htm)
- [约束枚举与引用类型](https://catiadesign.org/_doc/V5Automation/generated/interfaces/MecModInterfaces/enum_CatConstraintType_27587.htm)
- [约束状态枚举](https://catiadesign.org/_doc/V5Automation/generated/interfaces/MecModInterfaces/enum_CatConstraintStatus_31578.htm)
- [Constraint 状态](https://catiadesign.org/_doc/V5Automation/generated/interfaces/MecModInterfaces/interface_Constraint_21016.htm)
