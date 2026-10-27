# newtoken 特殊渠道 · 720×1280

接入 Seedance 2.0、2.0 Fast、2.0 Mini、2.5 四个模型，当前特殊渠道全部限定 **720×1280 竖屏**，每个模型独立配置 Token 价格。链路是 **画布 → 中间件 → 你的 NewAPI → NewToken**，不读取供应商消费账单。0.2.2 保留总 Token、输入／输出不同价及预扣退补，继续满足展示样例最多16条的导入限制；实际结算依据任务响应中的有效用量，用户售价和用户钱包由画布平台后端管理。

## 文件与安装条件

- 插件：`plugins/tasks/xiaomeng-newtoken/0.2.2/plugin.js`，保留0.1.0、0.1.1、0.2.0、0.2.1历史文件。
- 元信息在文件的 `export const meta` 中，无需额外 manifest。
- `fixtures/` 是无密钥的合成协议样例。0.1.0 的11项离线用例曾在禁用网络的隔离Node22容器通过；后续版本按项目要求未运行编译或测试，不能沿用旧版本通过记录作为新版验证。用户实际导入0.2.0时触发展示样例数量限制，0.2.1已修正；本次0.2.2真实NewAPI实例导入、输出尺寸与计价仍待用户完成。
- New API 对全局 `usageExamples` 和每个 `usageProfiles.examples` 分别限制最多16条，每条标签最多48个Unicode字符。0.2.2全局及四模型分别只有8条：4种预扣/结算场景 × 固定720p × 有/无参考视频。超预扣和零用量边界保留在测试中。
- 此前已核对官方发布 `v1.0.0-rc.46` 的源码与文档，具有 **Task Plugin API v1、上传自定义插件、type-61 任务插件渠道、任务用量表达式、按模型 usageProfiles**。本插件依照该契约编写。用户自行安装；读取源码并不等于已经在用户实例导入或实测。
- NewToken 文档提到的 `v1.0.0-rc.21+` 只说明原生接口兼容，不代表更早版本已具备本插件使用的所有插件字段。若你的“最新”镜像实际版本不同，请以后台版本号和插件导入结果为准。

## 安装与渠道设置

1. 在 NewAPI 管理后台的“任务插件”上传本地 `plugin.js`。官方 `v1.0.0-rc.46` 的上传弹窗支持读取本地文件，也支持导入 raw URL；无需将文件放进容器。可先保存再启用，按照弹窗显示完成激活。
2. 检查插件名称为“newtoken 特殊渠道 · 720×1280”、key 为 `xiaomeng-newtoken`、版本为 `0.2.2`。升级已有插件时保持相同 key，检查激活版本及渠道绑定；宿主会执行元信息和路由冲突检查。启用分项请求前必须先更新该模型的任务用量表达式；旧表达式只引用 `tokens`，不能用于新增的分项模式。
3. 新建 **任务插件（type 61）** 渠道，绑定该插件。Base URL 填 NewToken 实际 API 根地址，不填文档地址、不加 `/v1` 或任务路径；密钥填 NewToken 给你的渠道密钥，仅保存在服务器。
4. 在渠道选择下表四个模型，不把它们映射成其他上游模型。NewToken 密钥必须属于用户确认的固定720×1280特殊渠道。插件不占用内置 Doubao 的渠道类型，也不注册 `/v1/videos`，避免误用按秒兼容路线。
5. 为四个模型分别配置**任务用量表达式**，确认价格预览正确，再开放渠道。不能使用旧“按次固定价”，否则 NewAPI 不会按完成 Token 差额结算。
6. 在中间件填写你的 NewAPI 地址和专用服务端令牌，任务路径使用下方带前缀的地址。NewAPI 令牌分组必须能访问该插件渠道。

支持该运行时的 NewAPI 会在插件上传/启用后发布路由，无需修改容器文件。是否需要升级 NewAPI 本身，取决于用户当前安装版本；此交付未自动安装或修改远端容器。

## 中间件访问你的 NewAPI

```text
POST /xiaomeng-newtoken/api/v3/contents/generations/tasks
GET  /xiaomeng-newtoken/api/v3/contents/generations/tasks/{id}
Authorization: Bearer <你的 NewAPI 服务端令牌>
```

插件访问 NewToken 时去掉 `/xiaomeng-newtoken` 前缀，使用原生 `/api/v3/contents/generations/tasks`。查询使用创建返回的公开 `id`，不是供应商的 `doubao-id`。

## 本分组的模型能力

| 模型 ID | 本分组固定规格 | 输出时长 | 图片/视频/音频 |
| --- | --- | --- | --- |
| `doubao-seedance-2-0-260128` | 720p · 9:16（720×1280） | 4–15 秒 | 9 / 3 / 3 |
| `doubao-seedance-2-0-fast-260128` | 720p · 9:16（720×1280） | 4–15 秒 | 9 / 3 / 3 |
| `doubao-seedance-2-0-mini-260615` | 720p · 9:16（720×1280） | 4–15 秒 | 9 / 3 / 3 |
| `doubao-seedance-2-5-260628` | 720p · 9:16（720×1280） | 4–30 秒 | 30 / 10 / 10 |

**当前按用户确认的渠道限制收窄。** 四个模型都只开放720p、9:16，不因模型在其他渠道支持更多分辨率或比例而放宽。Mini 的15秒上限参考官方 Doubao 插件的模型配置，NewToken参数表没有单列Mini时长，需在该渠道联调验证。未来稳定官方、特价等分组与其他规格另行配置，本版不自动切换渠道或上游模型ID。

请求示例见 `fixtures/request.json`、`request-2.5.json`，分项示例见 `request-split.json`、`succeeded-split.json`。后者是合成的协议样例，不代表 NewToken 已确认返回这种分项。`request-2.0-1080.json`保留作为必须拒绝的负例，不可用于当前渠道提交。分辨率必须显式填写720p；比例省略时默认9:16，其他比例拒绝；时长为整数，默认4秒。

### 当前渠道固定 720×1280 竖屏

用户已确认当前渠道仅接受固定竖屏。在中间件为绑定此渠道的每个模型设置：支持分辨率 `720p`、支持比例 `9:16`，仅填写720p对应价格档位，保存发布后由画布后台同步模型并发布售价。原生请求发送 `resolution: "720p"`、`ratio: "9:16"`；分辨率字段不填写 `720*1280`。实际返回文件尺寸仍需真实渠道验证。

0.2.2插件也执行同一限制：即使绕过中间件直接调用 New API，横屏、其他比例与1080p等请求仍会被拒绝。已发布模型还需在中间件与画布后台同步为该固定规格；上传插件不会自动修改已发布的画布能力。

支持普通 HTTP(S) 素材 URL；浏览器文件先由画布后端准备可访问链接。此版本不开放 Base64、`asset://`、草稿任务或 `edit`/`extend` 视频编辑模式。2.5 连接参考视频时显式发送 `omni_reference_task_type: "reference"`，避免上游默认 `auto` 推断成需要 `adaptive` 比例及特殊时长的视频编辑。其他未知参数明确拒绝。

不额外写死“合计12个”。实际 NewToken 分组若更严格，必须同步收窄画布能力；插件不是对所有分组的接受保证。首尾帧各最多一个，使用首尾帧时图片最多 2 张且不能同时带参考视频。2.0 系列参考音频需要搭配图片或视频；2.5 允许只用音频作参考（仍需非空提示词）。

## 两套账务各自负责什么

| 位置 | 作用 |
| --- | --- |
| NewAPI 的服务账号/令牌额度 | 你自己的网关调用额度，插件报告任务用量，NewAPI 按其表达式计费 |
| 画布用户钱包 | 向最终用户收取你配置的售价，中间件传回用量，不传管理员密钥 |

两边可能都有预扣，不能将 NewAPI 服务账号消费再作为一笔消费叠加到画布用户账单。画布费用只算一次：实际用量乘画布提交时锁定的用户单价。NewAPI 服务账号的余额不足仍会导致上游调用失败，需独立管理。

### NewAPI 计费事实

本版本的任务表达式具有六个事实：`billing_mode`、`tokens`、`input_tokens`、`output_tokens`、`resolution`、`video_input`。`resolution`固定为720p，`video_input`区分参考视频价格档位；“有/无参考视频”与“输入/输出分项”是不同维度。

| 模式 | 提交预扣事实 | 完成用量 | 未参与计费的字段 |
| --- | --- | --- | --- |
| `total_tokens`（请求省略时的默认） | `tokens = 500000` | `usage.total_tokens`，正安全整数 | 输入、输出事实均为0 |
| `input_output_tokens` | 输入250000、输出250000 | 完整 `usage.input_tokens/output_tokens` 或 `usage.prompt_tokens/completion_tokens` | `tokens = 0` |

新增原生请求控制字段 `billing_mode: "input_output_tokens"` 由中间件按发布的计费模式填写。插件仅消费它，发送给 NewToken 时删除；NewToken 接口无需认识此字段。任务提交成功后把模式保存在 `parseSubmitResponse.state`，后续查询使用 `ctx.state` 中已锁定的模式，不能随着后台配置改变或因缺用量改回总量模式。

分项规则：两个数字都必须存在且为非负安全整数，允许输入为0、输出为0或两者为0；只出现一项不能结算。若两组命名同时出现，必须完整且对应相等。`total_tokens` 可省略，但提供时必须有效且等于输入加输出。字符串、负数、小数、缺项、总和超出安全整数或相互冲突均保持待结算。**只有 `total_tokens` 和 `completion_tokens` 时不能推算输入，也不能启用分项实际结算。**

分项模式的完整计费公式是：

```text
本次金额 = 输入 Token × 输入单价 / 1000000
         + 输出 Token × 输出单价 / 1000000
```

例如配置输入10.35、输出20.70元/百万 Token，预扣输入25万、输出25万得到7.7625元；实际输入10万、输出20万为5.175元。画布按分落账时分别为7.76元、5.18元，退2.58元；NewAPI按照其额度精度结算。若实际输入20万、输出40万为10.35元，画布补扣2.59元。它们是合成演示价格，不是上游已经确认的分项报价。

如果输入、输出同为10.35元/百万 Token，且此价格确实适用本次档位，总量40万对应4.14元；输入、输出按各自数量计算得到相同结果，不能将40万总量按两种单价各收一遍。

- 页面分别显示输入、输出 Token 单价字段，单位由 NewAPI 的 `unit: "token"` 呈现为每百万 Token；每个模型、分辨率和参考视频档位都可以独立设置不同输入价、输出价。
- 50万总量或25万输入+25万输出只是预扣策略，不是最大Token或最终费用；插件不会将预扣事实写进响应的 `usage`。
- 插件保留完整原始 `usage` 给中间件。完成事实只更新当前模式的实际数量，保留提交时的分辨率、参考视频档位及宿主锁定的表达式。
- 金额、折扣、分组倍率不写进插件源码。原名称中的“4.5折”是运营展示，本版不在代码里再次乘0.45。通过 NewAPI 任务用量表达式配置实际接入价；画布销售价另行配置。
- NewToken 文档报价是人民币元/百万 Token。你的 NewAPI **任务表达式系数按美元成本解释**，请按明确的币种换算后填写，不要把人民币数字直接当美元输入。通用形式为 `xxx / 1M Token`：人民币折后单价 ÷ 配置的“人民币/美元”汇率 = 美元/百万 Token；折扣只应用一次。

**不能仅上传插件后立刻将现有 Seedance 全部切为分项。** 先核对上游真实任务响应是否给出上述完整分项；未提供时仍选总量模式。插件新增的是分项结算能力，不会凭空产生输入／输出用量，也不证明四个模型都能返回完整分项。

### 原价参考，非已经配置的收费价格

| 模型 | 分辨率 | 无参考视频（元/1M Token） | 有参考视频（元/1M Token） |
| --- | --- | ---: | ---: |
| 2.0 | 720p | 46 | 28 |
| 2.0 Fast | 720p | 37 | 22 |
| 2.0 Mini | 720p | 23 | 14 |
| 2.5 | 720p | 70 | 42 |

以上是此前核对 NewToken 官方页动态价表的折前参考，不是本次确认的渠道成交价。供应商4.5折若确实适用于对应档位，采购参考单价可以乘0.45；不要再在 NewAPI 分组和画布售价中不加区分地重复打折。每个模型独立填写已确认的当前渠道价格。

### 任务用量表达式填写

当前固定720p、9:16渠道，如果暂不区分参考视频，兼容两种计费模式的结构如下。每个模型独立设置，先把占位符换成该模型的**美元/百万 Token**数字，再保存；带占位符的示意不能直接提交：

```text
u("billing_mode") == "input_output_tokens"
  ? tier("split", (u("input_tokens") * INPUT_USD + u("output_tokens") * OUTPUT_USD) / 1000000)
  : tier("total", u("tokens") * TOTAL_USD / 1000000)
```

如果分项价也区分有无参考视频，使用：

```text
u("billing_mode") == "input_output_tokens"
  ? (u("video_input") == "video"
      ? tier("split_video", (u("input_tokens") * INPUT_VIDEO_USD + u("output_tokens") * OUTPUT_VIDEO_USD) / 1000000)
      : tier("split_no_video", (u("input_tokens") * INPUT_USD + u("output_tokens") * OUTPUT_USD) / 1000000))
  : (u("video_input") == "video"
      ? tier("total_video", u("tokens") * TOTAL_VIDEO_USD / 1000000)
      : tier("total_no_video", u("tokens") * TOTAL_USD / 1000000))
```

未来其他分辨率、比例或分组需要新增接入规格并同步能力校验，本版本不能只改价格表达式就开放1080p。

下面是**仅允许总量请求时**的表达式。四个模型均使用此结构，各自配置单价：

```text
u("video_input") == "video"
  ? tier("with_video", u("tokens") * PRICE_WITH_VIDEO_USD / 1000000)
  : tier("without_video", u("tokens") * PRICE_WITHOUT_VIDEO_USD / 1000000)
```

任务表达式返回一次任务的美元费用，需要显式 `/ 1000000`。可使用 `xiaomeng-newtoken::<模型ID>` 的插件级覆盖，避免影响其他插件同名模型。检查已有 NewAPI 分组倍率，避免与你在画布配置的折扣混为一谈。插件模型清单及每个模型用量档位可以在后台自动读取，不需要为四个模型复制四份插件。新增的六个事实均会在预览示例中完整提供，输入／输出价格应有不同结果；仅引用旧 `tokens` 的表达式会在分项模式得到零，必须先改表达式再开放分项请求。

## 用量尚未返回时

上游可能先返回视频成功，再提供对应计费模式的有效 Token。插件此时：

- 向 NewAPI 任务轮询器返回 `IN_PROGRESS`、`99%`，避免以预扣值当作最终用量。输入／输出不完整或冲突时同样等待，不退回总量计费。
- 向中间件保留 `status: "succeeded"`、结果 URL，附加 `billing_status: "pending_usage"`。画布应保留结果、显示待结算并继续查询，不得自动退款、补扣或按预估值结账。
- 有效 Token 到达后返回 `billing_status: "usage_available"`，NewAPI 正常结束任务，画布独立、幂等地结算。

原生查询展示的 `TaskView` 不包含私有插件state，所以 `native.taskStatus` 根据宿主经模式校验后的 `SUCCESS` 状态标记可用；它不单独拿 `total_tokens` 推断分项是否齐全。原始成功结果仍保留，以便中间件按自己锁定的模式继续核实用量。

**宿主边界：**当前公开 NewAPI 契约仍有任务超时清扫（默认 24 小时）和失败退款机制，自定义插件不能取消这条外层策略。永久缺失用量时，网关可能最终超时并退回自己的预扣。插件原生查询会尽量保留已有成功响应和 `pending_usage`，画布用户账务必须保持独立待核对；不能把网关退款误判成用户生成失败或无费用。需要持续保存、继续补查超时任务时，必须结合实际宿主版本另做运维/宿主功能，不能宣称此插件已经解决无限期自动对账。

总模式的缺失、0、负数、小数、字符串Token不触发最终结算；分项模式明确允许零，其他非法或不完整用量仍不结算。缺少已持久化的计费模式时不猜测模式。未知任务状态返回 `UNKNOWN`，由宿主按查询异常处理。插件不自行重发生成请求。网络超时或“缺少任务 ID”需要先核对网关记录，不能盲目重试收费请求。

## 待验证清单

- 实际 NewAPI 版本的插件导入、渠道绑定、任务表达式及 native 路由可用。
- 合成用例可使用 `node --test integrations/new-api/plugin.test.mjs`，当前指向0.2.2，包含四模型固定竖屏、直接/native调用拒绝其他规格、默认比例、展示样例约束及计费断言，本次未运行；历史0.1.0的11项通过记录不代替新版、宿主插件沙箱和真实渠道验证。
- 在插件沙箱用 fixtures 验证请求、状态、Token 来源，再由管理员授权一次真实生成验证完整链路。
- 实际分组支持的素材数量、素材 URL 的访问期限、含参考视频的价格档位。
- 实际返回视频是否严格为720×1280；请求校验只保证发送720p和9:16，不能代替对上游文件的尺寸验证。
- 生成成功但缺用量、超过 50 万、重复查询、网关重启、超时清扫后的画布账务处理。
- 输入／输出不同价、零用量、别名配对、总和不一致、分项缺失等待、模式持久化、控制字段未转发上游、原始用量透传及预扣差额。

## 依据

- [NewAPI 元信息及用量展示校验源码](https://github.com/QuantumNous/new-api/blob/30748c6558bc97de49ff74871cfec717e50f3322/pkg/jsplugin/registry.go#L1626)
- [NewToken 官方任务协议](https://doc.newtoken.club/api-docs/seedance-official.html)
- [Seedance 2.0 模型能力](https://docs.volcengine.com/docs/ark/seedance-2-0?lang=zh)
- [NewAPI 插件 API v1](https://github.com/QuantumNous/new-api-plugins/blob/main/docs/plugin-api/v1.md)
- [核对的官方发布 v1.0.0-rc.46](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.46)
- [该版本插件上传弹窗源码](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.46/web/src/features/task-plugins/components/upload-dialog.tsx)
- [NewAPI 插件安装说明](https://github.com/QuantumNous/new-api-plugins/blob/main/README.md)
- [NewAPI 任务用量表达式](https://github.com/QuantumNous/new-api/blob/main/pkg/billingexpr/expr.md#task-usage-expressions)

参考 QuantumNous 的 Doubao 1.3.0 插件并按本链路收窄适配，保留本目录的 Apache-2.0 许可证与 NOTICE。
