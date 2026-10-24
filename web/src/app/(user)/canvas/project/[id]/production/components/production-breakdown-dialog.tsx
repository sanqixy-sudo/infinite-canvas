"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Segmented, Select, Spin } from "antd";
import { ChevronDown, Sparkles, Square } from "lucide-react";
import localforage from "localforage";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { productionBreakdownPrice, requestProductionBreakdown } from "@/services/api/production-breakdown";
import type { ProductionDocument } from "../../../../lib/production-types";
import { productionBreakdownSource, validateProductionBreakdownDraft, validateProductionBreakdownShots, type ProductionBreakdownDraft, type ProductionBreakdownShot } from "../../../../utils/production-breakdown";

type SavedBreakdown = { draft: ProductionBreakdownDraft; selected: number[]; model: string };
type Props = { document: ProductionDocument; episodeId: string; disabled?: boolean; onApply: (draft: ProductionBreakdownDraft) => boolean | Promise<boolean>; onClose: () => void };

export function ProductionBreakdownDialog({ document, episodeId, disabled, onApply, onClose }: Props) {
    const config = useEffectiveConfig();
    const settings = useConfigStore((state) => state.publicSettings);
    const loadingSettings = useConfigStore((state) => state.isPublicSettingsLoading);
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id || "");
    const version = useUserStore((state) => state.sessionVersion);
    const [model, setModel] = useState(config.textModel);
    const [protocol, setProtocol] = useState(config.apiMode === "responses" ? "responses" : "chat");
    const [count, setCount] = useState(12);
    const [instructions, setInstructions] = useState("");
    const [saved, setSaved] = useState<SavedBreakdown | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [applying, setApplying] = useState(false);
    const [replaceApproved, setReplaceApproved] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const request = useRef<AbortController | null>(null);
    const mounted = useRef(false);
    const writes = useRef<Promise<unknown>>(Promise.resolve());
    const operation = useRef(false);
    const key = `production-breakdown:${userId}:${document.workspaceId}:${episodeId}`;
    const scope = `${key}:${version}`;
    const activeScope = useRef(scope);
    activeScope.current = scope;
    const current = () => {
        const user = useUserStore.getState();
        return mounted.current && activeScope.current === scope && user.token === token && user.user?.id === userId && user.sessionVersion === version && user.isReady && !user.authError && user.user?.role !== "guest";
    };
    const persist = (value: SavedBreakdown | null) => {
        const write = writes.current.catch(() => undefined).then(async () => { if (value) await localforage.setItem(key, value); else await localforage.removeItem(key); });
        writes.current = write;
        return write;
    };
    const update = (value: SavedBreakdown) => {
        setSaved(value);
        void persist(value).catch(() => { if (current()) setError("拆镜草案未能保存到浏览器，请保持窗口打开并重试保存，避免关闭丢失。"); });
    };

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; request.current?.abort(); };
    }, []);
    useEffect(() => { if (!useConfigStore.getState().publicSettings) void useConfigStore.getState().loadPublicSettings(); }, []);
    useEffect(() => { if (!model && config.textModel) setModel(config.textModel); }, [config.textModel, model]);
    useEffect(() => {
        let active = true;
        request.current?.abort(); operation.current = false; setRunning(false); setApplying(false); setLoading(true); setSaved(null); setError(""); setNotice("");
        void localforage.getItem<SavedBreakdown>(key).then((value) => {
            if (!active || !current() || !value) return;
            if (!value.draft || value.draft.episodeId !== episodeId || typeof value.draft.sourceSnapshot !== "string" || value.draft.sourceSnapshot.length > 140000 || typeof value.model !== "string") throw new Error("本机拆镜草案格式异常，请重新生成");
            const shots = validateProductionBreakdownShots(value.draft.shots, true);
            if (!Array.isArray(value.draft.shotIds) || value.draft.shotIds.length !== shots.length || new Set(value.draft.shotIds).size !== shots.length || value.draft.shotIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error("本机拆镜草案标识异常，请重新生成");
            const selected = Array.isArray(value.selected) ? [...new Set(value.selected.filter((index) => Number.isInteger(index) && index >= 0 && index < shots.length))] : shots.map((_, index) => index);
            setSaved({ ...value, draft: { ...value.draft, shots }, selected });
            setNotice("已恢复本集未采用的拆镜草案，可以继续编辑和勾选。");
        }).catch((failure) => { if (active && current()) setError(failure instanceof Error ? failure.message : "读取本机拆镜草案失败"); }).finally(() => { if (active && current()) setLoading(false); });
        return () => { active = false; request.current?.abort(); };
        // A draft belongs to one account session, project and episode.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, version, token]);

    const episode = document.episodes.find((item) => item.id === episodeId);
    const scenes = document.scenes.filter((item) => item.episodeId === episodeId);
    const selectedConfig = { ...config, model, textModel: model, activeChannelId: "", textChannelId: "", apiMode: protocol };
    let price: number | null = null, priceError = "";
    try { price = productionBreakdownPrice(selectedConfig, settings?.modelChannel.modelCosts || []); } catch (failure) { priceError = failure instanceof Error ? failure.message : "模型价格不可用"; }
    let stale = false;
    try { stale = Boolean(saved && productionBreakdownSource(document, episodeId) !== saved.draft.sourceSnapshot); } catch { stale = true; }
    const busy = Boolean(disabled || running || applying || loading);
    const selected = saved ? saved.selected.map((index) => saved.draft.shots[index]).filter(Boolean) : [];
    const selectedDraft = saved && { ...saved.draft, shots: selected, shotIds: saved.selected.map((index) => saved.draft.shotIds[index]) };
    let applyError = "";
    if (selectedDraft && selected.length) {
        try { validateProductionBreakdownDraft(document, selectedDraft); } catch (failure) { applyError = failure instanceof Error ? failure.message : "请检查勾选镜头"; }
    }

    const generate = async () => {
        if (operation.current || !current() || disabled || loading || (saved && !replaceApproved)) return;
        operation.current = true; setRunning(true); setError(""); setNotice("");
        const controller = new AbortController(); request.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 180000);
        try {
            const draft = await requestProductionBreakdown({ document, episodeId, count, instructions, config: selectedConfig, prices: settings?.modelChannel.modelCosts || [], signal: controller.signal });
            if (!current()) return;
            const value = { draft, selected: draft.shots.map((_, index) => index), model };
            setSaved(value); setReplaceApproved(false);
            await persist(value);
            if (current()) setNotice(`已生成 ${draft.shots.length} 个镜头草案。检查内容并勾选后追加到计划。`);
        } catch (failure) {
            if (current()) setError(controller.signal.aborted ? "已停止等待。上游请求可能已经执行或计费；已有草案保留。请先查看调用记录，再决定是否重新生成。" : `${failure instanceof Error ? failure.message : "拆镜失败"}。如请求已成功到达模型，文字调用可能已计费；不会自动重试。`);
        } finally {
            window.clearTimeout(timer);
            if (request.current === controller) request.current = null;
            if (current()) { operation.current = false; setRunning(false); }
        }
    };
    const close = async () => {
        if (running || applying) return;
        try { if (saved) await persist(saved); else await writes.current; if (current()) onClose(); }
        catch { if (current()) setError("草案保存失败，暂未关闭窗口。请重试，或先将需要的镜头追加到计划。"); }
    };
    const apply = async () => {
        if (!selectedDraft || operation.current || busy || !current()) return;
        operation.current = true; setApplying(true); setError("");
        let appended = false;
        try {
            validateProductionBreakdownDraft(document, selectedDraft);
            if (!await onApply(selectedDraft)) {
                if (current()) setError("追加未完成，拆镜草案已保留。请关闭此窗口查看制作计划的错误提示，处理后重试。");
                return;
            }
            if (!current()) return;
            appended = true;
            // Stable draft shot IDs also prevent duplication if clearing the cache fails.
            setSaved(null);
            await persist(null);
            if (current()) onClose();
        } catch (failure) { if (current()) setError(appended ? "镜头已追加到计划，但清除浏览器中的旧草案失败。请保存计划；再次打开时会阻止重复追加。" : failure instanceof Error ? failure.message : "追加失败，拆镜草案已保留"); }
        finally { if (current()) { operation.current = false; setApplying(false); } }
    };
    const editShot = (index: number, patch: Partial<ProductionBreakdownShot>) => {
        if (saved) update({ ...saved, draft: { ...saved.draft, shots: saved.draft.shots.map((shot, position) => position === index ? { ...shot, ...patch } : shot) } });
    };

    return <Modal open title={`AI 拆镜 · ${episode?.title || "本集"}`} width={1120} onCancel={() => void close()} closable={!running && !applying} mask={{ closable: false }} keyboard={!running && !applying} styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }} footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">只追加勾选镜头，现有镜头与画布保持原样。追加后请保存计划。</span><div className="flex gap-2"><Button disabled={running || applying} onClick={() => void close()}>保留草案并关闭</Button><Button type="primary" disabled={busy || !selected.length || Boolean(applyError)} loading={applying} onClick={() => void apply()}>追加 {selected.length} 个镜头</Button></div></div>}>
        <div className="space-y-4 py-3">
            {error && <Alert type="error" showIcon title={error} />}
            {notice && <Alert type="info" title={notice} />}
            {loading ? <div role="status" className="flex items-center justify-center gap-3 p-10"><Spin /><span className="text-sm text-muted-foreground">读取本集拆镜草案…</span></div> : <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                <section className="space-y-5">
                    <div><label className="mb-2 block text-sm font-medium" htmlFor="breakdown-model">文字模型</label><Select id="breakdown-model" aria-label="拆镜文字模型" className="w-full" showSearch={{ optionFilterProp: "label" }} value={model || undefined} disabled={busy} loading={loadingSettings} options={config.textModels.map((name) => ({ value: name, label: name }))} placeholder="选择平台文字模型" onChange={setModel} />{!config.textModels.length && !loadingSettings && <p className="mt-2 text-xs text-muted-foreground">暂无可用文字模型，请管理员在模型设置中开放。</p>}</div>
                    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">高级：文字调用方式</summary><Segmented className="mt-3" aria-label="文字模型请求方式" value={protocol} disabled={busy} options={[{ value: "chat", label: "Chat" }, { value: "responses", label: "Responses" }]} onChange={setProtocol} block /><p className="mt-2 leading-6">沿用画布助手设置，仅在平台模型要求时调整。Gemini 渠道自动使用原生协议。</p></details>
                    <label className="block text-sm font-medium">目标镜头数<InputNumber className="!mt-2 !w-full" name="breakdown-count" min={1} max={40} precision={0} value={count} disabled={busy} onChange={(value) => setCount(value || 1)} /></label>
                    <label className="block text-sm font-medium">补充要求<Input.TextArea name="breakdown-instructions" className="mt-2 !text-base sm:!text-sm" rows={4} maxLength={2000} value={instructions} disabled={busy} placeholder="例如：竖屏短剧，保留原对白，动作镜头短一些。" onChange={(event) => setInstructions(event.target.value)} /></label>
                    <details className="text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer">本次提交的剧本与上下文</summary><p className="mt-2">本集完整剧本、故事概述、视觉风格、{scenes.length} 个场次和 {document.assets.length} 个资产的文字设定。参考文件不会上传。</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans">{episode?.script || "尚未填写剧本"}</pre></details>
                    <div className="space-y-3 border-t border-border pt-4"><p className="text-sm font-medium">{price === null ? priceError : `${price} 算力点／次 · 本次 1 次文字调用`}</p><p className="text-xs leading-6 text-muted-foreground">拆镜费用独立于图片／视频生成，按提交时平台价格扣费。未采用、格式不合格或停止等待不等同于退款；不会自动修复重试。</p>{saved && <Checkbox checked={replaceApproved} disabled={busy} onChange={(event) => setReplaceApproved(event.target.checked)}>开始新一版，成功后替换当前草案</Checkbox>}{running ? <Button block icon={<Square className="size-3.5" />} onClick={() => request.current?.abort()}>停止等待</Button> : <Button block icon={<Sparkles className="size-4" />} disabled={busy || price === null || !episode?.script.trim() || (Boolean(saved) && !replaceApproved)} onClick={() => void generate()}>{saved ? "生成新一版" : "生成拆镜草案"}{price !== null ? ` · ${price} 算力点` : ""}</Button>}</div>
                </section>
                <section className="min-w-0">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">逐镜审阅</h3><p className="mt-1 text-xs text-muted-foreground">{saved ? `${saved.model} · ${saved.draft.shots.length} 个草案 · 已选 ${selected.length} 个` : "生成后检查画面、对白、时长与资产，再加入制作计划。"}</p></div>{saved && <Checkbox disabled={busy} checked={selected.length === saved.draft.shots.length} indeterminate={selected.length > 0 && selected.length < saved.draft.shots.length} onChange={(event) => update({ ...saved, selected: event.target.checked ? saved.draft.shots.map((_, index) => index) : [] })}>全选</Checkbox>}</div>
                    {running && <p role="status" className="mb-4 text-sm text-muted-foreground">正在整理剧本和镜头…已有草案暂时保留。</p>}
                    {(stale || applyError) && <Alert className="mb-4" type="warning" showIcon title={applyError || "剧本或上下文已变化，请重新生成后追加"} />}
                    {saved ? <div className="divide-y divide-border border-y border-border">{saved.draft.shots.map((shot, index) => <article key={index} className="py-4"><div className="flex items-start gap-3"><Checkbox aria-label={`选择镜头 ${index + 1}`} checked={saved.selected.includes(index)} disabled={busy} onChange={(event) => update({ ...saved, selected: event.target.checked ? [...saved.selected, index].sort((a, b) => a - b) : saved.selected.filter((item) => item !== index) })} /><span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h4 className="min-w-0 break-words text-sm font-medium">{shot.title || "未填写标题"}</h4><span className="shrink-0 text-xs text-muted-foreground">{shot.seconds} 秒</span></div><p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{shot.description}</p><details className="mt-3"><summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs"><ChevronDown className="size-3.5" />编辑镜头详情</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs">标题<Input name={`shot-${index}-title`} className="mt-2" maxLength={180} value={shot.title} disabled={busy} onChange={(event) => editShot(index, { title: event.target.value })} /></label><label className="text-xs">计划秒数<InputNumber name={`shot-${index}-seconds`} className="!mt-2 !w-full" min={1} max={60} precision={0} value={shot.seconds} disabled={busy} onChange={(value) => editShot(index, { seconds: value || 1 })} /></label><label className="text-xs sm:col-span-2">画面与动作<Input.TextArea name={`shot-${index}-description`} className="mt-2" rows={3} maxLength={6000} value={shot.description} disabled={busy} onChange={(event) => editShot(index, { description: event.target.value })} /></label><label className="text-xs sm:col-span-2">对白<Input.TextArea name={`shot-${index}-dialogue`} className="mt-2" rows={2} maxLength={2000} value={shot.dialogue} disabled={busy} onChange={(event) => editShot(index, { dialogue: event.target.value })} /></label><label className="text-xs sm:col-span-2">景别与运镜<Input name={`shot-${index}-camera`} className="mt-2" maxLength={1000} value={shot.camera} disabled={busy} onChange={(event) => editShot(index, { camera: event.target.value })} /></label><div><label htmlFor={`shot-${index}-scene`} className="mb-2 block text-xs">场次</label><Select id={`shot-${index}-scene`} className="w-full" value={shot.sceneId} disabled={busy} options={[{ value: "", label: "未分场" }, ...scenes.map((scene) => ({ value: scene.id, label: scene.title }))]} onChange={(sceneId) => editShot(index, { sceneId })} /></div><div><label htmlFor={`shot-${index}-assets`} className="mb-2 block text-xs">关联资产</label><Select id={`shot-${index}-assets`} className="w-full" mode="multiple" showSearch={{ optionFilterProp: "label" }} maxCount={50} value={shot.assetIds} disabled={busy} options={document.assets.map((asset) => ({ value: asset.id, label: asset.title }))} onChange={(assetIds) => editShot(index, { assetIds })} /></div></div></details></div></div></article>)}</div> : <div className="flex min-h-80 flex-col items-center justify-center px-8 text-center"><Sparkles className="mb-4 size-6 text-muted-foreground" /><h3 className="text-sm font-medium">从剧本生成一版可编辑分镜</h3><p className="mt-2 max-w-sm text-sm leading-7 text-muted-foreground">AI 先提出镜头，最终由你选择。这里不创建画布节点，也不触发图片或视频生成。</p></div>}
                </section>
            </div>}
        </div>
    </Modal>;
}
