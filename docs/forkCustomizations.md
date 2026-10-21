# 二开功能保护清单

本文件记录 `my-version` 上必须在上游更新后继续成立的自定义行为。开始开发功能前先登记，功能提交后补齐实际文件、提交 SHA 和验证结果。不要记录密码、Token、API Key 或真实用户数据。

## 初始基线

- 官方仓库：`tigerowo/infinite-canvas`
- 官方分支：`main`
- 初始官方提交：`ccda172efba25cbee990a785bba715b90cc42b95`
- 初始项目版本：`v0.8.1`，该提交还包含 `CHANGELOG.md` 的 `Unreleased` 内容。
- 二开主分支：`my-version`，从上述提交创建。
- 初始二开功能：**无**。初始 `my-version` 与官方提交内容一致；后续定制从独立 `feature/` 分支登记，完成审查后进入 `my-version`。

## 功能索引

| 功能 | 状态 | 主要代码位置 | 首次提交 | 更新验证 |
| --- | --- | --- | --- | --- |
| 小盟视频工作台品牌与入口 | 部分验证 | `web/src/app/`、`web/src/components/layout/` | `2f23672bbbde1a0aba00ac903bd13a97443ccf36` | 页面品牌、宣传轮播、版本与入口、许可页面 |
| 管理员调点事务保护 | 待验证 | `repository/user.go`、`service/auth.go` | `2f23672bbbde1a0aba00ac903bd13a97443ccf36` | 余额与流水原子性 |
| 内置模型价格显式配置 | 待验证 | `service/settings.go`、`service/workflow_agent.go`、管理后台设置页 | `2f23672bbbde1a0aba00ac903bd13a97443ccf36` | 未配置拒绝、显式零价可用 |
| 模型清单与扣返保护 | 部分验证 | `service/settings.go`、`handler/ai.go`、`handler/video_task.go`、`repository/user.go` | `09d3959` | 模型开放清单、视频时长、失败返还 |
| R2 配置防误用 | 待真实存储桶验证 | `service/storage.go`、管理后台设置页 | `09d3959` | 配置身份、Endpoint、已保存配置容量统计 |
| 项目内多画布与首页工作台 | 部分验证 | `web/src/app/(user)/canvas/`、`web/src/app/(user)/page.tsx` | `b5519c011988ea62894883a71518f04526ac7449` | 旧画布、项目归属、同步与删除 |

### 功能名称：项目内多画布与首页工作台

- 状态与目的：部分验证；首页改为项目优先的工作台，一个项目包含多张可独立编辑的画布。视觉参考用户提供的层级示意，未照搬布局、素材或内容。
- 对应代码位置及涉及文件：`web/src/app/(user)/page.tsx`、`web/src/app/(user)/canvas/page.tsx`、`web/src/app/(user)/canvas/project/[id]/page.tsx`、`web/src/app/(user)/canvas/stores/use-canvas-store.ts`、`web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`、`web/src/app/(user)/canvas/components/`、`web/src/components/layout/app-top-nav.tsx`。
- 官方原版行为与二开差异：原版画布列表为平铺单层；二开版以现有画布作为项目首张画布，通过 `workspaceId` 将新增画布归到同项目，并用 `workspaceTitle` 独立记录项目名称。旧画布没有这些字段时仍作为单画布项目显示。
- 关键依赖：Zustand 画布 store、localforage、现有画布同步 API 与压缩包导入导出。沿用 `infinite-canvas:canvas_store` 键和原画布 ID。
- 数据库变化：无；附加字段保存在既有画布 JSON 中，不执行表迁移或历史数据搬移。
- API 变化：无；现有画布保存、同步和删除接口继续传完整 JSON。
- Git 提交与关联 PR：`b5519c011988ea62894883a71518f04526ac7449`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)。
- **必须保护的行为**：旧画布可见可编辑；同项目新增画布继承归属；项目重命名不改画布内容；导出项目包含全部画布，导入时恢复归属；删除项目明确告知画布数量并一次删除同项目画布；前端与账号同步保留画布新增字段。
- 上游同文件或同链路改动的兼容要求：检查 `CanvasProject` 序列化、导入导出、远程同步、编辑器新建和删除入口；不得把 `workspaceId` 或 `workspaceTitle` 静默丢弃。
- 更新后验证方法与最近验证结果：提交 `b5519c0` 的 Docker 构建和 Next.js/TypeScript 检查通过；隔离预览中实测新建项目、添加第二张画布、打开编辑器，项目列表仍显示 2 张画布。测试服务器更新后数据库完整性为 `ok`，原有 1 张无 `workspaceId` 的画布记录仍在。含旧画布的实际账号界面、跨设备同步、导入导出和删除仍需人工确认。
- 数据备份或回滚要求：部署前保留服务器数据库和浏览器数据备份；回滚代码时旧画布字段仍可被原实现作为额外 JSON 字段保留，不清理画布数据。

### 功能名称：小盟视频工作台品牌与入口

- 状态与目的：部分验证；把面向用户的产品名称改为“小盟视频工作台”，首页新增“小盟万能视频工作台”中英文标题，移除顶部 GitHub 图标、版本展示、原项目公告、许可与源码入口、首页官方宣传轮播、404 页面推广公告及登录页冗余说明。
- 对应代码位置及涉及文件：`web/src/app/layout.tsx`、`web/src/app/(user)/page.tsx`、`web/src/app/(user)/login/page.tsx`、`web/src/app/not-found.tsx`、用户与管理后台页面、`web/src/components/layout/app-top-nav.tsx`、`web/src/components/layout/user-status-actions.tsx`、`web/src/app/(user)/legal/page.tsx`；已删除仅供首页轮播使用的 `web/src/app/(user)/home-banner-carousel.tsx` 和仅供 404 页面使用的 `web/src/components/layout/announcement-banner.tsx`；画布默认名称及导出文件名只改展示文案。
- 官方原版行为与二开差异：官方页面展示“无限画布”、GitHub 入口、官方版本弹窗和指向外部推广页面的静态轮播；二开版使用小盟品牌，移除该轮播及推广链接。用户明确要求隐藏网站导航中的许可与源码入口；`/legal` 页面和仓库许可证仍保留，商业授权资料尚未独立核验。
- 关键依赖：Next.js App Router、用户/画布布局、浏览器本地存储。不得批量改动 `infinite-canvas` 本地存储键，否则既有浏览器数据会失联。
- 数据库变化：无。
- API 变化：无。
- Git 提交与关联 PR：`2f23672bbbde1a0aba00ac903bd13a97443ccf36`、`24f4b288cc77acb180a93eb50346678e75cae97f`、`dfc6ac6109b4486fb2c3d1460f0ebd22d13499dc`、`fd4db1668bc16eb3ccb1da83f42349ea008434a2`、`fc4c355bb024b0373474646a63f7ff1462c833e5`、`9dbdeabbc26e245fb68f38511a0d331f2435097e`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)。
- **必须保护的行为**：登录页、用户页、画布列表、管理后台和浏览器标题显示小盟品牌；首页展示指定的中英文标题；原有画布仍能读取；顶栏不展示 GitHub 图标、官方版本号、官方公告或许可与源码入口；首页不加载官方宣传轮播及外部推广链接；404 页面不展示 TokenDance 等推广公告；登录页不展示登录方式说明文字。
- 上游同文件或同链路改动的兼容要求：检查导航、账户操作区、首页、登录页、404 页面、画布工具栏及本地存储键；不要重新引入官方版本检查入口、宣传轮播、推广公告、外部推广链接或已移除的文案。
- 更新后验证方法与最近验证结果：测试服务器提交 `9dbdeab` 的 Docker 构建成功；首页返回 200，创作输入区和中英文标题存在；不存在的路径返回 404，页面内容不含 TokenDance 等推广公告；登录页、后台入口、许可页和健康接口均可访问。浏览器旧数据及完整交互仍待人工验证。
- 数据备份或回滚要求：无数据库迁移；回滚前保留浏览器画布与素材数据。

### 功能名称：管理员调点事务保护

- 状态与目的：待验证；确保管理员修改余额和写入调点流水同时成功或同时失败。
- 对应代码位置及涉及文件：`repository/user.go`、`service/auth.go`。
- 官方原版行为与二开差异：官方实现先保存余额，再单独保存流水；二开版改为同一数据库事务，并拒绝负数及非有限余额。
- 关键依赖：GORM 事务、`users` 与 `credit_logs` 表、管理员用户接口。
- 数据库变化：无。
- API 变化：路径及响应结构不变；非法余额返回错误。
- Git 提交与关联 PR：`2f23672bbbde1a0aba00ac903bd13a97443ccf36`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)。
- **必须保护的行为**：调点后余额与流水一致；流水写入失败时余额不变；不允许负数余额。
- 上游同文件或同链路改动的兼容要求：检查用户余额扣减、失败返还及管理员调整是否仍各自正确，不能因自动合并破坏事务边界。
- 更新后验证方法与最近验证结果：Go 测试覆盖余额与流水原子性及失败回滚；正常调点、重复值和无效值的管理后台交互仍待人工验证。
- 数据备份或回滚要求：上线前备份用户与算力点流水；不清理历史记录。

### 功能名称：内置模型价格显式配置

- 状态与目的：待验证；避免未填模型价格时按 0 点调用内置系统渠道。
- 对应代码位置及涉及文件：`service/settings.go`、`service/workflow_agent.go`、`web/src/app/(admin)/admin/settings/page.tsx`。
- 官方原版行为与二开差异：官方未找到价格配置时默认 0 点；二开版拒绝未配置价格的系统模型调用，管理员明确设置 0 才表示免费。用户本地自有渠道不使用系统价格。
- 关键依赖：后台公开模型/工作流清单、系统渠道、模型价格、AI 代理及工作流 Agent。
- 数据库变化：无；现有设置中的 `modelCosts` 表达价格是否已明确配置。
- API 变化：路径不变；缺少价格时返回“模型未配置算力点价格”。
- Git 提交与关联 PR：`2f23672bbbde1a0aba00ac903bd13a97443ccf36`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)。
- **必须保护的行为**：内置模型缺价不能产生上游调用；显式零价可调用且不扣点；正价调用按现有扣点和失败返还逻辑处理。
- 上游同文件或同链路改动的兼容要求：检查所有 `ModelCost` 调用方，新增系统模型调用链不得忽略错误。
- 更新后验证方法与最近验证结果：Go 测试覆盖未开放或未定价模型不发起上游请求；零价、正价模型和工作流 Agent 的真实供应商调用仍待联调。
- 数据备份或回滚要求：不改表；上线前导出后台设置，避免价格误配。

### 功能名称：模型清单与扣返保护

- 状态与目的：部分验证；只有管理员明确开放且渠道配置完整的系统模型可调用，价格配置必须有效，失败返还与余额流水保持原子性。
- 对应代码位置及涉及文件：`service/settings.go`、`service/workflow_resolve.go`、`handler/ai.go`、`handler/video_task.go`、`repository/user.go`、`service/auth.go`、`service/workflow_agent.go`、`web/src/app/(admin)/admin/settings/page.tsx`；相关测试在同目录测试文件。
- 官方原版行为与二开差异：后台空开放清单不再自动暴露所有渠道模型；禁用的工作流不可新建任务；重复、负数或精度错误的模型价格被拒绝；视频小数秒向上计点；失败返还连同流水在事务中保存；视频任务记录保存失败也会尝试返还。
- 关键依赖：后台系统渠道、`modelCosts`、用户余额和 `credit_logs`、视频任务记录与工作流 Agent。
- 数据库变化：无。
- API 变化：路径与结构不变；未开放模型和错误视频时长会被拒绝。
- Git 提交与关联 PR：`09d39590274f6b92681a7eab769a6dd82212f94c`、`3103de6bb87cbf7b72e8bfe863ea045a3eb4f840`、`466c23c146c4a1d3243fb20a3eafddfce54f0b8b`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)。
- **必须保护的行为**：渠道存在不等于模型已开放；未填价格不能免费调用；零价须明确配置；扣点失败不发起上游请求；普通 AI 失败返还、视频任务失败返还与流水一致；用户自有本地渠道不受系统价格限制。
- 上游同文件或同链路改动的兼容要求：逐一检查新增 AI 路由、视频时长标准化、工作流状态和异步任务失败状态；不能仅凭 HTTP 成功判断实际生成成功。
- 更新后验证方法与最近验证结果：提交 `71642298a2604d437483cc1472fe4ec19e2e2ec3` 的 Go `service`、`handler`、`repository` 测试与 Docker 构建通过；没有真实模型密钥和供应商账单，计费单位与实际调用仍待验证。
- 数据备份或回滚要求：不改表；升级前备份用户余额、流水和任务记录，不能清空已有数据。

### 功能名称：R2 配置防误用

- 状态与目的：待真实存储桶验证；管理员可以先保存停用的 R2 草稿，启用时必须提供完整配置，容量统计只使用已保存配置。
- 对应代码位置及涉及文件：`service/settings.go`、`service/storage.go`、`handler/storage.go`、`web/src/services/api/admin.ts`、`web/src/app/(admin)/admin/settings/page.tsx`。
- 官方原版行为与二开差异：新配置默认停用；Endpoint 必须是无路径、查询参数和账号密码的 HTTP(S) 根地址；密钥只按配置身份沿用；容量统计不再把前端未保存草稿写回配置。
- 关键依赖：S3 兼容接口、管理员存储配置、`storage_objects` 元数据、素材同步。
- 数据库变化：无。
- API 变化：`/api/admin/storage/measure` 只需传已保存配置的 `index`；额外传入的 `provider` 不再参与容量统计。
- Git 提交与关联 PR：`09d39590274f6b92681a7eab769a6dd82212f94c`、`466c23c146c4a1d3243fb20a3eafddfce54f0b8b`、`71642298a2604d437483cc1472fe4ec19e2e2ec3`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)。
- **必须保护的行为**：未配置完整时不能启用 R2；更换配置不能意外继承旧密钥；容量统计不保存未提交的草稿；已有素材和本地数据不能因配置切换被清空。
- 上游同文件或同链路改动的兼容要求：检查签名请求、对象路径、公开 URL、上传/下载/删除和素材同步，并核对容量阈值。
- 更新后验证方法与最近验证结果：Go 单元测试覆盖 Endpoint 格式和密钥身份匹配；Docker 构建及测试服务器基本接口检查通过。尚无 R2 存储桶，未做真实读写。
- 数据备份或回滚要求：先备份设置与素材元数据；切换存储时保留原对象与本地数据。

## 新功能登记模板

为每个功能复制以下小节，并在开发、合并及上游同步时持续更新。路径使用仓库相对路径，提交使用完整 Git SHA。

### 功能名称：待填写

- 状态与目的：
- 对应代码位置及涉及文件：
- 官方原版行为与二开差异：
- 关键依赖：组件、状态、服务、模型渠道及外部服务。
- 数据库变化：表、字段、索引、迁移及已有数据兼容要求；无变化时写“无”。
- API 变化：请求、响应、鉴权及调用方；无变化时写“无”。
- Git 提交与关联 PR：
- **必须保护的行为**：列出可观察、可复核的结果及边界条件。
- 上游同文件或同链路改动的兼容要求：
- 更新后验证方法与最近验证结果：
- 数据备份或回滚要求：

## 更新检查

每次建立 `sync/upstream-日期` 分支时，先逐项核对功能索引。即使 Git 自动合并成功，也要检查涉及同一组件、状态、API、数据库或存储格式的语义变化。不得用删除二开功能或未分析的 `ours` / `theirs` 选择解决冲突。无法证明受保护行为仍成立时，暂停该更新并记录到 `forkMaintenance.md` 的同步日志。
