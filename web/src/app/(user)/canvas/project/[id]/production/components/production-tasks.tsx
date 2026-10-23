"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { Alert, Button, Checkbox, Modal, Pagination, Segmented, Select } from "antd";
import { ExternalLink, ListVideo, RefreshCw, RotateCcw } from "lucide-react";
import { getProductionTasks, quoteProductionRetry, submitProductionRetry, type ProductionRetryQuote, type ProductionTask, type ProductionTaskList } from "@/services/api/production";
import { useUserStore } from "@/stores/use-user-store";
import type { ProductionShot } from "../../../../lib/production-types";

const statusLabels: Record<string, string> = { queued: "等待提交", waiting: "等待提交", finished: "执行结束", pending: "等待中", submitted: "已提交", submitting: "正在提交", in_progress: "生成中", processing: "生成中", running: "生成中", completed: "已完成", succeeded: "已完成", success: "已完成", failed: "失败", error: "失败", cancelled: "已取消", canceled: "已取消", unknown: "结果待确认", submission_unknown: "提交结果待确认" };
const billingLabels: Record<string, string> = { reserved: "已预扣", charged: "已扣费待结果", pending: "待结算", pending_usage: "等待用量", pending_balance: "等待补扣", settled: "已结算", released: "预扣已退回", refunded: "已退回", unknown: "费用待确认" };
const amount = (value: number | null | undefined) => value == null ? "未提供" : value.toFixed(2);
type RetryItem = { task: ProductionTask; quote: ProductionRetryQuote; done?: boolean; error?: string };

export default function ProductionTasks({ workspaceId, episodeId, shots, dirty }: { workspaceId: string; episodeId: string; shots: ProductionShot[]; dirty: boolean }) {
    const token = useUserStore((state) => state.token);
    const version = useUserStore((state) => state.sessionVersion);
    const userId = useUserStore((state) => state.user?.id || "");
    const ready = useUserStore((state) => Boolean(state.isReady && !state.authError && state.token && state.user?.id && state.user.role !== "guest"));
    const [page, setPage] = useState(1), [filter, setFilter] = useState("all"), [view, setView] = useState("queue");
    const [snapshot, setSnapshot] = useState<{ key: string; value: ProductionTaskList; time: string } | null>(null);
    const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
    const [loadingKey, setLoadingKey] = useState(""), [reload, setReload] = useState(0);
    const [selected, setSelected] = useState<string[]>([]);
    const [retryItems, setRetryItems] = useState<RetryItem[] | null>(null);
    const [working, setWorking] = useState(false);
    const [notice, setNotice] = useState("");
    const workingRef = useRef(false);
    const scope = `${workspaceId}:${episodeId}:${userId}:${token}:${version}`;
    const queryKey = `${scope}:${page}:${filter}`;
    const scopeRef = useRef(scope), mounted = useRef(false);
    scopeRef.current = scope;
    const current = () => {
        const state = useUserStore.getState();
        return mounted.current && scopeRef.current === scope && state.isReady && !state.authError && state.user?.role !== "guest" && state.user?.id === userId && state.token === token && state.sessionVersion === version;
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { setPage(1); setSelected([]); setRetryItems(null); workingRef.current = false; setWorking(false); setFailure(null); setNotice(""); }, [scope]);
    useEffect(() => {
        let active = true, timer: ReturnType<typeof setTimeout> | undefined;
        const load = async () => {
            if (!active || !current() || !ready || !episodeId) return;
            if (!document.hidden) {
                setLoadingKey(queryKey);
                try {
                    const value = await getProductionTasks(token, workspaceId, { episodeId, page, pageSize: 30, status: filter });
                    if (active && current()) {
                        const lastPage = Math.max(1, Math.ceil(value.total / 30));
                        if (page > lastPage) { setPage(lastPage); setSelected([]); }
                        else setSnapshot({ key: queryKey, value, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
                        setFailure(null);
                    }
                } catch (error) { if (active && current()) setFailure({ scope, message: error instanceof Error ? error.message : "任务读取失败" }); }
                finally { if (active && current()) setLoadingKey(""); }
            }
            if (active && current()) timer = setTimeout(load, 10000);
        };
        void load();
        return () => { active = false; if (timer) clearTimeout(timer); };
        // The key contains the account, session, project, episode and query.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryKey, ready, reload]);
    const value = ready && snapshot?.key === queryKey ? snapshot.value : null;
    const tasks = value?.items || [], summary = value?.summary;
    const failureMessage = ready && failure?.scope === scope ? failure.message : "";
    const eligible = tasks.filter((task) => task.canRetry);
    const selectedTasks = eligible.filter((task) => selected.includes(task.recordId));
    const title = (task: ProductionTask) => task.shotIds.map((id, index) => shots.find((shot) => shot.id === id)?.title || task.shotTitles[index] || "已移除镜头").join("、");
    const prepareRetry = async (targets: ProductionTask[]) => {
        if (!current() || dirty || workingRef.current || !targets.length) return;
        workingRef.current = true; setWorking(true); setFailure(null);
        try {
            const prepared: RetryItem[] = [];
            for (const task of targets) {
                const storageKey = `production-retry:${userId}:${workspaceId}:${task.recordId}`;
                const prior = await localforage.getItem<string>(storageKey);
                if (!current()) return;
                const requestId = prior || `production_retry_${nanoid()}`;
                await localforage.setItem(storageKey, requestId);
                if (!current()) return;
                const quote = await quoteProductionRetry(token, workspaceId, task.recordId, requestId);
                if (!current()) return;
                if (quote.accepted) { setNotice("已恢复此前提交的重试任务，请查看最新记录；再次失败时，从最新失败任务继续操作。"); setReload((n) => n + 1); continue; }
                prepared.push({ task, quote });
            }
            if (current()) setRetryItems(prepared.length ? prepared : null);
        } catch (error) { if (current()) setFailure({ scope, message: error instanceof Error ? error.message : "读取重试报价失败，尚未发起新任务" }); }
        finally { if (current()) { workingRef.current = false; setWorking(false); } }
    };
    const submitRetries = async () => {
        if (!retryItems || !current() || dirty || workingRef.current) return;
        workingRef.current = true; setWorking(true);
        const next = retryItems.map((item) => ({ ...item }));
        try {
            for (const item of next) {
                if (item.done) continue;
                if (!current()) return;
                try { await submitProductionRetry(token, workspaceId, item.task.recordId, item.quote); item.done = true; item.error = ""; }
                catch (error) { item.error = error instanceof Error ? error.message : "提交结果未确认，请先刷新任务，勿新建重复任务"; break; }
                if (current()) setRetryItems(next.map((row) => ({ ...row })));
            }
        } finally { if (current()) { setRetryItems(next); setReload((n) => n + 1); workingRef.current = false; setWorking(false); setSelected([]); } }
    };
    const costRows = value?.shotCosts || [];
    const retryTotal = retryItems?.filter((item) => !item.done).reduce((sum, item) => sum + Math.round(item.quote.reserveCredits * 100), 0) || 0;
    return <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><Segmented aria-label="制作记录视图" value={view} onChange={(next) => setView(String(next))} options={[{ value: "queue", label: "任务队列" }, { value: "cost", label: "镜头成本" }]} /><Button disabled={!ready || !episodeId} loading={loadingKey === queryKey} icon={<RefreshCw className="size-3.5" />} onClick={() => setReload((n) => n + 1)}>刷新记录</Button></div>
        {failureMessage && <Alert showIcon type="error" title={failureMessage} description={value ? "保留上次读取的数据，当前状态可能已变化。" : "请稍后刷新。未确认提交的任务请使用原重试记录恢复。"} />}
        {notice && <p role="status" className="text-xs leading-6 text-muted-foreground">{notice}</p>}
        {value?.historyScope && <p className="text-xs leading-6 text-muted-foreground">{value.historyScope}</p>}
        {dirty && <p className="text-xs leading-6 text-muted-foreground">计划有未保存修改。任务和成本按账号已保存的镜头归属显示；先保存计划后再重试。</p>}
        <div className="grid grid-cols-2 gap-y-6 border-y border-border py-5 lg:grid-cols-4">{[{ label: "本集累计任务", value: summary?.taskCount.toString() }, { label: "已结算算力", value: summary && amount(summary.settledCredits) }, { label: "尚未结算的占用", value: summary && amount(summary.heldCredits) }, { label: "已退回算力", value: summary && amount(summary.refundedCredits) }].map((stat) => <div key={stat.label}><p className="text-2xl font-semibold tabular-nums">{stat.value ?? "—"}</p><p className="mt-2 text-xs text-muted-foreground">{stat.label}</p></div>)}</div>
        <div className="text-xs leading-6 text-muted-foreground"><p>记录已关联镜头的图片／视频及逐镜配音任务，历史独立保存。汇总覆盖本集已记录任务，不随分页和状态筛选变化；同一任务关联多个镜头时，本集总额只计算一次。</p><p>费用取自服务端扣退记录；未结算费用不计入已结算，未知费用不视为免费。AI 拆镜及未关联镜头的调用不计入这里。{summary && <>待结算 {summary.pendingTaskCount} 笔 · 费用未知 {summary.unknownTaskCount} 笔。</>}</p></div>
        {view === "queue" ? <>
            <div className="flex flex-wrap items-center justify-between gap-3"><Select aria-label="筛选任务状态" value={filter} onChange={(next) => { setFilter(next); setPage(1); setSelected([]); }} className="min-w-40" options={[{ value: "all", label: "全部任务" }, { value: "running", label: "等待／进行中" }, { value: "failed", label: "失败／待确认" }, { value: "billing", label: "待结算／补扣" }]} /><Button disabled={!selectedTasks.length || dirty} loading={working} icon={<RotateCcw className="size-3.5" />} onClick={() => void prepareRetry(selectedTasks)}>查看 {selectedTasks.length || "所选"} 项重试费用</Button></div>
            {tasks.length ? <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="w-10 px-4 py-3"><Checkbox aria-label="选择本页可重试任务" disabled={!eligible.length || working || dirty} checked={Boolean(eligible.length) && eligible.every((task) => selected.includes(task.recordId))} indeterminate={selectedTasks.length > 0 && selectedTasks.length < eligible.length} onChange={(event) => setSelected(event.target.checked ? eligible.map((task) => task.recordId) : [])} /></th>{["镜头／模型", "执行状态", "用量与结算", "创建时间", "操作"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{tasks.map((task) => <tr key={task.recordId} className="border-t border-border align-top">
                <td className="px-4 py-4"><Checkbox aria-label={`选择${title(task)}的失败任务`} disabled={!task.canRetry || working || dirty} checked={selected.includes(task.recordId)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, task.recordId] : ids.filter((id) => id !== task.recordId))} /></td>
                <td className="max-w-56 px-4 py-4"><p className="font-medium">{title(task)}</p><p className="mt-2 break-all text-muted-foreground">{task.model}</p><p className="mt-1 text-muted-foreground">{task.kind === "image" ? "图片" : task.kind === "audio" ? "配音" : "视频"}{task.attempt ? ` · 第 ${task.attempt} 次` : ""}</p></td>
                <td className="px-4 py-4"><p>{statusLabels[task.status] || task.status}</p>{task.dispatchStatus && task.dispatchStatus !== task.status && <p className="mt-2 text-muted-foreground">{statusLabels[task.dispatchStatus] || task.dispatchStatus}</p>}<p className="mt-2 text-muted-foreground">{billingLabels[task.billingStatus] || "费用未提供"}</p></td>
                <td className="px-4 py-4 tabular-nums"><p>预扣 {amount(task.reservedCredits)} · 实结 {amount(task.settledCredits)}</p><p className="mt-2 text-muted-foreground">扣入 {amount(task.chargedCredits)} · 退回 {amount(task.refundedCredits)}</p>{task.actualUnits != null ? <p className="mt-2 text-muted-foreground">{task.actualUnits.toLocaleString()} {task.billingUnit === "second" ? "秒" : "次"}</p> : task.actualInputTokens != null || task.actualOutputTokens != null ? <p className="mt-2 text-muted-foreground">输入 {task.actualInputTokens?.toLocaleString() ?? "未提供"} / 输出 {task.actualOutputTokens?.toLocaleString() ?? "未提供"} Token</p> : task.actualTokens != null && <p className="mt-2 text-muted-foreground">{task.actualTokens.toLocaleString()} Token</p>}</td>
                <td className="px-4 py-4 whitespace-nowrap text-muted-foreground">{new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                <td className="max-w-52 px-4 py-4"><div className="flex flex-wrap items-center gap-3">{task.kind === "audio" ? <span className="text-muted-foreground">在本镜头配音区处理</span> : <Link className="inline-flex items-center gap-1 hover:underline" href={`/canvas/${encodeURIComponent(task.canvasId)}?focusNodeId=${encodeURIComponent(task.nodeId)}`}>回画布<ExternalLink className="size-3" /></Link>}{task.canRetry && <Button type="link" size="small" className="!px-0" disabled={dirty || working} onClick={() => void prepareRetry([task])}>重试报价</Button>}</div>{!task.canRetry && task.retryReason && <p className="mt-2 leading-5 text-muted-foreground">{task.retryReason}</p>}</td>
            </tr>)}</tbody></table></div> : <div className="rounded-xl border border-dashed border-border p-12 text-center"><ListVideo className="mx-auto mb-3 size-7 text-muted-foreground" /><p className="text-sm">{loadingKey === queryKey ? "正在读取镜头任务…" : filter === "all" ? "本集还没有记录到生成任务" : "没有符合筛选条件的任务"}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">保存镜头绑定后，在画布生成图片或视频，任务会自动关联到这里。</p></div>}
            <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{value && `更新于 ${snapshot?.time} · 每 10 秒刷新`}</span><Pagination size="small" current={page} total={value?.total || 0} pageSize={30} showSizeChanger={false} disabled={working} onChange={(next) => { setPage(next); setSelected([]); }} /></div>
        </> : <>
            <p className="text-xs leading-6 text-muted-foreground">镜头成本包含其历次已记录生成，未采用的候选也会产生实际费用。共享任务会出现在各关联镜头下，不能直接相加镜头行作为本集总额；总额见上方。</p>
            {costRows.length ? <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr>{["镜头", "累计任务", "已结算", "待结算占用", "已退回", "待确认"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{costRows.map((cost) => <tr key={cost.shotId} className="border-t border-border"><td className="px-4 py-4 font-medium">{shots.find((shot) => shot.id === cost.shotId)?.title || cost.shotTitle}</td><td className="px-4 py-4">{cost.taskCount}</td><td className="px-4 py-4 tabular-nums">{amount(cost.settledCredits)}</td><td className="px-4 py-4 tabular-nums">{amount(cost.heldCredits)}</td><td className="px-4 py-4 tabular-nums">{amount(cost.refundedCredits)}</td><td className="px-4 py-4 text-muted-foreground">{cost.pendingTaskCount} 笔待结算 · {cost.unknownTaskCount} 笔费用未知</td></tr>)}</tbody></table></div> : <p className="py-12 text-center text-sm text-muted-foreground">镜头开始生成后，这里会按实际扣退记录汇总。</p>}
        </>}
        <Modal open={Boolean(retryItems)} title="确认镜头重试" width={640} onCancel={() => !working && setRetryItems(null)} mask={{ closable: false }} footer={<div className="flex flex-wrap items-center justify-end gap-2"><Button disabled={working} onClick={() => setRetryItems(null)}>{retryItems?.every((item) => item.done) ? "完成" : "暂不提交"}</Button>{retryItems?.some((item) => !item.done) && <Button type="primary" loading={working} disabled={dirty} onClick={() => void submitRetries()}>预扣 {amount(retryTotal / 100)} 算力并重试</Button>}</div>}>
            <div className="space-y-4 py-3"><p className="text-sm leading-7">将按原任务的提示词、参考素材和参数创建新任务。按当前价格重新预扣，任务结束后依据实际用量退补。</p><div className="max-h-80 space-y-3 overflow-y-auto">{retryItems?.map((item) => <div key={item.task.recordId} className="border-b border-border pb-3"><div className="flex justify-between gap-4"><span className="text-sm">{title(item.task)}</span><span className="shrink-0 text-sm tabular-nums">{item.done ? "已入队" : `预扣 ${amount(item.quote.reserveCredits)}`}</span></div><p className="mt-1 break-all text-xs text-muted-foreground">{item.quote.model}</p>{item.error && <p role="alert" className="mt-2 text-xs leading-6 text-destructive">{item.error}</p>}</div>)}</div><p className="text-xs leading-6 text-muted-foreground">逐项提交，遇到异常即停止，已入队任务继续运行。未确认结果会保留相同请求标识，再次提交不会新建另一笔。报价过期时返回列表重新查看费用。</p></div>
        </Modal>
    </section>;
}
