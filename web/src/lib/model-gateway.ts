import { channelIdForActiveModel, type AiConfig } from "@/stores/use-config-store";
import { normalizeSeedanceRatio } from "@/lib/seedance-video";

export type GatewayTokenMode = "total_tokens" | "input_output_tokens" | "";
export type GatewayBillingUnit = "token" | "second" | "call";
export type GatewayReferenceMode = "text" | "image" | "video" | "audio";
export type GatewayPriceTier = { resolution: string; withoutVideoCents: number; withVideoCents: number; withoutVideoInputCents?: number; withoutVideoOutputCents?: number; withVideoInputCents?: number; withVideoOutputCents?: number };

export type GatewayModelDefinition = {
    id: string;
    name: string;
    group?: string;
    revision: string;
    capabilities: { maxImages: number; maxVideos: number; maxAudios: number; maxTotal: number; resolutions: string[]; ratios: string[]; minDuration: number; maxDuration: number; firstFrame: boolean; lastFrame: boolean; audioOnly: boolean; watermark?: boolean };
    pricing: { unit: GatewayBillingUnit; quantitySource?: "request_duration" | "response_duration" | "successful_task"; currency: "CNY"; per: number; tokenMode: GatewayTokenMode; withoutVideoCents: number; withVideoCents: number; reserveTokens: number; reserveInputTokens: number; reserveOutputTokens: number; tiers: GatewayPriceTier[] };
    variants?: GatewayVariant[];
};
export type GatewayVariant = { id: string; name: string; referenceModes?: GatewayReferenceMode[]; generateAudio?: boolean; capabilities: GatewayModelDefinition["capabilities"]; pricing: GatewayModelDefinition["pricing"] };

export type GatewaySaleTier = { variantId?: string; resolution: string; withoutVideoCreditsPerMillion: number; withVideoCreditsPerMillion: number; withoutVideoInputCreditsPerMillion?: number; withoutVideoOutputCreditsPerMillion?: number; withVideoInputCreditsPerMillion?: number; withVideoOutputCreditsPerMillion?: number; withoutVideoCredits?: number; withVideoCredits?: number };
export type GatewaySale = { unit?: GatewayBillingUnit | "variants"; tokenMode: GatewayTokenMode; withoutVideoCreditsPerMillion: number; withVideoCreditsPerMillion: number; reserveTokens: number; reserveInputTokens: number; reserveOutputTokens: number; tiers: GatewaySaleTier[]; variants?: { id: string; sale: GatewaySale }[] };

export type PublishedGatewayModel = GatewayModelDefinition & {
    displayName: string;
    badge: string;
    remark: string;
    sale: GatewaySale;
};

export type GatewayInput = { kind: "image" | "video" | "audio"; url: string; role: "reference_image" | "reference_video" | "reference_audio" | "first_frame" | "last_frame" };
export type GatewayParameters = { resolution: string; ratio: string; duration: number; generateAudio: boolean; watermark: boolean };

export function gatewayReferenceMode(inputs: Array<Pick<GatewayInput,"kind">>): GatewayReferenceMode {
    return inputs.some((i) => i.kind === "video") ? "video" : inputs.some((i) => i.kind === "image") ? "image" : inputs.some((i) => i.kind === "audio") ? "audio" : "text";
}

export function gatewayVariants(model: GatewayModelDefinition, parameters: Partial<GatewayParameters> = {}, mode?: GatewayReferenceMode) {
    return (model.variants || []).filter((v) => (!parameters.resolution || v.capabilities.resolutions.includes(parameters.resolution)) && (!parameters.ratio || v.capabilities.ratios.includes(parameters.ratio)) && (parameters.duration === undefined || parameters.duration >= v.capabilities.minDuration && parameters.duration <= v.capabilities.maxDuration) && (mode === undefined || !v.referenceModes?.length || v.referenceModes.includes(mode)) && (v.generateAudio === undefined || parameters.generateAudio === undefined || v.generateAudio === parameters.generateAudio));
}

export function resolveGatewayVariant(model: GatewayModelDefinition, parameters: GatewayParameters, inputs: Array<Pick<GatewayInput,"kind">>) {
    if (!model.variants?.length) return null;
    const matches = gatewayVariants(model, parameters, gatewayReferenceMode(inputs));
    if (matches.length !== 1) throw new Error("当前分辨率、比例、时长和参考素材没有唯一可用规格，请调整参数");
    return matches[0];
}

export function gatewaySaleFor(model: PublishedGatewayModel, variantId?: string): GatewaySale {
    if (!variantId) return model.sale;
    const sale = model.sale.variants?.find((v) => v.id === variantId)?.sale;
    if (!sale) throw new Error("此规格尚未发布售价，请刷新模型目录");
    return sale;
}

export function gatewayDisplaySpecs(model: PublishedGatewayModel) {
    return model.variants?.length ? model.variants.map((variant) => ({ ...variant, sale: gatewaySaleFor(model, variant.id) })) : [{ id: "", name: "", capabilities: model.capabilities, pricing: model.pricing, referenceModes: undefined, generateAudio: undefined, sale: model.sale }];
}

export function gatewayModel(config: AiConfig, model = config.model || config.videoModel) {
    if (config.channelMode !== "remote") return undefined;
    const active = channelIdForActiveModel({ ...config, model });
    return config.publicChannels.find((channel) => channel.id === active && channel.protocol === "gateway" && channel.enabled !== false)?.gatewayModels?.find((item) => item.id === model);
}

// A fixed-format channel owns these two settings; keep canvas defaults out of its request.
export function withFixedGatewayVideoSize(config: AiConfig): AiConfig {
    const caps = gatewayModel(config)?.capabilities;
    if (caps?.resolutions.length !== 1 || caps.ratios.length !== 1) return config;
    return { ...config, vquality: caps.resolutions[0].replace(/p$/i, ""), size: caps.ratios[0] };
}

export function gatewayParameters(config: AiConfig): GatewayParameters {
    const size = config.size.trim();
    const ratio = size === "auto" || size === "adaptive" ? "adaptive" : /^\d+x\d+$/.test(size) ? normalizeSeedanceRatio(size) : size;
    return { resolution: config.vquality.trim().replace(/p$/i, "") + "p", ratio, duration: Number(config.videoSeconds), generateAudio: config.videoGenerateAudio !== "false", watermark: config.videoWatermark === "true" };
}

export function gatewayCountError(model: GatewayModelDefinition, inputs: Array<Pick<GatewayInput, "kind">>, parameters?: GatewayParameters) {
    const candidates = model.variants?.length ? gatewayVariants(model, parameters, gatewayReferenceMode(inputs)) : [];
    const caps = candidates.length === 1 ? candidates[0].capabilities : model.capabilities;
    const counts = { image: 0, video: 0, audio: 0 };
    for (const input of inputs) counts[input.kind]++;
    for (const [kind, max, label] of [["image", caps.maxImages, "张图片"], ["video", caps.maxVideos, "段视频"], ["audio", caps.maxAudios, "段音频"]] as const) {
        if (counts[kind] > max) return `当前模型最多支持 ${max} ${label}，已连接 ${counts[kind]} 个素材`;
    }
    if (caps.maxTotal > 0 && inputs.length > caps.maxTotal) return `当前模型最多支持 ${caps.maxTotal} 个参考素材`;
    return "";
}

export function gatewayInputError(model: GatewayModelDefinition, inputs: Array<Pick<GatewayInput, "kind" | "role">>, parameters?: GatewayParameters) {
    if (model.variants?.length && parameters) {
        try { const variant = resolveGatewayVariant(model, parameters, inputs); if (variant) model = { ...model, variants: [], capabilities: variant.capabilities, pricing: variant.pricing }; }
        catch (error) { return error instanceof Error ? error.message : "规格不可用"; }
    }
    const caps = model.capabilities;
    const countError = gatewayCountError(model, inputs);
    if (countError) return countError;
    const first = inputs.filter((input) => input.role === "first_frame");
    const last = inputs.filter((input) => input.role === "last_frame");
    if (first.length > 1 || last.length > 1) return "首帧和尾帧各只能选择一张图片";
    if ((first.length && !caps.firstFrame) || (last.length && !caps.lastFrame)) return "当前模型不支持所选首尾帧";
    if (last.length && !first.length) return "使用尾帧时请同时选择首帧";
    if ((first.length || last.length) && inputs.some((input) => input.role.startsWith("reference_"))) return "首尾帧模式不能同时使用普通参考图片、视频或音频，请调整素材或取消首尾帧";
    if (!caps.audioOnly && inputs.some((input) => input.kind === "audio") && !inputs.some((input) => input.kind !== "audio")) return "当前模型的参考音频需要搭配图片或视频使用";
    if (parameters) {
        if (caps.watermark === false && parameters.watermark) return "当前规格不支持水印，请关闭水印选项";
        if (!caps.resolutions.includes(parameters.resolution)) return `当前模型支持 ${caps.resolutions.join("、")}，请调整分辨率`;
        if (!caps.ratios.includes(parameters.ratio)) return "当前模型不支持所选画面比例，请重新选择";
        if (!Number.isInteger(parameters.duration) || parameters.duration < caps.minDuration || parameters.duration > caps.maxDuration) return `当前模型支持 ${caps.minDuration}～${caps.maxDuration} 秒的整数时长`;
    }
    return "";
}
