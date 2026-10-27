import { apiGet, apiPost } from "./request";

export type StoragePreferences = { autoSaveAssetsToCloud: boolean };

export function fetchStoragePreferences(token: string) {
    return apiGet<StoragePreferences>("/api/v1/storage-preferences", undefined, token);
}

export function saveStoragePreferences(token: string, value: boolean) {
    return apiPost<StoragePreferences>("/api/v1/storage-preferences", { autoSaveAssetsToCloud: value }, token);
}
