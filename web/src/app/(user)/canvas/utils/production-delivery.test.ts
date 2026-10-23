import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionDocument, ProductionShot } from "../lib/production-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType } from "../types";
import { buildProductionDelivery, productionDeliveryRows, productionDialogueSrt } from "./production-delivery";
import { emptyProductionDelivery, productionDeliveryIssues, productionEditedSrt } from "./production-delivery-edit";

function fixture() {
    const makeShot = (id: string, order: number): ProductionShot => ({ id, episodeId: "episode", sceneId: "", order, title: id, description: "", dialogue: order === 1 ? "你好\n\n再见" : "", camera: "", seconds: 5, assetIds: [], canvasId: "canvas", textNodeId: "", imageNodeId: "", videoNodeId: "result", status: "ready", candidates: [{ id: `candidate-${id}`, kind: "video", title: id, canvasId: "canvas", nodeId: "result", storageKey: "video:one", content: "" }], selectedVideoCandidateId: `candidate-${id}`, selectedImageCandidateId: "" });
    const document: ProductionDocument = { id: "plan", workspaceId: "canvas", title: "短剧", synopsis: "", styleGuide: "", revision: 1, createdAt: "", updatedAt: "", episodes: [{ id: "episode", title: "第一集", script: "", order: 0 }], scenes: [], assets: [], shots: [makeShot("后镜", 1), makeShot("先镜", 0)] };
    const canvases = [{ id: "canvas", nodes: [{ id: "result", title: "结果", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 720, height: 1280, metadata: { storageKey: "video:one", status: "success" } }] }] as CanvasProject[];
    return { document, canvases };
}

test("分集按镜头顺序交接，复用媒体只读取一次且不包含存储Key或外链", async () => {
    const { document, canvases } = fixture();
    const rows = productionDeliveryRows(document, "episode", canvases);
    assert.deepEqual(rows.map((row) => [row.shot.title, row.startSeconds]), [["先镜", 0], ["后镜", 5]]);
    let reads = 0;
    const files = await buildProductionDelivery(document, "episode", rows, async () => { reads++; return new Blob(["real-file"], { type: "video/mp4" }); }, { subtitles: true, assertCurrent: () => undefined });
    assert.equal(reads, 1);
    assert.equal(files.filter((file) => file.name.startsWith("media/")).length, 1);
    const manifest = JSON.parse(String(files.find((file) => file.name === "分集清单.json")!.data));
    assert.equal(manifest.shots[0].media[0].path, manifest.shots[1].media[0].path);
    assert.equal(manifest.plannedDurationSeconds, 10);
    assert.doesNotMatch(JSON.stringify(manifest), /video:one|https?:/);
    assert.equal(productionDialogueSrt(rows), "1\n00:00:05,000 --> 00:00:10,000\n你好\n再见\n");
});

test("失效、未入库、缺采用的镜头全部阻止交接，不静默漏镜", async () => {
    const { document, canvases } = fixture();
    document.shots[0].candidates[0].storageKey = "";
    document.shots[0].candidates[0].content = "https://example.test/video.mp4";
    const rows = productionDeliveryRows(document, "episode", canvases);
    await assert.rejects(buildProductionDelivery(document, "episode", rows, async () => { throw new Error("不应读取"); }, { subtitles: false, assertCurrent: () => undefined }), /后镜/);
    document.shots[0].selectedVideoCandidateId = "";
    assert.match(productionDeliveryRows(document, "episode", canvases)[1].issues[0], /尚未采用/);
});

test("文件读取失败或账号变化时不输出缺文件包", async () => {
    const { document, canvases } = fixture();
    const rows = productionDeliveryRows(document, "episode", canvases);
    await assert.rejects(buildProductionDelivery(document, "episode", rows, async () => { throw new Error("文件已删除"); }, { subtitles: false, assertCurrent: () => undefined }), /文件已删除/);
    let changed = false;
    await assert.rejects(buildProductionDelivery(document, "episode", rows, async () => { changed = true; return new Blob(["x"], { type: "video/mp4" }); }, { subtitles: false, assertCurrent: () => { if (changed) throw new Error("账号已变化"); } }), /账号已变化/);
});

test("空文件和返回JSON的错误响应不能伪装成视频交付", async () => {
    const { document, canvases } = fixture();
    const rows = productionDeliveryRows(document, "episode", canvases);
    for (const blob of [new Blob([], { type: "video/mp4" }), new Blob(['{"error":"denied"}'], { type: "application/json" })]) {
        await assert.rejects(buildProductionDelivery(document, "episode", rows, async () => blob, { subtitles: false, assertCurrent: () => undefined }), /文件为空|文件类型/);
    }
});

test("交接包包含真实音轨和编辑时间表，文件地址不写进清单", async () => {
    const { document, canvases } = fixture();
    document.episodes[0].delivery = { ...emptyProductionDelivery(), burnSubtitles: true, audioTracks: [{ id: "voice", shotId: "后镜", storageKey: "server:audio-private", label: "对白配音", startSeconds: 5, trimStartSeconds: 1, durationSeconds: 3, gain: 0.8 }], subtitles: [{ id: "caption", shotId: "后镜", startSeconds: 5.125, endSeconds: 8.125, text: "已编辑对白" }] };
    const files = await buildProductionDelivery(document, "episode", productionDeliveryRows(document, "episode", canvases), async (candidate) => new Blob(["real"], { type: candidate.kind === "audio" ? "audio/mpeg" : "video/mp4" }), { subtitles: true, assertCurrent: () => undefined });
    assert.equal(files.filter((file) => file.name.startsWith("audio/")).length, 1);
    const manifest = JSON.parse(String(files.find((file) => file.name === "分集清单.json")!.data));
    assert.equal(manifest.delivery.audioTracks[0].trimStartSeconds, 1);
    assert.equal(manifest.delivery.audioTracks[0].gain, 0.8);
    assert.doesNotMatch(JSON.stringify(manifest), /server:|audio-private/);
    assert.match(String(files.find((file) => file.name === "分集字幕-编辑版.srt")!.data), /00:00:05,125 --> 00:00:08,125\n已编辑对白/);
    assert.equal(productionDeliveryIssues(document.episodes[0].delivery, 6).length, 2);
    assert.equal(productionEditedSrt([{ id: "c", shotId: "", startSeconds: 0, endSeconds: 1, text: "甲\n\n乙" }]), "1\n00:00:00,000 --> 00:00:01,000\n甲\n乙\n");
});
