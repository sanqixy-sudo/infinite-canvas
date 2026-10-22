import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";

import { useAssetStore, type AssetInput } from "@/stores/use-asset-store";
import { useStoragePreferencesStore } from "@/stores/use-storage-preferences-store";
import { useUserStore } from "@/stores/use-user-store";
import { getPendingAutomaticCloudCopy, saveAutomaticMedia, type SavedAutomaticMedia } from "./automatic-media-save";

afterEach(() => mock.restoreAll());

function session(token: string, enabled: boolean, saveCloudAsset: (asset: AssetInput) => Promise<string> = async () => "cloud-file") {
    const user = useUserStore.getState();
    const preferences = useStoragePreferencesStore.getState();
    const assets = useAssetStore.getState();
    let current = token;
    mock.method(useUserStore, "getState", () => ({ ...user, token: current }));
    mock.method(useStoragePreferencesStore, "getState", () => ({ ...preferences, token, ready: true, autoSaveAssetsToCloud: enabled }));
    mock.method(useAssetStore, "getState", () => ({ ...assets, saveCloudAsset }));
    return (next: string) => { current = next; };
}

const local: SavedAutomaticMedia = { url: "blob:browser", storageKey: "image:browser", bytes: 4, mimeType: "image/png" };
const cloud: SavedAutomaticMedia = { url: "/api/files/file/content", storageKey: "server:file", bytes: 4, mimeType: "image/png" };

test("disabled automatic saving writes browser media without uploading", async () => {
    const token = "browser-only";
    session(token, false);
    let writes = 0;
    let uploads = 0;
    const result = await saveAutomaticMedia({ source: "image:off", kind: "image", title: "图片", token, saveLocal: async () => { writes++; return local; }, uploadCloud: async () => { uploads++; return cloud; }, unarchived: async () => null });
    assert.equal(result.storageKey, local.storageKey);
    assert.equal(writes, 1);
    assert.equal(uploads, 0);
});

test("account success requires both the uploaded file and its library entry", async () => {
    const token = "account-success";
    let entries = 0;
    let uploads = 0;
    session(token, true, async (asset) => {
        entries++;
        assert.equal(asset.kind, "image");
        assert.equal(asset.data.storageKey, cloud.storageKey);
        return "cloud-file";
    });
    const options = { source: "image:success", kind: "image" as const, title: "图片", token, saveLocal: async () => { throw new Error("不应写本机"); }, uploadCloud: async () => { uploads++; return cloud; }, unarchived: async () => null };
    assert.equal((await saveAutomaticMedia(options)).storageKey, cloud.storageKey);
    assert.equal((await saveAutomaticMedia(options)).storageKey, cloud.storageKey);
    assert.equal(uploads, 1);
    assert.equal(entries, 1);
});

test("entry failure keeps a browser copy and reuses the uploaded file for manual recovery", async () => {
    const token = "entry-failure";
    session(token, true, async () => { throw new Error("登记失败"); });
    let uploads = 0;
    const options = { source: "image:entry-failed", kind: "image" as const, title: "图片", token, saveLocal: async () => local, uploadCloud: async () => { uploads++; return cloud; }, unarchived: async () => null };
    const result = await saveAutomaticMedia(options);
    assert.equal(result.storageKey, local.storageKey);
    assert.equal(result.accountSaveError, "登记失败");
    assert.equal(getPendingAutomaticCloudCopy(local.storageKey)?.storageKey, cloud.storageKey);
    await saveAutomaticMedia(options);
    assert.equal(uploads, 1);
});

test("failed browser persistence keeps the visible result unarchived and allows a later retry", async () => {
    const token = "browser-full";
    session(token, false);
    let writes = 0;
    const options = { source: "image:not-yet-saved", kind: "image" as const, title: "图片", token, saveLocal: async () => { if (++writes === 1) throw new Error("空间不足"); return local; }, uploadCloud: async () => cloud, unarchived: async () => ({ ...local, storageKey: "" }) };
    const first = await saveAutomaticMedia(options);
    assert.equal(first.url, local.url);
    assert.equal(first.storageKey, "");
    assert.match(first.accountSaveError || "", /尚未归档/);
    assert.equal((await saveAutomaticMedia(options)).storageKey, local.storageKey);
    assert.equal(writes, 2);
});

test("an account switch after upload cannot register or fall back into the new session", async () => {
    const token = "original-account";
    let entries = 0;
    let localWrites = 0;
    const switchSession = session(token, true, async () => { entries++; return "unexpected"; });
    await assert.rejects(saveAutomaticMedia({ source: "image:session-switch", kind: "image", title: "图片", token, saveLocal: async () => { localWrites++; return local; }, uploadCloud: async () => { switchSession("another-account"); return cloud; }, unarchived: async () => null }), /登录状态已变化/);
    assert.equal(entries, 0);
    assert.equal(localWrites, 0);
});

test("Blob sources share concurrent work without keeping settled blobs in the request cache", async () => {
    const token = "blob-cache";
    session(token, false);
    let writes = 0;
    const options = { source: new Blob(["media"]), kind: "image" as const, title: "图片", token, saveLocal: async () => { writes++; return local; }, uploadCloud: async () => cloud, unarchived: async () => null };
    await Promise.all([saveAutomaticMedia(options), saveAutomaticMedia(options)]);
    assert.equal(writes, 1);
    await saveAutomaticMedia(options);
    assert.equal(writes, 2);
});
