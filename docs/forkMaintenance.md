# Fork 长期维护手册

## 仓库与基线

| 用途 | 地址或分支 |
| --- | --- |
| 我的 Fork（`origin`） | `https://github.com/sanqixy-sudo/infinite-canvas.git` |
| 官方仓库（`upstream`） | `https://github.com/tigerowo/infinite-canvas.git` |
| 官方默认分支 | `upstream/main` |
| 初始官方提交 | `ccda172efba25cbee990a785bba715b90cc42b95` |
| 初始项目版本 | `v0.8.1`，包含尚未发布的 `Unreleased` 变更 |

GitHub Fork 关联必须保留。GitHub 写入前核对账号为 `sanqixy-sudo`，并核对远程 URL。禁止强制推送、未经确认的 `git reset --hard` 和自动覆盖历史。

## 分支职责

- `main`：官方基线，不加入二开业务代码。先核对差异与工作区，再仅以快进方式从 `upstream/main` 同步，并正常推送至 `origin/main`；不能快进时停止调查。
- `my-version`：长期二开主分支。自定义功能经独立功能分支审查后进入这里。不得直接把未经评估的上游提交合入。
- `feature/<名称>`：单项二开功能，从当前 `my-version` 建立。
- `sync/upstream-日期`：每次上游更新从当前 `my-version` 建立；同日多次可加序号。仅在此分支试合并、移植、兼容改造和验证。验收后创建指向 `my-version` 的 PR，正式合并须用户批准。

## 上游同步流程

1. 检查 `git status`、当前分支、`origin`/`upstream`、GitHub 账号和 `docs/forkCustomizations.md`。有未提交改动时先保护，不覆盖。
2. 获取 `upstream/main`，记录其 SHA、上次已吸收的官方 SHA 和共同祖先。列出未吸收提交、改动文件、版本及数据库/存储格式变化。不要仅以 `main` 与上游的差异替代对 `my-version` 的检查。
3. 逐项分类：**A** 为独立修复且可直接合并；**B** 为需要接口、状态或配置兼容改造；**C** 为可能改变二开行为、权限、任务或计费的高风险冲突；**D** 为数据兼容或验证条件不足、应暂缓的更新。分类依据及未吸收提交写入下方日志。
4. 从当前 `my-version` 创建独立 `sync` 分支。按范围选择 merge、cherry-pick、手动移植或局部重构；保留来源 SHA。冲突逐处理解两侧意图，不能未经分析直接选择 `ours` 或 `theirs`。同文件即使自动合并，也按调用链和受保护行为做语义检查。
5. 按影响范围验证 Go 后端、Next.js 前端、画布节点和状态、登录权限、余额与扣费、模型配置、生成任务、历史记录、素材持久化及 Docker。遵守 `AGENTS.md`；新增测试或执行构建前取得用户明确授权。未验证项目明确列出，不能写成“通过”。
6. 生成中文报告：新增官方提交、主要功能、已吸收/兼容改造/暂缓内容、二开影响、已执行检查、未验证事项、建议结论。验证合格后可建 PR，正式合入 `my-version` 须用户批准；合并后更新两份维护文档及同步日志。

## 数据保护与回滚

后端在 `repository/db.go` 初始化连接时执行 GORM `AutoMigrate`。官方明确不保证历史数据兼容，因此任何涉及表、字段、索引、序列化或存储路径的更新，都先审查实际数据与迁移差异，再在隔离环境验证；不得在生产库试迁移或通过清空数据完成升级。

盘点并保护 SQLite 数据库及其 WAL/SHM、MySQL/PostgreSQL、`users`/`credit_logs`、`purchase_orders`、独立 `settings.commerce`、画布项目、图片/视频/音频任务与历史记录、`user_configs`、模型密钥与存储配置、`storage_objects`、`./data` 挂载、浏览器 IndexedDB/localforage，以及 S3/R2/WebDAV 中的实际对象。数据库和对象存储的备份应保持对应关系；备份后验证可恢复性。不得在文档、日志或 PR 中暴露密钥和真实用户数据。不可逆迁移、删除或回滚真实数据必须先获用户确认。

回滚优先撤销或修复尚未合并的 `sync` 分支；已合并的代码通过新提交或 PR 恢复到经确认的版本，不改写共享历史。数据回滚须使用升级前已验证的备份，并匹配相应应用版本和外部存储对象；先评估升级后新写入数据的去向，再执行恢复。没有可靠备份时暂停升级。

## 部署、许可与安全边界

当前首页展示改进的测试站镜像为 `xiaomeng-video-workbench:4761e59`，源码 `4761e5929ef9ff4c4dfc4f833ca10636bf857111`，继续使用 `127.0.0.1:3001` 与原数据挂载。升级前私有备份位于 `/opt/xiaomeng-video-workbench-deploy/backups/pre-home-8fdde70/`（备份在本轮导航追加前创建），升级前后八表结构和全部行摘要一致。上一镜像 `448df01` 保留；本轮无数据结构变化，应用回退优先换回上一镜像，不能覆盖升级后用户新写入的数据。构建和界面验证的具体范围见 pending-test，本次记录不代表其他部署环境全部验证。

默认 `docker-compose.yml` 指向 `ghcr.io/tigerowo/infinite-canvas:latest` 且设置 `pull_policy: always`，不能用于保证二开代码部署。未来部署使用 `docker-compose.local.yml` 从本地源码构建，或使用经核对的自有镜像及固定版本；先审查 `.env`、端口和 `./data:/app/data` 挂载，不触碰其他容器。不要使用示例管理员密码公开部署。

保留 `LICENSE`、README 中的原项目与前代项目署名。前端展示改为“小盟视频工作台”；根据用户明确要求，网站导航隐藏“许可与源码”入口，`/legal` 页面和仓库许可证继续保留。用户声明持有商业授权，但原始授权材料尚未独立核验；未来公开提供修改后的网络服务前，仍须核对实际授权及对应源码提供、许可/版权通知、修改标识等要求。

## 上游同步记录

### 本地与 R2 存储维护

选择账号素材库后，账号文件的默认后端为服务器 `data/storage`，可通过 `LOCAL_STORAGE_DIR` 指定；当前 Docker 挂载 `./data:/app/data` 同时覆盖 SQLite、文件和日志。备份必须包含数据库与本地文件，不能只备份 SQLite。个人新素材默认保存在当前浏览器，访客与登录账号的 IndexedDB/localforage 均须另行保留，不包含在服务器备份中。

管理员切换本地/R2 仅决定后续上传位置，不自动迁移存量数据。旧文件始终按原 `provider_id` 读取，仍有引用的旧桶不能删除或改地址。回滚代码前核对该版本是否支持 `storage-local`，不支持时应先恢复支持本地文件的应用版本，不能通过删除文件绕过。

账务流水作为只读审计记录，只能由人工订单充值、调点、模型消费和失败返还事务生成。上游重新加入独立流水编辑或删除入口时必须拦截；用户本人流水接口不得接受客户端指定其他账号。

个人存储基础额度由独立 `commerce` 设置控制，未配置为 1 GiB；已购永久额度在 `users.storage_extra_bytes`。钱包按当前用户所有文件索引跨 Provider 汇总，本地/R2 切换不能重新获得额度。平台原有总容量与个人配额分别生效；降低额度不得删除已有文件。

订单审核、余额/额外容量发放和流水必须保持事务原子性与幂等。`storage_upload_reservations` 用于同用户并发上传预留，不能只检查前端显示的剩余空间。升级涉及用户保存、存储注册或系统设置时，检查是否保留额外额度、订单快照与独立 `commerce` 行。回滚旧版本前先评估这些新增数据是否能被旧代码识别，不通过删除表或清零权益完成回滚。

### 个人存储偏好与单条账号素材维护

本轮把个人新素材默认去向设为当前浏览器，可选自动存入账号素材库；只影响后续保存，不批量搬移或删除历史数据。该规则替代历史“登录即默认上传”，不改变模型只用平台云端、服务器本地/R2 后端选择或个人容量限制。

个人偏好通过独立 API 原子写入 `user_configs.model_config.autoSaveAssetsToCloud`，无新表；模型配置、存储配置和历史清理不能回写旧整行快照。账号素材通过用户锁内单条合并，禁止恢复整份列表覆盖；新媒体需核对本人文件归属，并按 ID/文件键去重，旧 JSON 和扩展字段保留。

浏览器文件按访客/账号分区持久化真实内容，云列表独立按会话读取；登录不会把本地引用自动变成云文件，账号切换也不能接受旧会话响应。手动入库、右键和手机菜单、上传/登记分步失败及重试须纳入上游回归，不能把临时 URL 或仅文件上传成功当作入库成功。

手动保存只缓存归档文件字段，重试合并最新编辑。稳定浏览器源通过 `browserSourceId` 从当前账号已有条目复用文件，跨刷新也应避免重复上传；该身份不保存 Token、Blob、Base64 或外部 URL，不当作媒体引用或授权依据。确认文件失效才清映射，不能因为网络或登记失败重复占用额度；账号变化清会话缓存。

删除素材条目仅删除列表记录，不删除文件索引或物理文件，不保证立即释放容量；其他画布和历史引用不得被破坏。实际文件清理须另行确认引用、权限和失败后保留文件的处理，不能在升级时擅自清空素材。回滚到旧整份同步版本前，评估其对本地分区和账号列表的覆盖风险；备份须同时保留数据库、媒体及浏览器各分区。

### 素材目录与标签组织维护

本轮目录、多归属和标签整理功能为 `48f5752110282a6e5806e336506f5ee27a4e0cd7`，Go 标准格式为 `53e3494ce90601867c8a1e1456b053f9c553a004`，功能检查点为 `1115c6f4bac0ca6c76d850fc3ef904df99c0148c`，最终样式与部署源码为 `86b07b00b7e586f71998441cd723f919fcf5a56d`。Go 全量（含目录并发和删目录保文件）、`1115c6f` 独立 TypeScript 与 32 项 Bun 回归、`86b07b0` 完整 Docker 构建通过；隔离 HTTP、目录/标签/ZIP/画布选择器浏览器检查、最终深浅主题与390px目录抽屉检查已完成，测试站已升级且原数据保留。类型检查为独立结果，不以 Docker/Next.js 构建代替；不同检查点的范围分别记录，不声称全部流程在最终样式提交重跑。真实用户及 R2 等资源验收仍保留在 `pending-test.md`，用户确认前不写正式功能说明。

账号目录复用 `user_configs.asset_data.folders[]`，素材使用 `folderIds` 与原 `tags/category`，不新增表、列或迁移。账号目录与浏览器目录、不同 owner 的 localforage 分区分别保存；明确位置的新建表单不能被自动保存偏好改存到其他位置，游客请求账号保存必须拒绝。个人默认去向、平台云端模型及管理员的服务器本地/R2 模式仍是独立规则。

已有条目的标签和目录归属只能通过权威组织补丁修改，普通单条整份保存、自动保存及同文件重试须保留数据库最新值。批量整理在同一用户锁内应用增删/替换意图，最多 200 个素材；出现无效或越权目标时整批拒绝，不允许部分提交或使用旧列表回写。上游若恢复整份同步或重写素材序列化，应按数据覆盖风险做语义审查。

前后端共同约束每素材库最多 1000 目录、8 层、同级不重名、目录名最多 80 字；每素材最多 32 个目录归属、50 个且每个最多 80 字的标签。新增/替换目录输入最多 32 个，移除输入可达 1000 个以支持批量移出，最终单素材归属上限不变。目录移动必须拒绝自身/子级循环；导入包装单独导致超限时省略包装保留有效原树，所选父级容不下原树时提示选根目录，整体不合法时不得部分写入元数据，也不能压平层级或覆盖既有目录。

素材包须带齐真实文件与目录树，导出账号文件时核对当前会话并读取有权访问的内容，缺失不能静默跳过。导入重建目录、素材和浏览器文件 ID，保留分类与标签，不复用原账号文件键，不自动批量入账号；本地手动归档时剥离本地目录 ID。隔离浏览器已验证 2 素材、5 目录、1 真实 SVG 的 ZIP 导出，导入本机后含包装层 6 目录且账号不变，刷新后 Blob 图片仍可读；重复导入、独立封面、真实资源及空间不足等故障场景继续待验收。

删除父目录会移除它和下级目录的组织元数据及相应归属，不能删除素材、其他目录归属、文件索引或物理文件，也不保证释放配额。隔离 HTTP 已确认目录树/多归属、跨用户与无效批量原子拒绝、并发标签与旧快照互不覆盖；删目录后素材/文件索引仍在、232 B 占用不变。升级/回滚备份需同时保留 `asset_data`、媒体与浏览器分区；旧版本不理解目录字段或允许整份标签覆盖时优先保留数据修复，不通过清空 JSON、目录或文件完成回退。新增检查继续按授权执行并记录具体 SHA、范围和真实结果。

### 公开首页、登录门禁与旧画布原档维护

本轮改为公开 `/` 产品介绍页与登录后 `/workspace` 控制台，用户布局仅 `/`、`/login`、`/legal` 为公开白名单，其他用户业务页先验证会话。该策略替代历史“未登录可直接编辑业务页”，不删除旧访客数据，也不取消登录后的当前浏览器保存；平台云端唯一模型来源、后台供应商密钥和服务器本地/R2 模式保持不变。全局说明中的旧访客访问描述不能作为重新开放业务页的依据。

上游涉及登录、布局或请求封装时，保留站内安全回跳默认 `/workspace`、真实用户校验、Token 与 `sessionVersion` 异步守卫，以及 401 只清理对应当前 Bearer、403 不退出、校验网络错误可重试。OAuth 敏感参数清出地址栏，但错误不能被静默吞掉。公开首页不读取私人业务列表；登录页保留真实注册开关和 LinuxDo 条件，不添加未实现操作。

只读媒体会话由显式 Bearer `POST /api/files/session` 建立，DELETE 清理；前端建立/清理串行，普通登录、`/me` 和文件元数据不隐式写 Cookie，防止旧响应覆盖新账号。阅读 Cookie 范围 `/api`，只用于获准的读取中间件与媒体，写入仍须 Bearer；不能把允许 Cookie 读取误扩成 Cookie 写入或跨用户读文件。部署时还须核对 HTTPS 反代头与 Secure Cookie 行为，不改现有代理配置来跳过鉴权。

画布原 `infinite-canvas:canvas_store` 保留原文只读，新缓存写到 `infinite-canvas:canvas_store:user:<userId>`，`ownerId/restoredLegacyRootIds` 一同保存。远端已确认属于当前用户的同 ID 旧画布可合并；未知归属不自动上传，只能由用户在控制台选择项目后恢复新 ID 副本，重映射全部 `workspaceId`，不复用旧 Codex 会话引用。恢复沿用既有画布接口，无新后端恢复接口；浏览器文件缺失不伪称恢复媒体成功，他人服务器文件权限不随画布副本转移。

升级与回滚均须保留旧全局原档、各账号分桶、浏览器真实文件及服务器数据库/媒体/配置。回退旧客户端可能重新混用全局缓存或重新开放访客业务，应先评估；不能清空浏览器数据消除冲突。原创 `BrandMark`、产品 Logo 和浏览器图标纳入主题与导航回归，不恢复官方宣传入口，不删除许可证或作者信息。

功能提交 `1141512`、Go 官方 gofmt `ff99112` 的 Go 全量、独立 TypeScript 与合计 38 项 Bun 回归通过，不是新增 38 项；随后仅移除登录多余刷新及调整首页阴影的 `fca04ad` 完整 Docker 构建退出 0，类型检查与构建分别记录。隔离 HTTP 已通过公开页/图标、匿名 401、普通用户后台 403、媒体 Cookie 剩余期与路径、Cookie 只读/写入拒绝、无效 Bearer 不回退、`/me`/FileInfo 无 Cookie 副作用、本人及签名媒体、裸私有文件拦截和退出双路径清理。浏览器已通过登录/退出/错误提示及 A→B 空工作台、旧项目明确选择后新 ID 副本恢复。

`fca04ad` 删除导航后的多余 `router.refresh()` 后，真实深链精确为 `/assets?scope=local#folder`、锚点不重复。显式恢复副本刷新后仍为 1 项并保留剩余 1 项旧档提示，不重复恢复；A/B 切号后账号和当前浏览器素材各自隔离。最终首页已查看深浅主题，首页/登录 390×844 无横向溢出；访客“开始使用”进入 `/login?redirect=%2Fworkspace`，手机按钮完整、注册确认密码可见，未实际新建账号。截图及范围见待测试，不能扩大为所有注册/OAuth/键盘交互验收。

登录门禁版本已部署 `fca04ad`，部署与数据保留依据见下节；后续排版复核记录见下面单节。继续验收真实注册、注册开关/LinuxDo/OAuth、断网与长期切号、真实旧原档、多画布和文件恢复。真实供应商和 R2 联调仍待资源，详细检查点与 38 项组成见 `pending-test.md`。

最终 `fca04ad` 镜像另已实测跨标签页退出：一个标签退出后，其他画布标签立即卸载画布并跳转到携带原 canvas 返回路径的登录页。该权限响应需纳入后续回归，不能只等下一次模型或保存请求失败；隔离交互和实际部署的检查范围分别记录。

### 首页与登录排版后续复核

`697ca4b741058e53c2dd6541711cb38b80a2d050` 仅修改首页、登录页及两份页面私有样式，处理首屏密度、标题/说明对比、三卡 grid、固定同页导航与登录自然滚动；最终 `016f30f81e8a0aae62ef86b1866bb0b0485f7f381` 仅再补 5 行登录标签高度 CSS。697 完整 Docker 与独立 TypeScript 顺序重跑均退出 0，首次并行类型进程因内存主动终止不计通过；016 完整 Docker 退出 0。Go/38 项回归仍属于 114/ff 功能检查点，本轮没有后端逻辑变化，不将历史测试写成重新执行。

016 真实浏览器已覆盖 1920×911、1366×768、1024×768、768×1024、390×844、320×640：首页/登录无横向溢出、三卡不重叠、桌面与手机按钮可见；320 注册显示 3 条校验后可原生滚动到提交按钮，未实际注册。深浅主题、手机/桌面流程同页锚点与固定导航无遮挡、品牌回顶部及登录返回通过，截图与具体位置见待测试。保留页面 `100dvh`+纵向滚动、正常流布局和章节滚动留白，避免上游样式回归造成长表单裁切。016 已部署，备份与原数据核对见下节；用户体验和 OAuth/R2/真实生成继续待验收。

### 首页四段演示维护

`61997d9` 新增页面私有 `creation-showcase.tsx`、4 个 MP4/4 张 JPG 并替换首页文字卡，`ad9c43d` 去掉窗口焦点限制，最终 `2d9910e075cf36fa2d3d438b984e27493f47dedc` 集中播放 effect，取消旧播放 Promise 对当前片段提示的写入。最终 2d 独立类型、完整 Docker 均退出 0，源码记录 `/opt/xiaomeng-landing-image-source.sha` 与完整 SHA 一致；已完成普通播放、资源和部署检查，不能用 016 排版结果代替，Go/38项仍属原功能检查点。

原用户 ZIP/WebP 保留，Pillow/ffmpeg 转码后媒体与海报合计 6,943,929 B，较 173,266,848 B 原动画约减 96%。维护时保留单个 video、入视口才设置 src、preload none、离屏/隐藏暂停与减少动态效果偏好，不改成四段全预载。最终浏览器已确认首屏无 src、4 段实际播放 ready4/720×406/无 error、手动暂停不被选段打破、观察到自动轮换、回顶离屏暂停/返回可继续、手机前后闭环与 End 移焦，五档宽度与单 video、深浅主题通过；不写固定秒数恰好切第二段的断言。4 海报 HEAD 为 200/image/jpeg，4 MP4 Range0-1023 为 206/video/mp4、1024 B 且总长正确。

减少动态效果及隐藏标签暂停尚未切真实偏好/标签验证，播放受限和网络失败重试未做故障注入，快速切段竞态仍需专项检查，不能把实现或普通无错误播放当成全覆盖。功能演示不能承诺未开放能力。静态资源不属于账号素材、配额或供应商调用，本轮不改数据库/计费/模型边界，真实生成和 R2 继续待资源，用户认可前不升级正式功能说明。

### 当前测试部署与回滚依据

- 当前视觉源码为 `448df016c3ec4b954ab9034e4c0ada5f17e0b4f7`，镜像 `xiaomeng-video-workbench:448df01`，独立 TypeScript 与完整 Docker 均退出 0，镜像源码记录与完整 SHA 一致。两张电影影像和首页/登录视觉已部署，检查细节见待测试的“首页与登录电影工作室视觉”；不把历史 Go/38 项回归说成本轮重跑。
- 只升级 app，保留 `127.0.0.1:3001 → 3000` 与 `/opt/xiaomeng-video-workbench-deploy/data:/app/data`，OpenResty 未动。升级前 `/opt/xiaomeng-video-workbench-deploy/backups/pre-studio-448df01/` 保存 SQLite 在线备份、媒体归档、Compose/`.env` 私有副本和原行摘要；目录 700、文件 600，数据库完整性 `ok`。停前、停后与升级后 8 表结构和全行 SHA256 一致，`users/canvas_projects/settings` 各 1，其余 5 表 0。
- 实际站 `/`、`/login`、`/workspace`、`/api/health`、两张新 WebP 均 200；匿名素材 GET 与图片生成 POST 均 401。无数据库/API 变更，未添加真实用户或素材；旧 `2d9910e` 镜像与对应备份保留供回退代码时参考，不执行数据回滚。
- 隔离 preview 停止命令已返回，最终 inspect 为 `exited`，数据目录保留；停止后再次确认实际站 8 表摘要一致。页面截图和完整生成提示词分别保存在本任务 visualizations 目录与二开保护清单，后续替换时保留素材来源记录。

#### 上一轮四段演示部署记录

- 阶段源码 `2d9910e075cf36fa2d3d438b984e27493f47dedc`，镜像 `xiaomeng-video-workbench:2d9910e`；只更新 app，仍为 `127.0.0.1:3001 → 3000`，挂载 `/opt/xiaomeng-video-workbench-deploy/data:/app/data`，OpenResty 未改。独立类型、完整构建和浏览器媒体结果按各检查点保留，不冒称后端 Go/38 项回归在最终媒体提交重跑。
- 私有备份 `/opt/xiaomeng-video-workbench-deploy/backups/pre-showcase-2d9910e/` 含 SQLite 在线副本（完整性 `ok`）、Compose/`.env` 私有副本、媒体归档和原行摘要，目录700、文件600。停旧应用后与新启动后，8 表结构及全行 SHA256 均与备份相同、完整性 `ok`：`users/canvas_projects/settings` 各1，其他 `credit_logs/storage_objects/user_configs/purchase_orders/storage_upload_reservations` 共5表均0；原数据保留，未执行数据回滚。
- 实际站点 `/`、`/login`、`/workspace`、`/api/health` 均200，4 JPG HEAD 均200/image/jpeg，4 MP4 Range0-1023 均206/video/mp4/1024 B且总长正确；匿名 GET `/api/assets` 与 POST `/api/v1/images/generations` 均401。页面响应200不等于匿名业务授权。隔离 preview 的 docker stop 已正常返回、当前已停止，隔离数据保留；fca/016阶段曾在停止后重启用于后续验收，此处为最终停止确认。

#### 上一轮首页与登录排版阶段

- 016 阶段源码 `016f30f81e8a0aae62ef86b1866bb0b0485f7f381`，镜像 `xiaomeng-video-workbench:016f30f`。仅更新 app，继续 `127.0.0.1:3001`，原 data 挂载及 OpenResty 保持；私有备份 `/opt/xiaomeng-video-workbench-deploy/backups/pre-layout-016f30f/` 包含 SQLite、媒体、Compose/`.env` 和行摘要。停应用后与新启动后 8 表结构及全部行 SHA256 均一致、完整性 `ok`，用户/画布/设置各 1、其余 5 表 0。
- 016 站点 `/`、`/login`、`/workspace`、`/api/health`、`/logo.svg`、`/icon.svg`、`/favicon.ico` 均 200；匿名 GET 素材、POST 真实目录路径和图片生成均 401。此为阶段历史，媒体版最终检查与部署见上。

#### 上一轮公开首页与登录门禁版本

- 上一轮源码 `fca04adc3709c4bdede7d7ea47b11313bdeb8ceb6`，镜像 `xiaomeng-video-workbench:fca04ad`。功能 `1141512`、Go 格式 `ff99112`、页面小改 `fca04ad` 的自动、独立类型、完整构建、隔离权限和真实浏览器结果按上述检查点保存，不冒称所有检查都在最终样式提交重新执行。
- 仅更新 app，继续 `127.0.0.1:3001 → 3000` 和 `/opt/xiaomeng-video-workbench-deploy/data:/app/data`，OpenResty 未改。升级前备份 `/opt/xiaomeng-video-workbench-deploy/backups/pre-landing-fca04ad/` 包含完整性 `ok` 的 SQLite 在线副本、Compose/`.env` 私有副本、`media-files.tar.gz` 和 `original-records.json`，目录 700、文件 600；不公开环境配置内容。
- 停旧 app 后、新 app 启动后及匿名 HTTP 检查后，8 表结构和全部行 SHA256 与备份完全一致：`users=1/canvas_projects=1/settings=1`，`credit_logs/storage_objects/user_configs/purchase_orders/storage_upload_reservations` 均 0。实际站点未新增验收账户或素材，未执行数据回滚。
- 首页、`/login`、`/legal`、`/workspace`、`/canvas`、`/assets`、`/account`、`/account/storage`、`/admin`、`/api/health`、`/logo.svg`、`/icon.svg`、`/favicon.ico` 均 200；页面 HTTP 200 不等于匿名业务授权。匿名 GET `/api/assets`、`/api/prompts`、`/api/proxy-image?...`，POST `/api/anonymous/files`、`/api/v1/user-data/asset-folders`、`/api/v1/user-data/assets/organize`、`/api/v1/images/generations` 均 401。
- 代码回退前核对旧版本是否会重新开放访客业务和混用全局画布缓存；数据库、媒体及各浏览器原档一并保留，不能通过删除旧数据适配旧代码。隔离数据保留，预览最终已停止，fca/016阶段曾重启供后续验收，当前状态以上节为准。

#### 上一轮素材目录版本与历史回滚记录

- 上一轮素材目录部署源码 `86b07b00b7e586f71998441cd723f919fcf5a56d`，镜像 `xiaomeng-video-workbench:86b07b0`，完整 Docker 构建退出 0。功能检查点 `1115c6f4bac0ca6c76d850fc3ef904df99c0148c` 的独立 TypeScript 和 32 项 Bun 回归通过，Go `go test ./...` 全量通过；隔离 HTTP 和浏览器结果见上节及待测试清单。
- 部署目录 `/opt/xiaomeng-video-workbench-deploy`，仅更新应用容器，继续 `127.0.0.1:3001 → 3000`，原 `data` 挂载不变，OpenResty 未改动；隔离预览容器已停止，隔离数据保留。
- 升级前备份 `/opt/xiaomeng-video-workbench-deploy/backups/pre-folders-86b07b0/` 包含 SQLite 在线备份、Compose 和 `.env` 私有副本、`media-files.tar.gz`，目录权限 700、文件 600。环境配置仅保留在受限备份，不在文档或日志公开内容。
- 停应用后及新容器启动后，8 张表结构和全部行 SHA256 均与备份完全一致，完整性 `ok`：`users=1`、`canvas_projects=1`、`settings=1`，`credit_logs/storage_objects/user_configs/purchase_orders/storage_upload_reservations` 均为 0。实际测试站未因隔离验收新增用户、目录或素材。
- 首页、`/assets`、`/canvas`、`/account`、`/account/storage`、`/login`、`/admin` 与 `/api/health` 均 200，匿名 POST `/api/v1/user-data/asset-folders` 与 `/api/v1/user-data/assets/organize` 均 401。最终 `86b07b0` 查看了深浅主题；390×844 的 `clientWidth=scrollWidth=390`，手机目录抽屉展开“角色资产”并选“主角设定”后 2 条素材/面包屑更新，抽屉关闭。截图为 `asset-folders-desktop.jpg`、`asset-folders-light.jpg`、`asset-folders-mobile.jpg`，不据此宣称所有媒体和故障流程实机通过。
- GitHub 写入身份为 `sanqixy-sudo`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1) 交付说明已更新为多级素材库，目标 `my-version`，交付时 REST `mergeable_state=clean`。PR 仍为草稿，正式合并须用户批准；本轮未执行数据回滚。

#### 上一轮个人存储版本与历史回滚记录

- 上一轮个人存储版本来源：`f9538f959f24d55aa26bdd3288de5b2ba73b60ea`，镜像 `xiaomeng-video-workbench:f9538f9`，完整 Docker 构建退出码 0。后端功能 `5022098a1079da1d45a3bfa95cb0d81e6569e5f1`、前端功能 `8b674878e43bbbc42c770aca355080fcd7d5d7d9`；代码已推送，Go 全套、独立 TypeScript 与 20 项前端回归通过。
- 部署目录 `/opt/xiaomeng-video-workbench-deploy`，继续仅绑定 `127.0.0.1:3001`，原 `data` 挂载保留，OpenResty 未改动。升级前镜像 `xiaomeng-video-workbench:5d03258` 保留作代码回滚参考；旧版本会恢复登录默认上传和整份素材列表同步，回滚前须评估这些行为与本轮新数据。
- 该轮备份为部署目录下 `backups/pre-storage-f9538f9/`，包含 SQLite 在线备份、Compose、`.env`、`media-files.tar.gz` 和 `original-records.json`；目录归 root、权限 700，文件 600。环境配置仅保留在受限备份，不在文档或日志公开内容。
- 升级后数据库完整性 `ok`；8 表原行摘要全部一致：`users=1`、`canvas_projects=1`、`credit_logs=0`、`storage_objects=0`、`user_configs=0`、`purchase_orders=0`、`storage_upload_reservations=0`、`settings=1`。实际库未写入验收账号、素材、订单或其他测试数据。健康、首页、账户、存储设置、素材、画布、登录、后台均返回 200，匿名偏好接口返回 401。
- 隔离 HTTP 通过默认/独立偏好、模型保存不覆盖、严格输入/no-store、本人文件归属及权威 MIME/字节/地址、ID/文件去重、12 并发文本加原图片共 13 条、跨用户隔离、旧批量 405、条目删除保留文件/占额及实际删文件归零。桌面验证图片本地刷新、右键入库、开启后自动入库；390px 验证偏好刷新保持、设置/素材无横向溢出、节点更多菜单禁用重复入库。
- 以上浏览器验证使用隔离图片素材；用户真实旧浏览器、视频/音频实机、真实供应商和 R2 仍待联调。失败与会话竞态由自动回归覆盖，不能写成实机故障注入或所有媒体链路通过。具体结果及待验收范围见 `docs/progress/pending-test.md`。
- 隔离预览已停止，草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1) 已更新；正式合入 `my-version` 仍须用户批准。

#### 上一轮钱包版本与历史回滚记录

- 钱包版本来源：`5d032583aab3a579951e0d4a19c160432498f5f8`，镜像 `xiaomeng-video-workbench:5d03258`；功能首次提交为 `11c994ca544dadfd58a804de6267cd0e138c32a4`。该轮升级前镜像为 `xiaomeng-video-workbench:f7772da`，更早的 `4c69c61` 为配色修正，均保留历史参考。
- 钱包版本已完成钱包、默认免费额度、并发配额与人工套餐申请，尚未接入在线支付或扩展模型计价。功能分支已推送，仍通过草稿 PR #1 等待合入 `my-version`，不自动合并。
- 部署目录 `/opt/xiaomeng-video-workbench-deploy`，应用仅绑定 `127.0.0.1:3001`，原 `data` 挂载保留。只重建该应用容器，未改动 OpenResty。
- 钱包版本升级前备份位于部署目录下 `backups/pre-wallet-5d03258/`：`infinite-canvas.db` 为通过完整性检查的 SQLite 在线备份，`compose.yml` 与 `.env` 保留原配置，`media-files.tar.gz` 保留数据目录中的非数据库文件。备份目录仅 root 可访问，文件权限为 600；该次原数据目录仅有数据库及 WAL/SHM，媒体归档无实际媒体文件。升级后完整性 `ok`，原用户 1、画布 1、流水 0、文件索引 0，原列逐行摘要不变，新订单和预留表为空、原账号额外空间为 0，没有写入示例套餐或验收账号。更早的 `pre-cloud-models`、`pre-monochrome`、`pre-ui-refresh`、`pre-8d90e45` 等历史备份继续保留。
- 钱包版本增加表和用户字段；未创建真实订单前也须保留原数据。已有真实发放时，不直接回退到不识别额外容量或充值流水的旧版本；先核对新数据及上传权限，再决定保留数据修复还是经批准恢复对应备份。更早的 `b5519c0` 不支持新增本地存储链路，不能通过删除本地文件适配旧应用。
- 钱包版本已通过 Go 全量、独立 TypeScript、7 项前端回归和完整 Docker 构建；数据库副本迁移、隔离 HTTP 的配额/幂等/权限/流水及资产保留检查、桌面钱包与后台审核、390px 手机充值页和导航检查通过。该次实际站点首页、钱包、充值、后台、登录和健康接口为 200；匿名钱包接口拒绝访问。真实 R2、支付运营、供应商调用及账单核对仍待验证，完整边界见 `docs/progress/pending-test.md`。
- 独立黑白灰仍是确定配色；历史 `ba6db96` 的青绿主题已被用户弃用，后续界面不能再次沿用。

| 轮次 | 已吸收官方 SHA → 新官方 SHA | A/B/C/D 结论与未吸收内容 | 同步分支 / PR | 数据检查、验证与决定 |
| --- | --- | --- | --- | --- |
| 初始基线 | `ccda172efba25cbee990a785bba715b90cc42b95` | 尚无二开功能；尚未执行上游更新 | — | `main` 与初始 `my-version` 同源；未运行构建或测试 |

每次完成或暂缓同步时追加一行，保留完整来源 SHA、决策与验证事实，不覆盖历史记录。
