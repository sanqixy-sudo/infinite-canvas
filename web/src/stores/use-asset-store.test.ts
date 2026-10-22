import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

import { useAssetStore, type Asset, type AssetInput } from "./use-asset-store";
import { useUserStore } from "./use-user-store";

const text = (title: string): AssetInput => ({ kind: "text", title, coverUrl: "", tags: [], data: { content: title } });
const image = (id: string, storageKey: string): Asset => ({ id, kind: "image", title: id, coverUrl: "blob:preview", tags: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", data: { dataUrl: "blob:preview", storageKey, width: 1, height: 1, bytes: 1, mimeType: "image/png" } });

function session(id = "") {
    useUserStore.setState({ token: id ? `token-${id}` : "", user: id ? { id, username: id, displayName: id, avatarUrl: "", role: "user", credits: 0, createdAt: "", updatedAt: "" } : null, isReady: true });
}

function reply(config: InternalAxiosRequestConfig, data: unknown, status = 200) {
    return { data: { code: status === 200 ? 0 : 1, data, msg: status === 200 ? "" : "保存失败" }, status, statusText: "", headers: {}, config };
}

test("browser assets stay with their owner and unassigned legacy data requires explicit import", async () => {
    await useAssetStore.persist.rehydrate();
    const options = useAssetStore.persist.getOptions();
    const adapter = axios.defaults.adapter;
    let requests = 0;
    axios.defaults.adapter = async (config) => { requests++; return reply(config, {}); };
    try {
        session();
        useAssetStore.setState({ localAssetsByOwner: {}, localAssets: [], cloudAssets: [], assets: [], legacyBrowserAssets: [], owner: "guest" });
        const legacy = { ...text("旧浏览器素材"), id: "legacy", createdAt: "", updatedAt: "" } as Asset;
        useAssetStore.persist.setOptions({ storage: { getItem: async () => ({ state: { assets: [legacy] }, version: 0 }) as never, setItem: async () => {}, removeItem: async () => {} } });
        await useAssetStore.persist.rehydrate();
        assert.deepEqual(useAssetStore.getState().assets, []);
        assert.equal(useAssetStore.getState().legacyBrowserAssets[0]?.id, "legacy");
        const guestId = useAssetStore.getState().addAsset(text("访客本机"));
        session("a");
        assert.deepEqual(useAssetStore.getState().assets, []);
        const accountId = useAssetStore.getState().addAsset(text("账号 A 本机"));
        assert.equal(useAssetStore.getState().restoreLegacyAssetsToCurrentBrowser(), 1);
        assert.equal(useAssetStore.getState().assets.some((asset) => asset.id === "legacy"), true);
        session("b");
        assert.deepEqual(useAssetStore.getState().assets, []);
        session("a");
        assert.equal(useAssetStore.getState().assets.some((asset) => asset.id === accountId), true);
        assert.equal(useAssetStore.getState().assets.some((asset) => asset.id === guestId), false);
        session();
        assert.deepEqual(useAssetStore.getState().assets.map((asset) => asset.id), [guestId]);
        assert.equal(requests, 0, "local add/import must never call the account API");
    } finally {
        axios.defaults.adapter = adapter;
        useAssetStore.persist.setOptions({ storage: options.storage });
    }
});

test("cloud asset writes reject browser pointers, keep failed drafts and use the server's file deduplication id", async () => {
    const adapter = axios.defaults.adapter;
    session("cloud");
    useAssetStore.setState({ localAssetsByOwner: {}, localAssets: [], assets: [], cloudAssets: [] });
    const source = image("draft", "image:local-file");
    const localId = useAssetStore.getState().addAsset(source);
    let requests = 0;
    let fail = true;
    const original = image("original", "server:old-file");
    const existing = image("existing-file-entry", "server:uploaded-file");
    const legacy = image("legacy-cloud-reference", "image:other-device");
    const handler: AxiosAdapter = async (config) => {
        if (config.url?.startsWith("/api/files/")) return reply(config, { id: config.url.split("/").at(-1), publicUrl: "https://storage.example/media", contentUrl: "", direct: false });
        requests++;
        assert.equal(config.url, "/api/v1/user-data/assets/item");
        const payload = JSON.parse(String(config.data)) as { asset: Asset };
        assert.equal(payload.asset.metadata?.resultId, "image:task-id");
        if (fail) return reply(config, {}, 500);
        return reply(config, { assets: [original, existing, legacy] });
    };
    axios.defaults.adapter = handler;
    try {
        await assert.rejects(useAssetStore.getState().saveCloudAsset({ ...source, id: localId }), /账号存储/);
        assert.equal(requests, 0);
        const uploaded = { ...image(localId, "server:uploaded-file"), metadata: { resultId: "image:task-id" } };
        await assert.rejects(useAssetStore.getState().saveCloudAsset(uploaded), /保存失败/);
        assert.equal(useAssetStore.getState().localAssets.some((asset) => asset.id === localId), true);
        assert.deepEqual(useAssetStore.getState().cloudAssets, []);
        fail = false;
        useAssetStore.setState({ cloudAssets: [original] });
        const savedId = await useAssetStore.getState().saveCloudAsset({ ...uploaded, id: "original" });
        assert.equal(savedId, "existing-file-entry", "match storageKey before the unchanged original id");
        await useAssetStore.getState().saveCloudAsset(uploaded);
        assert.equal(useAssetStore.getState().localAssets.some((asset) => asset.id === localId), false);
        assert.equal(useAssetStore.getState().cloudAssets.some((asset) => asset.id === legacy.id), false);
        assert.equal(useAssetStore.getState().legacyBrowserAssets.some((asset) => asset.id === legacy.id), true);
        session("other");
        assert.equal(useAssetStore.getState().legacyBrowserAssets.some((asset) => asset.id === legacy.id), false);
    } finally { axios.defaults.adapter = adapter; }
});

test("a response from the previous account never updates the next account's assets", async () => {
    const adapter = axios.defaults.adapter;
    session("old");
    let finish: ((value: ReturnType<typeof reply>) => void) | undefined;
    let requestConfig: InternalAxiosRequestConfig | undefined;
    const started = new Promise<void>((resolve) => {
        axios.defaults.adapter = (config) => new Promise((done) => { requestConfig = config; finish = done; resolve(); });
    });
    const saving = useAssetStore.getState().saveCloudAsset(text("旧账号文本"));
    const rejected = assert.rejects(saving, /登录状态已变化/);
    try {
        await started;
        session("next");
        finish!(reply(requestConfig!, { assets: [{ ...text("旧账号文本"), id: "old-entry", createdAt: "", updatedAt: "" }] }));
        await rejected;
        assert.equal(useAssetStore.getState().owner, "user:next");
        assert.deepEqual(useAssetStore.getState().cloudAssets, []);
    } finally { axios.defaults.adapter = adapter; }
});
