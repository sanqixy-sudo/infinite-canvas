---
title: 数据库说明
description: 当前后端主要数据表与字段说明
---

# 数据库说明

本文档只记录后端当前已经使用的主要数据表。

账号文件删除本轮在 `storage_objects` 新增 `delete_completed_at` 字段，不新增表：`deleted_at` 表示删除中，物理删除成功后写入完成墓碑，保留 ID 与公开地址以拒绝旧引用。工作区实现的迁移、删除失败重试及容量统计仍待本轮验证；下方既有部署记录不代表该字段已上线。

后续首页/登录排版 `697ca4b`、`016f30f81e8a0aae62ef86b1866bb0b0485f7f381` 只涉及页面与私有 CSS，无数据库、后端逻辑或迁移变化；697 独立类型顺序重跑和 697/016 完整构建、016 多尺寸界面检查通过，不重记为 Go/38 项回归重新执行。016 的 `backups/pre-layout-016f30f/` 数据备份与部署核对保留阶段历史。

四段演示阶段曾部署 `2d9910e075cf36fa2d3d438b984e27493f47dedc`，最终独立类型、完整构建和普通播放检查通过；只新增前端播放器和静态 MP4/JPG，不进入账号存储索引、用户素材或配额，不新增表。私有备份 `backups/pre-showcase-2d9910e/` 含完整性 `ok` 的SQLite在线副本、Compose/`.env`、媒体归档和原行摘要，目录700/文件600。停旧应用与新启动后8表结构及全行SHA256一致、完整性ok，`users/canvas_projects/settings`各1，其他 `credit_logs/storage_objects/user_configs/purchase_orders/storage_upload_reservations` 共5表均0；这是当时快照，不作为当前用户和文件数量。原data挂载及浏览器原档仍须保留。

当前公开首页、登录门禁、品牌与旧画布恢复改造不新增数据库表、列或迁移，沿用现有用户鉴权和 `canvas_projects`。会话版本与只读媒体 Cookie 不作为数据库新增字段；浏览器画布改用 `infinite-canvas:canvas_store:user:<userId>` 分区，原全局键只读保留，明确选择恢复时创建新画布 ID 并沿用既有保存 API。浏览器恢复不是服务器文件所有权迁移，`storage_objects` 归属与权限不变。新访问策略要求登录，但仍保留历史访客文件及登录后的当前浏览器存储。功能 `1141512`、Go 格式 `ff99112` 的 Go 全量、独立类型及合计 38 项前端回归通过，后续 `fca04ad` 完整 Docker 构建退出 0；隔离 HTTP 已验证媒体读写和账号权限，浏览器已验证旧项目按选择恢复新 ID。

fca 阶段曾部署 `fca04adc3709c4bdede7d7ea47b11313bdeb8ceb6`，此处保留历史证据。`backups/pre-landing-fca04ad/` 保存完整性 `ok` 的 SQLite 在线备份、配置与媒体；停旧 app 后、新 app 启动后、匿名 HTTP 检查后，8 表结构与全部行 SHA256 均和备份一致：`users/canvas_projects/settings` 各 1，`credit_logs/storage_objects/user_configs/purchase_orders/storage_upload_reservations` 均 0，实际站点未新增验收账户或素材。原数据挂载保留；浏览器原档不包含于服务器备份，仍须独立保留。详细验证范围和备份绝对路径见待测试与维护手册，下方旧部署记录保留为历史。

钱包相关表和字段已在数据库副本中验证并部署测试站点，原数据保留；自动测试、隔离 HTTP 与浏览器结果见 [待测试](../progress/pending-test.md#用户钱包个人存储额度与人工套餐确认)。真实收款和 R2 仍待资源联调。

上一轮个人存储设置与单条账号素材接口复用 `user_configs` JSON，不新增表或列；`f9538f9` 的 Go 全套、独立 TypeScript、20 项回归、完整 Docker、隔离 HTTP 及桌面图片/390px 菜单检查通过，已升级测试站。升级前在线备份，升级后完整性 `ok`；用户、画布、流水、文件索引、用户配置、订单、上传预留、设置共 8 表原行摘要完全一致，数量分别为 `1/1/0/0/0/0/0/1`，实际库未写入验收数据。真实旧浏览器、视频/音频实机、供应商及 R2 仍待验收或联调，具体记录见待测试。

本轮素材多级目录与标签整理继续复用 `user_configs.asset_data` JSON，不新增数据库表、列或迁移；新增 `folders[]` 和素材 `folderIds` 的契约见下文。Go 全量（含目录并发及删除保留文件）、`1115c6f` 独立 TypeScript 与 32 项 Bun 回归、`86b07b0` 完整 Docker 构建、隔离 HTTP 和浏览器检查通过。隔离数据验证跨用户/无效批量原子拒绝、标签与旧快照并发不覆盖、删目录保留素材/文件索引及 232 B 占用。测试站已升级 `86b07b0`；升级前在线备份后，停应用及新容器启动时的 8 表结构和全部行 SHA256 与备份完全一致，完整性 `ok`，`users/canvas_projects/settings` 各 1，其他 5 表为 0。备份位置与范围见维护手册；历史 `f9538f9` 记录不替代本轮结果。

## 数据库

### 短剧制作计划（集中检查通过，已部署）

制作计划使用下列5张表；P2任务、P3合成与P4审片另见下方新增表，均注册AutoMigrate。快照`70c8270ac599`的Go全量、隔离HTTP及生产镜像构建通过；追加空队列查询改用`Find`的定向ProductionRender Go检查通过，两个最终镜像再次构建并部署`production-0df20ae25d24`。部署备份为`/opt/xiaomeng-video-workbench-deploy/backups/pre-production-20261023-133141`，画布线上41张表，两个数据库完整性均`ok`，`changed_existing_tables=[]`、`changed_existing_media=[]`；原`canvas_projects`数据不迁移、不重写。团队空列表分页仅有界面修正，待最终镜像复核，不增加数据库字段。详细证据及仍待真实渠道/R2验收范围见[待测试](../progress/pending-test.md#本轮集中验证短剧制作与多渠道)。

| 表 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `production_projects` | `id`、`user_id`、`workspace_id`、`title`、`synopsis`、`style_guide`、`revision`、`created_at`、`updated_at` | `id`主键；`user_id + workspace_id`唯一；workspace必须为当前账号现存根画布；revision从1开始 |
| `production_episodes` | `project_id`、`id`、`title`、`script`、`order`、`delivery` | `project_id + id`复合主键；剧本长文本，最多100000字；delivery为可选JSON，保存本集音轨及字幕编辑 |
| `production_scenes` | `project_id`、`id`、`episode_id`、`title`、`description`、`order` | 同一计划内关联分集 |
| `production_assets` | `project_id`、`id`、`kind`、`title`、`description`、`variant_of`、`node_references` | kind为character/scene/prop/voice/style；变体同类型且无循环；JSON引用数组`[{canvasId,nodeId}]`，最多50条 |
| `production_shots` | `project_id`、`id`、`episode_id`、`scene_id`、`order`、`title`、`description`、`dialogue`、`camera`、`seconds`、`asset_ids`、`canvas_id`、`text_node_id`、`image_node_id`、`video_node_id`、`status` | 同一计划内关联分集/场次/资产；asset_ids为JSON数组；seconds为1～86400整数；status为draft/ready，表示规划状态 |

四张子表均使用`project_id + id`复合主键，完整文档保存以revision做CAS：用户行锁→计划行锁→读取引用画布→业务校验→更新计划并重写子表，同一事务失败全部回滚。业务层验证子表关联，未依赖数据库级外键。查询通过主表账号归属取子记录，用户ID不从客户端文档采信。

`production_shots`另有`candidates` JSON、`selected_image_candidate_id`、`selected_video_candidate_id`。候选为`{id,title,kind,canvasId,nodeId,storageKey,content}`，每镜最多20、整计划1000；id在计划内唯一，同镜头不重复引用同一节点。storageKey存在时content空，否则仅HTTP/HTTPS直链；事务校验身份与图片/视频类型，采用ID须属于本镜同类型候选。候选结果为独立画布节点，文件仍复用原存储对象。

`production_episodes.delivery`为`{originalGain,burnSubtitles,audioTracks,subtitles}`：originalGain为0～1，默认未配置时原声为1；audioTracks最多64项，每项为`{id,shotId,storageKey,label,startSeconds,trimStartSeconds,durationSeconds,gain}`，仅允许本人账号音频文件且单文件不超过64MiB，时间为有限非负秒数，使用时长为正，片中结束不超过300秒，源截取结束不超过3600秒，gain为0～1。subtitles最多500项，每项为`{id,shotId,startSeconds,endSeconds,text}`，结束须晚于开始且不超过300秒，text为非空最多500字。轨道/字幕ID在本集内唯一，非空shotId须属于本集。保存时与账号文件/计划同事务校验；已保存音轨引用阻止文件物理删除，移除引用不会删除文件。提交成片时进一步核对实际分集总长及源文件实际时长，冻结全部delivery内容。

`video_tasks`增加`canvas_id`索引及`retry_of/attempt`，普通请求、工作流和网关创建时记录明确画布归属；重试链由服务端写入。P2增加独立生产历史，原短期任务清理不删除它，不猜测回填更早任务。

| 表 | 关键字段 | 用途 |
| --- | --- | --- |
| `production_task_records` | `record_id`主键、`id/user_id/kind/canvas_id/node_id/model/status/progress/dispatch_status/billing_status/billing_unit/gateway/retry_of/attempt`、预扣/实扣/退回/净额/结算、三种Token实际数量、`actual_units`、时间 | record_id按账号+任务类型+原ID生成；kind含image/video/audio；金额、Token及实际秒/次可空，不用缺失值伪装0 |
| `production_task_links` | `record_id/project_id/shot_id`复合主键、`user_id/workspace_id/episode_id/shot_title` | 第一次提交时冻结已保存镜头归属；改名、解绑或原任务清理不改历史 |
| `production_render_jobs` | `id`主键、`user_id/request_id`唯一、`request_hash/workspace_id/episode_id/episode_title/revision/status/progress/seconds/shot_count/attempts/error/snapshot_json/provider_id/worker_id/output_storage_key/output_bytes`、时间 | 冻结成片计划与素材；不向用户返回私有快照/worker/存储配置；请求去重和取消墓碑持久化 |
| `production_render_leases` | `id`主键、`worker_id/expires_at` | 全局renderer执行租约，跨实例只允许一个有效合成worker，过期后中断任务标失败等待人工重试 |
| `production_render_uploads` | `id`主键（本次worker ID）、`job_id/user_id`索引、`provider_id/provider_identity/object_key/reservation_id/state/next_check_at` | 物理上传前记录意图；存储身份为配置标识哈希，next_check_at索引用于恢复清理；state为pending/cleaning/cleaned，已清理墓碑仍保留以处理迟到上传 |

生产成本读取`credit_logs`；普通图/视频/逐镜配音使用`image:<id>` / `video:<id>` / `audio:<id>`区分关联，网关使用原稳定ID。明确0价格写0流水，缺流水为未知；既有关联生产账本记录禁止经通用仓储改写/删除或伪造追加。相同任务多镜头关联在分集总额只计一次，镜头明细可重复引用。历史不是完整账号总账，不含未绑定、旧任务或文字拆镜调用。

逐镜配音沿用`canvas_audio_tasks`，仅`production_voice_*`任务接入生产历史；`source_id`为workspaceId、`node_id`为shotId，创建时在用户锁内验证计划和镜头归属。生产记录的音频`canvas_id`保存该workspaceId，不能作为原图/视频的画布节点链接使用。清理短期音频行不删除历史；同账号已有历史任务ID不能再创建并收费，跨账号不覆盖历史。

渲染创建及完成沿用用户/文件锁和容量预留；完成须同时匹配job的worker、有效租约及同次上传意图，再原子创建账号文件索引、提交存储用量、删除上传意图并标记任务完成。重试输出对象键含worker ID，旧执行只能清理自己的输出。queued/running快照内的clips与delivery.audioTracks的storageKey阻止文件删除；终态解除该任务的输入保护，但已保存delivery等其他引用仍生效。成片自身沿用普通账号文件引用和空间规则。取消未知提交先创建同requestId墓碑，晚到POST不能再入队。

上传意图清理每分钟扫描到期记录（每批最多25条），跳过仍有有效执行租约的任务；发现对应存储索引时仅删除意图，不删除文件。无索引且存储身份匹配的对象可清理并释放预留，墓碑每小时复查以处理迟到写入。身份包含provider ID、类型、endpoint、bucket及本地存储根目录；配置身份不匹配时保留记录。未索引对象不会恢复成虚假完成状态，用户按原快照重试。P3已通过集中Go检查与实际FFmpeg中文字幕双音轨样例；真实R2和强杀恢复场景仍待验收。

画布删除复用同一用户行锁，事务内查计划根画布、镜头绑定、候选及资产参考；任何引用命中都拒绝整批删除。删除制作计划也校验revision，只清理本计划四子表与主表，不删除画布或素材文件；活跃团队共享计划阻止删除。内部节点删除、清空或改类型前显示镜头/候选/资产引用，账号画布保存时再次校验，防止另一窗口绕过保护；相关拒绝路径已纳入隔离HTTP检查。

计划和候选本身不复制媒体；合成完成才创建新账号文件索引并占空间。浏览器未保存计划、AI拆镜草案、重试请求ID和未知成片提交使用localforage按账号/项目隔离，不写localStorage。限额及使用路径见[开发路线](../plans/short-drama-production.md)。

### 团队协作与审批（工作区实现，待验收）

| 表 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `teams` | `id/name/owner_id/created_at/deleted_at` | 团队协作空间，删除为逻辑撤销；所有权转移仅改变团队管理权 |
| `team_members` | `team_id/user_id`复合主键、`role/can_view_costs/joined_at` | owner/admin/member；can_view_costs控制普通成员成本可见性；display_name为只读联表字段，不建列、不带用户余额 |
| `team_invites` | `id/team_id/code_hash/created_by/expires_at/used_at/revoked_at/created_at` | code_hash唯一；随机邀请码仅存SHA256，24小时单次有效 |
| `production_reviews` | `id/team_id/publisher_id/workspace_id/title/source_revision/snapshot/media_object_ids/created_at/revoked_at` | 服务端由本人已保存计划构造冻结快照；私有JSON含媒体映射，仅输出白名单字段；media_object_ids为JSON数组用于文件删除保护 |
| `production_review_comments` | `id/review_id/shot_id/author_id/body/created_at` | 意见绑定冻结版本的镜头，author_name仅只读联表字段；正文最多2000字 |
| `team_projects` | `id/team_id/owner_user_id/workspace_id/title/edit_allowed/created_at/revoked_at` | 原拥有者明确共享单份已保存制作计划；workspace_id不下发。正文沿用production表与revision CAS，不复制私有canvas/候选 |
| `team_assets` | `id/team_id/owner_user_id/object_id/title/kind/created_at/revoked_at` | 图片/视频/音频的明确共享授权；object_id不下发，文件所有权与个人占额不变；活跃授权参与删除保护 |
| `team_audits` | `id/team_id/actor_id/action/target_id/summary/created_at` | 团队关键业务写入同事务记录，owner/admin分页可见；不保存供应商Key或媒体签名URL |
| `team_generation_budgets` | `project_id`主键、`limit_credits/held_credits/spent_credits` | 仅该共享项目审批入口的预算，金额decimal(20,2)；不是共享钱包，不为普通个人画布生成归集 |
| `team_generation_approvals` | `id/project_id/team_id/requester_id/payer_id/shot_id/shot_title/canvas_id/node_id/model/revision/prompt/parameters/asset_ids/request_hash/prepared_request/state/reason/task_id/reserved_credits/accounted_hold/actual_credits/created_at/updated_at` | 请求ID由用户/项目/申请号确定；冻结模型版本、镜头和私有请求。金额仅授权DTO返回；payer/canvas/node/hash/prepared_request始终不下发成员 |

团队写入统一锁team行，涉及个人资源再锁原拥有者user行及对应计划/文件。计划协作采用相同production revision CAS，仅更新共享文本白名单，保留原私人绑定、候选和交付字段。文件删除同样锁文件所有者并检查未撤销审片和team_assets；个人制作计划删除检查活跃team_projects。移除成员同事务撤销其项目、素材、审片和未使用邀请；删除团队撤销全部授权。媒体每次按当前成员/素材拥有者成员/未撤销授权验证后读取原账号文件，不生成跨权限长期URL。

只读审片快照默认不包含整集剧本；独立的项目共享才授权制作文本协作。team_members.can_view_costs与角色在每次请求内核验，不授予私人canvas、未共享文件或钱包读取权。团队所有权转移不更新team_projects.owner_user_id、文件CreatedBy或已受理任务付款者。撤权后拒绝新读取，已下载或已获准开始的媒体流不可回收。

生成审批状态为`pending`，可转为`reject/withdraw`；确认报价后进入`running`，随任务结算转为`settled/released/pending_balance`。`video_tasks.team_approval_id`保存私有关联；审批预算占用、个人余额预扣、credit_logs、video_tasks、持久生产历史及canvas_projects对应视频节点任务metadata在同一事务内写入。重复受理不重复扣费或写节点，节点异常会整体回滚。

结算在团队→付款者锁顺序内以原快照退补；`accounted_hold`用于幂等调整预算占用，终态仅一次计入spent。待补扣保留实际欠费占用，新增批准继续受预算与余额检查。实际费用可以超过预扣或预算，因此预算不是硬封顶；个人画布自行发起的任务不进入这些预算表。撤销成员/共享不删除已经发生的任务和费用。普通用户响应从未包含prepared_request或供应商认证信息。

### Seedance 模型中间件与 Token 账务

画布沿用`settings`、`video_tasks`、`credit_logs`、`users`，不新增画布账务表。`settings.private.gateway`保存连接配置、服务器密钥、同步目录和零售价策略；通用设置保存保留该配置，专用后台接口负责修改。对外配置隐藏密钥。

`video_tasks`网关字段包括`gateway_snapshot`（仅服务端，含接入与价格快照）、`gateway_request_hash`、`billing_status`、`reserved_credits`、`settled_credits`、`actual_tokens`。分项计费使用可空整数`actual_input_tokens`、`actual_output_tokens`：NULL表示未取得对应真实用量，0表示实际为零，不能互换。P5增加`billing_unit`（token/second/call）和可空整数`actual_units`（实际计费秒/成功次数）；没有数量不得推断为0。金额沿用decimal(20,2)。预扣和差额流水沿用ai_consume/ai_refund，related_id绑定同一任务；`reserved/pending_usage/pending_balance/settled/released`区分账务状态。网关任务不参与普通任务定时删除；账号存在未结算任务时阻止硬删除。

`gateway_snapshot`锁定`tokenMode`、总量或输入/输出两项单价和预扣数量。`total_tokens`按总量一次计价；`input_output_tokens`按输入数量×输入单价加输出数量×输出单价计算，先用十进制有理数合计，再统一half-up到0.01算力；不能分别舍入两项后相加。配置改价不重写已提交任务快照，余额不足重试使用持久化的实际分项用量与原单价。分项缺失或不一致保持待结算，不以总量减输出推算输入。

P5快照另锁定`unit/quantitySource/variantId/reserveUnits`：按秒由已确认规则采用请求整数时长或响应整数时长；按次采用`successful_task`，成功计1次。所选规格、数量来源及单价跟随任务冻结；配置变更不能重解释在途任务的计费单位或实际数量。

`settings.private.gateway.catalog[].pricing`包含`tokenMode`和`reserveInputTokens/reserveOutputTokens`；每个`tiers[]`按分辨率保存有/无参考视频各自的输入/输出价格，CNY/百万Token以整数分保存。平台`models[].tiers`保存对应算力/百万Token固定售价，或由原价、倍率与每元算力生成。参考视频档位与输入/输出是独立维度。

P5公开目录增加`variants[]`，每项含`id/name/referenceModes/generateAudio/capabilities/pricing`；`pricing.unit`为token/second/call，`per`分别为1000000或1，按秒/次价格为整数分/单位。平台固定售价档位以`variantId + resolution`定位，秒/次使用`withoutVideoCredits/withVideoCredits`；公开`sale.variants[]`保存各规格售价，`modelCosts.gateway`携带同一公开目录以便预览与报价核对。私有中间件`model_records.config_json`保存`routes[]`的`variantId/channelId/upstreamModel/adapter`，不向画布用户公开；没有新增模型规格关系表。新版本能力、价格、路由使用新revision，旧任务保存解析后的单一真实路由快照。

独立中间件SQLite文件`/data/model-gateway.db`包含：`channels`（地址、路径、AES-GCM加密Key、启停）、`model_records`（模型/渠道ID、能力/价格JSON、启停）、`tasks`（唯一request_id、请求哈希、模型/渠道快照、上游任务ID、状态、实际Token、下次轮询时间）。`tasks.input_tokens/output_tokens`为可空整数，区分缺失和零；真实分项完整而上游未提供总数时可相加存入`total_tokens`，提供总数则必须一致。P5增加可空整数`tasks.units`，仅保存该任务冻结规则下的实际秒/次；缺失保持待核对，不能拿Token值替代。命名卷持久化；加密Key须随私有配置备份，不能丢弃或提交到Git。详见[gateway说明](../../gateway/README.md)。本轮P5已通过集中自动检查并部署`production-0df20ae25d24`，渠道数量为0，真实渠道计价尚未联调。

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
- `production_projects`
- `production_episodes`
- `production_scenes`
- `production_assets`
- `production_shots`
- `production_task_records`
- `production_task_links`
- `production_render_jobs`
- `production_render_leases`
- `production_render_uploads`
- `teams`
- `team_members`
- `team_invites`
- `team_projects`
- `team_assets`
- `team_audits`
- `team_generation_budgets`
- `team_generation_approvals`
- `production_reviews`
- `production_review_comments`

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
| `asset_data` | text | 账号素材库 JSON，包含 `assets`、`folders` 及已有分类等扩展字段；素材使用 `folderIds` 多归属，保留历史数据 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

`storage_provider.s3` 保存 Endpoint、Region、Bucket、Access Key、Secret、公开域名和路径前缀；`storage_provider.webdav` 保存 WebDAV 地址、远程目录、用户名和密码/应用密码。自动同步开关不重复写入 Provider；后端下载和删除旧媒体时仍会读取已保存但已停用的 Provider。

`model_config.autoSaveAssetsToCloud` 是个人默认保存偏好，缺省为 `false`，独立 `storage-preferences` API 只原子合并这一字段；模型配置整份保存保留数据库最新值。用户配置更新在同一用户锁内补丁写入变化的字段，存储配置和历史记录更新不能回写旧整行快照覆盖偏好或素材列表。

账号素材用单条 API 在事务中合并 `asset_data`；媒体项新增/修改必须引用该用户拥有的 `storage_objects`，类型及字节数取文件索引，同 ID 和同文件键去重。旧本地引用、已有条目和 JSON 扩展字段不批量删除；旧整份列表覆盖接口停用。删除素材条目不删除 `storage_objects` 或物理文件，也不直接释放额度，以免损坏仍被画布或历史记录引用的文件。

`asset_data.folders[]` 使用 `{ id, name, parentId, createdAt, updatedAt }`，根目录 `parentId=""`；每账号最多 1000 个目录、8 层，目录名最多 80 字且同级不重名。`assets[].folderIds` 是本账号目录 ID 数组，每素材最多 32 个，可同时归入多个目录而不复制文件；`category` 与最多 50 个、每个最多 80 字的 `tags` 继续保留。无目录时读取返回 `folders: []`，不需要清库或建表。

目录保存/移动/删除与批量组织复用用户锁内 `PatchUserConfig` 事务，并保留顶层 JSON、目录未知扩展和未改动素材字段。已有条目的 `tags/folderIds` 以数据库最新值为准，普通单条整份保存、同文件重试不能撤销组织结果；只有组织 API 可显式修改，单次最多 200 个素材，新增/替换归属输入最多 32 个，移除输入最多 1000 个而最终单素材归属仍最多 32 个，目标无效或超限时整批回滚。删除目录递归移除其目录记录和相应归属，不删除素材、`storage_objects` 或实际媒体文件，也不因此释放配额。

浏览器目录使用同一数据结构，但与账号目录分别保存在前端 `localFoldersByOwner` 的 localforage 分区，不写进其他账号的 JSON。素材包导入重建目录、素材与浏览器文件 ID；不得把包内原账号 `server:` 文件键直接插入新账号。只有包装层导致目录数或深度超限时省略包装保留有效原树；目标父级容不下原树则提示选根目录，校验失败不部分写入元数据。隔离浏览器实测导出 2 素材、5 目录和 1 份真实 SVG，导入当前浏览器后含包装层共 6 目录，账号列表不变，刷新后 Blob 图片仍可读。备份和回滚除数据库、媒体外还需保留浏览器分区；旧程序整份保存丢失目录或覆盖标签的风险须先评估。实际站点原数据已确认保留，用户真实旧浏览器数据及 R2 等场景仍待验收。

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
| `deleted_at` | string | 删除中时间；空值表示可用，写入后拒绝新引用与读取，物理删除失败仍保留此标记供重试 |
| `delete_completed_at` | string | 新增删除完成时间及普通索引；物理删除和引用清理成功后写入，保留墓碑索引以拒绝旧 `server:`/公开地址引用，不向普通文件响应输出该字段 |

个人占用按 `created_by` 汇总本表中未完成删除的字节数，合并服务器本地、R2 和其他已有 Provider，不按当前默认模式分开计数；删除中仍占额度，完成墓碑排除于个人/平台容量和普通文件列表。同一个实际对象保存为不同用户副本时分别计入各自额度。未建立索引的外部桶对象和浏览器本地素材不包含在此统计中。平台存储总容量上限仍是另一层约束，不能把默认 9 GiB 的平台上限当作每人的免费额度。

删除先在事务锁内核实引用并提交删除中标记，再执行实际存储删除，成功后事务清理经确认的本人素材条目/已完成任务输出链接并写完成墓碑；失败不提前释放额度。画布、历史、活动任务、其他账号及公共素材等硬引用会阻止删除。引用写入使用同文件对象锁并校验未删除，媒体 URL 精确匹配 ID 或公开地址，不能靠模糊字符串清理。仅删除素材库条目仍不删除文件或释放容量。

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
| `gateway_snapshot` | text | 仅服务端的网关连接、请求及锁定计费快照，不随响应下发 |
| `gateway_request_hash` | string | 网关请求内容摘要，重复ID不能提交不同内容 |
| `billing_status` | string | 网关预扣、待用量、待补扣、已结算或已释放状态 |
| `billing_unit` | string | 网关冻结计费单位：token/second/call |
| `reserved_credits` | decimal(20,2) | 网关任务实际预扣金额 |
| `settled_credits` | decimal(20,2) | 网关任务按实际用量结算金额 |
| `actual_tokens` | int64 | 网关任务实际总Token；分项模式为完整两项之和 |
| `actual_input_tokens` | nullable int64 | 实际输入Token；NULL为缺失，0为实际零 |
| `actual_output_tokens` | nullable int64 | 实际输出Token；NULL为缺失，0为实际零 |
| `actual_units` | nullable int64 | 秒/次规则的实际计费数量；NULL表示缺失，不能按0结算 |
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
| `credits` | number | 普通渠道图片每张、视频每秒、文本和音频每次调用的算力点，工作流按次；视频小数秒向上取整，智能时长 `-1` 按15秒。网关`billingUnit=token`时为各档预扣额的最大值，仅用于概览，不能乘时长；生成使用专用报价 |
| `billingUnit` | string | 网关为`token`，普通渠道沿用既有计价单位 |
| `tokenMode` | string | 网关为`total_tokens`或`input_output_tokens` |
| `reserveCredits` | number | 网关已发布各分辨率/参考视频档位的最大预扣概览，不是最终费用 |
| `reserveTokens` | integer | 总量模式的预扣Token；分项模式不使用 |
| `reserveInputTokens` / `reserveOutputTokens` | integer | 分项模式分别预扣的输入/输出数量；可单项为0，合计必须为正 |
| `tiers` | object[] | 按`resolution`列出的算力/百万Token售价：总量用`withoutVideoCreditsPerMillion/withVideoCreditsPerMillion`；分项用`withoutVideoInputCreditsPerMillion/withoutVideoOutputCreditsPerMillion/withVideoInputCreditsPerMillion/withVideoOutputCreditsPerMillion` |

网关同一任务只使用当前`tokenMode`对应的价格与数量，不把总量与分项费用相加。公开配置只包含能力、已发布价格与备注，管理员Key仍只在服务端；具体参数的预扣金额由报价接口返回。

普通渠道`credits`仍最多两位小数，未配置拒绝调用、显式0才免费；这项既有规则不等同于网关分项用量为0，后者表示实际消耗为零，配置单价仍须有效。

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
