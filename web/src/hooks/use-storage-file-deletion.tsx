"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { App, Button, Checkbox, Modal } from "antd";
import { FileWarning, LoaderCircle, RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { notifyAccountWalletRefresh } from "@/lib/account-wallet-events";
import { hasStorageFileReference } from "@/lib/storage-file-reference";
import { formatStorageBytes } from "@/lib/wallet-display";
import { clearStorageContentUrl, deleteAccountStorageFile, fetchStorageFileReferences, getStorageContentUrl, getStorageObjectInfo, type StorageFileBlocker, type StorageFileReferences } from "@/services/api/storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

const blockerLabels: Record<string, string> = { canvas: "画布", imageHistory: "图片历史", videoHistory: "视频历史", activeTask: "进行中任务", published: "公开内容", otherAccount: "其他账号引用", unverified: "尚未核实的引用", browserCanvas: "当前浏览器画布", browserAsset: "当前浏览器素材" };
export const storageProviderLabels: Record<string, string> = { local: "服务器本地", s3: "对象存储 / R2", webdav: "WebDAV" };
type Target = { id: string; token: string; version: number; request: number };

async function browserBlockers(id: string, target: Target): Promise<StorageFileBlocker[]> {
    const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
    await new Promise<void>((resolve, reject) => {
        let offCanvas = () => {};
        let offAssets = () => {};
        const timer = setTimeout(() => finish(new Error("当前浏览器创作数据尚未加载，暂不能安全删除；请稍后重新检查")), 7000);
        function finish(error?: Error) { clearTimeout(timer); offCanvas(); offAssets(); if (error) reject(error); else resolve(); }
        function check() {
            const session = useUserStore.getState();
            const canvas = useCanvasStore.getState();
            const assets = useAssetStore.getState();
            if (session.token !== target.token || session.sessionVersion !== target.version) return finish(new Error("登录状态已变化，请重新操作"));
            if (canvas.loadError) return finish(new Error(canvas.loadError));
            if (canvas.hydrated && canvas.ownerId === session.user?.id && assets.hydrated && assets.owner === `user:${session.user?.id}`) finish();
        }
        offCanvas = useCanvasStore.subscribe(check);
        offAssets = useAssetStore.subscribe(check);
        check();
    });
    const session = useUserStore.getState();
    if (session.token !== target.token || session.sessionVersion !== target.version) throw new Error("登录状态已变化，请重新操作");
    const canvas = useCanvasStore.getState();
    const assets = useAssetStore.getState();
    if (!canvas.hydrated || canvas.ownerId !== session.user?.id || !assets.hydrated || assets.owner !== `user:${session.user?.id}`) throw new Error("当前浏览器创作数据尚未加载，暂不能安全删除；请稍后重新检查");
    const origin = window.location.origin;
    return [
        ...canvas.projects.filter((project) => hasStorageFileReference(project, id, origin)).map((project) => ({ type: "browserCanvas", id: project.id, title: project.title || "未命名画布" })),
        ...assets.localAssets.filter((asset) => hasStorageFileReference(asset, id, origin)).map((asset) => ({ type: "browserAsset", id: asset.id, title: asset.title || "未命名素材" })),
    ];
}

export function useStorageFileDeletion() {
    const { message } = App.useApp();
    const client = useQueryClient();
    const token = useUserStore((state) => state.token);
    const sessionVersion = useUserStore((state) => state.sessionVersion);
    const request = useRef(0);
    const mounted = useRef(true);
    const deleting = useRef(false);
    const [target, setTarget] = useState<Target | null>(null);
    const [report, setReport] = useState<StorageFileReferences | null>(null);
    const [localReferences, setLocalReferences] = useState<StorageFileBlocker[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState("");
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
    const sameSession = (value: Target) => useUserStore.getState().token === value.token && useUserStore.getState().sessionVersion === value.version;
    const current = (value: Target) => mounted.current && request.current === value.request && sameSession(value);
    const open = Boolean(target && target.token === token && target.version === sessionVersion);
    const hasLinkedRecords = Boolean(report && (report.assetCount > 0 || report.completedTaskCount > 0));

    const loadPreview = async (value: Target, references: StorageFileReferences) => {
        if (references.file.deletePending || !/^(image|video|audio)\//.test(references.file.mimeType) || !current(value)) return;
        setPreviewLoading(true); setPreviewError(""); setPreviewUrl("");
        try {
            const details = await getStorageObjectInfo(value.id);
            if (!current(value)) return;
            const url = await getStorageContentUrl(value.id, details);
            if (current(value)) { if (!url) throw new Error("预览地址不可用"); setPreviewUrl(url); }
        } catch { if (current(value)) setPreviewError("预览暂时无法读取，不影响引用检查结果。请确认文件身份后再删除。"); }
        finally { if (current(value)) setPreviewLoading(false); }
    };
    const load = async (value: Target) => {
        setLoading(true); setError(""); setConfirmed(false); setReport(null); setLocalReferences([]);
        setPreviewUrl(""); setPreviewError(""); setPreviewLoading(false);
        try {
            const [references, local] = await Promise.all([fetchStorageFileReferences(value.token, value.id), browserBlockers(value.id, value)]);
            if (current(value)) { setReport(references); setLocalReferences(local); void loadPreview(value, references); }
        } catch (failure) { if (current(value)) setError(failure instanceof Error ? failure.message : "引用检查失败，请重试"); }
        finally { if (current(value)) setLoading(false); }
    };
    const requestDelete = (id: string) => {
        const session = useUserStore.getState();
        if (deleting.current || !session.token || !session.isReady || !session.user?.id) return;
        const value = { id, token: session.token, version: session.sessionVersion, request: ++request.current };
        setTarget(value); setBusy(false); void load(value);
    };
    const close = () => { if (!deleting.current) { request.current++; setTarget(null); } };
    const remove = async () => {
        if (!target || !report || !current(target) || deleting.current || loading || !report.canDelete || localReferences.length || hasLinkedRecords && !confirmed) return;
        deleting.current = true; setBusy(true); setError("");
        try {
            const local = await browserBlockers(target.id, target);
            if (!current(target)) return;
            if (local.length) { setLocalReferences(local); throw new Error("当前浏览器仍在引用此文件，请先解除引用"); }
            const deleted = await deleteAccountStorageFile(target.token, target.id, hasLinkedRecords && confirmed);
            clearStorageContentUrl(target.id, target.token);
            if (!sameSession(target)) return;
            notifyAccountWalletRefresh();
            const results = await Promise.allSettled([
                import("@/services/storage-file-cache").then(({ invalidateStorageFileCaches }) => invalidateStorageFileCaches(report.file.storageKey, target.token)),
                useAssetStore.getState().hydrateAccountAssets(target.token),
                client.invalidateQueries({ queryKey: ["storage-files", target.token] }),
            ]);
            if (!current(target)) return;
            setTarget(null);
            if (results.some((result) => result.status === "rejected")) message.warning(`文件已删除，释放 ${formatStorageBytes(deleted.freedBytes)}；部分列表刷新失败，请重新读取。`);
            else message.success(`文件已删除，释放 ${formatStorageBytes(deleted.freedBytes)}`);
        } catch (failure) { if (current(target)) setError(failure instanceof Error ? failure.message : "删除未完成，请重试"); }
        finally { deleting.current = false; if (current(target)) setBusy(false); }
    };
    const blockers = [...(report?.blockers || []), ...localReferences.filter((local) => !report?.blockers?.some((remote) => local.type === "browserCanvas" && remote.type === "canvas" && remote.id === local.id))];
    const canDelete = Boolean(report?.canDelete && !blockers.length);
    const previewFailed = () => { if (target && current(target)) { setPreviewUrl(""); setPreviewError("文件预览不可用，不影响引用检查结果。"); } };
    const dialog = <Modal title="删除文件并释放空间" open={open} centered styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto", scrollbarGutter: "stable" } }} onCancel={close} onOk={() => void remove()} okText="永久删除文件" cancelText="取消" okButtonProps={{ danger: true, disabled: loading || !canDelete || hasLinkedRecords && !confirmed }} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} mask={{ closable: !busy }} keyboard={!busy} destroyOnHidden>
        {open ? <div className="space-y-4 py-3">
            {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />正在检查文件及引用…</p> : null}
            {report ? <>
                <div className="rounded-lg border border-border bg-muted/30 p-4"><p className="break-all text-sm font-medium">{report.file.name}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{formatStorageBytes(report.file.bytes)}</span><span>{storageProviderLabels[report.file.providerType] || "账号存储"}</span><span>{report.assetCount} 条素材记录</span><span>{report.completedTaskCount} 处已完成任务输出</span></div></div>
                {report.file.deletePending ? <p className="text-xs leading-6 text-muted-foreground">上次删除尚未完成，文件索引仍计入账号用量，暂不能预览。可以重新确认并重试删除。</p> : <>
                    {previewLoading ? <p role="status" className="text-xs text-muted-foreground">正在读取文件预览…</p> : null}
                    {previewUrl ? <div className="overflow-hidden rounded-lg border border-border bg-muted/30 p-2">{report.file.mimeType.startsWith("image/") ? <img key={previewUrl} src={previewUrl} alt="待删除图片预览" className="mx-auto max-h-56 max-w-full object-contain" onError={previewFailed} /> : report.file.mimeType.startsWith("video/") ? <video key={previewUrl} src={previewUrl} controls playsInline preload="metadata" aria-label="待删除视频预览" className="mx-auto max-h-56 w-full" onError={previewFailed} /> : <audio key={previewUrl} src={previewUrl} controls preload="metadata" aria-label="待删除音频预览" className="w-full" onError={previewFailed} />}</div> : null}
                    {previewError ? <p className="text-xs leading-6 text-muted-foreground">{previewError}<button type="button" disabled={busy} className="ml-2 underline underline-offset-4" onClick={() => { if (target) void loadPreview(target, report); }}>重试预览</button></p> : null}
                </>}
                {blockers.length || !report.canDelete ? <div className="rounded-lg border border-border p-4"><p className="flex items-start gap-2 text-sm font-medium"><FileWarning className="mt-0.5 size-4 shrink-0" />{!report.canDelete ? report.reason || "此文件仍被引用，暂不能删除" : "当前浏览器仍在使用此文件"}</p><ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs leading-6 text-muted-foreground">{blockers.map((blocker, index) => <li key={`${blocker.type}:${blocker.id}:${index}`} className="break-words">{blockerLabels[blocker.type] || "文件引用"} · {blocker.title || blocker.id}{(blocker.type === "canvas" || blocker.type === "browserCanvas") && blocker.id ? <Link href={`/canvas/${encodeURIComponent(blocker.id)}`} onClick={close} className="ml-2 whitespace-nowrap text-foreground underline underline-offset-4">打开画布</Link> : null}</li>)}</ul><p className="mt-3 text-xs leading-6 text-muted-foreground">请先在对应画布、历史或任务中解除引用，再重新检查。</p></div> : <>
                    <p className="text-sm leading-7">将永久删除此文件，预计释放 <strong className="font-medium">{formatStorageBytes(report.file.bytes)}</strong>。文件删除后无法在此恢复。</p>
                    <p className="text-xs leading-6 text-muted-foreground">删除文件后，已完成任务中对应的文件输出也将不可用；计费和任务审计记录保留。</p>
                    {hasLinkedRecords ? <Checkbox checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)}><span className="text-[13px] leading-6">我确认同时移除 {report.assetCount} 条账号素材记录及 {report.completedTaskCount} 处已完成任务输出链接</span></Checkbox> : <p className="text-xs text-muted-foreground">此文件已无账号素材记录或任务输出链接，删除仍会释放其占用空间。</p>}
                </>}
            </> : null}
            {error ? <p role="alert" className="break-words text-sm leading-6 text-destructive">{error}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} disabled={loading || busy} onClick={() => { if (target) { const value = { ...target, request: ++request.current }; setTarget(value); void load(value); } }}>重新检查引用</Button>{busy ? <span className="text-xs text-muted-foreground">账号文件管理</span> : <Link href="/account/storage#account-files" onClick={close} className="text-xs text-muted-foreground underline underline-offset-4">账号文件管理</Link>}</div>
            <p className="text-xs leading-6 text-muted-foreground">检查范围包含账号记录与当前账号在本浏览器加载的画布和素材。其他设备或浏览器中尚未同步的草稿无法检测，请确认不再需要后删除。</p>
        </div> : null}
    </Modal>;
    return { requestDelete, dialog, busy: open && busy };
}
