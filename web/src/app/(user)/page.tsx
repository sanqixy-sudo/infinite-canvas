"use client";

import { ArrowRight, ArrowUpRight, FolderOpen, Layers3, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { App, Image } from "antd";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { uploadAssetMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { AssetPickerModal } from "./canvas/components/asset-picker-modal";
import { WorkspaceShell } from "./canvas/components/workspace-shell";
import { CanvasAssistantComposer } from "./canvas/components/canvas-assistant-composer";
import { useCanvasStore, workspaceCanvases, workspaceRoot } from "./canvas/stores/use-canvas-store";
import { canvasResourceLabel } from "./canvas/utils/canvas-resource-references";
import {
    MAX_CANVAS_AGENT_SKILLS,
    CanvasNodeType,
    type CanvasAgentConfig,
    type CanvasAgentSkillSelection,
    type CanvasAssistantReference,
    type InsertAssetPayload,
    type PendingAgentAsset,
} from "./canvas/types";


function toPendingAgentAsset(payload: InsertAssetPayload, label: string): PendingAgentAsset {
    const nodeId = nanoid();
    let reference: CanvasAssistantReference;
    if (payload.kind === "text") {
        reference = { id: nodeId, type: CanvasNodeType.Text, title: payload.title, label, text: payload.content };
    } else {
        const common = { id: nodeId, title: payload.title, label, storageKey: payload.storageKey, mimeType: payload.mimeType };
        if (payload.kind === "image") reference = { ...common, type: CanvasNodeType.Image, dataUrl: payload.dataUrl };
        else if (payload.kind === "video") reference = { ...common, type: CanvasNodeType.Video, url: payload.url };
        else reference = { ...common, type: CanvasNodeType.Audio, url: payload.url };
    }
    return { nodeId, payload, reference };
}

export default function IndexPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const effectiveConfig = useEffectiveConfig();
    const createProject = useCanvasStore((state) => state.createProject);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [pendingAssets, setPendingAssets] = useState<PendingAgentAsset[]>([]);
    const [selectedSkills, setSelectedSkills] = useState<CanvasAgentSkillSelection[]>([]);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [agentConfig, setAgentConfig] = useState<CanvasAgentConfig>(() => ({
        textApiMode: "chat",
        autoGenerateMedia: false,
        imageQuality: effectiveConfig.quality,
        imageSize: effectiveConfig.size,
        videoQuality: effectiveConfig.vquality,
        videoSize: effectiveConfig.videoSize,
    }));
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const pendingAssetCountsRef = useRef<Record<InsertAssetPayload["kind"], number>>({ text: 0, image: 0, video: 0, audio: 0 });

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, [message]);

    const addPendingAsset = (payload: InsertAssetPayload) => {
        const asset = toPendingAgentAsset(payload, canvasResourceLabel(payload.kind, pendingAssetCountsRef.current[payload.kind]++));
        setPendingAssets((current) => [...current, asset]);
        setPrompt((current) => `${current}${current.endsWith(" ") ? "" : " "}${asset.reference.label} `);
    };

    const uploadFile = async (file: File) => {
        try {
            if (file.type.startsWith("image/")) {
                const uploaded = await uploadImage(file);
                addPendingAsset({ kind: "image", dataUrl: uploaded.url, title: file.name, ...uploaded });
            } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
                const uploaded = await uploadAssetMediaFile(file);
                if (file.type.startsWith("video/")) addPendingAsset({ kind: "video", title: file.name, ...uploaded });
                else addPendingAsset({ kind: "audio", title: file.name, ...uploaded });
            } else {
                throw new Error("仅支持图片、视频和音频文件");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
        }
    };

    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadFile(file);
    };

    const submit = (nextPrompt = prompt, referenceIds = pendingAssets.map((asset) => asset.nodeId)) => {
        const text = nextPrompt.trim();
        if (!text || submitting) return;
        if (!hydrated) {
            message.info("画布数据正在加载，请稍后再试");
            return;
        }
        setSubmitting(true);
        const projectId = createProject("画布 1", {
            workspaceTitle: text.length > 22 ? `${text.slice(0, 22)}…` : text,
            agentConfig,
            pendingAgentRequest: { prompt: text, assets: pendingAssets.filter((asset) => referenceIds.includes(asset.nodeId)), skills: selectedSkills },
        });
        router.push(`/canvas/${projectId}`);
    };

    const createBlankWorkspace = () => {
        if (!hydrated) return;
        const count = projects.filter(workspaceRoot).length;
        const id = createProject("画布 1", { workspaceTitle: `未命名项目 ${count + 1}` });
        router.push(`/canvas/project/${id}`);
    };

    const selectSkill = (skill: CanvasAgentSkillSelection) => {
        const existingIndex = selectedSkills.findIndex((selected) => selected.id === skill.id && selected.source === skill.source);
        if (existingIndex >= 0) return setSelectedSkills(selectedSkills.map((selected, index) => index === existingIndex ? skill : selected));
        if (selectedSkills.length >= MAX_CANVAS_AGENT_SKILLS) return void message.warning(`最多选择 ${MAX_CANVAS_AGENT_SKILLS} 个 Skill`);
        setSelectedSkills([...selectedSkills, skill]);
    };
    const roots = projects.filter(workspaceRoot).sort((a, b) => {
        const latest = (id: string) => Math.max(...workspaceCanvases(projects, id).map((canvas) => Date.parse(canvas.updatedAt) || 0));
        return latest(b.id) - latest(a.id);
    });

    return (
        <WorkspaceShell>
            <main className="mx-auto max-w-[1460px] px-5 pb-20 pt-8 md:px-10 md:pt-12">
                <section className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.7fr)]">
                    <div className="relative flex min-h-[330px] flex-col justify-between overflow-hidden rounded-[28px] border border-border bg-card p-7 md:p-10">
                        <div className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full border-[48px] border-muted opacity-65" />
                        <div className="pointer-events-none absolute bottom-0 right-0 h-28 w-1/2 opacity-45 bg-[linear-gradient(90deg,var(--border)_1px,transparent_1px),linear-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]" />
                        <div className="relative"><p className="mb-5 text-[11px] font-semibold tracking-[0.24em] text-muted-foreground">XIAOMENG / CREATIVE WORKSPACE</p><h1 className="max-w-2xl text-4xl font-semibold leading-[1.12] tracking-[-0.065em] md:text-6xl">小盟万能<br />视频工作台<span className="ml-1 text-muted-foreground">.</span></h1><p className="mt-5 text-sm tracking-[0.07em] text-muted-foreground">Xiaomeng All-in-One Video Workbench</p></div>
                        <p className="relative mt-8 max-w-md text-sm leading-7 text-muted-foreground">从灵感到成片，让一个项目承载完整创作；在多张画布之间，自由展开每一步。</p>
                    </div>
                    <div className="flex min-h-[330px] flex-col rounded-[28px] bg-foreground p-7 text-background md:p-8">
                        <span className="flex size-11 items-center justify-center rounded-xl border border-background/25"><Plus className="size-5" /></span>
                        <div className="mt-auto"><p className="text-[11px] font-semibold tracking-[0.2em] opacity-55">START SOMETHING NEW</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">把新想法，<br />放进新项目。</h2><p className="mt-3 text-sm leading-6 opacity-65">先建立项目，再添加画布。每张画布都可以独立创作与保存。</p><button type="button" disabled={!hydrated} onClick={createBlankWorkspace} className="mt-7 inline-flex h-11 w-full items-center justify-between rounded-lg bg-background px-4 text-sm font-medium text-foreground transition hover:opacity-90 disabled:opacity-50">新建项目 <ArrowUpRight className="size-4" /></button></div>
                    </div>
                </section>

                <section className="mt-12">
                    <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground">PICK UP WHERE YOU LEFT OFF</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">最近项目</h2></div><Link href="/canvas" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">查看全部 <ArrowRight className="size-4" /></Link></div>
                    {!hydrated ? <div className="rounded-2xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">正在读取项目...</div> : roots.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{roots.slice(0, 3).map((root, index) => {
                        const canvases = workspaceCanvases(projects, root.id);
                        return <Link href={`/canvas/project/${root.id}`} key={root.id} className="group flex min-h-[190px] flex-col justify-between rounded-[22px] border border-border bg-card p-6 transition duration-300 hover:-translate-y-1 hover:shadow-lg"><div className="flex items-center justify-between"><span className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground">PROJECT {String(index + 1).padStart(2, "0")}</span><ArrowUpRight className="size-4 text-muted-foreground transition group-hover:text-foreground" /></div><div><span className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted"><Layers3 className="size-4" /></span><h3 className="truncate text-lg font-semibold">{root.workspaceTitle || root.title}</h3><p className="mt-2 text-xs text-muted-foreground">{canvases.length} 张画布 · {canvases.reduce((count, item) => count + item.nodes.length, 0)} 个节点</p></div></Link>;
                    })}</div> : <button type="button" onClick={createBlankWorkspace} className="flex min-h-[180px] w-full flex-col items-center justify-center rounded-[22px] border border-dashed border-border bg-card/70 text-center transition hover:border-foreground"><FolderOpen className="mb-3 size-6 text-muted-foreground" /><span className="text-sm font-medium">还没有项目，创建一个开始吧</span><span className="mt-2 text-xs text-muted-foreground">项目里可以创建多张独立画布</span></button>}
                </section>

                <section className="mt-12 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.7fr)]">
                    <div className="rounded-[24px] border border-border bg-card p-5 md:p-7"><div className="mb-5 flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-muted"><Sparkles className="size-4" /></span><div><p className="text-sm font-semibold">快速创作</p><p className="text-xs text-muted-foreground">描述想法，自动建立项目并打开第一张画布</p></div></div><CanvasAssistantComposer prompt={prompt} isRunning={false} references={pendingAssets.map((asset) => asset.reference)} selectedSkills={selectedSkills} agentConfig={agentConfig} onAgentConfigChange={(patch) => setAgentConfig((current) => ({ ...current, ...patch }))} onPromptChange={setPrompt} onReferenceIdsChange={(ids) => setPendingAssets((current) => current.filter((asset) => ids.includes(asset.nodeId)))} onSkillSelect={selectSkill} onSkillRemove={(id, source) => setSelectedSkills((current) => current.filter((skill) => skill.id !== id || skill.source !== source))} onSubmit={submit} onOpenUpload={() => uploadInputRef.current?.click()} onOpenAssets={() => setAssetPickerOpen(true)} onPasteImage={(file) => void uploadFile(file)} /><input ref={uploadInputRef} hidden type="file" accept="image/*,video/*,audio/*" onChange={onUploadInputChange} /></div>
                    <div className="flex flex-col rounded-[24px] border border-border bg-card p-7"><p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground">YOUR NEXT STEP</p><h2 className="mt-5 text-2xl font-semibold tracking-tight">灵感无需<br />从零开始。</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">提示词与素材，随时可以带进画布；做过的探索，也能在项目中继续。</p><div className="mt-auto grid gap-2 pt-8"><Link href="/prompts" className="flex items-center justify-between border-t border-border py-3 text-sm">探索提示词 <ArrowUpRight className="size-4" /></Link><Link href="/assets" className="flex items-center justify-between border-t border-border py-3 text-sm">打开我的素材 <ArrowUpRight className="size-4" /></Link></div></div>
                </section>

                {promptShowcase.length > 0 && <section className="mt-12"><div className="mb-5 flex items-end justify-between"><div><p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground">PROMPT INSPIRATION</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">创作灵感</h2></div><Link href="/prompts" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">提示词库 <ArrowRight className="size-4" /></Link></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{promptShowcase.slice(0, 3).map((item, index) => <button key={item.id} type="button" onClick={() => { setPreviewIndex(index); setPreviewOpen(true); }} className="group overflow-hidden rounded-[20px] border border-border bg-card text-left"><div className="h-36 overflow-hidden bg-muted"><img src={item.coverUrl} alt={item.title} className="size-full object-cover transition duration-500 group-hover:scale-105" /></div><div className="p-4"><h3 className="truncate text-sm font-semibold">{item.title}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.prompt}</p></div></button>)}</div></section>}
            </main>
            <AssetPickerModal
                open={assetPickerOpen}
                defaultTab="my-assets"
                onInsert={(payload) => {
                    addPendingAsset(payload);
                    setAssetPickerOpen(false);
                }}
                onClose={() => setAssetPickerOpen(false)}
            />
            <Image.PreviewGroup
                items={promptShowcase.map((item) => ({
                    src: item.coverUrl,
                    alt: item.title,
                }))}
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            />
        </WorkspaceShell>
    );
}
