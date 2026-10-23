# 小盟模型中间件

独立的 Go + Gin + GORM 服务，首批链路为：画布平台后端 → 本中间件 → 你的 New API 专用插件 → NewToken。普通用户不能访问管理员接口；供应商密钥留在服务端。本服务不操作用户钱包，按任务冻结的规则返回实际Token总量/输入输出分项或秒/次数量；售价、预扣和退补由画布平台后端完成。

## 首批分组与模型

当前展示分组：`特殊分组`。四个模型分别配置渠道、Token 计费方式、原价和预扣量，均只支持 **720×1280 竖屏**，协议参数固定为 `resolution=720p`、`ratio=9:16`。这不是 720p 与 1080p 两档，也不开放其他比例。分组名只是标识，不自动应用折扣。

| 模型 ID | 分辨率 | 输出时长 | 图片 / 视频 / 音频上限 | 原价元 / 百万 Token（无 / 有参考视频） |
| --- | --- | --- | --- | --- |
| doubao-seedance-2-0-260128 | 720p · 9:16 | 4–15 秒 | 9 / 3 / 3 | 46 / 28 |
| doubao-seedance-2-0-fast-260128 | 720p · 9:16 | 4–15 秒 | 9 / 3 / 3 | 37 / 22 |
| doubao-seedance-2-0-mini-260615 | 720p · 9:16 | 4–15 秒，需渠道实测确认 | 9 / 3 / 3 | 23 / 14 |
| doubao-seedance-2-5-260628 | 720p · 9:16 | 4–30 秒 | 30 / 10 / 10 | 70 / 42 |

价格和能力来源为 [NewToken 原生任务文档](https://doc.newtoken.club/api-docs/seedance-official.html)（包含页面脚本更新后的模型规则），不是已经验证的采购价。默认预扣 500,000 Token 是建议值，不是费用上限。四模型初始均停用；管理员核对原价与渠道后显式确认和发布。`maxTotal=0` 表示不额外猜测一个总数量限制，各类型上限仍生效。默认首尾帧各最多 1 张且不能混用参考模式。普通参考模式下，2.0 系列的音频须搭配图片或视频；2.5 可使用纯音频参考。初版不支持供应商素材 ID、视频编辑或扩展模式。

表内价格沿用既有 720p 基准值，固定竖屏是本次确认的渠道限制，不能据此认定表内价格就是当前采购价。管理员可以降低附件数量与时长上限，不能超过对应模型插件上限。总量与输入／输出分项模式均保留，分项价格须根据该模型实际渠道单独填写。

本轮P5增加标准模型及多规格配置。同一标准模型可按分辨率、比例、时长、参考模式和音频条件匹配不同真实上游ID；每个规格仅对应一条已配置路由，条件重叠即拒绝。标准名称和分组只负责展示，真实路由由私有配置决定。原四模型不自动增加分辨率、改价或换渠道，新模型默认停用，须填写真实配置再确认发布。

## 启动与管理

1. 在你的 New API 安装同仓库提供的 NewToken 专用插件，并配置对应的 NewToken 渠道与分组令牌。确认安装版本支持插件原生路径和任务轮询。
2. 复制 `gateway/env.example` 为服务器上的私有环境文件，例如 `/opt/xiaomeng-gateway/gateway.env`，权限设为 `600`。
3. 分别生成 API 与管理员随机令牌（可各使用 `openssl rand -hex 32`），加密密钥使用 `openssl rand -base64 32`。三个值必须独立妥善保存；丢失加密密钥会无法解密旧渠道与任务快照。
4. 从仓库根目录启动：

```sh
docker compose --env-file /opt/xiaomeng-gateway/gateway.env -f docker-compose.gateway.yml up -d --build
```

管理入口为 `http://服务器地址:8088/admin`；端口通过 `GATEWAY_PORT` 设置。部署在公网上时先配置 HTTPS 反向代理再填入密钥。管理页面无需另行前端构建，管理员密钥仅保留在本页内存，刷新需重新登录。页面可编辑渠道地址、New API令牌，新增标准模型和真实规格，分别配置上游ID/协议、能力与原价；也可直接维护原四模型单规格配置。

打开管理页只读取已保存配置，不自动重写数据库。原四模型专用插件仍严格固定720p与9:16；旧无效能力会阻止目录同步和新任务提交，管理员须逐个核对并保存新revision，再在画布后台同步、核对零售价后发布。已有任务仍按原快照轮询和结算。

页面填写的地址是**你的 New API 地址**，不是 NewToken 地址；令牌也应来自你的 New API。默认提交路径 `/xiaomeng-newtoken/api/v3/contents/generations/tasks`，查询路径同前缀加 `/{id}`。管理端允许配置明确的内网 New API 地址，素材 URL 则禁止内网地址。

画布平台填写中间件地址与 `GATEWAY_API_TOKEN`，不能使用管理员令牌。同服务器不同 Compose 服务可通过受控网络连接，或配置服务器地址；本容器中的 `127.0.0.1` 指本容器。API 与管理页共享 8088 端口。

数据库在命名卷 `model-gateway-data` 中，首次启动自动建表；模型、渠道和任务不依赖容器文件层。配置修改不需重建容器，更新协议代码才需升级。当前按单实例运行，不要让多个网关实例同时轮询同一 SQLite 数据库。

## 接口契约

所有 JSON 接口返回 `{ "code": 0, "data": ..., "msg": "" }`；失败使用非零 `code` 与 HTTP 错误状态。所有 `/v1` 接口必须发送 `Authorization: Bearer <GATEWAY_API_TOKEN>`。

| 方法与路径 | 用途 |
| --- | --- |
| GET /v1/models | 已发布且渠道启用的模型定义数组；不含密钥 |
| POST /v1/tasks | 幂等提交统一任务 |
| GET /v1/tasks/{id} | 查询已持久化的网关任务 |
| GET /v1/tasks/by-request/{requestId} | 恢复客户端断线后未知响应的提交 |
| GET /admin/api/channels | 渠道列表，密钥从不回传 |
| PUT /admin/api/channels/{id} | 新增或更新渠道；apiKey 留空保留原值 |
| DELETE /admin/api/channels/{id} | 删除无任何模型或历史任务引用的渠道 |
| GET /admin/api/models | 全部模型，包括未发布项 |
| PUT /admin/api/models/{id} | 新增或更新支持的模型配置 |
| DELETE /admin/api/models/{id} | 停用模型，保留配置与历史快照 |
| POST /admin/api/tasks/{id}/resolve | 核实后绑定已有上游任务 ID，恢复查询 |

管理员接口使用独立 `GATEWAY_ADMIN_TOKEN`。`revision` 在修改能力、价格、分组或渠道时必须变化；仅启停不强制变化。存在 `pricing.tiers` 时严格按分辨率命中，不允许缺档时使用默认价格。

### 多规格配置

- 公开模型的`variants[]`包含`id/name/referenceModes/generateAudio?/capabilities/pricing`。每个规格列出其真实选项；顶层能力是概览，不代表所有分辨率与比例可以任意组合。referenceModes为空表示不限制，按video→image→audio→text判断素材场景；generateAudio省略为不限制，否则为固定条件。
- 私有`routes[]`为`{variantId,channelId,upstreamModel,adapter}`，每个规格恰好一条。业务`GET /v1/models`只返回公开定义，不下发路由或密钥。提交可携带variantId，须与完整参数匹配结果一致。
- 原价`pricing.unit`支持token、second、call，per分别为1000000、1、1。Token保留两种tokenMode与分项价格；秒/次使用每个分辨率的有/无参考视频整数分单价。按秒quantitySource选择request_duration或response_duration，按次为successful_task；非Token模式不填写预扣Token。
- 画布同步后设置倍率或逐规格固定售价；同协议增加/停用模型或规格无需重建。修改协议代码才需要升级，不支持无证据自动探测供应商能力。

| adapter | 已实现的请求结构 | 限制 |
| --- | --- | --- |
| `newtoken-seedance-native-v1` | 小盟New API专用插件原生路径，含插件私有billing_mode | 原四模型、720p+9:16、Token计费 |
| `seedance-native-v1` | Seedance原生content任务结构，不发送插件私有billing_mode | 管理员核实真实模型能力、价格与用量字段后配置 |
| `newtoken-videos-v1` | NewToken第三方`/v1/videos`，reference_images/videos/audios及ratio | 按请求时长计秒；每个上游ID固定单一720p/1080p、4～15秒、最多9图/3视频/3音频；无首尾帧/水印开关，生成音频条件按实际输出固定 |

第三方按秒协议见[供应商文档](https://doc.newtoken.club/api-docs/seedance-third-party.html)，不能与官方`extra_*`、`aspect_ratio`混合计费接口混用。渠道路径必须匹配选择的适配器和实际New API转发配置。

通过 API 新增渠道的示例（环境变量由操作者在私有终端设置，不提交到 Git）：

```sh
curl -X PUT "$GATEWAY_URL/admin/api/channels/my-newapi" \
  -H "Authorization: Bearer $GATEWAY_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @channel.private.json
```

`channel.private.json` 结构：

```json
{
  "name": "我的 New API",
  "baseUrl": "https://你的-new-api-域名",
  "apiKey": "在私有文件里填写你的 New API 令牌",
  "submitPath": "/xiaomeng-newtoken/api/v3/contents/generations/tasks",
  "queryPath": "/xiaomeng-newtoken/api/v3/contents/generations/tasks/{id}",
  "enabled": true
}
```

统一任务请求示例（发布后的实际 `revision` 以 `/v1/models` 为准）：

```json
{
  "requestId": "platform-generated-unique-id",
  "model": "doubao-seedance-2-0-fast-260128",
  "revision": "发布后的版本号",
  "prompt": "城市雨夜，镜头缓缓向前",
  "parameters": { "resolution": "720p", "ratio": "9:16", "duration": 5, "generateAudio": true, "watermark": false },
  "inputs": [{ "kind": "image", "url": "https://你的素材域名/reference.jpg", "role": "reference" }]
}
```

支持角色 `reference`（也支持对应 `reference_image` / `reference_video` / `reference_audio`）、`first_frame`、`last_frame`。网关校验素材 URL 的协议、域名及 DNS 是否指向公网，不下载素材、不跟随素材重定向；生成时实际拉取由上游完成。只使用你控制的素材域名和有效期覆盖任务的链接。浏览器 blob、本地文件、Base64、R2 私有对象应由画布平台先转为符合要求的任务素材 URL；本次网关没有替用户永久上传素材的接口。

## 任务、用量与异常

- 相同 `requestId` 和相同参数返回同一任务；同 ID 不同参数返回 409。请求 ID 全局唯一，由画布平台生成，不复用到另一笔计费。
- 提交前持久化请求与渠道、模型快照。超时、5xx、无任务 ID 的成功响应、提交期间重启进入 `submission_unknown`，不会自动重新生成。管理员可在 `/admin` 查询请求并核实后关联已有上游任务；当前不支持无证据地标记退款或重新提交。
- 明确 HTTP 4xx 拒绝（408 除外）记录 `failed + not_billable`。任务提交成功后由后台持续轮询，不依赖浏览器在线。查询失败只重试查询，不重试生成。
- 总量模式要求`usage.total_tokens`为正安全整数，只结算一次。分项模式要求完整`input_tokens/output_tokens`或`prompt_tokens/completion_tokens`，允许明确的零值；两组别名须完整一致，总数若提供须等于两项之和。通过后返回`usage_available`及规范化用量，缺项或冲突保持待结算，不从总量推算输入。
- 秒/次在`usage.units`返回冻结规则下的实际数量；request_duration采用原请求整数秒数，response_duration只接受成功响应中的有效整数duration，successful_task成功计1次。缺实际时长保持pending_usage，不能替换成请求时长、Token或0。
- 成功缺少有效用量时，保留视频和成功状态，返回 `completed + pending_usage`，后台继续查询。已经见过成功结果后，后续上游超时/失败不能把它变成失败退款。
- 模型配置停用不影响历史任务。渠道密钥使用 AES-GCM 加密，任务快照保留当时的加密密钥和路径；修改新渠道不会让旧任务改投另一地址。
- 本网关没有报价/钱包接口；价格和预扣建议在模型目录中，画布平台锁定该目录快照并计算用户售价。实际计费用量仍取每个任务结果。

## 验证状态

总量初版曾通过隔离、禁用网络的网关6项（另含2个幂等子例）、画布计价/钱包2项和插件11项用例。新增分项与插件0.2.0尚未运行离线用例，不沿用旧版通过结论。包含分项代码的两端`split-5c917bd9159d`镜像已构建部署，健康及鉴权检查通过；四模型保持停用、渠道为空。首次配置须显式选择计费模式，且用户New API须先导入0.2.0并更新任务表达式。Mini时长、真实分项、退补及持续轮询仍须联调，本轮未调用付费模型。部署记录见[待测试](../docs/progress/pending-test.md)。

本轮固定竖屏变更补充了四模型能力、不同模型价格保留、非法比例／分辨率拒绝、超出插件能力拒绝及旧配置只读审查的用例，未执行测试、语法检查或构建，也未部署。New API 配合使用固定竖屏版插件 0.2.2；真实导入和计费联调仍待确认。

P5新增唯一路由/别名冻结、各计费单位与缺数量、第三方固定分辨率、画布报价匹配用例，目前集中验证中；此处不宣称验证通过或真实渠道已可用。当前四模型专用插件仍为0.2.2，无需因新增后台规格功能更换插件。
