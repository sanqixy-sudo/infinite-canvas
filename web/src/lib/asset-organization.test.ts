import assert from "node:assert/strict";
import test from "node:test";

import { countFolderAssets, folderDescendantIds, folderPath, folderTreeOptions, organizeAsset, searchAssetFolders, validateAssetFolders, type AssetFolder } from "./asset-organization";

const folder = (id: string, parentId = "", name = id): AssetFolder => ({ id, parentId, name, createdAt: "", updatedAt: "" });

test("folder traversal and counts keep one asset once across multiple descendant memberships", () => {
    const folders = [folder("root"), folder("child", "root"), folder("leaf", "child"), folder("other")];
    assert.deepEqual(folderDescendantIds(folders, "root"), ["root", "child", "leaf"]);
    assert.deepEqual(folderPath(folders, "leaf").map((item) => item.id), ["root", "child", "leaf"]);
    assert.equal(countFolderAssets([{ folderIds: ["child", "leaf"] }, { folderIds: ["other"] }], folders, "root"), 1);
    assert.equal(countFolderAssets([{ folderIds: ["child", "leaf"] }], folders, "root", false), 0);
    assert.deepEqual(searchAssetFolders(folders, "leaf").map((item) => item.id), ["root", "child", "leaf"]);
    assert.equal(folderTreeOptions(folders)[0]?.children?.[0]?.children?.[0]?.value, "leaf");
});

test("folder validation rejects cycles, sibling aliases, absent parents and a ninth level", () => {
    assert.throws(() => validateAssetFolders([folder("a", "b"), folder("b", "a")]), /自己或子文件夹/);
    assert.throws(() => validateAssetFolders([folder("a", "", "素材"), folder("b", "", " 素材 ")]), /重名/);
    assert.throws(() => validateAssetFolders([folder("a", "missing")]), /不存在/);
    const levels = Array.from({ length: 9 }, (_, index) => folder(String(index), index ? String(index - 1) : ""));
    assert.throws(() => validateAssetFolders(levels), /8 层/);
});

test("organization validates the final tags and membership without erasing legacy classification", () => {
    const folders = [folder("a"), folder("b")];
    const asset = { tags: Array.from({ length: 50 }, (_, i) => `tag-${i}`), folderIds: ["a"], category: "旧分类" };
    const next = organizeAsset(asset, { addTags: [" new ", "new", ""], removeTags: ["tag-0"], addFolderIds: ["b", "b"] }, folders);
    assert.equal(next.tags.length, 50);
    assert.equal(next.tags.includes("new"), true);
    assert.deepEqual(next.folderIds, ["a", "b"]);
    assert.equal(next.category, "旧分类");
    assert.equal(asset.tags.includes("new"), false);
    assert.throws(() => organizeAsset(asset, { folderIds: [], addFolderIds: ["a"] }, folders), /同时替换/);
    assert.throws(() => organizeAsset(asset, { addTags: ["same"], removeTags: [" same "] }, folders), /同时添加和移除/);
    assert.throws(() => organizeAsset(asset, { folderIds: ["missing"] }, folders), /不存在/);
});

test("removing a large directory subtree does not relax each asset's 32-folder limit", () => {
    const folders = Array.from({ length: 40 }, (_, index) => folder(`folder-${index}`));
    const asset = { tags: [], folderIds: [folders[3].id] };
    assert.deepEqual(organizeAsset(asset, { removeFolderIds: folders.map((item) => item.id) }, folders).folderIds, []);
    assert.throws(() => organizeAsset(asset, { addFolderIds: folders.map((item) => item.id) }, folders), /32 个/);
});
