import { nanoid } from "nanoid";
import type { ProductionDocument, ProductionShot } from "../../../lib/production-types";

export type ScriptSection = { title: string; script: string };
export type ScriptImportMode = "new" | "split" | "append" | "replace";

export function splitProductionScript(text: string, title: string): ScriptSection[] {
    const sections: ScriptSection[] = [];
    let current: ScriptSection = { title, script: "" }, headings = 0;
    for (const line of text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
        if (/^\s*(?:#{1,6}\s*)?(?:第\s*[零〇一二三四五六七八九十百千两\d]+\s*集|ep(?:isode)?\.?\s*\d+)(?:\s|[：:、.．—-]|$)/i.test(line)) {
            if (current.script.trim() || headings) sections.push({ ...current, script: current.script.trim() });
            current = { title: line.trim().replace(/^#{1,6}\s*/, ""), script: "" }; headings++;
        } else current.script += `${line}\n`;
    }
    if (current.script.trim() || headings) sections.push({ ...current, script: current.script.trim() });
    if (!headings) throw new Error("未识别到分集标题，请使用独立一行的「第1集」或「EP 1」，也可选择整份新增一集。");
    return sections;
}

export function importProductionScript(doc: ProductionDocument, sections: ScriptSection[], mode: ScriptImportMode, episodeId = "", previousScript = "") {
    if (!sections.length || sections.some((part) => !part.title.trim() || part.title.length > 100 || part.script.length > 100000)) throw new Error("每集名称须为 1–100 字，剧本最多 100000 字，请先调整文件。");
    if (!sections.some((part) => part.script.trim())) throw new Error("文件没有可导入的剧本正文。");
    if (mode === "append" || mode === "replace") {
        if (sections.length !== 1) throw new Error("追加或替换仅支持一份剧本，请先选择整份导入或分集新增。");
        const episode = doc.episodes.find((item) => item.id === episodeId);
        if (!episode) throw new Error("目标分集已不存在，请重新打开导入。");
        if (episode.script !== previousScript) throw new Error("目标剧本在预览期间已有修改，请重新打开导入，避免覆盖新内容。");
        const script = mode === "append" ? [episode.script, sections[0].script].filter(Boolean).join("\n\n") : sections[0].script;
        if (script.length > 100000) throw new Error("导入后本集剧本超过 100000 字，请拆为多个分集。");
        return { document: { ...doc, episodes: doc.episodes.map((item) => item.id === episodeId ? { ...item, script } : item) }, episodeId };
    }
    if (doc.episodes.length + sections.length > 100) throw new Error("每份制作计划最多 100 集，无法加入这份文件。");
    const order = Math.max(-1, ...doc.episodes.map((item) => item.order)) + 1;
    const added = sections.map((part, index) => ({ ...part, title: part.title.trim(), id: nanoid(), order: order + index }));
    return { document: { ...doc, episodes: [...doc.episodes, ...added] }, episodeId: added[0].id };
}

function clonedShot(shot: ProductionShot, episodeId: string, order: number, keepAssets: boolean): ProductionShot {
    return { ...shot, id: nanoid(), title: `${shot.title.slice(0, 94)} · 副本`, episodeId, order, sceneId: episodeId === shot.episodeId ? shot.sceneId : "", assetIds: keepAssets ? [...shot.assetIds] : [], canvasId: "", textNodeId: "", imageNodeId: "", videoNodeId: "", status: "draft", candidates: [], selectedImageCandidateId: "", selectedVideoCandidateId: "" };
}

export function duplicateProductionEpisode(doc: ProductionDocument, episodeId: string, keepAssets: boolean) {
    const episode = doc.episodes.find((item) => item.id === episodeId);
    if (!episode) throw new Error("分集已不存在。");
    const scenes = doc.scenes.filter((item) => item.episodeId === episodeId), shots = doc.shots.filter((item) => item.episodeId === episodeId);
    if (doc.episodes.length >= 100 || doc.scenes.length + scenes.length > 500 || doc.shots.length + shots.length > 500) throw new Error("复制后超过制作计划上限：100 集、500 场次、500 镜头。");
    const id = nanoid(), sceneIds = new Map(scenes.map((scene) => [scene.id, nanoid()]));
    const episodes = [...doc.episodes].sort((a, b) => a.order - b.order);
    episodes.splice(episodes.findIndex((item) => item.id === episodeId) + 1, 0, { id, title: `${episode.title.slice(0, 94)} · 副本`, script: episode.script, order: 0 });
    return { document: { ...doc, episodes: episodes.map((item, order) => ({ ...item, order })), scenes: [...doc.scenes, ...scenes.map((scene) => ({ ...scene, id: sceneIds.get(scene.id)!, episodeId: id }))], shots: [...doc.shots, ...shots.map((shot) => ({ ...clonedShot(shot, id, shot.order, keepAssets), sceneId: sceneIds.get(shot.sceneId) || "" }))] }, episodeId: id };
}

export function changeProductionShots(doc: ProductionDocument, ids: string[], targetEpisodeId: string, mode: "copy" | "move", keepAssets = true) {
    if (!doc.episodes.some((item) => item.id === targetEpisodeId)) throw new Error("目标分集已不存在。");
    const selected = new Set(ids), shots = doc.shots.filter((shot) => selected.has(shot.id)).sort((a, b) => a.order - b.order);
    if (!shots.length || shots.length !== selected.size) throw new Error("所选镜头已变化，请重新选择。");
    if (mode === "copy") {
        if (doc.shots.length + shots.length > 500) throw new Error("复制后镜头超过 500 个，请减少选择。");
        const start = Math.max(-1, ...doc.shots.filter((item) => item.episodeId === targetEpisodeId).map((item) => item.order)) + 1;
        return { ...doc, shots: [...doc.shots, ...shots.map((shot, index) => clonedShot(shot, targetEpisodeId, start + index, keepAssets))] };
    }
    if (shots.some((shot) => shot.episodeId === targetEpisodeId)) throw new Error("请选择其他分集；本集排序请使用镜头上移、下移。");
    if (doc.episodes.some((episode) => episode.delivery?.audioTracks.some((track) => selected.has(track.shotId)) || episode.delivery?.subtitles.some((subtitle) => selected.has(subtitle.shotId)))) throw new Error("所选镜头仍关联原集音轨或字幕。请先到原集「分集交付」解除这些关联，再跨集移动，避免时间轴错位。");
    const start = Math.max(-1, ...doc.shots.filter((item) => item.episodeId === targetEpisodeId).map((item) => item.order)) + 1;
    const moved = new Map(shots.map((shot, index) => [shot.id, { ...shot, episodeId: targetEpisodeId, sceneId: "", order: start + index }]));
    return { ...doc, shots: doc.shots.map((shot) => moved.get(shot.id) || shot) };
}

export function reorderProductionEpisode(doc: ProductionDocument, episodeId: string, direction: number) {
    const episodes = [...doc.episodes].sort((a, b) => a.order - b.order), index = episodes.findIndex((item) => item.id === episodeId), target = index + direction;
    if (index < 0 || target < 0 || target >= episodes.length) return doc;
    [episodes[index], episodes[target]] = [episodes[target], episodes[index]];
    return { ...doc, episodes: episodes.map((episode, order) => ({ ...episode, order })) };
}
