import type { Asset } from "@/stores/use-asset-store";

export type AssetScope = "local" | "cloud";
export type AssetFolder = { id: string; name: string; parentId: string; createdAt: string; updatedAt: string };
export type AssetFolderInput = { id?: string; name?: string; parentId?: string };
export type AssetOrganizationPatch = { folderIds?: string[]; addFolderIds?: string[]; removeFolderIds?: string[]; addTags?: string[]; removeTags?: string[] };
export type AssetFolderTreeOption = { value: string; title: string; children?: AssetFolderTreeOption[] };

export function normalizeAssetTags(values: readonly string[]) {
    const tags = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    if (tags.length > 50 || tags.some((tag) => [...tag].length > 80)) throw new Error("每个素材最多 50 个标签，每个标签最多 80 字");
    return tags;
}

export function folderPath(folders: readonly AssetFolder[], id: string): AssetFolder[] {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const path: AssetFolder[] = [];
    const visited = new Set<string>();
    let folder = byId.get(id);
    while (folder && !visited.has(folder.id)) {
        path.unshift(folder);
        visited.add(folder.id);
        folder = byId.get(folder.parentId);
    }
    return path;
}

export function folderDescendantIds(folders: readonly AssetFolder[], id: string, includeSelf = true): string[] {
    const ids = new Set([id]);
    for (const parentId of ids) for (const folder of folders) if (folder.parentId === parentId) ids.add(folder.id);
    if (!includeSelf) ids.delete(id);
    return [...ids];
}

export function folderTreeOptions(folders: readonly AssetFolder[]): AssetFolderTreeOption[] {
    const build = (parentId: string, visited: ReadonlySet<string>): AssetFolderTreeOption[] => folders.filter((folder) => folder.parentId === parentId && !visited.has(folder.id)).map((folder) => {
        const children = build(folder.id, new Set([...visited, folder.id]));
        return { value: folder.id, title: folder.name, ...(children.length ? { children } : {}) };
    });
    return build("", new Set());
}

// 搜索结果包含匹配目录的父级，便于保留树形层级。
export function searchAssetFolders(folders: readonly AssetFolder[], query: string): AssetFolder[] {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return [...folders];
    const ids = new Set(folders.filter((folder) => folder.name.toLocaleLowerCase().includes(keyword)).flatMap((folder) => folderPath(folders, folder.id).map((item) => item.id)));
    return folders.filter((folder) => ids.has(folder.id));
}

export function countFolderAssets(assets: readonly Pick<Asset, "folderIds">[], folders: readonly AssetFolder[], id: string, includeDescendants = true): number {
    const ids = new Set(includeDescendants ? folderDescendantIds(folders, id) : [id]);
    return assets.filter((asset) => asset.folderIds?.some((folderId) => ids.has(folderId))).length;
}

export function validateAssetFolders(folders: readonly AssetFolder[]) {
    if (folders.length > 1000) throw new Error("每个素材库最多 1000 个文件夹");
    const ids = new Set(folders.map((folder) => folder.id));
    const siblings = new Set<string>();
    if (ids.size !== folders.length) throw new Error("文件夹标识重复");
    for (const folder of folders) {
        if (!folder.id || !folder.name.trim() || [...folder.name].length > 80) throw new Error("文件夹名称不能为空且最多 80 字");
        if (folder.parentId && !ids.has(folder.parentId)) throw new Error("上级文件夹不存在");
        const siblingKey = JSON.stringify([folder.parentId, folder.name.trim().toLocaleLowerCase()]);
        if (siblings.has(siblingKey)) throw new Error("同级文件夹不能重名");
        siblings.add(siblingKey);
        const path = folderPath(folders, folder.id);
        if (path[0]?.parentId) throw new Error("不能把文件夹移动到自己或子文件夹中");
        if (path.length > 8) throw new Error("文件夹最多支持 8 层");
    }
}

export function normalizeAssetFolderIds(ids: readonly string[], folders: readonly AssetFolder[], limit = 32) {
    const values = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (values.length > limit) throw new Error(limit === 32 ? "每个素材最多归入 32 个文件夹" : "目录数量超出限制");
    const available = new Set(folders.map((folder) => folder.id));
    if (values.some((id) => !available.has(id))) throw new Error("目标文件夹不存在，请刷新后重试");
    return values;
}

export function organizeAsset<T extends Pick<Asset, "tags" | "folderIds">>(asset: T, patch: AssetOrganizationPatch, folders: readonly AssetFolder[]): T {
    const addedFolders = normalizeAssetFolderIds(patch.addFolderIds || [], folders);
    const removedFolders = new Set(normalizeAssetFolderIds(patch.removeFolderIds || [], folders, 1000));
    if (patch.folderIds !== undefined && (addedFolders.length || removedFolders.size)) throw new Error("不能同时替换与增减文件夹归属");
    if (addedFolders.some((id) => removedFolders.has(id))) throw new Error("不能同时添加和移除同一文件夹");
    const folderIds = normalizeAssetFolderIds([...(patch.folderIds ?? asset.folderIds ?? []), ...addedFolders].filter((id) => !removedFolders.has(id)), folders);
    const addedTags = normalizeAssetTags(patch.addTags || []);
    const removedTags = new Set(normalizeAssetTags(patch.removeTags || []));
    if (addedTags.some((tag) => removedTags.has(tag))) throw new Error("不能同时添加和移除同一标签");
    const tags = normalizeAssetTags([...(asset.tags || []), ...addedTags].filter((tag) => !removedTags.has(tag.trim())));
    return { ...asset, folderIds, tags };
}
