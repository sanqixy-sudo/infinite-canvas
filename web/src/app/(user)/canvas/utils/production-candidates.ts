import { nanoid } from "nanoid";
import type { ProductionCandidate, ProductionShot } from "../lib/production-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { cloneCanvasSelection } from "./canvas-node-duplicate";

function isMediaUrl(content: string) {
    if (!/^https?:\/\//iu.test(content) || new TextEncoder().encode(content).length > 4096 || /[\p{White_Space}\p{Cc}\\]/u.test(content)) return false;
    try {
        const url = new URL(content);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch { return false; }
}

function isFinishedMedia(node: CanvasNodeData) {
    return (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video)
        && !["loading", "stopping", "error"].includes(node.metadata?.status || "")
        && Boolean(node.metadata?.storageKey || isMediaUrl(node.metadata?.content || ""));
}

/** Keep a detached result node so later generation cannot replace the candidate's file. */
export function buildProductionCandidate(shot: ProductionShot, sourceCanvas: CanvasProject, sourceNodeId: string): { candidate: ProductionCandidate; nodes: CanvasNodeData[] } {
    if (shot.candidates.length >= 20) throw new Error("每个镜头最多保存 20 个候选版本，请先移除不需要的候选");
    const source = sourceCanvas.nodes.find((node) => node.id === sourceNodeId);
    if (!source || !isFinishedMedia(source)) throw new Error("请选择已完成且已保存的图片或视频结果；生成中、已失败或仅有临时地址的节点不能加入候选");
    const y = Math.max(...sourceCanvas.nodes.map((node) => node.position.y + node.height)) + 80;
    // Pass only this result, not the whole canvas, to avoid pulling its batch children in.
    const copy = cloneCanvasSelection([source], [], [source.id], { offset: { x: 0, y: y - source.position.y } }).nodes[0];
    const metadata = copy.metadata!;
    for (const key of ["groupId", "batchRootId", "batchChildIds", "isBatchRoot", "primaryImageId", "imageBatchExpanded", "batchUsesReferenceImages"] as const) delete metadata[key];
    metadata.status = "success";
    metadata.durationMs = source.metadata?.durationMs;
    const suffix = ` · 版本 ${shot.candidates.length + 1}`;
    const title = [...shot.title].slice(0, 180 - suffix.length).join("") + suffix;
    const kind = source.type === CanvasNodeType.Image ? "image" : "video";
    copy.title = `${title} · ${kind === "image" ? "图片候选" : "视频候选"}`;
    const storageKey = source.metadata?.storageKey || "";
    return {
        candidate: { id: nanoid(), title, kind, canvasId: sourceCanvas.id, nodeId: copy.id, storageKey, content: storageKey ? "" : source.metadata!.content! },
        nodes: [...sourceCanvas.nodes, copy],
    };
}

/** Match the server's snapshot identity rules; a changed or running node is not adoptable. */
export function isProductionCandidateValid(candidate: ProductionCandidate, canvases: CanvasProject[]) {
    const node = canvases.find((canvas) => canvas.id === candidate.canvasId)?.nodes.find((item) => item.id === candidate.nodeId);
    if (!node || node.type !== candidate.kind || !isFinishedMedia(node)) return false;
    if (candidate.storageKey) return !candidate.content && candidate.storageKey === node.metadata?.storageKey;
    return !node.metadata?.storageKey && isMediaUrl(candidate.content) && candidate.content === node.metadata?.content;
}

export type ProductionShotState = {
    status: "adopted-video" | "adopted-image" | "candidates" | "generating" | "failed" | "result-ready" | "waiting" | "unplaced";
    label: string;
    invalidCandidateCount: number;
    hasInvalidSelection: boolean;
};

export function getProductionShotState(shot: ProductionShot, canvases: CanvasProject[]): ProductionShotState {
    const valid = shot.candidates.filter((candidate) => isProductionCandidateValid(candidate, canvases));
    const selectedVideo = valid.some((candidate) => candidate.id === shot.selectedVideoCandidateId && candidate.kind === "video");
    const selectedImage = valid.some((candidate) => candidate.id === shot.selectedImageCandidateId && candidate.kind === "image");
    const detail = {
        invalidCandidateCount: shot.candidates.length - valid.length,
        hasInvalidSelection: Boolean((shot.selectedVideoCandidateId && !selectedVideo) || (shot.selectedImageCandidateId && !selectedImage)),
    };
    const state = (status: ProductionShotState["status"], label: string): ProductionShotState => ({ status, label, ...detail });
    if (selectedVideo) return state("adopted-video", "已采用视频");
    if (selectedImage) return state("adopted-image", "已采用图片");
    if (valid.length) return state("candidates", "候选待选");
    const canvas = canvases.find((item) => item.id === shot.canvasId);
    const targets = canvas?.nodes.filter((node) => (node.id === shot.imageNodeId && node.type === CanvasNodeType.Image) || (node.id === shot.videoNodeId && node.type === CanvasNodeType.Video)) || [];
    if (targets.some((node) => node.metadata?.status === "loading" || node.metadata?.status === "stopping")) return state("generating", "正在生成");
    if (targets.some((node) => node.metadata?.status === "error")) return state("failed", "生成失败");
    if (targets.some(isFinishedMedia)) return state("result-ready", "已有结果，待存候选");
    return targets.length ? state("waiting", "等待结果") : state("unplaced", "未放入画布");
}
