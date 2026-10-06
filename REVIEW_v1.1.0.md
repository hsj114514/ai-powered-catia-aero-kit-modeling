**历史记录：来自 r5 原包，未在 r6 复现；当前实现与验证范围以 [REVIEW_r6.md](REVIEW_r6.md) 为准。**

# v1.1 同版本修订记录

包内 `package.json.version` 保持 `1.1.0`。本次仅修改解压副本并输出 ZIP，未安装插件或推送仓库。

## 包络漏算

原逻辑会丢弃距顶点盒超过 500 mm 的控制点，且最多保留 4096 个控制点。一个二次曲线的真实中点为 `[50,600,0]`，原实现却给出 Y 范围 `[0,0]`，也没有标记异常。

修订后完整保留非有理样条控制网，包括曲面的全部行，以流式 min/max 累积代替控制点数组。该回归用例的 Y 范围现覆盖 `[0,1200]`，包含实际曲线。较大的控制点凸包可能偏宽，但不会再通过删除远处控制点人为缩小。

有理/不支持的几何、缺失引用、被过滤的半径、无法定位的部件与遍历截断等会产生部件级警告。`boundsStatus` 区分 approximate、suspect、incomplete、unavailable；子树不完整性也向上传播。所有包络仍带 `boundsUsableForCompliance: false`，这是近似辅助数据，不能证明无干涉或赛事合规。

## 规则输入与图示

- 无完整可执行检查、只有基准、缺少相应基准的伸出限值、空区域数组：返回 BLOCKED。
- 拒绝 null、字符串、布尔值、非有限数字、负长度、倒置区间及未知规则字段。
- 返回 `checkedRules` 和 `uncheckedElements`。若部分元素无法计算，不返回整体成功。
- 按此前提供的图示，`headrestBackX` 只用于前方 500 mm / 后方 1200 mm 的限高分区。移除了把整个后方当成禁入区的判断；独立纵向止界需用 `maxX` 显式指定。T9.3.2 的文字解释仍需另行核对，本修订不宣称已解决完整法规解释。
- 每次结果均声明 `fullCompetitionCompliance: false`。仍以 Y=0 为地面基准，单位为毫米；不包括安装刚度、200 N 变形及结构碰撞要求。

## Agent 入口与打包

`step_assembly_components` 现在接受 `includeBounds` 和 `maxEnvelopeBytes`，返回前 80 个结构化部件记录，CSV 可保存完整保留表的包络和质量标记。默认不启用包络。截断、放置交叉校验失败或包络异常返回 PARTIAL_SUCCESS。

包络内存预算包括实体数组、引用图与遍历队列，但不等于整个 Node 进程的内存上限。源文件单位未自动转换，尺寸阈值假定毫米导出。旧 `maxControlPointMarginMm` 兼容参数不再过滤控制点。

`scripts/package.ps1` 使用文件白名单打包，排除运行报告、临时文件和本机 CAD 数据，保留测试源码。源版本保持不变。

## 验证

- `node test/smoke.mjs`
- `node test/assembly.mjs`
- `node test/rules.mjs`
- `node test/tool-schema.mjs`
- `node test/envelope-regression.mjs`

以上五项离线检查已通过。新增用例验证曲线包含性、曲面完整控制网、超过 4096 个控制点、无法完整解析的几何、预算输入、Agent 返回值和 CSV 导出；规则回归涵盖不完整输入、后部限高与独立 maxX 止界。

原包附带的真实整车性能与尺寸报告未在本次复现，不作为修订版的验证结果。未执行 CATIA 端到端测试；DSH 编译器不可用时其对照测试仅记录跳过，不算通过。
