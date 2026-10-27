import assert from "node:assert/strict";
import test from "node:test";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "../types";
import { clearCanvasExecutionMetadata, cloneCanvasSelection, collectCanvasSelection } from "./canvas-node-duplicate";

const node = (id: string, metadata: CanvasNodeMetadata = {}, type = CanvasNodeType.Video): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 200, height: 320, metadata });
const edge = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });
const idFactory = (id: string) => `copy-${id}`;

test("复制已生成媒体保留文件身份，但不能继承任务轮询和费用", () => {
    const metadata: CanvasNodeMetadata = {
        content: "https://example.test/a.mp4", storageKey: "server:file-a", durationMs: 5000,
        status: "loading", clientTaskId: "client", taskBackend: "account", imageTaskId: "image-task", imageTaskResultId: "image-result",
        audioTaskId: "audio-task", audioTaskResultId: "audio-result", videoTaskId: "video-task", videoTaskVideoId: "video-result", videoTaskStatus: "running",
        billingStatus: "pending_usage", tokenMode: "input_output_tokens", actualTokens: 100, actualInputTokens: 40, actualOutputTokens: 60,
        reservedCredits: 12, settledCredits: 4, startedAt: 123, progress: 50, errorDetails: "旧任务", accountSaveError: "旧保存错误",
        model: "doubao-seedance-2-0-fast-260128", size: "9:16", vquality: "720p", seconds: "5", prompt: "向前推进",
    };
    const result = cloneCanvasSelection([node("video", metadata)], [], ["video"], { idFactory });
    const copy = result.nodes[0].metadata!;
    assert.equal(copy.status, "success");
    assert.equal(copy.content, metadata.content);
    assert.equal(copy.storageKey, metadata.storageKey);
    assert.equal(copy.durationMs, 5000);
    for (const key of ["clientTaskId", "taskBackend", "imageTaskId", "imageTaskResultId", "audioTaskId", "audioTaskResultId", "videoTaskId", "videoTaskVideoId", "videoTaskStatus", "billingStatus", "tokenMode", "actualTokens", "actualInputTokens", "actualOutputTokens", "reservedCredits", "settledCredits", "startedAt", "progress", "errorDetails", "accountSaveError"] as const) assert.equal(copy[key], undefined, key);
    assert.equal(copy.model, metadata.model);
    assert.equal(copy.seconds, "5");
    assert.equal(metadata.videoTaskId, "video-task", "不能修改源节点");
    assert.equal(clearCanvasExecutionMetadata({ status: "loading", videoTaskId: "task", durationMs: 20 })?.status, "idle");
});

test("保留参考副本只复制入线，普通副本清理脱离连线的首尾帧和提示词引用", () => {
    const image = node("image", { content: "https://example.test/image.png" }, CanvasNodeType.Image);
    const video = node("video", { firstFrameNodeId: "image", klingImageNodeIds: ["image"], references: [image.metadata!.content!], prompt: "使用 @[node:image]" });
    const nodes = [image, video, node("next")];
    const connections = [edge("image", "video"), edge("video", "next")];
    const copied = cloneCanvasSelection(nodes, connections, ["video"], { idFactory, preserveIncoming: true });
    assert.deepEqual(copied.connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]), [["image", "copy-video"]]);
    assert.equal(copied.nodes[0].metadata?.firstFrameNodeId, "image");
    assert.equal(copied.nodes[0].metadata?.prompt, "使用 @[node:image]");
    assert.deepEqual(copied.nodes[0].metadata?.references, [image.metadata!.content]);
    const detached = cloneCanvasSelection(nodes, connections, ["video"], { idFactory }).nodes[0];
    assert.equal(detached.metadata?.firstFrameNodeId, undefined);
    assert.equal(detached.metadata?.prompt, "使用 ");
    assert.deepEqual(detached.metadata?.references, []);
});

test("组和折叠图片批次整体复制，内部角色引用重映射，单个子节点与原组解除关系", () => {
    const nodes = [
        node("group", {}, CanvasNodeType.Group),
        node("root", { groupId: "group", isBatchRoot: true, batchChildIds: ["image"], primaryImageId: "image", imageBatchExpanded: false }, CanvasNodeType.Image),
        node("image", { batchRootId: "root", content: "https://example.test/image.png" }, CanvasNodeType.Image),
        node("text", { groupId: "group", content: "镜头一" }, CanvasNodeType.Text),
        node("audio", { groupId: "group", content: "https://example.test/audio.wav" }, CanvasNodeType.Audio),
        node("video", { groupId: "group", firstFrameNodeId: "image", klingElementList: [{ name: "角色", nodeIds: ["image"] }], klingMultiPrompt: [{ textNodeId: "text", duration: "5" }], referenceAudioNodeId: "audio", composerContent: "@[node:text] @[node:image]" }),
    ];
    const edges = [edge("image", "video"), edge("text", "video"), edge("audio", "video")];
    const snapshot = collectCanvasSelection(nodes, edges, ["group"]);
    assert.equal(snapshot.nodes.length, 6);
    const result = cloneCanvasSelection(snapshot.nodes, snapshot.connections, ["group"], { idFactory });
    const byId = new Map(result.nodes.map((item) => [item.id, item]));
    assert.equal(byId.get("copy-root")?.metadata?.groupId, "copy-group");
    assert.deepEqual(byId.get("copy-root")?.metadata?.batchChildIds, ["copy-image"]);
    assert.equal(byId.get("copy-root")?.metadata?.primaryImageId, "copy-image");
    assert.equal(byId.get("copy-image")?.metadata?.batchRootId, "copy-root");
    assert.equal(byId.get("copy-video")?.metadata?.firstFrameNodeId, "copy-image");
    assert.equal(byId.get("copy-video")?.metadata?.referenceAudioNodeId, "copy-audio");
    assert.equal(byId.get("copy-video")?.metadata?.klingMultiPrompt?.[0].textNodeId, "copy-text");
    assert.deepEqual(byId.get("copy-video")?.metadata?.klingElementList?.[0].nodeIds, ["copy-image"]);
    assert.equal(byId.get("copy-video")?.metadata?.composerContent, "@[node:copy-text] @[node:copy-image]");
    const detached = cloneCanvasSelection(nodes, edges, ["image"], { idFactory }).nodes[0];
    assert.equal(detached.metadata?.batchRootId, undefined);
    assert.equal(detached.metadata?.groupId, undefined);
    snapshot.nodes[1].metadata!.batchChildIds!.push("new");
    assert.deepEqual(nodes[1].metadata?.batchChildIds, ["image"], "剪贴板不能与原图共用可变数组");
});
