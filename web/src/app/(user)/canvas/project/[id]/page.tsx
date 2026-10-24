"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Input } from "antd";
import { ArrowLeft, Check, Download, Layers3, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import { CanvasDeleteProjectsDialog } from "../../components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "../../components/canvas-project-card";
import { CanvasLoadError } from "../../components/canvas-load-error";
import { useCanvasStore, workspaceCanvases } from "../../stores/use-canvas-store";
import { useCanvasUiStore } from "../../stores/use-canvas-ui-store";
import { useCanvasExport } from "../../hooks/use-canvas-export";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const exportProjects = useCanvasExport();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const loadError = useCanvasStore((state) => state.loadError);
    const projects = useCanvasStore((state) => state.projects);
    const createCanvas = useCanvasStore((state) => state.createProject);
    const renameWorkspace = useCanvasStore((state) => state.renameWorkspace);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const clearSelection = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const root = projects.find((item) => item.id === id && !item.workspaceId);
    const canvases = workspaceCanvases(projects, id).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds).filter((itemId) => canvases.some((canvas) => canvas.id === itemId));
    const title = root?.workspaceTitle || root?.title || "项目";
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState("updated");
    const visible = canvases.filter((canvas) => canvas.title.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : sort === "created" ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const canDeleteSelection = !selectedIds.includes(id) || canvases.length === 1;

    useEffect(() => { if (hydrated && !root) router.replace("/canvas"); }, [hydrated, root, router]);

    const createAndEnter = () => {
        if (!root) return;
        const nextNumber = canvases.length + 1;
        const canvasId = createCanvas(`画布 ${nextNumber}`, { workspaceId: id });
        router.push(`/canvas/${canvasId}`);
    };
    const saveTitle = () => { renameWorkspace(id, draft); setEditing(false); };

    if (loadError) return <CanvasLoadError />;
    return <>
        <main className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1320px] px-5 py-8 sm:px-8 lg:px-10">
            <Link href="/canvas" className="mb-7 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-primary"><ArrowLeft className="size-3.5" />返回我的项目</Link>
            {!hydrated || !root ? <div className="py-24 text-sm text-muted-foreground">正在读取项目...</div> : <>
                <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-7">
                    <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                        <p className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Layers3 className="size-3.5" />项目空间</p>
                        {editing ? <div className="flex max-w-xl items-center gap-2"><Input autoFocus className="h-10 rounded-xl" aria-label="项目名称" maxLength={80} value={draft} onChange={(event) => setDraft(event.target.value)} onPressEnter={saveTitle} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }} /><Button className="h-10 rounded-xl" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存项目名" /><Button className="h-10 rounded-xl" icon={<X className="size-4" />} onClick={() => setEditing(false)} aria-label="取消" /></div> : <h1 className="truncate text-[28px] font-semibold tracking-tight">{title}</h1>}
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{canvases.length} 张画布<span className="mx-2 text-border">/</span>最近修改 {new Date(canvases[0]?.updatedAt || root.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</p>
                    </div>
                    <div className="flex items-center gap-2"><Button className="h-10 rounded-xl" onClick={() => router.push(`/canvas/project/${id}/production`)}>短剧制作</Button><Button type="primary" className="h-10 rounded-xl px-5" icon={<Plus className="size-4" />} onClick={createAndEnter}>新建画布</Button><Dropdown trigger={["click"]} menu={{ items: [
                        { key: "rename", label: "重命名项目", icon: <Pencil className="size-4" />, onClick: () => { setDraft(title); setEditing(true); } },
                        { key: "export", label: "完整项目包 ZIP（含计划与素材）", icon: <Download className="size-4" />, onClick: () => void exportProjects(canvases, title) },
                        { type: "divider" },
                        { key: "delete", label: "删除项目及全部画布", danger: true, icon: <Trash2 className="size-4" />, onClick: () => setDeleteIds([id]) },
                    ] }}><Button className="h-10 rounded-xl" icon={<MoreHorizontal className="size-4" />} aria-label="项目更多操作" /></Dropdown></div>
                </div>
                <div className="mb-6 mt-7 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-medium"><Layers3 className="size-4 text-muted-foreground" />全部画布<span className="ml-1 text-xs font-normal text-muted-foreground">{canvases.length}</span></h2><div className="flex flex-wrap items-center gap-2"><label className="flex h-10 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 text-muted-foreground transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/15"><Search className="size-4 shrink-0" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索画布" aria-label="搜索画布" className="w-32 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground sm:w-40" /></label><select aria-label="画布排序" value={sort} onChange={(event) => setSort(event.target.value)} className="h-10 rounded-xl border border-border/70 bg-card px-3 text-sm text-muted-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring/15"><option value="updated">最近修改</option><option value="created">最近创建</option><option value="name">画布名称</option></select></div></div>
                {selectedIds.length ? <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-primary/15 bg-accent px-4 py-3"><span className="mr-auto text-xs text-accent-foreground">已选 {selectedIds.length} 张{canDeleteSelection ? "" : " · 首张画布随项目保留"}</span><Button size="small" onClick={() => void exportProjects(canvases.filter((canvas) => selectedIds.includes(canvas.id)), `${title}-选中画布`)}>导出选中</Button><Button size="small" danger disabled={!canDeleteSelection} onClick={() => setDeleteIds(selectedIds)}>删除选中</Button><Button type="text" size="small" onClick={() => clearSelection(selectedIds)}>取消选择</Button></div> : null}
                {visible.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{visible.map((canvas) => <CanvasProjectCard key={canvas.id} project={canvas} />)}</div> : <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-border/70 bg-card px-6 text-center"><span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent text-primary"><Search className="size-6" /></span><h3 className="text-base font-medium">没有找到匹配的画布</h3><p className="mt-2 text-sm text-muted-foreground">换一个名称试试，或查看项目中的全部画布。</p><Button className="mt-5 rounded-xl" onClick={() => setQuery("")}>清除搜索</Button></div>}
            </>}
        </div>
        </main>
        <CanvasDeleteProjectsDialog />
    </>;
}
