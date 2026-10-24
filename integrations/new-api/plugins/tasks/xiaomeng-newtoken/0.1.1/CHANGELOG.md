---
changelogVersion: 1
plugin: "xiaomeng-newtoken"
version: "0.1.1"
locale: "zh"
---
# 更新说明

## [0.1.1]

- 明确 Seedance 按 `usage.total_tokens` 结算一次；没有新增输入、输出分别定价或虚构用量分项。
- 各模型、分辨率和参考视频档位新增 50 万 Token 预扣、40 万 Token 退差额、60 万 Token 补差额的价格预览样例。样例不提交生成任务。
- 保留插件 key、接口路由、计费变量和实际结算逻辑，现有任务用量表达式继续使用 `u("tokens")`。
- 安装说明补充输入/输出同价口径、人民币单价示例，以及中间件固定 720p、9:16 的配置方式。
- 本版未执行编译、自动测试或真实付费调用；需在用户的 New API 后台导入并检查价格预览。
