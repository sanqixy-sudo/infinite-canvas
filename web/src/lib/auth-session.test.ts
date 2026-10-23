import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { observeAuthenticatedFetch } from "./auth-session";
import { localForageStorage } from "./localforage-storage";
import { useUserStore } from "@/stores/use-user-store";

const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: "", role: "user" as const, credits: 0, createdAt: "", updatedAt: "" });

test("fetch authentication observer ignores signed media, external endpoints, forbidden and old-session responses", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalFetch = globalThis.fetch;
    const originalStorage = { ...localForageStorage };
    const originalAdapter = axios.defaults.adapter;
    const originalSession = useUserStore.getState();
    const values = new Map<string, string>();
    // Bun loads other stores in this process; their session listeners must stay in memory.
    localForageStorage.getItem = async (name) => values.get(name) ?? null;
    localForageStorage.setItem = async (name, value) => { values.set(name, value); };
    localForageStorage.removeItem = async (name) => { values.delete(name); };
    axios.defaults.adapter = async (config) => ({ data: { code: 0, data: config.url === "/api/v1/canvas/projects" ? [] : {}, msg: "" }, status: 200, statusText: "OK", headers: {}, config });
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    let status = 401;
    let finish: ((response: Response) => void) | undefined;
    const fetcher: typeof fetch = async (input) => String(input).includes("delayed") ? new Promise((resolve) => { finish = resolve; }) : new Response("{}", { status });
    const localStorage: Storage = { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null, getItem: (name) => values.get(name) ?? null, setItem: (name, value) => { values.set(name, value); }, removeItem: (name) => { values.delete(name); }, clear: () => values.clear() };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: new URL("https://studio.example"), fetch: fetcher, localStorage } });
    const stop = observeAuthenticatedFetch();
    try {
        useUserStore.getState().setSession("current-token", user("current"));
        await window.fetch("/api/files/file/content?access=expired-signature");
        await window.fetch("https://provider.example/api/generate", { headers: { Authorization: "Bearer current-token" } });
        status = 403;
        await window.fetch("/api/admin/users", { headers: { Authorization: "Bearer current-token" } });
        assert.equal(useUserStore.getState().token, "current-token");
        const delayed = window.fetch("/api/v1/delayed", { headers: { Authorization: "Bearer current-token" } });
        useUserStore.getState().setSession("next-token", user("next"));
        finish!(new Response("{}", { status: 401 }));
        await delayed;
        assert.equal(useUserStore.getState().token, "next-token");
        status = 401;
        await window.fetch("/api/v1/wallet", { headers: { Authorization: "Bearer next-token" } });
        assert.equal(useUserStore.getState().token, "");
    } finally {
        stop();
        useUserStore.setState(originalSession);
        // Let listener persistence and the logout cookie queue settle before removing the browser stub.
        await new Promise<void>((resolve) => setImmediate(resolve));
        Object.assign(localForageStorage, originalStorage);
        axios.defaults.adapter = originalAdapter;
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
        globalThis.fetch = originalFetch;
    }
});
