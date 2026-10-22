"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppConfigModal } from "@/components/layout/app-config-modal";
import { fetchUserConfig } from "@/services/api/user-config";
import { useUserStore } from "@/stores/use-user-store";
import { useStoragePreferencesStore } from "@/stores/use-storage-preferences-store";
import { loginHrefForPath } from "@/lib/auth-navigation";
import { WorkspaceShell } from "./canvas/components/workspace-shell";

const publicPages = new Set(["/", "/login", "/legal"]);

export default function UserLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const token = useUserStore((state) => state.token);
    const isReady = useUserStore((state) => state.isReady);
    const isLoading = useUserStore((state) => state.isLoading);
    const authError = useUserStore((state) => state.authError);
    const sessionError = token ? authError : "";
    const wasLoggedOutRef = useRef(false);
    const isProtectedPage = !publicPages.has(pathname);
    const authenticated = Boolean(isReady && token && user?.id && user.role !== "guest");
    const focused = /^\/canvas\/[^/]+$/.test(pathname) || pathname === "/tokendance/callback";

    useEffect(() => {
        if (!isReady || isLoading || sessionError || !isProtectedPage || authenticated) return;
        router.replace(loginHrefForPath(`${window.location.pathname}${window.location.search}${window.location.hash}`));
    }, [isProtectedPage, isReady, isLoading, sessionError, pathname, router, authenticated]);

    useEffect(() => {
        if (!isReady || !isProtectedPage || sessionError) return;
        let cancelled = false;
        const userId = useUserStore.getState().user?.id;
        const currentSession = () => !cancelled && useUserStore.getState().token === token && useUserStore.getState().user?.id === userId;
        if (!userId || !token) {
            wasLoggedOutRef.current = true;
            useStoragePreferencesStore.getState().reset();
            void import("@/stores/use-asset-store").then(({ useAssetStore }) => {
                if (!currentSession()) return;
                useAssetStore.getState().stopAccountAssetSync();
                useAssetStore.getState().selectAssetSession();
            });
            return () => { cancelled = true; };
        }
        const syncCanvasAfterLogin = wasLoggedOutRef.current;
        wasLoggedOutRef.current = false;
        void useStoragePreferencesStore.getState().load(token).catch(() => undefined);
        void import("@/stores/use-asset-store").then(({ useAssetStore }) => {
            if (currentSession()) return useAssetStore.getState().hydrateAccountAssets(token);
        }).catch(() => undefined);
        fetchUserConfig(token).then(async (config) => {
            if (!currentSession()) return;
            const syncEnabled = config.syncCapabilities?.userData === true;
            const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
            if (!currentSession()) return;
            const canvasStore = useCanvasStore.getState();
            canvasStore.setSyncEnabled(syncEnabled);
            if (
                syncCanvasAfterLogin &&
                syncEnabled &&
                canvasStore.hydrated
            ) {
                void canvasStore.syncWithRemote(token, true);
            }
        }).catch(() => { });
        return () => { cancelled = true; };
    }, [isReady, token, user?.id, isProtectedPage, sessionError]);

    if (!isProtectedPage) return <>{children}</>;
    if (!authenticated || sessionError) return <main className="flex h-dvh items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground"><div role={sessionError ? "alert" : "status"}>{sessionError ? <><p>暂时无法确认登录状态，请重试。</p><button type="button" className="mt-4 text-foreground underline underline-offset-4" onClick={() => void useUserStore.getState().hydrateUser()}>重新连接</button></> : "正在确认登录状态…"}</div></main>;

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <div className="min-h-0 flex-1 overflow-hidden">{focused ? children : <WorkspaceShell>{children}</WorkspaceShell>}</div>
            <AppConfigModal />
        </div>
    );
}
