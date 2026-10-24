"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button } from "antd";
import { Download, Film, Play, RotateCcw, X } from "lucide-react";
import { nanoid } from "nanoid";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { notifyAccountWalletRefresh } from "@/lib/account-wallet-events";
import { resolveMediaUrl } from "@/services/file-storage";
import { createProductionRender, actionProductionRender, cancelProductionRenderRequest, fetchProductionRenderByRequest, fetchProductionRenders, type ProductionRenderInput, type ProductionRenderJob } from "@/services/api/production-render";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore } from "../../../../stores/use-canvas-store";
import { emptyProductionDelivery, productionDeliveryIssues, productionShotTimings } from "../../../../utils/production-delivery-edit";
import type { ProductionDocument } from "../../../../lib/production-types";
import { readProductionDeliveryMedia } from "../production-delivery-media";

const labels: Record<ProductionRenderJob["status"], string> = { queued: "等待合成", running: "正在合成", completed: "成片已保存", failed: "合成失败", cancelled: "已取消" };
type PendingRender = { signature: string; input: ProductionRenderInput };

export default function ProductionRenderPanel({ document, episodeId, dirty }: { document: ProductionDocument; episodeId: string; dirty: boolean }) {
    const { message, modal } = App.useApp();
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id);
    const version = useUserStore((state) => state.sessionVersion);
    const [snapshot, setSnapshot] = useState<{ scope: string; jobs: ProductionRenderJob[] } | null>(null);
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);
    const [preview, setPreview] = useState<{ scope: string; job: ProductionRenderJob; url: string } | null>(null);
    const request = useRef<PendingRender | null>(null);
    const [pending, setPending] = useState<PendingRender | null>(null);
    const [pendingReady, setPendingReady] = useState(false);
    const operation = useRef<AbortController | null>(null);
    const mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const scope = `${token}:${userId}:${version}:${document.workspaceId}:${episodeId}`;
    const pendingKey = `production-render-pending:${userId}:${document.workspaceId}:${episodeId}`;
    const currentScope = useRef(scope); currentScope.current = scope;
    const jobs = snapshot?.scope === scope ? snapshot.jobs.filter((job) => job.episodeId === episodeId) : [];
    const hasActive = jobs.some((job) => job.status === "running" || job.status === "queued");
    const delivery = document.episodes.find((episode) => episode.id === episodeId)?.delivery || emptyProductionDelivery();
    const issues = productionDeliveryIssues(delivery, productionShotTimings(document, episodeId).at(-1)?.end || 0);
    const isCurrent = () => {
        const state = useUserStore.getState(), canvas = useCanvasStore.getState();
        return Boolean(mounted.current && token && userId && currentScope.current === scope && state.token === token && state.sessionVersion === version && state.user?.id === userId && state.user?.role !== "guest" && state.isReady && !state.authError && canvas.hydrated && canvas.ownerId === userId);
    };
    useEffect(() => {
        let active = true, inFlight = false;
        const load = async () => {
            if (!active || inFlight || window.document.hidden || !isCurrent()) return;
            inFlight = true;
            try { const items = await fetchProductionRenders(token, document.workspaceId); if (active && isCurrent()) setSnapshot({ scope, jobs: items }); }
            catch { if (active && isCurrent()) setError("成片任务读取失败，请检查网络后刷新；已有任务仍在服务端执行。"); }
            finally { inFlight = false; }
        };
        void load();
        const timer = setInterval(() => void load(), 5000);
        return () => { active = false; clearInterval(timer); };
    }, [scope, refresh]);
    useEffect(() => {
        setBusy(""); setError(""); setPreview(null); request.current = null;
        return () => { operation.current?.abort(); operation.current = null; };
    }, [scope]);
    useEffect(() => {
        let active = true;
        setPendingReady(false); setPending(null);
        void (async () => {
            try {
                const saved = await localforage.getItem<PendingRender>(pendingKey);
                if (!active || !isCurrent()) return;
                if (saved) {
                    if (!saved.input?.requestId || saved.input.workspaceId !== document.workspaceId || saved.input.episodeId !== episodeId) throw new Error("本机待确认成片记录损坏，请保留记录并联系管理员处理");
                    request.current = saved; setPending(saved);
                    const accepted = await fetchProductionRenderByRequest(token, saved.input.requestId);
                    if (!active || !isCurrent()) return;
                    if (accepted) {
                        await localforage.removeItem(pendingKey);
                        if (!active || !isCurrent()) return;
                        request.current = null; setPending(null); setRefresh((value) => value + 1);
                    }
                }
                if (active && isCurrent()) setPendingReady(true);
            } catch (cause) {
                if (active && isCurrent()) { setError(cause instanceof Error ? cause.message : "待确认提交恢复失败，请刷新重试"); if (request.current) setPendingReady(true); }
            }
        })();
        return () => { active = false; };
    }, [scope]);
    const perform = async (name: string, work: (signal: AbortSignal, assertCurrent: () => void) => Promise<void>) => {
        if (operation.current || !isCurrent()) return;
        const controller = new AbortController(); operation.current = controller;
        const assertCurrent = () => { controller.signal.throwIfAborted(); if (!isCurrent() || operation.current !== controller) throw new Error("账号或分集已变化，请重新操作"); };
        setBusy(name); setError("");
        try { await work(controller.signal, assertCurrent); }
        catch (cause) { if (isCurrent() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
        finally { if (operation.current === controller) { operation.current = null; if (isCurrent()) { setBusy(""); setRefresh((value) => value + 1); } } }
    };
    const submit = () => {
        const signature = JSON.stringify([document.workspaceId, episodeId, document.revision]);
        const saved = request.current || { signature, input: { workspaceId: document.workspaceId, episodeId, revision: document.revision, requestId: nanoid() } };
        const input = saved.input;
        request.current = saved; setPending(saved);
        void perform("submit", async (_signal, assertCurrent) => {
            await localforage.setItem(pendingKey, saved); assertCurrent();
            const job = await createProductionRender(token, input); assertCurrent();
            await localforage.removeItem(pendingKey); assertCurrent();
            request.current = null; setPending(null);
            setSnapshot((previous) => ({ scope, jobs: [job, ...(previous?.scope === scope ? previous.jobs.filter((item) => item.id !== job.id) : [])] }));
            void message.success("成片任务已排队，关闭页面后仍会继续执行");
        });
    };
    const cancelPending = () => {
        const saved = request.current;
        if (!saved) return;
        void perform("cancel-request", async (_signal, assertCurrent) => {
            const job = await cancelProductionRenderRequest(token, saved.input.requestId); assertCurrent();
            await localforage.removeItem(pendingKey); assertCurrent();
            request.current = null; setPending(null);
            void message.info(job.status === "completed" ? "原任务已经完成，成片保留在任务记录中" : "待确认提交已取消，迟到的原请求也不会再创建成片");
        });
    };
    const action = (job: ProductionRenderJob, type: "retry" | "cancel") => void perform(job.id, async (_signal, assertCurrent) => {
        const updated = await actionProductionRender(token, job.id, type); assertCurrent();
        setSnapshot((previous) => previous?.scope === scope ? { ...previous, jobs: previous.jobs.map((item) => item.id === updated.id ? updated : item) } : previous);
    });
    const download = (job: ProductionRenderJob) => void perform(job.id, async (signal, assertCurrent) => {
        const blob = await readProductionDeliveryMedia({ id: job.id, title: job.episodeTitle, kind: "video", canvasId: "", nodeId: "", storageKey: job.outputStorageKey, content: "" }, 256 * 1024 * 1024, signal, assertCurrent);
        assertCurrent();
        if (!blob.type.startsWith("video/") || !blob.size) throw new Error("成片文件已不可用，请到账号文件检查是否被删除");
        saveAs(blob, `${job.episodeTitle}-720x1280.mp4`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"));
        notifyAccountWalletRefresh();
    });
    const showPreview = (job: ProductionRenderJob) => void perform(job.id, async (_signal, assertCurrent) => {
        const url = await resolveMediaUrl(job.outputStorageKey); assertCurrent();
        if (!url) throw new Error("成片文件已不可用，请检查账号文件");
        setPreview({ scope, job, url });
    });
    return <section className="space-y-4 border-t border-border pt-7">
        <header><h3 className="flex items-center gap-2 text-lg font-semibold"><Film className="size-5" />合成为 MP4</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">使用已保存计划，按镜头顺序合成 720×1280、24fps 竖屏视频。横图留边保留完整画面；视频按计划截取，时长不足会报错；图片按计划停留。使用上方已保存的音轨时间表、原声音量与字幕烧录设置。</p></header>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"><p className="text-sm">{delivery.audioTracks.length} 段音轨 · {delivery.subtitles.length} 条字幕 · {delivery.burnSubtitles ? "烧录字幕" : "独立字幕"} · 原声 {Math.round(delivery.originalGain * 100)}%</p><Button type="primary" disabled={!pendingReady || Boolean(busy) || (!pending && (dirty || hasActive || Boolean(issues.length)))} loading={busy === "submit"} onClick={submit}>{pending ? "恢复上次成片提交" : "提交成片任务"}</Button></div>
        {pending && <Alert showIcon type="info" title="上次提交尚未确认" description={`将使用原计划版本 ${pending.input.revision}、原音轨和同一请求编号恢复，避免刷新后重复入队。`} action={<Button size="small" disabled={Boolean(busy)} onClick={cancelPending}>取消待确认提交</Button>} />}
        <p className="text-xs leading-6 text-muted-foreground">{dirty ? "当前有未保存修改，请先点击页面顶部“保存计划”再提交成片。" : `使用账号计划版本 ${document.revision}。`}音轨按时间表定位和截取，原文件时长不足会报错。单次最多 60 镜头／300 秒，单镜头最多 60 秒，输入合计 512 MiB，输出最多 256 MiB；每个账号最多 2 个在途任务。音轨与成片占用账号存储空间，不收取模型生成算力。字幕可下载 SRT；开启烧录后会实际嵌入画面。</p>
        {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>刷新</Button>} />}
        {preview?.scope === scope && <div className="overflow-hidden rounded-xl border border-border"><div className="flex items-center justify-between gap-3 px-4 py-3"><p className="text-sm">真实成片预览 · 计划版本 {preview.job.revision} · {preview.job.seconds} 秒</p><Button type="text" aria-label="关闭成片预览" icon={<X className="size-4" />} onClick={() => setPreview(null)} /></div><video key={preview.job.id} controls playsInline preload="metadata" src={preview.url} className="max-h-[65vh] w-full bg-muted/40 object-contain" aria-label={`${preview.job.episodeTitle}成片预览`} onError={() => setError("成片无法播放，请下载检查编码或确认文件仍存在")} /></div>}
        <div className="divide-y divide-border rounded-xl border border-border">{jobs.length ? jobs.map((job) => <article key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{labels[job.status]}{job.status === "running" ? ` · ${job.progress}%` : ""}</p><p className="mt-1 text-xs text-muted-foreground">{job.shotCount} 镜头 · {job.seconds} 秒 · 计划版本 {job.revision} · 尝试 {job.attempts} 次</p>{job.error && <p className="mt-2 break-words text-xs leading-6 text-destructive">{job.error}</p>}{job.status === "completed" && <p className="mt-1 text-xs text-muted-foreground">{(job.outputBytes / 1024 / 1024).toFixed(1)} MiB · 已保存到账号文件</p>}</div><div className="flex gap-2">{job.status === "completed" && <Button icon={<Play className="size-4" />} disabled={Boolean(busy)} onClick={() => showPreview(job)}>预览</Button>}{job.status === "completed" && <Button icon={<Download className="size-4" />} loading={busy === job.id} disabled={Boolean(busy) && busy !== job.id} onClick={() => download(job)}>下载成片</Button>}{(job.status === "failed" || job.status === "cancelled") && <Button icon={<RotateCcw className="size-4" />} loading={busy === job.id} disabled={Boolean(busy) && busy !== job.id} onClick={() => modal.confirm({ title: "按原任务快照重试成片？", content: "重试使用这次任务保存的镜头、时长和音轨，当前计划的新修改不会加入。要采用新修改，请保存计划后提交新成片任务。", okText: "按原快照重试", cancelText: "返回", onOk: () => action(job, "retry") })}>重试</Button>}{(job.status === "queued" || job.status === "running") && <Button icon={<X className="size-4" />} loading={busy === job.id} disabled={Boolean(busy) && busy !== job.id} onClick={() => action(job, "cancel")}>取消任务</Button>}</div></article>) : <p className="px-4 py-6 text-sm text-muted-foreground">尚无本集成片任务。任务记录来自本项目最近 50 次合成。</p>}</div>
    </section>;
}
