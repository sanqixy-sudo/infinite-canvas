"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Input, InputNumber, Select, Slider } from "antd";
import { Download, Music2, Plus, RotateCcw, Subtitles, Trash2, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { resolveMediaUrl, uploadMediaBlob } from "@/services/file-storage";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, workspaceCanvases } from "../../../../stores/use-canvas-store";
import type { ProductionAudioTrack, ProductionDeliveryEdit, ProductionDocument, ProductionSubtitle } from "../../../../lib/production-types";
import { emptyProductionDelivery, productionAudioDuration, productionDeliveryIssues, productionEditedSrt, productionShotTimings } from "../../../../utils/production-delivery-edit";
import { readProductionDeliveryMedia } from "../production-delivery-media";
import ProductionVoiceover from "./production-voiceover";

export type ProductionEdit = (update: (document: ProductionDocument) => ProductionDocument) => boolean;

function AudioAudition({ track }: { track: ProductionAudioTrack }) {
    const token = useUserStore((state) => state.token), version = useUserStore((state) => state.sessionVersion);
    const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
    const [failed, setFailed] = useState(false);
    const element = useRef<HTMLAudioElement>(null);
    useEffect(() => { let active = true; setResolved(null); setFailed(false); const current = () => active && useUserStore.getState().token === token && useUserStore.getState().sessionVersion === version; void resolveMediaUrl(track.storageKey).then((url) => { if (current()) { setResolved({ key: track.storageKey, url }); setFailed(!url); } }).catch(() => { if (current()) setFailed(true); }); return () => { active = false; element.current?.pause(); }; }, [track.storageKey, token, version]);
    useEffect(() => { if (element.current) element.current.volume = Math.max(0, Math.min(1, track.gain)); }, [track.gain]);
    return !failed && resolved?.key === track.storageKey && resolved.url ? <audio ref={element} controls preload="metadata" className="h-8 w-full max-w-72" src={resolved.url} aria-label={`${track.label}截取试听`} onError={() => setFailed(true)} onPlay={(event) => { const audio = event.currentTarget; audio.volume = track.gain; if (audio.currentTime < track.trimStartSeconds || audio.currentTime >= track.trimStartSeconds + track.durationSeconds) audio.currentTime = track.trimStartSeconds; }} onTimeUpdate={(event) => { const audio = event.currentTarget; if (audio.currentTime >= track.trimStartSeconds + track.durationSeconds) audio.pause(); }} /> : <span role="status" className="text-xs text-muted-foreground">{failed ? "音轨试听不可用，请检查账号文件或重新进入本集" : "音轨预览加载中"}</span>;
}

export default function ProductionDeliveryEditor({ document: plan, episodeId, dirty, onEdit }: { document: ProductionDocument; episodeId: string; dirty: boolean; onEdit: ProductionEdit }) {
    const { modal, message } = App.useApp();
    const token = useUserStore((state) => state.token), userId = useUserStore((state) => state.user?.id), version = useUserStore((state) => state.sessionVersion);
    const projects = useCanvasStore((state) => state.projects);
    const [error, setError] = useState(""), [busy, setBusy] = useState(false), [audioChoice, setAudioChoice] = useState(""), [undo, setUndo] = useState<ProductionDeliveryEdit[]>([]);
    const latest = useRef(plan), editRef = useRef(onEdit), mounted = useRef(false), operation = useRef<AbortController | null>(null);
    latest.current = plan; editRef.current = onEdit;
    const scope = `${token}:${userId}:${version}:${plan.workspaceId}:${episodeId}`, scopeRef = useRef(scope); scopeRef.current = scope;
    const current = () => { const state = useUserStore.getState(), canvas = useCanvasStore.getState(); return Boolean(mounted.current && token && userId && scopeRef.current === scope && state.token === token && state.user?.id === userId && state.sessionVersion === version && state.isReady && !state.authError && canvas.ownerId === userId && canvas.hydrated); };
    const episode = plan.episodes.find((item) => item.id === episodeId), edit = episode?.delivery || emptyProductionDelivery();
    const timings = productionShotTimings(plan, episodeId), total = timings.at(-1)?.end || 0;
    const issues = productionDeliveryIssues(edit, total);
    const audioOptions = new Map<string, string>();
    workspaceCanvases(projects, plan.workspaceId).forEach((canvas) => canvas.nodes.forEach((node) => { if (node.type === "audio" && node.metadata?.storageKey?.startsWith("server:") && !node.metadata.storageKey.startsWith("server:webdav:") && !["loading", "stopping", "error"].includes(node.metadata.status || "")) audioOptions.set(node.metadata.storageKey, `${canvas.title} · ${node.title}`); }));
    edit.audioTracks.forEach((track) => audioOptions.set(track.storageKey, track.label));
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
    useEffect(() => { setUndo([]); setError(""); setAudioChoice(""); operation.current?.abort(); operation.current = null; setBusy(false); }, [scope]);
    const update = (transform: (value: ProductionDeliveryEdit) => ProductionDeliveryEdit, history = true) => {
        if (!current()) return false;
        const before = latest.current.episodes.find((item) => item.id === episodeId)?.delivery || emptyProductionDelivery();
        const accepted = editRef.current((doc) => ({ ...doc, episodes: doc.episodes.map((item) => item.id === episodeId ? { ...item, delivery: transform(item.delivery || emptyProductionDelivery()) } : item) }));
        if (accepted && history) setUndo((items) => [...items.slice(-19), structuredClone(before)]);
        return accepted;
    };
    const addAudio = async (key: string, label: string, shotId = "", trackId = nanoid(), signal?: AbortSignal) => {
        const controller = new AbortController(), workSignal = signal || controller.signal;
        const assertCurrent = () => { workSignal.throwIfAborted(); if (!current()) throw new Error("账号或分集已变化，音轨未写入"); };
        assertCurrent();
        if (latest.current.episodes.find((item) => item.id === episodeId)?.delivery?.audioTracks.some((track) => track.id === trackId)) return;
        if (!key.startsWith("server:") || key.startsWith("server:webdav:")) throw new Error("请选择已保存到账号的音频文件");
        const blob = await readProductionDeliveryMedia({ id: trackId, title: label, kind: "audio", storageKey: key, canvasId: "", nodeId: "", content: "" }, 64 * 1024 * 1024, workSignal, assertCurrent);
        if (!blob.type.startsWith("audio/")) throw new Error("所选文件不是音频");
        const duration = await productionAudioDuration(blob, workSignal); assertCurrent();
        const rows = productionShotTimings(latest.current, episodeId), shot = rows.find((row) => row.shot.id === shotId), end = rows.at(-1)?.end || 0;
        if (shotId && !shot) throw new Error("关联镜头已删除，请保留配音记录并恢复该镜头后导入");
        const start = shot?.start || 0, length = Math.min(duration, end - start, 300 - start);
        if (length <= 0) throw new Error("分集或镜头时长无效，暂不能加入音轨");
        if (!update((value) => { if (value.audioTracks.length >= 64) throw new Error("单集最多 64 段音轨"); return value.audioTracks.some((track) => track.id === trackId) ? value : { ...value, audioTracks: [...value.audioTracks, { id: trackId, shotId, storageKey: key, label, startSeconds: start, trimStartSeconds: 0, durationSeconds: Math.floor(length * 1000) / 1000, gain: shotId ? 1 : 0.3 }] }; })) throw new Error("制作计划当前不可编辑，音频保留在账号文件中");
        if (duration > length) void message.info("音频超出分集末尾，已按分集剩余时长截取，可在时间编辑中调整");
    };
    const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
        if (operation.current || !current()) return;
        const controller = new AbortController(); operation.current = controller; setBusy(true); setError("");
        try { await work(controller.signal); } catch (cause) { if (current() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "音轨操作失败"); }
        finally { if (operation.current === controller) { operation.current = null; if (current()) setBusy(false); } }
    };
    const upload = (file: File) => void perform(async (signal) => {
        if (!file.type.startsWith("audio/") || file.size > 64 * 1024 * 1024) throw new Error("请上传 64 MiB 以内的音频文件，建议 MP3 / WAV");
        await productionAudioDuration(file, signal); if (!current()) return;
        const result = await uploadMediaBlob(file, file.name, token); signal.throwIfAborted(); if (!current()) return;
        await addAudio(result.storageKey, file.name, "", nanoid(), signal);
    });
    const trackPatch = (id: string, values: Partial<ProductionAudioTrack>) => update((value) => ({ ...value, audioTracks: value.audioTracks.map((track) => track.id === id ? { ...track, ...values } : track) }));
    const cuePatch = (id: string, values: Partial<ProductionSubtitle>) => update((value) => ({ ...value, subtitles: value.subtitles.map((cue) => cue.id === id ? { ...cue, ...values } : cue) }));
    const buildSubtitles = (audio: boolean) => {
        const long = timings.find((row) => Array.from(row.shot.dialogue).length > 500);
        if (long) { setError(`${long.shot.title}的对白超过单条字幕 500 字，请先拆分镜头或手动添加多条字幕`); return; }
        const cues = timings.filter((row) => row.shot.dialogue.trim()).map((row) => {
            const track = audio ? edit.audioTracks.find((item) => item.shotId === row.shot.id) : undefined;
            return { id: nanoid(), shotId: row.shot.id, startSeconds: track?.startSeconds ?? row.start, endSeconds: track ? track.startSeconds + track.durationSeconds : row.end, text: row.shot.dialogue };
        });
        const apply = () => update((value) => ({ ...value, subtitles: cues }));
        if (edit.subtitles.length) modal.confirm({ title: "替换当前字幕时间表？", content: "将使用当前镜头对白重新生成字幕，原字幕可通过“撤销编辑”恢复。", okText: "重新对齐", cancelText: "保留", onOk: () => { apply(); } }); else apply();
    };
    return <section className="space-y-5 border-t border-border pt-6">
        <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">声音与字幕时间编辑</h3><p className="mt-2 text-xs text-muted-foreground">本集 {total} 秒。按秒定位、截取和混音；修改随“保存计划”入库，成片任务固定使用提交时版本。</p></div><Button icon={<RotateCcw className="size-4" />} disabled={!undo.length} onClick={() => { const before = undo.at(-1); if (before && update(() => before, false)) setUndo((items) => items.slice(0, -1)); }}>撤销编辑</Button></header>
        <div className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="flex items-center gap-2 text-sm font-medium"><Music2 className="size-4" />音轨 · {edit.audioTracks.length}/64</h4><div className="flex w-60 items-center gap-3"><span className="text-xs">镜头原声 {Math.round(edit.originalGain * 100)}%</span><Slider className="!m-0 flex-1" min={0} max={100} value={Math.round(edit.originalGain * 100)} onChange={(value) => update((old) => ({ ...old, originalGain: value / 100 }))} ariaLabelForHandle="镜头原声音量" /></div></div>
            <div className="flex flex-wrap gap-2"><Select className="min-w-48 flex-1" placeholder="选择本项目账号音频" aria-label="已有音频" value={audioChoice || undefined} options={[...audioOptions].map(([value, label]) => ({ value, label }))} onChange={setAudioChoice} /><Button disabled={!audioChoice || busy || edit.audioTracks.length >= 64} onClick={() => void perform((signal) => addAudio(audioChoice, audioOptions.get(audioChoice) || "音轨", "", nanoid(), signal))}>加入音轨</Button><label className={`inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1 text-sm focus-within:ring-2 focus-within:ring-primary ${busy ? "opacity-50" : "cursor-pointer hover:bg-muted"}`}><Upload className="size-4" />上传音频<input type="file" accept="audio/*" className="sr-only" aria-label="上传音频到交付时间线" disabled={busy || edit.audioTracks.length >= 64} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file); }} /></label></div>
            {!edit.audioTracks.length && <p className="py-3 text-xs text-muted-foreground">加入配音、环境音或背景音乐，多条音轨可同时播放。</p>}
            {edit.audioTracks.map((track, index) => <article key={track.id} className="space-y-3 border-t border-border pt-3"><div className="flex flex-wrap items-center gap-2"><Input value={track.label} maxLength={180} aria-label={`音轨 ${index + 1} 名称`} onChange={(event) => trackPatch(track.id, { label: event.target.value })} className="!w-40 min-w-0 flex-1" /><Select className="!w-40 min-w-0" aria-label={`${track.label}关联镜头`} value={track.shotId} options={[{ value: "", label: "全片音轨" }, ...timings.map((row) => ({ value: row.shot.id, label: row.shot.title }))]} onChange={(id) => trackPatch(track.id, { shotId: id, startSeconds: timings.find((row) => row.shot.id === id)?.start ?? track.startSeconds })} /><Button type="text" icon={<Trash2 className="size-4" />} aria-label={`移除音轨 ${track.label}`} onClick={() => update((value) => ({ ...value, audioTracks: value.audioTracks.filter((item) => item.id !== track.id) }))} /></div>
                <div className="relative h-7 overflow-hidden rounded-md bg-muted/50" aria-label={`${track.label}时间位置 ${track.startSeconds} 至 ${track.startSeconds + track.durationSeconds} 秒`}><div className="absolute inset-y-1 min-w-1 rounded bg-primary/25" style={{ left: `${Math.min(100, track.startSeconds / Math.max(total, 1) * 100)}%`, width: `${Math.min(100, track.durationSeconds / Math.max(total, 1) * 100)}%` }} /></div>
                <div className="flex flex-wrap items-center gap-3">{([['startSeconds', '片中起点', 300], ['trimStartSeconds', '源音频起点', 3600], ['durationSeconds', '使用时长', 300]] as const).map(([key, label, max]) => <label key={key} className="flex items-center gap-2 text-xs text-muted-foreground">{label}<InputNumber min={key === "durationSeconds" ? 0.05 : 0} max={max} step={0.1} precision={3} value={track[key]} onChange={(value) => { if (value !== null) trackPatch(track.id, { [key]: value }); }} aria-label={`${track.label}${label}秒`} />秒</label>)}<label className="flex items-center gap-2 text-xs text-muted-foreground">音量<InputNumber min={0} max={100} value={Math.round(track.gain * 100)} onChange={(value) => { if (value !== null) trackPatch(track.id, { gain: value / 100 }); }} aria-label={`${track.label}音量百分比`} />%</label><AudioAudition track={track} /></div></article>)}
        </div>
        <ProductionVoiceover key={scope} document={plan} episodeId={episodeId} dirty={dirty} onAudio={addAudio} />
        <section className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="flex items-center gap-2 text-sm font-medium"><Subtitles className="size-4" />字幕 · {edit.subtitles.length}/500</h4><Checkbox checked={edit.burnSubtitles} onChange={(event) => update((value) => ({ ...value, burnSubtitles: event.target.checked }))}>烧录到 MP4 画面</Checkbox></div>
            <div className="flex flex-wrap gap-2"><Button size="small" onClick={() => buildSubtitles(false)}>对白按镜头时长对齐</Button><Button size="small" disabled={!edit.audioTracks.some((track) => track.shotId)} onClick={() => buildSubtitles(true)}>对白按配音片段对齐</Button><Button size="small" icon={<Plus className="size-3" />} disabled={edit.subtitles.length >= 500} onClick={() => update((value) => ({ ...value, subtitles: [...value.subtitles, { id: nanoid(), shotId: "", startSeconds: 0, endSeconds: Math.min(total, 3), text: "新字幕" }] }))}>添加字幕</Button><Button size="small" icon={<Download className="size-3" />} disabled={!edit.subtitles.length || Boolean(issues.length)} onClick={() => saveAs(new Blob([productionEditedSrt(edit.subtitles)], { type: "text/plain;charset=utf-8" }), "分集字幕.srt")}>导出 SRT</Button></div>
            <p className="text-xs leading-6 text-muted-foreground">配音对齐使用该镜头第一条配音片段的真实截取时长，无配音时沿用镜头时长；整段对白对应一条字幕，支持手动拆条。这里不做语音识别或逐字时间推断。烧录使用白字、深色描边和中文字体。</p>
            <div className="max-h-96 space-y-2 overflow-y-auto">{edit.subtitles.map((cue, index) => <div key={cue.id} className="flex flex-wrap items-start gap-2 rounded-lg bg-muted/30 p-2"><span className="pt-2 text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><InputNumber min={0} max={300} step={0.1} precision={3} value={cue.startSeconds} aria-label={`字幕 ${index + 1} 开始秒`} onChange={(value) => { if (value !== null) cuePatch(cue.id, { startSeconds: value }); }} /><span className="pt-2 text-xs">至</span><InputNumber min={0.05} max={300} step={0.1} precision={3} value={cue.endSeconds} aria-label={`字幕 ${index + 1} 结束秒`} onChange={(value) => { if (value !== null) cuePatch(cue.id, { endSeconds: value }); }} /><Input.TextArea className="min-w-48 flex-1" autoSize={{ minRows: 1, maxRows: 4 }} maxLength={500} value={cue.text} aria-label={`字幕 ${index + 1} 内容`} onChange={(event) => cuePatch(cue.id, { text: event.target.value })} /><Button type="text" aria-label={`删除字幕 ${index + 1}`} icon={<Trash2 className="size-4" />} onClick={() => update((value) => ({ ...value, subtitles: value.subtitles.filter((item) => item.id !== cue.id) }))} /></div>)}</div>
        </section>
        {busy && <p role="status" className="text-xs text-muted-foreground">正在读取真实音频文件与时长…</p>}{error && <Alert type="error" title={error} showIcon />}{issues.length > 0 && <Alert type="warning" title="请调整后再提交成片" description={issues.join("；")} showIcon />}
        <p className="text-xs leading-6 text-muted-foreground">移除音轨只解除本集引用，原账号文件保留。镜头顺序或时长变化后，请重新检查音轨起点和字幕时间。浏览器试听单条音轨；全部声音与字幕的最终组合以服务端真实 MP4 为准。</p>
    </section>;
}
