import assert from "node:assert/strict";
import test from "node:test";
import axios, { type InternalAxiosRequestConfig } from "axios";
import { apiGet } from "@/services/api/request";
import { useUserStore } from "./use-user-store";

const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: "", role: "user" as const, credits: 0, createdAt: "", updatedAt: "" });
const reply = (config: InternalAxiosRequestConfig, data: unknown, status = 200) => ({ config, status, statusText: "", headers: {}, data: { code: status === 200 ? 0 : 1, data, msg: status === 200 ? "" : "未登录" } });

test("old identity responses and old-token 401s cannot overwrite a new session", async () => {
    const original = axios.defaults.adapter;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    let finish: ((response: ReturnType<typeof reply>) => void) | undefined;
    let request: InternalAxiosRequestConfig | undefined;
    axios.defaults.adapter = (config) => new Promise((resolve) => { request = config; finish = resolve; });
    try {
        useUserStore.getState().setSession("old-token", user("old"));
        const hydrating = useUserStore.getState().hydrateUser();
        useUserStore.getState().setSession("new-token", user("new"));
        finish!(reply(request!, user("old")));
        await hydrating;
        assert.equal(useUserStore.getState().user?.id, "new");
        const stale = apiGet("/api/v1/wallet", undefined, "old-token");
        const rejected = assert.rejects(stale, /未登录/);
        finish!(reply(request!, null, 401));
        await rejected;
        assert.equal(useUserStore.getState().token, "new-token");
        const current = apiGet("/api/v1/wallet", undefined, "new-token");
        const expired = assert.rejects(current, /未登录/);
        finish!(reply(request!, null, 401));
        await expired;
        assert.equal(useUserStore.getState().token, "");
    } finally { axios.defaults.adapter = original; globalThis.fetch = originalFetch; }
});

test("temporary identity errors keep the token for retry and forbidden responses never log out", async () => {
    const original = axios.defaults.adapter;
    useUserStore.getState().setSession("valid-token", user("current"));
    try {
        axios.defaults.adapter = async () => { throw new Error("offline"); };
        await useUserStore.getState().hydrateUser();
        assert.equal(useUserStore.getState().token, "valid-token");
        assert.notEqual(useUserStore.getState().authError, "");
        axios.defaults.adapter = async (config) => reply(config, null, 403);
        await assert.rejects(apiGet("/api/admin/users", undefined, "valid-token"));
        assert.equal(useUserStore.getState().token, "valid-token");
    } finally { axios.defaults.adapter = original; }
});
