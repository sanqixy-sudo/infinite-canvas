import assert from "node:assert/strict";
import test from "node:test";

import { organizeAsset } from "../../../lib/asset-organization";
import { bulkTagValues, createBulkTagDraft, updateBulkTagDraft } from "./bulk-tag-draft";

test("bulk edits keep untouched unique tags on their original assets", () => {
    const assets = [{ tags: ["共同", "A 独有"] }, { tags: ["共同", "B 独有"] }];
    const initial = createBulkTagDraft(assets);
    assert.equal(initial.counts.get("A 独有"), 1);
    assert.deepEqual(initial.addTags, []);
    const edited = updateBulkTagDraft(initial, [...bulkTagValues(initial), "新标签"]);
    assert.deepEqual(edited.addTags, ["新标签"]);
    assert.deepEqual(edited.removeTags, []);
    assert.deepEqual(organizeAsset(assets[0], edited, []).tags, ["共同", "A 独有", "新标签"]);
    assert.deepEqual(organizeAsset(assets[1], edited, []).tags, ["共同", "B 独有", "新标签"]);
});

test("removing a chip is explicit; readding a partial tag applies it to all", () => {
    const initial = createBulkTagDraft([{ tags: ["共同", "部分"] }, { tags: ["共同"] }]);
    const removed = updateBulkTagDraft(initial, ["共同"]);
    assert.deepEqual(removed.removeTags, ["部分"]);
    const reapplied = updateBulkTagDraft(removed, ["共同", "部分"]);
    assert.deepEqual(reapplied.addTags, ["部分"]);
    assert.deepEqual(reapplied.removeTags, []);
    const undoCommon = updateBulkTagDraft(updateBulkTagDraft(initial, ["部分"]), ["共同", "部分"]);
    assert.deepEqual(undoCommon.addTags, []);
    assert.deepEqual(undoCommon.removeTags, []);
});

test("single selection, cancelled additions and large unions do not produce replacement patches", () => {
    const initial = createBulkTagDraft([{ tags: ["一", "二"] }]);
    assert.deepEqual(updateBulkTagDraft(initial, ["二"]).removeTags, ["一"]);
    const added = updateBulkTagDraft(initial, ["一", "二", " 临时 ", "临时"]);
    const undone = updateBulkTagDraft(added, ["一", "二"]);
    assert.deepEqual(undone.addTags, []);
    assert.deepEqual(undone.removeTags, []);
    const large = createBulkTagDraft([{ tags: Array.from({ length: 40 }, (_, i) => `A${i}`) }, { tags: Array.from({ length: 40 }, (_, i) => `B${i}`) }]);
    assert.equal(bulkTagValues(updateBulkTagDraft(large, bulkTagValues(large))).length, 80);
    assert.throws(() => updateBulkTagDraft(initial, ["字".repeat(81)]), /80 字/);
});
