import { getStorageObjectInfo } from "@/services/api/storage";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { getImageBlob, getProxyUrl, resolveImageUrl } from "@/services/image-storage";
import type { ProductionDeliveryMedia } from "../../../utils/production-delivery";

/** Only a selected candidate's storage record can be read; never fetch its arbitrary fallback URL. */
export async function readProductionDeliveryMedia(candidate: ProductionDeliveryMedia, remainingBytes: number, signal: AbortSignal, assertCurrent: () => void) {
    assertCurrent();
    signal.throwIfAborted();
    if (!candidate.storageKey) throw new Error("采用结果尚未入库，请先保存素材文件");
    let url = "", mimeType = "";
    if (candidate.storageKey.startsWith("server:") && !candidate.storageKey.startsWith("server:webdav:")) {
        const info = await getStorageObjectInfo(candidate.storageKey.slice("server:".length));
        assertCurrent();
        if (info.bytes > remainingBytes) throw new Error("本集原文件超过 256 MiB，请先拆分为较短分集后再导出");
        url = info.publicUrl || info.contentUrl;
        mimeType = info.mimeType;
    } else {
        const blob = await (candidate.kind === "image" ? getImageBlob(candidate.storageKey) : getMediaBlob(candidate.storageKey));
        assertCurrent();
        if (blob) {
            if (blob.size > remainingBytes) throw new Error("本集原文件超过 256 MiB，请先拆分为较短分集后再导出");
            signal.throwIfAborted();
            return blob;
        }
        url = await (candidate.kind === "image" ? resolveImageUrl(candidate.storageKey) : resolveMediaUrl(candidate.storageKey));
        assertCurrent();
    }
    signal.throwIfAborted();
    if (!url) throw new Error("采用文件已不可用，请在素材库检查后重新选择候选");
    const response = await fetch(getProxyUrl(url), { signal });
    assertCurrent();
    if (!response.ok) throw new Error(`素材读取失败（${response.status}），请检查存储配置或文件是否仍存在`);
    if (Number(response.headers.get("content-length")) > remainingBytes) { await response.body?.cancel(); throw new Error("本集原文件超过 256 MiB，请先拆分为较短分集后再导出"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("浏览器无法读取素材文件，请重试");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            assertCurrent();
            signal.throwIfAborted();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > remainingBytes) throw new Error("本集原文件超过 256 MiB，请先拆分为较短分集后再导出");
            chunks.push(new Uint8Array(value));
        }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    const responseType = response.headers.get("content-type") || "";
    return new Blob(chunks, { type: responseType && responseType.split(";")[0] !== "application/octet-stream" ? responseType : mimeType || "application/octet-stream" });
}
