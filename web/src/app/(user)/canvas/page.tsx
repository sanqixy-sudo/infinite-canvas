"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal } from "antd";
import { ArrowUpRight, FileUp, Layers3, Plus, Search } from "lucide-react";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { WorkspaceShell } from "./components/workspace-shell";
import type { CanvasExportFile } from "./export-types";
import { useCanvasStore, workspaceCanvases, workspaceRoot } from "./stores/use-canvas-store";

export default function CanvasPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const canvases = useCanvasStore((state) => state.projects);
    const createCanvas = useCanvasStore((state) => state.createProject);
    const importCanvas = useCanvasStore((state) => state.importProject);
    const [query, setQuery] = useState("");
    const [newTitle, setNewTitle] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const roots = canvases.filter(workspaceRoot).sort((a, b) => {
        const latest = (id: string) => Math.max(...workspaceCanvases(canvases, id).map((item) => Date.parse(item.updatedAt) || 0));
        return latest(b.id) - latest(a.id);
    });
    const filtered = roots.filter((root) => (root.workspaceTitle || root.title).toLowerCase().includes(query.trim().toLowerCase()));

    const createWorkspace = () => {
        if (!hydrated) return;
        const title = newTitle.trim() || `未命名项目 ${roots.length + 1}`;
        const id = createCanvas("画布 1", { workspaceTitle: title });
        setNewTitle("");
        setCreateOpen(false);
        router.push(`/canvas/project/${id}`);
    };

    const importArchive = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(data.projects.flatMap((item) => item.files.map(async (entry) => {
                const blob = zip.get(entry.path);
                if (!blob) return;
                const typed = blob.type ? blob : blob.slice(0, blob.size, entry.mimeType);
                await (entry.storageKey.startsWith("image:") ? setImageBlob(entry.storageKey, typed) : setMediaBlob(entry.storageKey, typed));
            })));
            const rootsInArchive = data.projects.filter((item) => !item.project.workspaceId);
            const childrenInArchive = data.projects.filter((item) => item.project.workspaceId);
            const ids = new Map<string, string>();
            rootsInArchive.forEach((item) => ids.set(item.project.id, importCanvas(item.project)));
            childrenInArchive.forEach((item) => importCanvas(item.project, ids.get(item.project.workspaceId!)));
            message.success(`已导入 ${data.projects.length} 张画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    return <WorkspaceShell>
        <main className="mx-auto max-w-[1460px] px-5 py-8 md:px-10 md:py-12">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
                <div><p className="mb-3 text-[11px] font-semibold tracking-[0.22em] text-muted-foreground">WORKSPACE / PROJECTS</p><h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-5xl">我的项目<span className="ml-3 align-top text-base font-normal tracking-normal text-muted-foreground">{roots.length.toString().padStart(2, "0")}</span></h1><p className="mt-4 text-sm text-muted-foreground">一个项目，容纳多张独立画布。创意在这里持续生长。</p></div>
                <Button type="primary" size="large" icon={<Plus className="size-4" />} disabled={!hydrated} onClick={() => setCreateOpen(true)}>新建项目</Button>
            </div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
                <label className="flex h-10 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground"><Search className="size-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" /></label>
                <Button type="text" icon={<FileUp className="size-4" />} disabled={!hydrated} onClick={() => inputRef.current?.click()}>导入画布</Button>
            </div>
            {!hydrated ? <div className="py-28 text-center text-sm text-muted-foreground">正在读取项目...</div> : filtered.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((root, index) => {
                const group = workspaceCanvases(canvases, root.id);
                const latest = group.reduce((time, item) => Math.max(time, Date.parse(item.updatedAt) || 0), 0);
                return <Link href={`/canvas/project/${root.id}`} key={root.id} className="group relative flex min-h-[270px] flex-col overflow-hidden rounded-[22px] border border-border bg-card p-6 transition duration-300 hover:-translate-y-1 hover:shadow-xl">
                    <div className="flex items-start justify-between"><span className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">PROJECT {String(roots.length - index).padStart(2, "0")}</span><ArrowUpRight className="size-5 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" /></div>
                    <div className="relative mt-6 flex h-24 items-center justify-center overflow-hidden rounded-xl bg-muted/60"><div className="absolute inset-0 opacity-50 bg-[linear-gradient(90deg,var(--border)_1px,transparent_1px),linear-gradient(var(--border)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center gap-2"><span className="flex size-12 items-center justify-center rounded-lg border border-border bg-card shadow-sm"><Layers3 className="size-5" /></span>{group.length > 1 && <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-card/80 shadow-sm"><Layers3 className="size-4 opacity-60" /></span>}</div></div>
                    <div className="mt-auto pt-5"><h2 className="truncate text-xl font-semibold tracking-tight">{root.workspaceTitle || root.title}</h2><div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{group.length} 张画布 · {group.reduce((total, item) => total + item.nodes.length, 0)} 个节点</span><span>{latest ? new Date(latest).toLocaleDateString("zh-CN") : ""}</span></div></div>
                </Link>;
            })}</div> : <div className="flex min-h-72 flex-col items-center justify-center rounded-[24px] border border-dashed border-border bg-card/70 text-center"><Layers3 className="mb-4 size-7 text-muted-foreground" /><h2 className="text-lg font-medium">{query ? "没有找到匹配的项目" : "从第一个项目开始"}</h2><p className="mt-2 text-sm text-muted-foreground">{query ? "试试其他名称。" : "每个项目可以继续添加多张画布。"}</p>{!query && <Button className="mt-5" type="primary" onClick={() => setCreateOpen(true)}>新建项目</Button>}</div>}
            <div className="mt-10 border-t border-border pt-5 text-xs text-muted-foreground">项目和画布会按照当前账号的同步设置保存；未登录时保存在本机浏览器。</div>
        </main>
        <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importArchive(event.target.files?.[0])} />
        <Modal title="新建项目" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={createWorkspace} okText="创建项目" cancelText="取消" okButtonProps={{ disabled: !hydrated }}><p className="mb-4 text-sm text-muted-foreground">项目创建后会自动包含第一张空白画布。</p><Input autoFocus maxLength={80} placeholder="例如：品牌短片 · 秋季企划" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onPressEnter={createWorkspace} /></Modal>
        <CanvasDeleteProjectsDialog />
    </WorkspaceShell>;
}
