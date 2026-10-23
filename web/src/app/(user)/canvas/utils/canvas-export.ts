import { saveAs } from "file-saver";
import localforage from "localforage";
import { getProduction } from "@/services/api/production";
import { useUserStore } from "@/stores/use-user-store";
import type { ProductionDocument } from "../lib/production-types";
import { CanvasNodeType } from "../types";
import { nanoid } from "nanoid";

import { createZip } from "@/lib/zip";
import { downloadRemoteMedia, getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { buildCanvasArchive, safeFileName } from "./canvas-transfer";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "小盟画布", productionDraft?: ProductionDocument) {
    const auth = useUserStore.getState();
    const all = useCanvasStore.getState().projects;
    const completeRoots = projects.filter((project) => !project.workspaceId && all.filter((canvas) => canvas.workspaceId === project.id).every((canvas) => projects.some((item) => item.id === canvas.id)));
    const plans = await Promise.all(completeRoots.map(async (root) => {
        if (productionDraft?.workspaceId === root.id) return structuredClone(productionDraft);
        const [remote, draft] = await Promise.all([getProduction(auth.token, root.id), localforage.getItem<{ document: ProductionDocument; dirty: boolean }>(`production-draft:${auth.user?.id}:${root.id}`)]);
        return draft?.dirty ? draft.document : remote;
    }));
    if (useUserStore.getState().sessionVersion !== auth.sessionVersion) throw new Error("账号已变化，请重新导出");
    const source = structuredClone({ projects, productions: plans.filter((doc): doc is ProductionDocument => Boolean(doc)) });
    const importedUrls = new Map<string, string>();
    const materialKey = (url: string) => { if (!importedUrls.has(url)) importedUrls.set(url, `archive:${nanoid()}`); return importedUrls.get(url)!; };
    for (const project of source.projects) for (const node of project.nodes) {
        if ([CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type) && node.metadata?.content && !node.metadata.storageKey) node.metadata.storageKey = materialKey(node.metadata.content);
    }
    for (const doc of source.productions) for (const shot of doc.shots) for (const candidate of shot.candidates) if (candidate.content && !candidate.storageKey) candidate.storageKey = materialKey(candidate.content);
    const files = await buildCanvasArchive(source.projects, async ({ storageKey, urls }) => {
        const [image, media] = await Promise.all([getImageBlob(storageKey).catch(() => null), getMediaBlob(storageKey).catch(() => null)]);
        if (image || media) return (image || media)!;
        try {
            const url = await resolveMediaUrl(storageKey, urls.find((value) => !value.startsWith("blob:")) || urls[0] || "");
            if (!url) throw new Error("无法取得文件地址");
            return await downloadRemoteMedia(url);
        } catch (error) { throw new Error(`素材读取失败，导出已停止：${storageKey}。${error instanceof Error ? error.message : "请确认文件仍可访问"}`); }
    }, source.productions);
    const zip = await createZip(files);
    if (useUserStore.getState().sessionVersion !== auth.sessionVersion) throw new Error("账号已变化，请重新导出");
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}
