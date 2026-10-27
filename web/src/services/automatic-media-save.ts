"use client";

import { useUserStore } from "@/stores/use-user-store";
import type { AssetInput } from "@/stores/use-asset-store";

export type SavedAutomaticMedia = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; accountSaveError?: string };
type Options<T extends SavedAutomaticMedia> = {
    source: string | Blob;
    kind: "image" | "video" | "audio";
    title: string;
    token: string;
    localOnly?: boolean;
    saveLocal: () => Promise<T>;
    uploadCloud: () => Promise<T | null>;
    unarchived: () => Promise<T | null>;
};

const requests = new Map<string | Blob, Promise<SavedAutomaticMedia>>();
const pendingCopies = new Map<string, SavedAutomaticMedia>();
const uploadedCopies = new Map<string | Blob, SavedAutomaticMedia>();
const reportedFailures = new Set<string>();
let reportedBlobFailures = new WeakSet<Blob>();
let owner = "";

function resetSessionCache(token: string) {
    owner = token;
    requests.clear();
    pendingCopies.clear();
    uploadedCopies.clear();
    reportedFailures.clear();
    reportedBlobFailures = new WeakSet<Blob>();
}

useUserStore.subscribe((state, previous) => {
    if (state.token !== previous.token) resetSessionCache(state.token);
});

function trimCache<K, V>(cache: Map<K, V>) {
    while (cache.size > 200) cache.delete(cache.keys().next().value!);
}

function firstFailure(source: string | Blob) {
    if (source instanceof Blob) {
        if (reportedBlobFailures.has(source)) return false;
        reportedBlobFailures.add(source);
    } else {
        if (reportedFailures.has(source)) return false;
        reportedFailures.add(source);
        if (reportedFailures.size > 200) reportedFailures.delete(reportedFailures.values().next().value!);
    }
    return true;
}

function rememberPending(source: string | Blob, key: string, uploaded: SavedAutomaticMedia | null) {
    if (uploaded) {
        pendingCopies.set(key, uploaded);
        trimCache(pendingCopies);
    }
    if (source instanceof Blob) uploadedCopies.delete(source);
}

export function assertStorageSession(token: string) {
    if (useUserStore.getState().token !== token) throw new Error("登录状态已变化，请重新操作");
}

export function getPendingAutomaticCloudCopy(storageKey: string) {
    return owner === useUserStore.getState().token ? pendingCopies.get(storageKey) : undefined;
}

export function clearAutomaticMediaCache(storageKey: string) {
    pendingCopies.delete(storageKey);
    for (const [key, uploaded] of pendingCopies) if (uploaded.storageKey === storageKey) pendingCopies.delete(key);
    for (const [source, uploaded] of uploadedCopies) if (uploaded.storageKey === storageKey) uploadedCopies.delete(source);
    for (const [key, request] of requests) {
        void request.then((result) => { if (result.storageKey === storageKey && requests.get(key) === request) requests.delete(key); }).catch(() => {});
    }
}

function reportFailure(message: string) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("infinite-canvas:storage-sync-failed", { detail: message }));
}

export async function saveAutomaticMedia<T extends SavedAutomaticMedia>(options: Options<T>): Promise<T> {
    assertStorageSession(options.token);
    if (owner !== options.token) resetSessionCache(options.token);
    const key = options.localOnly && typeof options.source === "string" ? `browser:${options.source}` : options.source;
    const existing = requests.get(key);
    if (existing && !options.localOnly) return existing as Promise<T>;
    const request = persist(options);
    if (!options.localOnly) {
        requests.set(key, request);
        trimCache(requests);
    }
    try {
        const result = await request;
        if ((!result.storageKey || options.source instanceof Blob) && requests.get(key) === request) requests.delete(key);
        return result;
    } catch (error) {
        if (requests.get(key) === request) requests.delete(key);
        throw error;
    }
}

async function persist<T extends SavedAutomaticMedia>({ source, kind, title, token, localOnly, saveLocal, uploadCloud, unarchived }: Options<T>): Promise<T> {
    const { useStoragePreferencesStore } = await import("@/stores/use-storage-preferences-store");
    const preferences = useStoragePreferencesStore.getState();
    const cloudEnabled = !localOnly && Boolean(token && preferences.token === token && preferences.ready && preferences.autoSaveAssetsToCloud);
    let uploaded: T | null = null;
    let accountSaveError = "";
    if (cloudEnabled) {
        try {
            assertStorageSession(token);
            uploaded = (uploadedCopies.get(source) as T | undefined) || await uploadCloud();
            assertStorageSession(token);
            if (!uploaded?.storageKey.startsWith("server:")) throw new Error("账号存储暂不可用");
            uploadedCopies.set(source, uploaded);
            trimCache(uploadedCopies);
            const base = { id: `cloud-${uploaded.storageKey.slice("server:".length)}`, kind, title, coverUrl: kind === "image" ? uploaded.url : "", tags: [], source: "automatic", metadata: { ...(typeof source === "string" && /^(image|video|audio|workflow)[^:]*:/.test(source) ? { resultId: source } : {}) } };
            const asset: AssetInput = kind === "image"
                ? { ...base, kind, data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width || 0, height: uploaded.height || 0, bytes: uploaded.bytes, mimeType: uploaded.mimeType } }
                : kind === "video"
                    ? { ...base, kind, data: { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width || 0, height: uploaded.height || 0, bytes: uploaded.bytes, mimeType: uploaded.mimeType } }
                    : { ...base, kind, data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, durationMs: uploaded.durationMs } };
            const { useAssetStore } = await import("@/stores/use-asset-store");
            await useAssetStore.getState().saveCloudAsset(asset, token);
            assertStorageSession(token);
            uploadedCopies.delete(source);
            return uploaded;
        } catch (error) {
            assertStorageSession(token);
            accountSaveError = error instanceof Error ? error.message : "账号保存失败";
        }
    }
    try {
        assertStorageSession(token);
        const local = await saveLocal();
        assertStorageSession(token);
        if (accountSaveError) {
            rememberPending(source, local.storageKey, uploaded);
            if (firstFailure(source)) {
                reportFailure(`账号保存失败，已保存在当前浏览器：${accountSaveError}`);
            }
        }
        return accountSaveError ? { ...local, accountSaveError } : local;
    } catch (error) {
        assertStorageSession(token);
        const reason = error instanceof Error ? error.message : "浏览器存储不可用";
        const fallback = await unarchived().catch(() => null);
        assertStorageSession(token);
        if (firstFailure(source)) {
            reportFailure(`当前浏览器保存失败，结果尚未归档，请立即下载保存：${reason}`);
        }
        if (fallback) {
            rememberPending(source, fallback.url, uploaded);
            return { ...fallback, storageKey: "", accountSaveError: `尚未归档，请立即下载保存：${reason}` };
        }
        if (source instanceof Blob) uploadedCopies.delete(source);
        throw new Error(`结果尚未归档，请立即下载保存：${reason}`);
    }
}
