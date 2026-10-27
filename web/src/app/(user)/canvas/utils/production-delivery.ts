import type { ProductionCandidate, ProductionDocument, ProductionShot } from "../lib/production-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import { isProductionCandidateValid } from "./production-candidates";

export const PRODUCTION_DELIVERY_MAX_BYTES = 256 * 1024 * 1024;
export type ProductionDeliveryMedia = Omit<ProductionCandidate,"kind"> & { kind: "image" | "video" | "audio" };
export type ProductionDeliveryRow = { shot: ProductionShot; index: number; startSeconds: number; candidates: ProductionCandidate[]; primary?: ProductionCandidate; issues: string[] };

export function productionDeliveryRows(document: ProductionDocument, episodeId: string, canvases: CanvasProject[]): ProductionDeliveryRow[] {
    let startSeconds = 0;
    return document.shots.filter((shot) => shot.episodeId === episodeId).sort((a, b) => a.order - b.order).map((shot, index) => {
        const issues: string[] = [];
        const candidates: ProductionCandidate[] = [];
        for (const [kind, id] of [["image", shot.selectedImageCandidateId], ["video", shot.selectedVideoCandidateId]] as const) {
            if (!id) continue;
            const candidate = shot.candidates.find((item) => item.id === id && item.kind === kind);
            if (!candidate || !isProductionCandidateValid(candidate, canvases)) issues.push(`已采用的${kind === "image" ? "图片" : "视频"}失效，请重新选择候选`);
            else if (!candidate.storageKey) issues.push(`已采用的${kind === "image" ? "图片" : "视频"}尚未入库，请先保存素材再建立候选`);
            else candidates.push(candidate);
        }
        if (!shot.selectedImageCandidateId && !shot.selectedVideoCandidateId) issues.push("尚未采用图片或视频");
        if (!Number.isInteger(shot.seconds) || shot.seconds < 1 || shot.seconds > 86400) issues.push("计划时长无效，请修改镜头时长");
        const row = { shot, index, startSeconds, candidates, primary: candidates.find((item) => item.kind === "video") || candidates[0], issues };
        startSeconds += Number.isInteger(shot.seconds) && shot.seconds > 0 ? shot.seconds : 0;
        return row;
    });
}

export function productionTimecode(seconds: number, subtitle = false) {
    const milliseconds = Math.round(Math.max(0, seconds) * 1000);
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}${subtitle ? `,${String(milliseconds % 1000).padStart(3, "0")}` : ""}`;
}

export function productionDialogueSrt(rows: ProductionDeliveryRow[]) {
    let index = 0;
    return rows.filter(({ shot }) => shot.dialogue.trim()).map(({ shot, startSeconds }) => `${++index}\n${productionTimecode(startSeconds, true)} --> ${productionTimecode(startSeconds + shot.seconds, true)}\n${shot.dialogue.trim().replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n")}\n`).join("\n");
}

function filename(value: string) {
    return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 70) || "镜头";
}

function mediaExtension(blob: Blob, kind: ProductionDeliveryMedia["kind"]) {
    const mime = blob.type.toLowerCase().split(";")[0];
    if (!mime.startsWith(`${kind}/`)) throw new Error(`文件类型不符合采用的${kind === "image" ? "图片" : "视频"}，请在素材库检查原文件`);
    const common: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg", "video/quicktime": "mov", "video/x-matroska": "mkv", "video/x-msvideo": "avi", "audio/mpeg": "mp3", "audio/x-wav": "wav" };
    const extension = common[mime] || mime.split("/")[1];
    return /^[a-z0-9]+$/.test(extension) ? extension : "bin";
}

/** Each file comes from a validated storage identity; no URL is included in the handoff manifest. */
export async function buildProductionDelivery(document: ProductionDocument, episodeId: string, rows: ProductionDeliveryRow[], readFile: (candidate: ProductionDeliveryMedia, remainingBytes: number) => Promise<Blob>, options: { subtitles: boolean; assertCurrent: () => void; onProgress?: (completed: number, total: number) => void }) {
    const episode = document.episodes.find((item) => item.id === episodeId);
    if (!episode || !rows.length) throw new Error("请先为当前分集建立镜头并选择采用结果");
    const invalid = rows.find((row) => row.issues.length);
    if (invalid) throw new Error(`${invalid.shot.title}：${invalid.issues.join("；")}`);
    const files: { name: string; data: BlobPart }[] = [];
    const stored = new Map<string, { path: string; mimeType: string; bytes: number; kind: string }>();
    let totalBytes = 0, completed = 0;
    const tracks = episode.delivery?.audioTracks || [];
    const total = new Set([...rows.flatMap((row) => row.candidates.map((candidate) => candidate.storageKey)), ...tracks.map((track) => track.storageKey)]).size;
    const shots = [];
    for (const row of rows) {
        const media = [];
        for (const candidate of row.candidates) {
            options.assertCurrent();
            let entry = stored.get(candidate.storageKey);
            if (entry && entry.kind !== candidate.kind) throw new Error(`${row.shot.title}：同一文件被标记为不同媒体类型`);
            if (!entry) {
                const blob = await readFile(candidate, PRODUCTION_DELIVERY_MAX_BYTES - totalBytes);
                options.assertCurrent();
                if (!blob.size) throw new Error(`${row.shot.title}：采用文件为空，导出已停止`);
                if (totalBytes + blob.size > PRODUCTION_DELIVERY_MAX_BYTES) throw new Error("本集原文件超过 256 MiB，请先拆分为较短分集后再导出");
                const extension = mediaExtension(blob, candidate.kind);
                const path = `media/${String(row.index + 1).padStart(3, "0")}-${filename(row.shot.title)}-${candidate.kind === "image" ? "分镜图" : "视频"}.${extension}`;
                entry = { path, mimeType: blob.type, bytes: blob.size, kind: candidate.kind };
                stored.set(candidate.storageKey, entry);
                files.push({ name: path, data: blob });
                totalBytes += blob.size;
                options.onProgress?.(++completed, total);
            }
            media.push({ candidateId: candidate.id, title: candidate.title, ...entry });
        }
        shots.push({ id: row.shot.id, order: row.index + 1, title: row.shot.title, scene: document.scenes.find((scene) => scene.id === row.shot.sceneId)?.title || "", plannedStartSeconds: row.startSeconds, plannedDurationSeconds: row.shot.seconds, description: row.shot.description, dialogue: row.shot.dialogue, camera: row.shot.camera, primaryKind: row.primary!.kind, media });
    }
    const audioTracks = [];
    for (const track of tracks) {
        options.assertCurrent();
        if (!track.storageKey.startsWith("server:") || track.storageKey.startsWith("server:webdav:")) throw new Error("交付音轨必须来自账号文件");
        let entry = stored.get(track.storageKey);
        if (entry && entry.kind !== "audio") throw new Error("同一文件不能同时作为画面和音轨");
        if (!entry) {
            const blob = await readFile({ id: track.id, title: track.label, kind: "audio", storageKey: track.storageKey, canvasId: "", nodeId: "", content: "" }, PRODUCTION_DELIVERY_MAX_BYTES - totalBytes);
            options.assertCurrent();
            if (!blob.size || totalBytes + blob.size > PRODUCTION_DELIVERY_MAX_BYTES) throw new Error("音轨为空或交接包超过 256 MiB");
            const path: string = `audio/${String(audioTracks.length + 1).padStart(3, "0")}-${filename(track.label)}.${mediaExtension(blob, "audio")}`;
            entry = { path, mimeType: blob.type, bytes: blob.size, kind: "audio" }; stored.set(track.storageKey, entry);
            files.push({ name: path, data: blob }); totalBytes += blob.size; options.onProgress?.(++completed, total);
        }
        const { storageKey: _storageKey, ...timing } = track;
        audioTracks.push({ ...timing, ...entry });
    }
    options.assertCurrent();
    const manifest = { app: "xiaomeng-production-delivery", version: 1, projectTitle: document.title, episodeTitle: episode.title, sourceRevision: document.revision, snapshot: "current-editor-draft", exportedAt: new Date().toISOString(), timing: "planned-shot-duration-not-retimed-media", plannedDurationSeconds: rows.reduce((sum, row) => sum + row.shot.seconds, 0), totalMediaBytes: totalBytes, shots, delivery: { originalGain: episode.delivery?.originalGain ?? 1, burnSubtitles: episode.delivery?.burnSubtitles ?? false, audioTracks, subtitles: episode.delivery?.subtitles || [] } };
    files.push({ name: "分集清单.json", data: JSON.stringify(manifest, null, 2) });
    files.push({ name: "镜头清单.md", data: [`# ${document.title} · ${episode.title}`, "", "本包来自导出时编辑器中的当前计划，可能包含尚未保存到账号的修改。原文件不裁切、不变速、不拼接。", "", ...shots.flatMap((shot) => [`## ${String(shot.order).padStart(3, "0")} · ${shot.title}`, `- 场次：${shot.scene || "未指定"}`, `- 计划起点：${productionTimecode(shot.plannedStartSeconds)}；计划时长：${shot.plannedDurationSeconds} 秒`, `- 画面：${shot.description}`, `- 对白：${shot.dialogue || "无"}`, `- 景别／运镜：${shot.camera || "未指定"}`, ...shot.media.map((item) => `- ${item.kind === "video" ? "采用视频" : "采用图片"}：${item.path}`), ""])].join("\n") });
    if (options.subtitles) {
        const { productionEditedSrt, productionDeliveryIssues } = await import("./production-delivery-edit");
        if (episode.delivery) { const issues = productionDeliveryIssues(episode.delivery, manifest.plannedDurationSeconds); if (issues.length) throw new Error(issues.join("；")); }
        files.push({ name: episode.delivery?.subtitles.length ? "分集字幕-编辑版.srt" : "对白草稿-按计划时长.srt", data: episode.delivery?.subtitles.length ? productionEditedSrt(episode.delivery.subtitles) : productionDialogueSrt(rows) });
    }
    files.push({ name: "使用说明.txt", data: "这是分集素材交接包，不是已合成的成片。\n\n1. media 中是已采用的真实原文件。同一素材被多个镜头采用时只保存一份，分集清单.json 记录复用路径。\n2. 分集清单和镜头清单记录当前编辑器快照、顺序、计划时长、对白及采用版本。尚未保存到账号的修改也会包含在本包。\n3. 图片可作为分镜占位；视频保留原始长度、比例和声音。请在剪辑软件中按实际内容裁切、调速和编排。\n4. 可选 SRT 按镜头计划时长排列整段对白，不是语音识别或逐字对齐；原视频时长与计划可能不同，成片前须校准字幕。\n5. audio 包含交付音轨原文件，分集清单 delivery 保存起点、裁切、音量和编辑字幕。音轨不预混，字幕优先采用编辑版本，否则使用对白草稿。\n6. 本包不包含未采用候选、未引用项目资产、模型密钥或临时下载链接。暂不支持把本包自动导回画布。\n" });
    return files;
}
