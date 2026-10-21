import { modelCreditCost } from "@/constant/credits";
import { isWorkflowProtocol } from "@/lib/model-channel";
import type { AdminPublicSettings } from "@/services/api/admin";
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
        return channel.models.flatMap((model) => {
            const credits = modelCreditCost(config.modelCosts, model);
            if (!allowed.has(model) || credits === null) return [];
            const capability = (["image", "video", "audio", "text"] as const).find((value) => modelMatchesCapability(model, value, channel.protocol, channel.modelCapabilities)) || "text";
            return [{ id: `${channel.id}:${model}`, name: model, model, channel: channel.name || "平台渠道", capability, credits, unit: capability === "video" ? "秒" : capability === "image" ? "张" : "次", workflow: false }];
        });
    });
}
