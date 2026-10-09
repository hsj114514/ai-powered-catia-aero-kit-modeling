# AI-Powered CATIA Aero Kit Modeling

**v1.2.0 / r11 · GPL-3.0-only · GitHub 版本更新**

[English](README.en.md) · [v1.1 → v1.2 更新说明](RELEASE_NOTES.md) · [已知问题与后续目标](ROADMAP.md)

面向 FSEC/FSAE 赛车空套的 CATIA V5 参数化建模工具，提供翼面、襟翼、端板、扩散器、部件位置读取与装配，以及 GSD、草图、建模计划和几何规则初筛。当前主要用于几何设计；没有实现自动 CFD 求解，也不评估安装刚度或约 200 N 载荷变形。

## 作者的话

> 全题目光向我看齐，看我看我，我宣布个事，我是个sb，gsd的功能v1.2才想起来加

模型建模能力还有巨大优化空间：Agent 仍然喜欢使用样条线，主动建立有效约束的能力不足，复杂端板还可能出现该闭合的面不闭合。好歹已经能用，但“工具已接入”不等于“Agent 会正确使用”，更不等于“所有复杂模型都能生成”。

这段是作者的自嘲。准确的版本历史是：v1.1 已有基础翼面放样和样条路径，v1.1.1 至 v1.2 逐步扩展 GSD；v1.2 整合了更系统的目录、适配器和建模策略。v1.3 前争取改善工具选择、主动约束与闭合检查，属于待实现、待验证的目标，不能保证届时全部修好。

## 对比 v1.1 有什么变化

对照本地保留的 v1.1.0/r6 GitHub 候选源码：注册工具 **27 → 44**，17 个新增，原 27 个入口保留。部件位置读取、STEP 装配读取与插入/移除/替换在 v1.1 已有。

| 方向 | v1.2.0 / r11 的变化 |
| --- | --- |
| GSD 与实体 | 扩展曲面、线框、分割、修剪、接合、修复、变换、圆角和封盖路径；145 个工厂白名单入口。29 个中英文命令中 24 个有适配，5 个明确未实现。 |
| 草图与约束 | 新增闭合直线多边形/开放折线草图，长度、水平、垂直、平行、垂直关系与端点重合；参数编辑/重建路径。 |
| 建模计划 | 批量依赖排序、离线准备和审查；r11 默认将能精确表示的共面两点直线截面转为约束草图，再由 Loft 消费。 |
| 奖惩与 Skill | 独立全局/前翼 Skill、评分配置、闭合惩罚和条件性小奖励；相关实际修复尝试可有限减罚，不能替代闭合成功。 |
| 规则与诊断 | 规则来源、缺失证据与未核验条款分开记录；部署指纹、失败阶段、重建与历史指标便于定位问题。 |
| 公开交付 | 清理私有 CAD 派生轮廓与实测数据，重新生成合成示例，补充中英文文档、路线图、贡献说明和离线 CI。 |

详细入口、范围和没有实现的部分见 [更新说明](RELEASE_NOTES.md) 与 [GSD 命令表](GSD_COMMANDS_v1.2.0-r5.md)。工厂目录数量不是实机验证数量。

## 下载后如何使用

### 1. 离线使用

需要 **Node.js 18+**。包没有 npm 运行时依赖，无需 npm install 或构建。在解压后的 `catia-aero-kit` 目录运行：

```sh
node scripts/doctor.mjs
node scripts/checksums.mjs
node scripts/prepare-plan.mjs examples/r11-sketch-foot-input.plan.json prepared.plan.json
node scripts/evaluate-plan.mjs prepared.plan.json
node scripts/verify.mjs
```

`prepared.plan.json` 必须不存在；脚本拒绝覆盖。上述流程不启动 CATIA、不安装插件。doctor 会显示本机环境路径，其输出不要随源码公开。SHA256 检查针对交付文件；改源码后应重新打包。公开例子的任意尺寸与限制见 [examples/README.md](examples/README.md)。

### 2. 在 CATIA 中建模

需要 Windows、CATIA V5、已注册的 `CATIA.Application` COM 和对应的建模许可。宿主需要提供 DSH/Cordis 的 `tools` 服务；内嵌 Skill 注入还需要宿主的 `systemPrompt` 支持。

有兼容 DSH 宿主时，按 [整包重装说明](REINSTALL_r11.md) 手动加载 `cordis.patch.yml`。代码、Skill、rules 和 scoring 应一起更新；加载后通过 `catia_policy_status` 核对 **1.2.0 / r11、44 个工具、26 项资源指纹**。只替换 Skill Markdown 不会更新工具代码。

当前不是独立 MCP 服务，也不是适用于所有 Agent 的通用安装包。其他 Agent 需要适配工具注册、Schema、结果渲染、提示注入与用户授权流程，详见 [移植说明](PORTABILITY.md)。本候选版尚未在新主机验证实时 CATIA。

### 3. 路径与操作范围

`projectRoot` 留空时，插件自动从用户目录环境变量选择工程输出目录；`cscript.exe` 由系统目录定位。不存在开发机硬编码路径。doctor 能检查 Node、脚本宿主与 COM 注册，但不会安装 CATIA、修复许可或代替实时验证。

发布包保留 r11 原配置 `maxLevel: 3`，移除/替换装配仍需 confirm 和 reason；若希望禁用这两项，手动改为 2。只在授权工程副本中进行真实操作。输出文件、账本、审计、工程和 CSV 不应提交 GitHub。

## 几何与规则边界

默认 **毫米，+X 向后、+Y 向上、+Z 右侧外向**。STEP 按源文件单位读取，不自动换算。其他来源坐标必须显式转换。

开放放样截面与设计的足板开口可以是合理几何；应闭合的材料轮廓/壳体必须单独声明和检查。评分是计划启发式评估，不会训练 Agent，也不会自动证明曲面闭合、G2、下压力或赛事合规。规则库属于几何初筛，缺项和未核验条款不能当作通过。

草图当前不支持圆弧/翼型草图、相切/半径约束、Pad/Pocket 或完整自由度认证；r11 的自动转换只覆盖严格的直线截面，不自动修复自由曲线端板前缘。D3 距离类型不匹配、D4 截面 Update 失败根因仍未确认。完整限制见 [ROADMAP.md](ROADMAP.md)。

## 文档导航

- [草图进入放样的 r11 路径](R11_SKETCH_ROUTING.md)
- [GSD 参考与命令状态](GSD_REFERENCE.md)
- [闭合实体路径](R7_CLOSED_ENDPLATE_GUIDE.md) / [前缘合并](R5_FRONT_CLOSURE_GUIDE.md)
- [奖惩公式](EVALUATOR_REFERENCE.md) / [规划策略](R10_PLANNING_POLICY.md)
- [本次公开交付审查](GITHUB_RELEASE_REVIEW.md) / [历史记录范围](HISTORY.md)
- [贡献](CONTRIBUTING.md) / [安全问题](SECURITY.md) / [许可证](LICENSE)

## 验证与发布状态

本轮仅做离线代码、Schema、引用链、合成几何合同和交付文件检查。打包检查阶段没有安装、启动 CATIA、复测真实模型；源码现用于 GitHub 版本更新。离线通过、原生 Update、几何实测与完整赛事合规是不同结论。

源码已按仓库根目录组织；准备阶段 ZIP 保留为独立交付记录。发布说明可直接使用 RELEASE_NOTES.md；工作流尚未在 GitHub 执行。
