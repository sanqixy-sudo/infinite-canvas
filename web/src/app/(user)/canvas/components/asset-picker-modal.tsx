"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Breadcrumb, Button, Empty, Input, Modal, Pagination, Select, Spin, Tabs, Tag, TreeSelect } from "antd";
import { Plus, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";
import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { folderDescendantIds, folderPath, folderTreeOptions, type AssetScope } from "@/lib/asset-organization";
import { copyLibraryAsset } from "@/services/asset-library-copy";
import { useUserStore } from "@/stores/use-user-store";
import type { InsertAssetPayload } from "../types";

export type { InsertAssetPayload } from "../types";

export type AssetPickerTab = "my-assets" | "library";

type Props = {
    open: boolean;
    defaultTab?: AssetPickerTab;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, defaultTab = "my-assets", onInsert, onClose }: Props) {
    const [activeTab, setActiveTab] = useState<AssetPickerTab>(defaultTab);

    useEffect(() => {
        if (open) setActiveTab(defaultTab);
    }, [open, defaultTab]);

    return (
        <Modal title="选择素材" open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as AssetPickerTab)}
                items={[
                    { key: "my-assets", label: "我的素材", children: <MyAssetsTab onInsert={onInsert} /> },
                    { key: "library", label: "素材库", children: <LibraryTab onInsert={onInsert} /> },
                ]}
            />
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

function LibraryTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("");
    const [page, setPage] = useState(1);
    const [inserting, setInserting] = useState<string | null>(null);

    const query = useQuery({
        queryKey: ["asset-picker-library", keyword, kindFilter, page],
        queryFn: () => fetchAssetLibrary({ keyword, type: kindFilter, page, pageSize: PAGE_SIZE }),
        retry: false,
    });

    const items = query.data?.items || [];
    const total = query.data?.total || 0;

    const handleInsert = async (asset: AssetLibraryItem) => {
        try {
            setInserting(asset.id);
            const { payload } = await copyLibraryAsset(asset.id);
            await onInsert(payload);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "插入失败");
        } finally {
            setInserting(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5 text-stone-400" />}
                    placeholder="搜索素材"
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <div className="flex gap-1.5">
                    {[
                        { label: "全部", value: "" },
                        { label: "文本", value: "text" },
                        { label: "图片", value: "image" },
                        { label: "视频", value: "video" },
                        { label: "音频", value: "audio" },
                    ].map((opt) => (
                        <Tag.CheckableTag
                            key={opt.value || "all"}
                            checked={kindFilter === opt.value}
                            className={cn("prompt-filter-tag", kindFilter === opt.value && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(opt.value);
                            }}
                        >
                            {opt.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            {query.isLoading ? (
                <div className="flex justify-center py-16">
                    <Spin />
                </div>
            ) : items.length ? (
                <div className="grid grid-cols-4 gap-3">
                    {items.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.type} cover={asset.coverUrl} loading={inserting === asset.id} onClick={() => void handleInsert(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有素材" className="py-12" />
            )}

            {total > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}

function PickerCard({ title, kind, cover, loading, onClick }: { title: string; kind: string; cover: string; loading?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
            onClick={onClick}
            disabled={loading}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{title}</span>
                    <Tag className="m-0 shrink-0 text-[10px]">{kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本"}</Tag>
                </div>
            </div>
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-stone-900/60">
                    <Spin size="small" />
                </div>
            )}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">插入</div>
        </button>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const token = useUserStore((state) => state.token);
    const localAssets = useAssetStore((state) => state.localAssets);
    const cloudAssets = useAssetStore((state) => state.cloudAssets);
    const localFolders = useAssetStore((state) => state.localFolders);
    const cloudFolders = useAssetStore((state) => state.cloudFolders);
    const cloudLoading = useAssetStore((state) => state.cloudLoading);
    const [scope, setScope] = useState<AssetScope>(token ? "cloud" : "local");
    const [folderId, setFolderId] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const assets = scope === "cloud" ? cloudAssets : localAssets;
    const folders = scope === "cloud" ? cloudFolders : localFolders;
    const tagOptions = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).sort().map((value) => ({ value, label: value })), [assets]);
    const trail = folderId && folderId !== "__unfiled__" ? folderPath(folders, folderId) : [];

    useEffect(() => {
        setScope(token ? "cloud" : "local");
        setFolderId("");
        setSelectedTags([]);
        setKeyword("");
        setKindFilter("all");
        setPage(1);
    }, [token]);

    useEffect(() => {
        if (folderId && folderId !== "__unfiled__" && !cloudLoading && !folders.some((folder) => folder.id === folderId)) { setFolderId(""); setPage(1); }
    }, [cloudLoading, folderId, folders]);

    const selectFolder = (id = "") => { setFolderId(id); setPage(1); };
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const branch = new Set(folderId && folderId !== "__unfiled__" ? folderDescendantIds(folders, folderId) : []);
        return assets
            .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
            .filter((asset) => !folderId || (folderId === "__unfiled__" ? !asset.folderIds?.length : asset.folderIds?.some((id) => branch.has(id))))
            .filter((asset) => selectedTags.every((tag) => asset.tags?.includes(tag)))
            .filter((asset) => !query || [asset.title, asset.category || "", ...(asset.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, folders, folderId, keyword, kindFilter, selectedTags]);
    const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    useEffect(() => {
        setPage((value) => Math.min(value, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))));
    }, [filtered.length]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id, source: "asset" });
        } else {
            onInsert(
                asset.kind === "video"
                    ? { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, source: "asset" }
                    : asset.kind === "audio"
                      ? { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, bytes: asset.data.bytes, mimeType: asset.data.mimeType, durationMs: asset.data.durationMs, source: "asset" }
                      : { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, source: "asset" },
            );
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Select<AssetScope>
                    aria-label="素材保存位置"
                    size="small"
                    className="w-36"
                    value={scope}
                    options={[{ value: "cloud", label: "账号素材库", disabled: !token }, { value: "local", label: "当前浏览器" }]}
                    onChange={(value) => { setScope(value); setFolderId(""); setSelectedTags([]); setPage(1); }}
                />
                <TreeSelect
                    aria-label="素材目录"
                    size="small"
                    className="min-w-40 flex-1"
                    allowClear
                    showSearch
                    treeNodeFilterProp="title"
                    value={folderId || undefined}
                    treeData={[{ value: "__unfiled__", title: "未归类" }, ...folderTreeOptions(folders)]}
                    placeholder="全部目录"
                    onChange={(value) => selectFolder(value)}
                />
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>新增素材</Button>
            </div>
            <Breadcrumb items={[
                { title: <button type="button" onClick={() => selectFolder()}>全部素材</button> },
                ...(folderId === "__unfiled__" ? [{ title: "未归类" }] : trail.map((folder) => ({ title: <button type="button" onClick={() => selectFolder(folder.id)}>{folder.name}</button> }))),
            ]} />
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    className="min-w-40 flex-1"
                    size="small"
                    prefix={<Search className="size-3.5" />}
                    placeholder="搜索标题、标签或分类"
                    value={keyword}
                    allowClear
                    onChange={(event) => { setPage(1); setKeyword(event.target.value); }}
                />
                <Select
                    aria-label="素材标签"
                    mode="multiple"
                    size="small"
                    className="min-w-40 flex-1"
                    allowClear
                    maxTagCount={2}
                    placeholder="筛选标签"
                    options={tagOptions}
                    value={selectedTags}
                    onChange={(value) => { setSelectedTags(value); setPage(1); }}
                />
            </div>
            <div className="flex flex-wrap gap-1.5">
                {kindOptions.map((option) => (
                    <Tag.CheckableTag key={option.value} checked={kindFilter === option.value} className={cn("prompt-filter-tag", kindFilter === option.value && "is-active")} onChange={() => { setPage(1); setKindFilter(option.value); }}>{option.label}</Tag.CheckableTag>
                ))}
            </div>
            {scope === "cloud" && cloudLoading ? (
                <div className="flex justify-center py-12"><Spin /></div>
            ) : visible.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {visible.map((asset) => <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")} onClick={() => handleInsert(asset)} />)}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword || folderId || selectedTags.length ? "没有符合条件的素材" : scope === "cloud" ? "账号素材库暂无素材" : "当前浏览器暂无素材"} className="py-12" />
            )}
            {filtered.length > PAGE_SIZE ? <div className="flex justify-center"><Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} /></div> : null}
            <AssetFormModal open={createOpen} scope={scope} defaultFolderIds={folderId && folderId !== "__unfiled__" ? [folderId] : []} onClose={() => setCreateOpen(false)} />
        </div>
    );
}
