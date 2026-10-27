import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

import { useAssetStore, type Asset, type AssetFolder, type AssetInput } from "./use-asset-store";
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
    useAssetStore.setState({ localAssetsByOwner: {}, localFoldersByOwner: {}, localFolders: [], localAssets: [], assets: [], cloudAssets: [], cloudFolders: [], hydrated: true });
    const localFolder = await useAssetStore.getState().saveFolder("local", { name: "仅本机归属" });
    const source = { ...image("draft", "image:local-file"), folderIds: [localFolder.id] };
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
        assert.deepEqual(payload.asset.folderIds, [], "archiving a local asset must not copy browser folder ids into the account library");
        if (fail) return reply(config, {}, 500);
        return reply(config, { assets: [original, existing, legacy] });
    };
    axios.defaults.adapter = handler;
    try {
        await assert.rejects(useAssetStore.getState().saveCloudAsset({ ...source, id: localId }), /账号存储/);
        assert.equal(requests, 0);
        const uploaded = { ...image(localId, "server:uploaded-file"), folderIds: [localFolder.id], metadata: { resultId: "image:task-id" } };
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

test("local folders and batch organization validate atomically and deleting a subtree preserves assets", async () => {
    session("folder-local");
    useAssetStore.setState({ localAssetsByOwner: {}, localFoldersByOwner: {}, localAssets: [], localFolders: [], cloudAssets: [], cloudFolders: [], assets: [], hydrated: true });
    const root = await useAssetStore.getState().saveFolder("local", { name: "项目" });
    const child = await useAssetStore.getState().saveFolder("local", { name: "参考", parentId: root.id });
    const other = await useAssetStore.getState().saveFolder("local", { name: "保留" });
    const assetId = useAssetStore.getState().addAsset({ ...text("参考文案"), category: "旧分类", folderIds: [child.id, other.id] });
    const beforeFolders = useAssetStore.getState().localFolders;
    await assert.rejects(useAssetStore.getState().saveFolder("local", { id: root.id, parentId: child.id }), /自己或子文件夹/);
    await assert.rejects(useAssetStore.getState().saveFolder("local", { name: " 项目 " }), /重名/);
    assert.equal(useAssetStore.getState().localFolders, beforeFolders);
    const beforeAssets = useAssetStore.getState().localAssets;
    await assert.rejects(useAssetStore.getState().organizeAssets("local", [assetId, "missing"], { addTags: ["新标签"] }), /不存在/);
    assert.equal(useAssetStore.getState().localAssets, beforeAssets);
    await useAssetStore.getState().organizeAssets("local", [assetId], { addTags: [" 标签 ", "标签", ""] });
    await useAssetStore.getState().removeFolder("local", root.id);
    assert.deepEqual(useAssetStore.getState().localAssets[0]?.folderIds, [other.id]);
    assert.deepEqual(useAssetStore.getState().localAssets[0]?.tags, ["标签"]);
    assert.equal(useAssetStore.getState().localAssets[0]?.category, "旧分类");
    session("folder-other");
    assert.deepEqual(useAssetStore.getState().localFolders, []);
    session("folder-local");
    assert.deepEqual(useAssetStore.getState().localFolders.map((folder) => folder.id), [other.id]);
});

test("collection import inserts a wrapper atomically and never reuses cloud file pointers", () => {
    session("folder-import");
    useAssetStore.setState({ localAssetsByOwner: {}, localFoldersByOwner: {}, localAssets: [], localFolders: [], cloudAssets: [], cloudFolders: [], assets: [], hydrated: true });
    const folder: AssetFolder = { id: "import-folder", name: "参考", parentId: "", createdAt: "", updatedAt: "" };
    const asset = { ...text("导入文本"), id: "import-text", folderIds: [folder.id], createdAt: "", updatedAt: "" } as Asset;
    const before = useAssetStore.getState();
    assert.throws(() => useAssetStore.getState().importLocalCollection({ folders: [folder], assets: [{ ...asset, folderIds: ["missing"] }] }), /不存在/);
    assert.equal(useAssetStore.getState().localAssets, before.localAssets);
    assert.equal(useAssetStore.getState().localFolders, before.localFolders);
    assert.throws(() => useAssetStore.getState().importLocalCollection({ folders: [], assets: [image("remote", "server:old-file")] }), /当前浏览器/);
    const wrapperId = useAssetStore.getState().importLocalCollection({ folders: [folder], assets: [asset, { ...asset, id: "unfiled", folderIds: [] }] });
    assert.equal(useAssetStore.getState().localFolders.find((item) => item.id === folder.id)?.parentId, wrapperId);
    assert.deepEqual(useAssetStore.getState().localAssets.find((item) => item.id === "unfiled")?.folderIds, [wrapperId]);
    assert.equal(useAssetStore.getState().localAssets.length, 2);
    assert.deepEqual(useAssetStore.getState().cloudAssets, []);
});

test("cloud responses preserve folders and explicit tag edits use the atomic organization endpoint", async () => {
    session("folder-cloud");
    const adapter = axios.defaults.adapter;
    const folders: AssetFolder[] = [{ id: "cloud-folder", name: "账号目录", parentId: "", createdAt: "", updatedAt: "" }];
    const asset = { ...text("账号文本"), id: "cloud-text", tags: ["旧标签"], folderIds: [folders[0].id], createdAt: "", updatedAt: "" } as Asset;
    useAssetStore.setState({ localAssets: [], localAssetsByOwner: {}, localFolders: [], localFoldersByOwner: {}, assets: [asset], cloudAssets: [asset], cloudFolders: folders });
    const calls: string[] = [];
    axios.defaults.adapter = async (config) => {
        calls.push(config.url!);
        if (config.url === "/api/v1/user-data/assets/organize") {
            assert.deepEqual(JSON.parse(String(config.data)), { ids: [asset.id], addTags: ["新标签"], removeTags: ["旧标签"] });
            return reply(config, { assets: [{ ...asset, title: "新标题", tags: ["新标签"] }], folders });
        }
        const submitted = JSON.parse(String(config.data)) as { asset: Asset };
        assert.deepEqual(submitted.asset.folderIds, [folders[0].id]);
        assert.deepEqual(submitted.asset.tags, ["旧标签"]);
        return reply(config, { assets: [{ ...asset, title: "新标题" }], folders });
    };
    try {
        await useAssetStore.getState().updateCloudAsset(asset.id, { title: "新标题", tags: ["新标签"] });
        assert.deepEqual(calls, ["/api/v1/user-data/assets/item", "/api/v1/user-data/assets/organize"]);
        assert.deepEqual(useAssetStore.getState().cloudFolders, folders);
        assert.deepEqual(useAssetStore.getState().cloudAssets[0]?.tags, ["新标签"]);
    } finally { axios.defaults.adapter = adapter; }
});

test("cloud folder rename and move send only the fields explicitly edited", async () => {
    session("folder-partial");
    const adapter = axios.defaults.adapter;
    const parent: AssetFolder = { id: "parent", name: "上级", parentId: "", createdAt: "", updatedAt: "" };
    let folder: AssetFolder = { id: "editable", name: "原名", parentId: "", createdAt: "", updatedAt: "" };
    useAssetStore.setState({ cloudAssets: [], cloudFolders: [parent, folder] });
    let calls = 0;
    axios.defaults.adapter = async (config) => {
        assert.equal(config.url, "/api/v1/user-data/asset-folders");
        const payload = JSON.parse(String(config.data));
        if (calls++ === 0) {
            assert.deepEqual(payload, { id: folder.id, name: "新名称" });
            folder = { ...folder, name: "新名称", parentId: parent.id };
        } else {
            assert.deepEqual(payload, { id: folder.id, parentId: "" });
            folder = { ...folder, name: "其他设备的新名称", parentId: "" };
        }
        return reply(config, { assets: [], folders: [parent, folder] });
    };
    try {
        const renamed = await useAssetStore.getState().saveFolder("cloud", { id: folder.id, name: " 新名称 " });
        assert.equal(renamed.parentId, parent.id);
        const moved = await useAssetStore.getState().saveFolder("cloud", { id: folder.id, parentId: "" });
        assert.equal(moved.name, "其他设备的新名称");
        assert.equal(calls, 2);
    } finally { axios.defaults.adapter = adapter; }
});

test("unchanged tags never send an empty organization operation", async () => {
    session("unchanged-tags");
    const adapter = axios.defaults.adapter;
    const asset = { ...text("标题"), id: "tagged", tags: ["a", "b"], folderIds: [], createdAt: "", updatedAt: "" } as Asset;
    useAssetStore.setState({ cloudAssets: [asset], cloudFolders: [] });
    let calls = 0;
    axios.defaults.adapter = async (config) => {
        calls++;
        assert.equal(config.url, "/api/v1/user-data/assets/item");
        return reply(config, { assets: [{ ...asset, title: "新标题" }], folders: [] });
    };
    try {
        await useAssetStore.getState().updateCloudAsset(asset.id, { tags: [" b ", "a", "a"] });
        assert.equal(calls, 0);
        await useAssetStore.getState().updateCloudAsset(asset.id, { title: "新标题", tags: ["a", "b"] });
        assert.equal(calls, 1, "metadata edits must not be followed by an empty organize request");
    } finally { axios.defaults.adapter = adapter; }
});

test("an eight-level package imports at root without a wrapper and unfiled assets can enter a level-eight target", () => {
    session("depth-import");
    const existing: AssetFolder = { id: "existing", name: "层 0", parentId: "", createdAt: "", updatedAt: "" };
    useAssetStore.setState({ localAssetsByOwner: {}, localFoldersByOwner: {}, localAssets: [], localFolders: [existing], cloudAssets: [], cloudFolders: [], assets: [], hydrated: true });
    const folders = Array.from({ length: 8 }, (_, index): AssetFolder => ({ id: `level-${index}`, name: `层 ${index}`, parentId: index ? `level-${index - 1}` : "", createdAt: "", updatedAt: "" }));
    const asset = { ...text("深层素材"), id: "deep-text", folderIds: [folders[7].id], createdAt: "", updatedAt: "" } as Asset;
    const result = useAssetStore.getState().importLocalCollection({ assets: [asset], folders });
    assert.equal(result, "");
    assert.equal(useAssetStore.getState().localFolders.length, 9);
    assert.equal(useAssetStore.getState().localFolders.find((folder) => folder.id === folders[0].id)?.name, "导入 - 层 0 (2)");
    const before = useAssetStore.getState();
    assert.throws(() => useAssetStore.getState().importLocalCollection({ assets: [], folders }, existing.id), /选择根目录/);
    assert.equal(useAssetStore.getState().localFolders, before.localFolders);
    const unfiled = { ...text("无目录素材"), id: "unfiled-at-eight", folderIds: [], createdAt: "", updatedAt: "" } as Asset;
    assert.equal(useAssetStore.getState().importLocalCollection({ assets: [unfiled], folders: [] }, folders[7].id), folders[7].id);
    assert.equal(useAssetStore.getState().localFolders.length, 9);
    assert.deepEqual(useAssetStore.getState().localAssets.find((item) => item.id === unfiled.id)?.folderIds, [folders[7].id]);
});

test("resolving a stored image preserves an independent data URL cover", async () => {
    session("custom-cover");
    const coverUrl = "data:image/png;base64,custom-cover";
    const asset = { ...image("covered", "server:covered-file"), coverUrl, data: { ...image("covered", "server:covered-file").data, dataUrl: "https://storage.example/main.png" } } as Asset;
    const localAssets = [asset];
    useAssetStore.setState({ localAssets, localAssetsByOwner: { "user:custom-cover": localAssets }, cloudAssets: [], assets: localAssets });
    useAssetStore.getState().selectAssetSession(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(useAssetStore.getState().localAssets[0]?.coverUrl, coverUrl);
});

test("a full thousand-folder export imports without an extra wrapper exceeding the limit", () => {
    session("folder-limit-import");
    useAssetStore.setState({ localAssetsByOwner: {}, localFoldersByOwner: {}, localAssets: [], localFolders: [], cloudAssets: [], cloudFolders: [], assets: [], hydrated: true });
    const folders = Array.from({ length: 1000 }, (_, index): AssetFolder => ({ id: `folder-${index}`, name: `目录 ${index}`, parentId: "", createdAt: "", updatedAt: "" }));
    assert.equal(useAssetStore.getState().importLocalCollection({ assets: [], folders }), "");
    assert.equal(useAssetStore.getState().localFolders.length, 1000);
});
