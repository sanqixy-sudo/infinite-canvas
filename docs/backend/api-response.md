---
title: 接口响应约定
description: 业务接口统一响应结构与前端处理约定
---

# 接口响应约定

后端业务接口统一返回 JSON：

```json
{
  "code": 0,
  "data": {},
  "msg": "ok"
}
```

- `code`: 业务状态码，`0` 表示成功，非 `0` 表示失败。
- `data`: 业务数据。失败时通常为 `null`。
- `msg`: 响应消息。成功默认为 `ok`，失败时放错误原因。

前端请求逻辑以 `code` 判断业务是否成功。当前后端业务失败也会返回 HTTP 200，前端不要只依赖 HTTP 状态码判断结果。

接口连接失败、服务不可达、返回体不是约定 JSON 时，前端按网络或接口异常处理。

## 平台模型调用边界

- 用户生成与画布助手仅使用登录后的平台云端渠道；供应商地址、协议和密钥由管理员在服务端维护。`X-Model-Channel-ID` 只能选择当前账号有权使用、已开放的平台渠道，不能覆盖服务端供应商凭据。
- AI 路由拒绝 `X-User-Model-Channel-ID`，工作流提交仅接受 `ref.scope=system`。错误仍按各业务入口的统一失败结构返回，不应因为 HTTP 200 就视为调用成功；已停用的直连计划及个人工作流/Bridge 配置入口返回 HTTP 403。
- `GET /api/v1/user-config` 不返回旧个人渠道、供应商 Key/Base URL、个人工作流渠道及浏览器协议代码；旧数据库配置不主动删除。`POST /api/v1/user-config/model` 拒绝写入这些个人渠道字段及个人工作流引用，普通偏好与系统工作流引用仍可保存，模式固定 `remote`。
- 工作流 Agent 草稿接口不得提供个人协议、地址或密钥；平台渠道仍沿用当前公开模型、价格与扣返规则。TokenDance 个人回调在兑换密钥前由前端拒绝，管理员平台配置授权保留。
- 这些限制只约束模型来源，不改变项目、素材的服务器本地/R2 保存及访客浏览器本地编辑行为。个人来源拒绝、偏好白名单及平台 AutoDL 元数据边界已通过自动测试和隔离 HTTP 检查；真实供应商和 R2 联调待资源。

## 账户用量与文件存储

- `GET /api/v1/credit-logs` 需要 Bearer 登录鉴权，用户 ID 固定取当前会话；支持现有分页、关键词及 `type` 筛选，返回 `{ items, total }`。不返回流水原始 `extra`，仅返回模型、关联任务和公开备注等字段。
- 管理员独立新增、修改、删除流水接口返回 HTTP 405 和统一失败结构；余额调整继续使用用户管理调点接口，必须明确传入有效的 `credits`。
- `GET /api/storage/config` 返回 `mode=local|r2` 与公开开关，不返回密钥。默认本地指服务器文件目录；匿名浏览器本地行为保留。
- `POST /api/v1/files` 上传、`GET /api/files/:id` 元数据及文件删除按当前用户权限处理；私有文件内容支持 GET、HEAD、Range，使用文件所属用户/管理员只读会话或单文件限时凭证。无权限返回 HTTP 403；内容响应为媒体流，使用 `private, no-store` 缓存策略。
- 文件上传和元数据成功响应会设置仅 `/api/files` 使用的 HttpOnly 阅读会话；该 Cookie 不用于写入鉴权，退出时通过 `DELETE /api/files/session` 清理。
- `GET /api/assets/:id` 仅返回当前已发布的公共条目并刷新媒体链接；已撤下返回 404。前端插入或收藏时重新读取条目并保存独立副本，不将公共临时链接作为永久作品地址。

## AutoDL 渠道

- `POST /api/ai/autodl/workflows` 使用上述业务响应结构并要求 Bearer 登录。请求为 `{ channelId, workflowId? }`，渠道 ID 必须指向用户可用的平台 AutoDL 渠道；地址由服务端读取，不接受个人 `baseUrl` 或供应商 API Key。不带工作流 ID 返回平台开放的列表，带 ID 返回对应详情；元数据包含 `uuid`、`name`、`kind` 和详情的 `input_rules`，不返回上游内部节点映射。此项平台链路仍待真实供应商验证，原个人地址查询方式已停用。
- AutoDL 视频继续使用现有 `/api/v1/videos` 创建、查询及任务响应结构。
- `/api/v1/audio/speech` 是 AI 协议代理入口。AutoDL 成功时返回 `{ provider: "autodl", audio_url, mime_type }`；失败仍使用现有 `Fail` 业务结构。其他语音协议的响应保持原样。
- 现有 `/api/v1/canvas/audio-tasks` 消费 AutoDL 的上游音频 URL，返回既有任务结构，不新增结果下载或转存。

## 渠道自定传参转译

- 沿用 `/api/v1/images/generations`、`/api/v1/images/edits`、`/api/v1/audio/speech`、`/api/v1/videos` 及现有画布任务入口。命中自定义的账号请求携带 `{ model, n, _parameterTranslation: { kind, variables } }`；视频另携带面板 `seconds`，沿用现有按秒费用计算。`kind` 为 `image`、`video`、`audio`。
- `_parameterTranslation` 是系统内部负载。后端只按已授权的平台渠道读取管理员保存的协议原文，转译后只向供应商发送配置里的方法、地址、请求头、查询参数和请求体；不读取用户个人协议，不允许浏览器回退直连。
- 图片 JSON 结果归一为 `{ data: [{ url }] }`；音频 URL 归一为 `{ provider: "parameter-translation", audio_url }`。配置直接返回文件时沿用二进制响应及 MIME。失败仍用现有 `Fail` 业务结构。
- 视频沿用现有任务响应，增加 `parameter_translation: true` 标记；私有查询快照和公共渠道脚本不随响应返回。创建、查询、完成和失败均进入现有任务管理，失败不重发默认请求。
