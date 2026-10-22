---
title: 数据库说明
description: 当前后端主要数据表与字段说明
---

# 数据库说明

本文档只记录后端当前已经使用的主要数据表。

钱包相关表和字段已在数据库副本中验证并部署测试站点，原数据保留；自动测试、隔离 HTTP 与浏览器结果见 [待测试](../progress/pending-test.md#用户钱包个人存储额度与人工套餐确认)。真实收款和 R2 仍待资源联调。

本轮个人存储设置与单条账号素材接口复用 `user_configs` JSON，不新增表或列；`f9538f9` 的 Go 全套、独立 TypeScript、20 项回归、完整 Docker、隔离 HTTP 及桌面图片/390px 菜单检查通过，已升级测试站。升级前在线备份，升级后完整性 `ok`；用户、画布、流水、文件索引、用户配置、订单、上传预留、设置共 8 表原行摘要完全一致，数量分别为 `1/1/0/0/0/0/0/1`，实际库未写入验收数据。真实旧浏览器、视频/音频实机、供应商及 R2 仍待验收或联调，具体记录见待测试。

## 数据库

后端使用 GORM 管理数据库连接和表结构迁移。

支持的存储驱动：

- `sqlite`
- `mysql`
- `postgresql`

当前启动时执行 `AutoMigrate`，自动维护以下表：

- `users`
- `credit_logs`
- `purchase_orders`
- `prompts`
- `agent_skills`
- `agent_skill_files`
- `assets`
- `settings`
- `video_tasks`
- `video_generation_logs`
- `image_generation_logs`
- `canvas_image_tasks`
- `canvas_audio_tasks`
- `comfy_bridges`
- `comfy_bridge_requests`
- `canvas_projects`
- `user_configs`
- `storage_objects`
- `storage_upload_reservations`

后续新增表时再同步补充本文档，未实际使用的规划表不提前写入。

### users

系统用户表。用户基础信息、角色、算力点余额和第三方登录标识放在该表中。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `username` | string | 用户名，唯一索引 |
| `password` | string | 密码哈希 |
| `email` | string | 邮箱 |
| `display_name` | string | 昵称 |
| `avatar_url` | string | 头像地址 |
| `role` | string | 角色：`user`、`admin` |
| `credits` | decimal(20,2) | 算力点余额 |
| `storage_extra_bytes` | int64 | 已确认购买的个人额外存储字节数，默认 `0`；与后台配置的免费基础额度相加 |
| `aff_code` | string | 用户自己的邀请码，唯一索引 |
| `aff_count` | number | 已邀请用户数量，冗余统计字段 |
| `inviter_id` | string | 邀请人用户 ID |
| `github_id` | string | GitHub 用户 ID |
| `linux_do_id` | string | Linux.do 用户 ID |
| `wechat_id` | string | 微信用户 ID |
| `status` | string | 用户状态：`active`、`ban` |
| `last_login_at` | string | 最近登录时间 |
| `extra` | json | 扩展信息，第三方资料按平台命名空间保存，如 `linuxDo` |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

后台编辑用户基础资料时保留 `storage_extra_bytes`。存储套餐由订单审核事务原子累加，不通过普通用户资料接口改写；降低免费基础额度不删除已有文件，超过新额度后阻止新增上传。

### purchase_orders

人工充值与永久存储扩容申请表。创建时保存套餐权益和金额快照；没有在线支付渠道，创建申请不会付款或发放权益。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键，订单编号 |
| `user_id` | string | 申请人，与 `request_id` 组成唯一索引 |
| `request_id` | string | 客户端请求幂等编号，最多 64 字节，同一用户重试返回原订单 |
| `plan_id` / `plan_name` | string | 创建时的套餐 ID 和名称快照 |
| `kind` | string | `credits` 算力或 `storage` 存储 |
| `price_cents` | int64 | 创建时的人民币整数分金额快照 |
| `credits` | decimal(20,2) | 算力套餐点数快照；存储套餐为 `0` |
| `storage_bytes` | int64 | 存储套餐增加的字节数快照；算力套餐为 `0` |
| `payment_method` | string | 当前固定 `manual`，表示人工确认 |
| `status` | string | `pending`、`completed`、`rejected`、`canceled` |
| `reviewer_id` | string | 确认或拒绝的管理员 ID |
| `review_remark` | string | 必填的审核备注 |
| `reviewed_at` | string | 管理员审核时间；用户取消不填写 |
| `created_at` / `updated_at` | string | 创建及最近状态更新时间 |

索引：`idx_purchase_orders_user_request (user_id, request_id)` 唯一；`user_id`、`status` 和 `created_at` 普通索引。列表响应中的 `userDisplayName` 来自关联用户查询，不建列。

用户仅能取消自己的待审申请；管理员确认前须核实已收到款项。审核锁定申请人用户行，通过待审状态条件更新及同一事务发放权益；重复相同审核不重复发放，改变终态会被拒绝。算力发放同时新增 `recharge` 流水，`related_id` 指向订单；存储发放只增加 `storage_extra_bytes`。套餐后续改价或停用不改变已创建订单。每人最多保留 20 笔待审申请，幂等重试不占新名额，取消或审核后释放名额。

### user_configs

用户级配置和同步数据表。每个用户一行，模型配置、用户存储配置及其他同步数据继续保存在原有 text 字段中。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | string | 用户 ID，主键 |
| `model_config` | 大文本 | 云端模型选择、创作偏好与个人 `autoSaveAssetsToCloud` JSON；旧个人渠道/工作流配置可保留在原数据中，但不向前端恢复或参与调用。Provider 配置同步开关为 `syncStorageConfig`、`syncWebDAVStorageConfig`，不是素材默认入库设置 |
| `storage_provider` | text | 用户存储配置 JSON，内部结构为 `{ "s3": {...}, "webdav": {...} }`，两类配置可保留但不能同时启用 |
| `image_history` | text | 用户图片历史同步数据 |
| `asset_data` | text | 账号素材库 JSON，包含 `assets` 及已有分类等扩展字段；保留历史数据 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

`storage_provider.s3` 保存 Endpoint、Region、Bucket、Access Key、Secret、公开域名和路径前缀；`storage_provider.webdav` 保存 WebDAV 地址、远程目录、用户名和密码/应用密码。自动同步开关不重复写入 Provider；后端下载和删除旧媒体时仍会读取已保存但已停用的 Provider。

`model_config.autoSaveAssetsToCloud` 是个人默认保存偏好，缺省为 `false`，独立 `storage-preferences` API 只原子合并这一字段；模型配置整份保存保留数据库最新值。用户配置更新在同一用户锁内补丁写入变化的字段，存储配置和历史记录更新不能回写旧整行快照覆盖偏好或素材列表。

账号素材用单条 API 在事务中合并 `asset_data`；媒体项新增/修改必须引用该用户拥有的 `storage_objects`，类型及字节数取文件索引，同 ID 和同文件键去重。旧本地引用、已有条目和 JSON 扩展字段不批量删除；旧整份列表覆盖接口停用。删除素材条目不删除 `storage_objects` 或物理文件，也不直接释放额度，以免损坏仍被画布或历史记录引用的文件。

`asset_data.assets[].metadata.browserSourceId` 可记录白名单稳定浏览器键的独立身份，供前端刷新后复用已归档文件；不包含 Token、Blob、Base64 或外链 URL，不是媒体引用或服务端鉴权凭据，不新增列。文件归属、实际类型和字节数仍以 `storage_objects` 为准。

偏好关闭时，真实素材文件和本地条目保存在当前浏览器的 IndexedDB/localforage，按访客/账号隔离，不建后端表；登录不会自动将这些本地文件变成账号云文件。偏好切换只影响后续保存，不批量搬移现有数据。管理员的服务器本地/R2 模式仍独立决定账号文件位置。

### storage_objects

服务器本地、S3/R2 与 WebDAV 共用的媒体文件索引表，不保存画布、素材列表或生成记录。服务器本地使用固定 `provider_id=storage-local`，相对文件路径保存在 `object_key`，根目录由 `LOCAL_STORAGE_DIR` 指定，默认 `data/storage`；Docker 中由原有 `/app/data` 挂载持久化。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 文件 ID，前端存储 key 使用 `server:<id>` |
| `provider_id` | string | 创建文件时使用的本地、S3/R2 或 WebDAV Provider ID；切换默认模式不修改旧对象 |
| `bucket` | string | S3/R2 Bucket；本地和 WebDAV 为空 |
| `object_key` | string | Provider 内相对对象路径，唯一索引 |
| `public_url` | string | S3/R2 可选公开地址；WebDAV 为空并通过 `/api/files/:id/content` 读取 |
| `mime_type` | string | 媒体 MIME 类型 |
| `bytes` | number | 文件字节数 |
| `width` | number | 预留字段，当前上传链路未写入，默认 `0` |
| `height` | number | 预留字段，当前上传链路未写入，默认 `0` |
| `sha256` | string | 文件内容摘要 |
| `direct` | boolean | 是否由登录用户的浏览器直接上传至 WebDAV |
| `created_by` | string | 创建用户 ID |
| `created_at` | string | 创建时间 |
| `deleted_at` | string | 预留字段；当前删除链路直接删除索引记录 |

个人占用按 `created_by` 汇总本表中的有效字节数，合并服务器本地、R2 和其他已有 Provider，不按当前默认模式分开计数；同一个实际对象保存为不同用户副本时分别计入各自额度。未建立索引的外部桶对象和浏览器本地素材不包含在此统计中。平台存储总容量上限仍是另一层约束，不能把默认 9 GiB 的平台上限当作每人的免费额度。

### storage_upload_reservations

并发上传的临时容量预留表，不保存媒体内容或凭据。上传前在用户行锁内检查“已用 + 未过期预留 + 本次大小”，完成后在同一事务写入文件索引并移除预留；失败时释放预留。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 预留 ID，主键 |
| `user_id` | string | 归属用户 |
| `bytes` | int64 | 本次预留的文件字节数 |
| `expires_at` | int64 | Unix 秒，到期后不再占用上传额度；当前有效期 30 分钟 |

索引：`idx_storage_reservation_user_expiry (user_id, expires_at)`。后续上传会清理该用户已到期预留；终结上传时再次校验预留、大小和最新个人额度。预留不计入钱包展示的 `usedBytes`，但会参与上传可用量校验。

### prompts

提示词表。用于保存公开提示词、内置 GitHub 系统提示词、分类和预览内容。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `title` | string | 标题 |
| `cover_url` | string | 封面图 |
| `prompt` | string | 提示词内容 |
| `tags` | json | 标签列表 |
| `category` | string | 分类标识 |
| `preview` | text | Markdown 展示内容，可包含文本、图片、视频链接等 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

`github_url` 仅用于接口返回，不写入数据库。

### agent_skills

画布 Agent 可选择 Skill 表。系统预设与登录用户上传的 Skill 使用同一张表，通过来源和所有者隔离；未登录用户的 Skill 只保存在浏览器 `localforage`，不写入该表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `owner_user_id` | string | 用户 Skill 的所有者 ID；系统预设为空 |
| `source` | string | 来源：`system`、`user` |
| `name` | string | Skill 名称 |
| `description` | string | Skill 简介 |
| `cover_url` | text | Skill 封面图片地址 |
| `cover_storage_key` | string | 现有图片存储系统中的对象标识；直接填写图片链接时为空 |
| `content` | text | 完整 Markdown 或文本内容，最多 20000 字 |
| `enabled` | boolean | 是否启用；停用的系统预设不向画布返回 |
| `sort` | number | 系统预设排序值 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

用户接口只能读写和删除当前账号自己的 `source=user` 记录；管理员 Skill 页面只维护 `source=system` 记录。Skill 编辑后直接使用最新内容，不保存历史版本。

### agent_skill_files

系统预设 Skill 的附属目录和文本文件表。根 `SKILL.md` 不在本表重复保存，仍以 `agent_skills.content` 为唯一内容来源。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `skill_id` | string | 所属系统 Skill ID，与 `path` 组成联合主键 |
| `path` | string | Skill 包内安全相对路径 |
| `kind` | string | `folder` 或 `file` |
| `content` | text | 文件正文；文件夹为空，每个文件最多 20000 字 |
| `sort` | number | 同一目录内的显示顺序 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

后台保存系统 Skill 时会在同一数据库事务中替换该 Skill 的附属目录记录；普通用户 Skill 仍然只允许单文件内容，不写入本表。Agent 只在当前激活的系统 Skill 明确引用附属文件时按路径读取，不会把整个目录每轮注入模型上下文。

### assets

素材表。当前用于后台素材库。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `title` | string | 标题 |
| `type` | string | 素材类型：`text`、`image`、`video` 等 |
| `cover_url` | string | 封面图 |
| `tags` | json | 标签列表 |
| `category` | string | 分类标识 |
| `description` | string | 描述 |
| `content` | text | 文本或 Markdown 内容 |
| `url` | string | 图片、视频等媒体地址 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

### video_tasks

视频生成任务表。后端创建视频任务后写入该表，后台轮询器每 5 秒统一查询未完成任务并更新进度、完成地址或失败详情；前端刷新、切换页面或关闭浏览器不会影响后端继续轮询。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键，本地任务 ID，优先使用上游 task ID |
| `user_id` | string | 用户 ID |
| `user_display_name` | string | 用户显示名 |
| `model` | string | 模型名称 |
| `channel_id` | string | 模型渠道 ID |
| `channel_name` | string | 模型渠道名称 |
| `source` | string | 任务来源：`video-workbench`、`canvas`、`workflow` |
| `source_id` | string | 来源内 ID，画布任务记录画布节点 ID，视频创作台为空 |
| `upstream_task_id` | string | 上游任务 ID |
| `workflow_ref` | text | 仅新工作流任务使用的渠道/条目精确引用；旧视频任务为空 |
| `upstream_video_id` | string | 上游视频 ID，例如 Agnes 的 `video_...` |
| `status` | string | 状态：`queued`、`processing`、`completed`、`failed` |
| `progress` | number | 生成进度，0-100 |
| `seconds` | string | 视频秒数 |
| `size` | string | 视频尺寸 |
| `video_url` | text | 完成后的视频临时 URL |
| `error` | text | 失败摘要 |
| `error_detail` | text | 失败详情或最近一次轮询错误详情 |
| `request_body` | text | 创建任务时的请求摘要 |
| `parameter_translation_snapshot` | text | 自定义转译视频的规则原文、变量、任务 ID 和已完成结果快照；不保存渠道密钥，不通过 JSON 响应返回 |
| `response_body` | text | 创建任务时的响应摘要 |
| `last_response` | text | 最近一次状态响应摘要 |
| `credits` | decimal(20,2) | 创建任务时预扣算力点 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |
| `started_at` | string | 上游开始时间 |
| `completed_at` | string | 完成时间 |
| `last_polled_at` | string | 最近轮询时间 |

后台轮询器按 `status + created_at` 查询未完成任务；旧数据库中如果残留废弃列，不再参与代码查询。

### video_generation_logs

视频创作台成果历史表。该表保存用户视频生成成果卡片的完整 JSON，并用独立字段做多设备去重、软删除和查询；它不是运行态轮询表，运行态仍由 `video_tasks` 负责。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键，对应前端生成记录 ID |
| `user_id` | string | 用户 ID，多用户数据隔离 |
| `task_id` | string | 后端或上游视频任务 ID |
| `video_id` | string | 上游视频 ID 或生成结果 ID |
| `status` | string | 记录状态：`生成中`、`成功`、`失败` |
| `payload_json` | text | 完整成果卡片 JSON。删除记录会清空该字段 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |
| `deleted_at` | string | 软删除时间，空字符串表示未删除 |

删除成果记录时只软删除当前用户对应记录，并清空该行 `payload_json`；软删除记录保留 7 天用于阻止旧浏览器缓存把已删除记录恢复回来。

### image_generation_logs

生图工作台成果历史表。当前先提供后端表和接口，前端生图工作台后续再接入；字段设计和软删除策略与 `video_generation_logs` 一致。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键，对应前端生成记录 ID |
| `user_id` | string | 用户 ID，多用户数据隔离 |
| `task_id` | string | 图片任务 ID，可为空 |
| `image_id` | string | 图片结果 ID、存储 key 或 URL |
| `status` | string | 记录状态 |
| `payload_json` | text | 完整成果卡片 JSON。删除记录会清空该字段 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |
| `deleted_at` | string | 软删除时间，空字符串表示未删除 |

### canvas_image_tasks

画布图片生成任务表。只用于画布节点生成恢复，不影响生图工作台原接口。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键，本地任务 ID |
| `user_id` | string | 用户 ID |
| `source` | string | 固定为 `canvas` |
| `source_id` | string | 画布来源 ID |
| `node_id` | string | 画布节点 ID |
| `model` | string | 模型名称 |
| `channel_id` | string | 模型渠道 ID |
| `workflow_ref` | text | 仅新工作流任务使用的渠道/条目精确引用；旧图片任务为空 |
| `status` | string | 状态：`queued`、`processing`、`completed`、`failed` |
| `progress` | number | 生成进度 |
| `prompt` | text | 提示词 |
| `generation_type` | string | `generation` 或 `edit` |
| `image_url` | text | 完成后图片 URL或第一张图片 URL |
| `image_urls` | JSON | 完成后全部图片 URL，第一项与 `image_url` 一致 |
| `storage_key` | string | 存储对象 key |
| `error` | text | 失败摘要 |
| `error_detail` | text | 失败详情 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |
| `started_at` | string | 开始时间 |
| `completed_at` | string | 完成时间 |

索引：`idx_canvas_image_tasks_user_source_node (user_id, source, source_id, node_id)`

### canvas_audio_tasks

画布音频生成任务表。只用于画布节点生成恢复，不影响原 `/audio/speech` 接口。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键，本地任务 ID |
| `user_id` | string | 用户 ID |
| `source` | string | 固定为 `canvas` |
| `source_id` | string | 画布来源 ID |
| `node_id` | string | 画布节点 ID |
| `model` | string | 模型名称 |
| `channel_id` | string | 模型渠道 ID |
| `workflow_ref` | text | 仅新工作流任务使用的渠道/条目精确引用；旧音频任务为空 |
| `status` | string | 状态：`queued`、`processing`、`completed`、`failed` |
| `progress` | number | 生成进度 |
| `prompt` | text | 提示词 |
| `audio_url` | text | 完成后音频 URL |
| `storage_key` | string | 存储对象 key |
| `error` | text | 失败摘要 |
| `error_detail` | text | 失败详情 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |
| `started_at` | string | 开始时间 |
| `completed_at` | string | 完成时间 |

索引：`idx_canvas_audio_tasks_user_source_node (user_id, source, source_id, node_id)`

### comfy_bridges

ComfyUI Bridge 设备表。每台可访问一处 ComfyUI 的独立程序注册一条设备；工作流配置仍保存在系统设置或用户模型配置 JSON 中，不在此表重复保存。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | Bridge ID，主键 |
| `owner_scope` | string | `system` 或 `personal` |
| `owner_id` | string | 系统设备为 `system`，个人设备为用户 ID |
| `name` | string | 设备显示名称 |
| `token_hash` | string | 专用 Token 的 SHA-256 摘要，唯一索引；不保存明文 Token |
| `enabled` | boolean | Token 有效标记；删除设备时整行移除 |
| `last_seen_at` | datetime | 最近一次心跳时间，用于判断在线状态 |
| `capabilities_json` | 大文本 | ComfyUI 地址、工作流目录及发现的工作流 ID/标题清单 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

索引：`idx_comfy_bridges_owner (owner_scope, owner_id)`。

### comfy_bridge_requests

Bridge 持久化请求队列表。普通执行请求由服务端按设备分配，Bridge 通过短租约领取和续租；ComfyUI 媒体只回传本机结果地址等小型元数据，服务端结算关联业务任务，删除设备或超过一小时硬截止的未完成请求标记失败，Bridge 确认不再需要重传后进入十分钟清理等待期。`inspect_workflow` 检查请求的硬截止为三十秒，调用方读取结果后立即删除；服务异常中断遗留的已完成检查请求由现有后台循环在三十秒后清理。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 请求 ID，主键 |
| `bridge_id` | string | 目标 Bridge ID |
| `owner_scope` | string | `system` 或 `personal` |
| `owner_id` | string | 系统或用户归属 ID |
| `task_id` | string | 对应图片、视频或音频任务 ID；检查请求为空 |
| `kind` | string | 输出用途：`image`、`video`、`audio`，或按需读取工作流的 `inspect_workflow` |
| `status` | string | `pending`、`claimed`、`succeeded`、`failed` |
| `payload_json` | 大文本 | 执行请求的工作流、字段覆盖及媒体输入，或检查请求的工作流 ID/JSON |
| `result_json` | 大文本 | Bridge 回传的本机结果地址、文件名、MIME 等小型媒体元数据，或按需检查得到的工作流 JSON、字段和拓扑 |
| `error` | text | 失败原因 |
| `claimed_at` | datetime | 领取或重新领取时间 |
| `lease_token` | string | 当前领取者的租约令牌；续租、检查点和结果回传必须匹配 |
| `lease_expires_at` | datetime | 短租约到期时间；到期的 `claimed` 请求可以重新领取 |
| `checkpoint_json` | text | Bridge 已持久化的执行检查点，包括提交中状态与 ComfyUI `prompt_id`；提交状态不明确时按失败退款处理，不重复提交 |
| `completed_at` | datetime | 完成或失败时间 |
| `cleanup_ready_at` | datetime | 普通执行请求在业务任务完成结算且 Bridge 已确认结果后写入，超过十分钟由后台循环物理删除；检查请求完成时写入，正常由调用方立即删除，服务异常中断遗留记录在三十秒后由后台循环清理 |
| `expires_at` | datetime | 普通执行请求为一小时硬截止，`inspect_workflow` 为三十秒硬截止，均不因续租延长 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

索引：`idx_comfy_bridge_queue (bridge_id, status)`、`task_id`、`lease_expires_at`、`cleanup_ready_at`、`expires_at`。

### canvas_projects

画布项目表。一条画布项目对应一行，完整项目 JSON 保存在 `project_data`，包含节点、连线、聊天会话、画布设置和视口；不拆节点表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | string | 所属用户，与 `id` 组成主键 |
| `id` | string | 画布项目 ID |
| `project_data` | text | 完整 `CanvasProject` JSON |
| `created_at` | string | 项目创建时间 |
| `updated_at` | string | 项目更新时间 |
| `deleted_at` | string | 软删除时间，空字符串表示未删除；超过 7 天由启动时和每天定时任务物理清理 |

索引：`idx_canvas_projects_user_deleted_updated (user_id, deleted_at, updated_at)`、`idx_canvas_projects_deleted_at (deleted_at)`


### settings

系统配置表。`public` 放前端可读取的公开配置，`private` 放仅后端和管理员可读取的私有配置；`commerce` 独立保存免费存储额度、人工联系说明与套餐；`agent-skills-initialized` 是默认 Skill 首次初始化标记。配置值都用 JSON。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | string | 主键：`public`、`private`、`commerce`、`agent-skills-initialized` |
| `value` | json | 配置内容 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

`public.value` 常放前端展示和可公开读取的配置，例如模型列表、登录开关等。  
`private.value` 常放渠道密钥、登录密钥、后台内部开关等。
`private.value.storage.mode` 为 `local`（默认服务器本地）或 `r2`，决定账号文件的后端位置。`autoSyncAllAssets` 保留为平台配置字段，不能代替个人 `autoSaveAssetsToCloud` 或把用户默认改为自动上传；本轮新素材缺省保存在当前浏览器。`capacityLimitBytes` 控制平台总容量，默认 9 GiB。切换后端模式只影响新上传，旧渠道存在文件引用时必须保留原配置，个人额度另由 `commerce` 管理。

当前系统设置接口会按后端结构体序列化和反序列化已知字段；数据库 JSON 中额外存在的旧字段会被忽略。

`commerce.value` 通过独立套餐设置接口保存，普通系统设置保存只更新 `public`、`private`，不会覆盖它。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `defaultStorageBytes` | int64 | 每人免费基础字节数；未配置默认 `1073741824`（1 GiB），允许后台调整为 `0` 至 1 PiB |
| `contactText` | string | 人工联系说明，最多 2000 字 |
| `instructions` | string | 申请及确认说明，最多 6000 字 |
| `plans` | object[] | 套餐定义，默认空，不预置价格；最多 100 项 |

套餐字段为 `id`、`name`、`kind`、`priceCents`、`credits`、`storageBytes`、`description`、`enabled`。金额为正整数分；算力套餐只增加最多两位小数的点数，存储套餐只增加永久字节额度，不提供期限或自动续费。钱包只返回已启用套餐。完整限制及接口见 [接口响应约定](api-response.md#钱包个人配额与人工套餐申请)。

`public.value` 当前字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `modelChannel` | object | 模型渠道公开配置组 |
| `auth` | object | 公开登录配置 |

`modelChannel` 当前字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `availableModels` | string[] | 系统可用模型列表 |
| `availableWorkflows` | string[] | 对用户开放的系统工作流标识列表；只开放显式勾选且所在渠道启用的工作流 |
| `modelCosts` | object[] | 模型算力点配置 |
| `defaultModel` | string | 默认模型 |
| `defaultImageModel` | string | 默认图片模型 |
| `defaultVideoModel` | string | 默认视频模型 |
| `defaultTextModel` | string | 默认文本模型 |
| `systemPrompt` | string | 系统提示词 |
| `allowCustomChannel` | bool | 当前二开固定关闭；个人模型渠道已停用 |
| `allowUserRemoteChannel` | bool | 是否向普通用户开放平台模型；关闭后普通用户不能生成，管理员可继续测试平台渠道 |

`modelCosts` 每项字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 模型名称 |
| `credits` | number | 图片每张、视频每秒、文本和音频每次调用预扣的算力点，工作流按次；最多两位小数。视频小数秒向上取整，智能时长 `-1` 按 15 秒计算；未配置拒绝调用，显式 0 才免费 |

`auth.linuxDo` 当前字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | bool | 是否开启 Linux.do 登录 |

`private.value` 当前字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `channels` | object[] | 模型渠道配置列表 |
| `promptSync` | object | GitHub 远程提示词定时同步配置 |
| `auth` | object | 私有登录配置 |

`channels` 每项字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `protocol` | string | 协议；原模型协议保持不变，另支持 `runninghub`、`comfyui` 工作流渠道 |
| `name` | string | 渠道名称 |
| `baseUrl` | string | 渠道接口地址 |
| `apiKey` | string | 渠道密钥 |
| `models` | string[] | 渠道可用模型列表 |
| `modelCapabilities` | object | 平台渠道手动设置的模型分类，键为模型名称，值为 `image`、`video`、`text`、`audio`；未设置的模型沿用系统识别。公开渠道只下发可用模型的分类 |
| `weight` | number | 渠道权重，同一模型命中多个渠道时按权重随机 |
| `enabled` | bool | 是否启用 |
| `remark` | string | 备注 |
| `uploadApiKey` | string | RunningHub 企业级素材上传 Key，仅私有设置保存 |
| `bridgeId` | string | ComfyUI 渠道绑定的 Bridge 设备 ID |
| `comfyUrl` | string | 生成 Bridge 启动命令时使用的 ComfyUI 地址，仅在私有设置保存 |
| `workflowDir` | string | 生成 Bridge 启动命令时使用的工作流目录，仅在私有设置保存 |
| `workflows` | object[] | 工作流条目、逐条启停、字段映射及 API JSON；只在私有设置保存完整内容 |

`promptSync` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | bool | 是否开启定时同步，默认开启 |
| `cron` | string | Cron 表达式，默认每天 0 点 |

`auth.linuxDo` 当前字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `clientId` | string | Linux.do OAuth App Client ID |
| `clientSecret` | string | Linux.do OAuth App Client Secret，后台返回时隐藏 |

后端请求模型时，先按模型名筛选启用且包含该模型的渠道，再按 `weight` 加权随机选择一个渠道。

RunningHub/ComfyUI 不加入上述普通模型筛选：系统工作流只下发已启用且已勾选条目的名称、ID 和用途；不会公开密钥、Bridge Token、字段映射或完整工作流 JSON。历史个人工作流配置可能仍保留在 `user_configs.model_config.workflowChannels`，当前调用入口已拒绝个人来源。

### credit_logs

用户算力点变更流水表。当前记录人工充值到账、后台手动调整、模型调用预扣和模型调用失败返还。流水作为只读审计记录，由对应余额事务生成；后台不能独立新增、编辑或删除流水，用户仅能通过本人接口读取自己的记录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 主键 |
| `user_id` | string | 关联用户 ID |
| `type` | string | 类型：`recharge`、`admin_adjust`、`ai_consume`、`ai_refund` |
| `amount` | decimal(20,2) | 本次变动数量，增加为正，扣减为负 |
| `balance` | decimal(20,2) | 变动后的用户算力点余额 |
| `related_id` | string | 关联业务 ID，可为空 |
| `remark` | string | 备注 |
| `extra` | json | 扩展信息 |
| `created_at` | string | 创建时间 |

`type` 当前取值：

| 值 | 说明 |
| --- | --- |
| `recharge` | 管理员确认收到套餐款项后的算力到账；关联订单 ID |
| `admin_adjust` | 后台手动调整 |
| `ai_consume` | 调用后端模型接口消费 |
| `ai_refund` | 后端模型接口调用失败返还 |
