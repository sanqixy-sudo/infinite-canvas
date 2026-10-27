"use client";

import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Alert, Button, Checkbox, ConfigProvider, Dropdown, Input, Modal, Select, Tabs } from "antd";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Clapperboard, Copy, Download, FileText, Film, Images, Layers3, LayoutGrid, ListChecks, Pencil, Plus, Save, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useProduction } from "./use-production";
import { ProductionAssetEditor, ProductionShotEditor } from "./components/production-editors";
import { ProductionReferencePreview } from "./components/production-reference-preview";
import { ProductionCandidatesDialog } from "./components/production-candidates-dialog";
import ProductionTasks from "./components/production-tasks";
import { ProductionBreakdownDialog } from "./components/production-breakdown-dialog";
import ProductionDelivery from "./components/production-delivery";
import { productionAssetLabels, type ProductionAsset, type ProductionAssetKind, type ProductionShot } from "../../../lib/production-types";
import { productionChecklist, productionShotText } from "../../../utils/production-canvas";
import { getProductionShotState } from "../../../utils/production-candidates";
import { useCanvasExport } from "../../../hooks/use-canvas-export";
import ProductionScriptImport from "./components/production-script-import";
import { changeProductionShots, duplicateProductionEpisode, reorderProductionEpisode } from "./production-operations";

export default function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
    return <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">正在读取制作页面…</p>}><ProductionEditor params={params} /></Suspense>;
}

function ProductionEditor({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const { modal, message } = App.useApp();
    const plan = useProduction(id);
    const exportProjects = useCanvasExport();
    const { document: doc, edit, busy } = plan;
    const tab = ["script", "assets", "shots", "tasks", "delivery"].includes(searchParams.get("tab") || "") ? searchParams.get("tab")! : "script";
    const episodeId = searchParams.get("episode") || "";
    const navigate = (next: { tab?: string; episode?: string }, replace = false) => {
        const query = new URLSearchParams(searchParams.toString());
        if (next.tab) query.set("tab", next.tab);
        if (next.episode) query.set("episode", next.episode); else if (next.episode === "") query.delete("episode");
        const href = `/canvas/project/${encodeURIComponent(id)}/production?${query}`;
        if (replace) router.replace(href, { scroll: false }); else router.push(href, { scroll: false });
    };
    const setTab = (value: string) => navigate({ tab: value });
    const setEpisodeId = (value: string) => navigate({ episode: value });
    const [scriptImport, setScriptImport] = useState(false);
    const [selection, setSelection] = useState<string[]>([]), [shotQuery, setShotQuery] = useState(""), [sceneFilter, setSceneFilter] = useState("all"), [statusFilter, setStatusFilter] = useState("all");
    const [batch, setBatch] = useState<{ mode: "place" | "copy" | "move" | "episode"; ids: string[]; sourceEpisodeId: string; targetEpisodeId: string; canvasId: string; keepAssets: boolean } | null>(null);
    const [assetKind, setAssetKind] = useState<ProductionAssetKind | "all">("all");
    const [assetEditor, setAssetEditor] = useState<ProductionAsset | null>(null);
    const [shotEditor, setShotEditor] = useState<ProductionShot | null>(null);
    const [candidateShotId, setCandidateShotId] = useState("");
    const [breakdownEpisodeId, setBreakdownEpisodeId] = useState("");
    const [place, setPlace] = useState<{ shot: ProductionShot; canvasId: string; rebuild: boolean } | null>(null);
    const episodes = [...(doc?.episodes || [])].sort((a, b) => a.order - b.order);
    const episode = episodes.find((item) => item.id === episodeId) || episodes[0];
    const scenes = (doc?.scenes || []).filter((item) => item.episodeId === episode?.id).sort((a, b) => a.order - b.order);
    const shots = (doc?.shots || []).filter((item) => item.episodeId === episode?.id).sort((a, b) => a.order - b.order);
    const visibleShots = shots.filter((shot) => (sceneFilter === "all" || shot.sceneId === sceneFilter) && (statusFilter === "all" || (statusFilter === "unbound" ? !shot.canvasId : shot.status === statusFilter)) && [shot.title, shot.description, shot.dialogue, shot.camera, ...shot.assetIds.map((assetId) => doc?.assets.find((asset) => asset.id === assetId)?.title || "")].join(" ").toLowerCase().includes(shotQuery.trim().toLowerCase()));
    const selectedShots = visibleShots.filter((shot) => selection.includes(shot.id));
    const candidateShot = doc?.shots.find((item) => item.id === candidateShotId);

    useEffect(() => { setAssetEditor(null); setShotEditor(null); setPlace(null); setCandidateShotId(""); setBreakdownEpisodeId(""); setScriptImport(false); setBatch(null); }, [doc?.id]);
    useEffect(() => { setSelection([]); setSceneFilter("all"); setStatusFilter("all"); setShotQuery(""); }, [episode?.id]);
    useEffect(() => {
        if (doc && !plan.loading && episodeId && !doc.episodes.some((item) => item.id === episodeId)) navigate({ episode: episode?.id || "" }, true);
        // Correct removed or invalid deep links only after the plan has loaded.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc, plan.loading, episodeId]);

    const addEpisode = () => {
        const nextId = nanoid();
        if (edit((value) => ({ ...value, episodes: [...value.episodes, { id: nextId, title: `第 ${value.episodes.length + 1} 集`, script: "", order: Math.max(-1, ...value.episodes.map((item) => item.order)) + 1 }] }))) navigate({ episode: nextId, tab: "script" });
    };
    const openBatch = (mode: NonNullable<typeof batch>["mode"], ids = selectedShots.map((shot) => shot.id)) => setBatch({ mode, ids, sourceEpisodeId: episode?.id || "", targetEpisodeId: mode === "move" ? episodes.find((item) => item.id !== episode?.id)?.id || "" : episode?.id || "", canvasId: plan.canvases[0]?.id || "", keepAssets: true });
    const applyBatch = async () => {
        if (!batch) return;
        const mode = batch.mode;
        if (mode === "place") { if (await plan.placeShots(batch.ids, batch.canvasId) && plan.isCurrent()) { setBatch(null); setSelection([]); } return; }
        let target = batch.targetEpisodeId;
        const changed = edit((value) => {
            if (mode === "episode") { const result = duplicateProductionEpisode(value, batch.sourceEpisodeId, batch.keepAssets); target = result.episodeId; return result.document; }
            return changeProductionShots(value, batch.ids, batch.targetEpisodeId, mode, batch.keepAssets);
        });
        if (changed) { setBatch(null); setSelection([]); navigate({ episode: target, tab: batch.mode === "episode" ? "script" : "shots" }); void message.success("已更新本机草稿，请检查后保存计划。"); }
    };
    const deleteEpisode = () => {
        if (!episode || !doc) return;
        const sceneCount = doc.scenes.filter((scene) => scene.episodeId === episode.id).length;
        const shotCount = doc.shots.filter((shot) => shot.episodeId === episode.id).length;
        modal.confirm({ title: `删除“${episode.title}”？`, content: `将删除本集剧本、${sceneCount} 个场次和 ${shotCount} 个镜头计划，包括镜头候选与采用记录。已建立的画布节点、候选副本、素材文件和项目资产会保留。`, okText: "删除分集计划", cancelText: "保留", okButtonProps: { danger: true }, onOk: () => edit((value) => ({ ...value, episodes: value.episodes.filter((item) => item.id !== episode.id), scenes: value.scenes.filter((item) => item.episodeId !== episode.id), shots: value.shots.filter((item) => item.episodeId !== episode.id) })) });
    };
    const deleteScene = (sceneId: string) => {
        if (doc?.shots.some((shot) => shot.sceneId === sceneId)) { void message.warning("这个场次仍有关联镜头，请先在镜头编辑中调整所属场次。"); return; }
        modal.confirm({ title: "删除这个场次？", content: "仅删除制作计划中的场次说明，保留剧本、项目资产和画布内容。", okText: "删除场次", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => edit((value) => ({ ...value, scenes: value.scenes.filter((item) => item.id !== sceneId) })) });
    };
    const deleteAsset = (asset: ProductionAsset) => {
        if (doc?.shots.some((shot) => shot.assetIds.includes(asset.id)) || doc?.assets.some((item) => item.variantOf === asset.id)) { void message.warning("该资产仍被镜头或变体引用，请先调整关联后再删除。"); return; }
        modal.confirm({ title: `删除资产“${asset.title}”？`, content: "仅删除本项目的资产设定与关联，保留画布节点、素材库记录和文件。", okText: "删除资产设定", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => edit((value) => ({ ...value, assets: value.assets.filter((item) => item.id !== asset.id) })) });
    };
    const newShot = () => {
        if (!episode || busy) return;
        setShotEditor({ id: nanoid(), episodeId: episode.id, sceneId: "", order: Math.max(-1, ...shots.map((item) => item.order)) + 1, title: `镜头 ${String(shots.length + 1).padStart(2, "0")}`, description: "", dialogue: "", camera: "", seconds: 5, assetIds: [], canvasId: "", textNodeId: "", imageNodeId: "", videoNodeId: "", status: "draft", candidates: [], selectedImageCandidateId: "", selectedVideoCandidateId: "" });
    };
    const moveShot = (shot: ProductionShot, direction: number) => {
        const next = [...shots], index = next.findIndex((item) => item.id === shot.id), target = index + direction;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        const order = new Map(next.map((item, position) => [item.id, position]));
        edit((value) => ({ ...value, shots: value.shots.map((item) => order.has(item.id) ? { ...item, order: order.get(item.id)! } : item) }));
    };
    const deleteShot = (shot: ProductionShot) => modal.confirm({ title: `删除“${shot.title}”的计划？`, content: "将删除镜头计划、候选和采用记录。已经放入画布的节点、候选副本和生成文件会保留。", okText: "删除镜头计划", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => edit((value) => ({ ...value, shots: value.shots.filter((item) => item.id !== shot.id), episodes: value.episodes.map((episode) => episode.delivery ? { ...episode, delivery: { ...episode.delivery, audioTracks: episode.delivery.audioTracks.map((track) => track.shotId === shot.id ? { ...track, shotId: "" } : track), subtitles: episode.delivery.subtitles.map((subtitle) => subtitle.shotId === shot.id ? { ...subtitle, shotId: "" } : subtitle) } } : episode) })) });
    const openShot = (shot: ProductionShot) => {
        const canvas = plan.canvases.find((item) => item.id === shot.canvasId);
        const intact = canvas && [shot.textNodeId, shot.imageNodeId, shot.videoNodeId].every((nodeId) => nodeId && canvas.nodes.some((node) => node.id === nodeId));
        if (intact) {
            void plan.placeShot(shot.id, shot.canvasId).then((result) => { if (result && plan.isCurrent()) router.push(`/canvas/${result.canvasId}?focusNodeId=${encodeURIComponent(result.nodeId)}`); });
            return;
        }
        setPlace({ shot, canvasId: canvas?.id || plan.canvases[0]?.id || "", rebuild: Boolean(shot.canvasId || shot.textNodeId || shot.imageNodeId || shot.videoNodeId) });
    };
    const previewShotSync = (shot: ProductionShot) => {
        if (!doc) return;
        const node = plan.canvases.find((canvas) => canvas.id === shot.canvasId)?.nodes.find((item) => item.id === shot.textNodeId);
        if (!node) { void message.warning("镜头说明节点不存在，请先重新建立镜头节点"); return; }
        const previous = node.metadata?.content || "", replacement = productionShotText(doc, shot);
        if (previous === replacement) { void message.info("镜头说明已是最新内容"); return; }
        modal.confirm({ title: `同步「${shot.title}」的说明？`, width: 820, okText: "保存计划并同步说明", cancelText: "保留画布编辑", content: <div className="space-y-3"><p>将更新说明文字。生成节点的提示词、图片和视频保留。</p><div className="grid gap-4 sm:grid-cols-2">{[["画布当前说明", previous], ["计划中的新说明", replacement]].map(([label, value]) => <section key={label}><h3 className="mb-2 text-sm font-medium">{label}</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs leading-6">{value}</pre></section>)}</div></div>, onOk: async () => { if (!await plan.syncShotText(shot.id, previous, replacement)) throw new Error("同步未完成，请检查页面提示"); } });
    };
    const unlinkShot = (shot: ProductionShot) => modal.confirm({ title: `解除「${shot.title}」的画布绑定？`, content: "解除说明、分镜图和视频节点的绑定。画布内容与候选采用记录保留；保存计划后才能删除这些节点。候选和资产引用需要分别解除。", okText: "解除绑定", cancelText: "保留绑定", onOk: () => edit((value) => ({ ...value, shots: value.shots.map((item) => item.id === shot.id ? { ...item, canvasId: "", textNodeId: "", imageNodeId: "", videoNodeId: "" } : item) })) });
    const exportPlan = (format: "md" | "json") => {
        if (!doc) return;
        const content = format === "json" ? JSON.stringify(doc, null, 2) : productionChecklist(doc);
        const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" }));
        const anchor = window.document.createElement("a");
        anchor.href = url; anchor.download = `${doc.title.replace(/[\\/:*?"<>|]/g, "_")}-${format === "json" ? "完整计划" : "制作清单"}.${format}`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (format === "json") void message.info("JSON仅备份制作计划字段和关联标识，不含画布与媒体，不能单独导入。需要恢复整个项目，请选择「完整项目包 ZIP」。");
    };

    return <main className="h-full overflow-y-auto bg-background text-foreground">
        <div className="mx-auto max-w-[1480px] px-5 py-7 sm:px-8 lg:px-10">
            <Link href={`/canvas/project/${id}`} className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />返回项目画布</Link>
            <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-6">
                <div><p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><Clapperboard className="size-4" />短剧制作计划</p><h1 className="text-2xl font-semibold tracking-tight">{doc?.title || plan.root?.workspaceTitle || plan.root?.title || "项目制作"}</h1><p className="mt-2 text-sm text-muted-foreground">把剧本、资产和镜头组织起来，再进入画布逐镜创作。</p></div>
                {doc && <div className="flex flex-wrap items-center gap-2"><span className="mr-2 text-xs text-muted-foreground" role="status">{busy ? "正在保存…" : plan.dirty ? "有未保存修改 · 本机草稿" : `账号版本 ${doc.revision}`}</span><Dropdown trigger={["click"]} menu={{ items: [{ key: "zip", label: "完整项目包 ZIP（画布、计划与素材）", disabled: busy || !plan.root, onClick: () => void exportProjects(plan.canvases, `${doc.title}-完整项目`, doc) }, { type: "divider" }, { key: "md", label: "制作清单 Markdown", onClick: () => exportPlan("md") }, { key: "json", label: "计划字段 JSON（不含画布与媒体）", onClick: () => exportPlan("json") }] }}><Button icon={<Download className="size-4" />}>导出与备份</Button></Dropdown><Button type="primary" loading={busy} icon={<Save className="size-4" />} onClick={() => void plan.save()}>保存计划</Button></div>}
            </header>
            {plan.error && <Alert className="mt-5" type="error" showIcon title={plan.error} description="编辑内容会保留在本机；请排除问题后重试。账号版本冲突时可先导出完整项目 ZIP 备份，再重新读取账号版本。" action={<Button size="small" disabled={busy} onClick={() => { if (plan.dirty) modal.confirm({ title: "重新读取账号版本？", content: "将放弃当前本机未保存的修改，建议先导出完整项目 ZIP 备份。读取失败时不会删除草稿。", okText: "读取账号版本", cancelText: "保留本机草稿", onOk: () => plan.discardDraft() }); else plan.retry(); }}>重新读取</Button>} />}
            {plan.notice && <p className="mt-4 flex items-start gap-2 text-xs leading-6 text-muted-foreground" role="status"><Check className="mt-1 size-3.5 shrink-0" />{plan.notice}</p>}
            {plan.loading ? <div className="py-24 text-center text-sm text-muted-foreground">正在读取制作计划…</div> : !plan.root ? <div className="py-24 text-center text-sm text-muted-foreground">项目不存在或账号画布尚未载入，请返回项目列表。</div> : !doc ? <div className="mx-auto flex max-w-xl flex-col items-center py-24 text-center"><Clapperboard className="mb-6 size-9 text-muted-foreground" /><h2 className="text-xl font-medium">从第一集开始</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">先整理剧本与角色设定，再拆成镜头。每个镜头可以放入画布，建立说明、分镜图和视频节点。</p><p className="mt-4 rounded-xl bg-muted/50 px-5 py-3 text-xs leading-6 text-muted-foreground">启用后，制作计划与关联画布保存到账号。创建计划和节点不会触发生成或扣费。</p><Button type="primary" className="mt-6" loading={busy} disabled={Boolean(plan.error)} icon={<Plus className="size-4" />} onClick={() => void plan.create()}>启用制作计划</Button></div> : <ConfigProvider componentDisabled={busy}>
                <div className="my-6 grid grid-cols-3 divide-x divide-border border-b border-border pb-6"><div><p className="text-2xl font-semibold tabular-nums">{doc.episodes.length.toString().padStart(2, "0")}</p><p className="mt-1 text-xs text-muted-foreground">分集剧本</p></div><div className="pl-6"><p className="text-2xl font-semibold tabular-nums">{doc.assets.length.toString().padStart(2, "0")}</p><p className="mt-1 text-xs text-muted-foreground">项目资产</p></div><div className="pl-6"><p className="text-2xl font-semibold tabular-nums">{doc.shots.filter((shot) => shot.status === "ready").length}<span className="ml-2 text-sm font-normal text-muted-foreground">/ {doc.shots.length}</span></p><p className="mt-1 text-xs text-muted-foreground">已规划镜头</p></div></div>
                <Tabs activeKey={tab} onChange={setTab} items={[
                    { key: "script", label: <span className="flex items-center gap-2"><FileText className="size-4" />剧本与场次</span> },
                    { key: "assets", label: <span className="flex items-center gap-2"><Layers3 className="size-4" />项目资产</span> },
                    { key: "shots", label: <span className="flex items-center gap-2"><LayoutGrid className="size-4" />镜头清单</span> },
                    { key: "tasks", label: <span className="flex items-center gap-2"><ListChecks className="size-4" />镜头任务</span> },
                    { key: "delivery", label: <span className="flex items-center gap-2"><Film className="size-4" />分集交付</span> },
                ]} />
                {tab !== "assets" && <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Select aria-label="选择分集" className="min-w-48" value={episode?.id} placeholder="先添加第一集" options={episodes.map((item) => ({ value: item.id, label: item.title }))} onChange={setEpisodeId} /><Button icon={<Plus className="size-4" />} disabled={episodes.length >= 100} onClick={addEpisode}>添加分集</Button>{episode && <Dropdown trigger={["click"]} menu={{ items: [{ key: "copy", label: "复制本集剧本与镜头设定", icon: <Copy className="size-3.5" />, onClick: () => openBatch("episode") }, { key: "up", label: "分集前移", disabled: episodes[0]?.id === episode.id, onClick: () => edit((value) => reorderProductionEpisode(value, episode.id, -1)) }, { key: "down", label: "分集后移", disabled: episodes.at(-1)?.id === episode.id, onClick: () => edit((value) => reorderProductionEpisode(value, episode.id, 1)) }] }}><Button>整理分集</Button></Dropdown>}{tab === "script" && <Button icon={<Upload className="size-4" />} onClick={() => setScriptImport(true)}>导入剧本</Button>}</div>{episode && <span className="text-xs text-muted-foreground">{scenes.length} 个场次 · {shots.length} 个镜头 · 计划 {Number(shots.reduce((sum, shot) => sum + shot.seconds, 0).toFixed(1))} 秒</span>}</div>}
                {tab === "script" && <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <section>{episode ? <><div className="mb-4 flex items-center gap-2"><Input aria-label="分集名称" variant="borderless" className="min-w-0 flex-1 !px-0 !text-lg !font-semibold" maxLength={100} value={episode.title} onChange={(event) => edit((value) => ({ ...value, episodes: value.episodes.map((item) => item.id === episode.id ? { ...item, title: event.target.value } : item) }))} /><Button type="text" danger icon={<Trash2 className="size-4" />} aria-label="删除当前分集" onClick={deleteEpisode} /></div><Input.TextArea aria-label="本集剧本" className="!p-5 !leading-8" autoSize={{ minRows: 18, maxRows: 36 }} maxLength={100000} value={episode.script} placeholder="粘贴或写下本集剧本。保留人物、对白和场景信息，再按右侧场次和镜头清单逐步整理。" onChange={(event) => edit((value) => ({ ...value, episodes: value.episodes.map((item) => item.id === episode.id ? { ...item, script: event.target.value } : item) }))} /><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-6 text-muted-foreground">AI 拆镜会生成可编辑草案，由你选择后追加，已有镜头保留。</p><Button icon={<Sparkles className="size-4" />} disabled={!episode.script.trim()} onClick={() => setBreakdownEpisodeId(episode.id)}>AI 辅助拆镜</Button></div></> : <div className="rounded-2xl border border-dashed border-border px-6 py-20 text-center"><FileText className="mx-auto mb-4 size-7 text-muted-foreground" /><h3 className="font-medium">先建立一集剧本</h3><p className="mt-2 text-sm text-muted-foreground">从一集开始，把故事整理为可制作的镜头。</p><Button className="mt-5" onClick={addEpisode}>添加第一集</Button></div>}</section>
                    <aside className="space-y-6"><section className="space-y-4 rounded-xl bg-muted/40 p-5"><h2 className="text-sm font-semibold">项目基调</h2><label className="block text-xs font-medium">故事概述<Input.TextArea className="mt-2" rows={3} maxLength={20000} value={doc.synopsis} placeholder="核心人物、冲突与故事方向" onChange={(event) => edit((value) => ({ ...value, synopsis: event.target.value }))} /></label><label className="block text-xs font-medium">视觉风格<Input.TextArea className="mt-2" rows={3} maxLength={20000} value={doc.styleGuide} placeholder="时代、色调、摄影质感与统一要求" onChange={(event) => edit((value) => ({ ...value, styleGuide: event.target.value }))} /></label></section>
                        {episode && <section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">本集场次</h2><Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => edit((value) => ({ ...value, scenes: [...value.scenes, { id: nanoid(), episodeId: episode.id, title: `场次 ${scenes.length + 1}`, description: "", order: Math.max(-1, ...scenes.map((item) => item.order)) + 1 }] }))}>添加</Button></div><div className="space-y-3">{scenes.map((scene) => <div key={scene.id} className="rounded-xl border border-border p-3"><div className="mb-2 flex items-center gap-2"><Input aria-label="场次名称" variant="borderless" className="!px-0 !text-sm !font-medium" maxLength={100} value={scene.title} onChange={(event) => edit((value) => ({ ...value, scenes: value.scenes.map((item) => item.id === scene.id ? { ...item, title: event.target.value } : item) }))} /><Button type="text" size="small" aria-label={`删除场次${scene.title}`} icon={<Trash2 className="size-3.5" />} onClick={() => deleteScene(scene.id)} /></div><Input.TextArea aria-label={`${scene.title}说明`} rows={2} maxLength={20000} value={scene.description} placeholder="地点、内外景、日夜与事件" onChange={(event) => edit((value) => ({ ...value, scenes: value.scenes.map((item) => item.id === scene.id ? { ...item, description: event.target.value } : item) }))} /></div>)}</div>{!scenes.length && <p className="rounded-xl border border-dashed border-border p-5 text-xs leading-6 text-muted-foreground">按地点与事件建立场次，在镜头清单中关联使用。</p>}</section>}
                    </aside>
                </div>}
                {tab === "assets" && <section><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Select aria-label="资产类型筛选" className="min-w-40" value={assetKind} options={[{ value: "all", label: "全部项目资产" }, ...Object.entries(productionAssetLabels).map(([value, label]) => ({ value, label }))]} onChange={setAssetKind} /><Button type="primary" icon={<Plus className="size-4" />} onClick={() => setAssetEditor({ id: nanoid(), kind: assetKind === "all" ? "character" : assetKind, title: "", description: "", variantOf: "", references: [] })}>新建资产设定</Button></div><p className="mb-5 text-xs leading-6 text-muted-foreground">资产设定供各集共用。关联角色、场景和声音后，镜头能带上相同的创作要求。</p><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{doc.assets.filter((asset) => assetKind === "all" || asset.kind === assetKind).map((asset) => {
                    const base = doc.assets.find((item) => item.id === asset.variantOf);
                    const ref = asset.references.flatMap((item) => plan.canvases.find((canvas) => canvas.id === item.canvasId)?.nodes.filter((node) => node.id === item.nodeId && (node.type === "image" || node.type === "panorama") && (node.metadata?.content || node.metadata?.storageKey)) || [])[0];
                    return <article key={asset.id} className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex h-32 items-center justify-center overflow-hidden bg-muted/50">{ref ? <ProductionReferencePreview node={ref} /> : <div className="text-center"><Layers3 className="mx-auto size-6 text-muted-foreground" /><span className="mt-2 block text-xs text-muted-foreground">{productionAssetLabels[asset.kind]}设定</span></div>}</div><div className="p-5"><p className="mb-2 text-xs text-muted-foreground">{productionAssetLabels[asset.kind]}{base ? ` · ${base.title}的变体` : " · 基础设定"}</p><h3 className="truncate font-semibold">{asset.title}</h3><p className="mt-2 min-h-10 line-clamp-2 text-xs leading-5 text-muted-foreground">{asset.description || "还没有填写设定"}</p><p className="mt-3 text-xs text-muted-foreground">{asset.references.length} 个参考 · {doc.shots.filter((shot) => shot.assetIds.includes(asset.id)).length} 个关联镜头</p><div className="mt-4 flex flex-wrap gap-1"><Button size="small" type="text" icon={<Pencil className="size-3.5" />} onClick={() => setAssetEditor(asset)}>编辑</Button><Button size="small" type="text" onClick={() => setAssetEditor({ ...asset, id: nanoid(), title: `${asset.title} · 新变体`, variantOf: asset.variantOf || asset.id, references: [...asset.references] })}>添加变体</Button><Button size="small" type="text" danger aria-label={`删除${asset.title}`} icon={<Trash2 className="size-3.5" />} onClick={() => deleteAsset(asset)} /></div></div></article>;
                })}</div>{!doc.assets.length && <div className="rounded-2xl border border-dashed border-border p-12 text-center"><Layers3 className="mx-auto mb-4 size-8 text-muted-foreground" /><h3 className="font-medium">给故事建立共同的参考</h3><p className="mt-2 text-sm text-muted-foreground">先建立主角设定，再添加场景、道具、声音与风格。</p></div>}</section>}
                {tab === "shots" && <section>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-6 text-muted-foreground">先整理镜头，再放入画布。生成后将结果保存为候选，再选择采用的图片和视频。</p><div className="flex flex-wrap items-center gap-2"><Button disabled={!episode?.script.trim()} icon={<Sparkles className="size-4" />} onClick={() => episode && setBreakdownEpisodeId(episode.id)}>AI 辅助拆镜</Button><Button type="primary" disabled={!episode} icon={<Plus className="size-4" />} onClick={newShot}>添加镜头</Button></div></div>
                    <div className="mb-4 flex flex-wrap gap-2"><Input aria-label="搜索镜头" prefix={<Search className="size-3.5" />} className="!w-full sm:!w-64" placeholder="搜索画面、对白、角色…" allowClear value={shotQuery} onChange={(event) => { setShotQuery(event.target.value); setSelection([]); }} /><Select aria-label="按场次筛选镜头" className="min-w-36" value={sceneFilter} options={[{ value: "all", label: "全部场次" }, { value: "", label: "未分场" }, ...scenes.map((scene) => ({ value: scene.id, label: scene.title }))]} onChange={(value) => { setSceneFilter(value); setSelection([]); }} /><Select aria-label="按计划状态筛选镜头" className="min-w-36" value={statusFilter} options={[{ value: "all", label: "全部计划状态" }, { value: "draft", label: "草稿" }, { value: "ready", label: "已规划" }, { value: "unbound", label: "尚未放入画布" }]} onChange={(value) => { setStatusFilter(value); setSelection([]); }} /><span className="self-center text-xs text-muted-foreground">显示 {visibleShots.length} / {shots.length} 镜头</span></div>
                    {selectedShots.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 border-y border-border py-3"><span className="mr-auto text-xs font-medium">已选 {selectedShots.length} 个镜头</span><Button size="small" disabled={selectedShots.length > 50} icon={<LayoutGrid className="size-3.5" />} onClick={() => openBatch("place")}>批量放入画布</Button><Button size="small" icon={<Copy className="size-3.5" />} onClick={() => openBatch("copy")}>复制镜头</Button><Button size="small" disabled={episodes.length < 2} onClick={() => openBatch("move")}>移到其他分集</Button><Button type="text" size="small" aria-label="取消镜头多选" icon={<X className="size-3.5" />} onClick={() => setSelection([])} />{selectedShots.length > 50 && <p className="w-full text-xs text-muted-foreground">批量建立每次最多 50 个镜头，请减少选择；复制、跨集移动可处理当前选择。</p>}</div>}
                    {visibleShots.length ? <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[1080px] text-left text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="w-10 pl-4 py-3"><Checkbox aria-label="选择全部筛选镜头" checked={Boolean(visibleShots.length) && selectedShots.length === visibleShots.length} indeterminate={selectedShots.length > 0 && selectedShots.length < visibleShots.length} onChange={(event) => setSelection(event.target.checked ? visibleShots.map((shot) => shot.id) : [])} /></th><th className="w-20 px-4 py-3 font-medium">镜号</th><th className="px-4 py-3 font-medium">镜头与场次</th><th className="px-4 py-3 font-medium">画面／对白</th><th className="px-4 py-3 font-medium">计划</th><th className="px-4 py-3 font-medium">资产</th><th className="px-4 py-3 font-medium">制作状态</th><th className="px-4 py-3 font-medium">操作</th></tr></thead>
                        <tbody>{visibleShots.map((shot) => {
                            const index = shots.findIndex((item) => item.id === shot.id);
                            const state = getProductionShotState(shot, plan.canvases);
                            return <tr key={shot.id} className="border-t border-border align-top">
                                <td className="pl-4 py-4"><Checkbox aria-label={`选择镜头${shot.title}`} checked={selection.includes(shot.id)} onChange={(event) => setSelection((ids) => event.target.checked ? [...ids, shot.id] : ids.filter((id) => id !== shot.id))} /></td>
                                <td className="px-4 py-4"><span className="font-mono text-base">{String(index + 1).padStart(2, "0")}</span><div className="mt-2 flex"><Button size="small" type="text" disabled={index === 0} aria-label={`上移${shot.title}`} icon={<ArrowUp className="size-3" />} onClick={() => moveShot(shot, -1)} /><Button size="small" type="text" disabled={index === shots.length - 1} aria-label={`下移${shot.title}`} icon={<ArrowDown className="size-3" />} onClick={() => moveShot(shot, 1)} /></div></td>
                                <td className="max-w-52 px-4 py-4"><button className="text-left font-medium hover:underline" disabled={busy} onClick={() => setShotEditor(shot)}>{shot.title}</button><p className="mt-2 text-xs text-muted-foreground">{doc.scenes.find((scene) => scene.id === shot.sceneId)?.title || "未分场"}</p><span className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs">{shot.status === "ready" ? "已规划" : "草稿"}</span></td>
                                <td className="max-w-80 px-4 py-4"><p className="line-clamp-3 whitespace-pre-wrap text-xs leading-6">{shot.description || "待补充镜头画面"}</p>{shot.dialogue && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">对白：{shot.dialogue}</p>}</td>
                                <td className="max-w-40 px-4 py-4"><p className="text-xs">{shot.seconds} 秒</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{shot.camera || "运镜待定"}</p></td>
                                <td className="max-w-44 px-4 py-4"><div className="flex flex-wrap gap-1">{shot.assetIds.map((assetId) => <span key={assetId} className="rounded bg-muted px-2 py-1 text-xs">{doc.assets.find((asset) => asset.id === assetId)?.title || "失效资产"}</span>)}</div></td>
                                <td className="max-w-48 px-4 py-4"><p className="text-xs font-medium">{state.label}</p><p className="mt-2 text-xs text-muted-foreground">{shot.candidates.length} 个候选</p>{state.hasInvalidSelection ? <p className="mt-2 text-xs leading-5 text-destructive">采用结果已失效，请重新选择</p> : state.invalidCandidateCount > 0 && <p className="mt-2 text-xs leading-5 text-destructive">{state.invalidCandidateCount} 个候选需检查</p>}</td>
                                <td className="px-4 py-4"><div className="flex flex-col items-start gap-2"><Button size="small" icon={<LayoutGrid className="size-3.5" />} onClick={() => openShot(shot)}>{shot.canvasId ? "定位画布" : "放入画布"}</Button><Button size="small" icon={<Images className="size-3.5" />} onClick={() => setCandidateShotId(shot.id)}>候选与采用</Button>{shot.canvasId && <Dropdown trigger={["click"]} menu={{ items: [{ key: "sync", label: "预览并同步镜头说明", onClick: () => previewShotSync(shot) }, { key: "unlink", label: "解除画布绑定", onClick: () => unlinkShot(shot) }] }}><Button size="small" type="text">同步与关联</Button></Dropdown>}<div className="flex"><Button size="small" type="text" onClick={() => setShotEditor(shot)}>编辑</Button><Button size="small" type="text" aria-label={`复制${shot.title}`} icon={<Copy className="size-3.5" />} onClick={() => openBatch("copy", [shot.id])} /><Button size="small" type="text" danger aria-label={`删除${shot.title}`} icon={<Trash2 className="size-3.5" />} onClick={() => deleteShot(shot)} /></div></div></td>
                            </tr>;
                        })}</tbody>
                    </table></div> : shots.length ? <div className="rounded-xl border border-dashed border-border py-14 text-center"><Search className="mx-auto mb-3 size-6 text-muted-foreground" /><p className="text-sm">没有匹配镜头</p><Button className="mt-4" onClick={() => { setShotQuery(""); setSceneFilter("all"); setStatusFilter("all"); }}>清除筛选</Button></div> : <div className="rounded-2xl border border-dashed border-border p-16 text-center"><LayoutGrid className="mx-auto mb-4 size-8 text-muted-foreground" /><h3 className="font-medium">把一集故事，拆成可制作的镜头</h3><p className="mt-2 text-sm text-muted-foreground">每个镜头记录画面、对白、运镜、时长与引用资产。</p>{episode && <Button className="mt-5" onClick={newShot}>添加第一个镜头</Button>}</div>}
                </section>}
                {tab === "tasks" && <ProductionTasks key={episode?.id || "empty"} workspaceId={id} episodeId={episode?.id || ""} shots={shots} dirty={plan.dirty} />}
                {tab === "delivery" && episode && <ProductionDelivery document={doc} episodeId={episode.id} dirty={plan.dirty} onEdit={plan.edit} />}
            </ConfigProvider>}
            {doc && <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5"><p className="text-xs text-muted-foreground">计划与画布分别管理，删除计划不会删除创作文件。</p><Button type="text" danger size="small" disabled={busy} onClick={() => modal.confirm({ title: "删除整个制作计划？", content: `将删除“${doc.title}”的分集剧本、场次、资产设定、镜头编排及候选采用记录${plan.dirty ? "，包括本机未保存修改" : ""}。原画布节点、素材文件和生成结果保留。此操作无法撤销，建议先导出完整项目 ZIP 备份。`, okText: "删除制作计划", cancelText: "保留计划", okButtonProps: { danger: true }, onOk: async () => { if (await plan.remove() && plan.isCurrent()) router.push(`/canvas/project/${id}`); } })}>删除制作计划</Button></footer>}
        </div>
        {assetEditor && doc && <ProductionAssetEditor key={assetEditor.id} asset={assetEditor} document={doc} canvases={plan.canvases} busy={busy} saveError={plan.error} onSave={plan.commitAsset} onImport={plan.importAssetReference} onClose={() => setAssetEditor(null)} />}
        {shotEditor && doc && <ProductionShotEditor key={shotEditor.id} shot={shotEditor} document={doc} onSave={(shot) => edit((value) => ({ ...value, shots: value.shots.some((item) => item.id === shot.id) ? value.shots.map((item) => item.id === shot.id ? shot : item) : [...value.shots, shot] }))} onClose={() => setShotEditor(null)} />}
        {candidateShot && <ProductionCandidatesDialog key={candidateShot.id} shot={candidateShot} workspaceId={id} busy={busy} error={plan.error} onAdd={(canvasId, nodeId) => plan.addCandidate(candidateShot.id, canvasId, nodeId)} onEdit={(update) => edit((value) => ({ ...value, shots: value.shots.map((item) => item.id === candidateShot.id ? update(item) : item) }))} onClose={() => setCandidateShotId("")} />}
        {scriptImport && doc && <ProductionScriptImport document={doc} episodeId={episode?.id || ""} error={plan.error} onClose={() => setScriptImport(false)} onApply={(update) => {
            let target = "";
            const applied = edit((value) => { const result = update(value); target = result.episodeId; return result.document; });
            if (applied) navigate({ tab: "script", episode: target });
            return applied;
        }} />}
        {doc && breakdownEpisodeId && <ProductionBreakdownDialog key={`${doc.id}:${breakdownEpisodeId}`} document={doc} episodeId={breakdownEpisodeId} disabled={busy} onApply={async (draft) => { const applied = await plan.applyBreakdown(draft); if (applied) navigate({ episode: draft.episodeId, tab: "shots" }); return Boolean(applied); }} onClose={() => setBreakdownEpisodeId("")} />}
        <Modal open={Boolean(batch)} title={batch?.mode === "place" ? "批量建立镜头节点" : batch?.mode === "episode" ? "复制分集设定" : batch?.mode === "move" ? "镜头跨集移动" : "复制镜头设定"} confirmLoading={busy} mask={{ closable: false }} closable={!busy} onCancel={() => !busy && setBatch(null)} okText={batch?.mode === "place" ? "确认建立并保存" : "确认加入草稿"} cancelText="取消" cancelButtonProps={{ disabled: busy }} okButtonProps={{ disabled: batch?.mode === "place" ? !batch.canvasId : batch?.mode !== "episode" && !batch?.targetEpisodeId }} onOk={() => void applyBatch()}>
            {batch && <div className="space-y-4 py-3">{plan.error && <Alert type="error" showIcon title={plan.error} />}{batch.mode === "place" ? <><p className="text-sm leading-7">为所选 {batch.ids.length} 个镜头建立说明、分镜图、视频节点及参考连线；已有完整绑定将直接复用，节点缺失时会停止并提示单独修复。</p><Select aria-label="批量镜头目标画布" className="w-full" disabled={busy} value={batch.canvasId} options={plan.canvases.map((canvas) => ({ value: canvas.id, label: canvas.title }))} onChange={(canvasId) => setBatch({ ...batch, canvasId })} /><Alert type="info" showIcon title="此操作保存当前制作计划及画布，不发起生成或扣费。" description="按镜头逐项建立并保存，发生异常停止后续；已完成项保留，重新提交会复用它们。" />{plan.notice && <p role="status" className="text-xs leading-6 text-muted-foreground">{plan.notice}</p>}</> : <>
                <p className="text-sm leading-7">{batch.mode === "episode" ? "复制本集剧本、场次和镜头文字设定，作为紧邻原集的新分集。" : batch.mode === "move" ? `将 ${batch.ids.length} 个镜头移到目标分集末尾，保留画布绑定和候选；原场次关联清空。` : `复制 ${batch.ids.length} 个镜头到目标分集末尾，新副本可单独调整。`}</p>
                {batch.mode !== "episode" && <label className="block space-y-2 text-xs"><span>目标分集</span><Select aria-label="镜头目标分集" className="w-full" value={batch.targetEpisodeId || undefined} options={episodes.filter((item) => batch.mode !== "move" || item.id !== batch.sourceEpisodeId).map((item) => ({ value: item.id, label: item.title }))} onChange={(targetEpisodeId) => setBatch({ ...batch, targetEpisodeId })} /></label>}
                {batch.mode !== "move" ? <><Checkbox checked={batch.keepAssets} onChange={(event) => setBatch({ ...batch, keepAssets: event.target.checked })}>保留镜头关联的角色、场景等资产设定</Checkbox><p className="text-xs leading-6 text-muted-foreground">副本使用全新标识，清空画布绑定、候选、采用结果与制作状态；不复制素材文件、生成任务或交付音轨和字幕。项目资产本身仍由各集共用。</p></> : <Alert type="warning" showIcon title="已关联原集音轨或字幕的镜头需先解除交付关联。" description="已有生成历史与成本继续保留在任务发起时的原集，移动不会重分配旧账；保存计划之后的新任务才关联目标分集。" />}
                <p className="text-xs text-muted-foreground">确认后更新本机草稿，请核对后点击“保存计划”。</p>
            </>}</div>}
        </Modal>
        <Modal open={Boolean(place)} title={place?.rebuild ? "重新建立镜头节点" : "把镜头放入画布"} onCancel={() => !busy && setPlace(null)} confirmLoading={busy} okText={place?.rebuild ? "确认重新建立" : "建立节点并进入画布"} cancelText="取消" cancelButtonProps={{ disabled: busy }} okButtonProps={{ disabled: !place?.canvasId }} onOk={() => { if (place) void plan.placeShot(place.shot.id, place.canvasId, place.rebuild).then((result) => { if (result && plan.isCurrent()) { setPlace(null); router.push(`/canvas/${result.canvasId}?focusNodeId=${encodeURIComponent(result.nodeId)}`); } }); }}>
            <div className="space-y-4 py-3">{plan.error && <Alert type="error" title={plan.error} />}{place?.rebuild && <Alert type="warning" title="原绑定节点已缺失" description="将新建一组镜头节点并更新绑定。残留节点和文件会保留，请自行整理。" />}<p className="text-sm leading-7">为“{place?.shot.title}”建立镜头说明、空分镜图和空视频节点，并连接创作顺序。</p><Select className="w-full" aria-label="选择目标画布" disabled={busy} value={place?.canvasId} options={plan.canvases.map((canvas) => ({ value: canvas.id, label: canvas.title }))} onChange={(canvasId) => setPlace((value) => value ? { ...value, canvasId } : value)} /><p className="text-xs leading-6 text-muted-foreground">制作计划与关联画布保存到账号。此操作保存当前计划，不触发生成或扣费。项目资产的参考会自动连线；跨画布仅复制节点引用，不复制文件。参考节点过多需在画布调整后生成。</p></div>
        </Modal>
    </main>;
}
