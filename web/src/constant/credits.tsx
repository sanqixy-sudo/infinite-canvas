import type { ComponentProps } from "react";
import { Zap } from "lucide-react";

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
};

export function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    const credits = modelCosts?.find((item) => item.model === model)?.credits;
    return typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits : null;
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number; seconds?: string | number }) {
    if (options.channelMode !== "remote") return 0;
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
