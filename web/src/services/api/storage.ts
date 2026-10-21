import { apiDelete, apiGet, apiPost } from "@/services/api/request";
import { notifyAccountWalletRefresh } from "@/lib/account-wallet-events";
import type { UserWebDAVStorageProvider } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";

export type RegisteredStorageObject = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
};

export type StorageObjectInfo = {
    id: string;
    objectKey: string;
    publicUrl: string;
    mimeType: string;
    bytes: number;
    direct: boolean;
    contentUrl: string;
};

export function getStorageObjectInfo(id: string) {
    return apiGet<StorageObjectInfo>(`/api/files/${encodeURIComponent(id)}`, undefined, useUserStore.getState().token);
}

const contentUrls = new Map<string, { url: string; expiresAt: number }>();

export function isStorageContentUrl(value: string) {
    try {
        const url = new URL(value, window.location.origin);
        return url.origin === window.location.origin && /^\/api\/files\/[^/]+\/content$/.test(url.pathname);
    } catch {
        return false;
    }
}

export async function getStorageContentUrl(id: string, details?: StorageObjectInfo) {
    const key = `${useUserStore.getState().token}:${id}`;
    const cached = contentUrls.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const info = details || await getStorageObjectInfo(id);
    const url = info.publicUrl || info.contentUrl;
    contentUrls.set(key, { url, expiresAt: Date.now() + 50 * 60 * 1000 });
    return url;
}

export async function registerDirectStorageObject(
    token: string,
    payload: { provider: UserWebDAVStorageProvider; objectKey: string; mimeType: string; bytes: number },
) {
    const object = await apiPost<RegisteredStorageObject>("/api/v1/files/direct", payload, token);
    notifyAccountWalletRefresh();
    return object;
}

export async function deleteDirectStorageObjectRecord(token: string, id: string) {
    const result = await apiDelete<boolean>(`/api/v1/files/${encodeURIComponent(id)}/record`, token);
    notifyAccountWalletRefresh();
    return result;
}
