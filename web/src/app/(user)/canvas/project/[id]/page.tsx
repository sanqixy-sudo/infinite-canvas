"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Input } from "antd";
import { ArrowLeft, Check, Download, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import { CanvasDeleteProjectsDialog } from "../../components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "../../components/canvas-project-card";
import { useCanvasStore, workspaceCanvases } from "../../stores/use-canvas-store";
import { useCanvasUiStore } from "../../stores/use-canvas-ui-store";
import { useCanvasExport } from "../../hooks/use-canvas-export";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const exportProjects = useCanvasExport();
    const hydrated = useCanvasStore((state) => state.hydrated);
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

    return <>
        <main className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
            <Link href="/canvas" className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />我的项目</Link>
            {!hydrated || !root ? <div className="py-24 text-sm text-muted-foreground">正在读取项目...</div> : <>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
                    <div className="min-w-0 flex-1">
                        {editing ? <div className="flex max-w-xl items-center gap-2"><Input autoFocus maxLength={80} value={draft} onChange={(event) => setDraft(event.target.value)} onPressEnter={saveTitle} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }} /><Button icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存项目名" /><Button icon={<X className="size-4" />} onClick={() => setEditing(false)} aria-label="取消" /></div> : <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>}
                        <p className="mt-2 text-sm text-muted-foreground">{canvases.length} 张画布 · 最近修改 {new Date(canvases[0]?.updatedAt || root.updatedAt).toLocaleDateString("zh-CN")}</p>
                    </div>
                    <div className="flex items-center gap-2"><Button type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>新建画布</Button><Dropdown trigger={["click"]} menu={{ items: [
                        { key: "rename", label: "重命名项目", icon: <Pencil className="size-4" />, onClick: () => { setDraft(title); setEditing(true); } },
                        { key: "export", label: "导出整个项目", icon: <Download className="size-4" />, onClick: () => void exportProjects(canvases, title) },
                        { type: "divider" },
                        { key: "delete", label: "删除项目及全部画布", danger: true, icon: <Trash2 className="size-4" />, onClick: () => setDeleteIds([id]) },
                    ] }}><Button icon={<MoreHorizontal className="size-4" />} aria-label="项目更多操作" /></Dropdown></div>
                </div>
                <div className="mb-5 mt-6 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-medium">全部画布 <span className="ml-1 text-muted-foreground">{canvases.length}</span></h2><div className="flex flex-wrap items-center gap-3"><label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"><Search className="size-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索画布" aria-label="搜索画布" className="w-32 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground sm:w-40" /></label><select aria-label="画布排序" value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-xs text-muted-foreground"><option value="updated">最近修改</option><option value="created">最近创建</option><option value="name">画布名称</option></select></div></div>
                {selectedIds.length ? <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2"><span className="mr-auto text-xs text-muted-foreground">已选 {selectedIds.length} 张{canDeleteSelection ? "" : " · 首张画布随项目保留"}</span><Button size="small" onClick={() => void exportProjects(canvases.filter((canvas) => selectedIds.includes(canvas.id)), `${title}-选中画布`)}>导出选中</Button><Button size="small" danger disabled={!canDeleteSelection} onClick={() => setDeleteIds(selectedIds)}>删除选中</Button><Button type="text" size="small" onClick={() => clearSelection(selectedIds)}>取消选择</Button></div> : null}
                {visible.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{visible.map((canvas) => <CanvasProjectCard key={canvas.id} project={canvas} />)}{!query && <button type="button" onClick={createAndEnter} className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition hover:border-foreground/50 hover:bg-muted/40 hover:text-foreground"><Plus className="mb-3 size-6" /><span className="text-sm font-medium">新建画布</span></button>}</div> : <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border text-center"><p className="text-sm text-muted-foreground">没有找到匹配的画布</p><Button type="text" className="mt-3" onClick={() => setQuery("")}>清除搜索</Button></div>}
            </>}
        </div>
        </main>
        <CanvasDeleteProjectsDialog />
    </>;
}
