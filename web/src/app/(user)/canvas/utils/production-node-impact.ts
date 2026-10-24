import type { ProductionDocument } from "../lib/production-types";

export function productionNodeImpacts(doc: ProductionDocument | null | undefined, canvasId: string, ids: Set<string>) {
    if (!doc) return [];
    return [...new Set([
        ...doc.shots.flatMap((shot) => [
            ...(shot.canvasId === canvasId && [shot.textNodeId, shot.imageNodeId, shot.videoNodeId].some((id) => ids.has(id)) ? [`镜头「${shot.title}」的画布绑定`] : []),
            ...shot.candidates.filter((candidate) => candidate.canvasId === canvasId && ids.has(candidate.nodeId)).map((candidate) => `镜头「${shot.title}」的候选「${candidate.title}」`),
        ]),
        ...doc.assets.filter((asset) => asset.references.some((ref) => ref.canvasId === canvasId && ids.has(ref.nodeId))).map((asset) => `资产「${asset.title}」的参考图`),
    ])];
}
