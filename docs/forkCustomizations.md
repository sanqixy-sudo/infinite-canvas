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

当前访问策略为公开产品首页、登录后进入业务工作空间；下方历史记录中的访客直接编辑和首页工作台路径，已由“公开首页、登录门禁与账号画布保护”替代。历史原档与浏览器真实文件仍保留，登录后依然可选当前浏览器存储。各历史提交的验证范围不自动覆盖本轮改造。

| 功能 | 状态 | 主要代码位置 | 首次提交 | 更新验证 |
| --- | --- | --- | --- | --- |
| 小盟视频工作台品牌与入口 | 部分验证 | `web/src/app/`、`web/src/components/layout/` | `2f23672bbbde1a0aba00ac903bd13a97443ccf36` | 页面品牌、宣传轮播、版本与入口、许可页面 |
| 管理员调点事务保护 | 待验证 | `repository/user.go`、`service/auth.go` | `2f23672bbbde1a0aba00ac903bd13a97443ccf36` | 余额与流水原子性 |
| 内置模型价格显式配置 | 待验证 | `service/settings.go`、`service/workflow_agent.go`、管理后台设置页 | `2f23672bbbde1a0aba00ac903bd13a97443ccf36` | 未配置拒绝、显式零价可用 |
| 模型清单与扣返保护 | 部分验证 | `service/settings.go`、`handler/ai.go`、`handler/video_task.go`、`repository/user.go` | `09d3959` | 模型开放清单、视频时长、失败返还 |
| R2 配置防误用 | 待真实存储桶验证 | `service/storage.go`、管理后台设置页 | `09d3959` | 配置身份、Endpoint、已保存配置容量统计 |
| 项目内多画布与工作台 | 部分验证 | `web/src/app/(user)/canvas/`、`web/src/app/(user)/workspace/page.tsx` | `b5519c011988ea62894883a71518f04526ac7449` | 旧画布、项目归属、同步与删除 |
| 平台云端唯一模型来源 | 部分验证 | 模型配置 store/弹窗、模型选择器、API 调用保护、后端渠道解析 | `22a106cd78ae772b59623890788b67075cccac43` | 禁止个人渠道回退、管理员平台配置、旧数据保留 |
| 用户钱包、个人配额与人工套餐 | 部分验证 | `model/commerce.go`、`storage_quota.go`、对应 repository/service/handler、账户与后台套餐页面 | `11c994ca544dadfd58a804de6267cd0e138c32a4` | 订单幂等与审计、跨 Provider 容量、并发事务、数据保留 |
| 个人存储设置与账号素材库 | 部分验证 | 个人存储页、偏好与素材 store、画布菜单、`account_assets.go`、用户配置补丁事务 | `5022098a1079da1d45a3bfa95cb0d81e6569e5f1` | 浏览器真实文件、账号隔离、单条并发去重、失败重试与引用保留 |
| 素材多级目录与标签组织 | 部分验证 | `account_asset_folders.go`、素材组织 API/store/工具、素材表单、画布选择器与素材包 | `48f5752110282a6e5806e336506f5ee27a4e0cd7` | Go、独立类型/32 回归、构建、隔离接口/浏览器及测试站升级通过；真实场景待验收 |
| 公开首页、登录门禁与账号画布保护 | 部分验证 | 用户首页/布局/登录/工作台、鉴权 store/导航/请求、媒体会话、中间件、BrandMark、演示播放器与画布 store | `1141512` | 分检查点自动/类型/构建、权限和界面播放检查通过；当前 `6c02d21` 已部署、数据保留，线上刷新恢复通过；真实业务待验收 |

### 素材编辑入口与差量标签

- 提交`6c02d210de7d1dc0a923854aadc4a6e36ee0ab37`：素材编辑去单独封面URL/上传，媒体一个文件入口并预览原文件；既有数据保留。标签使用单框标签块/×/回车/下拉，单份回填已有标签，多选显示部分`n/N`并仅差量增删。
- **必须保护**：未操作的独有标签不能传播到其他素材，不能把显示并集当整份写入；只提交明确增删意图，保持现有组织API权威补丁语义。不借简化入口清理既有封面或媒体数据。
- 独立类型、完整Docker均退出0，image-source与完整6c SHA匹配；7项Bun回归（新增差量3＋原组织4）通过、0失败。隔离桌面图片预览/本地保存、标签操作、账号不换文件复用及SQL结果通过；实际站已部署6c，`pre-assets-6c02d21`新备份结构/全行digest一致、用户2/文件索引1/用户配置1，未复用旧摘要。视频/音频实际上传、手机、真实R2与用户验收仍待，详情见待测试。

### 首页锚点统一定位

- 已实现：四个营销锚点id移到标题组div，真实`.page`滚动容器统一`scroll-padding-top:104px`，移除目标重复偏移；原URL、区块留白、FAQ与播放器逻辑不改，无业务数据变化。
- **必须保护**：只由真实滚动容器管理锚点偏移，不在main/section与目标上层层叠加；导航高度变化从统一入口调整，检查标题与控件实际位置，不能只看hash正确。
- 提交`ccf972690ed4b531b007154b94ec896b4620556b`的构建与点击/冷开保留历史；当前6c初始hash恢复在隔离1280与线上1604刷新均通过，标题/控件可见，最终6c全新冷开未重跑，手机/完整业务未测。升级使用最新`pre-assets-6c02d21`独立快照，不能因8表数量相同复用旧摘要，旧`users=1`仅历史，不覆盖或清理真实数据。

### 首页导航与核心能力

- 提交`51074922c922351da0edf87de3f55e40136ac44e`：首页`page.tsx`与私有样式将“创作空间”改为“核心能力”`#capabilities`，对应可见标题与三组能力说明；业务CTA统一进入工作台，无业务或数据变化，旧命名及检查保留历史。
- **必须保护**：导航名称对应可见section标题，营销锚点不能混同工作台入口；业务CTA继续使用会话判断的`startHref`，保留未登录回跳与已登录路径，固定导航不得遮住落点。
- 独立类型、完整Docker与1280桌面深浅主题/锚点/未登录回跳通过，source SHA匹配；实际站已部署510并确认新内容，备份`pre-capabilities-5107492`及8表原数据一致。手机、已登录和业务全量未验收，用户视觉体验待确认，具体证据见待测试。

### 首页 FAQ 与展示层次

- 提交：`ca8d2f2`（平滑问答、演示封面、可视化创作路径与影像收尾）；`8fdde70`（流程图像高度约束）。主要文件为首页 `page.tsx`、`landing.module.css`、`components/landing-faq.tsx` / `.module.css`、`creation-showcase.tsx`。
- `4761e59` 将顶部补充为产品概览、创作空间、功能演示、工作流程、常见问题五栏，分别使用真实同页锚点；创作空间增加滚动留白，避免固定导航遮挡。
- 问答替换原生 details，默认首项展开，单项展开且可全部收起；350ms 高度与透明度过渡，连续操作可反向衔接，减少动态效果时立即切换。按钮保留焦点、aria-expanded/controls；关闭的答案立即 inert + aria-hidden；方向键/Home/End切换问题焦点。
- 演示只增加静态封面和当前标题；必须保留单 video、首次入视口加载、离屏暂停及原播放/键盘逻辑。新增图形是项目/节点/素材结构示意，不作为实际账户内容或模型产出的证明。
- 保护黑白主题、同页锚点与固定导航；结束影像区固定暗底白字以保证照片上的可读性。所有登录入口继续由当前会话计算安全回跳。
- 无数据库、API、供应商配置或用户文件变化。独立类型、构建及桌面/手机问答与布局验证结果见 `docs/progress/pending-test.md`，视觉验收不等同于模型或存储联调完成。

### 首页首屏电影画面

- 目的：用两张真实生成的电影感城市画面替换首页“分镜参考”和“影像片段”的灰色 SVG 占位图，保持既有卡片、连接线、黑白主题与下方四段演示。
- 提交：`78fcdfa`；代码为 `web/src/app/(user)/page.tsx`，删除未使用的 `StoryFrame`。
- 资源：`web/public/showcase/storyboard-city.webp`（800×500，109,166 B）与 `film-city.webp`（800×800，186,956 B），合计 296,122 B。使用内置 `image_gen` 生成，两次独立请求，第二张以第一张为场景参考；原始 PNG 留在本机 Codex 的 generated_images，本项目使用缩小与 WebP 编码后的文件，无外部图片服务依赖。
- 保护行为：分镜为 8:5；后续电影工作室视觉将影像改为约 0.82/0.86 的竖幅预览容器，用 object-cover 保持原图比例与主体。图片是创作流程示意，不冒充实际生成结果或可播放视频。播放装饰无焦点并对读屏隐藏；图片不按主题反色。登录页复用同一组影像。无数据库、API、用户文件或模型计费变化。
- 后续验证：浏览器确认两张图片自然尺寸、手机裁切、深浅主题与无横向溢出；测试站确认本地资源均可读取，不把图片生成工具与本产品模型调用联调混为一谈。

<details>
<summary>完整图像生成提示词（内置工具）</summary>

#### 分镜参考

```text
Use case: photorealistic-natural.
Asset type: cinematic storyboard reference image for the homepage of Xiaomeng, an AI video creation canvas.
Primary request: a beautifully composed real-looking film still illustrating "After sunset, the city begins to tell stories."
Scene: a modern East Asian riverside city just after sunset, layered towers fading into a misty dusk sky, a quiet wet street leading toward the skyline, a small solitary person viewed from behind in the middle distance.
Composition: wide landscape frame about 16:10, cinematic establishing shot, elegant architecture and strong leading lines; readable silhouette and depth even as a small thumbnail.
Style: premium independent cinema, photographic realism, natural surfaces, subtle film grain, restrained charcoal and cool grey with a few warm window lights, realistic reflections, soft atmospheric light. It must feel like an actual captured movie frame, not vector art or a 3D placeholder.
Constraints: full bleed scene only; no UI, border, collage, text, captions, lettering, logos or watermark. No giant moon, neon overload, or crushed black detail.
```

#### 影像片段

```text
Use case: photorealistic-natural.
Asset type: cinematic image/video preview still for the homepage of Xiaomeng, an AI video creation canvas.
Input image: reference only for the same fictional riverside city, atmosphere, character and restrained film grading, not an edit target.
Primary request: create a different second shot in this same cinematic sequence, after sunset the city begins to tell stories.
Scene and subject: the same dark-haired adult woman in a long charcoal coat, now closer, seen from behind at a quiet riverside overlook after rain; softly glowing skyline and bridge across the water, warm lamps and delicate wet-pavement reflections.
Composition: near-square frame, cinematic medium-wide shot, woman slightly left of center in the lower half, waterfront and city layered behind her; clear readable subject at thumbnail size, leave the central area calm enough for a small play icon. A new camera angle and composition, not a crop of the reference.
Style: photographic premium independent cinema, subtle film grain, cool charcoal and grey dusk with restrained amber light, realistic skin/hair/fabric and atmospheric depth, balanced shadows. Beautiful actual movie still, no vector or flat illustration.
Constraints: one full bleed photograph only; no UI, border, text, signage, captions, logos, watermark, collage, giant moon or neon overload.
```

</details>

### 首页与登录电影工作室视觉

- 对应提交：`1874b58` 为主体视觉；`59165a3` 收紧首屏并隔离表单状态样式，`14b2281` 按实际 Ant Design `.ant-input-status-error` 类修正错误态，最终 `448df016c3ec4b954ab9034e4c0ada5f17e0b4f7` 为窄屏账号入口留出空间。
- 仅改用户首页、`landing.module.css`、登录页和 `login.module.css`。首页以原创黑白画布舞台、真实电影影像、脚本与连接端点突出产品；三条能力横带和平面三步流程组织介绍，四段真实演示继续复用原播放器。登录页删除低保真 `ProductSketch`，采用左侧影像与分镜卡、右侧独立居中的账号表单。
- 必须保护：页面主题继续使用共享变量，不按主题反色照片；桌面表单居中、手机折叠复杂影像，长注册表单允许自然滚动。普通输入样式不能盖掉错误或禁用语义；实际 antd 使用 `.ant-input-status-error`，不能只按旧类名排除。正常文案与错误信息均需保持清晰对比。
- 首页品牌回顶部、`#creation/#workflow/#questions` 同页滚动与登录后目标回跳保留，不能将演示章节做成独立页面。普通用户仍需登录进入业务工作台；未改鉴权、表单处理、OAuth、数据存储和模型调用。
- 本轮具体浏览器、构建、资源和测试站记录见 `docs/progress/pending-test.md` 的同名小节；静态视觉改造不代替真实用户业务或 R2 联调验收。

### 功能名称：公开首页、登录门禁与账号画布保护

- 状态与目的：已完成自动、构建及部分隔离/浏览器验证并部署测试站，继续接受用户排版与真实场景验收；公开 `/` 用于介绍产品，原工作台移至登录后的 `/workspace`，业务操作统一先确认真实会话。以独立黑白灰视觉重做公开页和登录页，并使用原创几何 SVG 品牌标识。
- 对应文件：`web/src/app/(user)/page.tsx`、`landing.module.css`、`layout.tsx`、`login/page.tsx`、`login/login.module.css`、`workspace/page.tsx`、`canvas/stores/use-canvas-store.ts`、`web/src/stores/use-user-store.ts`、`web/src/lib/auth-navigation.ts`、`auth-session.ts`、`web/src/services/api/request.ts`、`web/src/components/layout/client-root-init.tsx`、`web/src/components/brand/brand-mark.tsx`、品牌展示与图标文件、`router/router.go`、鉴权/存储中间件及 `handler/storage.go`。
- 原版与二开差异：用户布局仅 `/`、`/login`、`/legal` 公开，其余用户业务页校验登录后展示；私人工作台不嵌入公开页。登录页保留真实注册开关与 LinuxDo 条件入口，无虚构找回密码等功能；手机保留完整操作。原有项目多画布、素材目录和浏览器保存能力不取消。
- 关键依赖：共享 `safeLoginRedirect` 与 `loginHrefForPath`、用户 store 的 `loginWithToken/authError/sessionVersion`、现有 Bearer 鉴权及 localforage；回跳默认 `/workspace`，只允许安全站内路径，不由普通用户逻辑覆盖目标。OAuth Token 验证成功才接收，敏感回调参数清出地址栏，错误可读。
- 会话与 API：无新业务响应格式；401 仅清理与请求 Token 和会话版本仍匹配的当前登录，403 不自动退出，网络校验错误显示重试。直接 fetch 的统一观察仅作用同源 `/api/`。`POST /api/files/session` 需 Bearer 并建立 `/api` 范围只读 HttpOnly Cookie；DELETE 清理，前端串行同步防旧响应覆写。普通登录、`/me`、文件元数据不再隐式设置 Cookie；只读素材/提示词/技能和图片代理可用阅读会话，写入仍用 Bearer。
- 画布数据：原 `infinite-canvas:canvas_store` 原文只读保留，新缓存用 `infinite-canvas:canvas_store:user:<userId>`，含 `ownerId/restoredLegacyRootIds`。远端已确认为本人的同 ID 旧项目可合并，未知归属项目不自动上传；控制台通过 `readLegacyCanvasProjects()` 和 `restoreLegacyCanvasProjects(rootIds)` 让用户明确选择，以全新 ID 恢复选定项目及全部画布、重映射 `workspaceId`、清除旧 Codex 线程引用，原档保留且已恢复根按账号记录。无新增后端恢复接口，沿用现有保存/同步。
- 数据库变化：无新表、字段或迁移；浏览器账号分桶不迁移服务器文件归属。恢复本地引用仍需要原文件，恢复他人 `server:` 引用不授予访问权；不删除历史访客档案、素材、任务或真实数据。
- Git 提交与检查点：功能 `1141512`、Go 官方 gofmt `ff99112`；Go `go test ./...` 全量、独立 `tsc` 与合计 38 项 Bun 回归通过，不是本轮新增 38 项。最终源码 `fca04adc3709c4bdede7d7ea47b11313bdeb8ceb6` 仅再移除登录跳转后多余刷新及调整首页阴影 CSS，完整 Docker 构建退出 0，测试站镜像为 `xiaomeng-video-workbench:fca04ad`；不以构建代替独立类型检查，历史 `86b07b0` 另行保留。
- **必须保护的行为**：公开页不展示私人项目；未验证会话不进入业务页；合法目标回跳、OAuth 失败可见；退出/切号后旧响应不污染新账号；阅读 Cookie 不提供写权限；旧全局档案不改写/删除，未知归属不静默上传，副本恢复不转移别账号文件权；登录后仍可用当前浏览器保存，模型仍只走平台云端。
- 品牌保护：共享 `BrandMark` 与浏览器图标保持原创 SVG，随深浅主题显示；不恢复官方轮播、推广、GitHub 或版本入口，不因此删除 LICENSE、作者署名或 `/legal`。
- 已有验证：隔离 HTTP 通过公开页与图标 200、匿名业务/代理/旧匿名上传 401、显式媒体 Cookie 剩余期/HttpOnly/Path=/api、Cookie 只读不能写、无效 Bearer 不回退、普通用户后台 403、`/me`/FileInfo 无 Cookie 副作用、本人/签名媒体读取及裸私有文件拦截、退出双路径清理。浏览器通过登录/退出和错误密码提示；A→B 后 B 空工作台，旧 2 项仅作默认不选的恢复提示，手动恢复一项生成新 ID、保留另一项提示，刷新后不重复恢复。`fca04ad` 已复测深链精确为 `/assets?scope=local#folder`，A/B 的账号及浏览器素材隔离；首页深浅主题、390×844 首页/登录无横向溢出和手机完整表单通过，注册只查看确认密码，未创建新账号。
- 排版后续提交：`697ca4b741058e53c2dd6541711cb38b80a2d050` 只调整首页/登录及两份私有样式，缩短首屏空白、放宽标题字距、增强说明对比，三张示意卡使用正常 grid，固定导航保留同页流程与回顶部；登录页头走文档流、双栏各自居中、手机压缩简介，页面 `100dvh` 可纵向滚动。最终 `016f30f81e8a0aae62ef86b1866bb0b0485f7f381` 仅补登录标签 22 px 高度。697 完整构建和独立类型顺序重跑通过，016 完整 Docker 退出 0；Go/38 项仍属于 114/ff 检查点，未冒称重跑。
- 排版验证：016 首页/登录在 1920×911、1366×768、1024×768、768×1024、390×844、320×640 均无横向溢出，三卡无交叠；桌面表单与按钮在首屏可见，320 注册空提交的 3 条中文错误后原生滚动可到按钮。深浅主题、手机同页流程固定导航无遮挡、品牌回顶部、登录/返回首页通过，详细数值及截图检查点见待测试。**必须保护**：不要恢复绝对百分比叠放、锁死长表单滚动或把流程链接改成离开首页；布局可达检查不代替实际注册成功。
- 首页演示后续：`61997d9` 新增 `creation-showcase.tsx` 与 4 个 MP4/4 张 JPG，替换创作方式文字卡；`ad9c43d` 去掉窗口焦点限制，最终 `2d9910e075cf36fa2d3d438b984e27493f47dedc` 集中播放 effect 并防旧 Promise 提示污染。保留用户原 ZIP，Pillow/ffmpeg 将 173,266,848 B WebP 转为 H.264 720×406/24 fps 的 MP4 与海报，总 6,943,929 B（约减 96%）；只有当前 video、入视口才设置 src、preload none、离屏/隐藏暂停、减少动态效果默认停且不自动轮换，支持选段/键盘/重试。**必须保护**：不能改成四段全预载，不以演示文案承诺未开放模型能力。最终2d独立类型与完整构建均退出0，已部署测试站；Go/38项不冒称在媒体提交重跑。
- 媒体验证：首屏1个video无src/currentSrc空且暂停；滚入后4段实际播放均ready4/720×406且无error，手动暂停选段不打破暂停，不手动选片时观察到自动轮换（不做固定秒数下一帧断言）。回顶部离屏暂停、返回可继续，手机前后闭环及End选段/移焦通过；1440/1024/768/390/320等宽且始终1video，深浅主题和手机已查看。4 JPG HEAD为200/image/jpeg，4 MP4 Range0-1023为206/video/mp4/1024B且总长正确。减少动态效果/隐藏标签暂停尚未真实偏好或切标签实测，故障恢复未注入；完整范围和截图见待测试。
- 四段演示阶段剩余验证：2d已部署且原数据一致，016保留阶段历史，排版体验仍等待用户验收。减少动态效果/隐藏标签、播放受限/故障重试/快速切段竞态，真实注册、注册开关/LinuxDo/OAuth、断网与长期切号、完整键盘焦点，真实旧原档、多画布归属/文件缺失和历史同步仍待验收。真实模型供应商与 R2 仍待资源，不把页面改造视为已联调。
- 跨标签退出验证：最终 `fca04ad` 镜像中，第二标签退出后，第一画布标签立即卸载画布并转向携带原 canvas 返回路径的登录页，真实浏览器已通过；上游更新需保留此行为，不只在后续请求时报错。
- 上一轮四段演示部署与备份：镜像 `xiaomeng-video-workbench:2d9910e`，仅更新 app，继续 `127.0.0.1:3001 → 3000` 及原 data 挂载，OpenResty 未改；`backups/pre-showcase-2d9910e/` 保存完整性 `ok` 的 SQLite 在线副本、Compose/`.env` 私有副本、媒体归档和原行摘要，目录 700/文件600。停旧应用与新启动后8表结构/全行SHA256一致，用户/画布/设置各1、其余5表0；实际页与健康200、展示资源HEAD/Range正确，匿名素材与图片生成401。隔离preview已停止、数据保留；fca和016备份/检查继续保留历史，详见维护手册及待测试。
- 回滚保护：保留数据库、媒体、配置、原全局画布键与各账号浏览器分桶；回退旧客户端前评估是否重新混用全局缓存和开放访客业务页，不通过清空旧档完成回滚，未执行实际数据回滚。

### 功能名称：项目内多画布与首页工作台

- 状态与目的：部分验证；项目优先工作台现位于 `/workspace`，一个项目包含多张可独立编辑的画布。首次实现位于首页，已由本轮公开首页与登录策略替代；项目层级不变。
- 对应代码位置及涉及文件：`web/src/app/(user)/workspace/page.tsx`、`web/src/app/(user)/canvas/page.tsx`、`web/src/app/(user)/canvas/project/[id]/page.tsx`、`web/src/app/(user)/canvas/stores/use-canvas-store.ts`、`web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`、`web/src/app/(user)/canvas/components/`、`web/src/components/layout/app-top-nav.tsx`。
- 官方原版行为与二开差异：原版画布列表为平铺单层；二开版以现有画布作为项目首张画布，通过 `workspaceId` 将新增画布归到同项目，并用 `workspaceTitle` 独立记录项目名称。旧画布没有这些字段时仍作为单画布项目显示。
- 关键依赖：Zustand 画布 store、localforage、现有画布同步 API 与压缩包导入导出。旧全局键只读保留，当前写入按账号分桶；已确认归属的原 ID 保留，未知归属的显式恢复使用新 ID，详见上节。
- 数据库变化：无；附加字段保存在既有画布 JSON 中，不执行表迁移或历史数据搬移。
- API 变化：无；现有画布保存、同步和删除接口继续传完整 JSON。
- Git 提交与关联 PR：`b5519c011988ea62894883a71518f04526ac7449`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)。
- **必须保护的行为**：登录后本人旧画布可读取，未知归属原档可明确选择恢复副本；同项目新增画布继承归属；项目重命名不改画布内容；导出项目包含全部画布，导入时恢复归属；删除项目明确告知画布数量并一次删除同项目画布；前端与账号同步保留画布新增字段。
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
- **必须保护的行为**：登录页、用户页、画布列表、管理后台和浏览器标题显示小盟品牌；当前首页文案与原创 Logo 按上节的新公开页设计保护，不再要求保留早期创作输入区标题；原有画布原档保留；顶栏不展示 GitHub 图标、官方版本号、官方公告或许可与源码入口；首页不加载官方宣传轮播及外部推广链接；404 页面不展示 TokenDance 等推广公告；登录页不展示原冗余登录方式说明。
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
- 官方原版行为与二开差异：官方未找到价格配置时默认 0 点；二开版拒绝未配置价格的系统模型调用，管理员明确设置 0 才表示免费。原版本曾保留个人渠道单独调用，现已由“平台云端唯一模型来源”替代，个人模型渠道不再开放。
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
- **必须保护的行为**：渠道存在不等于模型已开放；未填价格不能免费调用；零价须明确配置；扣点失败不发起上游请求；普通 AI 失败返还、视频任务失败返还与流水一致。原个人渠道例外已由“平台云端唯一模型来源”取消。
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

### 功能名称：紧凑工作台、账户用量与商业账务审计

- 状态与目的：已通过隔离构建与部分交互检查，待用户验收；首页突出最近项目和真实访问记录，普通用户页统一侧栏，补齐账户流水和公开价格，统一从项目画布创作。
- 对应代码位置及涉及文件：用户 `layout.tsx`、首页、`canvas/components/`、`canvas/stores/use-canvas-activity-store.ts`、`account/`、`models/`、`music/`、`constant/credits.tsx`、`lib/platform-model-catalogue.ts`；后端 `handler/account.go`、`service/account.go`、`model/account.go`、`repository/user.go` 及后台用户/流水页面。
- 原版与二开差异：首页以工作恢复为主，项目与画布有真实内容预览和统一创建路径；新增用户本人流水与平台模型价格展示；流水只能由真实余额业务生成，后台不能独立篡改或删除；音频页复用已有配音任务与素材保存。
- 关键依赖：现有用户鉴权、公开模型配置、扣返事务、Zustand/localforage、画布 JSON 和音频任务。项目仍由首张画布承载归属，不在本轮迁移真实数据。
- 数据库和 API：无新增表；新增 `GET /api/v1/credit-logs`，固定当前用户身份；旧流水写接口返回 405；调点必须显式有效余额。最近打开记录按账户保存在浏览器。
- Git 提交：`dc13200bb42291e9ea4ac46c29aed17b0e871d05`、`8d90e45e06d2ab0886aafbab452131e9f5a9aa0e`；草稿 PR #1，尚未合入 `my-version`。
- 必须保护的行为：首屏能找到项目；同项目切换画布；不把访问记为内容修改；既有项目与素材可恢复；本人流水隔离；显式 0 才免费；工作流按次和普通视频按向上取整秒数估价。原“个人渠道保持原路径”已由“平台云端唯一模型来源”替代。独立图片、视频、音频入口隐藏，统一在项目画布创作；模型页不能再跳往独立生成页面。
- 更新后验证：Go 全量测试、Next.js/Docker 构建和 6 项 Bun 测试通过；隔离 HTTP 验证本人流水隔离和调点审计，访客浏览器验证新建项目、多画布切换及手机导航。真实旧数据界面、供应商和 R2 联调未完成。
- 数据保护与回滚：保留旧 JSON 与本地存储键，升级前备份 SQLite 和媒体；代码回滚不能删除新增流水或真实素材。

### 功能名称：默认本地存储与可选 R2

- 状态与目的：已通过历史版本隔离本地存储检查，待真实 R2 和用户验收；账号文件默认后端为服务器持久目录，R2 管理员显式配置后可选。个人新素材默认保存浏览器的规则见下方“个人存储设置与账号素材库”，替代原登录即默认上传行为；此节保留服务器存储能力及历史验证。
- 对应文件：`config/config.go`、`model/setting.go`、`model/storage.go`、`repository/storage.go`、`service/storage.go`、`service/storage_local.go`、`handler/storage.go`、`middleware/storage.go`、`router/router.go`、后台存储设置、前端图片/媒体存储和相关素材引用/导入导出链路。
- 原版与二开差异：新增 `local` 和 `r2` 默认模式；本地文件通过既有索引管理；私有媒体按所属用户、管理员或单文件凭证读取；只读 HttpOnly 会话支持长开页面，写请求仍用 Bearer。
- 关键依赖：`LOCAL_STORAGE_DIR`（默认 `data/storage`）、`/app/data` Docker 挂载、`storage_objects`、JWT、既有 S3 兼容接口。切换只影响新上传，旧对象保留原提供商 ID 和位置。
- 数据库与 API：无新增表；存储设置 JSON 增加模式，`storage-local` 为本地固定提供商；元数据需要所属用户鉴权，内容支持 GET/HEAD/Range；退出清理阅读 Cookie。
- Git 提交：`dc13200bb42291e9ea4ac46c29aed17b0e871d05`、`8d90e45e06d2ab0886aafbab452131e9f5a9aa0e`；草稿 PR #1，尚未合入 `my-version`。
- 必须保护的行为：未配置 R2 也能持久保存账号文件；切换不清空文件；有引用的旧桶配置不能被误删；私有文件不能被其他用户枚举读取/删除；路径不能逃出配置根目录；导出带齐文件、导入不依赖原服务器文件 ID；公共素材保存为用户副本后不受临时链接过期影响。
- 更新后验证：Go 和隔离 HTTP 已验证本地上传、Range/HEAD、跨用户拒绝、限时签名和退出、R2 无配置拒绝切换；Bun 验证真实 ZIP 往返及缺失素材拒绝。测试站点更新后原数据数量与完整性保持一致。长时间播放、重启后媒体引用和 R2 真正读写仍需验收。
- 备份与回滚：SQLite 与 `data/storage` 一起备份；切换到 R2 后仍保留本地目录及旧 R2 配置；不靠清空数据解决升级问题。

### 功能名称：创作工作台视觉体系

- 状态与目的：已完成构建及隔离浏览器检查，待用户验收；让首页、项目管理和画布形成统一的创作界面。
- 对应文件：`web/src/app/globals.css`、`web/src/lib/app-theme.ts`、`web/src/lib/canvas-theme.ts`、`app-providers.tsx`、主题 store 与根 layout、工作台首页、`workspace-shell.tsx`、项目列表/详情、画布卡片/预览和账户操作组件；`web/package.json`、`bun.lock` 显式复用已锁定的 CSS-in-JS 依赖。
- 原版与二开差异：按用户确定的独立黑白灰方向，使用中性浅灰/白色与黑色/石墨灰表面，银白主按钮；新访客默认深色，已保存偏好不覆盖。统一 16:10 预览、导航、版心与空态，首页根据真实访问记录恢复创作。外部参考只用于理解功能，不沿用其品牌配色。
- 关键依赖：语义 CSS 变量、Ant Design ConfigProvider 与 StyleProvider 的样式层级、`canvasThemes`、原主题持久化键和现有项目/访问 store。SSR 必须先声明 `theme, base, antd, components, utilities` 顺序，避免 Ant Design 链接重置覆盖工作台的按钮和导航。
- 数据库与 API：无变化；未修改模型协议和价格/扣返规则。
- Git 提交：布局与样式层级 `ba6db967ae6a4a05a62a6657f25e7e103b6c0f31`，黑白灰配色修正 `4c69c61d801d39551d3a1985381a46793d7eb5cf`；草稿 PR #1，尚未合入 `my-version`。
- 必须保护的行为：保持独立黑白灰配色；图片/视频/音乐独立入口继续隐藏；新建项目进入画布，项目内多画布和导入导出保留；浅深色主题与画布配色一致；尊重已保存偏好；触屏可选择画布，键盘焦点可见。
- 更新后验证：桌面、390px 手机、浅深色主题、新建与切换画布；具体结果写入 `docs/progress/pending-test.md`。
- 回滚要求：可回退视觉代码，保留原项目、媒体和主题存储键，不清理用户数据。

### 功能名称：平台云端唯一模型来源

- 状态与目的：部分验证；所有用户创作及画布助手统一使用平台商业云端模型，普通用户不再配置自己的模型渠道。
- 对应文件：`web/src/components/layout/app-config-modal.tsx`、`client-root-init.tsx`、`web/src/components/model-picker.tsx`、`web/src/stores/use-config-store.ts`、`web/src/services/api/cloud-model-access.ts` 及图片/视频/音频/助手/工作流/转译/直连调用、画布助手与 Codex hook、TokenDance 回调；`handler/ai.go`、`router/router.go`、`service/settings.go`、`service/user_data.go`、`service/workflow_agent.go`、`service/workflow_resolve.go` 与平台 AutoDL 元数据链路。
- 原版与二开差异：隐藏并拒绝个人渠道、用户填入的地址/密钥及浏览器协议；模型清单和工作流只取管理员开放的平台配置。新访问策略要求登录后使用画布；历史访客档案保留，登录后仍可选浏览器存储。旧本地模型配置、URL 注入、个人工作流引用和视频转译快照不能恢复原调用路径。
- 关键依赖：现有账号鉴权、平台公开模型设置、服务端协议适配和任务管理；管理员后台仍可维护平台渠道并完成 TokenDance 授权。该限制与服务器本地、R2 或浏览器素材存储无关。
- 数据库变化：无新增表和迁移；已有个人配置不主动删除，不恢复到创作配置。用户、余额、任务、项目和素材保持原数据。
- API 变化：AI 调用拒绝 `X-User-Model-Channel-ID`；工作流仅接受 `scope=system`；直连计划和个人工作流/Bridge 配置入口停用；用户模型配置仅保存普通偏好和系统工作流引用，拒绝个人渠道及密钥字段；AutoDL 元数据按登录用户的平台渠道 ID 解析，不接受自定义 Base URL。详细响应见 `docs/backend/api-response.md`。
- Git 提交与关联 PR：`22a106cd78ae772b59623890788b67075cccac43`、`f7772dafcb9ac90594950b63cf911bc1da6bf6ff`；草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)，尚未合入 `my-version`。
- **必须保护的行为**：所有生成和助手调用经过平台渠道与登录校验；无法取得平台模型时明确提示，不回退个人模型；服务端校验不能只依赖隐藏 UI；旧配置、旧任务或 OAuth 回调不能绕过；供应商密钥不下发普通用户；平台协议能力和本地素材存储保留；暂停定价扩展不绕过已有扣返保护。
- 上游更新检查：对设置恢复、模型解析、请求头、协议创建/轮询、工作流、助手模式和 OAuth 回调做语义检查，禁止上游重新开放个人渠道。修改存储代码时区分模型来源与素材保存方式。
- 验证方法与最近结果：Go 测试、独立 TypeScript 检查、7 项前端回归和完整 Docker 构建通过；隔离 HTTP 确认个人配置、请求头、工作流和任意地址元数据被拒绝，普通偏好仍可保存。手机/桌面浏览器确认无个人渠道入口，未登录模型为空且提示登录。测试站点运行 `f7772da`，升级前完成在线备份，升级后健康接口 200、数据库完整性及既有记录数量不变。管理员真实渠道、供应商任务及 R2 尚缺资源，不能声称实际生成或对象读写已验证。
- 备份与回滚：发布前备份 SQLite、配置和媒体；保留历史个人配置但不开放调用，回滚代码不得删除用户数据，也不能无审查恢复个人渠道权限。

### 功能名称：用户钱包、个人配额与人工套餐

- 状态与目的：部分验证，待用户验收；让用户查看真实余额与个人空间，申请算力充值或永久存储扩容，由管理员核实收款后发放。
- 对应代码位置及涉及文件：`model/commerce.go`、`model/storage_quota.go`、`model/user.go`；`repository/commerce.go`、`repository/storage_quota.go`、存储文件索引与数据库迁移；`service/commerce.go`、`service/storage_quota.go`、上传链路；`handler/commerce.go`、路由；`web/src/hooks/use-account-wallet.ts`、钱包事件与显示工具、`services/api/commerce.ts`、`admin-commerce.ts`、账户页、`account/recharge/`、后台 `admin/commerce/` 和用户余额入口。
- 原版与二开差异：原有账号余额和手动调点继续使用；新增个人空间统计、人工申请、订单快照、充值流水和永久额外存储。没有默认商品或价格，创建申请不会付款或即时到账；在线支付、订阅、退款和供应商计价公式均不在本轮扩展。
- 关键依赖：现有用户鉴权、`users`/`credit_logs` 事务、文件索引、local/R2 等 Provider、TanStack Query 钱包刷新和独立黑白灰主题。模型来源继续固定平台云端，访客本地画布和素材不占服务端额度。
- 数据库变化：新增 `purchase_orders` 与 `storage_upload_reservations`；`users.storage_extra_bytes` 默认 `0`；`settings.commerce` 独立保存套餐与免费基础空间，未配置为 1 GiB，普通系统设置不能覆盖。新增 `recharge` 流水类型关联订单，不能复用 `admin_adjust` 混淆人工调点。
- API 变化：新增用户钱包、本人订单创建/列表/取消，后台套餐设置及订单列表/审核；详细字段、校验及状态见 `docs/backend/api-response.md`。不接受客户端传入价格、权益或其他用户身份。
- Git 提交与关联 PR：功能 `11c994ca544dadfd58a804de6267cd0e138c32a4`，最终代码 `5d032583aab3a579951e0d4a19c160432498f5f8`；沿用草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)，正式合入仍须批准。
- **必须保护的行为**：每人额度为可调整基础空间加已购永久空间；跨本地/R2 合并计量，切换不重置；服务端预留与终结两次校验阻止并发超额；降低额度不删除旧文件；后台编辑用户保留额外容量；套餐改价/停用不改已有快照；同请求重试返回原订单；同账号待审最多 20 笔；审核事务重复执行只发放一次，写流水失败整体回滚；本人订单与钱包隔离，管理员确认须填写收款核实备注。
- 上游更新检查：重点检查用户保存、余额操作、文件上传/删除/直传注册、容量统计、迁移列表、系统设置保存和钱包缓存；不能因上游覆盖普通用户字段而清零额外容量，也不能跳过服务端上传配额或重建账务流水。
- 验证方法与最近结果：Go 全套、独立 TypeScript、7 项前端回归和完整 Docker 构建通过。数据库副本迁移、隔离 HTTP 的额度/订单/流水/资产保留检查、浏览器用户申请至管理员确认、后台套餐回填和 390px 手机布局通过；测试站点升级后原记录内容不变。订单并发、幂等、快照、失败回滚、权限及预留使用回归测试继续保护，详情见 `docs/progress/pending-test.md`。真实收款运营、R2 与供应商仍待联调，不把测试申请当作真实付款。
- 备份与回滚：部署前备份数据库、设置、文件及配置；不能清空订单、流水或用户容量。已产生真实发放后，回退旧应用须评估其是否识别 `recharge`、额外容量和上传配额；必要时通过保留数据的新修复提交恢复，不删除表或重置余额。

### 功能名称：个人存储设置与账号素材库

- 状态与目的：已完成自动回归、完整构建、隔离检查和测试站升级，真实用户与资源场景仍待验收；让用户选择新素材默认保存当前浏览器或账号素材库，保留手动入库能力和真实保存状态。
- 对应代码位置及涉及文件：`web/src/app/(user)/account/storage/page.tsx`、账户入口、`web/src/stores/use-storage-preferences-store.ts`、`use-asset-store.ts`、`web/src/services/api/storage-preferences.ts`、账号素材 API、`web/src/services/account-asset-save.ts`、图片/文件存储与生成结果保存、画布节点菜单及保存状态 hook；`service/account_storage_preferences.go`、`service/account_assets.go`、`service/user_data.go`、`service/storage.go`、`service/generation_log.go`、`repository/user_config.go`、`handler/user_data.go`、`router/router.go` 和相关测试。
- 原版与二开差异：不再把整个浏览器素材列表同步成账号列表，也不默认将所有登录用户的新媒体上传服务器；偏好缺省为 `false`，真实浏览器文件与账号云条目分开管理。右键和手机菜单可显式存入账号素材库，文件上传与条目登记都成功才显示完成，失败保留内容并可重试。
- 关键依赖：用户会话、IndexedDB/localforage、现有文件归档及权限、个人配额、`user_configs` 补丁事务和账号素材 store。模型来源继续固定平台云端；服务器本地磁盘/R2 的管理员选择独立生效。
- 数据库变化：无新表或列；`user_configs.model_config.autoSaveAssetsToCloud` 保存单字段偏好，独立接口为权威；`asset_data` 继续保存账号列表，单条事务合并保留历史 JSON 及扩展字段。
- API 变化：新增 `GET/POST /api/v1/storage-preferences` 与账号素材单条 POST/DELETE；读取列表沿用原接口，旧批量覆盖 POST 返回 405。媒体新写入必须引用本人 `server:<id>` 文件，服务端确认 MIME/字节数；文本支持直接内容，响应禁止缓存。详细契约见 `docs/backend/api-response.md`。
- Git 提交与关联 PR：后端功能 `5022098a1079da1d45a3bfa95cb0d81e6569e5f1`，前端功能 `8b674878e43bbbc42c770aca355080fcd7d5d7d9`，最终前端验证检查点 `f9538f959f24d55aa26bdd3288de5b2ba73b60ea` 已推送；沿用草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1)，正式合入仍须批准。
- **必须保护的行为**：默认和偏好未就绪时浏览器保存真实文件；访客/账号本地分区保留，账号切换丢弃旧异步响应；勾选设置只影响后续保存，不静默搬移历史文件；模型配置整份保存不能覆盖最新存储偏好；账号素材单条写入不丢并发条目，同 ID 重试及同文件跨 ID 去重；本地键或他人文件不得冒充云素材；生成成功与入库成功分别提示；失败可手动重试且复用已归档文件。
- 文件复用与编辑保护：缓存只保留归档元数据，重试仍合并最新名称、标签和备注；明确文件失效才移除映射，账号变化清缓存。稳定浏览器键可生成独立 `browserSourceId`，跨刷新从当前账号条目复用归档；不得将 Token、Blob、Base64 或外链 URL 记为身份，不得把身份字段当作文件引用或权限证明。图片入库完成后的助手引用回写也要核对当前节点来源，不能用旧图覆盖新图。
- 引用与删除边界：删除素材库条目只移除记录，不物理删除文件或索引，也不直接释放个人额度。其他画布/历史引用仍须保留；归档成功但登记失败的文件可能占用额度。物理删除或清理必须另行核对引用和权限，不能用批量清理解决入库失败。
- 上游更新检查：重点检查用户配置整份保存、素材列表同步、登录初始化、账号退出、文件持久化、生成结果回写、菜单与自动清理；不得恢复整份列表覆盖、把旧本地键自动上传或让浏览器临时 URL 伪装持久云文件。服务器 R2 与用户默认去向不得混为同一开关。
- 验证方法与最近结果：`go test ./...`、最终 `f9538f9` 的独立 TypeScript 和 20 项前端回归通过（原有 7、自动保存 6、素材 store 3、偏好 1、手动保存 3），含跨刷新源复用；完整 Docker 退出码 0。隔离 HTTP 验证独立偏好、归属和权威字段、并发 13 条保留、幂等去重、隔离/405、删除条目保留文件占额及实际删文件归零。桌面图片本地刷新、右键入库、开启后自动入库、390px 偏好保持及菜单通过。测试站已升级 `xiaomeng-video-workbench:f9538f9`，数据库 8 表原行摘要完全不变；真实旧浏览器、视频/音频实机、供应商和 R2 仍待联调，故障恢复仅由自动回归覆盖。详情见 `docs/progress/pending-test.md`。
- 备份与回滚：本轮升级前保存 `backups/pre-storage-f9538f9/` 的 SQLite 在线备份、Compose、环境配置、媒体归档及原记录摘要；服务器原数据未改变。浏览器各账号/访客 localforage 仍须另行保留，不清空旧列表或文件键。回退到旧整份素材同步版本前先评估是否会将本地引用写入账号列表或覆盖并发数据；优先保留数据修复，不以删除数据回滚。

### 功能名称：素材多级目录与标签组织

- 状态与目的：已完成自动、隔离与测试站升级检查，真实用户/资源场景仍待验收；让一份素材以多级目录和标签分类，可同时归入多个目录，避免为了分类重复上传或复制文件。此功能扩展上方个人存储规则，不改变平台唯一云端模型、钱包或服务器本地/R2 后端选择。
- 对应代码位置及涉及文件：`model/asset_library.go`、`service/account_asset_folders.go`、`service/account_assets.go`、`service/user_data.go`、`handler/user_data.go`、`router/router.go`；`web/src/lib/asset-organization.ts`、`web/src/services/api/asset-organization.ts`、`web/src/stores/use-asset-store.ts`、`web/src/components/assets/asset-form-modal.tsx`、`web/src/app/(user)/canvas/components/asset-picker-modal.tsx`、`web/src/app/(user)/assets/asset-transfer.ts` 及素材页面相关交互。
- 原版与二开差异：在原分类与标签之外增加目录树及 `folderIds` 多归属；账号与浏览器各自管理目录，画布选择器支持位置、目录/下级、面包屑与标签组合筛选。表单优先明确目标位置和当前目录，未显式指定时才使用个人默认偏好，编辑保持实际归属；游客不能假存到账号。
- 关键依赖：当前用户鉴权与会话守卫、用户锁内 JSON 补丁事务、账号/浏览器分区、localforage 真实文件、单条归档与文件权限。普通文件归档/自动保存和目录组织分别处理，不能用上传成功代替整理成功。
- 数据库变化：无新增表、列或迁移；复用 `user_configs.asset_data.folders[]` 与 `assets[].folderIds/tags`，原分类、未知扩展和其他素材保留。浏览器目录保存在相应 owner 分区，不因登录自动写入账号库。
- API 变化：新增 `POST /api/v1/user-data/asset-folders`、`DELETE /api/v1/user-data/asset-folders/:id`、`POST /api/v1/user-data/assets/organize`；素材快照返回 `assets/folders`。新建条目可带有效组织字段，已有条目的普通整份保存和重试保留最新 `tags/folderIds`，组织 API 是修改这些字段的权威入口。
- Git 提交与关联 PR：功能 `48f5752110282a6e5806e336506f5ee27a4e0cd7`，Go 标准格式 `53e3494ce90601867c8a1e1456b053f9c553a004`，功能检查点 `1115c6f4bac0ca6c76d850fc3ef904df99c0148c`，最终样式与部署源码 `86b07b00b7e586f71998441cd723f919fcf5a56d`。草稿 PR [#1](https://github.com/sanqixy-sudo/infinite-canvas/pull/1) 已更新为本轮素材库交付，目标 `my-version`，尚未正式合并。
- **必须保护的行为**：一份素材多目录归属不复制文件；父子关系有效且不循环，同级不重名；最多 1000 目录、8 层、每素材 32 归属、每批 200 素材、每素材 50 个且每个最多 80 字的标签，目录名最多 80 字。新增/替换目录输入最多 32 个，移除输入可达 1000 个，最终单素材仍最多 32 归属。非法或越权目标整批失败，旧整份保存不得撤销并发整理；新建账号条目可使用本账号目录，本地归档不携带本地目录 ID。
- 导入导出保护：ZIP 包包含目录、归属、分类、标签、实际媒体和独立封面；账号文件无本机缓存时读取实际授权文件，缺失明确失败。导入始终生成全新目录、素材与浏览器文件 ID 并重建映射，不复用他人 `server:` 引用，不覆盖已有条目，不自动批量上传。集合插入前整体校验；包装使有效原树超过 8 层或 1000 目录时省略包装，所选父级容不下原树则提示改选根目录，整体仍无效时不部分写入元数据。
- 删除与数据保护：删除目录及其下级仅删除组织元数据和相应归属，素材、其他归属、文件、画布及历史引用继续保留，不因此释放配额。不存在用清空数据或删文件解决目录冲突的例外。
- 上游更新检查：重点审查素材序列化、普通整份保存、去重重试、目录父子关系、标签 patch、账户初始化、浏览器 owner 分区、素材包文件重建及清理。即使 Git 无冲突，也检查是否把目录扁平化、把本地目录 ID 写入账号、重新用旧快照覆盖组织字段或在删目录时删文件。
- 验证方法与最近结果：`go test ./...` 全量通过（含目录并发、删目录保文件等）；`1115c6f` 独立 TypeScript 与 32 项 Bun 回归退出 0，构成为目录工具 4、原有 7、自动保存 6、素材 store 11、个人偏好 1、手动保存 3；`86b07b0` 完整 Docker 构建退出 0。隔离 HTTP 验证树/多归属、跨用户及无效批量原子拒绝、并发标签与旧快照不覆盖、删目录保留素材/索引和 232 B 占用。浏览器实测子目录创建、2 素材多目录与“已精选”标签、详情一致，ZIP 含 2 素材/5 目录/1 SVG，导入本机为含包装层的 6 目录且账号不变，刷新后 Blob 图片宽 800，画布按子目录筛选并插入图像。最终 `86b07b0` 查看深浅主题；390×844 宽度无溢出，目录抽屉选中子目录后 2 条素材/面包屑更新并关闭。实际测试站已升级 `86b07b0`，页面健康及匿名组织接口拒绝检查通过。上述分范围结果不冒充全部流程在最终样式提交重新执行；真实旧数据、视频/音频实机、供应商及 R2 仍待验收，详见 `docs/progress/pending-test.md`。
- 备份与回滚：升级前 `/opt/xiaomeng-video-workbench-deploy/backups/pre-folders-86b07b0/` 保存 SQLite 在线备份、Compose/`.env` 私有副本和媒体归档，目录 700、文件 600。停应用及新容器启动后 8 表结构和全部行 SHA256 与备份一致、完整性 `ok`；原用户/画布/设置各 1，其他 5 表为 0。仅应用更新，原 `data` 挂载和 OpenResty 保留。浏览器分区仍须另行备份；回退旧客户端/服务端前核对 `folders/folderIds` 和标签权威语义，无新表不等于无 JSON 丢失风险，不删除目录树或文件适配旧程序；未执行数据回滚。

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
