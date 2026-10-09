# 闭合实体路径与公开示例

`catia_closed_loft` 接受闭合平面多边形截面，侧壁与两个 Fill 封盖共用边界，通过 CloseSurface 建立独立 Body。`catia_capped_extrude` 从闭合线框生成侧壁与封盖。实际执行必须 Update 并读取有限正体积；离线检查只能检查构造合同。

`catia_gsd_split` / `AddNewHybridSplit` 支持曲线或曲面源和 ±1 保留方向，分割不自动封盖。多 Body 不等于一体端板，Join 面积不等于闭合。

## 公开例子

- `examples/r7-closed-endplate.plan.json`、左侧对应文件：任意尺寸矩形墙、R12/R9 圆弧足板开口和 R60/R57 尾部弧面材料体，三个独立能力试件。
- `examples/r7-endplate-parameters.json`：上述合成参数，毫米和默认轴系。
- `examples/r7-gsd-split.plan.json`：分割合同示例。
- `examples/r8-single-foot-rib-solid.plan.json`：单一圆弧足板截面；连接处为尖角，没有宣称圆角连接或 G2。

这些文件均 dryRun:true。文件名保留便于回归，但其参数已替换为独立数学几何，不能再与私有 CAD、旧截图、旧体积或旧实机结果一一对应。它们不构成整车布局或完整端板设计。

真实端板仍须明确材料厚度、保压条与足板圆角连接、条下开口、前缘封口及后缘外抛意图，再检查整体自由边、相交、正体积和规则包络。设计开口应保留，不能填孔换取闭合奖励。
