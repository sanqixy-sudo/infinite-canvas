import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { localForageStorage } from "@/lib/localforage-storage";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, type CanvasProject } from "./use-canvas-store";

const legacyKey = "infinite-canvas:canvas_store";
const bucket = (id: string) => `${legacyKey}:user:${id}`;
const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: "", role: "user" as const, credits: 0, createdAt: "", updatedAt: "" });
const project = (id: string, workspaceId?: string): CanvasProject => ({ id, title: id, workspaceId, createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", nodes: [], connections: [], chatSessions: [], activeChatId: null, agentConfig: null, autoTitlePending: false, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, sidePanel: { open: true, width: 280 }, agentPanel: { open: false, width: 464 } });

function settled(id: string, expectError = false) {
    return new Promise<void>((resolve, reject) => {
        const check = () => {
            const state = useCanvasStore.getState();
            if (state.ownerId === id && (expectError ? state.loadError : state.hydrated)) { clearTimeout(timer); unsubscribe(); resolve(); }
        };
        const unsubscribe = useCanvasStore.subscribe(check);
        const timer = setTimeout(() => { unsubscribe(); reject(new Error("canvas session did not settle")); }, 2000);
        check();
    });
}

test("canvas caches isolate accounts and legacy recovery preserves the original, uses new ids and remembers completed roots", async () => {
    const getItem = localForageStorage.getItem;
    const setItem = localForageStorage.setItem;
    const adapter = axios.defaults.adapter;
    const originalFetch = globalThis.fetch;
    const owned = { ...project("owned-a"), title: "本机尚未同步的更新", updatedAt: "2026-01-01T00:00:00Z" };
    const original = JSON.stringify({ state: { projects: [project("legacy-root"), project("legacy-child", "legacy-root"), owned] }, version: 0 });
    const data = new Map<string, string>([[legacyKey, original]]);
    const remote: Record<string, CanvasProject[]> = { a: [project("owned-a")], b: [project("owned-b")] };
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    localForageStorage.getItem = async (name) => data.get(name) || null;
    localForageStorage.setItem = async (name, value) => { data.set(name, value); };
    axios.defaults.adapter = async (config) => {
        const id = String(config.headers.Authorization || "").replace("Bearer token-", "");
        let result: unknown = {};
        if (config.url === "/api/v1/user-config") result = { syncCapabilities: { userData: true } };
        else if (config.url === "/api/v1/canvas/projects/sync") {
            const body = JSON.parse(String(config.data)) as { projects: CanvasProject[] };
            assert.equal(body.projects.some((item) => item.id === "legacy-root" || item.id === "legacy-child"), false, "unknown legacy IDs must never be uploaded automatically");
            remote[id] = [...(remote[id] || []), ...body.projects];
            result = remote[id];
        } else if (config.url === "/api/v1/canvas/projects") result = remote[id] || [];
        return { data: { code: 0, data: result, msg: "" }, status: 200, statusText: "", headers: {}, config };
    };
    try {
        useUserStore.getState().setSession("token-a", user("a"));
        await settled("a");
        assert.equal(useCanvasStore.getState().projects.find((item) => item.id === "owned-a")?.title, owned.title);
        assert.equal(useCanvasStore.getState().projects.some((item) => item.id === "legacy-root"), false);
        const pending = await useCanvasStore.getState().readLegacyCanvasProjects();
        assert.deepEqual(pending.map((item) => item.id).sort(), ["legacy-child", "legacy-root"]);
        assert.equal(await useCanvasStore.getState().restoreLegacyCanvasProjects(["legacy-root"]), 2);
        const restored = useCanvasStore.getState().projects.filter((item) => item.id !== "owned-a");
        assert.equal(restored.some((item) => item.id.startsWith("legacy-")), false);
        const root = restored.find((item) => !item.workspaceId)!;
        assert.equal(restored.find((item) => item.workspaceId)?.workspaceId, root.id);
        assert.equal(data.get(legacyKey), original);
        assert.equal((await useCanvasStore.getState().readLegacyCanvasProjects()).length, 0);
        useUserStore.getState().setSession("token-b", user("b"));
        await settled("b");
        assert.deepEqual(useCanvasStore.getState().projects.map((item) => item.id), ["owned-b"]);
        useUserStore.getState().setSession("token-a", user("a"));
        await settled("a");
        assert.equal((await useCanvasStore.getState().readLegacyCanvasProjects()).length, 0);
        assert.equal(data.get(legacyKey), original);
        assert.ok(data.has(bucket("a")));
        assert.ok(data.has(bucket("b")));
    } finally {
        useUserStore.getState().clearSession();
        localForageStorage.getItem = getItem;
        localForageStorage.setItem = setItem;
        axios.defaults.adapter = adapter;
        globalThis.fetch = originalFetch;
    }
});

test("recovery failures and delayed old-account reads leave the new account and original legacy data unchanged", async () => {
    const getItem = localForageStorage.getItem;
    const setItem = localForageStorage.setItem;
    const adapter = axios.defaults.adapter;
    const originalFetch = globalThis.fetch;
    const original = JSON.stringify({ state: { projects: [project("recover-me")] }, version: 0 });
    const data = new Map<string, string>([[legacyKey, original], [bucket("corrupt"), "{invalid-cache"]]);
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    localForageStorage.getItem = async (name) => data.get(name) || null;
    localForageStorage.setItem = async (name, value) => { if (name === bucket("failure") && JSON.parse(value).state.restoredLegacyRootIds?.length) throw new Error("quota"); data.set(name, value); };
    axios.defaults.adapter = async (config) => ({ data: { code: 0, data: config.url === "/api/v1/user-config" ? { syncCapabilities: { userData: false } } : [], msg: "" }, status: 200, statusText: "", headers: {}, config });
    try {
        useUserStore.getState().setSession("token-failure", user("failure"));
        await settled("failure");
        await assert.rejects(useCanvasStore.getState().restoreLegacyCanvasProjects(["recover-me"]), /quota/);
        assert.deepEqual(useCanvasStore.getState().restoredLegacyRootIds, []);
        assert.deepEqual(useCanvasStore.getState().projects, []);
        let finish: ((value: string) => void) | undefined;
        let delay = true;
        localForageStorage.getItem = async (name) => name === legacyKey && delay ? (delay = false, new Promise<string>((resolve) => { finish = resolve; })) : data.get(name) || null;
        const restoring = useCanvasStore.getState().restoreLegacyCanvasProjects(["recover-me"]);
        const rejected = assert.rejects(restoring, /登录状态已变化/);
        useUserStore.getState().setSession("token-next", user("next"));
        await settled("next");
        finish!(original);
        await rejected;
        assert.deepEqual(useCanvasStore.getState().projects, []);
        assert.equal(useCanvasStore.getState().ownerId, "next");
        assert.equal(data.get(legacyKey), original);
        useUserStore.getState().setSession("token-corrupt", user("corrupt"));
        await settled("corrupt", true);
        assert.equal(data.get(bucket("corrupt")), "{invalid-cache");
        data.set(bucket("corrupt"), JSON.stringify({ state: { projects: [], ownerId: "corrupt", restoredLegacyRootIds: [] }, version: 0 }));
        useCanvasStore.getState().retryLoad();
        await settled("corrupt");
    } finally {
        useUserStore.getState().clearSession();
        localForageStorage.getItem = getItem;
        localForageStorage.setItem = setItem;
        axios.defaults.adapter = adapter;
        globalThis.fetch = originalFetch;
    }
});
