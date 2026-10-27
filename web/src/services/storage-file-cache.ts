"use client";

import { useUserStore } from "@/stores/use-user-store";
import { clearStorageContentUrl } from "@/services/api/storage";

// 只在服务端确认删除后清理该文件的缓存，独立的浏览器素材副本保持不变。
export async function invalidateStorageFileCaches(storageKey: string, token: string) {
    if (!/^server:[^:/\s]+$/.test(storageKey) || useUserStore.getState().token !== token) return;
    const [images, media, assets] = await Promise.all([
        import("@/services/image-storage"),
        import("@/services/file-storage"),
        import("@/services/account-asset-save"),
    ]);
    if (useUserStore.getState().token !== token) return;
    clearStorageContentUrl(storageKey.slice("server:".length), token);
    images.clearAutoSyncCache(storageKey);
    assets.invalidateAccountAssetFile(storageKey, token);
    await Promise.allSettled([
        images.invalidateImageFileCache(storageKey),
        media.invalidateMediaFileCache(storageKey),
    ]);
}
