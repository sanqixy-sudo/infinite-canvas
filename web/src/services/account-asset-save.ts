"use client";

import { clearAutomaticMediaCache, getPendingAutomaticCloudCopy, type SavedAutomaticMedia } from "@/services/automatic-media-save";
import { resolveImageUrl, uploadRemoteImageToServer } from "@/services/image-storage";
import { resolveMediaUrl, uploadRemoteMediaToServer } from "@/services/file-storage";
import { useAssetStore, type AssetInput } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

const uploadedFiles = new Map<string, SavedAutomaticMedia>();
const saving = new Map<string, Promise<AssetInput & { id: string }>>();
let ownerToken = "";

function resetSession(token: string) {
    uploadedFiles.clear();
    saving.clear();
    ownerToken = token;
}

useUserStore.subscribe((state, previous) => {
    if (state.token !== previous.token) resetSession(state.token);
});

function rememberFile(key: string, file: SavedAutomaticMedia) {
    if (key.length > 2048) return;
    uploadedFiles.delete(key);
    uploadedFiles.set(key, { url: file.url, storageKey: file.storageKey, bytes: file.bytes, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs });
    while (uploadedFiles.size > 200) uploadedFiles.delete(uploadedFiles.keys().next().value!);
}

// 文件已上传而登记失败时复用原文件；只有文件与条目都保存后才报告入库成功。
export function saveAssetToAccountLibrary(asset: AssetInput, token = useUserStore.getState().token): Promise<AssetInput & { id: string }> {
    if (!token || useUserStore.getState().token !== token) return Promise.reject(new Error("请先登录后再存入账号素材库"));
    if (ownerToken !== token) resetSession(token);
    const source = asset.kind === "text" ? asset.id || asset.data.content : asset.data.storageKey || (asset.kind === "image" ? asset.data.dataUrl : asset.data.url);
    const key = `${asset.kind}:${source}`;
    const previous = saving.get(key);
    if (previous) return previous.then(() => saveAssetToAccountLibrary(asset, token));
    const request = (async () => {
        const assertSession = () => { if (useUserStore.getState().token !== token) throw new Error("登录状态已变化，请重试"); };
        let next = asset;
        if (next.kind !== "text" && !next.data.storageKey?.startsWith("server:")) {
            let uploaded = uploadedFiles.get(key) || getPendingAutomaticCloudCopy(source);
            if (next.kind === "image") {
                if (!uploaded) {
                    const url = await resolveImageUrl(next.data.storageKey, next.data.dataUrl);
                    assertSession();
                    uploaded = await uploadRemoteImageToServer(url, next.title || "image", token);
                }
                assertSession();
                next = { ...next, coverUrl: uploaded.url, data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width || next.data.width, height: uploaded.height || next.data.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType } };
            } else {
                if (!uploaded) {
                    const url = await resolveMediaUrl(next.data.storageKey, next.data.url);
                    assertSession();
                    uploaded = await uploadRemoteMediaToServer(url, next.title || next.kind, token);
                }
                assertSession();
                next = { ...next, coverUrl: "", data: { ...next.data, url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType } } as AssetInput;
            }
            assertSession();
            rememberFile(key, uploaded);
        }
        assertSession();
        let id: string;
        try { id = await useAssetStore.getState().saveCloudAsset(next, token); }
        catch (error) {
            if (useUserStore.getState().token === token && ownerToken === token && error instanceof Error && error.message === "素材文件不存在或不属于当前账号") {
                const fileKey = uploadedFiles.get(key)?.storageKey || (asset.kind === "text" ? "" : asset.data.storageKey);
                for (const [sourceKey, saved] of uploadedFiles) if (sourceKey === key || fileKey && saved.storageKey === fileKey) uploadedFiles.delete(sourceKey);
                clearAutomaticMediaCache(source);
                if (fileKey) clearAutomaticMediaCache(fileKey);
            }
            throw error;
        }
        assertSession();
        return { ...next, id };
    })();
    saving.set(key, request);
    void request.finally(() => { if (saving.get(key) === request) saving.delete(key); }).catch(() => undefined);
    return request;
}
