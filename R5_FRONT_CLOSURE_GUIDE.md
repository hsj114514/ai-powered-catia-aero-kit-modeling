# 前缘合并路径与公开回归例子

端板前缘未闭合的问题仍然开放。没有证据证明当前代码自动补齐了全部边界；合并指令成功、面积为正或奖励提高均不能单独证明闭合。

`AddNewAdd` 针对插件生成的不同实体 Body，按 bodySource 和源特征链执行，每一步必须 Update 和核对正体积。同 Body 合并应拒绝。原生失败需记录步骤，不自动移动母版、扩大 Join 容差或填掉设计开口。

公开的 `examples/r5-right-front-union.plan.json` 与左侧对应文件，用五块相邻矩形体请求四次 Boolean Add，并附带独立圆弧足板与尾部外抛能力试件。角色名称只是占位；它们不重建参考端板的前部轮廓。原私有轮廓、源 CAD 摘要和实测数据不在公开包内。

`examples/r5-sketch-capped-front.plan.json` 和 `examples/r5-axis-to-axis.plan.json` 分别演示草图封盖与轴系变换。先运行 dryRun，真实 CATIA 验证另行记录。
