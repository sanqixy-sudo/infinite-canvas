import type { ComponentProps } from "react";
import { Zap } from "lucide-react";
import { gatewaySaleFor, gatewayVariants, type GatewayParameters, type GatewayReferenceMode, type PublishedGatewayModel } from "@/lib/model-gateway";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Zap className="size-[1em] fill-current" strokeWidth={2.4} />
        </span>
    );
}

export type ModelCreditCost = {
    model: string;
    credits: number;
    billingUnit?: "token" | "second" | "call" | "variants";
    gateway?: PublishedGatewayModel;
    tokenMode?: import("@/lib/model-gateway").GatewayTokenMode;
    reserveCredits?: number;
    withoutVideoCreditsPerMillion?: number;
    withVideoCreditsPerMillion?: number;
    reserveTokens?: number;
    reserveInputTokens?: number;
    reserveOutputTokens?: number;
    tiers?: import("@/lib/model-gateway").GatewaySaleTier[];
};

export type TokenQuote = { unit?: "token" | "second" | "call"; variantId?: string; quantitySource?: string; reserveUnits?: number; unitPriceCredits?: number; tokenMode: import("@/lib/model-gateway").GatewayTokenMode; reserveCredits: number; unitPriceCreditsPerMillion: number; reserveTokens: number; inputPriceCreditsPerMillion: number; outputPriceCreditsPerMillion: number; reserveInputTokens: number; reserveOutputTokens: number };

export function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    const credits = modelCosts?.find((item) => item.model === model)?.credits;
    return typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits : null;
}

function roundCredits(amount: number) {
    return Math.round((amount + Number.EPSILON * Math.max(1, Math.abs(amount))) * 100) / 100;
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number; seconds?: string | number; hasReferenceVideo?: boolean; resolution?: string; ratio?: string; referenceMode?: GatewayReferenceMode; generateAudio?: boolean }): number | null {
    if (options.channelMode !== "remote") return 0;
    const entry = options.modelCosts?.find((item) => item.model === options.model);
    if (entry?.gateway) {
        const model = entry.gateway;
        const params = { resolution: options.resolution ? options.resolution.replace(/p$/i, "") + "p" : undefined, ratio: options.ratio, duration: options.seconds === undefined ? undefined : Number(options.seconds), generateAudio: options.generateAudio };
        const candidates = model.variants?.length ? gatewayVariants(model, params, options.referenceMode) : [{ id: "", capabilities: model.capabilities }];
        if (!candidates.length) return null;
        const amounts = candidates.map((variant) => {
            const sale = gatewaySaleFor(model, variant.id);
            if (!sale.unit || sale.unit === "token") return requestCreditCost({ ...options, modelCosts: [{ model: options.model, credits: 0, ...sale, billingUnit: "token" }] });
            const tiers = sale.tiers.filter((t) => !params.resolution || t.resolution === params.resolution);
            const rates = tiers.flatMap((t) => options.hasReferenceVideo === undefined ? [t.withoutVideoCredits,t.withVideoCredits] : [options.hasReferenceVideo ? t.withVideoCredits : t.withoutVideoCredits]);
            const quantity = sale.unit === "call" ? 1 : params.duration ?? variant.capabilities.maxDuration;
            if (!rates.length || !rates.every((r): r is number => typeof r === "number" && Number.isFinite(r) && r > 0) || !Number.isInteger(quantity) || quantity < 1) return null;
            return roundCredits(Math.max(...rates) * quantity);
        });
        return amounts.every((n): n is number => n !== null) ? Math.max(...amounts) : null;
    }
    if (entry?.billingUnit === "token") {
        if (entry.tokenMode !== "total_tokens" && entry.tokenMode !== "input_output_tokens") return null;
        const tier = entry.tiers?.find((item) => item.resolution === options.resolution?.replace(/p$/i, "") + "p");
        if (options.resolution && !tier) return null;
        const candidates = tier ? [tier] : entry.tiers?.length ? entry.tiers : [entry];
        if (entry.tokenMode === "input_output_tokens") {
            if (!entry.tiers?.length || !Number.isSafeInteger(entry.reserveInputTokens) || !Number.isSafeInteger(entry.reserveOutputTokens) || entry.reserveInputTokens! < 0 || entry.reserveOutputTokens! < 0 || entry.reserveInputTokens! + entry.reserveOutputTokens! <= 0 || entry.reserveInputTokens! + entry.reserveOutputTokens! > 1_000_000_000) return null;
            const kinds = options.hasReferenceVideo === undefined ? ["withoutVideo", "withVideo"] as const : options.hasReferenceVideo ? ["withVideo"] as const : ["withoutVideo"] as const;
            const reserves = (tier ? [tier] : entry.tiers).flatMap((item) => kinds.map((kind) => {
                const input = item[`${kind}InputCreditsPerMillion`];
                const output = item[`${kind}OutputCreditsPerMillion`];
                return typeof input === "number" && Number.isFinite(input) && input > 0 && typeof output === "number" && Number.isFinite(output) && output > 0
                    ? roundCredits((input * entry.reserveInputTokens! + output * entry.reserveOutputTokens!) / 1_000_000) : null;
            }));
            return reserves.every((value): value is number => value !== null && Number.isFinite(value)) ? Math.max(...reserves) : null;
        }
        if (!Number.isSafeInteger(entry.reserveTokens) || entry.reserveTokens! <= 0 || entry.reserveTokens! > 1_000_000_000) return null;
        const rates = candidates.flatMap((item) => options.hasReferenceVideo === undefined ? [item.withVideoCreditsPerMillion, item.withoutVideoCreditsPerMillion] : [options.hasReferenceVideo ? item.withVideoCreditsPerMillion : item.withoutVideoCreditsPerMillion]);
        const rate = rates.length && rates.every((item): item is number => typeof item === "number" && Number.isFinite(item) && item > 0) ? Math.max(...rates) : undefined;
        const reserve = rate !== undefined ? roundCredits(rate * entry.reserveTokens! / 1_000_000) : null;
        return typeof reserve === "number" && Number.isFinite(reserve) && reserve >= 0 ? reserve : null;
    }
    const price = modelCreditCost(options.modelCosts, options.model);
    if (price === null) return null;
    let count = Math.max(1, Math.floor(Number(options.count) || 1));
    if (options.seconds !== undefined && String(options.seconds).trim() !== "") {
        const seconds = Number(String(options.seconds).trim().toLowerCase().replace(/s$/, ""));
        if (!Number.isFinite(seconds) || (seconds <= 0 && seconds !== -1)) return null;
        count = seconds === -1 ? 15 : Math.ceil(seconds);
    }
    return Math.round(price * count * 100) / 100;
}

export function gatewayQuoteMatches(quote: TokenQuote, model: PublishedGatewayModel, parameters: GatewayParameters, variantId: string | undefined, hasReferenceVideo: boolean) {
    const sale = gatewaySaleFor(model, variantId);
    if ((quote.variantId || "") !== (variantId || "")) return false;
    if (!sale.unit || sale.unit === "token") return (quote.unit || "token") === "token" && tokenQuoteMatches(quote, { model: model.id, credits: 0, ...sale, billingUnit: "token" }, parameters.resolution, hasReferenceVideo);
    const tier = sale.tiers.find((t) => t.resolution === parameters.resolution);
    const price = hasReferenceVideo ? tier?.withVideoCredits : tier?.withoutVideoCredits;
    const units = sale.unit === "call" ? 1 : parameters.duration;
    const source = model.variants?.find((v) => v.id === variantId)?.pricing.quantitySource || model.pricing.quantitySource;
    return quote.unit === sale.unit && quote.quantitySource === source && quote.reserveUnits === units && typeof price === "number" && Number.isFinite(price) && quote.unitPriceCredits === price && Math.abs(quote.reserveCredits - roundCredits(price * units)) <= 0.0100001;
}

export function tokenQuoteMatches(quote: TokenQuote, cost: ModelCreditCost, resolution: string, hasReferenceVideo: boolean) {
    if (cost.tokenMode !== "total_tokens" && cost.tokenMode !== "input_output_tokens") return false;
    const tier = cost.tiers?.find((item) => item.resolution === resolution);
    if (!tier || quote.tokenMode !== cost.tokenMode) return false;
    const kind = hasReferenceVideo ? "withVideo" : "withoutVideo";
    const equal = (left: number | undefined, right: number | undefined) => typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-10 * Math.max(1, Math.abs(left), Math.abs(right));
    const pricesMatch = cost.tokenMode === "input_output_tokens"
        ? equal(quote.inputPriceCreditsPerMillion, tier[`${kind}InputCreditsPerMillion`]) && equal(quote.outputPriceCreditsPerMillion, tier[`${kind}OutputCreditsPerMillion`]) && quote.reserveInputTokens === cost.reserveInputTokens && quote.reserveOutputTokens === cost.reserveOutputTokens
        : equal(quote.unitPriceCreditsPerMillion, tier[`${kind}CreditsPerMillion`]) && quote.reserveTokens === cost.reserveTokens;
    const reserve = requestCreditCost({ channelMode: "remote", model: cost.model, modelCosts: [cost], resolution, hasReferenceVideo });
    // 规则与费率必须一致；金额允许浮点数在半分边界产生的一分舍入差，以服务端精确金额为准。
    return pricesMatch && reserve !== null && Number.isFinite(quote.reserveCredits) && quote.reserveCredits >= 0 && Math.abs(quote.reserveCredits - reserve) <= 0.0100001;
}
