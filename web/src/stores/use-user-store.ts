"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { AUTH_TOKEN_KEY, fetchCurrentUser, login, register, type AuthPayload, type AuthUser } from "@/services/api/auth";
import { ApiError } from "@/services/api/request";
import { syncStorageReadSession } from "@/lib/auth-session";

type UserStore = {
    token: string;
    user: AuthUser | null;
    isReady: boolean;
    isLoading: boolean;
    authError: string;
    sessionVersion: number;
    setSession: (token: string, user: AuthUser) => void;
    clearSession: () => void;
    hydrateUser: () => Promise<void>;
    login: (payload: AuthPayload) => Promise<AuthUser>;
    register: (payload: AuthPayload) => Promise<AuthUser>;
    loginWithToken: (token: string) => Promise<AuthUser>;
    adoptStoredToken: (token: string) => void;
};

let pendingAuth: Promise<AuthUser> | null = null;
let pendingHydration: { token: string; version: number; promise: Promise<void> } | null = null;
let pendingLogout: Promise<unknown> = Promise.resolve();

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => {
            const authenticate = (request: () => Promise<{ token: string; user: AuthUser }>) => {
                const version = get().sessionVersion + 1;
                set({ sessionVersion: version, isReady: false, isLoading: true, authError: "" });
                const promise = (async () => {
                    try {
                        await pendingLogout;
                        const session = await request();
                        if (get().sessionVersion !== version) throw new Error("登录状态已变化，请重新操作");
                        if (!session.user.id || session.user.role === "guest") throw new Error("登录状态无效，请重新登录");
                        set({ token: session.token, user: session.user });
                        await syncStorageReadSession(session.token, version);
                        if (get().sessionVersion !== version) throw new Error("登录状态已变化，请重新操作");
                        set({ isReady: true, isLoading: false, authError: "" });
                        return session.user;
                    } catch (error) {
                        if (get().sessionVersion === version) set({ isReady: true, isLoading: false, authError: error instanceof Error ? error.message : "登录失败" });
                        throw error;
                    }
                })();
                pendingAuth = promise;
                void promise.finally(() => { if (pendingAuth === promise) pendingAuth = null; }).catch(() => undefined);
                return promise;
            };
            return {
            token: "",
            user: null,
            isReady: false,
            isLoading: false,
            authError: "",
            sessionVersion: 0,
            setSession: (token, user) => set({ token, user, isReady: true, isLoading: false, authError: "", sessionVersion: get().sessionVersion + (get().token !== token || get().user?.id !== user.id ? 1 : 0) }),
            clearSession: () => {
                const version = get().sessionVersion + 1;
                pendingLogout = syncStorageReadSession("", version).catch(() => undefined);
                set({ token: "", user: null, isReady: true, isLoading: false, authError: "", sessionVersion: version });
            },
            hydrateUser: () => {
                if (pendingAuth) return pendingAuth.then(() => undefined, () => undefined);
                const token = get().token;
                if (!token) {
                    set({ user: null, isReady: true, isLoading: false, authError: "" });
                    return Promise.resolve();
                }
                const version = get().sessionVersion;
                if (pendingHydration?.token === token && pendingHydration.version === version) return pendingHydration.promise;
                set({ isLoading: true, authError: "" });
                const current = () => get().token === token && get().sessionVersion === version;
                const promise: Promise<void> = fetchCurrentUser(token).then(async (user) => {
                    if (!current()) return;
                    if (!user.id || user.role === "guest") { get().clearSession(); return; }
                    await syncStorageReadSession(token, version);
                    if (!current()) return;
                    set({ user, isReady: true, isLoading: false, authError: "" });
                }).catch((error: unknown) => {
                    if (!current()) return;
                    if (error instanceof ApiError && error.status === 401) get().clearSession();
                    else set({ isReady: true, isLoading: false, authError: error instanceof Error ? error.message : "身份校验失败，请重试" });
                }).finally(() => {
                    if (pendingHydration?.promise === promise) pendingHydration = null;
                });
                pendingHydration = { token, version, promise };
                return promise;
            },
            login: (payload) => authenticate(() => login(payload)),
            register: (payload) => authenticate(() => register(payload)),
            loginWithToken: (token) => authenticate(async () => {
                const user = await fetchCurrentUser(token);
                return { token, user };
            }),
            adoptStoredToken: (token) => {
                if (token === get().token) return;
                pendingAuth = null;
                if (!token) { get().clearSession(); return; }
                set({ token, user: null, isReady: false, isLoading: false, authError: "", sessionVersion: get().sessionVersion + 1 });
                void get().hydrateUser();
            },
        };
        },
        {
            name: AUTH_TOKEN_KEY,
            partialize: (state) => ({ token: state.token }),
            onRehydrateStorage: () => (state) => {
                if (state) state.isReady = false;
            },
        },
    ),
);
