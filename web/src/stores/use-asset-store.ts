"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { deleteUserAssetItem, fetchUserAssetData, saveUserAssetItem } from "@/services/api/user-config";
import { useUserStore } from "@/stores/use-user-store";
import { deleteUserAssetFolder, organizeUserAssets, saveUserAssetFolder, type AssetOrganizationSnapshot } from "@/services/api/asset-organization";
import { folderDescendantIds, folderPath, normalizeAssetFolderIds, normalizeAssetTags, organizeAsset, validateAssetFolders, type AssetFolder, type AssetFolderInput, type AssetOrganizationPatch, type AssetScope } from "@/lib/asset-organization";

export type { AssetFolder, AssetFolderInput, AssetOrganizationPatch, AssetScope } from "@/lib/asset-organization";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes?: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;
export type AssetInput = Asset extends infer T ? T extends Asset ? Omit<T, "id" | "createdAt" | "updatedAt"> & { id?: string } : never : never;
type AssetPatch = Partial<Omit<Asset, "id" | "createdAt">>;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    folderIds?: string[];
    category?: string;
    source?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    assets: Asset[];
    localAssets: Asset[];
    cloudAssets: Asset[];
    localFolders: AssetFolder[];
    cloudFolders: AssetFolder[];
    legacyBrowserAssets: Asset[];
    localAssetsByOwner: Record<string, Asset[]>;
    localFoldersByOwner: Record<string, AssetFolder[]>;
    owner: string;
    hydrated: boolean;
    cloudLoading: boolean;
    error: string;
    addAsset: (asset: AssetInput) => string;
    updateAsset: (id: string, patch: AssetPatch) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    saveCloudAsset: (asset: AssetInput, token?: string) => Promise<string>;
    updateCloudAsset: (id: string, patch: AssetPatch, token?: string) => Promise<void>;
    removeCloudAsset: (id: string, token?: string) => Promise<void>;
    selectAssetSession: (resolveLocal?: boolean) => void;
    hydrateAccountAssets: (token: string, syncEnabled?: boolean) => Promise<void>;
    syncAccountAssets: (token: string) => Promise<void>;
    stopAccountAssetSync: () => void;
    restoreLegacyAssetsToCurrentBrowser: () => number;
    saveFolder: (scope: AssetScope, folder: AssetFolderInput) => Promise<AssetFolder>;
    removeFolder: (scope: AssetScope, id: string) => Promise<void>;
    organizeAssets: (scope: AssetScope, ids: string[], patch: AssetOrganizationPatch) => Promise<void>;
    importLocalCollection: (collection: { assets: Asset[]; folders: AssetFolder[] }, parentId?: string) => string;
    cleanupImages: (extra?: unknown, storageKeys?: ReadonlyMap<string, string>, ownerToken?: string) => void;
};

type AssetSnapshot = AssetOrganizationSnapshot;
type LocalAssetSnapshot = { assets: Asset[]; localAssetsByOwner: Record<string, Asset[]>; localFoldersByOwner: Record<string, AssetFolder[]> };
const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let activeAssetSyncToken = "";
let assetSessionVersion = 0;
let cloudQueue: Promise<void> = Promise.resolve();
let localStorageReady = false;
const resolvedAssetURLTimes = new Map<string, number>();

function assetOwner() {
    const { token, user } = useUserStore.getState();
    return token ? user?.id ? `user:${user.id}` : "pending" : "guest";
}

async function resolveStoredAsset(asset: Asset): Promise<Asset> {
    try {
        if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
        if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
        if (asset.kind === "image" && asset.data.storageKey) {
            const url = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
            return { ...asset, coverUrl: asset.coverUrl === asset.data.dataUrl || asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, dataUrl: url } };
        }
    } catch { /* 保留旧记录，不因无法读取本机文件而丢弃素材。 */ }
    return asset;
}

const assetStorage: PersistStorage<LocalAssetSnapshot> = {
    getItem: async (name) => {
        try {
            const value = await localForageStorage.getItem(name);
            return value ? JSON.parse(value) as StorageValue<LocalAssetSnapshot> : null;
        } finally { localStorageReady = true; }
    },
    setItem: (name, value) => localStorageReady ? localForageStorage.setItem(name, JSON.stringify(value)) : undefined,
    removeItem: (name) => localForageStorage.removeItem(name),
};

function cloudMediaKey(asset: Asset | AssetInput) {
    return asset.kind === "text" ? "" : asset.data.storageKey || "";
}

function isAccountAsset(asset: Asset) {
    return asset.kind === "text" || /^server:[^:/\s]+$/.test(cloudMediaKey(asset));
}

function legacyAssetsForOwner(buckets: Record<string, Asset[]>, owner: string) {
    return mergeAssets(buckets.legacy || [], buckets[`legacy:${owner}`] || []);
}

function currentAssetSession(token: string, version: number) {
    return version === assetSessionVersion && activeAssetSyncToken === token && useUserStore.getState().token === token && assetOwner() === useAssetStore.getState().owner;
}

function requireAssetSession(token: string) {
    const { user, token: currentToken } = useUserStore.getState();
    if (!token || token !== currentToken || !user?.id) throw new Error("登录状态已变化，请重新登录后保存素材");
    useAssetStore.getState().selectAssetSession();
}

function requireLocalAssetSession() {
    useAssetStore.getState().selectAssetSession();
    if (!useAssetStore.getState().hydrated || useAssetStore.getState().owner === "pending") throw new Error("素材仍在加载，请稍后重试");
}

function runCloudAssetOperation<T>(token: string, operation: () => Promise<T>) {
    requireAssetSession(token);
    const version = assetSessionVersion;
    const check = () => { if (!currentAssetSession(token, version)) throw new Error("登录状态已变化，未应用旧账号素材"); };
    const task = cloudQueue.then(async () => {
        check();
        const value = await operation();
        check();
        return value;
    });
    cloudQueue = task.then(() => undefined, () => undefined);
    return task;
}

function localReference(value: string) {
    return /^(image:|file:|video:|blob:|data:)/i.test(value.trim());
}

function containsLocalReference(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, item]) => /^(url|dataUrl|coverUrl|storageKey)$/i.test(key) && typeof item === "string" ? localReference(item) : containsLocalReference(item));
}

function cloudAssetPayload(input: AssetInput): Asset {
    const now = new Date().toISOString();
    const existing = useAssetStore.getState().cloudAssets.find((asset) => asset.id === input.id || Boolean(cloudMediaKey(input) && cloudMediaKey(asset) === cloudMediaKey(input)));
    const key = cloudMediaKey(input);
    if (input.kind !== "text" && !/^server:[^:]+$/.test(key)) throw new Error("请先将素材文件保存到账号存储，再登记云素材");
    const id = existing?.id || (input.kind === "text" ? input.id?.startsWith("cloud-") ? input.id : `cloud-text-${input.id || nanoid()}` : `cloud-${key.slice(7)}`);
    const contentURL = input.kind === "text" ? "" : `/api/files/${encodeURIComponent(key.slice(7))}/content`;
    const localSource = input.id && useAssetStore.getState().localAssets.some((asset) => asset.id === input.id);
    const folderIds = existing ? existing.folderIds || [] : localSource ? [] : normalizeAssetFolderIds(input.folderIds || [], useAssetStore.getState().cloudFolders);
    const payload = { ...input, id, tags: normalizeAssetTags(existing?.tags || input.tags || []), folderIds, createdAt: existing?.createdAt || now, updatedAt: now, coverUrl: localReference(input.coverUrl) ? input.kind === "image" ? contentURL : "" : input.coverUrl } as Asset;
    if (payload.kind === "image") payload.data = { ...payload.data, dataUrl: contentURL };
    else if (payload.kind !== "text") payload.data = { ...payload.data, url: contentURL };
    if (containsLocalReference(payload.metadata)) throw new Error("素材元数据仍包含本机引用，请先移除本机文件引用后保存");
    return payload;
}

async function resolveAssetSnapshot(result: AssetSnapshot, token: string): Promise<AssetSnapshot> {
    if (activeAssetSyncToken !== token || useUserStore.getState().token !== token) return result;
    const previous = new Map(useAssetStore.getState().cloudAssets.map((asset) => [`${asset.id}:${cloudMediaKey(asset)}`, asset]));
    return { ...result, folders: Array.isArray(result.folders) ? result.folders : useAssetStore.getState().cloudFolders, assets: await Promise.all((Array.isArray(result?.assets) ? result.assets : []).map(async (asset) => {
        if (asset.kind === "text") return asset;
        const key = `${asset.id}:${cloudMediaKey(asset)}`;
        const cached = previous.get(key);
        if (cached?.kind === "image" && asset.kind === "image" && (resolvedAssetURLTimes.get(key) || 0) > Date.now()) {
            return { ...asset, coverUrl: asset.coverUrl === asset.data.dataUrl ? cached.data.dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl: cached.data.dataUrl } };
        }
        if (cached && cached.kind !== "text" && cached.kind !== "image" && asset.kind === cached.kind && (resolvedAssetURLTimes.get(key) || 0) > Date.now()) return { ...asset, data: { ...asset.data, url: cached.data.url } } as Asset;
        const resolved = await resolveStoredAsset(asset);
        const url = resolved.kind === "image" ? resolved.data.dataUrl : resolved.kind !== "text" ? resolved.data.url : "";
        if (url && url !== `/api/files/${encodeURIComponent(cloudMediaKey(asset).slice(7))}/content` && activeAssetSyncToken === token && useUserStore.getState().token === token) resolvedAssetURLTimes.set(key, Date.now() + 50 * 60 * 1000);
        return resolved;
    })) };
}

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => {
            const setLocalAssets = (assets: Asset[]) => set((state) => ({ localAssets: assets, localAssetsByOwner: { ...state.localAssetsByOwner, [state.owner]: assets }, assets: mergeAssets(state.cloudAssets, assets) }));
            const setCloudAssets = (response: AssetSnapshot, removeLocalId?: string) => set((state) => {
                const cloudAssets = response.assets.filter(isAccountAsset);
                const localAssets = removeLocalId ? state.localAssets.filter((asset) => asset.id !== removeLocalId) : state.localAssets;
                const legacyKey = `legacy:${state.owner}`;
                const localAssetsByOwner = { ...state.localAssetsByOwner, [state.owner]: localAssets, [legacyKey]: mergeAssets(response.assets.filter((asset) => !isAccountAsset(asset)), state.localAssetsByOwner[legacyKey] || []) };
                return { cloudAssets, cloudFolders: Array.isArray(response.folders) ? response.folders : state.cloudFolders, localAssets, localAssetsByOwner, legacyBrowserAssets: legacyAssetsForOwner(localAssetsByOwner, state.owner), assets: mergeAssets(cloudAssets, localAssets), error: "" };
            });
            return {
            assets: [], localAssets: [], cloudAssets: [], localFolders: [], cloudFolders: [], legacyBrowserAssets: [], localAssetsByOwner: {}, localFoldersByOwner: {}, owner: assetOwner(), hydrated: false, cloudLoading: false, error: "",
            addAsset: (input) => {
                get().selectAssetSession();
                if (get().owner === "pending") throw new Error("账号信息正在加载，请稍后保存素材");
                const now = new Date().toISOString();
                const id = nanoid();
                setLocalAssets([{ ...input, id, tags: normalizeAssetTags(input.tags || []), folderIds: normalizeAssetFolderIds(input.folderIds || [], get().localFolders), createdAt: now, updatedAt: now } as Asset, ...get().localAssets]);
                return id;
            },
            updateAsset: async (id, patch) => {
                get().selectAssetSession();
                if (get().cloudAssets.some((asset) => asset.id === id)) return get().updateCloudAsset(id, patch);
                if (!get().localAssets.some((asset) => asset.id === id)) throw new Error("素材不存在，请刷新后重试");
                setLocalAssets(get().localAssets.map((asset) => asset.id === id ? { ...asset, ...patch, ...(patch.tags !== undefined ? { tags: normalizeAssetTags(patch.tags) } : {}), ...(patch.folderIds !== undefined ? { folderIds: normalizeAssetFolderIds(patch.folderIds, get().localFolders) } : {}), id, createdAt: asset.createdAt, updatedAt: new Date().toISOString() } as Asset : asset));
            },
            removeAsset: async (id) => {
                get().selectAssetSession();
                if (get().cloudAssets.some((asset) => asset.id === id)) return get().removeCloudAsset(id);
                setLocalAssets(get().localAssets.filter((asset) => asset.id !== id));
            },
            selectAssetSession: (resolveLocal = false) => {
                const owner = assetOwner();
                const token = useUserStore.getState().token;
                const sameSession = get().owner === owner && activeAssetSyncToken === token;
                if (sameSession && !resolveLocal) return;
                if (!sameSession) {
                    assetSessionVersion++;
                    activeAssetSyncToken = token;
                    cloudQueue = Promise.resolve();
                    resolvedAssetURLTimes.clear();
                }
                const localAssets = get().localAssetsByOwner[owner] || [];
                if (!sameSession) set({ owner, localAssets, localFolders: get().localFoldersByOwner[owner] || [], cloudAssets: [], cloudFolders: [], legacyBrowserAssets: legacyAssetsForOwner(get().localAssetsByOwner, owner), assets: localAssets, cloudLoading: false, error: "" });
                const version = assetSessionVersion;
                void Promise.all(localAssets.map(resolveStoredAsset)).then((resolved) => {
                    if (version !== assetSessionVersion || assetOwner() !== owner || get().localAssets !== localAssets) return;
                    setLocalAssets(resolved);
                });
            },
            saveCloudAsset: async (asset, token = useUserStore.getState().token) => {
                requireAssetSession(token);
                const payload = cloudAssetPayload(asset);
                const version = assetSessionVersion;
                const result = await runCloudAssetOperation(token, async () => resolveAssetSnapshot(await saveUserAssetItem(token, payload), token));
                if (!currentAssetSession(token, version)) throw new Error("登录状态已变化，未应用旧账号素材");
                const saved = (cloudMediaKey(payload) ? result.assets.find((item) => cloudMediaKey(item) === cloudMediaKey(payload)) : undefined) || result.assets.find((item) => item.id === payload.id);
                if (!saved) throw new Error("云素材没有返回保存记录，请刷新后确认");
                setCloudAssets(result, asset.id);
                return saved.id;
            },
            updateCloudAsset: async (id, patch, token = useUserStore.getState().token) => {
                requireAssetSession(token);
                const version = assetSessionVersion;
                const asset = get().cloudAssets.find((item) => item.id === id);
                if (!asset) throw new Error("云素材不存在，请刷新后重试");
                const { tags, folderIds, ...details } = patch;
                const normalized = tags !== undefined ? normalizeAssetTags(tags) : undefined;
                const organization = { ...(folderIds !== undefined ? { folderIds } : {}), ...(normalized ? { addTags: normalized.filter((tag) => !asset.tags.includes(tag)), removeTags: asset.tags.filter((tag) => !normalized.includes(tag)) } : {}) };
                const shouldOrganize = folderIds !== undefined || Boolean(organization.addTags?.length || organization.removeTags?.length);
                if (shouldOrganize) organizeAsset(asset, organization, get().cloudFolders);
                const savedId = Object.keys(details).length ? await get().saveCloudAsset({ ...asset, ...details, id } as AssetInput, token) : id;
                if (shouldOrganize) {
                    if (!currentAssetSession(token, version)) throw new Error("登录状态已变化，未应用旧账号素材");
                    await get().organizeAssets("cloud", [savedId], organization);
                }
            },
            removeCloudAsset: async (id, token = useUserStore.getState().token) => {
                requireAssetSession(token);
                const version = assetSessionVersion;
                const result = await runCloudAssetOperation(token, async () => resolveAssetSnapshot(await deleteUserAssetItem(token, id), token));
                if (!currentAssetSession(token, version)) throw new Error("登录状态已变化，未应用旧账号素材");
                if (result.assets.some((asset) => asset.id === id)) throw new Error("云素材尚未删除，请刷新后重试");
                setCloudAssets(result);
            },
            hydrateAccountAssets: async (token) => {
                requireAssetSession(token);
                const version = assetSessionVersion;
                set({ cloudLoading: true });
                try {
                    const result = await runCloudAssetOperation(token, async () => resolveAssetSnapshot(await fetchUserAssetData<AssetSnapshot>(token), token));
                    if (currentAssetSession(token, version)) setCloudAssets(result);
                } catch (error) {
                    if (currentAssetSession(token, version)) set({ error: error instanceof Error ? error.message : "读取账号素材失败" });
                    throw error;
                } finally {
                    if (currentAssetSession(token, version)) set({ cloudLoading: false });
                }
            },
            syncAccountAssets: async (token) => get().hydrateAccountAssets(token),
            stopAccountAssetSync: () => {
                assetSessionVersion++;
                activeAssetSyncToken = "";
                cloudQueue = Promise.resolve();
                resolvedAssetURLTimes.clear();
                set({ cloudAssets: [], cloudFolders: [], assets: get().localAssets, cloudLoading: false, error: "" });
            },
            saveFolder: async (scope, input) => {
                const token = useUserStore.getState().token;
                if (scope === "cloud") requireAssetSession(token); else requireLocalAssetSession();
                const folders = scope === "cloud" ? get().cloudFolders : get().localFolders;
                const existing = input.id ? folders.find((folder) => folder.id === input.id) : undefined;
                if (input.id && !existing) throw new Error("文件夹不存在，请刷新后重试");
                const timestamp = new Date().toISOString();
                const folder = { id: existing?.id || `folder-${nanoid()}`, name: (input.name ?? existing?.name ?? "").trim(), parentId: (input.parentId ?? existing?.parentId ?? "").trim(), createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
                const next = existing ? folders.map((item) => item.id === folder.id ? folder : item) : [...folders, folder];
                validateAssetFolders(next);
                if (scope === "local") {
                    set((state) => ({ localFolders: next, localFoldersByOwner: { ...state.localFoldersByOwner, [state.owner]: next } }));
                    return folder;
                }
                const version = assetSessionVersion;
                const payload = { ...(input.id ? { id: input.id } : {}), ...(input.name !== undefined ? { name: folder.name } : {}), ...(input.parentId !== undefined ? { parentId: folder.parentId } : {}) };
                const result = await runCloudAssetOperation(token, async () => resolveAssetSnapshot(await saveUserAssetFolder(token, payload), token));
                if (!currentAssetSession(token, version)) throw new Error("登录状态已变化，未应用旧账号文件夹");
                const saved = result.folders.find((item) => input.id ? item.id === input.id : item.name === folder.name && item.parentId === folder.parentId);
                if (!saved) throw new Error("服务器未返回保存的文件夹，请刷新后确认");
                setCloudAssets(result);
                return saved;
            },
            removeFolder: async (scope, id) => {
                const token = useUserStore.getState().token;
                if (scope === "cloud") requireAssetSession(token); else requireLocalAssetSession();
                const folders = scope === "cloud" ? get().cloudFolders : get().localFolders;
                if (!folders.some((folder) => folder.id === id)) throw new Error("文件夹不存在，请刷新后重试");
                if (scope === "cloud") {
                    const version = assetSessionVersion;
                    const result = await runCloudAssetOperation(token, async () => resolveAssetSnapshot(await deleteUserAssetFolder(token, id), token));
                    if (!currentAssetSession(token, version)) throw new Error("登录状态已变化，未应用旧账号文件夹");
                    setCloudAssets(result);
                    return;
                }
                const removed = new Set(folderDescendantIds(folders, id));
                const localFolders = folders.filter((folder) => !removed.has(folder.id));
                const timestamp = new Date().toISOString();
                const localAssets = get().localAssets.map((asset) => asset.folderIds?.some((folderId) => removed.has(folderId)) ? { ...asset, folderIds: asset.folderIds.filter((folderId) => !removed.has(folderId)), updatedAt: timestamp } : asset);
                set((state) => ({ localFolders, localAssets, localFoldersByOwner: { ...state.localFoldersByOwner, [state.owner]: localFolders }, localAssetsByOwner: { ...state.localAssetsByOwner, [state.owner]: localAssets }, assets: mergeAssets(state.cloudAssets, localAssets) }));
            },
            organizeAssets: async (scope, inputIds, patch) => {
                const token = useUserStore.getState().token;
                if (scope === "cloud") requireAssetSession(token); else requireLocalAssetSession();
                const ids = new Set(inputIds.map((id) => id.trim()).filter(Boolean));
                if (!ids.size || ids.size > 200) throw new Error("每次请选择 1 至 200 个素材");
                const source = scope === "cloud" ? get().cloudAssets : get().localAssets;
                const folders = scope === "cloud" ? get().cloudFolders : get().localFolders;
                if ([...ids].some((id) => !source.some((asset) => asset.id === id))) throw new Error("部分素材不存在，请刷新后重试");
                const timestamp = new Date().toISOString();
                const next = source.map((asset) => ids.has(asset.id) ? { ...organizeAsset(asset, patch, folders), updatedAt: timestamp } : asset);
                if (scope === "local") { setLocalAssets(next); return; }
                const version = assetSessionVersion;
                const result = await runCloudAssetOperation(token, async () => resolveAssetSnapshot(await organizeUserAssets(token, [...ids], patch), token));
                if (!currentAssetSession(token, version)) throw new Error("登录状态已变化，未应用旧账号整理结果");
                setCloudAssets(result);
            },
            importLocalCollection: (collection, requestedParentId = "") => {
                requireLocalAssetSession();
                validateAssetFolders(collection.folders);
                const parentId = get().localFolders.some((folder) => folder.id === requestedParentId) ? requestedParentId : "";
                const parentDepth = folderPath(get().localFolders, parentId).length;
                const importedDepth = Math.max(0, ...collection.folders.map((folder) => folderPath(collection.folders, folder.id).length));
                if (parentDepth + importedDepth > 8) throw new Error("目标目录放不下素材包的目录层级，请选择根目录后重新导入");
                const useWrapper = parentDepth + importedDepth < 8 && get().localFolders.length + collection.folders.length < 1000;
                const siblings = new Set(get().localFolders.filter((folder) => folder.parentId === parentId).map((folder) => folder.name.trim().toLocaleLowerCase()));
                let name = "导入素材";
                for (let index = 2; siblings.has(name.toLocaleLowerCase()); index++) name = `导入素材 ${index}`;
                const timestamp = new Date().toISOString();
                const wrapper = { id: `folder-${nanoid()}`, name, parentId, createdAt: timestamp, updatedAt: timestamp };
                const targetId = useWrapper ? wrapper.id : parentId;
                const importedFolders = collection.folders.map((folder) => {
                    if (folder.parentId) return folder;
                    let name = folder.name.trim();
                    if (!useWrapper) {
                        for (let index = 2; siblings.has(name.toLocaleLowerCase()); index++) name = `导入 - ${folder.name.trim()} (${index})`;
                        siblings.add(name.toLocaleLowerCase());
                    }
                    return { ...folder, name, parentId: targetId };
                });
                const localFolders = [...get().localFolders, ...(useWrapper ? [wrapper] : []), ...importedFolders];
                validateAssetFolders(localFolders);
                const ids = new Set(get().localAssets.map((asset) => asset.id));
                const imported = collection.assets.map((asset) => {
                    if (!asset.id || ids.has(asset.id)) throw new Error("导入素材标识重复，请重新选择素材包");
                    ids.add(asset.id);
                    if (asset.kind !== "text" && (!asset.data.storageKey || asset.data.storageKey.startsWith("server:"))) throw new Error("导入媒体必须先保存在当前浏览器");
                    return { ...asset, tags: normalizeAssetTags(asset.tags || []), folderIds: normalizeAssetFolderIds(asset.folderIds?.length ? asset.folderIds : targetId ? [targetId] : [], localFolders) };
                });
                const localAssets = [...imported, ...get().localAssets];
                set((state) => ({ localFolders, localAssets, localFoldersByOwner: { ...state.localFoldersByOwner, [state.owner]: localFolders }, localAssetsByOwner: { ...state.localAssetsByOwner, [state.owner]: localAssets }, assets: mergeAssets(state.cloudAssets, localAssets) }));
                return targetId;
            },
            restoreLegacyAssetsToCurrentBrowser: () => {
                get().selectAssetSession();
                if (!get().hydrated || get().owner === "pending") throw new Error("素材仍在加载，请稍后导入");
                const legacy = get().legacyBrowserAssets;
                setLocalAssets(mergeAssets(get().localAssets, legacy));
                get().selectAssetSession(true);
                return legacy.length;
            },
            cleanupImages: (extra, storageKeys, ownerToken) => {
                const sessionToken = ownerToken ?? useUserStore.getState().token;
                const sessionVersion = assetSessionVersion;
                window.setTimeout(async () => {
                    const currentSession = () => sessionVersion === assetSessionVersion && useUserStore.getState().token === sessionToken;
                    if (!currentSession()) return;
                    const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                    const { loadLocalAgentSkills, useAgentSkillStore } = await import("@/stores/use-agent-skill-store");
                    const logKeys: string[] = [];
                    try {
                        const localforage = (await import("localforage")).default;
                        const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                        await imageLogStore.iterate((log: any) => {
                            if (log) {
                                if (Array.isArray(log.images)) {
                                    log.images.forEach((img: any) => {
                                        if (img && img.storageKey) logKeys.push(img.storageKey);
                                    });
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                        const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                        await videoLogStore.iterate((log: any) => {
                            if (log) {
                                if (log.video && log.video.storageKey) {
                                    logKeys.push(log.video.storageKey);
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                    } catch (e) {
                        console.error("Error gathering log keys in cleanupImages", e);
                    }

                    try {
                        await useAgentSkillStore.getState().loadSkills();
                        const skillStore = useAgentSkillStore.getState();
                        const localSkills = useUserStore.getState().token ? await loadLocalAgentSkills() : [];
                        if (!currentSession()) return;
                        const protectedAssets = [...Object.values(get().localAssetsByOwner).flat(), ...get().cloudAssets];
                        await cleanupUnusedImages({ assets: protectedAssets, projects: useCanvasStore.getState().projects, skills: [...skillStore.systemSkills, ...skillStore.userSkills, ...localSkills], extra, logKeys }, storageKeys, sessionToken);
                    } catch (error) {
                        console.error("Error gathering Skill keys in cleanupImages", error);
                    }
                    if (!currentSession()) return;
                    await cleanupUnusedMedia({ assets: [...Object.values(get().localAssetsByOwner).flat(), ...get().cloudAssets], projects: useCanvasStore.getState().projects, extra, logKeys });
                }, 0);
            },
        };
        },
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.localAssetsByOwner.legacy || [], localAssetsByOwner: state.localAssetsByOwner, localFoldersByOwner: state.localFoldersByOwner }),
            merge: (persisted, current) => {
                const saved = persisted as Partial<LocalAssetSnapshot> | undefined;
                const buckets: Record<string, Asset[]> = saved?.localAssetsByOwner ? { ...saved.localAssetsByOwner } : { legacy: Array.isArray(saved?.assets) ? saved.assets : [] };
                for (const [owner, assets] of Object.entries(current.localAssetsByOwner)) buckets[owner] = mergeAssets(assets, buckets[owner] || []);
                const owner = assetOwner();
                const localAssets = buckets[owner] || [];
                const folderBuckets = { ...(saved?.localFoldersByOwner || {}) };
                for (const [key, folders] of Object.entries(current.localFoldersByOwner)) folderBuckets[key] = [...new Map([...(folderBuckets[key] || []), ...folders].map((folder) => [folder.id, folder])).values()];
                return { ...current, owner, localAssetsByOwner: buckets, localAssets, localFoldersByOwner: folderBuckets, localFolders: folderBuckets[owner] || [], legacyBrowserAssets: legacyAssetsForOwner(buckets, owner), assets: mergeAssets(current.cloudAssets, localAssets), hydrated: true };
            },
            onRehydrateStorage: () => (state) => {
                state?.selectAssetSession(true);
            },
        },
    ),
);

useUserStore.subscribe((state, previous) => {
    if (state.token !== previous.token || state.user?.id !== previous.user?.id) useAssetStore.getState().selectAssetSession();
});

export function mergeAssets(remoteAssets: Asset[], localAssets: Asset[]) {
    const records = new Map<string, Asset>();
    for (const asset of [...localAssets, ...remoteAssets]) {
        const previous = records.get(asset.id);
        if (!previous || Date.parse(asset.updatedAt || "") >= Date.parse(previous.updatedAt || "")) records.set(asset.id, asset);
    }
    return [...records.values()].sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}
