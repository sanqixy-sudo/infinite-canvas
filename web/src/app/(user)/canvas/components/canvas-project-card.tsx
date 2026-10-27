"use client";

import { Check, Download, Layers3, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { Button, Dropdown, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import { useCanvasExport } from "../hooks/use-canvas-export";
import { CanvasProjectPreview } from "./canvas-project-preview";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const exportProjects = useCanvasExport();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const hasChildCanvases = useCanvasStore((state) => state.projects.some((canvas) => canvas.workspaceId === project.id));
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <article className={`group relative overflow-hidden rounded-2xl border bg-card transition duration-200 motion-reduce:transform-none ${selected ? "border-primary/60 ring-2 ring-primary/10" : "border-border/70 hover:-translate-y-0.5 hover:border-primary/35"}`}>
            <Link href={`/canvas/${project.id}`} aria-label={`打开画布 ${project.title}`} className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"><CanvasProjectPreview project={project} className="aspect-[16/10] w-full" /></Link>
            <label className={`absolute left-3 top-3 flex size-9 cursor-pointer items-center justify-center rounded-xl border border-border/70 bg-card/95 transition-opacity focus-within:ring-2 focus-within:ring-ring/40 ${selected ? "" : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"}`}>
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className="size-4 cursor-pointer accent-primary"
                    aria-label={`选择 ${project.title}`}
                />
            </label>
            <div className="px-4 pb-4 pt-3.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
                {editing ? (
                    <Input className="min-w-0 rounded-lg" aria-label="画布名称" maxLength={80} value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveTitle(); if (event.key === "Escape") stopEditing(); }} autoFocus />
                ) : (
                    <Link href={`/canvas/${project.id}`} className="min-w-0 flex-1"><h3 className="truncate text-[15px] font-medium transition-colors group-hover:text-primary">{project.title}</h3></Link>
                )}
                <div className="flex shrink-0 items-center gap-1">
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存名称" />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label="取消重命名" />
                        </>
                    ) : (
                        <Dropdown trigger={["click"]} menu={{ items: [
                            { key: "rename", label: "重命名画布", icon: <Pencil className="size-4" />, onClick: () => startEditing(project.id, project.title) },
                            { key: "export", label: "导出画布", icon: <Download className="size-4" />, onClick: () => void exportProjects([project], project.title || "小盟画布") },
                            { type: "divider" },
                            { key: "delete", label: hasChildCanvases ? "首张画布随项目保留" : "删除画布", disabled: hasChildCanvases, danger: true, icon: <Trash2 className="size-4" />, onClick: () => setDeleteIds([project.id]) },
                        ] }}><Button type="text" size="small" className="text-muted-foreground" icon={<MoreHorizontal className="size-4" />} aria-label={`${project.title} 的更多操作`} /></Dropdown>
                    )}
                </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新</time><span className="inline-flex items-center gap-1.5"><Layers3 className="size-3.5" />{project.nodes.length} 个节点</span></div>
            </div>
        </article>
    );
}
