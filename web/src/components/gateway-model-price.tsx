import { gatewayDisplaySpecs, type PublishedGatewayModel } from "@/lib/model-gateway";

const price = (value?: number) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toLocaleString("zh-CN", { maximumFractionDigits: 4 }) : "待定价";
const modes = { text: "纯文本", image: "图片参考", video: "视频参考", audio: "音频参考" };

export function GatewayModelPrice({ model }: { model: PublishedGatewayModel }) {
    return <span className="block space-y-3 text-xs leading-5 tabular-nums">{gatewayDisplaySpecs(model).map((spec) => {
        const unit = spec.pricing.unit;
        const split = unit === "token" && spec.sale.tokenMode === "input_output_tokens";
        const tiers = spec.sale.tiers.filter((tier) => spec.capabilities.resolutions.includes(tier.resolution));
        return <span key={spec.id} className="block space-y-1">
            {spec.name ? <span className="block font-medium">{spec.name} · {spec.capabilities.ratios.join(" / ")}</span> : null}
            {spec.referenceModes?.length ? <span className="block opacity-65">{spec.referenceModes.map((mode) => modes[mode]).join(" / ")}{spec.generateAudio === undefined ? "" : spec.generateAudio ? " · 生成音频" : " · 不生成音频"}</span> : null}
            {spec.name ? <span className="block opacity-65">{spec.capabilities.minDuration}–{spec.capabilities.maxDuration} 秒 · 图 {spec.capabilities.maxImages} / 视频 {spec.capabilities.maxVideos} / 音频 {spec.capabilities.maxAudios}{spec.capabilities.maxTotal ? ` · 合计 ${spec.capabilities.maxTotal}` : ""}</span> : null}
            <span className="block opacity-65">算力 / {unit === "token" ? "百万 Token" : unit === "second" ? "秒" : "次"}</span>
            {tiers.map((tier) => <span key={tier.resolution} className="block"><span className="block font-medium">{tier.resolution}</span>{(["withoutVideo", "withVideo"] as const).map((kind) => <span key={kind} className="block">{kind === "withoutVideo" ? "无视频参考" : "带视频参考"}：{split ? `输入 ${price(tier[`${kind}InputCreditsPerMillion`])} / 输出 ${price(tier[`${kind}OutputCreditsPerMillion`])}` : unit === "token" ? price(tier[`${kind}CreditsPerMillion`]) : price(tier[`${kind}Credits`])}</span>)}</span>)}
            <span className="block opacity-65">{unit === "token" ? split ? `预扣输入 ${spec.sale.reserveInputTokens.toLocaleString()} / 输出 ${spec.sale.reserveOutputTokens.toLocaleString()} Token，完成后按实际分项结算` : `预扣 ${spec.sale.reserveTokens.toLocaleString()} Token，完成后按实际总量结算` : unit === "call" ? "预扣 1 次，成功结算，明确失败退回" : spec.pricing.quantitySource === "response_duration" ? "按请求时长预扣，完成后按返回的实际时长结算" : "按本次请求时长计费，明确失败退回"}</span>
        </span>;
    })}</span>;
}
