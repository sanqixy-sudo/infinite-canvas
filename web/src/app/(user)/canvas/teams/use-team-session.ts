"use client";

import { useEffect, useRef } from "react";
import { useUserStore } from "@/stores/use-user-store";

export function useTeamSession() {
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id || "");
    const version = useUserStore((state) => state.sessionVersion);
    const ready = useUserStore((state) => Boolean(state.isReady && !state.authError && state.token && state.user?.id && state.user.role !== "guest"));
    const mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const current = () => {
        const state = useUserStore.getState();
        return mounted.current && ready && state.isReady && !state.authError && state.user?.role !== "guest" && state.user?.id === userId && state.token === token && state.sessionVersion === version;
    };
    return { token, userId, ready, scope: `${userId}:${version}:${token}`, current };
}
