"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw, Wallet } from "lucide-react";

import { fetchAccountCreditLogs, fetchCurrentUser, type CreditLogType } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

const types: { value: CreditLogType | ""; label: string }[] = [
    { value: "", label: "全部流水" },
    { value: "ai_consume", label: "模型消费" },
    { value: "ai_refund", label: "失败返还" },
    { value: "admin_adjust", label: "后台调整" },
];
const labels = Object.fromEntries(types.map((item) => [item.value, item.label]));
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const pageSize = 20;

export default function AccountPage() {
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const setSession = useUserStore((state) => state.setSession);
    const [page, setPage] = useState(1);
    const [type, setType] = useState<CreditLogType | "">("");
    const query = useQuery({
        queryKey: ["account", "credits", token, type, page],
        queryFn: async () => {
            const [account, logs] = await Promise.all([fetchCurrentUser(token), fetchAccountCreditLogs(token, { page, pageSize, type })]);
            return { account, logs };
        },
        enabled: Boolean(isReady && token && user),
        retry: false,
        refetchOnWindowFocus: true,
    });

    useEffect(() => {
        if (query.data?.account && query.data.account.role !== "guest" && useUserStore.getState().token === token) setSession(token, query.data.account);
    }, [query.data, setSession, token]);

    if (!isReady) return <main className="p-6 text-sm text-muted-foreground" aria-live="polite">正在读取账户…</main>;
    if (!user || !token) return (
        <main className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm text-center"><Wallet className="mx-auto size-9 text-muted-foreground" /><h1 className="mt-5 text-2xl font-semibold">账户与用量</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">登录后查看算力点余额、模型消费与返还记录。</p><Link href="/login?redirect=%2Faccount" className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">登录账户</Link></div>
        </main>
    );

    const account = query.data?.account || user;
    const logs = query.data?.logs;
    const total = logs?.total || 0;

    return (
        <main className="h-full overflow-y-auto px-5 py-7 md:px-9 md:py-9">
            <div className="mx-auto max-w-5xl">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">账户与用量</h1><p className="mt-2 text-sm text-muted-foreground">{account.displayName || account.username}，在这里查看每一笔算力点变动。</p></div><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />刷新</button></div>
                <section className="mt-7 rounded-2xl border border-border bg-card p-6 md:p-8" aria-label="算力点余额"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="size-4" />可用算力点</div><div className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">{number.format(account.credits)}</div><p className="mt-4 text-sm leading-6 text-muted-foreground">当前由管理员手动加点。使用平台模型时按已配置价格扣点，失败返还以流水记录为准。</p></section>
                <section className="mt-8" aria-label="算力点流水">
                    <div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-lg font-semibold">算力点流水</h2><div className="flex flex-wrap gap-1" aria-label="筛选流水类型">{types.map((item) => <button key={item.value} type="button" aria-pressed={type === item.value} onClick={() => { setType(item.value); setPage(1); }} className={`rounded-lg px-3 py-2 text-xs transition ${type === item.value ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{item.label}</button>)}</div></div>
                    {query.isError ? <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-card p-5 text-sm text-destructive">{query.error instanceof Error ? query.error.message : "读取账户失败"}。请重试，或重新登录。</div> : null}
                    {!query.isError || logs ? <>
                    <div className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-busy={query.isFetching}>
                        {query.isPending ? <p className="p-8 text-center text-sm text-muted-foreground">正在读取流水…</p> : !logs?.items.length ? <div className="px-5 py-12 text-center"><p className="font-medium">{type ? "暂无此类流水" : "暂无算力点流水"}</p><p className="mt-2 text-sm text-muted-foreground">后台调点、模型消费与失败返还会在这里记录。</p></div> : logs.items.map((log) => <article key={log.id} className="flex gap-3 px-4 py-5 md:px-5"><div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{log.amount >= 0 ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h3 className="text-sm font-medium">{labels[log.type] || log.type}</h3><time className="text-xs text-muted-foreground">{log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</time></div><p className="mt-1.5 break-words text-sm text-muted-foreground">{log.remark || log.model || "算力点变动"}</p>{log.relatedId ? <p className="mt-1 break-all text-xs text-muted-foreground">关联任务：{log.relatedId}</p> : null}</div><div className="shrink-0 text-right"><p className="text-sm font-semibold tabular-nums">{log.amount > 0 ? "+" : ""}{number.format(log.amount)}</p><p className="mt-1.5 text-xs tabular-nums text-muted-foreground">余额 {number.format(log.balance)}</p></div></article>)}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>共 {total} 条 · 每页 {pageSize} 条</span><div className="flex items-center gap-3"><button type="button" aria-label="上一页" disabled={page === 1 || query.isFetching} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-border p-1.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft className="size-4" /></button><span>第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页</span><button type="button" aria-label="下一页" disabled={page * pageSize >= total || query.isFetching} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-border p-1.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight className="size-4" /></button></div></div>
                    </> : null}
                </section>
            </div>
        </main>
    );
}
