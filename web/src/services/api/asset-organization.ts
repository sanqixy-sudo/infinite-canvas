import { apiDelete, apiPost } from "./request";
import type { Asset } from "@/stores/use-asset-store";
import type { AssetFolder, AssetFolderInput, AssetOrganizationPatch } from "@/lib/asset-organization";

export type AssetOrganizationSnapshot = { assets: Asset[]; folders: AssetFolder[] };

export function saveUserAssetFolder(token: string, folder: AssetFolderInput) {
    return apiPost<AssetOrganizationSnapshot>("/api/v1/user-data/asset-folders", folder, token);
}

export function deleteUserAssetFolder(token: string, id: string) {
    return apiDelete<AssetOrganizationSnapshot>(`/api/v1/user-data/asset-folders/${encodeURIComponent(id)}`, token);
}

export function organizeUserAssets(token: string, ids: string[], patch: AssetOrganizationPatch) {
    return apiPost<AssetOrganizationSnapshot>("/api/v1/user-data/assets/organize", { ids, ...patch }, token);
}
