"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, Input, Modal, Pagination, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, Film, Play, RefreshCw, RotateCcw, X } from "lucide-react";
import { saveAs } from "file-saver";
import { getProductionDeliveries, type ProductionDeliveryItem } from "@/services/api/production-overview";
import { actionProductionRender } from "@/services/api/production-render";
import { resolveMediaUrl } from "@/services/file-storage";
import { useUserStore } from "@/stores/use-user-store";
import { formatStorageBytes } from "@/lib/wallet-display";
import { readProductionDeliveryMedia } from "../canvas/project/[id]/production/production-delivery-media";

const labels = { completed: "成片已保存", queued: "等待合成", running: "正在合成", failed: "合成失败", cancelled: "已取消" };

export default function DeliveriesPage() {
    const { modal } = App.useApp();
    const token = useUserStore((state) => state.token), userId = useUserStore((state) => state.user?.id), version = useUserStore((state) => state.sessionVersion);
    const ready = useUserStore((state) => state.isReady && !state.authError && Boolean(state.token && state.user?.id));
    const [type, setType] = useState("completed"), [keyword, setKeyword] = useState(""), [page, setPage] = useState(1);
    const [busy, setBusy] = useState(""), [error, setError] = useState("");
    const [preview, setPreview] = useState<{ scope: string; item: ProductionDeliveryItem; url: string } | null>(null);
    const operation = useRef<AbortController | null>(null), mounted = useRef(false);
    const scope = `${userId}:${version}`;
    const list = useQuery({ queryKey: ["production-deliveries", scope, type, keyword, page], queryFn: () => getProductionDeliveries(token, { type, keyword, page, pageSize: 12 }), enabled: ready, refetchInterval: type === "" || type === "queued" || type === "running" ? 7000 : false, refetchIntervalInBackground: false });
    const current = () => { const state = useUserStore.getState(); return mounted.current && state.isReady && !state.authError && state.token === token && state.sessionVersion === version && state.user?.id === userId; };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
    useEffect(() => { operation.current?.abort(); operation.current = null; setBusy(""); setError(""); setPreview(null); setPage(1); }, [scope]);
    useEffect(() => { if (list.data && page > Math.max(1, Math.ceil(list.data.total / 12))) setPage(Math.max(1, Math.ceil(list.data.total / 12))); }, [list.data, page]);
    const perform = async (id: string, work: (signal: AbortSignal, assertCurrent: () => void) => Promise<void>) => {
        if (!current() || operation.current) return;
        const controller = new AbortController(); operation.current = controller; setBusy(id); setError("");
        const assertCurrent = () => { controller.signal.throwIfAborted(); if (!current()) throw new Error("登录状态已变化，请重新打开成片"); };
        try { await work(controller.signal, assertCurrent); }
        catch (failure) { if (current() && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "操作失败，请重试"); }
        finally { if (operation.current === controller) { operation.current = null; if (current()) setBusy(""); } }
    };
    const media = (item: ProductionDeliveryItem, download: boolean) => void perform(item.id, async (signal, assertCurrent) => {
        if (download) {
            const blob = await readProductionDeliveryMedia({ id: item.id, title: item.episodeTitle, kind: "video", canvasId: "", nodeId: "", storageKey: item.outputStorageKey, content: "" }, 256 << 20, signal, assertCurrent); assertCurrent();
            if (!blob.size || !blob.type.startsWith("video/")) throw new Error("成片内容不可用，请检查账号文件");
            saveAs(blob, `${item.projectTitle || "作品"}-${item.episodeTitle}-v${item.revision}.mp4`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"));
        } else {
            const url = await resolveMediaUrl(item.outputStorageKey); assertCurrent();
            if (!url) throw new Error("成片文件不可用，请刷新列表或检查账号文件");
            setPreview({ scope, item, url });
        }
    });
    const action = (item: ProductionDeliveryItem, action: "retry" | "cancel") => modal.confirm({ title: action === "retry" ? "按原快照重新合成？" : "取消本次合成？", content: action === "retry" ? "使用这次任务保存的镜头、音轨和字幕；当前计划的新修改不会加入。合成占用账号空间，不调用生成模型。" : "未完成的成片将停止处理，已有原始素材保留。", okText: action === "retry" ? "按原快照重试" : "取消合成", cancelText: "返回", onOk: () => perform(item.id, async (_signal, assertCurrent) => { await actionProductionRender(token, item.id, action); assertCurrent(); await list.refetch(); }) });
    return <main className="h-full overflow-y-auto"><div className="mx-auto max-w-[1320px] px-5 py-7 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs text-muted-foreground">把最后一帧，交付成作品</p><h1 className="text-3xl font-semibold tracking-tight">我的成片</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">集中查看各项目合成记录，预览、下载或返回分集继续编辑。这里只展示你的账号成片。</p></div><Link href="/production" className="inline-flex items-center gap-2 text-sm hover:underline">继续短剧制作<ArrowRight className="size-4" /></Link></header>
        <div className="my-7 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Select aria-label="成片状态" className="min-w-36" value={type} onChange={(value) => { setType(value); setPage(1); }} options={[{ value: "", label: "全部合成记录" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} /><Input.Search allowClear aria-label="搜索成片" placeholder="搜索分集名称" className="max-w-60" onSearch={(value) => { setKeyword(value.trim()); setPage(1); }} /></div><Button icon={<RefreshCw className="size-4" />} loading={list.isFetching} onClick={() => void list.refetch()}>刷新</Button></div>
        {error && <Alert className="mb-5" type="error" showIcon title={error} closable onClose={() => setError("")} />}
        {list.isError ? <Alert type="error" showIcon title={list.error.message} /> : list.isPending ? <p className="py-12 text-sm text-muted-foreground">正在读取成片…</p> : list.data.items.length ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.data.items.map((item) => <article className="overflow-hidden rounded-2xl border border-border bg-card" key={item.id}>
            <div className="flex min-h-32 items-center justify-between gap-4 bg-muted/45 px-5 py-6"><Film className="size-9 text-muted-foreground" strokeWidth={1.2} /><div className="text-right"><p className="text-sm font-medium">{labels[item.status]}{item.status === "running" ? ` ${item.progress}%` : ""}</p><p className="mt-2 text-xs text-muted-foreground">720×1280 · {item.seconds} 秒 · {item.shotCount} 镜头</p></div></div>
            <div className="p-5"><p className="mb-2 truncate text-xs text-muted-foreground">{item.projectTitle || "原制作计划已移除"}</p><h2 className="truncate text-lg font-semibold">{item.episodeTitle}</h2><p className="mt-2 text-xs text-muted-foreground">计划版本 {item.revision} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p>{item.error && <p className="mt-3 break-words text-xs leading-6 text-destructive">{item.error}</p>}{item.status === "completed" && <p className="mt-3 text-xs text-muted-foreground">{item.fileAvailable ? `${formatStorageBytes(item.outputBytes)} · 已存入账号文件` : "文件已删除或不再可用，合成记录仍保留"}</p>}
                <div className="mt-5 flex flex-wrap gap-2">{item.status === "completed" && <><Button icon={<Play className="size-3.5" />} disabled={!item.fileAvailable || Boolean(busy)} onClick={() => media(item, false)}>预览</Button><Button icon={<Download className="size-3.5" />} disabled={!item.fileAvailable || Boolean(busy)} loading={busy === item.id} onClick={() => media(item, true)}>下载</Button></>}{(item.status === "failed" || item.status === "cancelled") && <Button disabled={Boolean(busy)} icon={<RotateCcw className="size-3.5" />} onClick={() => action(item, "retry")}>重试合成</Button>}{(item.status === "running" || item.status === "queued") && <Button disabled={Boolean(busy)} icon={<X className="size-3.5" />} onClick={() => action(item, "cancel")}>取消合成</Button>}</div>
                {item.projectTitle && <Link className="mt-5 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" href={`/canvas/project/${encodeURIComponent(item.workspaceId)}/production?tab=delivery&episode=${encodeURIComponent(item.episodeId)}`}>返回分集交付<ArrowRight className="size-3" /></Link>}
            </div>
        </article>)}</section> : <section className="rounded-2xl border border-dashed border-border px-6 py-16 text-center"><Film className="mx-auto mb-4 size-9 text-muted-foreground" strokeWidth={1.2} /><h2 className="font-medium">{keyword || type !== "completed" ? "暂无符合条件的合成记录" : "下一部成片，从镜头开始"}</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">在制作计划中采用每个镜头的候选，完成音轨和字幕编辑，再到“分集交付”提交合成。</p><Link href="/production" className="mt-5 inline-flex items-center gap-2 text-sm font-medium">打开短剧制作<ArrowRight className="size-4" /></Link></section>}
        <Pagination className="mt-7" current={page} pageSize={12} total={list.data?.total || 0} onChange={setPage} showSizeChanger={false} hideOnSinglePage />
        <Modal title={preview?.item.episodeTitle || "成片预览"} open={preview?.scope === scope} onCancel={() => setPreview(null)} footer={null} width={800} destroyOnHidden>{preview?.scope === scope && <><p className="mb-3 text-xs text-muted-foreground">{preview.item.projectTitle} · 计划版本 {preview.item.revision} · {preview.item.seconds} 秒</p><video key={preview.item.id} controls playsInline preload="metadata" src={preview.url} className="max-h-[70vh] w-full bg-muted object-contain" onError={() => setError("成片无法播放，请下载检查文件或刷新后重试")} /></>}</Modal>
    </div></main>;
}
