"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { App, Button } from "antd";
import { Download, Headphones, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { saveAs } from "file-saver";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { requestCreditCost } from "@/constant/credits";
import { isAutoDLConfig } from "@/lib/autodl";
import { canvasThemes } from "@/lib/canvas-theme";
import { isMimoVoiceCloneModel } from "@/lib/mimo-tts";
import { createCanvasAudioTask, pollCanvasAudioTaskStatus, type CanvasAudioTask } from "@/services/api/audio";
import { resolveMediaUrl } from "@/services/file-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { localChannelForActiveModel, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type PendingAudio = { id: string; prompt: string; model: string };
const owner = () => useUserStore.getState().user?.id || "guest";

export default function AudioPage() {
    const { message, modal } = App.useApp();
    const user = useUserStore((state) => state.user);
    const userReady = useUserStore((state) => state.isReady);
    const effective = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const costs = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const theme = useThemeStore((state) => state.theme);
    const assets = useAssetStore((state) => state.assets);
    const [prompt, setPrompt] = useState("");
    const [pending, setPending] = useState<PendingAudio | null>(null);
    const [loadedKey, setLoadedKey] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [polling, setPolling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const ownerId = user?.id || "guest";
    const taskKey = `xiaomeng:audio-pending:${ownerId}`;
    const config = { ...effective, model: effective.audioModel, activeChannelId: effective.audioChannelId || effective.activeChannelId };
    const price = requestCreditCost({ channelMode: config.channelMode, modelCosts: costs, model: config.model });
    const insufficient = config.channelMode === "remote" && price !== null && Boolean(user && user.credits < price);
    const needsReference = isMimoVoiceCloneModel(config.model) || isAutoDLConfig(config, config.model);
    const results = assets.filter((asset) => asset.kind === "audio" && asset.metadata?.source === "audio-workbench").slice(0, 20);
    const busy = submitting || Boolean(pending);

    useEffect(() => {
        let active = true;
        setPending(null); setError(""); setLoadedKey("");
        if (userReady) void localforage.getItem<PendingAudio>(taskKey).then((task) => { if (active) { setPending(task); setLoadedKey(taskKey); } }).catch(() => { if (active) { setLoadedKey(taskKey); setError("读取本地任务失败，请检查浏览器存储权限。"); } });
        return () => { active = false; };
    }, [taskKey, userReady]);

    const saveResult = async (task: CanvasAudioTask, record: PendingAudio) => {
        const url = await resolveMediaUrl(task.storageKey, task.audio_url || task.url || "");
        if (!url) throw new Error("任务已完成，但暂时无法读取音频，请重新查询。");
        if (owner() !== ownerId) return;
        const store = useAssetStore.getState();
        if (!store.assets.some((asset) => asset.metadata?.audioTaskId === task.id)) store.addAsset({ kind: "audio", title: record.prompt.slice(0, 32) || "生成音频", coverUrl: "", tags: [], source: "音频创作", data: { url, storageKey: task.storageKey, bytes: task.bytes, mimeType: task.mimeType || "audio/mpeg" }, metadata: { source: "audio-workbench", audioTaskId: task.id, prompt: record.prompt, model: record.model } });
        await localforage.removeItem(taskKey);
        if (user) void useUserStore.getState().hydrateUser();
    };

    useEffect(() => {
        if (!pending || loadedKey !== taskKey) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        const poll = async () => {
            try {
                const task = await pollCanvasAudioTaskStatus(pending.id, controller.signal);
                if (!active || owner() !== ownerId) return;
                setProgress(Math.max(0, Math.min(100, task.progress || 0)));
                setError("");
                if (task.status === "completed") { await saveResult(task, pending); if (active) { setPending(null); setPolling(false); setError(""); message.success("音频已生成并保存到我的素材"); } return; }
                if (task.status === "failed" || task.status === "cancelled") { await localforage.removeItem(taskKey); if (active) { setPending(null); setPolling(false); setError(task.error?.message || task.error_detail || "音频任务未完成，请查看账户流水确认返还状态。"); void useUserStore.getState().hydrateUser(); } return; }
                timer = setTimeout(() => void poll(), 4000);
            } catch (cause) { if (active) { setPolling(false); setError(`暂时无法读取任务状态，服务端可能仍在处理。${cause instanceof Error ? cause.message : "请稍后重试"}`); } }
        };
        setPolling(true); void poll();
        return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
        // 保存时使用当前账号的任务快照，不因模型设置变化重启轮询。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending, loadedKey, taskKey, ownerId, retry]);

    const generate = async () => {
        if (busy || loadedKey !== taskKey || !prompt.trim() || price === null || needsReference || insufficient) return;
        if (!isConfigReady(config, config.model)) { openConfig(false); return; }
        const record = { id: `client_audio_task_${nanoid()}`, prompt: prompt.trim(), model: config.model };
        let serverTask = false;
        let trackingWrite: Promise<PendingAudio> | undefined;
        setSubmitting(true); setError(""); setProgress(0);
        try {
            const channel = config.channelMode === "local" ? localChannelForActiveModel(config) : undefined;
            const task = await createCanvasAudioTask({ ...config, baseUrl: channel?.baseUrl || config.baseUrl, apiKey: channel?.apiKey || config.apiKey }, record.prompt, { clientTaskId: record.id, sourceId: "audio-workbench", onServerTask: () => { serverTask = true; trackingWrite = localforage.setItem(taskKey, record).catch(() => record); } });
            await trackingWrite;
            if (owner() !== ownerId) return;
            if (task.status === "failed") throw new Error(task.error?.message || "音频任务失败");
            if (task.status === "completed") { await saveResult(task, record); message.success("音频已生成并保存到我的素材"); }
            else { const next = { ...record, id: task.id }; await localforage.setItem(taskKey, next); setPending(next); }
        } catch (cause) {
            if (owner() !== ownerId) return;
            if (serverTask) { setPending(record); await localforage.setItem(taskKey, record).catch(() => undefined); }
            setError(cause instanceof Error ? cause.message : "提交请求未完成，请稍后查询状态");
        } finally { setSubmitting(false); }
    };

    const stopTracking = () => modal.confirm({ title: "结束本地任务跟踪？", content: "这不会取消服务端任务，也不会触发退款。请保留任务编号，避免重复提交产生扣费。", okText: "结束跟踪", cancelText: "继续等待", onOk: async () => { await localforage.removeItem(taskKey); setPending(null); setPolling(false); setError(""); } });

    return <main className="h-full overflow-y-auto px-5 py-7 md:px-8 md:py-9">
        <div className="mx-auto max-w-[1320px]">
            <div className="mb-7 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">音频创作</h1><p className="mt-2 text-sm text-muted-foreground">把脚本转成配音，生成结果自动加入我的素材。</p></div><Link href="/assets" className="text-sm text-muted-foreground hover:text-foreground">我的素材 →</Link></div>
            <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <section className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-5" aria-label="音频生成设置">
                    <div className="flex items-center justify-between"><h2 className="text-sm font-medium">模型与声音</h2><button type="button" onClick={() => openConfig(false)} aria-label="打开创作设置" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Settings2 className="size-4" /></button></div>
                    <ModelPicker config={config} value={config.model} channelId={config.audioChannelId} capability="audio" fullWidth onMissingConfig={() => openConfig(false)} onChange={(model, channelId) => { updateConfig("audioModel", model); if (channelId) updateConfig("audioChannelId", channelId); }} />
                    {!config.model || !isConfigReady(config, config.model) ? <p className="text-xs leading-5 text-muted-foreground">请选择可用音频模型。<Link href="/models" className="underline underline-offset-4">查看平台模型与价格</Link>，或在创作设置配置自有渠道。</p> : <AudioSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={canvasThemes[theme]} showTitle={false} className="space-y-4" />}
                    {needsReference ? <p className="text-xs leading-5 text-muted-foreground">此模型需要参考音频，请在<Link href="/canvas" className="mx-1 underline underline-offset-4">项目画布</Link>连接音频节点后使用。</p> : null}
                </section>
                <div className="min-w-0 space-y-6">
                    <section className="rounded-xl border border-border bg-card p-5">
                        <label htmlFor="audio-script" className="text-sm font-medium">配音脚本</label>
                        <textarea id="audio-script" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入需要朗读的文字，例如产品介绍、故事旁白或视频解说。" className="mt-3 min-h-48 w-full resize-y rounded-lg border border-border bg-background p-4 text-sm leading-7 outline-none focus:border-ring focus:ring-2 focus:ring-ring/40" />
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{prompt.length} 字 · {config.channelMode !== "remote" ? "自有渠道" : price === null ? "模型未定价，暂不可生成" : price === 0 ? "免费" : `预计 ${price} 点 / 次`}</p><Button type="primary" icon={<Sparkles className="size-4" />} loading={submitting} disabled={!userReady || loadedKey !== taskKey || busy || !prompt.trim() || !config.model || price === null || needsReference || insufficient} onClick={() => void generate()}>生成音频</Button></div>
                        {insufficient ? <p className="mt-3 text-xs text-destructive">算力点不足，请联系管理员加点后再生成。<Link href="/account" className="ml-1 underline underline-offset-4">查看余额</Link></p> : null}
                        {error ? <p role="alert" className="mt-4 break-words text-sm text-destructive">{error}</p> : null}
                        {pending ? <div className="mt-4 rounded-lg bg-muted p-4 text-xs leading-6 text-muted-foreground"><p>任务处理中{progress ? ` · ${progress}%` : ""}。切换页面后服务端继续处理，返回此页可恢复查询。</p><p className="break-all">任务编号：{pending.id}</p><div className="mt-2 flex flex-wrap gap-3"><Button size="small" icon={<RefreshCw className="size-3.5" />} disabled={polling} onClick={() => { setError(""); setRetry((value) => value + 1); }}>重新查询</Button>{!polling ? <Button size="small" type="text" onClick={() => void stopTracking()}>结束本地跟踪</Button> : null}</div></div> : null}
                    </section>
                    <section aria-label="生成音频"><div className="mb-4 flex items-center justify-between"><h2 className="text-base font-medium">最近生成</h2><span className="text-xs text-muted-foreground">已自动保存到我的素材</span></div>
                        {results.length ? <div className="space-y-3">{results.map((asset) => asset.kind === "audio" ? <article key={asset.id} className="rounded-xl border border-border bg-card p-4"><div className="mb-3 flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-medium">{asset.title}</h3><p className="mt-1 text-xs text-muted-foreground">{String(asset.metadata?.model || "音频")} · {new Date(asset.createdAt).toLocaleString("zh-CN")}</p></div><Button type="text" icon={<Download className="size-4" />} aria-label={`下载 ${asset.title}`} onClick={() => { saveAs(asset.data.url, `${asset.title}.${asset.data.mimeType.split("/")[1] || "mp3"}`); message.success("已开始下载"); }} /></div><audio controls preload="none" src={asset.data.url} className="w-full" aria-label={asset.title} /></article> : null)}</div> : <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground"><Headphones className="mb-3 size-7 opacity-60" /><p className="text-sm">生成的配音会显示在这里</p></div>}
                    </section>
                </div>
            </div>
        </div>
    </main>;
}
