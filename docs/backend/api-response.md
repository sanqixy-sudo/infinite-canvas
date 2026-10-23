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

前端请求同时检查 HTTP 状态和 `code`。普通业务失败可能返回 HTTP 200、非零 `code`；需要登录的接口在未登录或会话失效时返回 HTTP 401，权限不足仍按入口返回 403 等状态，不能只依据 HTTP 200 判断成功，也不能把所有失败都当作退出登录。

接口连接失败、服务不可达、返回体不是约定 JSON 时，前端按网络或接口异常处理。

## 短剧制作接口（工作区实现，待验收）

均在现有用户鉴权的`/api/v1`路由下，沿用`{code,data,msg}`。本轮未执行接口验收。

| 方法 | 路径 | 入参与返回 |
| --- | --- | --- |
| GET | `/api/v1/productions?workspaceId=根画布ID` | 当前账号制作文档；无计划返回`data:null` |
| POST | `/api/v1/productions` | `{workspaceId,title}`；创建后返回文档；同账号同项目重复创建返回已有计划 |
| POST | `/api/v1/productions/save` | 完整文档含`id/workspaceId/revision/title/synopsis/styleGuide/createdAt/updatedAt/episodes/scenes/assets/shots`；成功返回revision+1文档 |
| DELETE | `/api/v1/productions?id=计划ID&revision=版本` | CAS删除计划及四类子记录，成功`data:null`；保留画布/媒体 |
| GET | `/api/v1/productions/tasks` | `workspaceId/episodeId/status/page/pageSize`；持久图/视频/逐镜配音历史，返回`items,total,page,pageSize,hasMore,summary,shotCosts,historyScope,costScope` |
| POST | `/api/v1/productions/tasks/retry` | `{workspaceId,recordId,requestId,quoteId?}`；无quoteId先报价，带quoteId确认提交；已受理的同requestId直接恢复原任务 |
| GET | `/api/v1/productions/renders?workspaceId=根画布ID` | 本人合成任务，最多50条，在途优先 |
| GET | `/api/v1/productions/renders/request?requestId=请求ID` | 本人同requestId合成任务；未受理为null，不代表旧提交以后不会到达 |
| POST | `/api/v1/productions/renders` | `{workspaceId,episodeId,revision,requestId,audioStorageKey,audioGain}`；冻结已保存计划并返回合成任务 |
| POST | `/api/v1/productions/renders/action` | `{id,action:'retry'或'cancel'}`；未知提交用`{requestId,action:'cancel-request'}`阻挡晚到POST |

子记录字段采用camelCase，定义见`model/production.go`和`web/src/app/(user)/canvas/lib/production-types.ts`。主表的账号、创建时间和更新时间由服务器管理；子记录project_id不从客户端采信。仅允许一份完整JSON，请求最多4MiB；未知字段、额外JSON文档、非整数时长/排序被拒绝。

保存先校验全部关联和限制，再在事务中查账号画布、验证本项目节点存在/类型。revision冲突返回可读业务失败，不自动覆盖。前端保留草稿并允许导出完整JSON；重新读取账号版本须明确确认。保存画布接口若返回比本地新的内容，制作页停止继续保存并提示同步冲突。

镜头新增`candidates[]`与`selectedImageCandidateId/selectedVideoCandidateId`；候选字段`id/title/kind/canvasId/nodeId/storageKey/content`。候选文件身份必须与事务内读取的节点一致，有storageKey时content必须空，无storageKey时只允许HTTP/HTTPS链接；每镜20、每计划1000。采用ID须为本镜对应类型候选，已删除/换文件/运行中/失败候选不能保存。

任务历史独立于短期图/视频/音频任务表，冻结首次提交时已保存镜头的归属，不回填更早任务。`status=all/running/failed/billing`，每页最多100。项包含`recordId/id/kind/shotIds/episodeIds/shotTitles/canvasId/nodeId/model/status/progress`、重试链及账务字段，不返回请求正文、密钥、原始错误或媒体URL。`kind=image/video/audio`；音频仅包含经账号与镜头归属校验的`production_voice_*`任务，其canvasId保存workspaceId、nodeId为shotId，前端进入该镜头配音区而非构造图/视频节点链接。`chargedCredits/refundedCredits/netCredits/settledCredits`来自服务端账本，缺失为null；明确免费为0。`actualInputTokens/actualOutputTokens`同样保留缺失与零；`billingUnit`为second/call时使用`actualUnits`，不拿Token字段当秒数。summary和shotCosts汇总本次分集全部已记录任务，不受状态筛选和页码影响；共享任务在总额中只计一次。

重试仅支持明确失败且账务settled/released的网关任务；当前保存计划仍需绑定原镜头。首次返回`accepted:false`及`quoteId/requestId/model/reserveCredits/expiresAt`；确认提交或重复查询已受理请求返回`{accepted:true,task}`。requestId须在请求前保存，报价过期可以原requestId重新报价；不能换新ID盲重试未知提交。父任务已有后继时禁止再分叉，新的失败操作最新后继。普通图/视频回画布确认后生成，配音回镜头配音区；音频历史的canRetry为false，不通过此接口重放。

合成任务含`id/requestId/workspaceId/episodeId/episodeTitle/revision/status/progress/seconds/shotCount/attempts/error/outputStorageKey/outputBytes/createdAt/updatedAt`，不返回私有素材快照、存储配置或workerID。状态为queued/running/completed/failed/cancelled；提交用`user_id+request_id`去重并校验请求摘要。cancel-request在尚未受理时创建取消墓碑，晚到提交不得入队。只有已完成输出可按现有账号文件权限下载。

合成只接受本人账号文件和已采用结果；最多60镜头/300秒，单镜1～60秒，输入512MiB、音轨64MiB、输出256MiB，每账号2在途。输出720×1280/24fps MP4；短视频拒绝，保持原比例补边。audioGain为0～1；可选音轨从片头铺入，不提供字幕烧录或逐镜配音。运行环境需ffmpeg/ffprobe，本轮未执行真实合成。

`POST /api/v1/canvas/projects/delete`新增制作引用保护：计划根画布、资产节点来源画布、镜头及候选关联画布被引用时，整批拒绝；必须先解除引用或删除制作计划。此操作不会自动移除计划内容。

AI拆镜使用既有平台文字接口，不新增绕过服务端计费的模型直连。返回经严格结构/引用校验后在浏览器展示可编辑草案；人工确认才追加镜头，成功持久化制作草稿后再清除已采用的拆镜草案。

## 团队协作与审片接口（工作区实现，待验收）

写入和业务查询使用现有UserAuth、统一JSON结构。只读媒体另用ReadUserAuth，支持Bearer或同源HttpOnly阅读Cookie，不接受分享码作为媒体凭证。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / POST | `/api/v1/teams` | 分页本人团队 / `{name}`创建团队 |
| POST | `/api/v1/teams/join` | `{code}`消费一次性邀请码，返回teamId |
| GET / POST / DELETE | `/api/v1/teams/:teamId` | 成员详情 / `{name}`改名 / 所有者删除团队 |
| POST | `/api/v1/teams/:teamId/members` | `{userId,role}`；只有所有者能设置admin/member |
| DELETE | `/api/v1/teams/:teamId/members/:userId` | 按角色移除或本人退出，所有者不可直接退出 |
| GET / POST | `/api/v1/teams/:teamId/invites` | 管理者查看邀请状态 / 生成24小时单次邀请码，明文仅生成响应返回 |
| DELETE | `/api/v1/teams/:teamId/invites/:inviteId` | 管理者撤销未使用邀请 |
| GET / POST | `/api/v1/teams/:teamId/reviews` | 分页分享列表 / `{workspaceId,revision,episodeIds,includeScript}`发布本人保存计划中的分集快照 |
| GET / DELETE | `/api/v1/team-reviews/:reviewId` | 成员只读详情 / 发布者或管理者撤销 |
| GET / POST | `/api/v1/team-reviews/:reviewId/comments` | 按shotId分页 / `{shotId,body}`逐镜留言，正文最多2000字 |
| DELETE | `/api/v1/team-reviews/:reviewId/comments/:commentId` | 本人、发布者或管理者删除意见 |
| GET / HEAD | `/api/team-reviews/:reviewId/media/:shotId/:kind` | kind=image/video；按当前成员身份读取该镜采用文件，支持Range |

发布快照由服务器在团队和发布者锁内从保存计划生成，默认includeScript=false；不采信客户端自造镜头快照。返回仅分集/镜头文字、相对鉴权媒体路径和可撤销权限，不包含canvasId/nodeId/storageKey、文件对象ID、账单或供应商地址。列表沿用page/pageSize（上限50）。成员DTO仅公开身份显示字段和团队角色，不返回用户钱包。

写操作在团队事务内重新验证owner/admin/member。移除成员同时撤销其分享和未使用邀请；删除团队撤销全部分享；后续详情/媒体请求重新校验当前权限。返回private/no-store，不能撤回已经下载或已授权在途流。未撤销审片的mediaObjectIDs与在途合成素材参与文件删除引用检查，不授予普通文件API跨账号访问权。基础审片不含团队钱包、共同画布编辑、公开链接或实时协同。

### 共享项目、素材与团队管理

| 方法 | 路径 | 请求与结果 |
| --- | --- | --- |
| GET / POST | `/api/v1/teams/:teamId/projects` | 分页共享项目 / `{workspaceId,revision,editAllowed}`明确共享本人已保存计划 |
| GET / POST / DELETE | `/api/v1/team-projects/:projectId` | `{project,team,myRole,canEdit,canViewCosts,plan}`详情 / 提交完整TeamPlan白名单CAS保存 / 按权限撤销共享 |
| POST | `/api/v1/team-projects/:projectId/permissions` | `{editAllowed}`调整协作编辑权限 |
| GET / POST | `/api/v1/teams/:teamId/assets` | 分页明确共享的素材 / `{objectId,title}`共享本账号图片、视频或音频 |
| DELETE | `/api/v1/team-assets/:assetId` | 文件原拥有者或管理者撤销共享，不删除原文件 |
| GET / HEAD | `/api/team-assets/:assetId/media` | ReadUserAuth + 当前团队授权读取媒体，支持Range，不返回私有storageKey或签名链接 |
| POST | `/api/v1/teams/:teamId/members/:userId/cost-permission` | `{canViewCosts}`；仅团队所有者可调整普通成员权限 |
| POST | `/api/v1/teams/:teamId/transfer` | `{userId,confirmation}`；目标必须为当前成员，确认文字为`转移团队所有权：团队名称` |
| GET | `/api/v1/teams/:teamId/audits` | owner/admin分页查看操作审计 |

TeamPlan包含`revision/title/synopsis/styleGuide/episodes/scenes/assets/shots`。分集仅`id/title/script/order`；资产仅`id/kind/title/description/variantOf`；镜头仅`id/episodeId/sceneId/order/title/description/dialogue/camera/seconds/assetIds/status`。私有canvas/node、候选、媒体引用和交付字段不接受客户端提交，由服务端从当前计划保留。请求最多4MiB，拒绝未知字段；CAS冲突保留前端草稿。允许新增和修改，已有条目删除及镜头跨集移动由原拥有者在个人计划处理。

当前共享项目每个原拥有者/workspace只允许一份活跃授权。活跃team_projects阻止删除个人制作计划；活跃team_assets阻止删除原文件。移除素材或项目拥有者即撤销其共享，不能通过再次使用旧ID继续访问。所有权转移只改变团队角色，原项目与文件所有权、个人钱包保持不变。

### 生成审批与项目预算

| 方法 | 路径 | 请求与结果 |
| --- | --- | --- |
| GET | `/api/v1/team-projects/:projectId/generation` | `page/pageSize`，返回`{canApprove,canViewCosts,budget?,requests,total,page,pageSize}` |
| POST | 同上 | `{requestId,shotId,model,parameters,assetIds,prompt}`发起申请，不扣费；模型与素材能力由服务端校验 |
| PUT | `/api/v1/team-projects/:projectId/generation/budget` | `{limitCredits}`；仅原项目拥有者设置，0～1亿、最多两位小数，不低于已有held+spent |
| POST | `/api/v1/team-projects/:projectId/generation/:approvalId/action` | `{action,quoteId?,reason?}`，action为`quote/submit/reject/withdraw` |

申请冻结当时模型revision、已保存镜头及视频节点绑定，参数不含上游Key。参考素材只接受本团队明确共享assetId，报价阶段由服务器读取授权文件并换成临时任务素材，不把私人文件凭据返回成员。`prompt`最多10000字，参考ID最多50个，还须满足所选模型实际输入上限。报价或提交时模型能力版本变化要求撤回后重新申请。

`quote`仅原项目拥有者可调用，返回网关冻结报价`{quoteId,expiresAt,reserveCredits,unit,...}`，Token分项显示输入/输出各自单价，秒/次按对应费率显示。`submit`必须带有效quoteId，由原拥有者明确确认扣自己的个人钱包；返回`{accepted:true,task}`。重复受理返回原任务，不发起第二笔扣费；请求内容变化不能复用原编号。`reject`仅原拥有者，`withdraw`仅申请者，均只能处理pending申请，不扣费。

列表请求项包含`id/shotId/shotTitle/requesterId/model/revision/prompt/parameters/assetIds/state/reason/taskId`；只有具备成本权限时才有`reservedCredits/actualCredits`，以及`budget={limitCredits,heldCredits,spentCredits}`。团队所有者/管理员、原项目拥有者或明确授予成本权限的成员可见金额；普通成员不获得个人钱包、私有节点ID、请求快照或上游地址。

受理在事务内再次检查成员、共享授权、镜头节点、素材、预算和个人余额；预扣、预算占用、流水、任务及原视频节点任务元数据共同成功或回滚。节点已有prompt/media/layout保持，执行字段及本次参数更新；活跃团队任务不会被旧画布保存覆盖，复制/导入节点不继承审批任务身份。状态从pending到running，再由真实任务结算为settled/released/pending_balance；缺失用量继续等待，不能按零收费。

预算仅统计此审批入口任务，普通个人画布生成不计入。最终实际费可高于预扣和预算，超支会阻止后续批准，不保证费用硬封顶。结算按原冻结规则多退少补、终态幂等；成员或共享撤销不会取消已经发生的费用。详情与列表每次按当前权限返回，任务结果仍由原项目拥有者在私人画布/制作任务中查看，再明确发布审片。


## 访问门禁与登录会话（当前分支，部分验证）

后续排版提交 `697ca4b` 与 `016f30f81e8a0aae62ef86b1866bb0b0485f7f381` 只改首页/登录 UI 与私有 CSS，不新增或调整本节 API、响应、鉴权及媒体权限。697 独立类型顺序重跑及 697/016 完整构建通过，016 多尺寸/主题/滚动检查和阶段部署已完成。当前媒体版 `2d9910e075cf36fa2d3d438b984e27493f47dedc` 的独立类型、完整构建和浏览器普通播放检查通过，已部署且原数据一致；静态 MP4/JPG 不新增业务接口，不能当成模型调用或账号文件。Go 与 38 项回归沿用原功能检查点，不冒称布局或媒体后重跑。

当前2d实际站首页、登录、工作台和健康接口200；4张海报HEAD均200/image/jpeg，4个MP4 Range `bytes=0-1023` 均206/video/mp4、1024B且总长正确。这些为公开静态功能演示，不依赖私有账号文件Cookie；匿名 GET `/api/assets` 与 POST `/api/v1/images/generations` 仍401。减少动态效果/隐藏标签与网络失败恢复等专项未实测，不能由普通播放和HTTP资源检查推断全部通过。

- 浏览器用户页面仅 `/`、`/login`、`/legal` 公开，其他业务页在会话校验后显示；控制台为 `/workspace`。此为页面白名单，静态资源、健康检查、登录与公开配置等接口仍按各自路由规则处理，不一概套用页面门禁。后台另保留管理员权限校验。
- `safeLoginRedirect` 只允许安全站内相对路径，默认 `/workspace`，保留合法查询/锚点，拒绝跨站、协议相对地址、反斜线、控制字符和登录循环；URL Token 必须由 `loginWithToken` 请求真实用户并确认非 guest 后接受。回调失败显示错误，敏感参数清出地址栏，不把传入 Token 视为已登录凭据。
- API 请求封装与同源 `/api/` 直接 fetch 对 401 采用同一会话原则：只有请求 Bearer 与当前 Token、`sessionVersion` 仍匹配时才清理当前会话，旧请求不得退出新账号；403 不自动退出。`/me` 的网络/服务错误保留待校验状态并提示重试，旧水合/认证响应不得覆盖新会话。
- 退出会话同时反映到其他标签页；最终 `fca04ad` 镜像已真实验证另一个标签退出后，画布立即卸载并进入保留原 canvas 返回路径的登录页，不依赖下一次业务请求才发现退出。
- 新增显式 `POST /api/files/session`：需 Bearer，返回统一成功结构，建立 `/api` 范围的 `xiaomeng_storage_viewer` HttpOnly、SameSite=Lax 只读 Cookie，HTTPS 或受信反代 HTTPS 头下设置 Secure。`DELETE /api/files/session` 清理 `/api` 和旧 `/api/files` 范围 Cookie；前端串行同步建立/清理。普通登录、`/api/auth/me` 和文件元数据读取不再隐式改写阅读 Cookie。
- 需要登录的公共素材、提示词/技能读取和 `/api/proxy-image` 使用只读鉴权，可接受当前 Bearer 或上述阅读 Cookie；Bearer 显式提供时优先校验它，不能退到 Cookie。文件上传、配置和业务写入仍要求 Bearer，旧匿名文件写入口同样加登录鉴权。私有文件内容保留所属账号/管理员或有效单文件限时凭证校验，阅读 Cookie 不转移文件所有权、不提供写权限。
- 旧画布恢复不新增后端接口：浏览器只读旧全局原档，明确选择后生成新 ID 并沿用当前账号画布保存/同步；远端文件归属仍由原文件索引决定，不能通过恢复 JSON 取得其他账号文件。用户登录后仍可选当前浏览器保存，模型来源继续仅平台云端。
- 本轮功能 `1141512`、Go 官方格式 `ff99112` 的 Go 全量、独立 TypeScript 与合计 38 项 Bun 回归通过；后续仅移除登录多余刷新与调整首页阴影的 `fca04ad` 完整 Docker 构建退出 0。38 项包含既有用例，不是新增数量，类型检查不由构建替代。测试站已部署 `fca04adc3709c4bdede7d7ea47b11313bdeb8ceb6`，原数据一致。
- 隔离 HTTP 已通过公开页/Logo/图标 200、匿名业务/代理/旧匿名上传 401、普通用户后台 403、显式 POST 媒体 Cookie 的 JWT 剩余期/HttpOnly/Path=/api、Cookie 只读不能写、无效 Bearer 不回退 Cookie、`/me`/FileInfo 无 Cookie 副作用、本人/签名媒体可读、裸私有文件拒绝和退出双路径清理。浏览器已通过登录/退出/错误密码及账号隔离/显式旧项目副本恢复，`fca04ad` 深链精确为 `/assets?scope=local#folder`、刷新不重复恢复；首页主题与首页/登录窄屏检查通过。用户排版反馈、真实注册/OAuth、长期竞态等仍见待测试，不据此声称所有场景或体验验收完成。
- 实际测试站匿名 GET `/api/assets`、`/api/prompts`、`/api/proxy-image?...`，POST `/api/anonymous/files`、`/api/v1/user-data/asset-folders`、`/api/v1/user-data/assets/organize`、`/api/v1/images/generations` 均 401；公开及用户页面、图标和健康检查返回 200。Next.js 页面响应 200 不等于匿名获准访问业务内容，仍须浏览器门禁和后端权限共同处理。

## 平台模型调用边界

- 用户生成与画布助手仅使用登录后的平台云端渠道；供应商地址、协议和密钥由管理员在服务端维护。`X-Model-Channel-ID` 只能选择当前账号有权使用、已开放的平台渠道，不能覆盖服务端供应商凭据。
- AI 路由拒绝 `X-User-Model-Channel-ID`，工作流提交仅接受 `ref.scope=system`。错误仍按各业务入口的统一失败结构返回，不应因为 HTTP 200 就视为调用成功；已停用的直连计划及个人工作流/Bridge 配置入口返回 HTTP 403。
- `GET /api/v1/user-config` 不返回旧个人渠道、供应商 Key/Base URL、个人工作流渠道及浏览器协议代码；旧数据库配置不主动删除。`POST /api/v1/user-config/model` 拒绝写入这些个人渠道字段及个人工作流引用，普通偏好与系统工作流引用仍可保存，模式固定 `remote`。
- 工作流 Agent 草稿接口不得提供个人协议、地址或密钥；平台渠道仍沿用当前公开模型、价格与扣返规则。TokenDance 个人回调在兑换密钥前由前端拒绝，管理员平台配置授权保留。
- 模型限制只约束来源，不改变登录后的当前浏览器保存或账号文件的服务器本地/R2 模式；本轮另要求登录后使用业务页，历史访客档案仍保留。个人来源拒绝、偏好白名单及平台 AutoDL 元数据边界的历史自动和隔离 HTTP 已通过，不能替代本轮门禁检查；真实供应商和 R2 联调待资源。

## 账户用量与文件存储

- `GET /api/v1/credit-logs` 需要 Bearer 登录鉴权，用户 ID 固定取当前会话；支持现有分页、关键词及 `type` 筛选，返回 `{ items, total }`。不返回流水原始 `extra`，仅返回模型、关联任务和公开备注等字段。
- 管理员独立新增、修改、删除流水接口返回 HTTP 405 和统一失败结构；余额调整继续使用用户管理调点接口，必须明确传入有效的 `credits`。
- `GET /api/storage/config` 返回 `mode=local|r2` 与公开开关，不返回密钥。此处 `local` 指账号文件的服务器目录，与用户默认保存在当前浏览器的个人偏好不同。
- `POST /api/v1/files` 上传、`GET /api/files/:id` 元数据及文件删除按当前用户权限处理；私有文件内容支持 GET、HEAD、Range，使用文件所属用户/管理员只读会话或单文件限时凭证。无权限返回 HTTP 403；内容响应为媒体流，使用 `private, no-store` 缓存策略。
- 阅读会话改为上节的显式 `POST /api/files/session` 建立、DELETE 清理，范围 `/api`；普通文件元数据响应不再隐式设置 Cookie。该 Cookie 仅供获准的读取中间件使用，不用于写入鉴权。
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

登录且偏好关闭或尚未加载成功时，前端将新素材真实文件保存在当前浏览器的 IndexedDB/localforage；当前策略先登录使用业务页，原访客分区及文件仍保留。浏览器条目按账号分区，不批量上传到账号列表，不承诺跨设备可读。切换账号必须丢弃旧会话的异步响应并重新加载该账号偏好和云列表，不能清空其他分区的历史文件。

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
# 模型中间件接口补充

画布专用接口仍使用`{code,data,msg}`。管理员`GET/PUT /api/admin/model-gateway`读取/保存连接及售价，`POST /api/admin/model-gateway/sync`同步目录。密钥不回传，空字符串保留；中间件目录只能同步获得。公开`/api/settings`追加`protocol=gateway`渠道，`gatewayModels`含能力、原价档位、零售`sale.tiers`和展示备注，`modelCosts.billingUnit=token`不能再乘时长。

计费模式由已发布模型的`pricing.tokenMode`决定，不由浏览器自行指定价格或用量：

- `total_tokens`：总Token单价，`reserveTokens`预扣；`sale.tiers`的`withoutVideoCreditsPerMillion/withVideoCreditsPerMillion`分别为无/有参考视频价格。
- `input_output_tokens`：输入、输出不同价，`reserveInputTokens/reserveOutputTokens`分别预扣；`sale.tiers`按分辨率提供`withoutVideoInputCreditsPerMillion/withoutVideoOutputCreditsPerMillion/withVideoInputCreditsPerMillion/withVideoOutputCreditsPerMillion`四个独立单价。参考视频档位不等于输入/输出分项。
- 公开`modelCosts`同时携带`tokenMode`、对应预扣数量和`tiers`；其`credits/reserveCredits`是所有已发布分辨率与参考视频档位的最大预扣概览，具体任务以报价为准，不是最终费用。分项计费不能再读取总量单价展示成唯一售价。

登录用户`POST /api/v1/model-gateway/quote`和`POST /api/v1/model-gateway/tasks`使用统一请求`requestId/model/revision/variantId?/prompt/parameters/inputs`，任务提交额外携带`quoteId`和可选`source/sourceId/canvasId`。多规格模型须由参数匹配唯一规格；若提供variantId，它必须与服务端解析结果一致。报价返回以下字段，Token模式未参与的数量与价格为0：

| 字段 | 说明 |
| --- | --- |
| `quoteId` / `expiresAt` | 服务端签名报价，5分钟有效，绑定用户、请求和能力版本 |
| `variantId` | 解析得到的真实规格ID；无variants的单规格模型为空 |
| `unit` / `quantitySource` | token/second/call；秒/次分别指定request_duration、response_duration或successful_task |
| `reserveUnits` / `unitPriceCredits` | 秒/次的预扣数量及算力/单位单价；Token模式使用下列专属字段 |
| `tokenMode` | 总量或输入/输出分项模式 |
| `reserveCredits` | 本次参数对应的预扣算力 |
| `unitPriceCreditsPerMillion` / `reserveTokens` | 总量模式的锁定单价与预扣量 |
| `inputPriceCreditsPerMillion` / `outputPriceCreditsPerMillion` | 分项模式各自锁定的算力/百万Token单价 |
| `reserveInputTokens` / `reserveOutputTokens` | 分项模式各自锁定的预扣数量 |

报价与持久化任务快照锁定规格、计费单位、数量来源及单价。Token分项完成时按实际输入×输入价加实际输出×输出价，合计后以十进制有理数统一half-up到0.01算力，再与已落账预扣额比较退补；不可分项分别舍入或将`totalTokens`再次计费。按秒采用冻结的请求时长或成功响应中的整数duration，按成功次计1；缺实际数量不假设为0或改用估算。提交重新计算规则并比较签名报价，规则改变时要求重新报价。配置后续改变不影响已有任务；已存在requestId优先恢复原记录，即使报价过期也不再提交上游。

查询`GET /api/v1/model-gateway/tasks/by-request/:requestId`用于断线恢复，不存在返回HTTP404；已知平台任务ID沿用`GET /api/v1/videos/:id`，附`billingUnit/tokenMode/billingStatus/actualTokens/actualInputTokens/actualOutputTokens/actualUnits/reservedCredits/settledCredits`。用户必须拥有该任务。`actualInputTokens/actualOutputTokens`未取得真实分项时返回`null`，实际为零时返回`0`；不能用默认零代替缺失用量。秒/次的实际数量在actualUnits中，缺失同样为null。

分项结算只接受完整的`input_tokens/output_tokens`或`prompt_tokens/completion_tokens`。同时出现两组必须对应一致；若有总数须等于两项之和，未给总数则可以完整两项相加。缺项、负数、非整数、字符串或总和冲突保持`pending_usage`，保留已有视频，不从总量减输出推算输入。画布仅在中间件标记`usage_available`且用量校验通过时结算；失败退款须无用量且明确标记`not_billable`，未知状态不推断免费。余额不足进入`pending_balance`，补扣重试使用持久化用量，不重复生成或重复扣费。配套0.2.0插件的画布与中间件契约已部署，真实渠道计价仍待验证。

`POST /api/v1/model-gateway/media`接收multipart的`file`字段，返回临时签名`url/expiresAt`，不创建账号素材条目。公开读取`GET/HEAD /api/model-gateway/media/:id/content?token=...`须有效文件专用签名，不能用登录Token替代。生成结果内容`GET /api/v1/videos/:id/content`按账号鉴权代理，遵循现有公网地址访问限制。

当前源码将四个Seedance模型收窄为特殊分组，每个模型仅接受`resolution: "720p"`、`ratio: "9:16"`（720×1280），并保留各自Token单价、时长和素材数量上限。中间件配置保存、业务目录读取和任务提交均校验该限制；已发布无效能力会阻止目录同步，需管理员重新保存后再由画布同步发布。配套插件为0.2.2，本轮固定规格与模型弹窗修改尚未构建或部署，不属于上面的历史部署记录。

### P5 多规格公开目录与真实路由

- 公开模型增加`variants[]`，每项为`{id,name,referenceModes,generateAudio?,capabilities,pricing}`。referenceModes为空表示不限制，支持text/image/video/audio；同时有多类素材时video优先、其次image、audio。generateAudio省略为不限制，布尔值为固定条件。参数必须匹配唯一规格，重叠条件不发布。
- capabilities含该规格的分辨率、比例、整数时长区间、参考图片/视频/音频及合计上限、首尾帧、纯音频参考支持，`watermark:false`表示不接受水印。模型顶层能力仅供聚合概览，不代表可以任意组合所有选项；提交必须使用规格能力。
- `pricing.unit=token/second/call`，`per=1000000/1/1`，原价以CNY整数分存储。Token沿用总量或输入/输出四档字段；秒/次使用各分辨率有/无参考视频的withoutVideoCents/withVideoCents，并声明quantitySource。
- 多规格公开`sale.unit="variants"`、`sale.variants=[{id,sale}]`；每个子sale含自己的unit和tiers。秒/次售价为`withoutVideoCredits/withVideoCredits`，Token仍使用*CreditsPerMillion字段。固定售价策略按variantId+resolution配置；`modelCosts.gateway`携带完整公开目录和售价，具体预扣使用quote结果。
- 中间件管理员保存`routes:[{variantId,channelId,upstreamModel,adapter}]`；这些私有字段和密钥不在业务`/v1/models`或画布公开配置下发。能力/价格/路由变更须新revision，画布同步新版本后须重新核对发布；旧任务保留已解析的渠道、上游ID和计费快照。
- 当前支持原四模型专用插件、Seedance原生任务协议与NewToken第三方`/v1/videos`按秒协议。第三方协议使用reference_*与ratio，每个规格只允许一个720p/1080p、4～15秒和文档比例，固定生成音频条件且不开放水印；不等同于官方extra_*混合计费协议。新协议需单独开发和部署，同协议新增规格在后台即可完成。

本轮P5协议扩展正在集中验证，真实渠道用量/计价和实际输出尚待联调；不以文档或源码完成代替验收通过。

独立中间件自身契约、服务认证、管理端口和插件原生路由见[gateway/README](../../gateway/README.md)。任务最终Token只来自生成任务响应，不查询供应商消费账单。
