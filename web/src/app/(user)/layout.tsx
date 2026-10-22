"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppConfigModal } from "@/components/layout/app-config-modal";
import { fetchUserConfig } from "@/services/api/user-config";
import { useUserStore } from "@/stores/use-user-store";
import { useStoragePreferencesStore } from "@/stores/use-storage-preferences-store";
import { WorkspaceShell } from "./canvas/components/workspace-shell";

const protectedPrefixes = ["/asset-library"];

export default function UserLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const token = useUserStore((state) => state.token);
    const isReady = useUserStore((state) => state.isReady);
    const wasLoggedOutRef = useRef(false);
    const isProtectedPage = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    const focused = /^\/canvas\/[^/]+$/.test(pathname) || pathname === "/tokendance/callback";
    const content = isProtectedPage && (!isReady || !user) ? null : children;

    useEffect(() => {
        if (!isReady || !isProtectedPage || user) return;
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }, [isProtectedPage, isReady, pathname, router, user]);

    useEffect(() => {
        if (!isReady) return;
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
    }, [isReady, token, user?.id]);

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <div className="min-h-0 flex-1 overflow-hidden">{focused ? content : <WorkspaceShell>{content}</WorkspaceShell>}</div>
            <AppConfigModal />
        </div>
    );
}
