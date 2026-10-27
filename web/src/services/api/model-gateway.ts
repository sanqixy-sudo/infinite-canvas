import { nanoid } from "nanoid";
import { gatewayQuoteMatches, type TokenQuote } from "@/constant/credits";
import { gatewayInputError, gatewayModel, gatewayParameters, resolveGatewayVariant, type GatewayInput, type GatewayModelDefinition, type GatewayParameters, type GatewaySaleTier } from "@/lib/model-gateway";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { assertStorageSession } from "@/services/automatic-media-save";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { ApiError, apiGet, apiPost, apiPut, apiUpload } from "./request";
import { requireCloudModelAccess } from "./cloud-model-access";
import type { CreatedVideoGenerationTask, VideoReferenceInput, VideoResponse, VideoTaskCreateOptions } from "./video";

export type GatewayPolicy = { model: string; enabled: boolean; mode: "multiplier" | "fixed"; multiplier: number; creditsPerYuan: number; withoutVideoCreditsPerMillion: number; withVideoCreditsPerMillion: number; tiers: GatewaySaleTier[]; displayName: string; badge: string; remark: string };
export type GatewayConfig = { enabled: boolean; baseUrl: string; apiKey: string; hasApiKey: boolean; mediaBaseUrl: string; catalog: GatewayModelDefinition[]; models: GatewayPolicy[] };
export type GatewayRequest = { requestId: string; model: string; revision: string; variantId?: string; prompt: string; parameters: GatewayParameters; inputs: GatewayInput[]; source?: string; sourceId?: string; canvasId?: string };
type GatewayQuote = TokenQuote & { quoteId: string; expiresAt: string };

export const fetchGatewayConfig = (token: string) => apiGet<GatewayConfig>("/api/admin/model-gateway", undefined, token);
export const saveGatewayConfig = (token: string, config: GatewayConfig) => apiPut<GatewayConfig>("/api/admin/model-gateway", config, token);
export const syncGatewayModels = (token: string) => apiPost<GatewayConfig>("/api/admin/model-gateway/sync", {}, token);
export async function fetchGatewayTask(id: string) {
    const token = requireCloudModelAccess();
    const task = await apiGet<VideoResponse>(`/api/v1/videos/${encodeURIComponent(id)}`, undefined, token);
    assertStorageSession(token);
    return task;
}

async function prepareMedia(reference: ReferenceImage | ReferenceVideo | ReferenceAudio, kind: GatewayInput["kind"], token: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const source = kind === "image" ? await resolveImageUrl(reference.storageKey, reference.url || ("dataUrl" in reference ? reference.dataUrl : "")) : await resolveMediaUrl(reference.storageKey, reference.url || "");
    if (!source) throw new Error(`无法读取素材「${reference.name}」，请重新选择`);
    const url = new URL(source, window.location.origin);
    // 平台鉴权链接和浏览器文件先转为临时任务素材，不自动收藏到账号素材库。
    if (/^https?:$/.test(url.protocol) && url.origin !== window.location.origin && !url.pathname.startsWith("/api/")) return url.href;
    assertStorageSession(token);
    const response = await fetch(source, { signal, ...(url.origin === window.location.origin ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
    if (!response.ok) throw new Error(`无法读取素材「${reference.name}」`);
    const blob = await response.blob();
    if (!blob.size) throw new Error(`素材「${reference.name}」为空`);
    assertStorageSession(token);
    signal?.throwIfAborted();
    const form = new FormData();
    form.append("file", blob, reference.name || `${kind}-${reference.id}`);
    const result = await apiUpload<{ url: string; expiresAt: string }>("/api/v1/model-gateway/media", form, token);
    assertStorageSession(token);
    return result.url;
}

export function gatewayReferenceInputs(input: VideoReferenceInput) {
    return [
        ...(input.references || []).map((reference) => ({ reference, kind: "image" as const, role: "reference_image" as const })),
        ...(input.videoReferences || []).map((reference) => ({ reference, kind: "video" as const, role: "reference_video" as const })),
        ...(input.audioReferences || []).map((reference) => ({ reference, kind: "audio" as const, role: "reference_audio" as const })),
        ...(input.firstFrame ? [{ reference: input.firstFrame, kind: "image" as const, role: "first_frame" as const }] : []),
        ...(input.lastFrame ? [{ reference: input.lastFrame, kind: "image" as const, role: "last_frame" as const }] : []),
    ];
}

export async function createGatewayVideoTask(config: AiConfig, prompt: string, input: VideoReferenceInput, options: VideoTaskCreateOptions): Promise<CreatedVideoGenerationTask> {
    const token = requireCloudModelAccess(config);
    if (options.clientTaskId) {
        try {
            const task = await apiGet<VideoResponse>(`/api/v1/model-gateway/tasks/by-request/${encodeURIComponent(options.clientTaskId)}`, undefined, token);
            assertStorageSession(token);
            options.signal?.throwIfAborted();
            if ((task.source || "") !== (options.source || "") || (task.source_id || "") !== (options.sourceId || "") || (task.canvasId || "") !== (options.canvasId || "")) throw new Error("同一任务标识不能用于不同画布或节点，请重新创建任务");
            options.onServerTask?.();
            return { task, pollId: task.id, startedAt: Date.now(), requestBody: { requestId: options.clientTaskId } };
        } catch (error) {
            if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
    }
    const model = gatewayModel(config);
    if (!model) throw new Error("该模型已停用或配置已更新，请刷新模型列表后重试");
    const references = gatewayReferenceInputs(input);
    const parameters = gatewayParameters(config);
    const error = gatewayInputError(model, references, parameters);
    if (error) throw new Error(error);
    if (config.videoElementList.some((item) => item.references.length) || config.videoMultiShot === "true") throw new Error("当前模型不支持元素库或多镜头配置，请清除这些参数后重试");
    const inputs: GatewayInput[] = [];
    for (const { reference, kind, role } of references) inputs.push({ kind, role, url: await prepareMedia(reference, kind, token, options.signal) });
    assertStorageSession(token);
    options.signal?.throwIfAborted();
    const variant = resolveGatewayVariant(model, parameters, inputs);
    const request: GatewayRequest = { requestId: options.clientTaskId || `client_video_task_${nanoid()}`, model: model.id, revision: model.revision, variantId: variant?.id, prompt, parameters, inputs, source: options.source, sourceId: options.sourceId, canvasId: options.canvasId };
    const quote = await apiPost<GatewayQuote>("/api/v1/model-gateway/quote", request, token);
    assertStorageSession(token);
    const hasReferenceVideo = inputs.some((item) => item.kind === "video");
    if (!gatewayQuoteMatches(quote, model, parameters, variant?.id, hasReferenceVideo)) throw new Error("模型规格、计费规则或价格已更新，请刷新模型配置后重新提交");
    options.signal?.throwIfAborted();
    options.onServerTask?.();
    const startedAt = Date.now();
    const task = await apiPost<VideoResponse>("/api/v1/model-gateway/tasks", { ...request, quoteId: quote.quoteId }, token);
    assertStorageSession(token);
    return { task, pollId: task.id, startedAt, requestBody: request };
}
