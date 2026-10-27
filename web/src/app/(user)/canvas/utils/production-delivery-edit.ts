import type { ProductionDeliveryEdit, ProductionDocument, ProductionSubtitle } from "../lib/production-types";
import { productionTimecode } from "./production-delivery";

export const emptyProductionDelivery = (): ProductionDeliveryEdit => ({ originalGain: 1, burnSubtitles: false, audioTracks: [], subtitles: [] });
export function productionShotTimings(document: ProductionDocument, episodeId: string) {
    let start = 0;
    return document.shots.filter((shot) => shot.episodeId === episodeId).sort((a, b) => a.order - b.order).map((shot) => {
        const row = { shot, start, end: start + shot.seconds }; start = row.end; return row;
    });
}
export function productionEditedSrt(cues: ProductionSubtitle[]) {
    return [...cues].sort((a, b) => a.startSeconds - b.startSeconds).filter((cue) => cue.text.trim()).map((cue, index) => `${index + 1}\n${productionTimecode(cue.startSeconds, true)} --> ${productionTimecode(cue.endSeconds, true)}\n${cue.text.trim().replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n")}\n`).join("\n");
}
export function productionDeliveryIssues(edit: ProductionDeliveryEdit, total: number) {
    const issues: string[] = [];
    if (!Number.isFinite(edit.originalGain) || edit.originalGain < 0 || edit.originalGain > 1 || edit.audioTracks.length > 64 || edit.subtitles.length > 500) issues.push("原声音量或音轨/字幕数量超出限制");
    for (const track of edit.audioTracks) if (![track.startSeconds, track.trimStartSeconds, track.durationSeconds, track.gain].every(Number.isFinite) || track.startSeconds < 0 || track.trimStartSeconds < 0 || track.durationSeconds <= 0 || track.startSeconds + track.durationSeconds > total + 0.001 || track.gain < 0 || track.gain > 1) issues.push(`${track.label}：请调整音轨范围与音量`);
    for (const cue of edit.subtitles) if (!Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < 0 || cue.endSeconds <= cue.startSeconds || cue.endSeconds > total + 0.001 || !cue.text.trim()) issues.push("字幕须填写内容，起止时间落在本集范围内");
    return [...new Set(issues)];
}
export function productionAudioDuration(blob: Blob, signal: AbortSignal): Promise<number> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const url = URL.createObjectURL(blob), audio = new Audio();
        const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener("abort", abort); audio.onloadedmetadata = null; audio.onerror = null; const seconds = audio.duration; audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url); if (error) reject(error); else if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) reject(new Error("无法读取音频时长，或音频超过 60 分钟，请使用 MP3 / WAV 文件")); else resolve(seconds); };
        const abort = () => finish(new Error("音频读取已取消"));
        const timer = setTimeout(() => finish(new Error("读取音频时长超时，请检查文件")), 15000);
        audio.onloadedmetadata = () => finish(); audio.onerror = () => finish(new Error("浏览器不能读取此音频，请使用 MP3 / WAV 文件"));
        signal.addEventListener("abort", abort, { once: true }); audio.preload = "metadata"; audio.src = url;
    });
}
