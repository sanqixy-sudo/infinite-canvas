import type { CanvasExportAsset, CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import type { ProductionDocument } from "../lib/production-types";
import { nanoid } from "nanoid";
import { cloneCanvasSelection } from "./canvas-node-duplicate";
import type { CanvasAssistantSession } from "../types";

type StorageReference = { storageKey: string; urls: string[] };
type RestoredFile = { storageKey: string; url: string };
const urlFields = ["content", "url", "dataUrl", "coverUrl", "thumbnailUrl", "previewUrl"];

export function collectCanvasStorageReferences(value: unknown, references = new Map<string, StorageReference>()) {
    if (!value || typeof value !== "object") return references;
    const record = value as Record<string, unknown>;
    if (typeof record.storageKey === "string" && record.storageKey.includes(":")) {
        const reference = references.get(record.storageKey) || { storageKey: record.storageKey, urls: [] };
        for (const field of urlFields) if (typeof record[field] === "string" && record[field]) reference.urls.push(record[field]);
        references.set(record.storageKey, reference);
    }
    Object.values(record).forEach((item) => collectCanvasStorageReferences(item, references));
    return references;
}

export async function buildCanvasArchive(projects: CanvasProject[], readFile: (reference: StorageReference) => Promise<Blob>, productions: ProductionDocument[] = []) {
    if (productions.some((doc) => !projects.some((project) => project.id === doc.workspaceId && !project.workspaceId))) throw new Error("制作计划所属项目不在导出包中，请选择完整项目");
    if (productions.length) remapCanvasBundle(projects, productions);
    const files: { name: string; data: BlobPart }[] = [];
    const requests = new Map<string, Promise<Blob>>();
    const exportedProjects = await Promise.all(projects.map(async (project) => {
        const production = productions.find((doc) => doc.workspaceId === project.id);
        const assets = await Promise.all([...collectCanvasStorageReferences({ project, production }).values()].map(async (reference, index) => {
            let request = requests.get(reference.storageKey);
            if (!request) { request = readFile(reference); requests.set(reference.storageKey, request); }
            const blob = await request;
            if (!blob.size) throw new Error(`素材为空，导出已停止：${reference.storageKey}`);
            const path = `projects/${project.id}/files/${index}-${safeFileName(reference.storageKey)}.${fileExtension(blob.type)}`;
            files.push({ name: path, data: blob });
            return { storageKey: reference.storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size };
        }));
        return { project: project.workspaceId && !projects.some((item) => item.id === project.workspaceId) ? { ...project, workspaceId: undefined } : project, production, files: assets };
    }));
    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    return [{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...files];
}

export async function prepareCanvasBundleImport(data: CanvasExportFile, zip: Map<string, Blob>, storeFile: (file: CanvasExportAsset, blob: Blob) => Promise<RestoredFile>) {
    if (data?.app !== "infinite-canvas" || !Array.isArray(data.projects) || !data.projects.length) throw new Error("压缩包不是有效的项目导出文件");
    const assets = new Map<string, { file: CanvasExportAsset; blob: Blob }>();
    const references = new Map<string, StorageReference>();
    const projectIds = new Set<string>();
    for (const item of data.projects) {
        if (!item?.project?.id || projectIds.has(item.project.id) || !Array.isArray(item.project.nodes) || !Array.isArray(item.project.connections) || !Array.isArray(item.files)) throw new Error("项目数据缺失或包含重复画布编号");
        projectIds.add(item.project.id);
        collectCanvasStorageReferences({ project: item.project, production: item.production }, references);
        if (item.production && (item.production.workspaceId !== item.project.id || item.project.workspaceId || !Array.isArray(item.production.shots) || !Array.isArray(item.production.episodes) || !Array.isArray(item.production.assets) || !Array.isArray(item.production.scenes))) throw new Error("制作计划结构或项目归属无效");
        for (const file of item.files) {
            const blob = zip.get(file.path);
            if (!file.storageKey || !blob || blob.size !== file.bytes || !blob.size) throw new Error(`压缩包素材缺失或不完整：${file.path || file.storageKey}`);
            assets.set(file.storageKey, { file, blob });
        }
    }
    for (const item of data.projects) if (item.project.workspaceId && !data.projects.some((parent) => parent.project.id === item.project.workspaceId && !parent.project.workspaceId)) throw new Error("子画布所属项目缺失或层级无效");
    for (const key of references.keys()) if (!assets.has(key)) throw new Error(`压缩包缺少画布引用的素材：${key}`);
    // Reject incomplete plan/node graphs before uploading or writing any file.
    const plans = data.projects.flatMap(({ production }) => production ? [production] : []);
    if (plans.length) remapCanvasBundle(data.projects.map(({ project }) => project), plans);

    const replacements = new Map<string, string>();
    await Promise.all([...assets.values()].map(async ({ file, blob }) => {
        const restored = await storeFile(file, blob.slice(0, blob.size, file.mimeType));
        replacements.set(file.storageKey, restored.storageKey);
        for (const url of references.get(file.storageKey)?.urls || []) replacements.set(url, restored.url);
    }));
    return { projects: data.projects.map(({ project }) => replaceReferences(project, replacements) as CanvasProject), productions: data.projects.flatMap(({ production }) => production ? [replaceReferences(production, replacements) as ProductionDocument] : []) };
}

export async function prepareCanvasImport(data: CanvasExportFile, zip: Map<string, Blob>, storeFile: (file: CanvasExportAsset, blob: Blob) => Promise<RestoredFile>) {
    return (await prepareCanvasBundleImport(data, zip, storeFile)).projects;
}

/** Imported tasks never resume or inherit original billing, but media and all plan links survive. */
export function remapCanvasBundle(projects: CanvasProject[], productions: ProductionDocument[]) {
    const nodeMaps = new Map<string, Map<string, string>>();
    const copied = projects.map((project) => {
        const cloned = cloneCanvasSelection(project.nodes, project.connections, project.nodes.map((node) => node.id), { offset: { x: 0, y: 0 } });
        nodeMaps.set(project.id, cloned.idMap);
        const chatSessions: CanvasAssistantSession[] = (project.chatSessions || []).map((session) => ({
            ...session, id: nanoid(), provider: "api", codexThreadId: undefined, codexServiceId: undefined,
            messages: session.messages.map((message) => ({ ...message, id: nanoid(), status: message.status === "error" ? "error" : "success", activity: undefined,
                references: message.references?.map((reference) => ({ ...reference, id: cloned.idMap.get(reference.id) || nanoid() })),
            })),
            agentState: { phase: "intake", approvedNodeIds: [], referenceNodeIds: [], pendingTaskIds: [], completedTaskIds: [] },
            protocolMessages: [], contextCheckpoint: undefined,
        }));
        const activeIndex = (project.chatSessions || []).findIndex((session) => session.id === project.activeChatId);
        return { ...project, nodes: cloned.nodes.map((node, index) => ({ ...node, title: project.nodes[index].title })), connections: cloned.connections, chatSessions, activeChatId: chatSessions[activeIndex]?.id || null, pendingAgentRequest: undefined, autoTitlePending: false };
    });
    const plans = productions.map((doc) => {
        const canvases = new Set(projects.filter((project) => project.id === doc.workspaceId || project.workspaceId === doc.workspaceId).map((project) => project.id));
        const makeMap = (items: { id: string }[]) => {
            const result = new Map<string, string>();
            for (const item of items) { if (!item?.id || result.has(item.id)) throw new Error("制作计划含缺失或重复编号"); result.set(item.id, nanoid()); }
            return result;
        };
        const episodeIds = makeMap(doc.episodes), sceneIds = makeMap(doc.scenes), assetIds = makeMap(doc.assets), shotIds = makeMap(doc.shots);
        const remap = (ids: Map<string, string>, id: string) => { if (id && !ids.has(id)) throw new Error("制作计划关联编号缺失"); return ids.get(id) || ""; };
        const nodeId = (canvasId: string, id: string) => { const next = canvases.has(canvasId) ? nodeMaps.get(canvasId)?.get(id) : undefined; if (id && !next) throw new Error("制作计划引用的画布或节点缺失，或不属于本项目，请检查后重新导出完整项目"); return next || ""; };
        return {
            ...doc,
            episodes: doc.episodes.map((episode) => ({ ...episode, id: remap(episodeIds, episode.id), delivery: episode.delivery ? { ...episode.delivery,
                audioTracks: episode.delivery.audioTracks.map((track) => ({ ...track, id: nanoid(), shotId: remap(shotIds, track.shotId) })),
                subtitles: episode.delivery.subtitles.map((cue) => ({ ...cue, id: nanoid(), shotId: remap(shotIds, cue.shotId) })),
            } : undefined })),
            scenes: doc.scenes.map((scene) => ({ ...scene, id: remap(sceneIds, scene.id), episodeId: remap(episodeIds, scene.episodeId) })),
            assets: doc.assets.map((asset) => ({ ...asset, id: remap(assetIds, asset.id), variantOf: remap(assetIds, asset.variantOf), references: asset.references.map((ref) => ({ ...ref, nodeId: nodeId(ref.canvasId, ref.nodeId) })) })),
            shots: doc.shots.map((shot) => {
                const candidateIds = makeMap(shot.candidates);
                return { ...shot, id: remap(shotIds, shot.id), episodeId: remap(episodeIds, shot.episodeId), sceneId: remap(sceneIds, shot.sceneId), assetIds: shot.assetIds.map((id) => remap(assetIds, id)), textNodeId: nodeId(shot.canvasId, shot.textNodeId), imageNodeId: nodeId(shot.canvasId, shot.imageNodeId), videoNodeId: nodeId(shot.canvasId, shot.videoNodeId),
                    candidates: shot.candidates.map((candidate) => ({ ...candidate, id: remap(candidateIds, candidate.id), nodeId: nodeId(candidate.canvasId, candidate.nodeId), content: candidate.storageKey ? "" : candidate.content })),
                    selectedImageCandidateId: remap(candidateIds, shot.selectedImageCandidateId), selectedVideoCandidateId: remap(candidateIds, shot.selectedVideoCandidateId),
                };
            }),
        };
    });    return { projects: copied, productions: plans };
}

export function remapProductionCanvases(doc: ProductionDocument, ids: Map<string, string>) {
    const canvasId = (id: string) => { if (id && !ids.has(id)) throw new Error("制作计划的画布归属缺失"); return ids.get(id) || ""; };
    return { ...doc, workspaceId: canvasId(doc.workspaceId), assets: doc.assets.map((asset) => ({ ...asset, references: asset.references.map((ref) => ({ ...ref, canvasId: canvasId(ref.canvasId) })) })), shots: doc.shots.map((shot) => ({ ...shot, canvasId: canvasId(shot.canvasId), candidates: shot.candidates.map((candidate) => ({ ...candidate, canvasId: canvasId(candidate.canvasId) })) })) };
}

/** Only attach a pending import to its own pristine, idempotently created plan. */
export function bindImportedProduction(doc: ProductionDocument, created: ProductionDocument): ProductionDocument {
    if (doc.id || !created.id || created.workspaceId !== doc.workspaceId || created.revision !== 1 || created.episodes.length || created.scenes.length || created.assets.length || created.shots.length) throw new Error("账号制作计划已变化，导入草稿仍保留，请先核对账号版本再继续");
    return { ...doc, id: created.id, revision: created.revision, createdAt: created.createdAt, updatedAt: created.updatedAt };
}

function replaceReferences(value: unknown, replacements: Map<string, string>): unknown {
    if (typeof value === "string") return replacements.get(value) || value;
    if (Array.isArray(value)) return value.map((item) => replaceReferences(item, replacements));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item, replacements)]));
}

export function importCanvasProjectGroups(projects: CanvasProject[], importProject: (project: CanvasProject, workspaceId?: string) => string) {
    const ids = new Map<string, string>();
    projects.filter((project) => !project.workspaceId).forEach((project) => ids.set(project.id, importProject(project)));
    projects.filter((project) => project.workspaceId).forEach((project) => ids.set(project.id, importProject(project, ids.get(project.workspaceId!))));
    return ids;
}

export function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string) {
    const subtype = mimeType.split("/")[1]?.split(";")[0];
    return subtype && /^[a-zA-Z0-9]+$/.test(subtype) && subtype !== "octet-stream" ? subtype : "bin";
}
