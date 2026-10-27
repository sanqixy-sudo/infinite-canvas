"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { App } from "antd";

import { cloudModelPreferences, fetchUserConfig } from "@/services/api/user-config";
import { STORAGE_SYNC_FAILED_EVENT, defaultUserStorageProvider, defaultUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider } from "@/services/image-storage";
import { defaultConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { observeAuthenticatedFetch } from "@/lib/auth-session";
import { AUTH_TOKEN_KEY } from "@/services/api/auth";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isTokenDanceCallback = pathname === "/tokendance/callback";
    const accountSessionRef = useRef({ token, userId: user?.id || "" });

    useEffect(observeAuthenticatedFetch, []);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== AUTH_TOKEN_KEY || event.storageArea !== window.localStorage) return;
            try {
                const raw = window.localStorage.getItem(AUTH_TOKEN_KEY);
                const value = raw ? JSON.parse(raw) as { state?: { token?: unknown } } : null;
                const nextToken = typeof value?.state?.token === "string" ? value.state.token : "";
                useUserStore.getState().adoptStoredToken(nextToken);
            } catch { /* 损坏的浏览器配置不作为已验证身份。 */ }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    useEffect(() => {
        const onSyncFailed = (event: Event) => {
            const detail = (event as CustomEvent<string>).detail;
            message.warning({ key: STORAGE_SYNC_FAILED_EVENT, content: detail || "素材尚未完成保存，请检查存储状态并重试。" });
        };
        window.addEventListener(STORAGE_SYNC_FAILED_EVENT, onSyncFailed);
        return () => window.removeEventListener(STORAGE_SYNC_FAILED_EVENT, onSyncFailed);
    }, [message]);

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        const refresh = () => { void hydrateUser(); };
        const unsubscribe = useUserStore.persist.hasHydrated() ? undefined : useUserStore.persist.onFinishHydration(refresh);
        if (useUserStore.persist.hasHydrated()) refresh();
        window.addEventListener("focus", refresh);
        return () => { unsubscribe?.(); window.removeEventListener("focus", refresh); };
    }, [hydrateUser]);

	useEffect(() => {
		if (channelMode !== "remote") updateConfig("channelMode", "remote");
	}, [channelMode, updateConfig]);

	useLayoutEffect(() => {
		const previous = accountSessionRef.current;
		const userId = user?.id || "";
		if ((previous.token && !token) || (previous.userId && userId && previous.userId !== userId)) {
			useConfigStore.setState({ config: defaultConfig });
		}
		accountSessionRef.current = { token, userId };
	}, [token, user?.id]);

	useEffect(() => {
        if (isTokenDanceCallback || !token || !user?.id) return;
        const accountToken = token;
        const accountId = user.id;
        let canceled = false;
		void fetchUserConfig(accountToken)
			.then((payload) => {
				if (canceled || useUserStore.getState().token !== accountToken || useUserStore.getState().user?.id !== accountId) return;
				const syncS3 = payload.modelConfig?.syncStorageConfig === true;
                const syncWebDAV = payload.modelConfig?.syncWebDAVStorageConfig === true;
                if (payload.modelConfig) {
                    Object.entries(cloudModelPreferences(payload.modelConfig)).forEach(([key, value]) => {
                        updateConfig(key as keyof AiConfig, value as never);
                    });
				}
				updateConfig("syncStorageConfig", syncS3);
                updateConfig("syncWebDAVStorageConfig", syncWebDAV);
                if (syncS3 && payload.storageProvider?.s3) {
                    saveUserStorageProvider({
                        ...defaultUserStorageProvider(),
                        ...payload.storageProvider.s3,
                        type: "s3",
                    });
                }
                if (syncWebDAV && payload.storageProvider?.webdav) {
                    saveUserWebDAVStorageProvider({
                        ...defaultUserWebDAVStorageProvider(),
                        ...payload.storageProvider.webdav,
                        type: "webdav",
                    });
                }
            })
            .catch(() => {});
        return () => {
            canceled = true;
        };
    }, [isTokenDanceCallback, token, updateConfig, user?.id]);

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        if (!["baseUrl", "baseurl", "apiKey", "apikey"].some((key) => searchParams.has(key))) return;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        message.info("个人模型配置链接已停用，请使用平台云端模型");
    }, [message, pathname]);

    return <>{children}</>;
}
