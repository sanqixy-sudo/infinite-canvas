"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Progress } from "antd";
import { ArrowLeft, ArrowRight, Check, Download, Film, ImageIcon, LocateFixed, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { saveAs } from "file-saver";
import { createZip } from "@/lib/zip";
import { useUserStore } from "@/stores/use-user-store";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { useCanvasStore, workspaceCanvases } from "../../../../stores/use-canvas-store";
import type { ProductionDocument } from "../../../../lib/production-types";
import { isProductionCandidateValid } from "../../../../utils/production-candidates";
import { buildProductionDelivery, productionDeliveryRows, productionTimecode, type ProductionDeliveryRow } from "../../../../utils/production-delivery";
import { readProductionDeliveryMedia } from "../production-delivery-media";
import ProductionRenderPanel from "./production-render-panel";
import ProductionDeliveryEditor, { type ProductionEdit } from "./production-delivery-editor";

function DeliveryPreview({ row, running, onEnd, onStop }: { row: ProductionDeliveryRow; running: boolean; onEnd: () => void; onStop: () => void }) {
    const token = useUserStore((state) => state.token);
    const version = useUserStore((state) => state.sessionVersion);
    const userId = useUserStore((state) => state.user?.id);
    const [media, setMedia] = useState<{ key: string; url: string; error: string } | null>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [imageLoaded, setImageLoaded] = useState("");
    const endRef = useRef(onEnd), stopRef = useRef(onStop);
    endRef.current = onEnd; stopRef.current = onStop;
    const candidate = row.primary;
    const key = `${version}:${userId}:${row.shot.id}:${candidate?.id}:${candidate?.storageKey}`;
    const current = media?.key === key ? media : null;
    useEffect(() => {
        if (!candidate || row.issues.length) return;
        let active = true;
        const currentSession = () => {
            const state = useUserStore.getState();
            return active && state.token === token && state.sessionVersion === version && state.user?.id === userId && state.isReady && !state.authError;
        };
        void (candidate.kind === "image" ? resolveImageUrl(candidate.storageKey) : resolveMediaUrl(candidate.storageKey)).then((url) => {
            if (currentSession()) setMedia({ key, url, error: url ? "" : "素材文件不可用，请回到候选与采用检查" });
        }).catch(() => { if (currentSession()) setMedia({ key, url: "", error: "素材加载失败，请检查文件或网络后重新选择镜头" }); });
        return () => { active = false; };
    }, [candidate, key, token, userId, version, row.issues.length]);
    useEffect(() => {
        if (!running || !current?.url || row.issues.length) return;
        if (candidate?.kind === "image" && imageLoaded === key) {
            const timer = setTimeout(() => endRef.current(), row.shot.seconds * 1000);
            return () => clearTimeout(timer);
        }
        if (candidate?.kind === "video") {
            const element = video.current;
            if (element?.ended) element.currentTime = 0;
            void element?.play().catch(() => stopRef.current());
        }
    }, [running, current?.url, candidate?.kind, imageLoaded, key, row.shot.seconds, row.issues.length]);
    useEffect(() => { if (!running) video.current?.pause(); }, [running]);
    if (row.issues.length) return <p className="max-w-sm px-6 text-center text-sm leading-7 text-muted-foreground">{row.issues.join("；")}</p>;
    if (!current?.url) return <p className="px-6 text-center text-sm text-muted-foreground">{current?.error || "正在读取采用结果…"}</p>;
    const fail = () => { setMedia({ key, url: "", error: "媒体无法播放，请检查原文件格式或重新选择采用结果" }); stopRef.current(); };
    return candidate?.kind === "video" ? <video key={key} ref={video} controls playsInline preload="metadata" className="h-full max-h-[520px] w-full object-contain" src={current.url} aria-label={`${row.shot.title}已采用视频`} onPause={(event) => { if (running && !event.currentTarget.ended) stopRef.current(); }} onEnded={() => { if (running) endRef.current(); }} onError={fail} /> : <img key={key} src={current.url} alt={`${row.shot.title}已采用分镜图`} className="h-full max-h-[520px] w-full object-contain" onLoad={() => setImageLoaded(key)} onError={fail} />;
}

export default function ProductionDelivery({ document, episodeId, dirty = false, onEdit }: { document: ProductionDocument; episodeId: string; dirty?: boolean; onEdit: ProductionEdit }) {
    const { message } = App.useApp();
    const router = useRouter();
    const token = useUserStore((state) => state.token);
    const version = useUserStore((state) => state.sessionVersion);
    const userId = useUserStore((state) => state.user?.id);
    const isReady = useUserStore((state) => state.isReady);
    const authError = useUserStore((state) => state.authError);
    const projects = useCanvasStore((state) => state.projects);
    const ownerId = useCanvasStore((state) => state.ownerId);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const canvases = useMemo(() => workspaceCanvases(projects, document.workspaceId), [projects, document.workspaceId]);
    const rows = useMemo(() => productionDeliveryRows(document, episodeId, canvases), [document, episodeId, canvases]);
    const [selectedId, setSelectedId] = useState("");
    const [running, setRunning] = useState(false);
    const [subtitles, setSubtitles] = useState(true);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState<{ completed: number; total: number; packaging: boolean } | null>(null);
    const operation = useRef<AbortController | null>(null);
    const latestDocument = useRef(document);
    latestDocument.current = document;
    const validSession = Boolean(token && userId && isReady && !authError && ownerId === userId && hydrated);
    const selectedIndex = Math.max(0, rows.findIndex((row) => row.shot.id === selectedId));
    const selected = rows[selectedIndex];
    const blocked = rows.filter((row) => row.issues.length);
    const readyCount = rows.length - blocked.length;
    const episode = document.episodes.find((item) => item.id === episodeId);
    const stop = () => setRunning(false);
    const advance = () => {
        if (selectedIndex >= rows.length - 1) { setRunning(false); return; }
        setSelectedId(rows[selectedIndex + 1].shot.id);
    };
    useEffect(() => {
        setRunning(false); setError(""); setProgress(null);
        operation.current?.abort(); operation.current = null;
        return () => { operation.current?.abort(); operation.current = null; };
    }, [document, episodeId, token, version, userId, validSession]);
    useEffect(() => {
        const pause = () => { if (window.document.hidden) setRunning(false); };
        window.document.addEventListener("visibilitychange", pause);
        return () => window.document.removeEventListener("visibilitychange", pause);
    }, []);
    useEffect(() => { if (blocked.length) setRunning(false); }, [blocked.length]);

    const exportEpisode = async () => {
        if (operation.current || !validSession) return;
        const controller = new AbortController(); operation.current = controller;
        const assertCurrent = () => {
            controller.signal.throwIfAborted();
            const user = useUserStore.getState(), store = useCanvasStore.getState();
            if (operation.current !== controller || latestDocument.current !== document || user.token !== token || user.sessionVersion !== version || user.user?.id !== userId || !user.isReady || user.authError || user.user?.role === "guest" || store.ownerId !== userId || !store.hydrated) throw new Error("账号或制作计划已变化，本次导出已停止，请重新导出");
            const currentCanvases = workspaceCanvases(store.projects, document.workspaceId);
            if (rows.some((row) => row.candidates.some((candidate) => !isProductionCandidateValid(candidate, currentCanvases)))) throw new Error("采用结果在导出期间发生变化，请重新检查候选后导出");
        };
        setError(""); setRunning(false); setProgress({ completed: 0, total: 0, packaging: false });
        try {
            const files = await buildProductionDelivery(document, episodeId, rows, (candidate, remaining) => readProductionDeliveryMedia(candidate, remaining, controller.signal, assertCurrent), { subtitles, assertCurrent, onProgress: (completed, total) => setProgress({ completed, total, packaging: false }) });
            assertCurrent(); setProgress((value) => value && { ...value, packaging: true });
            const zip = await createZip(files);
            assertCurrent();
            saveAs(zip, `${document.title}-${episode?.title || "分集"}-交接包.zip`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"));
            void message.success("分集交接包已生成，包含真实原文件与镜头清单");
        } catch (cause) {
            if (operation.current === controller && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "导出失败，请重试");
        } finally {
            if (operation.current === controller) { operation.current = null; setProgress(null); }
        }
    };

    if (!validSession) return <p className="py-12 text-center text-sm text-muted-foreground">正在确认账号和项目素材，请稍候。</p>;
    if (!episode || !rows.length) return <div className="py-14 text-center"><Film className="mx-auto mb-4 size-7 text-muted-foreground" /><p className="text-sm font-medium">当前分集还没有可交付的镜头</p><p className="mt-2 text-xs text-muted-foreground">在镜头清单创建镜头，再通过“候选与采用”选择分镜图或视频。</p></div>;
    return <section className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{episode.title} · 审片与交接</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">{readyCount} / {rows.length} 镜头已就绪 · 计划总长 {productionTimecode(rows.reduce((sum, row) => sum + row.shot.seconds, 0))}</p></div><div className="flex flex-wrap items-center gap-3"><Checkbox checked={subtitles} onChange={(event) => setSubtitles(event.target.checked)} disabled={Boolean(progress)}>附 SRT 字幕</Checkbox><Button icon={<Download className="size-4" />} disabled={Boolean(blocked.length)} loading={Boolean(progress)} onClick={() => void exportEpisode()}>导出分集交接包</Button></div></div>
        <p className="text-xs leading-6 text-muted-foreground">预览优先播放采用视频，没有视频时显示采用图片。交接包包含采用原文件、交付音轨、镜头清单和可选 SRT，保留原画幅与声音。原视频不裁切；图片按计划时长停留。字幕优先使用下方编辑时间表，未编辑时按镜头对白生成草稿；交付剪辑前需校准。</p>
        {blocked.length > 0 && <Alert type="warning" showIcon title={`还有 ${blocked.length} 个镜头未就绪，完整导出前请补齐`} description={<div className="max-h-28 space-y-1 overflow-y-auto text-xs">{blocked.map((row) => <button key={row.shot.id} className="block text-left underline underline-offset-4" onClick={() => { stop(); setSelectedId(row.shot.id); }}>{row.shot.title}：{row.issues.join("；")}</button>)}</div>} />}
        {error && <Alert type="error" showIcon title={error} description="未下载不完整压缩包。排除问题后可重新导出。" />}
        {progress && <div role="status" className="flex items-center gap-4 rounded-xl border border-border px-4 py-3"><div className="min-w-0 flex-1"><p className="mb-1 text-xs">{progress.packaging ? "正在打包原文件…" : `正在读取原文件 ${progress.completed} / ${progress.total || "—"}`}</p><Progress percent={progress.total ? Math.round(progress.completed / progress.total * 100) : 0} size="small" showInfo={false} /></div><Button size="small" onClick={() => { operation.current?.abort(); operation.current = null; setProgress(null); }}>取消导出</Button></div>}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 overflow-hidden rounded-xl border border-border"><div className="flex min-h-72 h-[min(54vh,520px)] items-center justify-center bg-muted/40"><DeliveryPreview key={`${version}:${selected.shot.id}:${selected.primary?.id}`} row={selected} running={running} onEnd={advance} onStop={stop} /></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{String(selectedIndex + 1).padStart(2, "0")} · {selected.shot.title}</p><p className="mt-1 text-xs text-muted-foreground">{selected.primary?.kind === "video" ? "采用视频 · 按原长播放" : "采用图片 · 按计划停留"} · 计划 {selected.shot.seconds} 秒</p></div><div className="flex shrink-0 gap-1"><Button type="text" aria-label="上一镜头" disabled={selectedIndex === 0} icon={<ArrowLeft className="size-4" />} onClick={() => { stop(); setSelectedId(rows[selectedIndex - 1].shot.id); }} /><Button type={running ? "default" : "primary"} aria-label={running ? "暂停连续预览" : "连续预览本集"} disabled={Boolean(blocked.length)} icon={running ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={() => setRunning(!running)}>{running ? "暂停" : "连播"}</Button><Button type="text" aria-label="下一镜头" disabled={selectedIndex === rows.length - 1} icon={<ArrowRight className="size-4" />} onClick={() => { stop(); setSelectedId(rows[selectedIndex + 1].shot.id); }} /></div></div></div>
            <aside className="space-y-4 rounded-xl border border-border p-5"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-medium">镜头说明</h3>{selected.primary && <Button type="text" size="small" aria-label="定位采用结果" icon={<LocateFixed className="size-4" />} onClick={() => router.push(`/canvas/${selected.primary!.canvasId}?focusNodeId=${encodeURIComponent(selected.primary!.nodeId)}`)} />}</div><p className="whitespace-pre-wrap break-words text-sm leading-7">{selected.shot.description || "未填写画面说明"}</p><div className="border-t border-border pt-4"><p className="mb-2 text-xs text-muted-foreground">对白</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{selected.shot.dialogue || "无对白"}</p></div><div className="border-t border-border pt-4"><p className="mb-2 text-xs text-muted-foreground">景别与运镜</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{selected.shot.camera || "未填写"}</p></div><p className="text-xs leading-6 text-muted-foreground">采用版本：{selected.primary?.title || "待选择"}</p></aside>
        </div>
        <ol aria-label="分集镜头顺序" className="flex gap-2 overflow-x-auto pb-2">{rows.map((row, index) => <li key={row.shot.id} className="w-44 shrink-0"><button aria-current={index === selectedIndex ? "step" : undefined} className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${index === selectedIndex ? "border-primary bg-primary/5" : "border-border"}`} onClick={() => { stop(); setSelectedId(row.shot.id); }}><div className="mb-3 flex items-center justify-between text-muted-foreground"><span className="text-xs tabular-nums">{String(index + 1).padStart(2, "0")}</span>{row.issues.length ? <span className="text-xs">待补齐</span> : <Check className="size-3.5" />}</div><p className="truncate text-sm font-medium">{row.shot.title}</p><p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">{row.primary?.kind === "video" ? <Film className="size-3" /> : <ImageIcon className="size-3" />}{row.shot.seconds} 秒 · {productionTimecode(row.startSeconds)}</p></button></li>)}</ol>
        <p className="text-xs leading-6 text-muted-foreground">本次导出使用当前编辑器快照，包含未保存修改；请按需先保存计划。单包最多 256 MiB，任何缺失、失效或未入库的采用文件都会阻止导出。此入口不会发起模型生成。</p>
        <ProductionDeliveryEditor key={`edit:${version}:${userId}:${document.workspaceId}:${episodeId}`} document={document} episodeId={episodeId} dirty={dirty} onEdit={onEdit} />
        <ProductionRenderPanel key={`${version}:${userId}:${document.workspaceId}:${episodeId}`} document={document} episodeId={episodeId} dirty={dirty} />
    </section>;
}
