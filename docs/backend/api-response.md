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
- `GET /api/storage/config` 返回 `mode=local|r2` 与公开开关，不返回密钥。此处 `local` 指账号文件的服务器目录，与用户默认保存在当前浏览器的个人偏好不同。
- `POST /api/v1/files` 上传、`GET /api/files/:id` 元数据及文件删除按当前用户权限处理；私有文件内容支持 GET、HEAD、Range，使用文件所属用户/管理员只读会话或单文件限时凭证。无权限返回 HTTP 403；内容响应为媒体流，使用 `private, no-store` 缓存策略。
- 文件上传和元数据成功响应会设置仅 `/api/files` 使用的 HttpOnly 阅读会话；该 Cookie 不用于写入鉴权，退出时通过 `DELETE /api/files/session` 清理。
- `GET /api/assets/:id` 仅返回当前已发布的公共条目并刷新媒体链接；已撤下返回 404。前端插入或收藏时重新读取条目并保存独立副本，不将公共临时链接作为永久作品地址。

## 个人存储偏好与账号素材

个人偏好和单条素材基础接口已在测试站 `f9538f9` 完成历史验证，结果见 [待测试](../progress/pending-test.md#个人存储设置与账号素材库)。下表同时记录本轮新增的目录响应字段；Go 全量、`1115c6f` 独立类型检查和 32 项 Bun 回归、`86b07b0` 完整 Docker 构建、隔离 HTTP 及浏览器检查通过，测试站已升级 `86b07b0` 且原数据保留。所有接口需要 Bearer 登录鉴权，用户固定取会话，响应使用 `Cache-Control: private, no-store`；实际新站点匿名 POST 目录保存和素材整理均返回 401。真实旧浏览器、视频/音频实机、供应商及 R2 仍待验收或联调。

| 接口 | 请求 | 成功时的 `data` |
| --- | --- | --- |
| `GET /api/v1/storage-preferences` | 无业务参数 | `{ autoSaveAssetsToCloud: boolean }`，未配置为 `false` |
| `POST /api/v1/storage-preferences` | `{ "autoSaveAssetsToCloud": true }` 或 `false` | 保存后的同一对象 |
| `GET /api/v1/user-data/assets` | 无业务参数 | 已保存的账号素材 JSON，包含 `assets`、`folders` 及已有扩展字段；无目录时 `folders: []` |
| `POST /api/v1/user-data/assets/item` | `{ "asset": Asset }` | `{ assets: Asset[], folders: AssetFolder[] }`，最新账号列表与目录 |
| `DELETE /api/v1/user-data/assets/item/:id` | 当前账号的素材条目 ID | `{ assets: Asset[], folders: AssetFolder[] }`；不存在的 ID 幂等返回原列表 |
| `POST /api/v1/user-data/assets` | 旧批量覆盖接口 | HTTP 405、统一失败结构，提示使用单条接口 |

偏好 POST 只接受这一布尔字段，拒绝缺失、`null`、字符串等错误类型、未知字段和多段 JSON。设置复用 `user_configs.model_config.autoSaveAssetsToCloud`，通过独立补丁原子更新；模型偏好整份保存保留数据库最新值，不能通过旧模型快照覆盖。该设置只决定用户新素材的默认去向，不改变平台云端模型来源或管理员的服务器本地/R2 模式，也不自动搬移已有素材。

账号素材写入在锁定用户的事务中读取并合并最新 `asset_data`，不接受整份列表覆盖。`asset` 沿用 `id`、`kind`、`title`、`tags`、`category`、`source`、`metadata`、`data`，增加可选 `folderIds`；`id` 必填且最多 128 字节，标题必填且最多 200 字，最多 50 个标签、每个最多 80 字，每素材最多 32 个目录归属。请求体最大 1 MiB；创建时间由服务端生成，更新保留原创建时间，`metadata` 允许普通 JSON 扩展。

- 媒体必须先归档实际文件，再传 `data.storageKey="server:<文件ID>"`。文件索引必须存在且属于当前账号，拒绝本机 `image:`、`file:`、Blob、未归档远程地址和旧 WebDAV 直连标识。`kind`、`mimeType`、`bytes` 根据文件索引确认，活动媒体地址归一为 `/api/files/:id/content`，不信任客户端自报的类型、大小和临时 URL。
- 文本使用 `kind="text"` 与非空 `data.content`，最多 200000 字，不要求文件索引。历史条目和列表扩展字段原样保留，本轮只严格校验新写入或修改项，不批量清除旧本地引用。
- 同 `asset.id` 为更新/重试；同文件键已归另一 ID 时复用既有条目、不产生重复项，也不将原 ID 的其他内容覆盖为重复文件。客户端从返回列表识别实际条目 ID，不能假设一定等于本次提交 ID。
- 新建素材可提交本账号有效目录与标签；已有条目的普通整份保存保留数据库最新 `tags/folderIds`，不能通过上传重试或旧快照修改组织字段。修改这些字段须使用下方组织接口；前端表单只发送确实变更的组织意图。
- 文件上传和素材条目写入是两步。只有两步完成才可显示“已存入账号素材库”；第二步失败时保留原内容并支持复用文件重试，不能把仅上传成功显示成已入库。
- 前端可在 `metadata.browserSourceId` 保存稳定浏览器文件的独立身份，以从本账号已有条目复用归档文件；仅由白名单本地键生成，不存 Token、Blob、Base64 或外链 URL，不作为文件读取地址或服务端授权依据。归属仍由 `storageKey` 对应的文件索引校验。
- 删除接口只移除账号素材库条目，不删除物理文件、文件索引或其他画布引用，因此不直接释放个人额度。实际文件删除或清理须另行核对引用和权限；不要把条目删除等同于“彻底清除文件”。

偏好关闭、未登录或尚未加载成功时，前端将新素材真实文件保存在当前浏览器的 IndexedDB/localforage；浏览器本地条目按访客/账号分区，不批量上传到账号列表，不承诺跨设备可读。切换账号必须丢弃旧会话的异步响应并重新加载该账号偏好和云列表，不能清空其他分区的历史文件。

`f9538f9` 历史隔离 HTTP 已验证独立偏好与模型整份保存互不覆盖、严格输入、禁止缓存、文件归属和权威字段、ID/文件去重、跨用户隔离与旧接口 405；12 个并发文本加原图片完整保留 13 条。删除条目后文件和占额仍保留，实际文件删除后占用归零。这些结果不覆盖本轮目录/标签，也不等于所有画布/历史长期引用场景已验收。

### 素材目录与标签组织（当前分支）

Go 全量、`1115c6f` 独立 TypeScript 与 32 项 Bun 回归、`86b07b0` 完整 Docker 构建通过。隔离 HTTP 已验证目录树/多归属、跨用户和无效批量原子拒绝、并发标签与旧快照保存互不覆盖，以及删除目录后保留素材、文件索引和 232 B 文件占用；浏览器目录、批量整理、ZIP 往返及画布选择器检查也已完成。测试站已部署 `86b07b0`，匿名 POST `/api/v1/user-data/asset-folders` 与 `/api/v1/user-data/assets/organize` 均返回 401。接口沿用 Bearer 会话与 `{ code, data, msg }`；用户由服务端确定，响应 `private, no-store`，不接受其他账号的目录或素材 ID。

| 接口 | 请求 | 成功时的 `data` |
| --- | --- | --- |
| `POST /api/v1/user-data/asset-folders` | 新建 `{ name, parentId? }`；修改 `{ id, name?, parentId? }`，根目录 `parentId=""` | `{ assets: Asset[], folders: AssetFolder[] }` |
| `DELETE /api/v1/user-data/asset-folders/:id` | 当前账号目录 ID | 删除该目录及下级目录后的同一快照；素材与文件保留 |
| `POST /api/v1/user-data/assets/organize` | `{ ids, folderIds?, addFolderIds?, removeFolderIds?, addTags?, removeTags? }` | 整理后的同一快照 |

- `AssetFolder` 为 `{ id, name, parentId, createdAt, updatedAt }`；新建 ID 和时间由服务端生成，修改 ID 必须已属于当前账号。名称去首尾空白，最多 80 字，同级名称忽略大小写判重；最多 1000 个目录、8 层，拒绝不存在的父级及自身/子目录循环。
- `ids` 为 1–200 个素材 ID。`folderIds` 表示替换完整归属，`[]` 表示移出所有目录；`addFolderIds/removeFolderIds` 表示增减归属，不能与替换同时使用。`folderIds/addFolderIds` 输入最多 32 个，`removeFolderIds` 输入最多 1000 个，最终单素材归属仍最多 32 个。同一目录或标签不能同时添加和移除，至少提供一个实际整理操作；只有显式传 `folderIds: []` 的清空也有效。
- 每素材最多 32 个目录归属；每素材最多 50 个标签、每标签最多 80 字，标签去空白和重复值。整理在事务内基于最新数据应用补丁，保留未涉及字段、其他素材和 JSON 扩展；目标素材不存在或越权、目录无效或超限时整批拒绝，不部分提交。标签仅支持明确增删，旧条目的整份标签快照不具权威性。
- 删除目录仅删除目录与后代目录元数据，移除各素材相应 `folderIds`，保留其他目录归属；不删除素材条目、文件索引、物理文件，不释放占用，也不影响画布与历史引用。
- 目录保存请求体上限 4 KiB，组织请求体上限 1 MiB，拒绝未知字段和多段 JSON。账号数据复用 `user_configs.asset_data`；当前浏览器目录不调用这些账号接口，由本地分区保存。手动把本地素材存入账号库时不带入本地目录 ID。

本轮自动、隔离 HTTP、界面与 ZIP 检查的具体结果及剩余验收见[素材目录与标签整理](../progress/pending-test.md#素材目录与标签整理)。这些结果不代表真实供应商、R2 和所有设备场景均已通过。

## 钱包、个人配额与人工套餐申请

接口已部署测试站点，构建、自动测试、隔离 HTTP 与浏览器结果见 [待测试](../progress/pending-test.md#用户钱包个人存储额度与人工套餐确认)。以下描述接口契约，不代表真实支付或 R2 联调已通过。

### 用户接口

所有接口需要 Bearer 登录鉴权，身份固定取会话，不接受客户端指定其他 `userId`。

| 接口 | 请求 | 成功时的 `data` |
| --- | --- | --- |
| `GET /api/v1/wallet` | 无业务参数 | `{ credits, storage, commerce }` |
| `GET /api/v1/purchase-orders` | `page`、`pageSize`、`status`、`kind`、`keyword`、`date` 可选 | `{ items: PurchaseOrder[], total }`，仅本人订单 |
| `POST /api/v1/purchase-orders` | `{ "planId": "套餐ID", "requestId": "本次申请的唯一编号" }` | `PurchaseOrder`；同账号相同请求编号重试返回原单 |
| `POST /api/v1/purchase-orders/:id/cancel` | 空对象 | 取消后的 `PurchaseOrder`；只能取消本人的待审订单 |

`requestId` 必填，最多 64 字节，仅允许 ASCII 字母、数字、`-`、`_`；前端为一次确认操作生成编号，网络失败重试沿用编号。相同编号不能用于另一套餐。创建请求仅接受 `planId`、`requestId`，拒绝传入价格、点数、容量、用户身份等未知字段；权益以服务端套餐快照为准。

钱包字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `credits` | number | 当前账号真实算力余额 |
| `storage.usedBytes` | integer | 当前用户文件索引记录的总字节数，跨本地与 R2 等已有 Provider 汇总 |
| `storage.baseBytes` | integer | 当前后台设置的每人免费基础额度；未配置为 1 GiB |
| `storage.extraBytes` | integer | 已确认购买的永久额外额度 |
| `storage.limitBytes` | integer | 基础额度与额外额度之和 |
| `storage.remainingBytes` | integer | 剩余字节数，最低为 `0` |
| `storage.overLimit` | boolean | 已用量是否超过个人额度 |
| `commerce` | object | 免费额度、联系说明和已启用套餐，不返回停用套餐 |

个人配额在本系统保存或登记的账号媒体上传中统一校验。本地与 R2 切换不重置占用，钱包不计算浏览器本地素材或没有文件索引的外部桶对象；并发上传还会计算未过期预留，因此展示剩余量不能代替服务端上传检查。删除实际文件及索引后释放对应占用；降低免费额度不清空旧素材，超额后阻止新增上传。平台总容量限制继续单独生效。

### 管理员接口

以下接口需要管理员鉴权，不从用户提交的身份字段判断权限。

| 接口 | 请求 | 成功时的 `data` |
| --- | --- | --- |
| `GET /api/admin/commerce/settings` | 无业务参数 | 完整 `CommerceSetting`，包含停用套餐 |
| `POST /api/admin/commerce/settings` | 完整 `CommerceSetting` | 保存后的设置；独立于普通系统配置 |
| `GET /api/admin/purchase-orders` | `page`、`pageSize`、`status`、`kind`、`keyword`、`date` 可选 | `{ items: PurchaseOrder[], total }`，含申请人显示名 |
| `POST /api/admin/purchase-orders/:id/review` | `{ "action": "complete", "remark": "实际收款核实说明" }`，或 `action="reject"` | 审核后的 `PurchaseOrder` |

`CommerceSetting` 包含 `defaultStorageBytes`、`contactText`、`instructions`、`plans`。未配置时免费额度为 `1073741824` 字节（1 GiB），套餐列表为空。管理员可调整免费基础额度，允许 `0` 至 1 PiB；没有默认价格或默认充值商品。

| 套餐字段 | 类型 | 校验 |
| --- | --- | --- |
| `id` | string | 套餐唯一标识；留空由服务端生成，否则最多 80 字节，只允许字母、数字、`-`、`_` |
| `name` | string | 非空，最多 80 字 |
| `kind` | string | `credits` 或 `storage` |
| `priceCents` | integer | 人民币整数分，大于 `0` 且不超过 `100000000` |
| `credits` | number | 算力套餐为正数、最多两位小数且不超过 `1000000000`；存储套餐为 `0` |
| `storageBytes` | integer | 存储套餐为正整数字节且不超过 1 PiB；算力套餐为 `0` |
| `description` | string | 最多 1000 字 |
| `enabled` | boolean | 停用后不接受新订单，不修改已有订单快照 |

`plans` 最多 100 项；联系说明最多 2000 字，申请说明最多 6000 字。配置写入独立 `settings.commerce`，不会因保存模型或存储系统配置而丢失。本轮不修改供应商调用计价公式或 `modelCosts`。

### 订单状态与发放

`PurchaseOrder` 包含 `id`、`userId`、`requestId`、`planId`、`planName`、`kind`、`priceCents`、`credits`、`storageBytes`、`paymentMethod`、`status`、`reviewerId`、`reviewRemark`、`reviewedAt`、`createdAt`、`updatedAt`；列表另有查询字段 `userDisplayName`。

- 当前 `paymentMethod` 固定 `manual`。创建后为 `pending`，只记录申请，不自动付款、不立即发放。
- 管理员核实实际收到款项后选择 `complete`，填写非空审核备注（最多 1000 字）；状态变为 `completed`，事务内增加算力或永久存储额度。算力同时产生 `recharge` 流水，`relatedId` 为订单 ID。
- 拒绝后为 `rejected`，本人取消后为 `canceled`，两者不发放权益。管理员和用户只能改变待审状态；重复相同终态操作返回原记录，不能把已完成、已拒绝或已取消订单改成另一终态。
- 创建与审核锁同一申请人用户行，审核还使用状态条件更新；余额、流水和状态任一步失败则全部回滚。重复点击确认不重复入账；修改或禁用套餐不改订单金额和权益快照。
- 每人最多 20 笔待审订单。已有请求的幂等重试先返回，取消或审核后可继续申请。算力总余额上限为 `1000000000000`，累计额外存储上限为 1 PiB，超限不发放。

在线支付收银台、支付回调、自动到账、订阅续费和订单自动退款尚未接入，不能把“提交申请成功”展示为“支付成功”。

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
