"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal } from "antd";
import { ArrowUpRight, FileUp, FolderOpen, Layers3, Plus, Search } from "lucide-react";
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
        <div className="mx-auto max-w-[1320px] px-5 py-8 sm:px-8 lg:px-10">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
                <div><p className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><FolderOpen className="size-3.5" />创作空间</p><h1 className="text-[28px] font-semibold tracking-tight">我的项目</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">把灵感整理成项目，在画布里自由展开。</p></div>
                <Button type="primary" className="h-10 rounded-xl px-5" icon={<Plus className="size-4" />} disabled={!hydrated} onClick={() => setCreateOpen(true)}>新建项目</Button>
            </div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <label className="flex h-10 w-full max-w-sm items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 text-muted-foreground transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/15"><Search className="size-4 shrink-0" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称" aria-label="搜索项目" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" /></label>
                <div className="flex items-center gap-2"><select aria-label="项目排序" value={sort} onChange={(event) => setSort(event.target.value)} className="h-10 rounded-xl border border-border/70 bg-card px-3 text-sm text-muted-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring/15"><option value="updated">最近修改</option><option value="name">项目名称</option></select><Button type="text" className="h-10 rounded-xl" icon={<FileUp className="size-4" />} loading={importing} disabled={!hydrated || importing} onClick={() => inputRef.current?.click()}>导入项目</Button></div>
            </div>
            {hydrated && roots.length > 0 ? <p className="mb-4 text-xs text-muted-foreground">{query ? `找到 ${filtered.length} 个项目` : `共 ${roots.length} 个项目`}</p> : null}
            {!hydrated ? <div className="py-28 text-center text-sm text-muted-foreground">正在读取项目...</div> : filtered.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(({ root, group, latest, cover }) => {
                return <Link href={`/canvas/project/${root.id}`} key={root.id} className="group overflow-hidden rounded-2xl border border-border/70 bg-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transform-none">
                    <CanvasProjectPreview project={cover} className="aspect-[16/10] w-full" />
                    <div className="px-4 pb-4 pt-3.5"><div className="flex items-center justify-between gap-3"><h2 className="truncate text-[15px] font-medium transition-colors group-hover:text-primary">{root.workspaceTitle || root.title}</h2><ArrowUpRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" /></div><div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Layers3 className="size-3.5" />{group.length} 张画布</span><time dateTime={group[0]?.updatedAt || root.updatedAt}>{latest ? `${new Date(latest).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })} 更新` : ""}</time></div></div>
                </Link>;
            })}</div> : <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-border/70 bg-card px-6 py-12 text-center"><span className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-accent text-primary">{query ? <Search className="size-6" /> : <Layers3 className="size-7" />}</span><h2 className="text-lg font-medium">{query ? "没有找到匹配的项目" : "为下一个灵感，留一张画布"}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{query ? "试试其他名称，或清除搜索查看全部项目。" : "从右上角新建项目，把脚本、分镜与素材放在一起。"}</p>{query ? <Button className="mt-5 rounded-xl" onClick={() => setQuery("")}>清除搜索</Button> : null}</div>}
            <p className="mt-8 text-xs leading-5 text-muted-foreground">未登录内容保存在当前浏览器；登录后按账号同步设置保存。</p>
        </div>
        </main>
        <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importArchive(event.target.files?.[0])} />
        <Modal title="新建项目" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={createWorkspace} okText="创建并开始" cancelText="取消" okButtonProps={{ disabled: !hydrated }}><p className="mb-4 text-sm text-muted-foreground">创建后进入第一张画布，后续可在项目中添加更多画布。</p><Input autoFocus aria-label="项目名称" maxLength={80} placeholder="例如：品牌短片 · 秋季企划" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onPressEnter={createWorkspace} /></Modal>
        <CanvasDeleteProjectsDialog />
    </>;
}
