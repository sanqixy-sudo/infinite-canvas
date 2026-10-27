import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionDocument } from "../../../lib/production-types";
import { changeProductionShots, duplicateProductionEpisode, importProductionScript, reorderProductionEpisode, splitProductionScript } from "./production-operations";

const doc = (): ProductionDocument => ({ id: "plan", workspaceId: "root", title: "故事", revision: 3, createdAt: "", updatedAt: "", synopsis: "", styleGuide: "", episodes: [{ id: "e1", title: "第一集", script: "原剧本", order: 0 }, { id: "e2", title: "第二集", script: "另一本", order: 1 }], scenes: [{ id: "s1", episodeId: "e1", title: "屋内", description: "日", order: 0 }], assets: [{ id: "a1", kind: "character", title: "主角", description: "短发", variantOf: "", references: [] }], shots: [{ id: "shot1", episodeId: "e1", sceneId: "s1", title: "推门", order: 0, description: "进入房间", dialogue: "你好", camera: "全景", seconds: 5, assetIds: ["a1"], canvasId: "root", textNodeId: "t", imageNodeId: "i", videoNodeId: "v", status: "ready", candidates: [{ id: "c", title: "采用", canvasId: "root", nodeId: "c-node", kind: "video", content: "", storageKey: "account:test" }], selectedImageCandidateId: "", selectedVideoCandidateId: "c" }] });

test("剧本分集保留序篇和中文英文标题，内容不被当作分集", () => {
    const parts = splitProductionScript("\uFEFF序篇\r\n# 第1集：归来\r\n她说第一集结束。\r\n## 第 2 集\r\n离开\nEP 3 - 转机\n重逢", "文件名");
    assert.deepEqual(parts.map((item) => item.title), ["文件名", "第1集：归来", "第 2 集", "EP 3 - 转机"]);
    assert.equal(parts[0].script, "序篇"); assert.equal(parts[1].script, "她说第一集结束。");
    assert.throws(() => splitProductionScript("一整份无标题剧本", "故事"), /未识别/);
});

test("新增导入不改旧集；追加替换需原稿一致且保留镜头", () => {
    const source = doc(), parts = [{ title: "新集", script: "新剧本" }];
    const added = importProductionScript(source, parts, "new");
    assert.equal(added.document.episodes.length, 3); assert.equal(added.document.episodes[0], source.episodes[0]);
    assert.equal(importProductionScript(source, parts, "append", "e1", "原剧本").document.episodes[0].script, "原剧本\n\n新剧本");
    const replaced = importProductionScript(source, parts, "replace", "e1", "原剧本");
    assert.equal(replaced.document.episodes[0].script, "新剧本"); assert.equal(replaced.document.shots, source.shots);
    assert.throws(() => importProductionScript(source, parts, "replace", "e1", "旧版"), /已有修改/);
    assert.throws(() => importProductionScript(source, parts, "append", "deleted", ""), /不存在/);
    assert.equal(source.episodes[0].script, "原剧本");
});

test("导入上限和空文件拒绝，追加计算合并后字数", () => {
    const source = doc();
    assert.throws(() => importProductionScript(source, [{ title: "空", script: " " }], "new"), /正文/);
    assert.throws(() => importProductionScript(source, [{ title: "长", script: "a".repeat(100001) }], "new"), /100000/);
    source.episodes[0].script = "a".repeat(99999);
    assert.throws(() => importProductionScript(source, [{ title: "长", script: "ab" }], "append", "e1", source.episodes[0].script), /100000/);
    assert.throws(() => importProductionScript(source, Array.from({ length: 99 }, () => ({ title: "集", script: "正文" })), "split"), /100 集/);
});

test("复制分集重映射场次与镜头，清除结果和交付，资产可选择保留", () => {
    const source = doc(); source.episodes[0].delivery = { originalGain: 1, burnSubtitles: true, audioTracks: [], subtitles: [] };
    const result = duplicateProductionEpisode(source, "e1", true), copied = result.document.shots[1];
    assert.equal(result.document.episodes[1].id, result.episodeId); assert.equal(result.document.episodes[1].delivery, undefined);
    assert.notEqual(copied.id, source.shots[0].id); assert.equal(copied.episodeId, result.episodeId);
    assert.equal(copied.sceneId, result.document.scenes[1].id); assert.deepEqual(copied.assetIds, ["a1"]);
    assert.equal(copied.canvasId, ""); assert.equal(copied.status, "draft"); assert.deepEqual(copied.candidates, []); assert.equal(copied.selectedVideoCandidateId, "");
    assert.equal(source.shots[0].selectedVideoCandidateId, "c");
    assert.deepEqual(duplicateProductionEpisode(source, "e1", false).document.shots[1].assetIds, []);
});

test("复制镜头独立ID与结果，跨集清场次；移动保留结果且交付关联阻止移动", () => {
    const source = doc(), copied = changeProductionShots(source, ["shot1"], "e2", "copy", false).shots[1];
    assert.equal(copied.episodeId, "e2"); assert.equal(copied.sceneId, ""); assert.deepEqual(copied.assetIds, []); assert.equal(copied.videoNodeId, "");
    const moved = changeProductionShots(source, ["shot1"], "e2", "move");
    assert.equal(moved.shots[0].id, "shot1"); assert.equal(moved.shots[0].selectedVideoCandidateId, "c"); assert.equal(moved.shots[0].canvasId, "root");
    assert.equal(moved.shots[0].sceneId, ""); assert.equal(source.shots[0].episodeId, "e1");
    source.episodes[0].delivery = { originalGain: 1, burnSubtitles: false, audioTracks: [], subtitles: [{ id: "sub", shotId: "shot1", startSeconds: 0, endSeconds: 5, text: "你好" }] };
    assert.throws(() => changeProductionShots(source, ["shot1"], "e2", "move"), /音轨或字幕/);
    assert.throws(() => changeProductionShots(doc(), ["shot1"], "e1", "move"), /其他分集/);
    assert.throws(() => changeProductionShots(doc(), ["missing"], "e2", "copy"), /已变化/);
});

test("分集排序只改顺序；复制上限在任何写入前拒绝", () => {
    const source = doc(), ordered = reorderProductionEpisode(source, "e2", -1);
    assert.deepEqual(ordered.episodes.map((episode) => [episode.id, episode.order]), [["e2", 0], ["e1", 1]]);
    assert.equal(ordered.shots, source.shots); assert.equal(reorderProductionEpisode(source, "e1", -1), source);
    source.shots = Array.from({ length: 500 }, (_, index) => ({ ...source.shots[0], id: `shot${index}` }));
    assert.throws(() => duplicateProductionEpisode(source, "e1", true), /上限/);
    assert.throws(() => changeProductionShots(source, ["shot1"], "e2", "copy"), /500/);
});
