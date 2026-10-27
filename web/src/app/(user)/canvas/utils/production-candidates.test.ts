import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionCandidate, ProductionShot } from "../lib/production-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { buildProductionCandidate, getProductionShotState, isProductionCandidateValid } from "./production-candidates";

const shot = (): ProductionShot => ({ id: "shot", episodeId: "episode", sceneId: "", order: 0, title: "雨夜", description: "", dialogue: "", camera: "", seconds: 5, assetIds: [], canvasId: "canvas", textNodeId: "text", imageNodeId: "image", videoNodeId: "video", status: "ready", candidates: [], selectedImageCandidateId: "", selectedVideoCandidateId: "" });
const node = (id: string, type = CanvasNodeType.Video): CanvasNodeData => ({ id, type, title: id, position: { x: 100, y: 200 }, width: 270, height: 480, metadata: { content: `https://example.test/${id}`, storageKey: `media/${id}`, status: "success", durationMs: 5000 } });
const canvas = (nodes: CanvasNodeData[]): CanvasProject => ({ id: "canvas", title: "画布", createdAt: "now", updatedAt: "now", nodes, connections: [], chatSessions: [], activeChatId: null, agentConfig: null, autoTitlePending: false, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, sidePanel: { open: true, width: 280 }, agentPanel: { open: false, width: 464 } });
const candidate = (source: CanvasNodeData): ProductionCandidate => ({ id: `candidate-${source.id}`, title: source.title, kind: source.type === CanvasNodeType.Image ? "image" : "video", canvasId: "canvas", nodeId: source.id, storageKey: source.metadata?.storageKey || "", content: source.metadata?.storageKey ? "" : source.metadata?.content || "" });

test("候选只复制当前结果，保留文件与尺寸，清掉批次、引用、任务和费用", () => {
    const source = node("image", CanvasNodeType.Image), child = node("child", CanvasNodeType.Image);
    source.metadata = { ...source.metadata, groupId: "group", isBatchRoot: true, batchChildIds: [child.id], primaryImageId: child.id, imageBatchExpanded: true, imageTaskId: "task", settledCredits: 9, clientTaskId: "client", actualTokens: 33, firstFrameNodeId: "reference", references: ["https://example.test/reference"], prompt: "参考 @[node:reference]", model: "model" };
    child.position.y = 900;
    const original = canvas([source, child]);
    const result = buildProductionCandidate(shot(), original, source.id);
    const copy = result.nodes[2];
    assert.equal(result.nodes.length, original.nodes.length + 1);
    assert.equal(copy.position.x, source.position.x);
    assert.equal(copy.position.y, child.position.y + child.height + 80);
    assert.equal(copy.width, source.width); assert.equal(copy.height, source.height);
    assert.equal(copy.metadata?.storageKey, source.metadata.storageKey);
    assert.equal(copy.metadata?.content, source.metadata.content);
    assert.equal(copy.metadata?.durationMs, 5000);
    assert.equal(copy.metadata?.status, "success");
    assert.equal(copy.metadata?.model, "model");
    for (const key of ["groupId", "batchRootId", "batchChildIds", "isBatchRoot", "primaryImageId", "imageBatchExpanded", "imageTaskId", "clientTaskId", "settledCredits", "actualTokens", "firstFrameNodeId"] as const) assert.equal(copy.metadata?.[key], undefined, key);
    assert.deepEqual(copy.metadata?.references, []);
    assert.equal(copy.metadata?.prompt, "参考 ");
    assert.equal(result.candidate.content, "");
    assert.equal(result.candidate.nodeId, copy.id);
    assert.match(copy.title, /雨夜 · 版本 1 · 图片候选/u);
    assert.ok(isProductionCandidateValid(result.candidate, [{ ...original, nodes: result.nodes }]));
    assert.equal(original.nodes.length, 2);
    assert.equal(source.metadata.imageTaskId, "task");
});

test("存储标识无需临时URL；无存储标识必须是持久http/https地址", () => {
    const source = node("video"); source.metadata!.content = "";
    const stored = buildProductionCandidate(shot(), canvas([source]), source.id);
    assert.equal(stored.nodes[1].metadata?.status, "success");
    assert.equal(stored.nodes[1].metadata?.durationMs, 5000);
    assert.equal(stored.candidate.content, "");
    delete source.metadata!.storageKey;
    for (const value of ["", "blob:https://example.test/a", "data:video/mp4;base64,abc", "https:example.test/a", "https://example.test/a b", "https://example.test/\u0085", `https://example.test/${"雨".repeat(1400)}`, `https://example.test/${"a".repeat(4096)}`]) {
        source.metadata!.content = value;
        assert.throws(() => buildProductionCandidate(shot(), canvas([source]), source.id), /候选/u);
    }
    source.metadata!.content = "https://example.test/video.mp4";
    const remote = buildProductionCandidate(shot(), canvas([source]), source.id);
    assert.equal(remote.candidate.storageKey, "");
    assert.equal(remote.candidate.content, source.metadata!.content);
    source.metadata!.content = "HTTPS://example.test/Video.MP4";
    const uppercase = buildProductionCandidate(shot(), canvas([source]), source.id);
    assert.equal(uppercase.candidate.content, source.metadata!.content, "只规范协议判断，不改变文件地址大小写");
    const longTitle = buildProductionCandidate({ ...shot(), title: "雨".repeat(180) }, canvas([source]), source.id).candidate.title;
    assert.equal([...longTitle].length, 180);
    assert.match(longTitle, / · 版本 1$/u);
});

test("进行中、失败、错误类型或超过20个版本均不可加入候选", () => {
    const source = node("video");
    for (const status of ["loading", "stopping", "error"] as const) {
        source.metadata!.status = status;
        assert.throws(() => buildProductionCandidate(shot(), canvas([source]), source.id), /候选/u);
    }
    source.metadata!.status = "success";
    assert.throws(() => buildProductionCandidate(shot(), canvas([node("audio", CanvasNodeType.Audio)]), "audio"), /候选/u);
    assert.throws(() => buildProductionCandidate(shot(), canvas([node("pano", CanvasNodeType.Panorama)]), "pano"), /候选/u);
    assert.throws(() => buildProductionCandidate({ ...shot(), candidates: Array(20).fill(candidate(source)) }, canvas([source]), source.id), /20/u);
});

test("允许调用方已验证的同项目其他画布作为来源，候选保存在来源图", () => {
    const source = node("video"), project = { ...canvas([source]), id: "other", workspaceId: "canvas" };
    const result = buildProductionCandidate(shot(), project, source.id);
    assert.equal(result.candidate.canvasId, project.id);
    assert.ok(isProductionCandidateValid(result.candidate, [{ ...project, nodes: result.nodes }]));
});

test("候选按文件身份校验，换文件、删节点、重新生成后都会失效", () => {
    const source = node("video"), snapshot = candidate(source), project = canvas([source]);
    assert.ok(isProductionCandidateValid(snapshot, [project]));
    source.metadata!.content = "https://example.test/new-signed-url";
    assert.ok(isProductionCandidateValid(snapshot, [project]), "存储标识一致时允许刷新URL");
    source.metadata!.storageKey = "media/replaced";
    assert.equal(isProductionCandidateValid(snapshot, [project]), false);
    source.metadata!.storageKey = snapshot.storageKey;
    source.metadata!.status = "loading";
    assert.equal(isProductionCandidateValid(snapshot, [project]), false);
    source.metadata!.status = "success";
    assert.equal(isProductionCandidateValid({ ...snapshot, content: "https://example.test/extra" }, [project]), false);
    assert.equal(isProductionCandidateValid({ ...snapshot, kind: "image" }, [project]), false);
    assert.equal(isProductionCandidateValid(snapshot, [canvas([])]), false);
    delete source.metadata!.storageKey;
    const urlSnapshot = candidate(source);
    assert.ok(isProductionCandidateValid(urlSnapshot, [project]));
    source.metadata!.storageKey = "media/new";
    assert.equal(isProductionCandidateValid(urlSnapshot, [project]), false);
});

test("镜头状态按采用视频、采用图片、候选、生成、失败、等待的顺序显示", () => {
    const image = node("image", CanvasNodeType.Image), video = node("video");
    const value = shot(), project = canvas([image, video]);
    assert.equal(getProductionShotState(value, [project]).status, "result-ready");
    const empty = structuredClone(project);
    for (const item of empty.nodes) item.metadata = { status: "idle" };
    assert.equal(getProductionShotState(value, [empty]).status, "waiting");
    assert.equal(getProductionShotState(value, []).status, "unplaced");
    video.metadata!.status = "error";
    assert.equal(getProductionShotState(value, [project]).status, "failed");
    image.metadata!.status = "loading";
    assert.equal(getProductionShotState(value, [project]).status, "generating");
    const savedImage = node("saved-image", CanvasNodeType.Image), savedVideo = node("saved-video");
    project.nodes.push(savedImage, savedVideo);
    value.candidates = [candidate(savedImage), candidate(savedVideo)];
    assert.equal(getProductionShotState(value, [project]).status, "candidates");
    value.selectedImageCandidateId = value.candidates[0].id;
    assert.equal(getProductionShotState(value, [project]).status, "adopted-image");
    value.selectedVideoCandidateId = value.candidates[1].id;
    assert.equal(getProductionShotState(value, [project]).status, "adopted-video");
    savedVideo.metadata!.storageKey = "replaced";
    assert.deepEqual(getProductionShotState(value, [project]), { status: "adopted-image", label: "已采用图片", invalidCandidateCount: 1, hasInvalidSelection: true });
    value.selectedImageCandidateId = value.candidates[1].id;
    assert.equal(getProductionShotState(value, [project]).status, "candidates");
    assert.equal(getProductionShotState(value, [project]).hasInvalidSelection, true);
});
