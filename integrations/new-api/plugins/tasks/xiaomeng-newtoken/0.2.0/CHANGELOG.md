# 0.2.0

- 新增 `billing_mode`：总 Token 与输入／输出分项计费；插件消费该字段，不转发给 NewToken。
- 分项模式提供输入、输出独立用量事实和每百万 Token 单价字段，默认分别预扣 25 万，结束后按完整分项用量多退少补。
- 计费模式通过 `parseSubmitResponse.state` 持久化，查询时使用已锁定模式；查询展示不猜测提交模式。
- 接受完整 `input_tokens/output_tokens` 或 `prompt_tokens/completion_tokens`；零有效，缺项、非法数字、别名冲突及总和不一致保持待结算。
- 总模式保持 50 万预扣，按 `usage.total_tokens` 结算一次；分项模式的总量计费事实为零，防止重复计入。
- 保留原始响应 `usage`，增加两种模式的价格预览和离线合成用例；本次未执行测试、构建或真实生成。
