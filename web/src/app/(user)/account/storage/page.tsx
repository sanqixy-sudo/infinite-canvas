"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { App, Input, Pagination, Select } from "antd";
import { ArrowLeft, ArrowUpRight, Check, Cloud, File, HardDrive, Image as ImageIcon, Monitor, Music2, Plus, RotateCcw, Trash2, Video } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { useAccountWallet } from "@/hooks/use-account-wallet";
import { storageProviderLabels, useStorageFileDeletion } from "@/hooks/use-storage-file-deletion";
import { formatStorageBytes } from "@/lib/wallet-display";
import { useStoragePreferencesStore } from "@/stores/use-storage-preferences-store";
import { useUserStore } from "@/stores/use-user-store";
import { fetchAccountStorageFiles, type StorageFileType } from "@/services/api/storage";

const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const fileTypeOptions = [{ value: "", label: "全部类型" }, { value: "image", label: "图片" }, { value: "video", label: "视频" }, { value: "audio", label: "音频" }, { value: "other", label: "其他文件" }];
const fileDateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

export default function StorageSettingsPage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const preferences = useStoragePreferencesStore();
    const wallet = useAccountWallet();
    const fileDeletion = useStorageFileDeletion();
    const [autoSave, setAutoSave] = useState(false);
    const [saving, setSaving] = useState(false);
    const [fileSearch, setFileSearch] = useState("");
    const [fileKeyword, setFileKeyword] = useState("");
    const [fileType, setFileType] = useState<StorageFileType | "">("");
    const [filePage, setFilePage] = useState(1);
    const files = useQuery({
        queryKey: ["storage-files", token, filePage, fileKeyword, fileType],
        queryFn: () => fetchAccountStorageFiles(token, { page: filePage, pageSize: 20, keyword: fileKeyword, type: fileType }),
        enabled: Boolean(isReady && token && user?.id),
    });
    const loaded = Boolean(token && preferences.token === token && preferences.ready);
    const storage = wallet.data?.storage;
    const percent = storage ? storage.limitBytes > 0 ? Math.min(100, storage.usedBytes / storage.limitBytes * 100) : storage.usedBytes > 0 ? 100 : 0 : 0;

    useEffect(() => {
        setAutoSave(loaded ? preferences.autoSaveAssetsToCloud : false);
        setSaving(false);
    }, [token, loaded, preferences.autoSaveAssetsToCloud]);
    useEffect(() => { setFileSearch(""); setFileKeyword(""); setFileType(""); setFilePage(1); }, [token]);
    useEffect(() => {
        if (files.data) setFilePage((page) => Math.min(page, Math.max(1, Math.ceil(files.data.total / 20))));
    }, [files.data]);

    const save = async () => {
        const requestToken = token;
        setSaving(true);
        try {
            await preferences.save(requestToken, autoSave);
            if (useUserStore.getState().token === requestToken) message.success("存储设置已保存，将用于之后的新素材");
        } catch (error) {
            if (useUserStore.getState().token === requestToken) message.error(error instanceof Error ? error.message : "设置未保存，请重试");
        } finally {
            if (useUserStore.getState().token === requestToken) setSaving(false);
        }
    };

    if (!isReady) return <main className="p-6 text-sm text-muted-foreground" aria-live="polite">正在读取存储设置…</main>;

    return <main className="h-full overflow-y-auto px-5 py-7 md:px-9 md:py-9">
        <div className="mx-auto max-w-4xl">
            <Link href="/account" className="inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-3.5" />个人中心</Link>
            <header className="mb-8 mt-6"><p className="text-xs font-medium text-muted-foreground">个人中心 / 存储设置</p><h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">让每份素材，都有合适的归处。</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">在当前浏览器轻松创作，或存入账号素材库，留给下次灵感。</p></header>

            <section aria-label="账号素材空间" className="rounded-2xl border border-border bg-card p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-5"><div><h2 className="flex items-center gap-2 text-sm font-medium"><Cloud className="size-4" />账号素材空间</h2><div className="mt-5 flex flex-wrap items-baseline gap-2 tabular-nums"><strong className="text-3xl font-semibold tracking-tight sm:text-4xl">{storage ? formatStorageBytes(storage.usedBytes) : "—"}</strong><span className="text-sm text-muted-foreground">/ {storage ? formatStorageBytes(storage.limitBytes) : user ? "读取中" : "登录后查看"}</span></div></div><Link href={user ? "/account/recharge?kind=storage" : "/login?redirect=%2Faccount%2Fstorage"} className={actionClass}><Plus className="size-4" />空间扩容</Link></div>
                {storage ? <><div role="progressbar" aria-label="账号空间使用率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="mt-6 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${storage.overLimit ? "bg-destructive" : "bg-primary"}`} style={{ width: `${percent}%` }} /></div><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{storage.overLimit ? "空间已超限，已有素材保留，新增保存需清理或扩容。" : `剩余 ${formatStorageBytes(storage.remainingBytes)}`}</span><span>基础 {formatStorageBytes(storage.baseBytes)} · 已扩容 {formatStorageBytes(storage.extraBytes)}</span></div></> : null}
                {wallet.isError ? <p role="alert" className="mt-4 text-sm text-destructive">空间用量读取失败。<button type="button" className="ml-2 underline underline-offset-4" onClick={() => void wallet.refetch()}>重新读取</button></p> : null}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="max-w-xl text-xs leading-6 text-muted-foreground">仅统计实际保存到账号的文件；当前浏览器里的内容不占用此额度。素材仅本人可见。</p><Link href="/assets" className="inline-flex items-center gap-1.5 text-xs font-medium underline-offset-4 hover:underline">管理我的素材<ArrowUpRight className="size-3.5" /></Link></div>
            </section>

            <section id="account-files" aria-labelledby="account-files-title" className="mt-8 scroll-mt-6">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="account-files-title" className="text-base font-semibold">账号文件管理</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">这里列出所有占用账号空间的文件，包括已移除素材记录的文件。仅移除素材记录不会释放空间。</p></div><button type="button" onClick={() => { void files.refetch(); void wallet.refetch(); }} disabled={files.isFetching} className={actionClass + " !min-h-9 !px-3 !text-xs"}><RotateCcw className={`size-3.5 ${files.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />刷新</button></div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row"><Input.Search aria-label="搜索账号文件" placeholder="搜索文件名称或类型" allowClear value={fileSearch} onChange={(event) => { setFileSearch(event.target.value); if (!event.target.value) { setFileKeyword(""); setFilePage(1); } }} onSearch={(value) => { setFileKeyword(value.trim()); setFilePage(1); }} className="min-w-0 flex-1" /><Select<StorageFileType | ""> aria-label="按文件类型筛选" value={fileType} options={fileTypeOptions} onChange={(value) => { setFileType(value); setFilePage(1); }} className="w-full sm:!w-36" /></div>
                <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card" aria-busy={files.isFetching}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground"><span>{files.data ? `${fileKeyword || fileType ? "筛选到" : "共"} ${files.data.total} 个文件` : "读取文件列表"}</span><span>账号已用 {storage ? formatStorageBytes(storage.usedBytes) : "—"}</span></div>
                    {files.isLoading ? <p role="status" className="px-5 py-10 text-center text-sm text-muted-foreground">正在读取账号文件…</p> : files.isError ? <div role="alert" className="px-5 py-8 text-center"><p className="text-sm text-destructive">{files.error instanceof Error ? files.error.message : "文件列表读取失败"}</p><button type="button" onClick={() => void files.refetch()} className="mt-3 text-xs underline underline-offset-4">重新读取</button></div> : files.data?.items.length ? <div className="divide-y divide-border">{files.data.items.map((entry) => {
                        const file = entry.file;
                        const Icon = file.mimeType.startsWith("image/") ? ImageIcon : file.mimeType.startsWith("video/") ? Video : file.mimeType.startsWith("audio/") ? Music2 : File;
                        const created = new Date(file.createdAt);
                        const references = [entry.assetCount ? `${entry.assetCount} 条素材记录` : "", entry.completedTaskCount ? `${entry.completedTaskCount} 处已完成任务输出` : ""].filter(Boolean).join(" · ");
                        return <article key={file.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground"><Icon className="size-4" strokeWidth={1.5} /></span>
                                <div className="min-w-0 flex-1">
                                    <h3 className="break-all text-[13px] font-medium leading-6">{file.name || "未命名文件"}</h3>
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground"><span>{formatStorageBytes(file.bytes)}</span><span>{storageProviderLabels[file.providerType] || "账号存储"}</span><span>{Number.isNaN(created.getTime()) ? "—" : fileDateFormatter.format(created)}</span></div>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{file.deletePending ? "上次删除尚未完成，仍计入账号用量" : entry.canDelete ? references || "无素材记录，仍占用账号空间" : entry.reason || "仍有引用，暂不能删除"}</p>
                                </div>
                            </div>
                            <button type="button" onClick={() => fileDeletion.requestDelete(file.id)} disabled={fileDeletion.busy} className={actionClass + " self-end !min-h-9 !px-3 !text-xs sm:self-auto"}><Trash2 className="size-3.5" />{entry.canDelete ? file.deletePending ? "重试删除" : "删除文件" : "查看引用"}</button>
                        </article>;
                    })}</div> : <p className="px-5 py-10 text-center text-sm text-muted-foreground">{fileKeyword || fileType ? "没有找到符合条件的文件" : "账号中还没有保存文件"}</p>}
                    {files.data && files.data.total > 20 ? <div className="flex justify-end border-t border-border px-4 py-3"><Pagination size="small" current={filePage} pageSize={20} total={files.data.total} showLessItems showSizeChanger={false} onChange={setFilePage} /></div> : null}
                </div>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">删除前会检查画布、生成历史等引用。仍被引用的文件会受到保护；每次删除均需单独确认。</p>
            </section>

            <section aria-label="默认保存方式" className="mt-8">
                <h2 className="text-base font-semibold">默认保存方式</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">选择新生成和导入的图片、视频、音频保存在哪里。</p>
                <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
                    <label className="flex cursor-pointer items-start gap-4 p-5 sm:p-6">
                        <input type="checkbox" checked={autoSave} disabled={!loaded || saving} onChange={(event) => setAutoSave(event.target.checked)} className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed" aria-describedby="auto-save-description" />
                        <span><span className="block text-sm font-semibold">自动存入账号素材库</span><span id="auto-save-description" className="mt-2 block text-xs leading-6 text-muted-foreground">开启后，新素材自动加入账号素材库，可在其他设备继续使用，并占用个人空间。未开启时保存在当前浏览器，需要时再手动存入。</span></span>
                    </label>
                    <div className="flex gap-3 border-t border-border bg-muted/30 px-5 py-4 text-xs leading-6 sm:px-6" aria-live="polite">{autoSave ? <Cloud className="mt-1 size-4 shrink-0" /> : <Monitor className="mt-1 size-4 shrink-0" />}<div><strong className="font-medium">{autoSave ? "新素材 → 账号素材库" : "新素材 → 当前浏览器"}</strong><p className="text-muted-foreground">{autoSave ? "保存失败时保留本地内容，并提供重新入库的入口。" : "仅此浏览器可访问。清除网站数据或更换设备前，请先入库或下载备份。"}</p></div></div>
                </div>
                {!user ? <p className="mt-4 text-sm text-muted-foreground">当前使用浏览器保存。<Link href="/login?redirect=%2Faccount%2Fstorage" className="ml-2 font-medium text-foreground underline underline-offset-4">登录后设置账号保存偏好</Link></p> : !loaded && preferences.error && preferences.token === token ? <p role="alert" className="mt-4 text-sm text-destructive">设置读取失败，当前不会自动入库。<button type="button" className="ml-2 underline underline-offset-4" onClick={() => void preferences.load(token).catch(() => undefined)}>重新读取</button></p> : !loaded ? <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">正在读取账号偏好…</p> : null}
                {loaded && preferences.error ? <p role="alert" className="mt-4 text-sm text-destructive">更改未保存，仍使用之前的设置。请重试保存。</p> : null}
                <div className="mt-5 flex flex-wrap items-center gap-4"><button type="button" disabled={!loaded || saving || autoSave === preferences.autoSaveAssetsToCloud} onClick={() => void save()} aria-busy={saving} className={actionClass + " border-transparent bg-primary text-primary-foreground hover:bg-primary/90"}>{saving ? <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <Check className="size-4" />}保存设置</button><span className="text-xs text-muted-foreground">仅影响之后的新内容，已有素材保持原位。</span></div>
            </section>

            <section aria-label="手动保存素材" className="mb-5 mt-9 grid gap-4 border-t border-border pt-6 sm:grid-cols-[auto_minmax(0,1fr)]"><HardDrive className="size-5 text-muted-foreground" /><div><h2 className="text-sm font-medium">想留下的，再存入素材库。</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">在画布中右键图片、视频或音频，选择「存入账号素材库」。手机可使用节点工具栏的「更多」菜单。重复保存同一份素材不会重复入库。</p><p className="mt-2 text-xs leading-6 text-muted-foreground">保存位置只影响素材文件；模型调用仍使用平台云端渠道。</p></div></section>
        </div>
        {fileDeletion.dialog}
    </main>;
}
