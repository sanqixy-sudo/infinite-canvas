import type { CanvasExportAsset, CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";

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

export async function buildCanvasArchive(projects: CanvasProject[], readFile: (reference: StorageReference) => Promise<Blob>) {
    const files: { name: string; data: BlobPart }[] = [];
    const requests = new Map<string, Promise<Blob>>();
    const exportedProjects = await Promise.all(projects.map(async (project) => {
        const assets = await Promise.all([...collectCanvasStorageReferences(project).values()].map(async (reference, index) => {
            let request = requests.get(reference.storageKey);
            if (!request) { request = readFile(reference); requests.set(reference.storageKey, request); }
            const blob = await request;
            if (!blob.size) throw new Error(`素材为空，导出已停止：${reference.storageKey}`);
            const path = `projects/${project.id}/files/${index}-${safeFileName(reference.storageKey)}.${fileExtension(blob.type)}`;
            files.push({ name: path, data: blob });
            return { storageKey: reference.storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size };
        }));
        return { project, files: assets };
    }));
    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    return [{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...files];
}

export async function prepareCanvasImport(data: CanvasExportFile, zip: Map<string, Blob>, storeFile: (file: CanvasExportAsset, blob: Blob) => Promise<RestoredFile>) {
    if (data?.app !== "infinite-canvas" || !Array.isArray(data.projects) || !data.projects.length) throw new Error("压缩包不是有效的项目导出文件");
    const assets = new Map<string, { file: CanvasExportAsset; blob: Blob }>();
    const references = new Map<string, StorageReference>();
    const projectIds = new Set<string>();
    for (const item of data.projects) {
        if (!item?.project?.id || projectIds.has(item.project.id) || !Array.isArray(item.files)) throw new Error("项目数据缺失或包含重复画布编号");
        projectIds.add(item.project.id);
        collectCanvasStorageReferences(item.project, references);
        for (const file of item.files) {
            const blob = zip.get(file.path);
            if (!file.storageKey || !blob || blob.size !== file.bytes || !blob.size) throw new Error(`压缩包素材缺失或不完整：${file.path || file.storageKey}`);
            assets.set(file.storageKey, { file, blob });
        }
    }
    for (const key of references.keys()) if (!assets.has(key)) throw new Error(`压缩包缺少画布引用的素材：${key}`);

    const replacements = new Map<string, string>();
    await Promise.all([...assets.values()].map(async ({ file, blob }) => {
        const restored = await storeFile(file, blob.slice(0, blob.size, file.mimeType));
        replacements.set(file.storageKey, restored.storageKey);
        for (const url of references.get(file.storageKey)?.urls || []) replacements.set(url, restored.url);
    }));
    return data.projects.map(({ project }) => replaceReferences(project, replacements) as CanvasProject);
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
    projects.filter((project) => project.workspaceId).forEach((project) => importProject(project, ids.get(project.workspaceId!)));
}

export function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string) {
    const subtype = mimeType.split("/")[1]?.split(";")[0];
    return subtype && /^[a-zA-Z0-9]+$/.test(subtype) && subtype !== "octet-stream" ? subtype : "bin";
}
