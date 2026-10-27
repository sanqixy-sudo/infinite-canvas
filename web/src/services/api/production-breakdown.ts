import type { ProductionDocument } from "@/app/(user)/canvas/lib/production-types";
import { parseProductionBreakdown, productionBreakdownPrompt } from "@/app/(user)/canvas/utils/production-breakdown";
import type { AdminModelCost } from "./admin";
import { requestCanvasAgentTurn } from "./canvas-agent";
import { requireCloudModelAccess } from "./cloud-model-access";
import { channelProtocolForConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export function productionBreakdownPrice(config: AiConfig, prices: AdminModelCost[]) {
    if (config.channelMode !== "remote" || !selectableModelsByCapability(config, "text").includes(config.textModel)) throw new Error("请选择平台已开放的文字模型");
    const price = prices.find((item) => item.model === config.textModel);
    if (!price || !Number.isFinite(price.credits) || price.credits < 0) throw new Error("该文字模型尚未配置价格，请更换模型或联系管理员");
    if (price.billingUnit === "token") throw new Error("当前文字调用采用按次计费，请管理员为文字模型配置按次价格");
    return price.credits;
}

export async function requestProductionBreakdown(input: { document: ProductionDocument; episodeId: string; count: number; instructions: string; config: AiConfig; prices: AdminModelCost[]; signal: AbortSignal }) {
    requireCloudModelAccess(input.config);
    productionBreakdownPrice(input.config, input.prices);
    const prompt = productionBreakdownPrompt(input.document, input.episodeId, input.count, input.instructions);
    const result = await requestCanvasAgentTurn({
        config: { ...input.config, model: input.config.textModel, apiMode: channelProtocolForConfig(input.config) === "gemini" ? "chat" : input.config.apiMode, count: "1" },
        systemPrompt: prompt.system, messages: [{ role: "user", content: prompt.user }],
        tools: [], toolMode: "prompt-json", signal: input.signal,
    });
    if (result.toolCalls.length || result.toolError) throw new Error("模型返回了不允许执行的工具调用，本次未写入制作计划");
    return parseProductionBreakdown(result.content, input.document, input.episodeId, prompt.sourceSnapshot, input.count);
}
