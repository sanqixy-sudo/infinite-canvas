"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Pagination, Popconfirm, Select, Spin, Tag } from "antd";
import localforage from "localforage";
import * as api from "@/services/api/teams";
import { ApiError } from "@/services/api/request";
import { gatewayInputError, type GatewayParameters } from "@/lib/model-gateway";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { notifyAccountWalletRefresh } from "@/lib/account-wallet-events";
import { useTeamSession } from "../use-team-session";
import { useCanvasStore } from "../../stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeMetadata } from "../../types";
import type { VideoResponse } from "@/services/api/video";

type RequestDraft = { requestId: string; shotId: string; model: string; prompt: string; parameters: GatewayParameters; assetIds: string[] };
const blankDraft = (): RequestDraft => ({ requestId: `team-request-${crypto.randomUUID()}`, shotId: "", model: "", prompt: "", parameters: { resolution: "", ratio: "", duration: 5, generateAudio: true, watermark: false }, assetIds: [] });
const statuses: Record<string, string> = { pending: "待审批", quoted: "等待确认报价", approved: "已批准", submitting: "提交中", queued: "排队中", running: "已提交 / 生成中", succeeded: "已完成", completed: "已完成", failed: "失败", reject: "已拒绝", withdraw: "已撤回", cancelled: "已取消", billing_pending: "待结算", pending_balance: "待补扣", released: "已释放预扣", settled: "已结算" };

export default function TeamGenerationPanel({ projectId }: { projectId: string }) {
    const { token, userId, scope, current } = useTeamSession(), config = useEffectiveConfig();
    const models = config.publicChannels.filter((channel) => channel.protocol === "gateway" && channel.enabled !== false).flatMap((channel) => channel.gatewayModels || []).filter((model, index, list) => list.findIndex((other) => other.id === model.id) === index);
    const [detail, setDetail] = useState<api.TeamProjectDetail | null>(null), [state, setState] = useState<api.TeamGeneration | null>(null), [draft, setDraft] = useState<RequestDraft | null>(null);
    const [assets, setAssets] = useState<api.TeamAsset[]>([]), [assetTotal, setAssetTotal] = useState(0), [assetPage, setAssetPage] = useState(1);
    const [page, setPage] = useState(1), [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [budget, setBudget] = useState<number | null>(null), [quote, setQuote] = useState<{ request: api.TeamGenerationRequest; price: api.TeamGenerationQuote } | null>(null), [reason, setReason] = useState<{ request: api.TeamGenerationRequest; text: string } | null>(null);
    const [attempted, setAttempted] = useState(false), [clock, setClock] = useState(Date.now());
    const lock = useRef(false), alive = useRef(true), writes = useRef(Promise.resolve()), key = `team-generation-draft:${userId}:${projectId}`;
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        let active = true;
        void localforage.getItem<RequestDraft>(key).then((saved) => { if (active && current()) setDraft(saved || blankDraft()); }).catch(() => { if (active && current()) { setDraft(blankDraft()); setNotice("本机草稿读取失败，请提交前保留提示词。"); } });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, scope]);
    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const [project, result] = await Promise.all([api.getTeamProject(token, projectId), api.getTeamGeneration(token, projectId, page)]);
                if (!active || !current()) return; setDetail(project); setState(result); setBudget((value) => value ?? result.budget?.limitCredits ?? null);
                const last = Math.max(1, Math.ceil(result.total / (result.pageSize || 20))); if (page > last) setPage(last);
            } catch (failure) { if (active && current()) { setError(failure instanceof Error ? failure.message : "生成审批读取失败"); if (failure instanceof ApiError && [401, 403].includes(failure.status)) { setDetail(null); setState(null); setQuote(null); setReason(null); } } }
        };
        void load(); const timer = setInterval(() => { if (!lock.current) void load(); }, 15000); return () => { active = false; clearInterval(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, projectId, page, reload]);
    useEffect(() => {
        let active = true; if (!detail) return;
        void api.getTeamAssets(token, detail.team.id, assetPage).then((value) => { if (!active || !current()) return; setAssetTotal(value.total); setAssets((old) => [...(assetPage === 1 ? [] : old), ...value.items].filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)); }).catch((failure) => { if (active && current()) setError(failure instanceof Error ? failure.message : "素材读取失败"); });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, detail?.team.id, assetPage, reload]);
    useEffect(() => { if (!quote) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [quote]);
    const change = (next: RequestDraft) => {
        if (!current() || lock.current) return; setDraft(next); setAttempted(false);
        writes.current = writes.current.catch(() => undefined).then(async () => { await localforage.setItem(key, next); }).catch(() => { if (current() && alive.current) setNotice("本机草稿保存失败；提交失败时请保留提示词。"); });
    };
    const act = async (action: () => Promise<unknown>, done?: (value: unknown) => void) => {
        if (!current() || lock.current) return; lock.current = true; setBusy(true); setError("");
        try { const result = await action(); if (current() && alive.current) { done?.(result); setReload((value) => value + 1); } }
        catch (failure) { if (current() && alive.current) { setError(failure instanceof Error ? failure.message : "操作失败"); if (failure instanceof ApiError && [401, 403].includes(failure.status)) { setDetail(null); setState(null); setQuote(null); } } }
        finally { if (current() && alive.current) { lock.current = false; setBusy(false); } }
    };
    const selected = models.find((model) => model.id === draft?.model);
    const accepted = (result: unknown, request: api.TeamGenerationRequest) => {
        setQuote(null); notifyAccountWalletRefresh();
        const task = (result as { accepted?: boolean; task?: VideoResponse } | null)?.task;
        const store = useCanvasStore.getState(), project = store.projects.find((item) => item.id === task?.canvasId);
        const node = project?.nodes.find((item) => item.id === task?.source_id && item.type === CanvasNodeType.Video);
        if (current() && store.ownerId === userId && task?.id && project && node && node.metadata?.videoTaskId !== task.id) {
            const metadata: CanvasNodeMetadata = { ...node.metadata, teamApprovalId: request.id, clientTaskId: request.id, taskBackend: "account", videoTaskId: task.id, videoTaskStatus: task.status, status: "loading", model: task.model, channelId: "model-gateway", size: request.parameters.ratio, seconds: String(request.parameters.duration), vquality: request.parameters.resolution, generateAudio: String(request.parameters.generateAudio), billingStatus: task.billingStatus, reservedCredits: task.reservedCredits, startedAt: Date.now(), progress: 0 };
            for (const key of ["videoTaskVideoId", "videoTaskTranslation", "workflowRef", "actualTokens", "actualInputTokens", "actualOutputTokens", "settledCredits", "tokenMode", "errorDetails", "accountSaveError"] as const) delete metadata[key];
            store.updateProject(project.id, { nodes: project.nodes.map((item) => item.id === node.id ? { ...item, metadata } : item) });
        }
        setNotice("任务已受理并绑定原镜头的视频节点。打开画布可继续查看进度，结束后按实际用量多退少补。");
    };
    const showQuote = (request: api.TeamGenerationRequest, result: unknown) => {
        if (result && typeof result === "object" && "accepted" in result && result.accepted) { accepted(result, request); return; }
        const price = result as api.TeamGenerationQuote;
        if (!price?.quoteId || !Number.isFinite(price.reserveCredits) || price.reserveCredits < 0 || !Number.isFinite(Date.parse(price.expiresAt))) throw new Error("报价信息无效，请刷新申请状态后重试。");
        setQuote({ request, price }); setClock(Date.now());
    };
    const selectedAssets = assets.filter((asset) => draft?.assetIds.includes(asset.id));
    const inputs = selectedAssets.map((asset) => ({ kind: asset.kind, role: `reference_${asset.kind}` as "reference_image" | "reference_video" | "reference_audio" }));
    const inputError = selected && draft ? gatewayInputError(selected, inputs, draft.parameters) : "请选择平台视频模型";
    const quoteExpired = !quote || !Number.isFinite(Date.parse(quote.price.expiresAt)) || Date.parse(quote.price.expiresAt) <= clock;
    const submitRequest = () => { if (!draft) return; setAttempted(true); void act(async () => { await writes.current; return api.requestTeamGeneration(token, projectId, draft); }, () => { const next = blankDraft(); setDraft(next); setAttempted(false); writes.current = writes.current.catch(() => undefined).then(async () => { await localforage.setItem(key, next); }).catch(() => { if (current()) setNotice("申请已提交，本机旧草稿清理失败。请刷新审批列表确认后再新建。"); }); setNotice("申请已提交。只有项目拥有者确认报价后才会从其个人钱包预扣。"); setPage(1); }); };
    if (!detail || !state || !draft) return <div className="space-y-3 py-5">{error ? <Alert type="error" title={error} /> : <Spin />}</div>;
    return <div className="space-y-6">
        <Alert type="info" showIcon title="团队生成由项目拥有者确认报价，并从其个人算力余额预扣，结束后多退少补。" description="项目预算只归集本入口批准的任务，个人画布创作不计入。实际费用可能高于预扣与剩余预算，超出后会阻止后续批准；预算不代表单次收费封顶。" />
        {error && <Alert type="error" showIcon title={error} />}{notice && <Alert type="info" title={notice} closable onClose={() => setNotice("")} />}
        {state.canViewCosts && state.budget && <div className="grid gap-3 sm:grid-cols-3">{[["项目预算", state.budget.limitCredits], ["占用预扣", state.budget.heldCredits], ["已结算成本", state.budget.spentCredits]].map(([label, value]) => <div key={label} className="rounded-xl bg-muted/50 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold">{Number(value).toLocaleString("zh-CN")} <span className="text-xs font-normal">算力点</span></p></div>)}</div>}
        {state.canApprove && <div className="flex flex-wrap items-center gap-3"><label className="text-sm">本项目预算 <InputNumber className="ml-2" aria-label="团队项目预算算力点" value={budget} min={0} max={1e8} precision={2} disabled={busy} onChange={setBudget} /></label><Button disabled={busy || budget === null} onClick={() => void act(() => api.setTeamGenerationBudget(token, projectId, budget || 0), () => setNotice("预算已保存。"))}>保存预算</Button><span className="text-xs text-muted-foreground">仅限制后续批准，不充值、不转移个人余额。</span></div>}
        <details className="rounded-xl border border-border p-4" open={state.requests.length === 0}><summary className="cursor-pointer text-sm font-semibold">发起镜头生成申请</summary><div className="mt-5 space-y-4">
            {attempted && <Alert type="warning" title="已提交过本草稿。网络失败可按相同申请编号重试，或先刷新列表核对。" />}
            <Select aria-label="申请镜头" className="w-full" placeholder="选择已保存的镜头" disabled={busy || attempted} value={draft.shotId || undefined} options={detail.plan.shots.map((shot) => ({ value: shot.id, label: `${detail.plan.episodes.find((ep) => ep.id === shot.episodeId)?.title || "分集"} · ${shot.title}` }))} onChange={(shotId) => { const shot = detail.plan.shots.find((item) => item.id === shotId); change({ ...draft, shotId, prompt: shot?.description || "" }); }} />
            <Select aria-label="视频模型" className="w-full" placeholder="选择平台网关视频模型" disabled={busy || attempted} value={draft.model || undefined} options={models.map((model) => ({ value: model.id, label: `${model.displayName || model.name}${model.group ? ` · ${model.group}` : ""}${model.badge ? ` · ${model.badge}` : ""}` }))} onChange={(modelId) => { const model = models.find((item) => item.id === modelId); if (model) change({ ...draft, model: modelId, parameters: { ...draft.parameters, resolution: model.capabilities.resolutions[0] || "", ratio: model.capabilities.ratios[0] || "", duration: Math.max(model.capabilities.minDuration, Math.min(model.capabilities.maxDuration, detail.plan.shots.find((item) => item.id === draft.shotId)?.seconds || 5)) } }); }} />
            {!models.length && <p className="text-xs text-muted-foreground">管理员尚未发布可用的网关视频模型。</p>}
            {selected && <><p className="text-xs leading-6 text-muted-foreground">支持 {selected.capabilities.maxImages} 图 / {selected.capabilities.maxVideos} 视频 / {selected.capabilities.maxAudios} 音频 · {selected.remark}</p><div className="grid gap-3 sm:grid-cols-3"><Select aria-label="分辨率" value={draft.parameters.resolution} disabled={busy || attempted} options={selected.capabilities.resolutions.map((value) => ({ value, label: value }))} onChange={(resolution) => change({ ...draft, parameters: { ...draft.parameters, resolution } })} /><Select aria-label="比例" value={draft.parameters.ratio} disabled={busy || attempted} options={selected.capabilities.ratios.map((value) => ({ value, label: value }))} onChange={(ratio) => change({ ...draft, parameters: { ...draft.parameters, ratio } })} /><InputNumber aria-label="时长秒" min={selected.capabilities.minDuration} max={selected.capabilities.maxDuration} precision={0} value={draft.parameters.duration} disabled={busy || attempted} onChange={(value) => change({ ...draft, parameters: { ...draft.parameters, duration: value || selected.capabilities.minDuration } })} /></div><Checkbox checked={draft.parameters.generateAudio} disabled={busy || attempted} onChange={(event) => change({ ...draft, parameters: { ...draft.parameters, generateAudio: event.target.checked } })}>生成声音</Checkbox></>}
            <Select mode="multiple" aria-label="引用团队共享素材" className="w-full" placeholder="可选择团队共享图片、视频、音频" disabled={busy || attempted} value={draft.assetIds} options={assets.map((asset) => ({ value: asset.id, label: `${asset.title} · ${asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "音频"}` }))} onChange={(assetIds) => change({ ...draft, assetIds })} />{assets.length < assetTotal && <Button type="text" size="small" disabled={busy} onClick={() => setAssetPage((value) => value + 1)}>加载更多共享素材</Button>}
            <Input.TextArea aria-label="生成提示词" rows={5} value={draft.prompt} maxLength={10000} disabled={busy || attempted} onChange={(event) => change({ ...draft, prompt: event.target.value })} />{inputError && <p className="text-xs text-destructive">{inputError}</p>}
            <div className="flex flex-wrap gap-2"><Button type="primary" loading={busy} disabled={!draft.shotId || !draft.prompt.trim() || Boolean(inputError) || draft.assetIds.some((id) => !assets.some((asset) => asset.id === id))} onClick={submitRequest}>{attempted ? "按原编号重试申请" : "提交申请（不扣费）"}</Button>{attempted && <Popconfirm title="放弃当前草稿并新建申请？" description="请先检查列表，原申请可能已成功。此操作不会撤回已经提交的申请。" onConfirm={() => change(blankDraft())}><Button disabled={busy}>新建草稿</Button></Popconfirm>}</div>
        </div></details>
        <div className="space-y-3"><div className="flex items-center justify-between"><h4 className="text-sm font-semibold">申请与任务 · {state.total}</h4><Button disabled={busy} onClick={() => setReload((value) => value + 1)}>刷新状态</Button></div>{state.requests.map((item) => <article key={item.id} className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.shotTitle}</strong><Tag>{statuses[item.state] || item.state}</Tag></div><p className="text-xs text-muted-foreground">{models.find((model) => model.id === item.model)?.displayName || item.model} · {item.parameters.resolution} · {item.parameters.ratio} · {item.parameters.duration} 秒 · {item.assetIds.length} 份素材</p><details><summary className="cursor-pointer text-xs">查看申请内容</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{item.prompt}</p></details>{item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}{state.canViewCosts && <p className="text-xs">预扣 {typeof item.reservedCredits === "number" ? `${item.reservedCredits} 点` : "未发生"} · 结算 {typeof item.actualCredits === "number" ? `${item.actualCredits} 点` : "待结算"}</p>}{item.taskId && <p className="break-all text-xs text-muted-foreground">任务：{item.taskId} · 项目拥有者可在个人制作任务中查看结果，再发布审片。</p>}<div className="flex flex-wrap gap-2">{state.canApprove && ["pending", "quoted"].includes(item.state) && <><Button type="primary" disabled={busy} onClick={() => void act(() => api.quoteTeamGeneration(token, projectId, item.id), (value) => showQuote(item, value))}>获取报价并审批</Button><Button disabled={busy} onClick={() => setReason({ request: item, text: "" })}>拒绝申请</Button></>}{item.requesterId === userId && ["pending", "quoted"].includes(item.state) && <Popconfirm title="撤回这份申请？" onConfirm={() => act(() => api.actTeamGeneration(token, projectId, item.id, { action: "withdraw" }))}><Button disabled={busy}>撤回</Button></Popconfirm>}</div></article>)}<Pagination current={page} total={state.total} pageSize={state.pageSize || 20} showSizeChanger={false} disabled={busy} onChange={setPage} /></div>
        <Modal open={Boolean(quote)} title="确认个人钱包预扣" closable={!busy} mask={{ closable: false }} onCancel={() => !busy && setQuote(null)} footer={<div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setQuote(null)}>取消</Button>{quoteExpired ? <Button loading={busy} onClick={() => quote && void act(() => api.quoteTeamGeneration(token, projectId, quote.request.id), (value) => showQuote(quote.request, value))}>重新获取报价</Button> : <Button type="primary" loading={busy} onClick={() => quote && void act(() => api.actTeamGeneration(token, projectId, quote.request.id, { action: "submit", quoteId: quote.price.quoteId }), (value) => accepted(value, quote.request))}>确认从我的余额预扣 {quote?.price.reserveCredits} 点</Button>}</div>}>
            {quote && <div className="space-y-4 py-3"><p className="text-sm">{quote.request.shotTitle} · {quote.request.parameters.resolution} · {quote.request.parameters.duration} 秒</p><p className="text-2xl font-semibold">预扣 {quote.price.reserveCredits} 算力点</p><p className="text-xs leading-6 text-muted-foreground">{quote.price.unit === "second" || quote.price.unit === "call" ? `费率 ${quote.price.unitPriceCredits} 点 / ${quote.price.unit === "second" ? "秒" : "次"}` : quote.price.tokenMode === "input_output_tokens" ? `输入 ${quote.price.inputPriceCreditsPerMillion} 点 / 1M token，输出 ${quote.price.outputPriceCreditsPerMillion} 点 / 1M token` : `${quote.price.unitPriceCreditsPerMillion} 点 / 1M token`}</p><Alert type="warning" showIcon title="这次操作将扣你的个人算力余额。" description="预扣并非最终价格，结算可能补扣。网络异常时请先刷新同一申请状态，不要重复新建付费申请。" /><p className="text-xs text-muted-foreground">报价有效至 {new Date(quote.price.expiresAt).toLocaleString("zh-CN")}</p>{error && <Alert type="error" title={error} />}</div>}
        </Modal>
        <Modal open={Boolean(reason)} title="拒绝生成申请" confirmLoading={busy} mask={{ closable: false }} onCancel={() => !busy && setReason(null)} onOk={() => reason && void act(() => api.actTeamGeneration(token, projectId, reason.request.id, { action: "reject", reason: reason.text }), () => setReason(null))}><Input.TextArea aria-label="拒绝原因" value={reason?.text || ""} maxLength={500} rows={3} disabled={busy} onChange={(event) => setReason((value) => value ? { ...value, text: event.target.value } : value)} /></Modal>
    </div>;
}
