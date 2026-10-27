"use client";

import { Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Modal } from "antd";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, Clock3, HardDrive, RefreshCw, Wallet } from "lucide-react";

import { invalidateAccountWallet, useAccountWallet } from "@/hooks/use-account-wallet";
import { cn } from "@/lib/utils";
import { formatCredits, formatPrice, formatStorageBytes, formatStoragePlanBytes, orderStatusLabels } from "@/lib/wallet-display";
import { ApiError } from "@/services/api/request";
import { cancelPurchaseOrder, createPurchaseOrder, fetchPurchaseOrders, type CommercePlan, type OrderStatus, type PurchaseOrder } from "@/services/api/commerce";
import { useUserStore } from "@/stores/use-user-store";

const statusOptions: { value: OrderStatus | ""; label: string }[] = [{ value: "", label: "全部状态" }, ...Object.entries(orderStatusLabels).map(([value, label]) => ({ value: value as OrderStatus, label }))];
const pageSize = 10;
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40";

export default function RechargePage() {
    return <Suspense fallback={<main className="p-6 text-sm text-muted-foreground">正在打开钱包…</main>}><RechargeContent /></Suspense>;
}

function RechargeContent() {
    const params = useSearchParams();
    const kind = params.get("kind") === "storage" ? "storage" : "credits";
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const wallet = useAccountWallet();
    const client = useQueryClient();
    const { message, modal } = App.useApp();
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<OrderStatus | "">("");
    const [selection, setSelection] = useState<{ plan: CommercePlan; requestId: string; token: string } | null>(null);
    const [submitted, setSubmitted] = useState<PurchaseOrder | null>(null);
    const orders = useQuery({
        queryKey: ["purchase-orders", token, kind, status, page],
        queryFn: () => fetchPurchaseOrders(token, { page, pageSize, kind, status }),
        enabled: Boolean(isReady && token && user),
        refetchOnWindowFocus: true,
    });
    const refresh = () => Promise.all([
        invalidateAccountWallet(client, token),
        client.invalidateQueries({ queryKey: ["purchase-orders", token] }),
        client.invalidateQueries({ queryKey: ["account", "credits", token] }),
    ]);
    const submit = useMutation({
        mutationFn: (input: { planId: string; requestId: string; confirmation: string; sessionToken: string }) => createPurchaseOrder(input.sessionToken, { planId: input.planId, requestId: input.requestId, confirmation: input.confirmation }),
        onSuccess: async (order, input) => {
            if (useUserStore.getState().token !== input.sessionToken) return;
            setSubmitted(order);
            setSelection(null);
            setPage(1);
            await refresh();
        },
    });
    const cancel = useMutation({
        mutationFn: (input: { id: string; sessionToken: string }) => cancelPurchaseOrder(input.sessionToken, input.id),
        onSuccess: async (order, input) => {
            if (useUserStore.getState().token !== input.sessionToken) return;
            setSubmitted((current) => current?.id === order.id ? order : current);
            await refresh();
            message.success("申请已取消");
        },
        onError: (error, input) => {
            if (useUserStore.getState().token !== input.sessionToken) return;
            void client.invalidateQueries({ queryKey: ["purchase-orders", input.sessionToken] });
            message.error(error instanceof Error ? error.message : "取消失败，请刷新申请记录");
        },
    });

    if (!isReady) return <main className="p-6 text-sm text-muted-foreground">正在读取账户…</main>;
    if (!token || !user) return <main className="flex h-full items-center justify-center p-6"><div className="max-w-sm text-center"><Wallet className="mx-auto size-9 text-muted-foreground" /><h1 className="mt-5 text-2xl font-semibold">开通你的创作空间</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">登录后可申请算力充值与个人空间扩容。访客项目和素材继续保存在当前浏览器。</p><Link href={`/login?redirect=${encodeURIComponent(`/account/recharge?kind=${kind}`)}`} className={buttonClass + " mt-6 border-transparent bg-primary text-primary-foreground hover:bg-primary/90"}>登录账户</Link></div></main>;

    const commerce = wallet.data?.commerce;
    const plans = commerce?.plans.filter((plan) => plan.enabled && plan.kind === kind) || [];
    const total = orders.data?.total || 0;
    const storage = wallet.data?.storage;
    const isStorage = kind === "storage";
    const activeSelection = selection?.token === token ? selection : null;
    const submittedOrder = submitted?.userId === user.id && submitted.kind === kind ? submitted : null;
    const activeSubmitted = orders.data?.items.find((order) => order.id === submittedOrder?.id) || submittedOrder;
    const planChanged = submit.error instanceof ApiError && submit.error.status === 409;
    const confirmSelection = async () => {
        if (!activeSelection || submit.isPending || wallet.isFetching) return;
        if (planChanged) {
            const refreshed = await wallet.refetch();
            if (useUserStore.getState().token !== activeSelection.token) return;
            if (refreshed.isError) { message.error("套餐刷新失败，请稍后重试"); return; }
            setSelection(null);
            submit.reset();
            message.info("套餐已刷新，请重新选择并确认金额和权益");
            return;
        }
        submit.mutate({ planId: activeSelection.plan.id, requestId: activeSelection.requestId, confirmation: activeSelection.plan.confirmation || "", sessionToken: activeSelection.token });
    };

    return <main className="h-full overflow-y-auto px-5 py-7 md:px-9 md:py-9"><div className="mx-auto max-w-5xl">
        <Link href="/account" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-3.5" />返回个人中心</Link>
        <header className="mt-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-muted-foreground">我的钱包</p><h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">为下一次创作做好准备</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">选择套餐并提交申请，由管理员人工确认后入账。</p></div><button type="button" className={buttonClass} disabled={wallet.isFetching || orders.isFetching} onClick={() => { void wallet.refetch(); void orders.refetch(); }}><RefreshCw className={`size-4 ${wallet.isFetching || orders.isFetching ? "animate-spin" : ""}`} />刷新状态</button></header>
        <div className="mt-7 flex flex-wrap gap-x-7 gap-y-3 border-y border-border py-4 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Wallet className="size-4" />当前算力 <strong className="font-medium tabular-nums text-foreground">{wallet.data ? formatCredits(wallet.data.credits) : "—"}</strong></span><span className="flex items-center gap-2"><HardDrive className="size-4" />个人空间 <strong className="font-medium tabular-nums text-foreground">{storage ? `${formatStorageBytes(storage.usedBytes)} / ${formatStoragePlanBytes(storage.limitBytes)}` : "—"}</strong></span></div>
        <nav className="mt-7 flex gap-6 border-b border-border" aria-label="充值与扩容">{([{ key: "credits", label: "算力充值", Icon: Wallet }, { key: "storage", label: "存储扩容", Icon: HardDrive }] as const).map(({ key, label, Icon }) => <Link key={key} href={`/account/recharge?kind=${key}`} onClick={() => { setPage(1); setSubmitted(null); }} aria-current={kind === key ? "page" : undefined} className={cn("inline-flex min-h-12 items-center gap-2 border-b-2 px-1 pb-3 text-sm transition", kind === key ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><Icon className="size-4" />{label}</Link>)}</nav>
        {activeSubmitted ? <section role="status" className="mt-6 rounded-xl border border-border bg-card p-5"><div className="flex items-start gap-3">{activeSubmitted.status === "completed" ? <Check className="mt-0.5 size-4 shrink-0" /> : <Clock3 className="mt-0.5 size-4 shrink-0" />}<div className="min-w-0"><h2 className="text-sm font-medium">{activeSubmitted.status === "pending" ? "申请已提交" : orderStatusLabels[activeSubmitted.status]}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{activeSubmitted.status === "pending" ? "申请已创建，请在下方查看最新状态并按说明联系管理员。提交申请不会自动付款或立即到账。" : "请在申请记录中查看最新结果，余额与空间以钱包实际记录为准。"}</p><p className="mt-2 break-all text-xs text-muted-foreground">申请编号：{activeSubmitted.id}</p></div></div></section> : null}
        {wallet.isError ? <div role="alert" className="mt-6 rounded-xl border border-destructive/30 p-5 text-sm text-destructive">{wallet.error instanceof Error ? wallet.error.message : "套餐读取失败"}。请刷新重试。</div> : wallet.isPending ? <p className="py-12 text-center text-sm text-muted-foreground">正在读取可用套餐…</p> : !plans.length ? <section className="my-7 rounded-2xl border border-dashed border-border px-6 py-12 text-center"><h2 className="font-medium">暂未开放{isStorage ? "扩容" : "充值"}套餐</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">管理员配置后，套餐会显示在这里。现有余额与空间不受影响。</p></section> : <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={isStorage ? "存储扩容套餐" : "算力充值套餐"}>{plans.map((plan) => <article key={plan.id} className="flex flex-col rounded-2xl border border-border bg-card p-6 transition hover:border-foreground/30"><p className="text-sm font-medium">{plan.name}</p><div className="mb-2 mt-6 flex flex-wrap items-baseline gap-2"><strong className="text-3xl font-semibold tracking-tight tabular-nums">{isStorage ? formatStoragePlanBytes(plan.storageBytes) : formatCredits(plan.credits)}</strong><span className="text-xs text-muted-foreground">{isStorage ? "新增个人空间" : "算力点"}</span></div><p className="min-h-12 flex-1 whitespace-pre-line break-words text-xs leading-6 text-muted-foreground">{plan.description || (isStorage ? "确认后增加个人总空间，可与已有扩容叠加。" : "确认后计入账号余额，可用于平台模型创作。")}</p><div className="mt-5 flex items-center justify-between border-t border-border pt-5"><span className="text-xl font-semibold tabular-nums">{formatPrice(plan.priceCents)}</span><button type="button" className={buttonClass + " border-transparent bg-primary text-primary-foreground hover:bg-primary/90"} disabled={submit.isPending} onClick={() => { submit.reset(); setSelection({ plan, requestId: crypto.randomUUID(), token }); }}>提交申请<ArrowUpRight className="size-3.5" /></button></div></article>)}</section>}
        <section className="mt-7 rounded-xl border border-border bg-muted/30 p-5" aria-label="人工确认说明"><h2 className="text-sm font-medium">申请与到账说明</h2><p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">{commerce?.instructions || "当前采用人工确认。提交申请后，请联系管理员核对套餐与付款安排；审核完成后才会增加对应算力或个人空间。请勿重复提交同一笔申请。"}</p>{commerce?.contactText ? <p className="mt-3 whitespace-pre-line break-words text-sm leading-6">{commerce.contactText}</p> : <p className="mt-3 text-xs text-muted-foreground">联系信息尚未配置，请通过你已有的服务联系渠道咨询管理员。</p>}</section>
        <section id="orders" className="mt-9 scroll-mt-6 pb-6" aria-label="申请记录"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{isStorage ? "扩容" : "充值"}申请记录</h2><label className="flex items-center gap-2 text-xs text-muted-foreground">状态<select aria-label="筛选申请状态" value={status} onChange={(event) => { setStatus(event.target.value as OrderStatus | ""); setPage(1); }} className="min-h-9 rounded-lg border border-border bg-card px-3 text-foreground">{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
            {orders.isError ? <p role="alert" className="mt-4 rounded-xl border border-destructive/30 p-5 text-sm text-destructive">{orders.error instanceof Error ? orders.error.message : "申请记录读取失败"}。请刷新重试。</p> : <div className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-busy={orders.isFetching}>{orders.isPending ? <p className="p-8 text-center text-sm text-muted-foreground">正在读取申请…</p> : !orders.data?.items.length ? <p className="p-10 text-center text-sm text-muted-foreground">暂无符合条件的申请</p> : orders.data.items.map((order) => <article key={order.id} className="flex flex-wrap items-start justify-between gap-4 p-5"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{order.planName}</h3><span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{orderStatusLabels[order.status]}</span></div><p className="mt-2 text-xs tabular-nums text-muted-foreground">{formatPrice(order.priceCents)} · {order.kind === "credits" ? `${formatCredits(order.credits)} 算力点` : `${formatStoragePlanBytes(order.storageBytes)} 个人空间`}</p><p className="mt-2 break-all text-[11px] leading-5 text-muted-foreground">{order.createdAt ? new Date(order.createdAt).toLocaleString("zh-CN", { hour12: false }) : "—"} · {order.id}</p>{order.reviewRemark ? <p className="mt-2 whitespace-pre-line break-words text-xs leading-5">审核说明：{order.reviewRemark}</p> : null}</div>{order.status === "pending" ? <button type="button" className={buttonClass + " min-h-9 px-3 text-xs"} disabled={cancel.isPending} onClick={() => modal.confirm({ title: "取消这笔申请？", content: "取消后本次申请将停止审核。如仍需购买，可以重新申请。", okText: "取消申请", cancelText: "保留申请", onOk: () => cancel.mutateAsync({ id: order.id, sessionToken: token }) })}>{cancel.isPending && cancel.variables?.id === order.id ? "正在取消…" : "取消申请"}</button> : null}</article>)}</div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>共 {total} 条 · 每页 {pageSize} 条</span><div className="flex items-center gap-3"><button type="button" aria-label="上一页申请" disabled={page === 1 || orders.isFetching} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-35"><ChevronLeft className="size-4" /></button><span>第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页</span><button type="button" aria-label="下一页申请" disabled={page * pageSize >= total || orders.isFetching} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-35"><ChevronRight className="size-4" /></button></div></div>
        </section>
        <Modal title="确认提交申请" open={Boolean(activeSelection)} confirmLoading={submit.isPending} closable={!submit.isPending} keyboard={!submit.isPending} mask={{ closable: !submit.isPending }} okText={planChanged ? "刷新套餐，重新选择" : submit.isError ? "重试提交" : "提交申请"} okButtonProps={{ disabled: wallet.isFetching }} cancelText="再考虑一下" cancelButtonProps={{ disabled: submit.isPending }} onCancel={() => { if (!submit.isPending) setSelection(null); }} onOk={() => void confirmSelection()}>
            {activeSelection ? <div className="space-y-4 py-3"><p className="text-sm font-medium">{activeSelection.plan.name}</p><p className="text-sm text-muted-foreground">套餐金额 {formatPrice(activeSelection.plan.priceCents)}，包含{activeSelection.plan.kind === "storage" ? `${formatStoragePlanBytes(activeSelection.plan.storageBytes)} 个人空间` : `${formatCredits(activeSelection.plan.credits)} 算力点`}。</p><p className="text-sm leading-6 text-muted-foreground">这一步仅创建待人工确认的申请，不会自动付款或立即到账。管理员确认后，结果会显示在申请记录中。</p>{submit.isError ? <p role="alert" className="text-sm leading-6 text-destructive">{submit.error instanceof Error ? submit.error.message : "提交失败"}{planChanged ? "。本次未创建申请，请刷新套餐后重新确认。" : "。可以使用本次申请重试；也可先刷新记录，确认是否已创建。"}</p> : null}</div> : null}
        </Modal>
    </div></main>;
}
