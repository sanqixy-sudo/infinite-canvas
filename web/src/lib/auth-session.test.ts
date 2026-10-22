import assert from "node:assert/strict";
import test from "node:test";
import { observeAuthenticatedFetch } from "./auth-session";
import { useUserStore } from "@/stores/use-user-store";

const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: "", role: "user" as const, credits: 0, createdAt: "", updatedAt: "" });

test("fetch authentication observer ignores signed media, external endpoints, forbidden and old-session responses", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    let status = 401;
    let finish: ((response: Response) => void) | undefined;
    const fetcher: typeof fetch = async (input) => String(input).includes("delayed") ? new Promise((resolve) => { finish = resolve; }) : new Response("{}", { status });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: new URL("https://studio.example"), fetch: fetcher } });
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
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
        globalThis.fetch = originalFetch;
    }
});
