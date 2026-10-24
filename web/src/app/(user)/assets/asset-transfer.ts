import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { readFileAsDataUrl } from "@/lib/image-utils";
import { createZip, readZip } from "@/lib/zip";
import { assertStorageSession } from "@/services/automatic-media-save";
import { downloadRemoteMedia, getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";
import { normalizeAssetTags, validateAssetFolders, type AssetFolder } from "@/lib/asset-organization";
import { useUserStore } from "@/stores/use-user-store";

type AssetExportItem = { storageKey: string; path: string; mimeType: string; bytes: number };
type AssetExportFile = { app: "infinite-canvas"; version: 1 | 2; exportedAt: string; assets: Asset[]; folders?: AssetFolder[]; files: AssetExportItem[] };
export type AssetCollection = { assets: Asset[]; folders: AssetFolder[] };

export async function exportAssets(assets: Asset[], folders: AssetFolder[] = []) {
    const token = useUserStore.getState().token;
    validateAssetFolders(folders);
    const files = new Map<string, Promise<AssetExportItem>>();
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const addFile = (key: string, kind: "image" | "video" | "audio", url: string, storedKey?: string) => {
        const existing = files.get(key);
        if (existing) return existing;
        const request = (async () => {
            try {
                assertStorageSession(token);
                const cached = storedKey ? await (kind === "image" ? getImageBlob(storedKey) : getMediaBlob(storedKey)).catch(() => null) : null;
                assertStorageSession(token);
                const fallback = storedKey?.startsWith("server:") ? "" : url;
                const address = cached ? "" : kind === "image" ? await resolveImageUrl(storedKey, fallback) : await resolveMediaUrl(storedKey, fallback);
                assertStorageSession(token);
                const blob = cached || (address ? await downloadRemoteMedia(address) : null);
                assertStorageSession(token);
                if (!blob?.size) throw new Error("文件不存在");
                const path = `files/${nanoid()}.${fileExtension(blob.type, kind)}`;
                zipFiles.push({ name: path, data: blob });
                return { storageKey: key, path, mimeType: blob.type || (kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg"), bytes: blob.size };
            } catch (error) {
                assertStorageSession(token);
                throw new Error(`无法完整导出素材文件：${error instanceof Error ? error.message : "读取失败"}`);
            }
        })();
        files.set(key, request);
        return request;
    };
    const snapshots: Asset[] = [];
    for (const asset of assets) {
        let snapshot = { ...asset, tags: [...(asset.tags || [])], folderIds: [...(asset.folderIds || [])], data: { ...asset.data } } as Asset;
        const mediaUrl = asset.kind === "text" ? "" : asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        if (asset.kind !== "text") {
            const key = asset.data.storageKey || `asset:${asset.id}`;
            await addFile(key, asset.kind, mediaUrl, asset.data.storageKey);
            if (snapshot.kind === "image") snapshot.data = { ...snapshot.data, storageKey: key, dataUrl: "" };
            else if (snapshot.kind !== "text") snapshot.data = { ...snapshot.data, storageKey: key, url: "" };
        }
        if (asset.coverUrl && asset.coverUrl !== mediaUrl) {
            const key = `cover:${asset.id}`;
            await addFile(key, "image", asset.coverUrl);
            snapshot = { ...snapshot, coverUrl: `package:${key}` };
        } else snapshot.coverUrl = "";
        snapshots.push(snapshot);
    }
    const folderIds = new Set(folders.map((folder) => folder.id));
    if (snapshots.some((asset) => asset.folderIds?.some((id) => !folderIds.has(id)))) throw new Error("导出缺少素材所属的目录，请选择对应存储位置后重试");
    const data: AssetExportFile = { app: "infinite-canvas", version: 2, exportedAt: new Date().toISOString(), assets: snapshots, folders, files: await Promise.all(files.values()) };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    assertStorageSession(token);
    saveAs(zip, "我的素材.zip");
}

export async function readAssetPackage(file: File): Promise<AssetCollection> {
    const token = useUserStore.getState().token;
    const zip = await readZip(file);
    assertStorageSession(token);
    const manifest = zip.get("assets.json");
    if (!manifest) throw new Error("素材包缺少 assets.json");
    const data = JSON.parse(await manifest.text()) as AssetExportFile;
    assertStorageSession(token);
    if (data.app !== "infinite-canvas" || ![1, 2].includes(data.version) || !Array.isArray(data.assets) || !Array.isArray(data.files) || data.folders !== undefined && !Array.isArray(data.folders)) throw new Error("素材包格式无效");
    const folders = data.folders || [];
    if (folders.some((folder) => !folder || typeof folder.id !== "string" || typeof folder.name !== "string" || typeof folder.parentId !== "string")) throw new Error("素材包目录结构无效");
    validateAssetFolders(folders);
    const folderIds = new Map(folders.map((folder) => [folder.id, `folder-${nanoid()}`]));
    const fileMap = new Map<string, AssetExportItem>();
    for (const item of data.files) {
        if (!item || typeof item.storageKey !== "string" || typeof item.path !== "string" || typeof item.mimeType !== "string" || fileMap.has(item.storageKey) || !zip.get(item.path)?.size) throw new Error("素材包中的媒体文件缺失或重复，已取消导入");
        fileMap.set(item.storageKey, item);
    }
    for (const asset of data.assets) {
        if (!asset || !["text", "image", "video", "audio"].includes(asset.kind) || typeof asset.title !== "string" || typeof asset.coverUrl !== "string" || !asset.data || !Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== "string") || asset.folderIds !== undefined && (!Array.isArray(asset.folderIds) || asset.folderIds.length > 32 || asset.folderIds.some((id) => !folderIds.has(id)))) throw new Error("素材包中的素材或目录归属无效");
        normalizeAssetTags(asset.tags);
        if (asset.kind === "text" ? typeof asset.data.content !== "string" : !asset.data.storageKey || !fileMap.has(asset.data.storageKey)) throw new Error(`“${asset.title}”缺少完整内容，已取消导入`);
        if (typeof asset.coverUrl === "string" && asset.coverUrl.startsWith("package:") && !fileMap.has(asset.coverUrl.slice(8))) throw new Error(`“${asset.title}”缺少封面文件，已取消导入`);
    }
    const now = new Date().toISOString();
    const copies = new Map<string, { storageKey: string; url: string; bytes: number; mimeType: string }>();
    const imported: Asset[] = [];
    for (const asset of data.assets) {
        assertStorageSession(token);
        let next = { ...asset, id: nanoid(), createdAt: now, updatedAt: now, tags: [...asset.tags], folderIds: (asset.folderIds || []).map((id) => folderIds.get(id)!), data: { ...asset.data } } as Asset;
        if (asset.kind !== "text" && next.kind !== "text") {
            const oldKey = asset.data.storageKey!;
            const copyKey = `${asset.kind}:${oldKey}`;
            let copy = copies.get(copyKey);
            if (!copy) {
                const item = fileMap.get(oldKey)!;
                const raw = zip.get(item.path)!;
                const blob = raw.slice(0, raw.size, item.mimeType);
                const storageKey = `${asset.kind}:${nanoid()}`;
                const url = await (asset.kind === "image" ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob));
                assertStorageSession(token);
                copy = { storageKey, url, bytes: blob.size, mimeType: item.mimeType };
                copies.set(copyKey, copy);
            }
            if (next.kind === "image") next = { ...next, data: { ...next.data, ...copy, dataUrl: copy.url } };
            else if (next.kind === "video") next = { ...next, data: { ...next.data, ...copy } };
            else next = { ...next, data: { ...next.data, ...copy } };
        }
        if (asset.coverUrl?.startsWith("package:")) {
            const item = fileMap.get(asset.coverUrl.slice(8))!;
            next.coverUrl = await readFileAsDataUrl(new File([zip.get(item.path)!], "cover", { type: item.mimeType }));
            assertStorageSession(token);
        } else next.coverUrl = next.kind === "image" ? next.data.dataUrl : asset.coverUrl || "";
        imported.push(next);
    }
    assertStorageSession(token);
    return { assets: imported, folders: folders.map((folder) => ({ ...folder, id: folderIds.get(folder.id)!, parentId: folder.parentId ? folderIds.get(folder.parentId)! : "", createdAt: now, updatedAt: now })) };
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    return kind === "image" ? "png" : "bin";
}
