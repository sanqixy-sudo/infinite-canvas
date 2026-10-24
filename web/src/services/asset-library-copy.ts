"use client";

import type { InsertAssetPayload } from "@/app/(user)/canvas/types";
import { fetchAssetLibraryItem } from "@/services/api/assets";
import { downloadRemoteMedia, uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";

// 收藏和插入都先重新读取库条目，再保存独立副本；公共原件下架不会影响已有作品。
export async function copyLibraryAsset(id: string) {
    const token = useUserStore.getState().token;
    const asset = await fetchAssetLibraryItem(id);
    const base = { title: asset.title, assetId: asset.id, source: "library" as const };
    let payload: InsertAssetPayload;
    const assertSession = () => {
        if (useUserStore.getState().token !== token) throw new Error("登录状态已变化，请重试");
    };
    assertSession();
    if (asset.type === "text") {
        payload = { ...base, kind: "text", content: asset.content };
    } else {
        const blob = await downloadRemoteMedia(asset.url);
        assertSession();
        if (asset.type === "image") {
            const image = await uploadImage(blob, { localOnly: !token, token });
            payload = { ...base, ...image, kind: "image", dataUrl: image.url };
        } else {
            const file = await uploadMediaFile(blob, asset.type, undefined, token, !token);
            payload = asset.type === "video" ? { ...base, ...file, kind: "video" } : { ...base, ...file, kind: "audio" };
        }
    }
    assertSession();
    return { asset, payload };
}
