"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Input, Modal, Pagination, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clapperboard, FileText, Film, FolderOpen, Layers3, ListChecks, Plus, RefreshCw } from "lucide-react";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { getProductionOverview } from "@/services/api/production-overview";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, workspaceRoot } from "../canvas/stores/use-canvas-store";
import type { ProductionDocument } from "../canvas/lib/production-types";

const starts = [
    { id: "blank", title: "空白短剧", detail: "从第一集剧本开始，逐步建立场次、角色和镜头。", icon: FileText },
    { id: "story", title: "故事短片", detail: "先搭建开场、冲突与收束，再展开自己的故事。", icon: Clapperboard },
    { id: "product", title: "产品分镜", detail: "从使用场景、产品细节到核心卖点，组织一支短片。", icon: Layers3 },
] as const;
type Start = typeof starts[number]["id"];

export default function ProductionOverviewPage() {
    const router = useRouter(), { message } = App.useApp();
    const token = useUserStore((state) => state.token), userId = useUserStore((state) => state.user?.id), version = useUserStore((state) => state.sessionVersion);
    const ready = useUserStore((state) => state.isReady && !state.authError && Boolean(state.token && state.user?.id));
    const projects = useCanvasStore((state) => state.projects), hydrated = useCanvasStore((state) => state.hydrated), ownerId = useCanvasStore((state) => state.ownerId);
    const roots = hydrated && ownerId === userId ? projects.filter(workspaceRoot) : [];
    const [keyword, setKeyword] = useState(""), [page, setPage] = useState(1);
    const [create, setCreate] = useState<Start | "existing" | null>(null), [title, setTitle] = useState(""), [workspaceId, setWorkspaceId] = useState("");
    const [creating, setCreating] = useState(false), lock = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const [drafts, setDrafts] = useState<{ scope: string; items: { workspaceId: string; title: string }[] } | null>(null);
    const scope = `${userId}:${version}`;
    const overview = useQuery({ queryKey: ["production-overview", scope, keyword, page], queryFn: () => getProductionOverview(token, { keyword, page, pageSize: 12 }), enabled: ready, staleTime: 15000 });
    const current = () => { const state = useUserStore.getState(); return mounted.current && state.token === token && state.sessionVersion === version && state.user?.id === userId && !state.authError; };
    useEffect(() => { setCreate(null); setTitle(""); setWorkspaceId(""); setPage(1); setCreating(false); }, [scope]);
    useEffect(() => {
        let active = true;
        if (!hydrated || ownerId !== userId || !userId) return;
        void Promise.all(roots.map(async (root) => {
            const draft = await localforage.getItem<{ dirty: boolean; document: ProductionDocument }>(`production-draft:${userId}:${root.id}`);
            return draft?.dirty && !draft.document.id && draft.document.workspaceId === root.id ? { workspaceId: root.id, title: draft.document.title } : null;
        })).then((items) => { if (active && current()) setDrafts({ scope, items: items.filter((item) => item !== null) }); }).catch(() => { if (active && current()) void message.warning("本机草稿暂时无法读取，请从我的项目继续打开原项目"); });
        return () => { active = false; };
    }, [scope, hydrated, ownerId, projects]);
    useEffect(() => { if (overview.data && page > Math.max(1, Math.ceil(overview.data.total / 12))) setPage(Math.max(1, Math.ceil(overview.data.total / 12))); }, [overview.data, page]);
    const begin = async () => {
        if (!current() || lock.current || !create || !hydrated || ownerId !== userId) return;
        if (create === "existing") { if (workspaceId) { setCreate(null); router.push(`/canvas/project/${encodeURIComponent(workspaceId)}/production?tab=script`); } return; }
        lock.current = true; setCreating(true);
        let id = "";
        try {
            const projectTitle = title.trim() || starts.find((item) => item.id === create)!.title;
            id = useCanvasStore.getState().createProject("画布 1", { workspaceTitle: projectTitle });
            const episodeId = nanoid(), stamp = new Date().toISOString();
            const sceneTitles = create === "story" ? ["开场：建立人物与处境", "冲突：让故事发生", "收束：留下最后一幕"] : create === "product" ? ["使用场景", "产品细节", "核心卖点与收尾"] : [];
            const document: ProductionDocument = { id: "", workspaceId: id, title: projectTitle, synopsis: "", styleGuide: "", revision: 0, createdAt: stamp, updatedAt: stamp, episodes: [{ id: episodeId, title: "第 1 集", script: "", order: 0 }], scenes: sceneTitles.map((name, order) => ({ id: nanoid(), episodeId, title: name, description: "", order })), assets: [], shots: [] };
            await localforage.setItem(`production-draft:${userId}:${id}`, { document, dirty: true });
            if (!current()) return;
            setCreate(null); router.push(`/canvas/project/${id}/production?tab=script`);
        } catch (error) {
            if (current()) { void message.error(id ? "项目已经创建，制作草稿保存失败。请在原项目启用制作计划，避免重复创建。" : error instanceof Error ? error.message : "项目创建失败"); if (id) { setCreate(null); router.push(`/canvas/project/${id}/production`); } }
        } finally { lock.current = false; if (current()) setCreating(false); }
    };
    const pendingDrafts = drafts?.scope === scope ? drafts.items : [];
    return <main className="h-full overflow-y-auto"><div className="mx-auto max-w-[1320px] px-5 py-7 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs text-muted-foreground">从一集剧本，到一部作品</p><h1 className="text-3xl font-semibold tracking-tight">短剧制作</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">剧本、资产设定、镜头生产和成片交付，在同一项目继续。每个阶段都可以单独打开。</p></div><Button icon={<FolderOpen className="size-4" />} disabled={!roots.length} onClick={() => { setWorkspaceId(""); setCreate("existing"); }}>从已有项目开始</Button></header>
        <section aria-label="新建制作项目" className="my-7 grid gap-3 md:grid-cols-3">{starts.map(({ id, title: name, detail, icon: Icon }) => <button type="button" key={id} disabled={!hydrated || ownerId !== userId} onClick={() => { setTitle(""); setCreate(id); }} className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left transition hover:border-foreground/40 disabled:opacity-50"><Icon className="mt-1 size-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><strong className="block text-sm font-semibold">{name}</strong><span className="mt-2 block text-xs leading-6 text-muted-foreground">{detail}</span></span><Plus className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" /></button>)}</section>
        <div className="mb-7 flex flex-wrap gap-5 border-y border-border py-4 text-xs"><Link href="/tasks" className="inline-flex items-center gap-2 hover:text-primary"><ListChecks className="size-4" />全局任务中心<ArrowRight className="size-3" /></Link><Link href="/deliveries" className="inline-flex items-center gap-2 hover:text-primary"><Film className="size-4" />我的成片<ArrowRight className="size-3" /></Link><Link href="/canvas/teams" className="text-muted-foreground hover:text-foreground">团队协作与审片 →</Link></div>
        {pendingDrafts.length > 0 && <section aria-label="本机待保存制作" className="mb-7 rounded-xl bg-muted/50 p-4"><h2 className="mb-3 text-sm font-medium">本机待保存</h2><div className="flex flex-wrap gap-3">{pendingDrafts.map((item) => <Link key={item.workspaceId} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm" href={`/canvas/project/${item.workspaceId}/production`}>{item.title}<ArrowRight className="size-3.5" /></Link>)}</div><p className="mt-3 text-xs text-muted-foreground">这些草稿保存在当前浏览器，进入项目保存后加入账号制作列表。</p></section>}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">账号制作计划 <span className="ml-1 text-xs font-normal text-muted-foreground">{overview.data?.total ?? ""}</span></h2><div className="flex gap-2"><Input.Search allowClear placeholder="搜索制作计划" aria-label="搜索制作计划" className="max-w-64" onSearch={(value) => { setKeyword(value.trim()); setPage(1); }} /><Button aria-label="刷新制作列表" icon={<RefreshCw className="size-4" />} loading={overview.isFetching} onClick={() => void overview.refetch()} /></div></div>
        {overview.isError ? <Alert type="error" showIcon title={overview.error.message} description="本机项目与草稿仍保留，可以从我的项目继续。" /> : overview.isPending ? <p className="py-12 text-sm text-muted-foreground">正在读取制作计划…</p> : !overview.data.items.length ? <section className="rounded-2xl border border-dashed border-border px-6 py-14 text-center"><Clapperboard className="mx-auto mb-4 size-8 text-muted-foreground" /><h3 className="font-medium">{keyword ? "没有匹配的制作计划" : "从第一集开始制作"}</h3><p className="mt-3 text-sm text-muted-foreground">{keyword ? "试试其他名称，或清空搜索。" : "在上方选择创作起点，或者把已有画布项目加入制作流程。"}</p></section> : <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{overview.data.items.map((item) => <article key={item.id} className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5"><div className="mb-4 flex items-center justify-between text-xs text-muted-foreground"><span>{item.episodeCount} 集 · {item.shotCount} 镜头</span><span>版本 {item.revision}</span></div><Link className="truncate text-lg font-semibold hover:underline" href={`/canvas/project/${item.workspaceId}/production`}>{item.title}</Link><p className="mt-3 line-clamp-2 min-h-12 text-xs leading-6 text-muted-foreground">{item.synopsis || "继续完善故事概述、剧本与统一视觉风格。"}</p><div className="my-5 grid grid-cols-3 gap-2 border-y border-border py-4 text-xs text-muted-foreground"><span><strong className="mb-1 block text-lg font-medium text-foreground">{item.assetCount}</strong>资产设定</span><span><strong className="mb-1 block text-lg font-medium text-foreground">{item.selectedShotCount}/{item.shotCount}</strong>已选候选</span><span><strong className="mb-1 block text-lg font-medium text-foreground">{item.renderCount}</strong>合成完成</span></div><nav className="grid grid-cols-4 gap-1 text-center text-xs" aria-label={`${item.title}制作阶段`}>{[["script", "剧本"], ["shots", "镜头"], ["tasks", "任务"], ["delivery", "交付"]].map(([tab, label]) => <Link key={tab} className="rounded-lg py-2.5 hover:bg-muted" href={`/canvas/project/${item.workspaceId}/production?tab=${tab}`}>{label}</Link>)}</nav><time className="mt-4 text-[11px] text-muted-foreground" dateTime={item.updatedAt}>更新于 {new Date(item.updatedAt).toLocaleString("zh-CN")}</time></article>)}</section>}
        <Pagination className="mt-7" current={page} pageSize={12} total={overview.data?.total || 0} onChange={setPage} hideOnSinglePage showSizeChanger={false} />
        <Modal title={create === "existing" ? "选择已有项目" : `新建${starts.find((item) => item.id === create)?.title || "制作项目"}`} open={Boolean(create)} onCancel={() => { if (!creating) setCreate(null); }} onOk={() => void begin()} okText="进入制作" cancelText="取消" confirmLoading={creating} okButtonProps={{ disabled: !hydrated || ownerId !== userId || (create === "existing" && !workspaceId) }} maskClosable={!creating} closable={!creating} keyboard={!creating} cancelButtonProps={{ disabled: creating }}>
            <p className="mb-5 text-sm leading-6 text-muted-foreground">{create === "existing" ? "已有制作计划会直接继续；尚未启用的项目可在下一页建立计划。" : "创建第一集与空白画布。剧本和设定先保存在本机，点击“保存计划”同步到账号；创建不会调用模型。"}</p>
            {create === "existing" ? <Select className="w-full" showSearch optionFilterProp="label" aria-label="选择项目" placeholder="选择一个项目" value={workspaceId || undefined} onChange={setWorkspaceId} options={roots.map((root) => ({ value: root.id, label: root.workspaceTitle || root.title }))} /> : <Input autoFocus aria-label="制作项目名称" placeholder="给这部作品起个名字" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} onPressEnter={() => void begin()} />}
        </Modal>
    </div></main>;
}
