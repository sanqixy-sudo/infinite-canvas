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
    const assertSession = () => {
        const current = useUserStore.getState(), canvas = useCanvasStore.getState();
        if (!current.isReady || current.authError || !auth.token || !auth.user?.id || current.user?.role === "guest" || current.token !== auth.token || current.user?.id !== auth.user.id || current.sessionVersion !== auth.sessionVersion || !canvas.hydrated || canvas.ownerId !== auth.user.id) throw new Error("账号已变化或项目尚未加载，请重新导出");
    };
    assertSession();
    const all = useCanvasStore.getState().projects;
    if (projects.some((project) => !all.some((canvas) => canvas.id === project.id))) throw new Error("项目不属于当前已加载账号，请重新选择");
    const snapshot = structuredClone(projects);
    const completeRoots = snapshot.filter((project) => !project.workspaceId && all.filter((canvas) => canvas.workspaceId === project.id).every((canvas) => snapshot.some((item) => item.id === canvas.id)));
    const plans = await Promise.all(completeRoots.map(async (root) => {
        if (productionDraft?.workspaceId === root.id) return structuredClone(productionDraft);
        const draft = await localforage.getItem<{ document: ProductionDocument; dirty: boolean }>(`production-draft:${auth.user?.id}:${root.id}`);
        assertSession();
        return draft?.dirty && draft.document.workspaceId === root.id ? draft.document : await getProduction(auth.token, root.id);
    }));
    assertSession();
    const source = { projects: snapshot, productions: structuredClone(plans.filter((doc): doc is ProductionDocument => Boolean(doc))) };
    const importedUrls = new Map<string, string>();
    const materialKey = (url: string) => { if (!importedUrls.has(url)) importedUrls.set(url, `archive:${nanoid()}`); return importedUrls.get(url)!; };
    for (const project of source.projects) for (const node of project.nodes) {
        if ([CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type) && node.metadata?.content && !node.metadata.storageKey) node.metadata.storageKey = materialKey(node.metadata.content);
    }
    for (const doc of source.productions) for (const shot of doc.shots) for (const candidate of shot.candidates) if (candidate.content && !candidate.storageKey) candidate.storageKey = materialKey(candidate.content);
    const files = await buildCanvasArchive(source.projects, async ({ storageKey, urls }) => {
        assertSession();
        const [image, media] = await Promise.all([getImageBlob(storageKey).catch(() => null), getMediaBlob(storageKey).catch(() => null)]);
        assertSession();
        if (image || media) return (image || media)!;
        try {
            const url = await resolveMediaUrl(storageKey, urls.find((value) => !value.startsWith("blob:")) || urls[0] || "");
            assertSession();
            if (!url) throw new Error("无法取得文件地址");
            return await downloadRemoteMedia(url);
        } catch (error) { throw new Error(`素材读取失败，导出已停止：${storageKey}。${error instanceof Error ? error.message : "请确认文件仍可访问"}`); }
    }, source.productions);
    const zip = await createZip(files);
    assertSession();
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}
