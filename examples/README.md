# 公开能力示例

所有 `.plan.json` 是候选或 dryRun 试件；没有附带 CATIA 实测结果。默认毫米、+X 向后、+Y 向上、+Z 右侧外向。其他坐标需显式转换。

## 推荐起点

1. `r11-sketch-foot-input.plan.json` → `prepare-plan.mjs`：平面直线截面转为约束草图并由 Loft 消费。
2. `r10-sketch-constrained-wall.plan.json`：闭合直线草图与约束。
3. `r3-arc-sweep.plan.json`：解析圆弧与扫掠。
4. `r7-gsd-split.plan.json`：分割方向与引用。
5. `r5-sketch-capped-front.plan.json`：封盖实体路径。

## 已替换的历史文件

r3-endplate-front、r5 左右 front-union、r7 左右 closed-endplate、r7-wings、r7-endplate-parameters、r8-single-foot-rib-solid 均为重新生成的独立数学试件，未读取任何 CAD。保留文件名供回归查找。矩形体、圆弧材料截面及翼型参数为任意尺寸，不是旧前翼数据的脱敏缩放。

r5 的五块矩形体仅验证合并链；附带的足板和尾部弧体相互独立。圆弧足板包含条下开口，但连接是尖角，未模拟完整保压条圆角。完整端板、整车相对定位、G2、加载与规则合规不由这些例子证明。
