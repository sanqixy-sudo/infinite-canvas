"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal } from "antd";
import { FileUp, FolderOpen, Plus, Search } from "lucide-react";
import { nanoid } from "nanoid";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasProjectPreview } from "./components/canvas-project-preview";
import type { CanvasExportFile } from "./export-types";
import { useCanvasStore, workspaceCanvases, workspaceRoot } from "./stores/use-canvas-store";
import { importCanvasProjectGroups, prepareCanvasImport } from "./utils/canvas-transfer";

export default function CanvasPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const canvases = useCanvasStore((state) => state.projects);
    const createCanvas = useCanvasStore((state) => state.createProject);
    const importCanvas = useCanvasStore((state) => state.importProject);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState("updated");
    const [newTitle, setNewTitle] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [importing, setImporting] = useState(false);
    const roots = useMemo(() => canvases.filter(workspaceRoot).map((root) => {
        const group = workspaceCanvases(canvases, root.id).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        return { root, group, latest: Date.parse(group[0]?.updatedAt || root.updatedAt), cover: group.find((canvas) => canvas.nodes.length) || root };
    }), [canvases]);
    const filtered = roots.filter(({ root }) => (root.workspaceTitle || root.title).toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === "name" ? (a.root.workspaceTitle || a.root.title).localeCompare(b.root.workspaceTitle || b.root.title, "zh-CN") : b.latest - a.latest);

    const createWorkspace = () => {
        if (!hydrated) return;
        const title = newTitle.trim() || `未命名项目 ${roots.length + 1}`;
        const id = createCanvas("画布 1", { workspaceTitle: title });
        setNewTitle("");
        setCreateOpen(false);
        router.push(`/canvas/${id}`);
    };

    const importArchive = async (file?: File) => {
        if (!file || importing || !hydrated) return;
        setImporting(true);
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("压缩包缺少 projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            const restored = await prepareCanvasImport(data, zip, async (entry, blob) => {
                const image = entry.mimeType.startsWith("image/") || entry.storageKey.startsWith("image:");
                const storageKey = `${image ? "image" : "file"}:${nanoid()}`;
                const url = await (image ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob));
                return { storageKey, url };
            });
            importCanvasProjectGroups(restored, importCanvas);
            message.success(`已导入 ${restored.length} 张画布及完整素材`);
        } catch (error) {
            message.error(error instanceof Error ? `导入失败：${error.message}` : "导入失败，请选择有效的画布压缩包");
        } finally {
            setImporting(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    return <>
        <main className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
            <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
                <div><h1 className="text-2xl font-semibold tracking-tight">我的项目<span className="ml-3 text-sm font-normal text-muted-foreground">{roots.length}</span></h1><p className="mt-2 text-sm text-muted-foreground">按项目组织创作，在项目内管理多张画布。</p></div>
                <Button type="primary" icon={<Plus className="size-4" />} disabled={!hydrated} onClick={() => setCreateOpen(true)}>新建项目</Button>
            </div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <label className="flex h-10 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"><Search className="size-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" /></label>
                <div className="flex items-center gap-2"><select aria-label="项目排序" value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground"><option value="updated">最近修改</option><option value="name">项目名称</option></select><Button type="text" icon={<FileUp className="size-4" />} loading={importing} disabled={!hydrated || importing} onClick={() => inputRef.current?.click()}>导入项目</Button></div>
            </div>
            {!hydrated ? <div className="py-28 text-center text-sm text-muted-foreground">正在读取项目...</div> : filtered.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{filtered.map(({ root, group, latest, cover }) => {
                return <Link href={`/canvas/project/${root.id}`} key={root.id} className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/35">
                    <CanvasProjectPreview project={cover} className="aspect-[16/10] w-full" />
                    <div className="border-t border-border px-4 py-4"><h2 className="truncate text-base font-medium transition-colors group-hover:text-primary">{root.workspaceTitle || root.title}</h2><div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{group.length} 张画布</span><span>{latest ? `${new Date(latest).toLocaleDateString("zh-CN")} 更新` : ""}</span></div></div>
                </Link>;
            })}</div> : <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border px-5 text-center"><FolderOpen className="mb-4 size-7 text-muted-foreground" /><h2 className="text-lg font-medium">{query ? "没有找到匹配的项目" : "创建第一个项目"}</h2><p className="mt-2 text-sm text-muted-foreground">{query ? "试试其他名称，或清除搜索查看全部项目。" : "给项目起个名字，打开第一张画布开始创作。"}</p><Button className="mt-5" type={query ? "default" : "primary"} onClick={() => query ? setQuery("") : setCreateOpen(true)}>{query ? "清除搜索" : "新建项目"}</Button></div>}
            <p className="mt-8 text-xs text-muted-foreground">未登录内容保存在当前浏览器；登录后按账号同步设置保存。</p>
        </div>
        </main>
        <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importArchive(event.target.files?.[0])} />
        <Modal title="新建项目" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={createWorkspace} okText="创建并开始" cancelText="取消" okButtonProps={{ disabled: !hydrated }}><p className="mb-4 text-sm text-muted-foreground">创建后进入第一张画布，后续可在项目中添加更多画布。</p><Input autoFocus aria-label="项目名称" maxLength={80} placeholder="例如：品牌短片 · 秋季企划" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onPressEnter={createWorkspace} /></Modal>
        <CanvasDeleteProjectsDialog />
    </>;
}
