import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { downloadRemoteMedia, getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasProject } from "../stores/use-canvas-store";
import { buildCanvasArchive, safeFileName } from "./canvas-transfer";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "小盟画布") {
    const files = await buildCanvasArchive(projects, async ({ storageKey, urls }) => {
        const [image, media] = await Promise.all([getImageBlob(storageKey).catch(() => null), getMediaBlob(storageKey).catch(() => null)]);
        if (image || media) return (image || media)!;
        try {
            const url = await resolveMediaUrl(storageKey, urls.find((value) => !value.startsWith("blob:")) || urls[0] || "");
            if (!url) throw new Error("无法取得文件地址");
            return await downloadRemoteMedia(url);
        } catch (error) { throw new Error(`素材读取失败，导出已停止：${storageKey}。${error instanceof Error ? error.message : "请确认文件仍可访问"}`); }
    });
    const zip = await createZip(files);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}
