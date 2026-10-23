// SPDX-License-Identifier: Apache-2.0
// Adapted from QuantumNous/new-api-plugins, Doubao 1.3.0 (Apache-2.0).
// Changes: NewToken's 720/1080 group, native routes, per-model capabilities,
// strict total_tokens settlement, fixed reservation and pending-usage handling.
// Resolutions are the intersection of the model and the account group, not all
// resolutions the group name advertises. Fast/Mini do not accept 1080p.
const MODELS = {
  "doubao-seedance-2-0-260128": { resolutions: ["720p", "1080p"], maxDuration: 15, images: 9, videos: 3, audios: 3 },
  "doubao-seedance-2-0-fast-260128": { resolutions: ["720p"], maxDuration: 15, images: 9, videos: 3, audios: 3 },
  "doubao-seedance-2-0-mini-260615": { resolutions: ["720p"], maxDuration: 15, images: 9, videos: 3, audios: 3 },
  "doubao-seedance-2-5-260628": { resolutions: ["720p", "1080p"], maxDuration: 30, images: 30, videos: 10, audios: 10, audioOnly: true },
};
const PREFIX = "/xiaomeng-newtoken";
const TASK_PATH = "/api/v3/contents/generations/tasks";
const RESERVE_TOKENS = 500000;
const RATIOS = ["16:9", "9:16", "1:1", "21:9", "4:3", "3:4"];
const OPTIONAL_FIELDS = ["seed", "generate_audio", "watermark", "return_last_frame"];

function usageSchema(resolutions) {
  return {
    tokens: { type: "number", unit: "token", description: { en: "Billable tokens", zh: "实际计费 Token" } },
    resolution: { enum: resolutions, description: { en: "Output resolution", zh: "输出分辨率" } },
    video_input: {
      enum: ["none", "video"],
      enumLabels: { none: { en: "No reference video", zh: "无参考视频" }, video: { en: "With reference video", zh: "有参考视频" } },
      description: { en: "Reference video input", zh: "参考视频输入" },
    },
  };
}

function usageExamples(resolutions) {
  return resolutions.flatMap((resolution) => ["none", "video"].map((video) => ({
    label: resolution + (video === "video" ? " · 有参考视频 · 预扣" : " · 无参考视频 · 预扣"),
    facts: { tokens: RESERVE_TOKENS, resolution: resolution, video_input: video },
  })));
}

export const meta = {
  apiVersion: 1,
  key: "xiaomeng-newtoken",
  name: "newtoken 4.5折 720&1080分组",
  version: "0.1.0",
  author: { name: "小盟视频工作台" },
  icon: "Doubao.Color",
  description: {
    en: "Four NewToken Seedance models with account-group resolution limits and total-token settlement",
    zh: "NewToken Seedance 2.0、Fast、Mini、2.5，按模型与分组限制调用并使用实际 total_tokens 结算",
  },
  models: Object.keys(MODELS),
  fetchMode: "per_task",
  routes: [
    { method: "POST", path: PREFIX + TASK_PATH, type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: PREFIX + TASK_PATH + "/:task_id", type: "query", render: "taskStatus" },
  ],
  usageSchema: usageSchema(["720p", "1080p"]),
  usageExamples: usageExamples(["720p", "1080p"]),
  usageProfiles: Object.keys(MODELS).map((model) => ({
    models: [model], schema: usageSchema(MODELS[model].resolutions), examples: usageExamples(MODELS[model].resolutions),
  })),
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasVideo(content) {
  return content.some((item) => item.type === "video_url");
}

function totalTokens(body) {
  const value = object(body) && object(body.usage) ? body.usage.total_tokens : undefined;
  // Missing, strings, fractions, zero and negatives are not authoritative usage.
  // Do not fall back to completion_tokens or the submit-time reservation.
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeRequest(value) {
  if (!object(value)) throw new Error("请求必须是 JSON 对象");
  if (!Object.prototype.hasOwnProperty.call(MODELS, value.model)) throw new Error("此插件不支持该模型");
  const profile = MODELS[value.model];
  if (!profile.resolutions.includes(value.resolution)) throw new Error("该模型在此分组仅支持 " + profile.resolutions.join("、") + "，请显式填写 resolution");
  const duration = value.duration === undefined ? 4 : value.duration;
  if (!Number.isInteger(duration) || duration < 4 || duration > profile.maxDuration) throw new Error("时长必须是 4 至 " + profile.maxDuration + " 秒的整数");
  const ratio = value.ratio === undefined ? "16:9" : value.ratio;
  if (!RATIOS.includes(ratio)) throw new Error("不支持该画面比例");
  if (!Array.isArray(value.content) || !value.content.length) throw new Error("content 不能为空");
  const allowed = ["model", "content", "resolution", "duration", "ratio", "omni_reference_task_type"].concat(OPTIONAL_FIELDS);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error("本插件尚不支持参数：" + key);
  }
  const counts = { image_url: 0, video_url: 0, audio_url: 0, first_frame: 0, last_frame: 0 };
  let prompt = false;
  const content = value.content.map((item) => {
    if (!object(item)) throw new Error("素材条目格式错误");
    if (item.type === "text") {
      if (!text(item.text)) throw new Error("提示词不能为空");
      prompt = true;
      return { type: "text", text: item.text };
    }
    const roles = { image_url: ["reference_image", "first_frame", "last_frame"], video_url: ["reference_video"], audio_url: ["reference_audio"] };
    if (!roles[item.type]) throw new Error("仅支持普通图片、视频和音频素材");
    const url = object(item[item.type]) ? text(item[item.type].url) : "";
    if (!/^https?:\/\//i.test(url) || /[\s\\]/.test(url)) throw new Error("参考素材必须是可访问的 HTTP(S) URL");
    const role = item.role === undefined ? roles[item.type][0] : item.role;
    if (!roles[item.type].includes(role)) throw new Error("素材角色不受支持");
    counts[item.type] += 1;
    if (role === "first_frame" || role === "last_frame") counts[role] += 1;
    return { type: item.type, [item.type]: { url: url }, role: role };
  });
  if (!prompt) throw new Error("至少需要一条非空提示词");
  // Do not invent a separate combined limit; each model owns its input counts.
  if (counts.image_url > profile.images || counts.video_url > profile.videos || counts.audio_url > profile.audios)
    throw new Error("该模型最多支持 " + profile.images + " 张图片、" + profile.videos + " 段视频、" + profile.audios + " 段音频");
  if (counts.first_frame > 1 || counts.last_frame > 1) throw new Error("首尾帧各最多一个");
  if ((counts.first_frame || counts.last_frame) && (counts.image_url > 2 || counts.video_url > 0))
    throw new Error("使用首尾帧时最多 2 张图片，且不能同时连接参考视频");
  if (!profile.audioOnly && counts.audio_url && !counts.image_url && !counts.video_url) throw new Error("该模型的音频参考需要同时提供图片或视频");
  const body = { model: value.model, content: content, resolution: value.resolution, duration: duration, ratio: ratio };
  if (value.omni_reference_task_type !== undefined && (!profile.audioOnly || value.omni_reference_task_type !== "reference" || !counts.video_url))
    throw new Error("此版本仅支持 2.5 带参考视频时的 reference 模式，不支持 edit、extend 或 auto");
  // Pin ordinary reference generation instead of letting 2.5 infer edit mode,
  // whose adaptive ratio and automatic duration require a separate canvas UI.
  if (profile.audioOnly && counts.video_url) body.omni_reference_task_type = "reference";
  for (const key of OPTIONAL_FIELDS) {
    if (value[key] === undefined) continue;
    if (key === "seed") {
      if (!Number.isSafeInteger(value[key]) || value[key] < -1 || value[key] > 2147483647) throw new Error("seed 必须是 -1 至 2147483647 的整数");
    } else if (typeof value[key] !== "boolean") throw new Error(key + " 必须是布尔值");
    body[key] = value[key];
  }
  return body;
}

function upstreamURL(ctx) {
  // Bind a type-61 Task Plugin channel to NewToken's API origin, with no /v1 suffix.
  const base = text(ctx.baseUrl).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error("请在渠道设置 NewToken 接口根地址");
  return base + TASK_PATH;
}

function headers(ctx) {
  return { Accept: "application/json", "Content-Type": "application/json", Authorization: ctx.authHeader || "Bearer " + ctx.apiKey };
}

function snapshot(task) {
  const data = object(task.data) ? task.data : {};
  const output = Object.assign({}, data, { id: task.task_id });
  // NewToken's underlying Ark id is private provider data, not a polling id.
  delete output["doubao-id"];
  if (data.status === "succeeded") {
    output.billing_status = totalTokens(data) === null ? "pending_usage" : "usage_available";
    if (totalTokens(data) === null) output.billing_message = "视频已生成，实际 Token 尚未返回，等待结算";
    // Keep succeeded + pending_usage even if the host later times out/refunds.
    // Canvas must never interpret the host's timeout as generation failure here.
    return output;
  }
  const statuses = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "processing", SUCCESS: "succeeded", FAILURE: "failed" };
  output.status = statuses[task.status] || data.status || "queued";
  if (task.fail_reason) output.error = { message: task.fail_reason };
  return output;
}

export const native = {
  createTask(ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("只接受 JSON 请求");
    const body = normalizeRequest(ctx.body.value);
    return { kind: "submit", model: body.model, action: body.content.some((item) => item.type !== "text") ? "image_to_video" : "text_to_video", requestBody: body };
  },
  taskCreated(ctx, task) {
    return { id: task.task_id };
  },
  taskStatus(ctx, task) {
    return snapshot(task);
  },
  error(ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

export function buildSubmitRequest(ctx) {
  const body = normalizeRequest(ctx.requestBody);
  if (ctx.upstreamModel && ctx.upstreamModel !== body.model) throw new Error("此插件不支持映射为其他上游模型");
  return { url: upstreamURL(ctx), method: "POST", headers: headers(ctx), body: body, rewriteModel: body.model };
}

export function parseSubmitResponse(ctx, response) {
  const body = response.body;
  if (!object(body) || !text(body.id) || body.error) throw new Error("NewToken 未返回有效任务 ID，请核对渠道日志后处理，避免重复提交");
  return { taskId: body.id, taskData: body };
}

export function extractUsage(ctx) {
  const body = normalizeRequest(ctx.requestBody);
  // Only task-usage expressions settle actual tokens. Legacy per-call ratios
  // must not multiply the reservation by 500,000 or the resolution enum.
  if (ctx.usagePurpose === "billing_ratios") return null;
  return { tokens: RESERVE_TOKENS, resolution: body.resolution, video_input: hasVideo(body.content) ? "video" : "none" };
}

export function buildQueryRequest(ctx) {
  if (!text(ctx.taskId)) throw new Error("缺少任务 ID");
  return { url: upstreamURL(ctx) + "/" + encodeURIComponent(ctx.taskId), method: "GET", headers: headers(ctx) };
}

export function parseTaskResult(ctx, body) {
  if (!object(body)) return { status: "UNKNOWN", reason: "NewToken 返回格式无效" };
  if (body.status === "queued" || body.status === "pending") return { status: "QUEUED", progress: "10%" };
  if (body.status === "processing" || body.status === "running") return { status: "IN_PROGRESS", progress: "50%" };
  if (body.status === "succeeded") {
    const tokens = totalTokens(body);
    const url = object(body.content) ? text(body.content.video_url) : "";
    if (tokens === null) return { status: "IN_PROGRESS", progress: "99%", reason: "生成成功，等待有效 usage.total_tokens" };
    if (!url) return { status: "IN_PROGRESS", progress: "99%", reason: "生成成功，等待结果地址" };
    return { status: "SUCCESS", progress: "100%", url: url, totalTokens: tokens };
  }
  if (["failed", "expired", "cancelled"].includes(body.status)) return { status: "FAILURE", progress: "100%", reason: object(body.error) ? text(body.error.message) || body.status : body.status };
  return { status: "UNKNOWN", reason: "未识别的 NewToken 任务状态" };
}

export function extractUsageOnComplete(task, result, body) {
  if (!body || body.status !== "succeeded") return {};
  const tokens = totalTokens(body);
  if (tokens === null) throw new Error("不能使用预扣 Token 作为实际用量");
  // resolution and video_input remain the frozen submit facts. No reference
  // classification or price is inferred from generated output media.
  return { tokens: tokens };
}
