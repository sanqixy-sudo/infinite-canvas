"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Cpu, Image, MessageSquare, Music2, RefreshCw, Search, Video } from "lucide-react";

import { GatewayModelPrice } from "@/components/gateway-model-price";
import { platformModelCatalogue } from "@/lib/platform-model-catalogue";
import { useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const capabilities = [
    { value: "image", label: "图片", icon: Image, href: "/canvas" },
    { value: "video", label: "视频", icon: Video, href: "/canvas" },
    { value: "audio", label: "音频", icon: Music2, href: "/canvas" },
    { value: "text", label: "文本", icon: MessageSquare, href: "/canvas" },
] as const;
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });

export default function ModelsPage() {
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const loading = useConfigStore((state) => state.isPublicSettingsLoading);
    const loadSettings = useConfigStore((state) => state.loadPublicSettings);
    const user = useUserStore((state) => state.user);
    const [error, setError] = useState("");
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<ModelCapability | "">("");
    const catalogue = useMemo(() => platformModelCatalogue(publicSettings), [publicSettings]);
    const models = catalogue.filter((item) => (!capability || item.capability === capability) && `${item.name} ${item.channel}`.toLowerCase().includes(keyword.trim().toLowerCase()));
    const remoteEnabled = user?.role === "admin" || publicSettings?.modelChannel.allowUserRemoteChannel === true;

    useEffect(() => { void loadSettings().catch((reason) => setError(reason instanceof Error ? reason.message : "读取模型清单失败")); }, [loadSettings]);

    const refresh = async () => {
        setError("");
        try { await loadSettings(); } catch (reason) { setError(reason instanceof Error ? reason.message : "读取模型清单失败"); }
    };

    return (
        <main className="h-full overflow-y-auto px-5 py-7 md:px-9 md:py-9">
            <div className="mx-auto max-w-6xl">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">模型与价格</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">查看平台公开模型与计费规则。不同模型按 Token、秒、张或次计费，具体以各模型说明为准。</p></div><button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />刷新清单</button></div>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-border py-4"><div className="flex flex-wrap gap-1" aria-label="模型能力筛选"><button type="button" aria-pressed={capability === ""} onClick={() => setCapability("")} className={`rounded-lg px-3 py-2 text-sm ${capability === "" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>全部模型</button>{capabilities.map((item) => <button type="button" key={item.value} aria-pressed={capability === item.value} onClick={() => setCapability(item.value)} className={`rounded-lg px-3 py-2 text-sm ${capability === item.value ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{item.label}</button>)}</div><label className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 sm:w-64"><Search className="size-4 shrink-0 text-muted-foreground" /><input aria-label="搜索模型或渠道" placeholder="搜索模型或渠道" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></label></div>
                {error ? <p role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive">{error}，请刷新重试。</p> : null}
                {publicSettings && !remoteEnabled ? <p className="mt-5 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">平台模型暂未向普通用户开放，请联系管理员开通。</p> : null}
                {!publicSettings && !error ? <p className="py-16 text-center text-sm text-muted-foreground">正在读取模型清单…</p> : !models.length && !error ? <div className="py-20 text-center"><Cpu className="mx-auto size-9 text-muted-foreground" /><h2 className="mt-4 text-lg font-semibold">{catalogue.length ? "没有符合条件的模型" : "暂无可用模型"}</h2><p className="mt-2 text-sm text-muted-foreground">{catalogue.length ? "调整能力筛选或搜索关键词。" : "管理员配置并公开模型和价格后，将在这里显示。"}</p></div> : <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{models.map((item) => {
                    const meta = capabilities.find((value) => value.value === item.capability)!;
                    const Icon = meta.icon;
                    const split = item.tokenMode === "input_output_tokens";
                    return <article key={item.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
                        <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{meta.label}{item.workflow ? "工作流" : "模型"}</span><span className="max-w-[50%] truncate text-xs text-muted-foreground" title={item.channel}>{item.channel}</span></div>
                        <h2 className="mt-5 break-words text-base font-semibold leading-6">{item.name}{item.badge ? <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] font-normal">{item.badge}</span> : null}</h2>
                        {item.remark ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.remark}</p> : null}
                        {item.gateway ? <div className="my-5"><GatewayModelPrice model={item.gateway} /></div> : <div className="mb-5 mt-4 flex flex-wrap items-baseline gap-1.5"><strong className="text-2xl font-semibold tabular-nums">{split ? "输入 / 输出分项" : item.credits === 0 && !item.tokenTiers ? "免费" : number.format(item.credits)}{item.tokenTiers && !split ? <span className="ml-1 text-xs font-normal">起</span> : null}</strong><span className="text-xs text-muted-foreground">{item.credits > 0 ? `算力点 / ${item.unit}` : `已配置为 0 点 / ${item.unit}`}</span></div>}
                        {!item.gateway && item.tokenTiers ? <div className="mb-5 space-y-3 text-xs leading-5 text-muted-foreground">
                            {item.tokenTiers.map((tier) => <div key={tier.resolution} className="border-t border-border pt-2"><strong className="text-foreground">{tier.resolution}</strong>{(["withoutVideo", "withVideo"] as const).map((kind) => <div key={kind} className="mt-1 flex flex-wrap justify-between gap-x-2"><span>{kind === "withoutVideo" ? "无参考视频" : "有参考视频"}</span><span className="tabular-nums">{split ? `输入 ${number.format(tier[`${kind}InputCreditsPerMillion`]!)} / 输出 ${number.format(tier[`${kind}OutputCreditsPerMillion`]!)}` : number.format(tier[`${kind}CreditsPerMillion`])}</span></div>)}</div>)}
                            <p>{split ? `预扣输入 ${item.reserveInputTokens?.toLocaleString()}、输出 ${item.reserveOutputTokens?.toLocaleString()} Token 对应算力；完成后按实际输入 × 输入价 + 实际输出 × 输出价结算。` : `预扣 ${item.reserveTokens?.toLocaleString()} Token 对应算力，完成后按实际总 Token 多退少补。`}</p>
                        </div> : null}
                        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-muted-foreground">{item.workflow ? "在画布中选择工作流" : "按提交参数计算扣点"}</span>{remoteEnabled ? <Link href={user ? item.workflow ? "/canvas" : meta.href : "/login?redirect=%2Fmodels"} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline">{user ? "前往创作" : "登录使用"}<ArrowUpRight className="size-3.5" /></Link> : <span className="text-xs text-muted-foreground">待管理员开通</span>}</div>
                    </article>;
                })}</div>}
                {catalogue.length > 0 ? <p className="mt-6 text-xs leading-6 text-muted-foreground">共 {catalogue.length} 项公开配置。Token 模型预扣后按接口实际用量结算；按秒模型按各自计费规则处理。实际扣点与返还请查看<Link href="/account" className="underline underline-offset-4">账户流水</Link>。</p> : null}
            </div>
        </main>
    );
}
