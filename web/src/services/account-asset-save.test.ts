import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
const { spyOn, jest } = require("bun:test");

import { useAssetStore, type Asset, type AssetInput } from "@/stores/use-asset-store";
import { useStoragePreferencesStore } from "@/stores/use-storage-preferences-store";
import { useUserStore } from "@/stores/use-user-store";
import { clearAutomaticMediaCache, saveAutomaticMedia, type SavedAutomaticMedia } from "./automatic-media-save";
import { saveAssetToAccountLibrary } from "./account-asset-save";

afterEach(() => {
    jest.restoreAllMocks();
    useUserStore.setState({ token: "", user: null });
    useStoragePreferencesStore.getState().reset();
});

function session(token: string) {
    useUserStore.setState({ token, user: null });
    useStoragePreferencesStore.setState({ token, ready: true, autoSaveAssetsToCloud: true });
}

function sourceAsset(key: string, title: string): AssetInput {
    return { id: "draft", kind: "image", title, tags: [title], coverUrl: "blob:preview", metadata: { note: title }, data: { dataUrl: "blob:preview", storageKey: key, width: 4, height: 4, bytes: 8, mimeType: "image/png" } };
}

async function seedArchivedCopy(token: string, key: string, id: string) {
    const file: SavedAutomaticMedia = { url: `/api/files/${id}/content`, storageKey: `server:${id}`, bytes: 8, mimeType: "image/png", width: 4, height: 4 };
    const result = await saveAutomaticMedia({ source: `manual-seed:${id}`, kind: "image", title: "原始文件", token, saveLocal: async () => ({ ...file, url: "blob:preview", storageKey: key }), uploadCloud: async () => file, unarchived: async () => null });
    assert.equal(result.storageKey, key);
    assert.ok(result.accountSaveError, "seed must simulate an uploaded file whose library entry failed");
    return file;
}

test("manual retry keeps current edits and sequential copies reuse the archived file", async () => {
    const token = "manual-retry-owner";
    const key = "image:manual-retry";
    session(token);
    const state = useAssetStore.getState();
    const entries: AssetInput[] = [];
    let failure = "登记失败";
    spyOn(useAssetStore, "getState").mockImplementation(() => ({ ...state, saveCloudAsset: async (asset: AssetInput) => {
        entries.push(asset);
        if (failure) throw new Error(failure);
        return "saved-entry";
    } }));
    const file = await seedArchivedCopy(token, key, "manual-retry-file");
    const original = sourceAsset(key, "首次标题");
    await assert.rejects(saveAssetToAccountLibrary(original, token), /登记失败/);
    clearAutomaticMediaCache(key);
    failure = "";
    const edited = { ...original, title: "重试后的标题", tags: ["新的标签"], metadata: { note: "最新备注" } };
    const saved = await saveAssetToAccountLibrary(edited, token);
    assert.equal(saved.kind === "image" ? saved.data.storageKey : "", file.storageKey);
    assert.equal(entries.at(-1)?.title, edited.title);
    assert.deepEqual(entries.at(-1)?.tags, edited.tags);
    assert.deepEqual(entries.at(-1)?.metadata, { ...edited.metadata, browserSourceId: encodeURIComponent(key) });
    const second = await saveAssetToAccountLibrary({ ...edited, id: "second-node", title: "第二个节点" }, token);
    assert.equal(second.kind === "image" ? second.data.storageKey : "", file.storageKey, "a second node with the same browser file must not upload again");
    assert.equal(entries.at(-1)?.title, "第二个节点");
});

test("only a confirmed missing archive or token change invalidates the source mapping", async () => {
    const token = "manual-expiry-owner";
    const key = "image:manual-expiry";
    session(token);
    const state = useAssetStore.getState();
    let failure = "登记失败";
    const entries: AssetInput[] = [];
    spyOn(useAssetStore, "getState").mockImplementation(() => ({ ...state, saveCloudAsset: async (asset: AssetInput) => {
        entries.push(asset);
        if (failure) throw new Error(failure);
        return "saved-entry";
    } }));
    await seedArchivedCopy(token, key, "expired-file");
    failure = "素材文件不存在或不属于当前账号";
    await assert.rejects(saveAssetToAccountLibrary(sourceAsset(key, "失效文件"), token), /文件不存在/);
    failure = "登记失败";
    const replacement = await seedArchivedCopy(token, key, "replacement-file");
    failure = "";
    await saveAssetToAccountLibrary(sourceAsset(key, "恢复保存"), token);
    const restored = entries.at(-1);
    assert.equal(restored?.kind === "image" ? restored.data.storageKey : "", replacement.storageKey);
    session("another-manual-owner");
    session(token);
    failure = "登记失败";
    const afterLogin = await seedArchivedCopy(token, key, "after-login-file");
    failure = "";
    await saveAssetToAccountLibrary(sourceAsset(key, "重新登录"), token);
    const last = entries.at(-1);
    assert.equal(last?.kind === "image" ? last.data.storageKey : "", afterLogin.storageKey, "logout/login must clear even a cache belonging to the same reused token");
});

test("a restored cloud entry reuses the same browser file after memory caches are cleared", async () => {
    const token = "manual-restored-owner";
    const key = "image:restored-browser-file";
    session(token);
    const state = useAssetStore.getState();
    let failure = "登记失败";
    let cloudAssets: Asset[] = [];
    const entries: AssetInput[] = [];
    spyOn(useAssetStore, "getState").mockImplementation(() => ({ ...state, cloudAssets, saveCloudAsset: async (asset: AssetInput) => {
        entries.push(asset);
        if (failure) throw new Error(failure);
        return "restored-entry";
    } }));
    const file = await seedArchivedCopy(token, key, "restored-server-file");
    failure = "";
    const original = await saveAssetToAccountLibrary(sourceAsset(key, "首次入库"), token);
    assert.equal(original.metadata?.browserSourceId, encodeURIComponent(key));
    assert.doesNotMatch(String(original.metadata?.browserSourceId), /blob:|data:|https?:|manual-restored-owner/);
    cloudAssets = [{ ...original, createdAt: "", updatedAt: "" } as Asset];
    session("other-restored-owner");
    session(token);
    const restored = await saveAssetToAccountLibrary({ ...sourceAsset(key, "复制节点的新标题"), id: "second-node", metadata: { note: "本次编辑" } }, token);
    assert.equal(restored.kind === "image" ? restored.data.storageKey : "", file.storageKey);
    assert.equal(entries.at(-1)?.title, "复制节点的新标题");
    assert.deepEqual(entries.at(-1)?.metadata, { note: "本次编辑", browserSourceId: encodeURIComponent(key) });
});
