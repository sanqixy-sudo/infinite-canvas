import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasProject } from "../stores/use-canvas-store";
import type { ProductionDocument, ProductionShot } from "../lib/production-types";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { assertProductionCanvasSaved, buildProductionShotCanvas } from "./production-canvas";

const shot: ProductionShot = { id: "shot", episodeId: "episode", sceneId: "", order: 0, title: "雨夜", description: "人物走入街道", dialogue: "", camera: "推进", seconds: 5, assetIds: ["asset"], canvasId: "", textNodeId: "", imageNodeId: "", videoNodeId: "", status: "ready", candidates: [], selectedImageCandidateId: "", selectedVideoCandidateId: "" };
function canvas(id: string, nodes: CanvasNodeData[] = []): CanvasProject {
    return { id, workspaceId: id === "root" ? undefined : "root", title: id, createdAt: "now", updatedAt: "now", nodes, connections: [], chatSessions: [], activeChatId: null, agentConfig: null, autoTitlePending: false, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, sidePanel: { open: true, width: 280 }, agentPanel: { open: false, width: 464 } };
}
function node(id: string, type: CanvasNodeType): CanvasNodeData {
    return { id, type, title: id, width: 100, height: 160, position: { x: 0, y: 0 }, metadata: { content: `https://example.com/${id}`, storageKey: `media/${id}`, status: "loading", videoTaskId: "original-task", settledCredits: 80 } };
}
function document(references: { canvasId: string; nodeId: string }[]): ProductionDocument {
    return { id: "production", workspaceId: "root", title: "计划", synopsis: "", styleGuide: "", revision: 1, createdAt: "now", updatedAt: "now", episodes: [], scenes: [], shots: [shot], assets: [{ id: "asset", kind: "character", title: "主角", description: "", variantOf: "", references }] };
}

test("same-canvas asset references are reused and de-duplicated; media type selects target", () => {
    const image = node("image", CanvasNodeType.Image), audio = node("audio", CanvasNodeType.Audio);
    const root = canvas("root", [image, audio]);
    const plan = document([{ canvasId: "root", nodeId: "image" }, { canvasId: "root", nodeId: "image" }, { canvasId: "root", nodeId: "audio" }]);
    const result = buildProductionShotCanvas(plan, shot, root, [root]);
    assert.equal(result.nodes.length, 5);
    assert.deepEqual(result.connections.filter((edge) => edge.fromNodeId === "image").map((edge) => edge.toNodeId).sort(), [result.shot.imageNodeId, result.shot.videoNodeId].sort());
    assert.deepEqual(result.connections.filter((edge) => edge.fromNodeId === "audio").map((edge) => edge.toNodeId), [result.shot.videoNodeId]);
    assert.ok(result.nodes.find((item) => item.id === result.shot.imageNodeId)?.metadata?.prompt);
    assert.ok(result.nodes.find((item) => item.id === result.shot.videoNodeId)?.metadata?.prompt);
});

test("cross-canvas reference clones retain the same file, not the original task or billing", () => {
    const source = node("reference", CanvasNodeType.Image);
    const root = canvas("root"), other = canvas("other", [source]);
    const result = buildProductionShotCanvas(document([{ canvasId: "other", nodeId: source.id }]), shot, root, [root, other]);
    const copied = result.nodes.find((item) => item.metadata?.storageKey === source.metadata?.storageKey)!;
    assert.notEqual(copied.id, source.id);
    assert.equal(copied.metadata?.content, source.metadata?.content);
    assert.equal(copied.metadata?.videoTaskId, undefined);
    assert.equal(copied.metadata?.settledCredits, undefined);
    assert.equal(copied.metadata?.status, "success");
    assert.equal(source.metadata?.videoTaskId, "original-task");
    assert.equal(root.nodes.length, 0);
});

test("empty or foreign references block placement instead of silently disappearing", () => {
    const empty = node("empty", CanvasNodeType.Image); empty.metadata!.content = ""; delete empty.metadata!.storageKey;
    const root = canvas("root", [empty]);
    assert.throws(() => buildProductionShotCanvas(document([{ canvasId: "root", nodeId: "empty" }]), shot, root, [root]), /还没有内容/);
    const foreign = { ...canvas("foreign", [node("source", CanvasNodeType.Video)]), workspaceId: "other-workspace" };
    assert.throws(() => buildProductionShotCanvas(document([{ canvasId: "foreign", nodeId: "source" }]), shot, root, [root, foreign]), /已失效/);
});

test("media references with storage identity can be restored when entering the canvas", () => {
    const storedVideo = node("stored-video", CanvasNodeType.Video); storedVideo.metadata!.content = "";
    const root = canvas("root", [storedVideo]);
    const result = buildProductionShotCanvas(document([{ canvasId: "root", nodeId: storedVideo.id }]), shot, root, [root]);
    assert.ok(result.connections.some((edge) => edge.fromNodeId === storedVideo.id && edge.toNodeId === result.shot.videoNodeId));
});

test("canvas save acknowledgement must match the sent snapshot", () => {
    const sent = canvas("root");
    assert.doesNotThrow(() => assertProductionCanvasSaved(sent, JSON.parse(JSON.stringify(sent))));
    const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(sent))).reverse()) as CanvasProject;
    assert.doesNotThrow(() => assertProductionCanvasSaved(sent, reordered));
    assert.throws(() => assertProductionCanvasSaved(sent, { ...sent, updatedAt: "newer", nodes: [node("new", CanvasNodeType.Text)] }), /已有更新/);
});
