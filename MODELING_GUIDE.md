# v1.1.1 / r3 建模指南

## r7 补充：闭合实体与分割

详见 [R7_CLOSED_ENDPLATE_GUIDE.md](R7_CLOSED_ENDPLATE_GUIDE.md)。新增catia_closed_loft（closed_loft）和catia_capped_extrude（capped_extrude），复用截面边界、Fill两端封盖、CloseSurface到独立Body，并检查有限正体积。多Body未布尔合并；r7仅离线验证。GSD分割使用catia_gsd_split或AddNewHybridSplit，方向±1，曲线/曲面源，保留侧基于支撑方向；分割不自动封盖。新例子examples/r7-*.plan.json均dryRun:true。planFile省略调用dryRun时继承文件值，显式调用参数优先。


新增工具、坐标示例、G2 与圆角见 [GSD_REFERENCE.md](GSD_REFERENCE.md)。先查询目录再创建 gsd_api；本次只离线测试。以下 r2 七种简化操作继续兼容。复杂前部原有加厚/闭合失败记录见 r3 自查，通用示例成功不代表该形状成功。

## 简易端板

`catia_endplate` 的 `outlinePoints` 是 XY 平面多边形，使用直线闭合。`z` 为近侧面位置，另一侧为 z+thickness。生成两侧 Fill、Extrude 侧壁及 Join 曲面壳。需要体积实体时向 `catia_gsd_feature` 提交：

```json
{"project":"plate_demo","id":"plate_solid","op":"solid_close","from":["plate"]}
```

端板的多边形不能表达精确圆弧。自交边界会失败；不要靠提高容差掩盖几何问题。

## 主板＋外抛＋保压条

示例把保压条表达为折边片体。实际图纸如有圆角、管形截面或其他结构，应先明确尺寸与截面，不自动猜测结构。

1. 主板：`catia_surface` 定义沿放样方向排列的三维截面。
2. 外抛：与主板共用连接截面，再逐步沿 +Z 外移。
3. 保压条：在另一条边建立折边片体，共用连接边。
4. `join`：合并连接曲面，默认距离容差 0.001 mm。
5. `solid_thick`：对连接片体加厚，并确认正体积。

[示例 JSON](examples/complex-endplate.json) 中主板 X 长 300、Y 高 90；外抛增加 Y=30、Z=30；保压条沿 -Z 伸出 20；厚度 2 mm。此例无自动圆角，未代表真实赛车位置或合规尺寸。

将示例交给 `catia_model_plan`，先添加 `dryRun:true`。预检有限数值、截面、依赖、引用类型和名称冲突，输出依赖排序，不启动 CATIA、不写账本。预检不能验证 CATIA 拓扑或许可。检查后去掉 `dryRun` 执行，完整计划只重建一次。

计划 1～64 步，项目最多 2048 个元素、200000 个输入点。ID 不得与已有元素或内部特征重复。支持前向引用，拒绝缺失引用和循环依赖。`from` 引用元素 ID，不是显示名称或文件路径。

## 三维截面

`sections` 形如 `[[[x,y,z],...],[[x,y,z],...]]`。每组为一个截面，截面按放样方向排序，点按同一拓扑方向排列。

- 2～40 个截面，每个 2～256 个点；闭合至少 3 点。
- 截面点数相同，不能有相邻重复点或完全重合的连续截面。
- 默认开放；闭合时 `closed:true`，重复首尾点会移除。
- 使用真实空间坐标，单位 mm。曲面可能偏离输入点盒，点盒只作初筛。
- 自交、错误的截面顺序、扭转或加厚后自交仍可能导致更新失败。

一条轮廓不能完整描述外抛，必须提供空间截面或取得缺失尺寸。图片参考不自动产生精确 CAD 尺寸。

## GSD 参数

| op | from | 参数 / 结果 |
|---|---|---|
| fill | 1～40 条边界曲线 | 闭合边界填充，点连续 |
| loft | 2～40 条截面曲线 | 有序曲面放样 |
| extrude | 1 条曲线 | dir：X/-X/Y/-Y/Z/-Z，limit1>0、limit2≥0 |
| offset | 1 个曲面 | 有符号 distance；双侧用两个独立调用 |
| join | 2～40 个曲面 | connexion 为距离容差，默认 0.001 mm |
| solid_thick | 1 个曲面 | offset1 默认 2、offset2 默认 0，实体 |
| solid_close | 1 个封闭曲面壳 | 实体；不封闭时失败 |

调用中的 `from` 均是数组，如 `["endplate_sheet"]`；内部账本会规范化部分单源操作。数字必须是有限 JSON number，不能用字符串、null 或布尔值代替。limit1 沿所选有符号轴，limit2 朝反方向。

`catia_api_probe` 是 Level 1，创建七个有效试件并更新、测量、关闭。verified 只证明该试件成功。失败可能是参数、几何、许可或环境，不能依据旧探测或 438 单独宣称全部工具不支持。

## 失败处理与交付

- 看 errors 中第一个失败步骤。只有更新、正面积/体积验证、保存全部成功才算完整成功。
- Join 失败时检查共享边、缝隙和连续性；加厚失败时检查窄缝、折角、曲率与偏移侧。
- 区分线框显示与真正缺面。r2 平板回归测量两侧大面；一般正面积检查不能证明全部预期面都存在。
- SaveAs 失败但几何完成返回 PARTIAL_SUCCESS，不能声称已输出文件。用 `catia_env` 的 `checkWrite` 检查当前实例。
- 特征清理是尽力执行，不保证完整事务。超时/COM 中断后检查会话。已有文件通过新编号保护。

最后在整车上测量间距、核对适用规则。示例、有效曲面、正体积和 API 探测不构成赛事合规认证。
