"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Input, Select } from "antd";
import { Mic } from "lucide-react";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { ModelPicker } from "@/components/model-picker";
import { AudioSettingsPanel, type AudioSettingKey } from "@/components/audio-settings-panel";
import { requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { createCanvasAudioTask, pollCanvasAudioTaskStatus, type CanvasAudioTask } from "@/services/api/audio";
import { stopCanvasTask } from "@/services/api/canvas-tasks";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ProductionDocument } from "../../../../lib/production-types";

const audioKeys = ["audioVoice", "audioFormat", "audioSpeed", "audioInstructions", "grokTtsVoice", "grokTtsLanguage", "grokTtsFormat", "grokTtsSpeed", "glmTtsVoice", "glmTtsFormat", "glmTtsSpeed", "mimoTtsVoice", "mimoTtsFormat", "mimoVoiceDesignPrompt", "geminiTtsVoice"] as const;
type VoiceRequest = { id: string; shotId: string; label: string; prompt: string; model: string; channelId: string; maxCredits: number; settings: Partial<Pick<AiConfig, AudioSettingKey>>; status?: string; storageKey?: string };

export default function ProductionVoiceover({ document: plan, episodeId, dirty, onAudio }: { document: ProductionDocument; episodeId: string; dirty: boolean; onAudio: (key: string, label: string, shotId: string, trackId: string, signal: AbortSignal) => Promise<void> }) {
    const { modal } = App.useApp();
    const effective = useEffectiveConfig(), theme = useThemeStore((state) => state.theme);
    const costs = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const token = useUserStore((state) => state.token), userId = useUserStore((state) => state.user?.id), version = useUserStore((state) => state.sessionVersion);
    const [selection, setSelection] = useState({ model: "", channelId: "" }), [settings, setSettings] = useState<VoiceRequest["settings"]>({});
    const shots = plan.shots.filter((shot) => shot.episodeId === episodeId).sort((a, b) => a.order - b.order);
    const [shotId, setShotId] = useState(shots[0]?.id || ""), [prompt, setPrompt] = useState(shots[0]?.dialogue || "");
    const [pending, setPending] = useState<VoiceRequest | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const scope = `${userId}:${version}:${token}:${plan.workspaceId}:${episodeId}`, pendingKey = `production-voice:${userId}:${plan.workspaceId}:${episodeId}`;
    const scopeRef = useRef(scope), mounted = useRef(false), working = useRef(false), pendingRef = useRef<VoiceRequest | null>(null), audioRef = useRef(onAudio);
    scopeRef.current = scope; audioRef.current = onAudio;
    const current = () => { const state = useUserStore.getState(); return Boolean(mounted.current && token && userId && scopeRef.current === scope && state.token === token && state.user?.id === userId && state.sessionVersion === version && state.isReady && !state.authError); };
    const config = { ...effective, ...settings, model: selection.model || effective.audioModel, activeChannelId: selection.channelId || effective.audioChannelId, audioChannelId: selection.channelId || effective.audioChannelId };
    const price = requestCreditCost({ channelMode: config.channelMode, modelCosts: costs, model: config.model });
    const trackAttached = Boolean(pending && plan.episodes.find((episode) => episode.id === episodeId)?.delivery?.audioTracks.some((track) => track.id === pending.id && track.storageKey === pending.storageKey));
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        let active = true; setReady(false); setPending(null); pendingRef.current = null; setError("");
        void localforage.getItem<VoiceRequest>(pendingKey).then((saved) => { if (active && current()) { pendingRef.current = saved; setPending(saved); setReady(true); } }).catch(() => { if (active && current()) setError("配音提交记录读取失败，请刷新；未发起新任务"); });
        return () => { active = false; };
    }, [scope]);
    const updatePending = async (value: VoiceRequest) => { await localforage.setItem(pendingKey, value); if (current()) { pendingRef.current = value; setPending(value); } };
    const accept = async (task: CanvasAudioTask, request: VoiceRequest, signal: AbortSignal) => {
        if (!current()) return;
        if (task.status === "completed") {
            if (!task.storageKey?.startsWith("server:") || task.accountSaveError) throw new Error(task.accountSaveError || "配音已生成，但尚未保存到账号；重新读取将继续保存，不会重新生成");
            await updatePending({ ...request, status: "completed", storageKey: task.storageKey });
            if (!current()) return;
            await audioRef.current(task.storageKey, request.label, request.shotId, request.id, signal);
            if (!current()) return;
            // Keep the completed receipt until the corresponding track is in a saved plan.
            setError("");
        } else { await updatePending({ ...request, status: task.status }); if (task.status === "failed") setError(task.error?.message || task.error_detail || "配音失败，可检查任务记录后重新生成"); }
    };
    useEffect(() => {
        if (!pending || pending.status === "failed" || pending.status === "cancelled" || !ready) return;
        let active = true; const controller = new AbortController();
        const load = async () => {
            if (!active || !current() || working.current) return;
            if (pending.status === "completed" && pending.storageKey) {
                const savedTrack = plan.episodes.find((episode) => episode.id === episodeId)?.delivery?.audioTracks.some((track) => track.id === pending.id);
                if (!savedTrack) { working.current = true; try { await audioRef.current(pending.storageKey, pending.label, pending.shotId, pending.id, controller.signal); } catch (cause) { if (active && current()) setError(cause instanceof Error ? cause.message : "配音音轨恢复失败"); } finally { working.current = false; } }
                return;
            }
            working.current = true;
            try { const task = await pollCanvasAudioTaskStatus(pending.id, controller.signal); if (active && current()) await accept(task, pending, controller.signal); }
            catch (cause) { if (active && current()) setError(cause instanceof Error ? cause.message : "配音状态尚未确认，请恢复原提交"); }
            finally { working.current = false; }
        };
        void load(); const timer = setInterval(() => void load(), 5000);
        return () => { active = false; controller.abort(); clearInterval(timer); };
    }, [scope, pending?.id, pending?.status, ready]);
    const submit = async (request: VoiceRequest) => {
        if (!current() || working.current) return;
        working.current = true; setBusy(true); setError(""); const controller = new AbortController();
        try {
            await updatePending(request); if (!current()) return;
            const task = await createCanvasAudioTask({ ...effective, ...request.settings, model: request.model, audioModel: request.model, activeChannelId: request.channelId, audioChannelId: request.channelId }, request.prompt, { sourceId: plan.workspaceId, nodeId: request.shotId, clientTaskId: request.id, forceServerTask: true, maxCredits: request.maxCredits, signal: controller.signal });
            if (current()) await accept(task, request, controller.signal);
        } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "提交结果待确认，请恢复同一请求"); }
        finally { working.current = false; if (current()) setBusy(false); }
    };
    const generate = () => {
        const shot = shots.find((item) => item.id === shotId);
        if (!shot || price === null || !prompt.trim() || pendingRef.current || dirty) return;
        if (Array.from(prompt).length > 5000) { setError("单次配音文本最多 5000 字，请分镜处理"); return; }
        const snapshot: VoiceRequest = { id: `production_voice_${nanoid()}`, shotId, label: `${shot.title} · 配音`, prompt: prompt.trim(), model: config.model, channelId: config.activeChannelId || "", maxCredits: price, settings: Object.fromEntries(audioKeys.map((key) => [key, config[key]])) };
        modal.confirm({ title: "确认生成本镜配音？", content: `模型 ${snapshot.model}，本次最多 ${price.toFixed(2)} 算力。生成后保存到账号音频文件，占用存储空间；不会自动重试付费请求。`, okText: `确认并生成 · ${price.toFixed(2)} 算力`, cancelText: "返回编辑", onOk: () => submit(snapshot) });
    };
    const release = async () => {
        if (!current() || !pending || !["completed", "failed", "cancelled"].includes(pending.status || "")) return;
        if (pending.status === "completed" && (!trackAttached || dirty)) { setError("请先把音轨加入本集，并保存制作计划，再结束本次记录"); return; }
        await localforage.removeItem(pendingKey); if (current()) { pendingRef.current = null; setPending(null); setError(""); }
    };
    const restoreTrack = async () => {
        if (!current() || !pending?.storageKey || busy) return;
        setBusy(true); setError("");
        try { await audioRef.current(pending.storageKey, pending.label, pending.shotId, pending.id, new AbortController().signal); }
        catch(cause) { if(current()) setError(cause instanceof Error ? cause.message : "音轨恢复失败"); }
        finally { if(current()) setBusy(false); }
    };
    const stop = async () => {
        if (!current() || !pending || busy) return;
        setBusy(true);
        try { const result = await stopCanvasTask("audio",pending.id,false); if (!current()) return; if (result.stopped) await updatePending({ ...pending, status: "cancelled" }); else { const task = await pollCanvasAudioTaskStatus(pending.id); if (current()) await accept(task,pending,new AbortController().signal); } }
        catch(cause) { if(current()) setError(cause instanceof Error ? cause.message : "取消结果未确认，请重试"); }
        finally { if(current()) setBusy(false); }
    };
    return <section className="space-y-3 rounded-xl border border-border p-4">
        <h4 className="flex items-center gap-2 text-sm font-medium"><Mic className="size-4" />逐镜配音</h4>
        <div className="flex flex-wrap gap-3"><Select className="min-w-48 flex-1" aria-label="配音镜头" value={shotId || undefined} options={shots.map((shot) => ({ value: shot.id, label: shot.title }))} onChange={(id) => { setShotId(id); setPrompt(shots.find((shot) => shot.id === id)?.dialogue || ""); }} disabled={Boolean(pending)} /><ModelPicker config={config} capability="audio" value={config.model} channelId={config.activeChannelId} onChange={(model, channelId) => setSelection({ model, channelId: channelId || "" })} /></div>
        <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={5000} placeholder="本镜要朗读的对白，可调整后生成" aria-label="配音文本" disabled={Boolean(pending)} />
        <details><summary className="cursor-pointer text-xs text-muted-foreground">声音与语速设置</summary><AudioSettingsPanel config={config} theme={canvasThemes[theme]} onConfigChange={(key, value) => setSettings((old) => ({ ...old, [key]: value }))} showTitle={false} className="mt-4 max-w-lg space-y-4" /></details>
        {pending ? <Alert type={pending.status === "failed" ? "warning" : "info"} showIcon title={`${pending.label} · ${pending.status === "completed" ? (trackAttached ? "已生成，音轨已加入当前编辑" : "已生成，等待加入音轨") : pending.status === "failed" ? "生成失败" : pending.status === "cancelled" ? "已停止" : pending.status === "unknown" ? "生成结果待核对" : "任务处理中或待确认"}`} description={pending.status === "completed" ? "请保存制作计划，再结束本次配音记录。未保存就离开时，本机记录可恢复音轨。" : pending.status === "unknown" ? "服务在生成期间中断，可能已经产生费用。请先核对任务与费用；恢复原提交不会再次生成。确认结束后可停止本次记录，再主动发起新配音。" : "刷新或网络异常后继续读取同一任务；恢复提交使用原请求编号，避免重复扣费。"} action={["completed", "failed", "cancelled"].includes(pending.status || "") ? <div className="flex flex-wrap gap-2">{pending.status === "completed" && !trackAttached && <Button size="small" loading={busy} onClick={() => void restoreTrack()}>加入音轨</Button>}<Button size="small" disabled={pending.status === "completed" && (dirty || !trackAttached)} onClick={() => void release()}>结束本次记录</Button></div> : <div className="flex flex-wrap gap-2"><Button size="small" loading={busy} onClick={() => void submit(pending)}>恢复原提交</Button><Button size="small" disabled={busy} onClick={() => modal.confirm({ title: "停止本次配音？", content: "未送出的请求会被拦截；已送达模型的请求可能已产生费用，停止不会自动退款。", okText: "停止", cancelText: "继续等待", onOk: stop })}>停止</Button></div>} /> : <Button icon={<Mic className="size-4" />} onClick={generate} loading={busy} disabled={!ready || dirty || !shotId || !config.model || price === null || !prompt.trim()}>生成本镜配音{price !== null ? ` · ${price.toFixed(2)} 算力` : " · 暂无报价"}</Button>}
        {!pending && dirty && <p className="text-xs text-muted-foreground">请先保存制作计划，再生成该镜头的配音；模型与声音选择保留在当前面板。</p>}
        {error && <Alert type="error" title={error} showIcon />}
    </section>;
}
