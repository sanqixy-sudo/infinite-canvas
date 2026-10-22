"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import Link from "next/link";
import { App, Checkbox, Drawer, Dropdown, Grid, Input, Modal, Pagination, Select, Slider, TreeSelect } from "antd";
import { ChevronRight, Cloud, FileText, Folder, FolderInput, FolderMinus, Image as ImageIcon, Menu, Monitor, MoreHorizontal, Music2, Plus, Search, Tags, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { folderDescendantIds, folderPath, folderTreeOptions, type AssetFolder, type AssetOrganizationPatch, type AssetScope } from "@/lib/asset-organization";
import { useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { saveAssetToAccountLibrary } from "@/services/account-asset-save";
import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { AssetFolderTree, ASSET_DRAG_TYPE, type FolderAction } from "./components/asset-folder-tree";
import { AssetDetailsPanel } from "./components/asset-details-panel";
import { useStorageFileDeletion } from "@/hooks/use-storage-file-deletion";
import { bulkTagValues, createBulkTagDraft, updateBulkTagDraft, type BulkTagDraft } from "./bulk-tag-draft";

const kinds = [{ value: "image", label: "图片" }, { value: "video", label: "视频" }, { value: "audio", label: "音频" }, { value: "text", label: "文本" }];
const quietButton = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40";
type FolderDraft = { action: Exclude<FolderAction, "delete">; id?: string; name: string; parentId: string };
type OrganizationDraft = { mode: "folders" | "tags"; ids: string[]; folders: string[]; tags: BulkTagDraft };
type DeleteDraft = { kind: "folder" | "asset"; id: string; name: string };

export default function AssetsPage() {
    const { message } = App.useApp();
    const fileDeletion = useStorageFileDeletion();
    const screens = Grid.useBreakpoint();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const owner = useAssetStore((state) => state.owner);
    const hydrated = useAssetStore((state) => state.hydrated);
    const localAssets = useAssetStore((state) => state.localAssets);
    const cloudAssets = useAssetStore((state) => state.cloudAssets);
    const localFolders = useAssetStore((state) => state.localFolders);
    const cloudFolders = useAssetStore((state) => state.cloudFolders);
    const legacyAssets = useAssetStore((state) => state.legacyBrowserAssets);
    const cloudLoading = useAssetStore((state) => state.cloudLoading);
    const cloudError = useAssetStore((state) => state.error);
    const [scope, setScope] = useState<AssetScope>("local");
    const [activeId, setActiveId] = useState("");
    const [keyword, setKeyword] = useState("");
    const [kindFilters, setKindFilters] = useState<AssetKind[]>([]);
    const [tagFilters, setTagFilters] = useState<string[]>([]);
    const [includeChildren, setIncludeChildren] = useState(true);
    const [sort, setSort] = useState("updated");
    const [thumbnail, setThumbnail] = useState(180);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(48);
    const [selected, setSelected] = useState(new Set<string>());
    const [detailId, setDetailId] = useState("");
    const [treeOpen, setTreeOpen] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Asset | null>(null);
    const [folderDraft, setFolderDraft] = useState<FolderDraft | null>(null);
    const [organization, setOrganization] = useState<OrganizationDraft | null>(null);
    const [deleting, setDeleting] = useState<DeleteDraft | null>(null);
    const [busy, setBusy] = useState(false);
    const [savingIds, setSavingIds] = useState(new Set<string>());
    const [draftError, setDraftError] = useState("");
    const busyRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const importedFolderRef = useRef("");
    const viewRef = useRef({ token, owner, scope, version: 0 });
    const assets = scope === "cloud" ? cloudAssets : localAssets;
    const folders = scope === "cloud" ? cloudFolders : localFolders;
    const currentFolder = folders.find((folder) => folder.id === activeId);
    const canWrite = hydrated && owner !== "pending" && (scope === "local" || Boolean(token && user?.id));
    const disabled = busy || fileDeletion.busy || !canWrite;
    const path = useMemo(() => folderPath(folders, activeId), [folders, activeId]);
    const tagOptions = useMemo(() => [...new Set(assets.flatMap((asset) => asset.tags || []))].sort((a, b) => a.localeCompare(b, "zh-CN")).map((value) => ({ value, label: value })), [assets]);
    const treeOptions = useMemo(() => folderTreeOptions(folders), [folders]);
    const childFolders = useMemo(() => activeId.startsWith("@") ? [] : folders.filter((folder) => folder.parentId === activeId).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })), [folders, activeId]);
    const filtered = useMemo(() => {
        const query = keyword.trim().toLocaleLowerCase();
        const available = new Set(folders.map((folder) => folder.id));
        const branch = new Set(currentFolder ? includeChildren ? folderDescendantIds(folders, activeId) : [activeId] : []);
        return assets.filter((asset) => {
            if (currentFolder && !asset.folderIds?.some((id) => branch.has(id))) return false;
            if (activeId === "@unfiled" && asset.folderIds?.some((id) => available.has(id))) return false;
            if (activeId === "@untagged" && asset.tags?.length) return false;
            if (kindFilters.length && !kindFilters.includes(asset.kind)) return false;
            if (tagFilters.some((tag) => !asset.tags?.includes(tag))) return false;
            return !query || [asset.title, asset.category, asset.source, ...(asset.tags || []), asset.kind === "text" ? asset.data.content : ""].join(" ").toLocaleLowerCase().includes(query);
        }).sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "zh-CN", { numeric: true }) : (sort === "created" || activeId === "@recent" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
    }, [assets, folders, currentFolder, activeId, includeChildren, keyword, kindFilters, tagFilters, sort]);
    const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
    const selectedAssets = assets.filter((asset) => selected.has(asset.id));
    const heading = currentFolder?.name || (({ "@unfiled": "未整理", "@untagged": "未打标签", "@recent": "最近添加" } as Record<string, string>)[activeId] || "全部素材");

    const resetView = () => {
        setSelected(new Set()); setDetailId(""); setFolderDraft(null); setOrganization(null); setDeleting(null); setFormOpen(false); setEditing(null); setDraftError(""); setPage(1); setSavingIds(new Set()); setBusy(false); busyRef.current = false;
    };
    useLayoutEffect(() => {
        viewRef.current = { token, owner, scope, version: viewRef.current.version + 1 };
        resetView(); setActiveId(scope === "local" ? importedFolderRef.current : ""); importedFolderRef.current = ""; setTreeOpen(false); setKindFilters([]); setTagFilters([]); setKeyword("");
    }, [token, owner, scope]);
    useLayoutEffect(() => {
        setPage((value) => Math.min(value, Math.max(1, Math.ceil(filtered.length / pageSize))));
        const ids = new Set(assets.map((asset) => asset.id));
        setSelected((previous) => [...previous].some((id) => !ids.has(id)) ? new Set([...previous].filter((id) => ids.has(id))) : previous);
        if (detailId && !ids.has(detailId)) setDetailId("");
        if (activeId && !activeId.startsWith("@") && !folders.some((folder) => folder.id === activeId)) setActiveId("");
    }, [assets, folders, filtered.length, pageSize, detailId, activeId]);
    const capture = () => ({ ...viewRef.current });
    const viewMatches = () => viewRef.current.scope === scope && viewRef.current.token === token && viewRef.current.owner === owner && useUserStore.getState().token === token && useAssetStore.getState().owner === owner;
    const current = (request: ReturnType<typeof capture>) => request.version === viewRef.current.version && request.scope === viewRef.current.scope && request.token === useUserStore.getState().token && request.owner === useAssetStore.getState().owner;
    const changeScope = (value: AssetScope) => { if (value === scope) return; viewRef.current.version++; resetView(); setScope(value); };
    const selectFolder = (id: string) => { setActiveId(id); setSelected(new Set()); setDetailId(""); setPage(1); setTreeOpen(false); };
    const filterChanged = () => { setSelected(new Set()); setPage(1); };
    const start = () => { if (busyRef.current || !canWrite || !viewMatches()) return false; busyRef.current = true; setBusy(true); setDraftError(""); return true; };
    const finish = (request: ReturnType<typeof capture>) => { if (current(request)) { busyRef.current = false; setBusy(false); } };
    const report = (error: unknown) => error instanceof Error ? error.message : "操作未完成，请重试";

    const openFolder = (action: FolderAction, folder?: AssetFolder) => {
        if (disabled || !viewMatches()) return;
        setTreeOpen(false); setOrganization(null); setDraftError("");
        if (action === "delete" && folder) { setDeleting({ kind: "folder", id: folder.id, name: folder.name }); return; }
        if (action === "delete") return;
        setFolderDraft({ action, ...(action !== "create" && folder ? { id: folder.id } : {}), name: action === "create" ? "" : folder?.name || "", parentId: action === "create" ? folder?.id || currentFolder?.id || "" : folder?.parentId || "" });
    };
    const saveFolder = async () => {
        if (!folderDraft || !start()) return;
        const request = capture();
        try {
            const saved = await useAssetStore.getState().saveFolder(request.scope, { id: folderDraft.id, ...(folderDraft.action !== "move" ? { name: folderDraft.name } : {}), ...(folderDraft.action !== "rename" ? { parentId: folderDraft.parentId } : {}) });
            if (!current(request)) return;
            setFolderDraft(null); if (folderDraft.action === "create") selectFolder(saved.id); message.success("文件夹已保存");
        } catch (error) { if (current(request)) { setDraftError(report(error)); message.error(report(error)); } }
        finally { finish(request); }
    };
    const organize = async (ids: string[], patch: AssetOrganizationPatch, close = false) => {
        if (!start()) return;
        const request = capture();
        try { await useAssetStore.getState().organizeAssets(request.scope, ids, patch); if (current(request)) { if (close) setOrganization(null); message.success("素材整理已保存"); } }
        catch (error) { if (current(request)) { setDraftError(report(error)); message.error(report(error)); } }
        finally { finish(request); }
    };
    const openOrganization = (mode: "folders" | "tags", ids: string[]) => {
        if (disabled || !viewMatches()) return;
        if (!ids.length || ids.length > 200) { message.info("每次请选择 1 至 200 个素材"); return; }
        const targets = assets.filter((asset) => ids.includes(asset.id));
        if (targets.length !== ids.length) { message.error("素材列表已变化，请重新选择"); return; }
        setFolderDraft(null); setDraftError(""); setOrganization({ mode, ids, folders: [], tags: createBulkTagDraft(targets) });
    };
    const changeOrganizationTags = (values: string[]) => {
        if (!organization || organization.mode !== "tags" || disabled) return;
        try { setOrganization({ ...organization, tags: updateBulkTagDraft(organization.tags, values) }); setDraftError(""); }
        catch (error) { setDraftError(report(error)); }
    };
    const saveOrganization = () => {
        if (!organization || disabled) return;
        if (organization.mode === "folders") {
            if (!organization.folders.length) { setDraftError("请选择至少一个目标文件夹"); return; }
            void organize(organization.ids, { addFolderIds: organization.folders }, true);
        } else {
            const { addTags, removeTags } = organization.tags;
            if (!addTags.length && !removeTags.length) { setOrganization(null); return; }
            void organize(organization.ids, { addTags, removeTags }, true);
        }
    };
    const moveFolder = async (id: string, parentId: string) => {
        if (!start()) return;
        const request = capture();
        try { await useAssetStore.getState().saveFolder(request.scope, { id, parentId }); if (current(request)) message.success("文件夹已移动"); }
        catch (error) { if (current(request)) message.error(report(error)); }
        finally { finish(request); }
    };
    const removeFromFolder = (ids: string[], tree: boolean) => {
        if (!currentFolder) return;
        const branch = new Set(tree ? folderDescendantIds(folders, currentFolder.id) : [currentFolder.id]);
        const removeFolderIds = [...new Set(assets.filter((asset) => ids.includes(asset.id)).flatMap((asset) => (asset.folderIds || []).filter((id) => branch.has(id))))];
        if (!removeFolderIds.length) { message.info("所选素材没有归入这些文件夹"); return; }
        void organize(ids, { removeFolderIds });
    };
    const saveToAccount = async (asset: Asset) => {
        if (!token) { message.info("请先登录后再存入账号素材库"); return; }
        if (!start()) return;
        const request = capture(); setSavingIds(new Set([asset.id]));
        try { await saveAssetToAccountLibrary(asset, request.token); if (current(request)) message.success("已存入账号素材库"); }
        catch (error) { if (current(request)) message.error(report(error)); }
        finally { if (current(request)) setSavingIds(new Set()); finish(request); }
    };
    const deleteRecord = async () => {
        if (!deleting || !start()) return;
        const request = capture();
        try {
            if (deleting.kind === "folder") await useAssetStore.getState().removeFolder(request.scope, deleting.id);
            else if (request.scope === "cloud") await useAssetStore.getState().removeCloudAsset(deleting.id, request.token);
            else await useAssetStore.getState().removeAsset(deleting.id);
            if (current(request)) { setDeleting(null); message.success("记录已移除，素材文件未删除"); }
        } catch (error) { if (current(request)) { setDraftError(report(error)); message.error(report(error)); } }
        finally { finish(request); }
    };
    const exportCollection = async () => {
        if (!start()) return;
        const request = capture();
        try { const source = selectedAssets.length ? selectedAssets : filtered; if (!source.length) throw new Error("当前没有可导出的素材"); await exportAssets(source, folders); if (current(request)) message.success("素材包已导出"); }
        catch (error) { if (current(request)) message.error(report(error)); }
        finally { finish(request); }
    };
    const importCollection = async (file?: File) => {
        if (!file || busyRef.current || !hydrated || owner === "pending" || !viewMatches()) return;
        busyRef.current = true; setBusy(true); setDraftError("");
        const request = capture();
        const parentId = request.scope === "local" ? currentFolder?.id || "" : "";
        try {
            const collection = await readAssetPackage(file);
            if (!current(request)) return;
            const wrapperId = useAssetStore.getState().importLocalCollection(collection, parentId);
            if (request.scope !== "local") { importedFolderRef.current = wrapperId; viewRef.current.version++; setScope("local"); resetView(); }
            setActiveId(wrapperId); setPage(1); setSelected(new Set()); setDetailId(""); message.success(`已将 ${collection.assets.length} 个素材导入当前浏览器`);
        } catch (error) { if (current(request)) message.error(report(error)); }
        finally { if (inputRef.current) inputRef.current.value = ""; finish(request); }
    };
    const toggle = (id: string) => setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else if (next.size < 200) next.add(id); else message.info("每次最多选择 200 个素材");
        return next;
    });
    const choose = (event: MouseEvent, asset: Asset) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) toggle(asset.id); else setSelected(new Set([asset.id]));
        setDetailId(asset.id);
    };
    const edit = (asset: Asset) => { if (!disabled) { setEditing(asset); setFormOpen(true); } };
    const assetMenu = (asset: Asset) => ({ items: [
        { key: "folders", label: "加入文件夹", disabled }, { key: "tags", label: "整理标签", disabled }, { key: "edit", label: "编辑素材", disabled },
        ...(currentFolder ? [{ key: "remove-folder", label: "移出当前文件夹", disabled }, { key: "remove-tree", label: "移出当前目录树", disabled }] : []),
        ...(scope === "local" ? [{ key: "cloud", label: "存入账号素材库", disabled: disabled || savingIds.has(asset.id) }] : []),
        { type: "divider" as const }, { key: "delete", label: "仅移除素材记录", danger: true, disabled },
        ...(scope === "cloud" && asset.kind !== "text" && /^server:[^:/\s]+$/.test(asset.data.storageKey || "") ? [{ key: "delete-file", label: "删除文件并释放空间", danger: true, disabled }] : []),
    ], onClick: ({ key }: { key: string }) => {
        if (!viewMatches()) return;
        if (key === "folders" || key === "tags") openOrganization(key, [asset.id]);
        else if (key === "edit") edit(asset);
        else if (key === "cloud") void saveToAccount(asset);
        else if (key === "remove-folder" || key === "remove-tree") removeFromFolder([asset.id], key === "remove-tree");
        else if (key === "delete") { setDraftError(""); setDeleting({ kind: "asset", id: asset.id, name: asset.title }); }
        else if (key === "delete-file" && asset.kind !== "text" && asset.data.storageKey?.startsWith("server:")) fileDeletion.requestDelete(asset.data.storageKey.slice(7));
    } });
    const dropAssets = (event: DragEvent, targetId: string) => {
        event.preventDefault();
        if (disabled) return;
        try { const data = JSON.parse(event.dataTransfer.getData(ASSET_DRAG_TYPE)); if (data.scope === scope && Array.isArray(data.ids) && data.ids.every((id: unknown) => typeof id === "string")) void organize(data.ids, { addFolderIds: [targetId] }); }
        catch { /* 外部拖放不作为素材整理指令。 */ }
    };
    const folderTree = <AssetFolderTree key={`${owner}:${scope}`} scope={scope} activeId={activeId} disabled={disabled} onSelect={selectFolder} onAction={openFolder} onAddAssets={(id, ids) => void organize(ids, { addFolderIds: [id] })} onMoveFolder={(id, parent) => void moveFolder(id, parent)} />;
    const detail = detailId ? <AssetDetailsPanel key={`${owner}:${scope}:${detailId}`} id={detailId} scope={scope} onClose={() => setDetailId("")} onEdit={edit} onSaveToAccount={(asset) => void saveToAccount(asset)} saving={savingIds.has(detailId)} /> : null;
    const moveExcluded = new Set(folderDraft?.id ? folderDescendantIds(folders, folderDraft.id) : []);
    const parentOptions = [{ value: "", title: "顶层文件夹", children: folderTreeOptions(folders.filter((folder) => !moveExcluded.has(folder.id))) }];

    return <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
        <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5"><Folder className="size-5 text-muted-foreground" /><h1 className="text-lg font-semibold tracking-tight">我的素材</h1><span className="hidden text-xs text-muted-foreground sm:inline">收藏、归类，随时调用。</span></div>
                <div className="flex shrink-0 items-center gap-1">
                    <Dropdown trigger={["click"]} menu={{ items: [{ key: "folder", label: "新建文件夹", disabled }, { key: "import", label: "导入素材包到浏览器", disabled: busy || !hydrated || owner === "pending" }, { key: "export", label: selected.size ? `导出已选 ${selected.size} 项` : "导出当前结果", disabled: disabled || !filtered.length }], onClick: ({ key }) => { if (key === "folder") openFolder("create"); else if (key === "import") inputRef.current?.click(); else void exportCollection(); } }}><button type="button" className={quietButton} aria-label="素材库更多操作"><MoreHorizontal className="size-4" /><span className="hidden sm:inline">更多</span></button></Dropdown>
                    <button type="button" className={quietButton + " bg-primary text-primary-foreground hover:bg-primary/90"} disabled={disabled} onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="size-4" /><span>新增素材</span></button>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1" aria-label="素材存储位置">{([{ value: "cloud", label: "账号素材库", Icon: Cloud, count: cloudAssets.length }, { value: "local", label: "当前浏览器", Icon: Monitor, count: localAssets.length }] as const).map(({ value, label, Icon, count }) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => changeScope(value)} className={cn("inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-xs transition focus-visible:outline-2 focus-visible:outline-ring", scope === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}><Icon className="size-3.5" />{label}<span className="text-[10px] tabular-nums text-muted-foreground">{count}</span></button>)}</div>
                <Input aria-label="搜索素材" placeholder="搜索名称、标签或内容" allowClear prefix={<Search className="mr-1 size-3.5 text-muted-foreground" />} value={keyword} onChange={(event) => { setKeyword(event.target.value); filterChanged(); }} className="w-full sm:!w-64" />
            </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
            <aside className="hidden w-52 shrink-0 border-r border-border/70 bg-card/20 lg:block">{folderTree}</aside>
            <section aria-label="素材浏览区" className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border/60 px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-2">
                        <button type="button" aria-label="打开素材目录" onClick={() => setTreeOpen(true)} className={quietButton + " -ml-2 !px-2 lg:hidden"}><Menu className="size-4" /></button>
                        <nav aria-label="素材面包屑" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs"><button type="button" onClick={() => selectFolder("")} className="shrink-0 py-2 text-muted-foreground hover:text-foreground">{scope === "cloud" ? "账号素材库" : "当前浏览器"}</button>{path.map((folder) => <span key={folder.id} className="flex shrink-0 items-center gap-1"><ChevronRight className="size-3 text-muted-foreground" /><button type="button" title={folder.name} className="max-w-40 truncate py-2 hover:underline" onClick={() => selectFolder(folder.id)}>{folder.name}</button></span>)}{activeId.startsWith("@") ? <><ChevronRight className="size-3 shrink-0 text-muted-foreground" /><span className="shrink-0">{heading}</span></> : null}</nav>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{filtered.length} 项</span>
                        {scope === "cloud" ? <Link href="/account/storage#account-files" className={quietButton + " !min-h-8 !px-2"}>文件管理</Link> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Select mode="multiple" aria-label="按类型筛选素材" placeholder="全部类型" value={kindFilters} options={kinds} maxTagCount="responsive" allowClear onChange={(values: AssetKind[]) => { setKindFilters(values); filterChanged(); }} className="w-32" size="small" />
                        <Select mode="multiple" aria-label="按全部标签筛选素材" placeholder="标签（同时满足）" value={tagFilters} options={tagOptions} maxTagCount="responsive" allowClear onChange={(values) => { setTagFilters(values); filterChanged(); }} className="min-w-36 flex-1 sm:max-w-64" size="small" />
                        <div className="ml-auto flex items-center gap-3">
                            <Select aria-label="素材排序" value={sort} onChange={(value) => { setSort(value); setPage(1); }} options={[{ value: "updated", label: "最近更新" }, { value: "created", label: "最近添加" }, { value: "name", label: "按名称" }]} size="small" className="w-28" />
                            <label className="hidden items-center gap-2 text-[10px] text-muted-foreground xl:flex">缩略图<Slider aria-label="缩略图尺寸" min={128} max={240} step={16} value={thumbnail} onChange={setThumbnail} tooltip={{ formatter: null }} className="!m-0 w-20" /></label>
                        </div>
                    </div>
                    {currentFolder ? <div className="mt-3 flex items-center justify-between gap-2"><Checkbox checked={includeChildren} onChange={(event) => { setIncludeChildren(event.target.checked); filterChanged(); }}><span className="text-[11px] text-muted-foreground">包含子文件夹</span></Checkbox><button type="button" disabled={disabled} onClick={() => openFolder("create", currentFolder)} className="text-[11px] text-muted-foreground underline-offset-4 hover:underline disabled:opacity-40">新建子文件夹</button></div> : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    {legacyAssets.length ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs"><p className="min-w-0 flex-1 leading-5 text-muted-foreground">发现 {legacyAssets.length} 项未分配的历史浏览器素材。确认后仅加入当前浏览器分区。</p><button type="button" disabled={disabled} className="shrink-0 underline underline-offset-4 disabled:opacity-40" onClick={() => { try { const count = useAssetStore.getState().restoreLegacyAssetsToCurrentBrowser(); changeScope("local"); message.success(`已恢复 ${count} 项到当前浏览器`); } catch (error) { message.error(report(error)); } }}>导入历史素材</button></div> : null}
                    {scope === "cloud" && cloudError ? <div role="alert" className="mb-4 rounded-lg border border-border px-4 py-3 text-xs text-destructive">{cloudError}<button type="button" className="ml-3 underline underline-offset-4" disabled={busy} onClick={() => void useAssetStore.getState().hydrateAccountAssets(token).catch(() => undefined)}>重新读取</button></div> : null}
                    {scope === "cloud" && !token ? <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-20 text-center"><Cloud className="mb-5 size-9 text-muted-foreground" /><h2 className="text-base font-semibold">登录后使用账号素材库</h2><p className="mt-3 text-xs leading-6 text-muted-foreground">当前浏览器素材仍保留在本机。登录不会自动上传或搬移已有内容。</p><Link href="/login?redirect=%2Fassets" className={quietButton + " mt-6 bg-primary text-primary-foreground hover:bg-primary/90"}>登录账号</Link><button type="button" onClick={() => changeScope("local")} className={quietButton + " mt-2"}>查看浏览器素材</button></div> : <>
                        {selected.size ? <div className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card px-2 py-2" aria-label="素材批量操作"><span className="px-2 text-xs font-medium tabular-nums">已选 {selected.size}</span><button type="button" disabled={disabled} onClick={() => openOrganization("folders", [...selected])} className={quietButton}><FolderInput className="size-3.5" />加入文件夹</button><button type="button" disabled={disabled} onClick={() => openOrganization("tags", [...selected])} className={quietButton}><Tags className="size-3.5" />增减标签</button>{currentFolder ? <Dropdown trigger={["click"]} disabled={disabled} menu={{ items: [{ key: "one", label: "移出当前文件夹" }, { key: "tree", label: "移出当前目录及子目录" }], onClick: ({ key }) => removeFromFolder([...selected], key === "tree") }}><button type="button" className={quietButton}><FolderMinus className="size-3.5" />移出</button></Dropdown> : null}<button type="button" aria-label="取消素材选择" onClick={() => setSelected(new Set())} className={quietButton + " ml-auto !px-2"}><X className="size-3.5" /></button></div> : null}
                        {childFolders.length && !keyword.trim() && !kindFilters.length && !tagFilters.length ? <div className="mb-6"><p className="mb-3 text-[10px] font-medium tracking-wider text-muted-foreground">文件夹 · {childFolders.length}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">{childFolders.map((folder) => <Dropdown key={folder.id} trigger={["contextMenu"]} menu={{ items: [{ key: "create", label: "新建子文件夹" }, { key: "rename", label: "重命名" }, { key: "move", label: "移动文件夹" }, { key: "delete", label: "移除文件夹", danger: true }], onClick: ({ key }) => openFolder(key as FolderAction, folder) }}><button type="button" onClick={() => selectFolder(folder.id)} onDragOver={(event) => { if (!disabled && event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "link"; } }} onDrop={(event) => dropAssets(event, folder.id)} className="flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-card/30 px-3 py-4 text-left transition hover:border-foreground/30 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"><Folder className="size-5 shrink-0 text-muted-foreground" /><span className="truncate text-xs font-medium">{folder.name}</span></button></Dropdown>)}</div></div> : null}
                        <div className="mb-3 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><h2 className="truncate text-sm font-semibold">{heading}</h2>{cloudLoading && scope === "cloud" ? <span className="text-[10px] text-muted-foreground" aria-live="polite">正在同步…</span> : null}</div><Checkbox disabled={!visible.length || busy} checked={Boolean(visible.length && visible.every((asset) => selected.has(asset.id)))} indeterminate={visible.some((asset) => selected.has(asset.id)) && !visible.every((asset) => selected.has(asset.id))} onChange={(event) => { if (event.target.checked) { const ids = new Set([...selected, ...visible.map((asset) => asset.id)]); if (ids.size > 200) { message.info("每次最多选择 200 个素材"); return; } setSelected(ids); } else setSelected(new Set([...selected].filter((id) => !visible.some((asset) => asset.id === id)))); }}><span className="text-[11px] text-muted-foreground">选择本页</span></Checkbox></div>
                        {visible.length ? <div className="grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--asset-size)),1fr))]" style={{ "--asset-size": `${thumbnail}px` } as CSSProperties}>
                            {visible.map((asset) => {
                                const cover = asset.kind === "image" ? asset.data.dataUrl : asset.coverUrl;
                                const checked = selected.has(asset.id);
                                return <Dropdown key={asset.id} menu={assetMenu(asset)} trigger={["contextMenu"]}><article role="button" tabIndex={0} aria-label={`查看${asset.title}`} aria-pressed={checked} draggable={!disabled} onDragStart={(event) => { const ids = checked ? [...selected] : [asset.id]; event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify({ scope, ids })); event.dataTransfer.effectAllowed = "link"; }} onClick={(event) => choose(event, asset)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelected(new Set([asset.id])); setDetailId(asset.id); } }} className={cn("group min-w-0 cursor-pointer rounded-xl border bg-card/20 p-1.5 outline-none transition focus-visible:ring-2 focus-visible:ring-ring", checked ? "border-foreground/60 bg-muted/30" : "border-transparent hover:border-border hover:bg-muted/20")}>
                                    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-muted/60">
                                        {cover ? <img src={cover} alt={asset.title} loading="lazy" decoding="async" className="size-full object-contain" /> : asset.kind === "video" ? <video src={asset.data.url + "#t=0.1"} preload="metadata" playsInline muted className="pointer-events-none size-full object-contain" /> : asset.kind === "audio" ? <Music2 className="size-9 text-muted-foreground/60" /> : asset.kind === "text" ? <p className="line-clamp-5 w-full whitespace-pre-wrap break-words p-4 text-[11px] leading-5 text-muted-foreground">{asset.data.content}</p> : <ImageIcon className="size-9 text-muted-foreground/60" />}
                                        <span className="absolute left-2 top-2" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`选择${asset.title}`} checked={checked} disabled={busy} onChange={() => toggle(asset.id)} /></span>
                                        <div className="absolute right-1.5 top-1.5" onClick={(event) => event.stopPropagation()}><Dropdown trigger={["click"]} menu={assetMenu(asset)}><button type="button" aria-label={`${asset.title}的操作`} className="flex size-8 items-center justify-center rounded-md border border-border/50 bg-background/90 text-foreground backdrop-blur-sm transition hover:bg-background"><MoreHorizontal className="size-4" /></button></Dropdown></div>
                                        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-background/90 px-1.5 py-1 text-[9px] text-muted-foreground">{asset.kind === "image" ? <ImageIcon className="size-2.5" /> : asset.kind === "video" ? <Video className="size-2.5" /> : asset.kind === "audio" ? <Music2 className="size-2.5" /> : <FileText className="size-2.5" />}{kinds.find((kind) => kind.value === asset.kind)?.label}</span>
                                    </div>
                                    <div className="px-1 pb-1 pt-2.5"><h3 className="truncate text-xs font-medium leading-5" title={asset.title}>{asset.title}</h3><div className="mt-1 flex min-h-5 min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-muted-foreground">{asset.tags?.length ? <>{asset.tags.slice(0, 2).map((tag) => <span key={tag} className="max-w-24 truncate rounded bg-muted/80 px-1.5 py-0.5">{tag}</span>)}{asset.tags.length > 2 ? <span>+{asset.tags.length - 2}</span> : null}</> : <span>{asset.kind !== "text" && "width" in asset.data && asset.data.width ? `${asset.data.width} × ${asset.data.height}` : "未打标签"}</span>}</div></div>
                                </article></Dropdown>;
                            })}
                        </div> : <div className="flex min-h-64 flex-col items-center justify-center px-5 py-12 text-center"><Folder className="mb-4 size-10 text-muted-foreground/40" /><h3 className="text-sm font-medium">{keyword || kindFilters.length || tagFilters.length ? "没有符合条件的素材" : "这里还没有素材"}</h3><p className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">{keyword || kindFilters.length || tagFilters.length ? "试试其他关键词，或减少筛选条件。" : currentFolder ? "将素材拖入文件夹，或选择素材后加入。文件只保存一份。" : "收集图片、视频、音频和文字，整理成自己的创作资料。"}</p>{keyword || kindFilters.length || tagFilters.length ? <button type="button" className={quietButton + " mt-3 underline underline-offset-4"} onClick={() => { setKeyword(""); setKindFilters([]); setTagFilters([]); filterChanged(); }}>清除筛选</button> : <button type="button" className={quietButton + " mt-4 border border-border"} disabled={disabled} onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="size-3.5" />新增素材</button>}</div>}
                        {filtered.length ? <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4"><p className="text-[10px] text-muted-foreground">{scope === "local" ? "文件保存在当前浏览器，清除网站数据前请先备份。" : "移除素材记录不删除文件，也不立即释放空间。"}</p><Pagination size="small" current={page} pageSize={pageSize} total={filtered.length} showSizeChanger={Boolean(screens.md)} pageSizeOptions={[24, 48, 96]} onChange={(value, size) => { setPage(value); setPageSize(size); }} /></div> : null}
                    </>}
                </div>
            </section>
            {detail && screens.xl ? <aside className="w-72 shrink-0 border-l border-border/70">{detail}</aside> : null}
        </div>

        <Drawer title="素材目录" open={treeOpen && !screens.lg} onClose={() => setTreeOpen(false)} placement="left" size={288} styles={{ body: { padding: 0 } }} destroyOnHidden>{folderTree}</Drawer>
        <Drawer title={null} closable={false} open={Boolean(detailId) && !screens.xl} onClose={() => setDetailId("")} size={360} styles={{ body: { padding: 0 }, wrapper: { maxWidth: "100vw" } }} destroyOnHidden>{detail}</Drawer>
        <AssetFormModal open={formOpen} asset={editing} scope={scope} defaultFolderIds={currentFolder ? [currentFolder.id] : []} onClose={() => { setFormOpen(false); setEditing(null); }} />
        {fileDeletion.dialog}
        <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" aria-label="导入素材压缩包" onChange={(event) => void importCollection(event.target.files?.[0])} />

        <Modal title={folderDraft?.action === "create" ? "新建文件夹" : folderDraft?.action === "move" ? "移动文件夹" : "重命名文件夹"} open={Boolean(folderDraft)} onCancel={() => { if (!busy) setFolderDraft(null); }} onOk={() => void saveFolder()} okText="保存" cancelText="取消" confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} keyboard={!busy} destroyOnHidden>
            <div className="space-y-5 py-3">{folderDraft?.action !== "move" ? <div><label htmlFor="asset-folder-name" className="mb-2 block text-xs font-medium">文件夹名称</label><Input id="asset-folder-name" autoFocus value={folderDraft?.name || ""} maxLength={80} disabled={busy} onChange={(event) => setFolderDraft((draft) => draft ? { ...draft, name: event.target.value } : draft)} onPressEnter={() => void saveFolder()} placeholder="例如：品牌参考、产品素材" /></div> : <p className="break-words text-sm">移动「{folderDraft.name}」</p>}{folderDraft?.action !== "rename" ? <div><label htmlFor="asset-folder-parent" className="mb-2 block text-xs font-medium">上级文件夹</label><TreeSelect id="asset-folder-parent" aria-label="上级文件夹" treeData={parentOptions} value={folderDraft?.parentId || ""} disabled={busy} onChange={(parentId) => setFolderDraft((draft) => draft ? { ...draft, parentId } : draft)} className="w-full" showSearch treeNodeFilterProp="title" treeDefaultExpandAll /></div> : null}<p className="text-xs leading-6 text-muted-foreground">文件夹只管理素材归属，不搬移或复制实际文件。同级不能重名，最多支持 8 层。</p>{draftError ? <p role="alert" className="text-xs text-destructive">{draftError}</p> : null}</div>
        </Modal>
        <Modal title={organization?.mode === "folders" ? "加入文件夹" : organization?.ids.length === 1 ? "整理标签" : "批量整理标签"} open={Boolean(organization)} onCancel={() => { if (!busy) setOrganization(null); }} onOk={saveOrganization} okText="保存整理" cancelText="取消" confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} keyboard={!busy} destroyOnHidden>
            <div className="space-y-5 py-3">
                <p className="text-xs text-muted-foreground">整理 {organization?.ids.length || 0} 个素材 · {scope === "cloud" ? "账号素材库" : "当前浏览器"}</p>
                {organization?.mode === "folders" ? <><TreeSelect aria-label="加入的文件夹" multiple treeData={treeOptions} value={organization.folders} disabled={busy} onChange={(value) => setOrganization((draft) => draft ? { ...draft, folders: value } : draft)} placeholder={folders.length ? "选择一个或多个文件夹" : "请先在目录树中新建文件夹"} className="w-full" maxTagCount="responsive" showSearch treeNodeFilterProp="title" /><p className="text-xs leading-6 text-muted-foreground">保留原有归属，将所选素材加入这些文件夹；不会复制文件或增加空间占用。</p></> : organization ? <>
                    <div>
                        <label htmlFor="asset-organize-tags" className="mb-2 block text-xs font-medium">标签</label>
                        <Select<string[]>
                            id="asset-organize-tags"
                            mode="tags"
                            aria-label="素材标签"
                            aria-describedby="asset-organize-tags-help"
                            options={tagOptions}
                            value={bulkTagValues(organization.tags)}
                            disabled={busy}
                            onChange={changeOrganizationTags}
                            showSearch={{ optionFilterProp: "label" }}
                            tokenSeparators={[",", "，"]}
                            className="w-full [&_.ant-select-content]:max-h-52 [&_.ant-select-content]:overflow-y-auto"
                            placeholder="选择已有标签，或输入后按回车创建"
                            tagRender={({ value, closable, onClose }) => {
                                const tag = String(value);
                                const count = organization.tags.counts.get(tag) || 0;
                                const partial = count > 0 && count < organization.tags.assetCount && !organization.tags.addTags.includes(tag);
                                return <span onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} className="my-0.5 mr-1 inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-xs leading-5">
                                    <span className="max-w-52 truncate" title={tag}>{tag}</span>
                                    {partial ? <span className="shrink-0 text-[10px] text-muted-foreground" title="只在部分所选素材中存在，未操作时保持原样">部分 {count}/{organization.tags.assetCount}</span> : null}
                                    {closable ? <button type="button" disabled={busy} aria-label={`移除标签${tag}`} onClick={(event) => { event.stopPropagation(); onClose(event); }} className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><X className="size-3" aria-hidden="true" /></button> : null}
                                </span>;
                            }}
                        />
                    </div>
                    <p id="asset-organize-tags-help" className="text-xs leading-6 text-muted-foreground">输入后按回车添加，点击 × 移除。{organization.tags.assetCount > 1 ? "“部分”标签保持原有归属；新增应用到全部所选素材，移除后重新添加也会应用到全部。" : ""}每份素材最多 50 个标签，每个标签最多 80 字。</p>
                </> : null}
                {draftError ? <p role="alert" className="text-xs text-destructive">{draftError}</p> : null}
            </div>
        </Modal>
        <Modal title={deleting?.kind === "folder" ? "移除文件夹？" : "移除素材记录？"} open={Boolean(deleting)} okText="确认移除" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={() => { if (!busy) setDeleting(null); }} onOk={() => void deleteRecord()}>
            <p className="my-4 break-words text-sm">{deleting?.name}</p><p className="text-xs leading-6 text-muted-foreground">{deleting?.kind === "folder" ? `将移除此文件夹及 ${Math.max(0, folderDescendantIds(folders, deleting.id).length - 1)} 个子文件夹，仅解除相应归属。素材和实际文件全部保留，其他文件夹归属不受影响。` : "只移除当前素材库中的这条记录，实际文件及已有画布引用保留。此操作不会立即释放账号存储空间。"}</p>{draftError ? <p role="alert" className="mt-3 text-xs text-destructive">{draftError}</p> : null}
        </Modal>
    </main>;
}
