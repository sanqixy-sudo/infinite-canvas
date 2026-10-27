export type ProductionAudioTrack = { id: string; shotId: string; storageKey: string; label: string; startSeconds: number; trimStartSeconds: number; durationSeconds: number; gain: number };
export type ProductionSubtitle = { id: string; shotId: string; startSeconds: number; endSeconds: number; text: string };
export type ProductionDeliveryEdit = { originalGain: number; burnSubtitles: boolean; audioTracks: ProductionAudioTrack[]; subtitles: ProductionSubtitle[] };
export type ProductionEpisode = { id: string; title: string; script: string; order: number; delivery?: ProductionDeliveryEdit };
export type ProductionScene = { id: string; episodeId: string; title: string; description: string; order: number };
export type ProductionAssetKind = "character" | "scene" | "prop" | "voice" | "style";
export type ProductionReference = { canvasId: string; nodeId: string };
export type ProductionAsset = { id: string; kind: ProductionAssetKind; title: string; description: string; variantOf: string; references: ProductionReference[] };
export type ProductionCandidate = { id: string; title: string; kind: "image" | "video"; canvasId: string; nodeId: string; storageKey: string; content: string };
export type ProductionShot = {
    id: string; episodeId: string; sceneId: string; order: number; title: string;
    description: string; dialogue: string; camera: string; seconds: number; assetIds: string[];
    canvasId: string; textNodeId: string; imageNodeId: string; videoNodeId: string; status: "draft" | "ready";
    candidates: ProductionCandidate[]; selectedImageCandidateId: string; selectedVideoCandidateId: string;
};
export type ProductionDocument = {
    id: string; workspaceId: string; title: string; synopsis: string; styleGuide: string;
    revision: number; createdAt: string; updatedAt: string;
    episodes: ProductionEpisode[]; scenes: ProductionScene[]; assets: ProductionAsset[]; shots: ProductionShot[];
};
export const productionAssetLabels: Record<ProductionAssetKind, string> = { character: "角色", scene: "场景", prop: "道具", voice: "声音", style: "风格" };
