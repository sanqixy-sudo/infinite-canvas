import { modelCreditCost } from "@/constant/credits";
import { isWorkflowProtocol } from "@/lib/model-channel";
import type { AdminPublicSettings } from "@/services/api/admin";
import { gatewayDisplaySpecs, type PublishedGatewayModel, type GatewaySaleTier, type GatewayTokenMode } from "@/lib/model-gateway";
import { modelMatchesCapability, type ModelCapability } from "@/stores/use-config-store";

export type PlatformModel = {
    id: string;
    name: string;
    model: string;
    channel: string;
    capability: ModelCapability;
    credits: number;
    unit: string;
    workflow: boolean;
    tokenTiers?: GatewaySaleTier[];
    gateway?: PublishedGatewayModel;
    tokenMode?: GatewayTokenMode;
    reserveTokens?: number;
    reserveInputTokens?: number;
    reserveOutputTokens?: number;
    badge?: string;
    remark?: string;
};

export function platformModelCatalogue(settings: AdminPublicSettings | null): PlatformModel[] {
    if (!settings) return [];
    const config = settings.modelChannel;
    const allowed = new Set(config.availableModels);
    const allowedWorkflows = new Set(config.availableWorkflows || []);
    return config.channels.flatMap<PlatformModel>((channel) => {
        if (!channel.enabled) return [];
        if (isWorkflowProtocol(channel.protocol)) return (channel.workflows || []).flatMap((entry) => {
            const model = `workflow:system:${channel.id}:${entry.kind}:${entry.workflowId}`;
            const credits = modelCreditCost(config.modelCosts, model);
            return entry.enabled && allowedWorkflows.has(model) && credits !== null
                ? [{ id: model, name: entry.title || entry.workflowId, model, channel: channel.name || "平台渠道", capability: entry.capability, credits, unit: "次", workflow: true }]
                : [];
        });
        return channel.models.flatMap<PlatformModel>((model) => {
            const gateway = channel.gatewayModels?.find((item) => item.id === model);
            if (gateway && allowed.has(model)) {
                const specs = gatewayDisplaySpecs(gateway);
                const rates = specs.flatMap((spec) => spec.sale.tiers.flatMap((tier) => spec.pricing.unit !== "token" ? [tier.withoutVideoCredits, tier.withVideoCredits] : spec.sale.tokenMode === "input_output_tokens" ? [tier.withoutVideoInputCreditsPerMillion, tier.withoutVideoOutputCreditsPerMillion, tier.withVideoInputCreditsPerMillion, tier.withVideoOutputCreditsPerMillion] : [tier.withVideoCreditsPerMillion, tier.withoutVideoCreditsPerMillion]));
                if (!rates.length || !rates.every((rate): rate is number => typeof rate === "number" && Number.isFinite(rate) && rate > 0)) return [];
                const mixed = new Set(specs.map((spec) => spec.pricing.unit)).size > 1;
                return [{ id: `${channel.id}:${model}`, name: gateway.displayName || gateway.name || model, model, channel: gateway.group || channel.name, capability: "video" as const, credits: Math.min(...rates), unit: mixed ? "不同规格" : specs[0].pricing.unit === "token" ? "百万 Token" : specs[0].pricing.unit === "second" ? "秒" : "次", workflow: false, gateway, tokenTiers: gateway.variants?.length || gateway.pricing.unit !== "token" ? undefined : gateway.sale.tiers, tokenMode: gateway.sale.tokenMode, reserveTokens: gateway.sale.reserveTokens, reserveInputTokens: gateway.sale.reserveInputTokens, reserveOutputTokens: gateway.sale.reserveOutputTokens, badge: gateway.badge, remark: gateway.remark }];
            }
            const credits = modelCreditCost(config.modelCosts, model);
            if (!allowed.has(model) || credits === null) return [];
            const capability = (["image", "video", "audio", "text"] as const).find((value) => modelMatchesCapability(model, value, channel.protocol, channel.modelCapabilities)) || "text";
            return [{ id: `${channel.id}:${model}`, name: model, model, channel: channel.name || "平台渠道", capability, credits, unit: capability === "video" ? "秒" : capability === "image" ? "张" : "次", workflow: false }];
        });
    });
}
