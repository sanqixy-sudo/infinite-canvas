"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { App, Alert, Button, Empty, Input, Pagination, Select, Spin } from "antd";
import { ArrowUpRight, Check, CircleAlert, Clock3, Film, Image, ListChecks, Music2, RefreshCw, Search, Square, Video } from "lucide-react";
import { useUserStore } from "@/stores/use-user-store";
import { fetchTaskCenter, type TaskCenterItem } from "@/services/api/task-center";
import { stopCanvasTask } from "@/services/api/canvas-tasks";
import { actionProductionRender } from "@/services/api/production-render";
import { formatCredits } from "@/lib/wallet-display";

const types = [{ value: "", label: "全部类型" }, { value: "image", label: "图片生成" }, { value: "video", label: "视频生成" }, { value: "audio", label: "音频生成" }, { value: "render", label: "成片合成" }];
const states = [{ value: "all", label: "全部任务" }, { value: "active", label: "进行中" }, { value: "attention", label: "需要关注" }, { value: "completed", label: "已完成" }, { value: "failed", label: "失败" }, { value: "cancelled", label: "已停止" }, { value: "unknown", label: "结果未知" }];
const labels: Record<string, string> = { queued: "排队中", submitting: "提交中", processing: "处理中", running: "生成中", in_progress: "生成中", completed: "已完成", failed: "失败", cancelled: "已停止", unknown: "结果未知" };
const billingLabels: Record<string, string> = { reserved: "已预扣", pending_usage: "等待用量", pending_balance: "等待补扣", settled: "已结算", released: "已退回", charged: "已扣款", no_charge: "合成本身不扣算力", unknown: "费用未知" };
const icons = { image: Image, video: Video, audio: Music2, render: Film };
const activeStates = new Set(["queued", "submitting", "processing", "running", "in_progress"]);
const amount = (value: number | null) => value === null ? "未知" : `${formatCredits(value)} 点`;

export default function TasksPage() {
    const { message, modal } = App.useApp();
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id);
    const version = useUserStore((state) => state.sessionVersion);
    const ready = useUserStore((state) => state.isReady && !state.authError && Boolean(state.token && state.user?.id));
    const [type, setType] = useState("");
    const [status, setStatus] = useState("all");
    const [keyword, setKeyword] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [busy, setBusy] = useState("");
    const query = useQuery({ queryKey: ["task-center", userId, version, type, status, search, page], queryFn: () => fetchTaskCenter(token, { type, status, keyword: search, page, pageSize: 20 }), enabled: ready, retry: false, refetchInterval: 8000, refetchIntervalInBackground: false });
    useEffect(() => { setPage(1); setBusy(""); }, [userId, version]);
    useEffect(() => { if (query.data && page > Math.max(1, Math.ceil(query.data.total / 20))) setPage(Math.max(1, Math.ceil(query.data.total / 20))); }, [query.data, page]);
    const stop = (item: TaskCenterItem) => {
        const current = () => { const state = useUserStore.getState(); return state.token === token && state.user?.id === userId && state.sessionVersion === version && !state.authError; };
        modal.confirm({ title: item.kind === "render" ? "停止这次成片合成？" : "停止这次任务？", content: item.kind === "render" ? "停止后保留原镜头、音轨和素材，可回分集交付检查。" : "将停止平台对这次任务的处理。已经送达上游的调用可能仍产生费用，实际扣退以账户流水为准；不会自动重试。", okText: "确认停止", cancelText: "继续等待", okButtonProps: { danger: true }, onOk: async () => {
            if (!current()) return;
            setBusy(`${item.kind}:${item.id}`);
            try {
                if (item.kind === "render") await actionProductionRender(token, item.id, "cancel");
                // The list returns the stored workflow ID, not its original client ID; do not hash it again.
                else await stopCanvasTask(item.kind, item.id, false, item.source as "canvas" | "video-workbench");
                if (current()) { message.success("停止请求已处理，请查看最新状态"); await query.refetch(); }
            } catch (error) { if (current()) { message.error(error instanceof Error ? error.message : "停止失败，请刷新查看任务状态"); throw error; } }
            finally { if (current()) setBusy(""); }
        } });
    };

    return <main className="h-full overflow-y-auto px-5 py-7 sm:px-8 lg:px-10"><div className="mx-auto max-w-[1320px]">
        <header className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs text-muted-foreground">创作空间 / 任务中心</p><h1 className="mt-3 flex items-center gap-3 text-2xl font-semibold tracking-tight"><ListChecks className="size-6" />每一步创作，都有迹可循</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">集中查看图片、视频、音频与成片进度。回到原画布检查结果，或进入制作计划继续交付。</p></div><Button icon={<RefreshCw className={`size-4 ${query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />} disabled={query.isFetching} onClick={() => void query.refetch()}>刷新任务</Button></header>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-y border-border py-4"><div className="flex flex-wrap gap-1" aria-label="任务状态筛选">{states.slice(0, 4).map((entry) => <button type="button" key={entry.value} aria-pressed={status === entry.value} onClick={() => { setStatus(entry.value); setPage(1); }} className={`min-h-9 rounded-lg px-3 text-sm transition-colors ${status === entry.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{entry.label}</button>)}</div><span className="text-xs tabular-nums text-muted-foreground">{query.data ? `${query.data.total} 项符合条件` : "读取任务记录"}</span></div>
        <div className="my-5 flex flex-wrap items-center gap-3"><Select aria-label="任务类型" value={type} options={types} className="w-36" onChange={(value) => { setType(value); setPage(1); }} /><Select aria-label="任务状态" value={status} options={states} className="w-36" onChange={(value) => { setStatus(value); setPage(1); }} /><Input aria-label="搜索模型或任务" prefix={<Search className="size-4 text-muted-foreground" />} className="!w-full sm:!w-72" value={keyword} maxLength={100} placeholder="搜索模型、任务编号或成片名称" allowClear onChange={(event) => { setKeyword(event.target.value); if (!event.target.value) { setSearch(""); setPage(1); } }} onPressEnter={() => { setSearch(keyword.trim()); setPage(1); }} /><Button onClick={() => { setSearch(keyword.trim()); setPage(1); }}>搜索</Button></div>
        {query.isError && <Alert className="mb-5" type="error" showIcon title={query.error instanceof Error ? query.error.message : "任务读取失败"} action={<Button size="small" onClick={() => void query.refetch()}>重新读取</Button>} />}
        {query.isPending ? <div className="py-24 text-center"><Spin /><p className="mt-4 text-sm text-muted-foreground">正在读取账号任务…</p></div> : query.data?.items.length ? <div className="divide-y divide-border border-y border-border" aria-busy={query.isFetching}>{query.data.items.map((item) => {
            const Icon = icons[item.kind]; const active = activeStates.has(item.status); const key = `${item.kind}:${item.id}`;
            const productionHref = item.workspaceId ? `/canvas/project/${encodeURIComponent(item.workspaceId)}/production?tab=${item.kind === "render" ? "delivery" : "tasks"}${item.episodeId ? `&episode=${encodeURIComponent(item.episodeId)}` : ""}` : "";
            return <article key={key} className="grid gap-4 py-5 md:grid-cols-[40px_minmax(0,1fr)_180px] lg:grid-cols-[40px_minmax(0,1fr)_240px]">
                <span className="hidden size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground md:flex"><Icon className="size-5" /></span>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><h2 className="break-words text-sm font-semibold">{item.title || item.model || (item.kind === "render" ? "分集合成" : "生成任务")}</h2><span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">{types.find((entry) => entry.value === item.kind)?.label}{item.workflow ? " · 工作流" : item.gateway ? " · 模型网关" : ""}</span>{item.archived && <span className="text-[10px] text-muted-foreground">历史记录</span>}</div>
                    {item.title && item.model && <p className="mt-1.5 text-xs text-muted-foreground">{item.model}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"><span className={`inline-flex items-center gap-1.5 ${item.status === "failed" || item.status === "unknown" ? "text-destructive" : "text-muted-foreground"}`}>{item.status === "completed" ? <Check className="size-3.5" /> : item.status === "failed" || item.status === "unknown" ? <CircleAlert className="size-3.5" /> : <Clock3 className="size-3.5" />}{labels[item.status] || item.status}{active ? ` · ${item.progress}%` : ""}</span><time className="text-muted-foreground" dateTime={item.createdAt}>{item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知"}</time></div>
                    {active && <div role="progressbar" aria-label="任务进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} className="mt-3 h-1 max-w-sm overflow-hidden rounded bg-muted"><div className="h-full bg-foreground/65 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${item.progress}%` }} /></div>}
                    {item.error && <p className="mt-3 text-xs leading-6 text-destructive">{item.error}</p>}
                    {item.gateway && active && <p className="mt-2 text-xs leading-6 text-muted-foreground">此渠道提交后无法取消，将在后台继续生成与结算。</p>}
                    <details className="mt-3 text-[11px] text-muted-foreground"><summary className="w-fit cursor-pointer">任务编号与费用</summary><p className="mt-2 break-all font-mono">{item.id}</p><dl className="mt-2 grid max-w-md grid-cols-2 gap-x-5 gap-y-1 leading-6"><dt>已扣款</dt><dd className="text-right tabular-nums">{amount(item.chargedCredits)}</dd><dt>已退回</dt><dd className="text-right tabular-nums">{amount(item.refundedCredits)}</dd><dt>当前净扣</dt><dd className="text-right tabular-nums">{amount(item.netCredits)}</dd>{item.reservedCredits !== null && <><dt>提交时预扣</dt><dd className="text-right tabular-nums">{amount(item.reservedCredits)}</dd></>}</dl></details>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-3 md:flex-col md:items-end"><div className="md:text-right"><p className="text-sm font-medium tabular-nums">{item.kind === "render" ? "合成不扣算力" : item.settledCredits !== null ? `实扣 ${amount(item.settledCredits)}` : item.netCredits !== null ? `当前占用 ${amount(item.netCredits)}` : "费用待核实"}</p><p className="mt-1.5 text-[11px] text-muted-foreground">{billingLabels[item.billingStatus] || "等待账务状态"}</p></div><div className="flex flex-wrap justify-end gap-2">{item.canvasId && !(item.kind === "audio" && item.id.startsWith("production_voice_")) && <Link href={`/canvas/${encodeURIComponent(item.canvasId)}${item.nodeId ? `?focusNodeId=${encodeURIComponent(item.nodeId)}` : ""}`} className="inline-flex min-h-8 items-center gap-1 text-xs hover:underline">回到画布<ArrowUpRight className="size-3.5" /></Link>}{productionHref && <Link href={productionHref} className="inline-flex min-h-8 items-center gap-1 text-xs hover:underline">{item.kind === "render" ? "分集交付" : "制作任务"}<ArrowUpRight className="size-3.5" /></Link>}{item.canStop && <Button size="small" danger icon={<Square className="size-3" />} loading={busy === key} disabled={Boolean(busy) && busy !== key} onClick={() => stop(item)}>停止</Button>}</div></div>
            </article>;
        })}</div> : !query.isError && <div className="rounded-xl border border-dashed border-border py-20"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={type || search || status !== "all" ? "没有符合条件的任务" : "还没有账号任务"} /><p className="mt-3 px-5 text-center text-xs text-muted-foreground">在画布生成或提交成片后，服务端保存的任务会出现在这里。</p><div className="mt-5 text-center"><Link href="/canvas" className="text-sm underline underline-offset-4">前往我的项目</Link></div></div>}
        {query.data && query.data.total > 0 && <div className="mt-6 flex justify-end"><Pagination current={page} pageSize={20} total={query.data.total} showSizeChanger={false} showLessItems onChange={setPage} /></div>}
        <p className="mt-7 max-w-4xl text-[11px] leading-6 text-muted-foreground">这里只展示当前账号保存在服务端的任务与镜头历史，工作流按实际媒体类型归类。普通任务清理后，仅已绑定镜头并持久记录的历史继续保留。费用来自服务端扣退流水；未知不表示免费，预扣不代表最终结算。成片合成本身不扣算力，配音等模型调用单独记录。</p>
    </div></main>;
}
