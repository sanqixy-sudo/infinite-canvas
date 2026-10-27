import { isWorkflowProtocol } from "@/lib/model-channel";
import { filterModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType } from "../types";

export type ProjectModelSelection = { model: string; channelId: string };
export type WorkspaceSettings = {
    defaultModels?: Partial<Record<ModelCapability, ProjectModelSelection>>;
    cover?: { canvasId: string; nodeId: string };
};
export const projectModelLabels: Record<ModelCapability, string> = { text: "文字", image: "图片", video: "视频", audio: "音频" };

/** Persist references only, never channel credentials or copied media. */
export function normalizeWorkspaceSettings(value?: WorkspaceSettings): WorkspaceSettings {
    const defaultModels: WorkspaceSettings["defaultModels"] = {};
    for (const key of Object.keys(projectModelLabels) as ModelCapability[]) {
        const item = value?.defaultModels?.[key];
        if (typeof item?.model === "string" && typeof item.channelId === "string" && item.model.trim() && item.channelId.trim()) defaultModels[key] = { model: item.model.trim().slice(0, 256), channelId: item.channelId.trim().slice(0, 256) };
    }
    const cover = value?.cover;
    return { defaultModels, ...(typeof cover?.canvasId === "string" && typeof cover.nodeId === "string" && cover.canvasId.trim() && cover.nodeId.trim() ? { cover: { canvasId: cover.canvasId.trim().slice(0, 256), nodeId: cover.nodeId.trim().slice(0, 256) } } : {}) };
}

export function validProjectModel(config: AiConfig, capability: ModelCapability, selection?: ProjectModelSelection) {
    if (!selection || config.channelMode !== "remote") return false;
    const channel = config.publicChannels.find((item) => item.id === selection.channelId && item.enabled !== false && !isWorkflowProtocol(item.protocol || ""));
    return Boolean(channel && config.models.includes(selection.model) && filterModelsByCapability(channel.models || [], capability, channel.protocol || "", channel.modelCapabilities).includes(selection.model));
}

export function projectSettingsForCanvas(projects: CanvasProject[], canvasId: string) {
    const canvas = projects.find((item) => item.id === canvasId);
    return projects.find((item) => item.id === (canvas?.workspaceId || canvasId) && !item.workspaceId)?.workspaceSettings;
}

/** Use only while creating a node; existing nodes and submitted tasks retain their choices. */
export function resolveProjectDefaultModel(projects: CanvasProject[], canvasId: string, config: AiConfig, capability: ModelCapability) {
    const selection = projectSettingsForCanvas(projects, canvasId)?.defaultModels?.[capability];
    return validProjectModel(config, capability, selection) ? selection : undefined;
}

export function projectDefaultModelWarnings(projects: CanvasProject[], canvasId: string, config: AiConfig) {
    const defaults = projectSettingsForCanvas(projects, canvasId)?.defaultModels;
    return (Object.keys(projectModelLabels) as ModelCapability[]).filter((key) => defaults?.[key] && !validProjectModel(config, key, defaults[key]))
        .map((key) => `${projectModelLabels[key]}默认模型「${defaults![key]!.model}」已不可用，新节点沿用当前创作设置，请在项目设置中重新选择。`);
}

export function workspaceCoverCandidates(projects: CanvasProject[], rootId: string) {
    if (!projects.some((item) => item.id === rootId && !item.workspaceId)) return [];
    return projects.filter((item) => item.id === rootId || item.workspaceId === rootId).flatMap((canvas) => canvas.nodes
        .filter((node) => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama) && Boolean(node.metadata?.content || node.metadata?.storageKey))
        .map((node) => ({ canvas, node })));
}

export function resolveWorkspaceCover(projects: CanvasProject[], rootId: string, cover = projectSettingsForCanvas(projects, rootId)?.cover) {
    return cover ? workspaceCoverCandidates(projects, rootId).find(({ canvas, node }) => canvas.id === cover.canvasId && node.id === cover.nodeId) : undefined;
}

export function remapWorkspaceCover(settings: WorkspaceSettings | undefined, ids: Map<string, string>) {
    const next = normalizeWorkspaceSettings(settings);
    if (next.cover) next.cover = ids.has(next.cover.canvasId) ? { ...next.cover, canvasId: ids.get(next.cover.canvasId)! } : undefined;
    return next;
}
