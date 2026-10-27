"use client";

import { create } from "zustand";
import { fetchStoragePreferences, saveStoragePreferences } from "@/services/api/storage-preferences";
import { useUserStore } from "./use-user-store";

type StoragePreferencesStore = {
    token: string;
    ready: boolean;
    autoSaveAssetsToCloud: boolean;
    error: string;
    isLoading: boolean;
    isSaving: boolean;
    load: (token: string) => Promise<void>;
    save: (token: string, value: boolean) => Promise<void>;
    reset: () => void;
};

const defaults = { token: "", ready: false, autoSaveAssetsToCloud: false, error: "", isLoading: false, isSaving: false };
let requestVersion = 0;
let pendingLoad: { token: string; promise: Promise<void> } | null = null;

export const useStoragePreferencesStore = create<StoragePreferencesStore>()((set, get) => ({
    ...defaults,
    load: (token) => {
        if (!token || useUserStore.getState().token !== token) return Promise.reject(new Error("登录状态已变化，请重新登录"));
        if (get().token === token && get().ready) return Promise.resolve();
        if (pendingLoad?.token === token) return pendingLoad.promise;
        const version = ++requestVersion;
        set({ ...defaults, token, isLoading: true });
        const current = () => requestVersion === version && useUserStore.getState().token === token && get().token === token;
        const promise: Promise<void> = fetchStoragePreferences(token).then((preferences) => {
            if (current()) set({ autoSaveAssetsToCloud: preferences.autoSaveAssetsToCloud === true, ready: true, error: "" });
        }).catch((error: unknown) => {
            if (current()) set({ ready: false, autoSaveAssetsToCloud: false, error: error instanceof Error ? error.message : "读取存储偏好失败" });
            throw error;
        }).finally(() => {
            if (current()) set({ isLoading: false });
            if (pendingLoad?.promise === promise) pendingLoad = null;
        });
        pendingLoad = { token, promise };
        return promise;
    },
    save: async (token, value) => {
        if (!token || useUserStore.getState().token !== token) throw new Error("登录状态已变化，请重新登录");
        const version = ++requestVersion;
        pendingLoad = null;
        set({ ...(get().token === token ? {} : defaults), token, isLoading: false, isSaving: true, error: "" });
        const current = () => requestVersion === version && useUserStore.getState().token === token && get().token === token;
        try {
            const preferences = await saveStoragePreferences(token, value);
            if (!current()) throw new Error("登录状态已变化，未应用旧账号的存储偏好");
            set({ autoSaveAssetsToCloud: preferences.autoSaveAssetsToCloud === true, ready: true });
        } catch (error) {
            if (current()) set({ error: error instanceof Error ? error.message : "保存存储偏好失败" });
            throw error;
        } finally {
            if (current()) set({ isSaving: false });
        }
    },
    reset: () => {
        requestVersion++;
        pendingLoad = null;
        set(defaults);
    },
}));

useUserStore.subscribe((state, previous) => {
    if (state.token !== previous.token) useStoragePreferencesStore.getState().reset();
});
