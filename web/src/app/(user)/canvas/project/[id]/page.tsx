"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input } from "antd";
import { ArrowLeft, Check, Download, Layers3, Pencil, Plus, Trash2, X } from "lucide-react";

import { CanvasDeleteProjectsDialog } from "../../components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "../../components/canvas-project-card";
import { WorkspaceShell } from "../../components/workspace-shell";
import { useCanvasStore, workspaceCanvases } from "../../stores/use-canvas-store";
import { useCanvasUiStore } from "../../stores/use-canvas-ui-store";
import { exportCanvasProjects } from "../../utils/canvas-export";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createCanvas = useCanvasStore((state) => state.createProject);
    const renameWorkspace = useCanvasStore((state) => state.renameWorkspace);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const root = projects.find((item) => item.id === id && !item.workspaceId);
    const canvases = workspaceCanvases(projects, id).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds).filter((itemId) => canvases.some((canvas) => canvas.id === itemId));
    const title = root?.workspaceTitle || root?.title || "项目";
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");

    useEffect(() => { if (hydrated && !root) router.replace("/canvas"); }, [hydrated, root, router]);

    const createAndEnter = () => {
        if (!root) return;
        const nextNumber = canvases.length + 1;
        const canvasId = createCanvas(`画布 ${nextNumber}`, { workspaceId: id });
        router.push(`/canvas/${canvasId}`);
    };
    const saveTitle = () => { renameWorkspace(id, draft); setEditing(false); };

    return <WorkspaceShell>
        <main className="mx-auto max-w-[1460px] px-5 py-8 md:px-10 md:py-12">
            <Link href="/canvas" className="mb-10 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" />返回项目</Link>
            {!hydrated || !root ? <div className="py-24 text-sm text-muted-foreground">正在读取项目...</div> : <>
                <div className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-8">
                    <div className="min-w-0 flex-1"><p className="mb-3 text-[11px] font-semibold tracking-[0.22em] text-muted-foreground">PROJECT / {id.slice(0, 6).toUpperCase()}</p>
                        {editing ? <div className="flex max-w-xl items-center gap-2"><Input autoFocus size="large" maxLength={80} value={draft} onChange={(event) => setDraft(event.target.value)} onPressEnter={saveTitle} /><Button icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存项目名" /><Button icon={<X className="size-4" />} onClick={() => setEditing(false)} aria-label="取消" /></div> : <div className="flex items-center gap-3"><h1 className="min-w-0 truncate text-4xl font-semibold tracking-[-0.05em] md:text-5xl">{title}</h1><Button type="text" icon={<Pencil className="size-4" />} onClick={() => { setDraft(title); setEditing(true); }} aria-label="重命名项目" /></div>}
                        <p className="mt-4 text-sm text-muted-foreground">{canvases.length} 张画布 · 创建于 {new Date(root.createdAt).toLocaleDateString("zh-CN")} · 每张画布独立保存</p>
                    </div>
                    <div className="flex flex-wrap gap-2"><Button icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(canvases, title)}>导出项目</Button><Button danger icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([id])}>删除项目</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>新建画布</Button></div>
                </div>
                <section className="grid gap-4 border-b border-border py-7 sm:grid-cols-3"><div><p className="text-[11px] tracking-widest text-muted-foreground">画布 / CANVASES</p><strong className="mt-2 block text-3xl font-semibold">{canvases.length}</strong></div><div><p className="text-[11px] tracking-widest text-muted-foreground">内容节点 / NODES</p><strong className="mt-2 block text-3xl font-semibold">{canvases.reduce((total, item) => total + item.nodes.length, 0)}</strong></div><div><p className="text-[11px] tracking-widest text-muted-foreground">最近更新 / UPDATED</p><strong className="mt-2 block text-lg font-semibold">{new Date(canvases[0]?.updatedAt || root.updatedAt).toLocaleDateString("zh-CN")}</strong></div></section>
                <div className="mb-5 mt-9 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground">YOUR CANVASES</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">项目画布</h2></div>{selectedIds.length ? <div className="flex items-center gap-2"><span className="mr-2 text-xs text-muted-foreground">已选 {selectedIds.length} 张</span><Button size="small" onClick={() => void exportCanvasProjects(canvases.filter((canvas) => selectedIds.includes(canvas.id)), `${title}-选中画布`)}>导出选中</Button><Button size="small" danger onClick={() => setDeleteIds(selectedIds)}>删除选中</Button></div> : <span className="text-xs text-muted-foreground">打开画布继续创作</span>}</div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{canvases.map((canvas) => <CanvasProjectCard key={canvas.id} project={canvas} />)}<button type="button" onClick={createAndEnter} className="flex min-h-48 flex-col items-center justify-center rounded-[22px] border border-dashed border-border bg-card/70 text-muted-foreground transition hover:border-foreground hover:text-foreground"><span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted"><Plus className="size-5" /></span><span className="text-sm font-medium">添加一张画布</span></button></div>
                <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground"><Layers3 className="size-4" />该项目内的画布共享项目归属，各自保留节点、连线与创作历史。</p>
            </>}
        </main>
        <CanvasDeleteProjectsDialog />
    </WorkspaceShell>;
}
