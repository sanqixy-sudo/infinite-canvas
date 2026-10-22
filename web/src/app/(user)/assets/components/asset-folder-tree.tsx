"use client";

import { useMemo, useState, type DragEvent } from "react";
import { ChevronRight, Clock3, Folder, FolderOpen, FolderPlus, Inbox, Layers3, MoreHorizontal, Tags } from "lucide-react";
import { Dropdown } from "antd";
import { useAssetStore } from "@/stores/use-asset-store";
import { folderPath, type AssetFolder, type AssetScope } from "@/lib/asset-organization";
import { cn } from "@/lib/utils";

export const ASSET_DRAG_TYPE = "application/x-xiaomeng-assets";
const FOLDER_DRAG_TYPE = "application/x-xiaomeng-folder";
export type FolderAction = "create" | "rename" | "move" | "delete";

type Props = {
    scope: AssetScope;
    activeId: string;
    disabled: boolean;
    onSelect: (id: string) => void;
    onAction: (action: FolderAction, folder?: AssetFolder) => void;
    onAddAssets: (folderId: string, ids: string[]) => void;
    onMoveFolder: (id: string, parentId: string) => void;
};

export function AssetFolderTree({ scope, activeId, disabled, onSelect, onAction, onAddAssets, onMoveFolder }: Props) {
    const folders = useAssetStore((state) => scope === "cloud" ? state.cloudFolders : state.localFolders);
    const assets = useAssetStore((state) => scope === "cloud" ? state.cloudAssets : state.localAssets);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [dropId, setDropId] = useState<string | null>(null);
    const children = useMemo(() => {
        const map = new Map<string, AssetFolder[]>();
        folders.forEach((folder) => map.set(folder.parentId || "", [...(map.get(folder.parentId || "") || []), folder]));
        for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
        return map;
    }, [folders]);
    const visibleIds = useMemo(() => {
        if (!query.trim()) return null;
        return new Set(folders.filter((folder) => folder.name.toLowerCase().includes(query.trim().toLowerCase())).flatMap((folder) => folderPath(folders, folder.id).map((item) => item.id)));
    }, [folders, query]);
    const activeParents = useMemo(() => new Set(folderPath(folders, activeId).slice(0, -1).map((folder) => folder.id)), [folders, activeId]);
    const folderCounts = useMemo(() => {
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        const counts = new Map<string, number>();
        for (const asset of assets) {
            const visited = new Set<string>();
            for (const id of asset.folderIds || []) {
                let folder = byId.get(id);
                while (folder && !visited.has(folder.id)) { visited.add(folder.id); folder = byId.get(folder.parentId); }
            }
            for (const id of visited) counts.set(id, (counts.get(id) || 0) + 1);
        }
        return counts;
    }, [folders, assets]);
    const navItems = [
        { id: "", name: "全部素材", icon: Layers3, count: assets.length },
        { id: "@unfiled", name: "未整理", icon: Inbox, count: assets.filter((asset) => !asset.folderIds?.some((id) => folders.some((folder) => folder.id === id))).length },
        { id: "@untagged", name: "未打标签", icon: Tags, count: assets.filter((asset) => !asset.tags?.length).length },
        { id: "@recent", name: "最近添加", icon: Clock3 },
    ];

    const drop = (event: DragEvent, targetId: string) => {
        event.preventDefault(); event.stopPropagation(); setDropId(null);
        if (disabled) return;
        try {
            const assetData = event.dataTransfer.getData(ASSET_DRAG_TYPE);
            if (assetData) {
                const payload = JSON.parse(assetData);
                if (payload.scope === scope && Array.isArray(payload.ids) && targetId) onAddAssets(targetId, payload.ids.filter((id: unknown) => typeof id === "string"));
                return;
            }
            const payload = JSON.parse(event.dataTransfer.getData(FOLDER_DRAG_TYPE));
            if (payload.scope === scope && typeof payload.id === "string" && payload.id !== targetId) onMoveFolder(payload.id, targetId);
        } catch { /* 外部文件拖放不作为整理指令。 */ }
    };
    const dragOver = (event: DragEvent, id: string) => {
        if (disabled || ![ASSET_DRAG_TYPE, FOLDER_DRAG_TYPE].some((type) => event.dataTransfer.types.includes(type))) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes(FOLDER_DRAG_TYPE) ? "move" : "link"; setDropId(id);
    };

    const renderFolders = (parentId: string, depth = 0) => (children.get(parentId) || []).filter((folder) => !visibleIds || visibleIds.has(folder.id)).map((folder) => {
        const hasChildren = Boolean(children.get(folder.id)?.length);
        const open = expanded.has(folder.id) || activeParents.has(folder.id) || Boolean(visibleIds);
        const menu = { items: [{ key: "create", label: "新建子文件夹" }, { key: "rename", label: "重命名" }, { key: "move", label: "移动文件夹" }, { type: "divider" as const }, { key: "delete", label: "移除文件夹", danger: true }], onClick: ({ key }: { key: string }) => onAction(key as FolderAction, folder) };
        return <li key={folder.id}>
            <div draggable={!disabled} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(FOLDER_DRAG_TYPE, JSON.stringify({ scope, id: folder.id })); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => dragOver(event, folder.id)} onDragLeave={() => setDropId(null)} onDrop={(event) => drop(event, folder.id)} className={cn("group flex min-h-9 items-center rounded-lg transition", activeId === folder.id ? "bg-foreground/[0.07] font-medium text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground", dropId === folder.id && "ring-1 ring-inset ring-foreground")} style={{ paddingLeft: Math.min(depth, 7) * 12 }}>
                <button type="button" aria-label={`${open ? "收起" : "展开"}${folder.name}`} aria-expanded={open} disabled={!hasChildren} onClick={() => setExpanded((ids) => { const next = new Set(ids); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })} className="flex size-6 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-ring disabled:invisible"><ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} /></button>
                <button type="button" title={folderPath(folders, folder.id).map((item) => item.name).join(" / ")} aria-current={activeId === folder.id ? "page" : undefined} onClick={() => onSelect(folder.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring">{open ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}<span className="truncate">{folder.name}</span><span className="ml-auto pr-1 text-[10px] font-normal tabular-nums text-muted-foreground">{folderCounts.get(folder.id) || 0}</span></button>
                <Dropdown menu={menu} trigger={["click"]} disabled={disabled}><button type="button" aria-label={`${folder.name}的操作`} className="mr-0.5 flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><MoreHorizontal className="size-3.5" /></button></Dropdown>
            </div>
            {hasChildren && open ? <ul>{renderFolders(folder.id, depth + 1)}</ul> : null}
        </li>;
    });

    return <nav aria-label="素材目录" className="flex h-full min-h-0 flex-col px-3 py-4">
        <p className="px-3 pb-3 text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">{scope === "cloud" ? "账号素材库" : "当前浏览器"}</p>
        <div className="grid grid-cols-2 gap-1">{navItems.map(({ id, name, icon: Icon, count }) => <button key={id} type="button" title={name} aria-current={activeId === id ? "page" : undefined} onClick={() => onSelect(id)} className={cn("flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-[11px] transition focus-visible:outline-2 focus-visible:outline-ring", activeId === id ? "bg-foreground/[0.07] font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}><Icon className="size-3.5 shrink-0" /><span className="truncate">{name}</span>{typeof count === "number" ? <span className="ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground">{count}</span> : null}</button>)}</div>
        <div className="mb-2 mt-5 flex items-center justify-between px-3"><button type="button" onClick={() => onSelect("")} className="text-[11px] font-medium text-muted-foreground" onDragOver={(event) => dragOver(event, "")} onDrop={(event) => drop(event, "")}>文件夹 <span className="ml-1 text-[10px]">{folders.length}</span></button><button type="button" aria-label="新建文件夹" disabled={disabled} onClick={() => onAction("create")} className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><FolderPlus className="size-4" /></button></div>
        {folders.length > 8 ? <input aria-label="查找文件夹" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找文件夹" className="mb-2 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-xs outline-none focus:border-foreground/50" /> : null}
        <div className="min-h-0 flex-1 overflow-y-auto"><ul>{renderFolders("")}</ul>{!folders.length ? <div className="px-3 py-5 text-xs leading-6 text-muted-foreground">还没有文件夹。<br /><button type="button" disabled={disabled} className="mt-1 underline underline-offset-4 disabled:opacity-40" onClick={() => onAction("create")}>创建第一个文件夹</button></div> : visibleIds?.size === 0 ? <p className="px-3 py-5 text-xs text-muted-foreground">没有匹配的文件夹</p> : null}</div>
        <p className="mt-3 border-t border-border/60 px-2 pt-3 text-[10px] leading-5 text-muted-foreground">多目录归类不复制文件，<br />也不增加存储用量。</p>
    </nav>;
}
