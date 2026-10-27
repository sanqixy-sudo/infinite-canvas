import { nanoid } from "nanoid";
import { dequal } from "dequal";
import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { productionAssetLabels, type ProductionDocument, type ProductionShot } from "../lib/production-types";
import { cloneCanvasSelection } from "./canvas-node-duplicate";

export function productionShotText(document: ProductionDocument, shot: ProductionShot) {
    const scene = document.scenes.find((item) => item.id === shot.sceneId);
    const assets = document.assets.filter((item) => shot.assetIds.includes(item.id));
    return [shot.title, scene && `场次：${scene.title}${scene.description ? ` · ${scene.description}` : ""}`, shot.description,
        shot.dialogue && `对白：${shot.dialogue}`, shot.camera && `镜头：${shot.camera}`, `计划时长：${shot.seconds} 秒`,
        document.styleGuide && `风格：${document.styleGuide}`,
        ...assets.map((item) => `${productionAssetLabels[item.kind]} · ${item.title}${item.description ? `：${item.description}` : ""}`),
    ].filter(Boolean).join("\n\n");
}

export function buildProductionShotCanvas(document: ProductionDocument, shot: ProductionShot, canvas: CanvasProject, allCanvases: CanvasProject[]) {
    const x = canvas.nodes.length ? Math.max(...canvas.nodes.map((node) => node.position.x + node.width)) + 120 : 80;
    const y = canvas.nodes.length ? Math.min(...canvas.nodes.map((node) => node.position.y)) : 80;
    const textNodeId = nanoid(), imageNodeId = nanoid(), videoNodeId = nanoid();
    const content = productionShotText(document, shot);
    const nodes: CanvasNodeData[] = [
        { id: textNodeId, type: CanvasNodeType.Text, title: `${shot.title} · 镜头说明`, position: { x, y }, width: 320, height: 280, metadata: { content, status: "idle" } },
        { id: imageNodeId, type: CanvasNodeType.Image, title: `${shot.title} · 分镜图`, position: { x: x + 440, y }, width: 270, height: 480, metadata: { prompt: "根据已连接的镜头说明与参考素材，生成这个镜头的分镜画面。", status: "idle" } },
        { id: videoNodeId, type: CanvasNodeType.Video, title: `${shot.title} · 视频`, position: { x: x + 830, y }, width: 270, height: 480, metadata: { prompt: "根据已连接的镜头说明、分镜图与参考素材，生成这个镜头的视频。", status: "idle", seconds: String(shot.seconds) } },
    ];
    const connections = [
        { id: nanoid(), fromNodeId: textNodeId, toNodeId: imageNodeId },
        { id: nanoid(), fromNodeId: textNodeId, toNodeId: videoNodeId },
        { id: nanoid(), fromNodeId: imageNodeId, toNodeId: videoNodeId },
    ];
    const usedReferences = new Set<string>();
    let referenceY = y + 400;
    for (const assetId of shot.assetIds) {
        const asset = document.assets.find((item) => item.id === assetId);
        if (!asset) throw new Error("镜头引用的项目资产已不存在，请重新编辑镜头关联");
        for (const reference of asset.references) {
            const key = `${reference.canvasId}:${reference.nodeId}`;
            if (usedReferences.has(key)) continue;
            usedReferences.add(key);
            const source = allCanvases.find((item) => item.id === reference.canvasId && (item.id === document.workspaceId || item.workspaceId === document.workspaceId));
            const original = source?.nodes.find((item) => item.id === reference.nodeId);
            if (!original || ![CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Video, CanvasNodeType.Audio].includes(original.type)) throw new Error(`资产“${asset.title}”的参考节点已失效，请重新关联后再放入画布`);
            if (!original.metadata?.content?.trim() && (original.type === CanvasNodeType.Text || !original.metadata?.storageKey)) throw new Error(`资产“${asset.title}”的参考“${original.title}”还没有内容，请先完善参考节点`);
            let node = original;
            if (source!.id !== canvas.id) {
                node = cloneCanvasSelection([original], [], [original.id], { offset: { x: x - original.position.x, y: referenceY - original.position.y } }).nodes[0];
                node.title = `${asset.title} · ${original.title}`;
                nodes.push(node);
                referenceY += node.height + 48;
            }
            if ([CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Panorama].includes(node.type)) connections.push({ id: nanoid(), fromNodeId: node.id, toNodeId: imageNodeId });
            connections.push({ id: nanoid(), fromNodeId: node.id, toNodeId: videoNodeId });
        }
    }
    return {
        nodes: [...canvas.nodes, ...nodes], connections: [...canvas.connections, ...connections],
        shot: { ...shot, canvasId: canvas.id, textNodeId, imageNodeId, videoNodeId },
    };
}

/** Compare JSON payload values, ignoring object key order and omitted undefined fields. */
export function assertProductionCanvasSaved(sent: CanvasProject, saved: CanvasProject) {
    if (!dequal(JSON.parse(JSON.stringify(sent)), JSON.parse(JSON.stringify(saved)))) throw new Error(`画布“${sent.title}”已有更新，账号未接受当前版本。已保留本机内容，请先回画布同步最新版本再重试，避免覆盖其他编辑。`);
}

export function productionChecklist(document: ProductionDocument) {
    const lines = [`# ${document.title}`, "", "## 故事概述", document.synopsis || "待补充", "", "## 视觉风格", document.styleGuide || "待补充", "", "## 项目资产"];
    document.assets.forEach((asset) => {
        const base = document.assets.find((item) => item.id === asset.variantOf);
        lines.push(`\n### ${productionAssetLabels[asset.kind]} · ${asset.title}${base ? `（${base.title}的变体）` : ""}`, asset.description || "待补充", `参考节点：${asset.references.length} 个`);
    });
    [...document.episodes].sort((a, b) => a.order - b.order).forEach((episode) => {
        lines.push(`\n## ${episode.title}`, "\n### 剧本", episode.script || "待补充");
        document.scenes.filter((scene) => scene.episodeId === episode.id).sort((a, b) => a.order - b.order).forEach((scene) => lines.push(`\n### 场次 · ${scene.title}`, scene.description || "待补充"));
        document.shots.filter((shot) => shot.episodeId === episode.id).sort((a, b) => a.order - b.order).forEach((shot, index) => {
            lines.push(`\n### 镜头 ${String(index + 1).padStart(2, "0")} · ${shot.title}`, productionShotText(document, shot), `状态：${shot.status === "ready" ? "已规划" : "草稿"}`, `画布：${shot.canvasId || "尚未放入画布"}`);
            lines.push(`图片采用：${shot.candidates.find((item) => item.id === shot.selectedImageCandidateId)?.title || "未采用"}`, `视频采用：${shot.candidates.find((item) => item.id === shot.selectedVideoCandidateId)?.title || "未采用"}`);
            for (const item of shot.candidates) lines.push(`- 候选 ${item.title}（${item.kind === "image" ? "图片" : "视频"}）：画布 ${item.canvasId} / 节点 ${item.nodeId}`);
        });
    });
    return lines.join("\n");
}
