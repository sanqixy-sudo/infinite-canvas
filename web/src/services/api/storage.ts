import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";
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

export type StorageFileType = "image" | "video" | "audio" | "other";
export type AccountStorageFile = {
    id: string;
    storageKey: string;
    name: string;
    mimeType: string;
    bytes: number;
    createdAt: string;
    providerType: string;
    deletePending: boolean;
};
export type StorageFileBlocker = { type: string; id: string; title: string };
export type StorageFileReferences = {
    file: AccountStorageFile;
    assetCount: number;
    completedTaskCount: number;
    blockers: StorageFileBlocker[];
    canDelete: boolean;
    reason: string;
};
export type StorageFileDeletion = { deletedId: string; freedBytes: number };

export function fetchAccountStorageFiles(token: string, query: { page?: number; pageSize?: number; keyword?: string; type?: StorageFileType | "" } = {}) {
    return apiGet<{ items: StorageFileReferences[]; total: number }>("/api/v1/files", compactApiParams(query), token);
}

export function fetchStorageFileReferences(token: string, id: string) {
    return apiGet<StorageFileReferences>(`/api/v1/files/${encodeURIComponent(id)}/references`, undefined, token);
}

export function deleteAccountStorageFile(token: string, id: string, removeAssetRecords: boolean) {
    return apiDelete<StorageFileDeletion>(`/api/v1/files/${encodeURIComponent(id)}`, token, { removeAssetRecords });
}

export function getStorageObjectInfo(id: string) {
    return apiGet<StorageObjectInfo>(`/api/files/${encodeURIComponent(id)}`, undefined, useUserStore.getState().token);
}

const contentUrls = new Map<string, { url: string; expiresAt: number }>();

export function clearStorageContentUrl(id: string, token: string) {
    contentUrls.delete(`${token}:${id}`);
}

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
