"use client";

import { useEffect, useState } from "react";
import { App, Image, Select, TreeSelect } from "antd";
import { Cloud, Download, FileText, HardDrive, Music2, PencilLine, X } from "lucide-react";
import { saveAs } from "file-saver";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { folderTreeOptions, type AssetScope } from "@/lib/asset-organization";
import { formatBytes } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";

export function AssetDetailsPanel({ id, scope, onClose, onEdit, onSaveToAccount, saving }: { id: string; scope: AssetScope; onClose: () => void; onEdit: (asset: Asset) => void; onSaveToAccount: (asset: Asset) => void; saving: boolean }) {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const token = useUserStore((state) => state.token);
    const assets = useAssetStore((state) => scope === "cloud" ? state.cloudAssets : state.localAssets);
    const folders = useAssetStore((state) => scope === "cloud" ? state.cloudFolders : state.localFolders);
    const asset = assets.find((item) => item.id === id);
    const [tags, setTags] = useState<string[]>([]);
    const [folderIds, setFolderIds] = useState<string[]>([]);
    const [organizing, setOrganizing] = useState(false);
    useEffect(() => { setTags(asset?.tags || []); setFolderIds(asset?.folderIds || []); setOrganizing(false); }, [id, scope, token]);
    if (!asset) return <div className="p-6 text-xs text-muted-foreground">此素材已移除或不可用。<button type="button" onClick={onClose} className="ml-2 underline">关闭详情</button></div>;
    const dirty = JSON.stringify([...tags].sort()) !== JSON.stringify([...(asset.tags || [])].sort()) || JSON.stringify([...folderIds].sort()) !== JSON.stringify([...(asset.folderIds || [])].sort());
    const commit = async () => {
        const requestToken = token;
        setOrganizing(true);
        try {
            await useAssetStore.getState().updateAsset(asset.id, { tags, folderIds });
            if (useUserStore.getState().token === requestToken) message.success("归属和标签已保存");
        } catch (error) { if (useUserStore.getState().token === requestToken) message.error(error instanceof Error ? error.message : "整理未保存，请重试"); }
        finally { if (useUserStore.getState().token === requestToken) setOrganizing(false); }
    };
    return <section aria-label="素材详情" className="flex h-full min-h-0 flex-col bg-card/30">
        <header className="flex min-h-14 items-center justify-between border-b border-border/70 px-5"><span className="text-xs font-medium">素材详情</span><button type="button" aria-label="关闭素材详情" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X className="size-4" /></button></header>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
            <div className="overflow-hidden rounded-xl bg-muted/50">
                {asset.kind === "image" ? <Image src={asset.data.dataUrl} alt={asset.title} className="max-h-64 object-contain" styles={{ root: { width: "100%" } }} /> : asset.kind === "video" ? <video src={asset.data.url} controls preload="metadata" className="max-h-64 w-full" /> : asset.kind === "audio" ? <div className="space-y-5 p-4"><Music2 className="mx-auto my-3 size-10 text-muted-foreground" /><audio src={asset.data.url} controls preload="metadata" className="w-full" /></div> : <p className="max-h-64 whitespace-pre-wrap break-words overflow-y-auto p-4 text-xs leading-6">{asset.data.content}</p>}
            </div>
            <div><h2 className="break-words text-base font-semibold leading-6">{asset.title}</h2><p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">{scope === "cloud" ? <Cloud className="size-3.5" /> : <HardDrive className="size-3.5" />}{scope === "cloud" ? "已存入账号素材库" : "仅当前浏览器"}</p></div>
            <div className="space-y-4 border-t border-border/70 pt-5">
                <div><label htmlFor="asset-detail-folders" className="mb-2 block text-xs font-medium">文件夹</label><TreeSelect id="asset-detail-folders" aria-label="素材所属文件夹" multiple allowClear showSearch treeNodeFilterProp="title" treeData={folderTreeOptions(folders)} value={folderIds} onChange={setFolderIds} maxTagCount="responsive" placeholder={folders.length ? "选择一个或多个文件夹" : "先在左侧新建文件夹"} disabled={organizing} className="w-full" /></div>
                <div><label htmlFor="asset-detail-tags" className="mb-2 block text-xs font-medium">标签</label><Select id="asset-detail-tags" aria-label="素材标签" mode="tags" value={tags} onChange={setTags} tokenSeparators={[",", "，"]} maxTagCount="responsive" options={Array.from(new Set(assets.flatMap((item) => item.tags || []))).map((value) => ({ value, label: value }))} placeholder="输入后按回车" disabled={organizing} className="w-full" /></div>
                <button type="button" disabled={!dirty || organizing} onClick={() => void commit()} className="min-h-9 w-full rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">{organizing ? "保存中…" : "保存归属与标签"}</button>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-border/70 pt-5 text-[11px] leading-5"><dt className="text-muted-foreground">类型</dt><dd className="break-all">{asset.kind === "text" ? "文本" : asset.data.mimeType}</dd>{asset.kind !== "text" ? <><dt className="text-muted-foreground">文件大小</dt><dd>{formatBytes(asset.data.bytes || 0)}</dd></> : null}{(asset.kind === "image" || asset.kind === "video") && asset.data.width ? <><dt className="text-muted-foreground">尺寸</dt><dd>{asset.data.width} × {asset.data.height}</dd></> : null}{asset.source ? <><dt className="text-muted-foreground">来源</dt><dd className="break-words">{asset.source}</dd></> : null}{asset.category ? <><dt className="text-muted-foreground">原分类</dt><dd className="break-words">{asset.category}</dd></> : null}<dt className="text-muted-foreground">添加时间</dt><dd>{displayDate(asset.createdAt)}</dd></dl>
            {scope === "local" ? <div className="border-t border-border/70 pt-5"><p className="mb-3 text-[11px] leading-5 text-muted-foreground">文件夹和标签只整理当前浏览器。存入账号后可跨设备使用。</p><button type="button" disabled={saving} onClick={() => onSaveToAccount(asset)} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs hover:bg-muted disabled:opacity-40"><Cloud className="size-3.5" />{saving ? "正在入库…" : "存入账号素材库"}</button></div> : null}
        </div>
        <footer className="flex gap-2 border-t border-border/70 p-4"><button type="button" onClick={() => onEdit(asset)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border text-xs hover:bg-muted"><PencilLine className="size-3.5" />编辑内容</button><button type="button" onClick={() => asset.kind === "text" ? copyText(asset.data.content, "文本已复制") : saveAs(asset.kind === "image" ? asset.data.dataUrl : asset.data.url, `${asset.title || "素材"}.${asset.data.mimeType.split("/")[1]?.replace("svg+xml", "svg") || "bin"}`)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border text-xs hover:bg-muted">{asset.kind === "text" ? <FileText className="size-3.5" /> : <Download className="size-3.5" />}{asset.kind === "text" ? "复制文本" : "下载文件"}</button></footer>
    </section>;
}

function displayDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
