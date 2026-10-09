# 贡献指南

GPL-3.0-only，见 LICENSE。当前包为 1.2.0/r11；版本变更由维护者决定。

Node.js 18+，无需 npm 安装。lib/ 下分离桥接、几何、草图、GSD、规则、评分和计划；skills、rules、scoring 应同步维护。先运行 node scripts/verify.mjs，只进行离线检查。真实 CATIA 验证需说明版本、许可、输入和授权副本，不能把模拟回复或旧报告称为新版本实测。

- 保留有限数值、ID/路径、预算、引用类型、结果门槛和授权边界。
- 奖励需与几何任务和实际消费关联；不能按工具数量加分、篡改硬规则或用尝试次数证明闭合。
- 不提交真实 CAD、轮廓派生数据、审计账本、私人路径、凭据或未经授权的规则原文文档。
- 同步更新中文/英文说明和 CHANGELOG，记录尚未验证的部分。
- Schema 变更需兼容宿主；外部编译器缺失须记录跳过，运行时校验仍需保留。

## 打包

```powershell
powershell -NoProfile -File scripts/package.ps1 -OutputFile <新zip绝对路径>
```

脚本按 package.json 的逐文件白名单收集，拒绝已有输出、路径逃逸与链接文件，保留隐藏的 GitHub 元数据，并重新生成 checksums.sha256。解压后检查完整性。修改源码后旧清单失效。

GitHub CI 只请求 contents:read，执行离线 Node 检查，不安装/启动 CATIA、不自动发布。使用官方 [actions/checkout](https://github.com/actions/checkout) 与 [actions/setup-node](https://github.com/actions/setup-node)。CI 各平台结果以实际运行记录为准。
