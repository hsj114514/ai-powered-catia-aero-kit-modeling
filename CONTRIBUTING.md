# 贡献指南

本项目采用 GPL-3.0-only；贡献前阅读 LICENSE。保留包版本 1.1.0 和 revision r6，版本调整由维护者决定。

## 开发

使用 Node.js 18+，无需安装 npm 依赖。入口 index.js 注册宿主工具；lib/ 分离几何、规则、STEP、变换、装配操作及 CATIA 桥接。

在独立工作目录运行 node scripts/verify.mjs；此脚本只执行离线检查。实时 CATIA 验证必须单独说明宿主版本、接口、工作副本及验证范围，不把模拟测试描述为真实建模验证。

GitHub 工作流使用官方 [actions/checkout](https://github.com/actions/checkout) 和 [actions/setup-node](https://github.com/actions/setup-node)，仅请求 contents: read。无发布任务、密钥配置或自动推送。

## 修改要求

- 保留有限数值、路径、输入预算、矩阵与实例唯一性校验。
- 同步更新中英文说明、CHANGELOG 和相应检查。
- 不提交用户工程、审计流水、真实部件、报告中的个人路径或凭据。
- 装配会改变 CATIA 会话，失败和保存结果必须明确。
- 不把采样包围盒或近似包络描述为完整合规证明。
- 若变更工具 Schema，核对目标宿主支持的关键字；运行时仍需验证数组长度等条件。

## 打包

powershell -NoProfile -File scripts/package.ps1 -OutputFile <新zip绝对路径>

脚本拒绝覆盖输出并只收集白名单文件。解压后运行 node scripts/checksums.mjs 验证交付清单。修改后旧清单失效，应重新打包；不要手工保留旧哈希。
