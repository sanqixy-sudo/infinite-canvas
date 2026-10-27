"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Input, Modal, Select } from "antd";
import { ArrowRight, AudioLines, Boxes, Clapperboard, Film, Globe2, Image, Layers3, Plus } from "lucide-react";
import { nanoid } from "nanoid";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useCanvasStore, workspaceRoot } from "../canvas/stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../canvas/types";
import { getNodeSpec } from "../canvas/constants";
import { projectDefaultModelWarnings, resolveProjectDefaultModel } from "../canvas/utils/workspace-settings";

const tools = [
    { id: "image", title: "图像创作", detail: "把文字构想连到图片节点，选择模型和参考图开始出图。", types: [CanvasNodeType.Text, CanvasNodeType.Image], icon: Image, tag: "文字 → 图片" },
    { id: "video", title: "视频分镜", detail: "连接镜头说明、分镜图与视频节点，逐步完善一个镜头。", types: [CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Video], icon: Film, tag: "文字 → 图片 → 视频" },
    { id: "voice", title: "配音与声音", detail: "在音频节点填写台词，选择平台开放的声音模型。", types: [CanvasNodeType.Audio], icon: AudioLines, tag: "台词 → 音频" },
    { id: "director", title: "3D 导演台", detail: "安排角色与机位，调整构图，再把画面送入创作流程。", types: [CanvasNodeType.Director], icon: Clapperboard, tag: "角色 · 机位 · 构图" },
    { id: "panorama", title: "全景创作", detail: "创建全景节点，生成或导入全景图后自由观察取景。", types: [CanvasNodeType.Text, CanvasNodeType.Panorama], icon: Globe2, tag: "全景 · 自由取景" },
    { id: "workflow", title: "模型与工作流", detail: "用生成配置节点选择平台模型或已开放工作流，连接到结果节点。", types: [CanvasNodeType.Config, CanvasNodeType.Image], icon: Boxes, tag: "平台配置 → 结果" },
] as const;
type Tool = typeof tools[number];

export default function ToolsPage() {
    const router = useRouter(), { message } = App.useApp();
    const config = useEffectiveConfig();
    const hydrated = useCanvasStore((state) => state.hydrated), ownerId = useCanvasStore((state) => state.ownerId), projects = useCanvasStore((state) => state.projects);
    const userId = useUserStore((state) => state.user?.id), sessionVersion = useUserStore((state) => state.sessionVersion);
    const roots = hydrated && ownerId === userId ? projects.filter(workspaceRoot) : [];
    const [selected, setSelected] = useState<{ tool: Tool; version: number } | null>(null), [workspaceId, setWorkspaceId] = useState("new"), [title, setTitle] = useState("");
    const creating = useRef(false);
    const begin = () => {
        if (!selected || selected.version !== sessionVersion || creating.current || !hydrated || ownerId !== userId) return;
        creating.current = true;
        try {
            if (workspaceId !== "new" && !roots.some((root) => root.id === workspaceId)) throw new Error("项目已不存在，请重新选择");
            if (workspaceId !== "new" && Object.keys(roots.find((root) => root.id === workspaceId)?.workspaceSettings?.defaultModels || {}).length && (!useConfigStore.getState().publicSettings || useConfigStore.getState().isPublicSettingsLoading)) throw new Error("平台模型配置尚未读取完成，请稍后再创建");
            const { tool } = selected;
            if (workspaceId !== "new") for (const warning of projectDefaultModelWarnings(projects, workspaceId, config)) void message.warning(warning);
            const nodes: CanvasNodeData[] = tool.types.map((type, index) => {
                const spec = getNodeSpec(type);
                const capability = type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : [CanvasNodeType.Image, CanvasNodeType.Panorama, CanvasNodeType.Config].includes(type) ? "image" : undefined;
                const selection = workspaceId !== "new" && capability ? resolveProjectDefaultModel(projects, workspaceId, config, capability) : undefined;
                return { id: nanoid(), type, title: spec.title, width: spec.width, height: spec.height, position: { x: 80 + index * 500, y: 100 }, metadata: { ...spec.metadata, ...selection } };
            });
            const connections = nodes.slice(1).map((node, index) => ({ id: nanoid(), fromNodeId: nodes[index].id, toNodeId: node.id }));
            if (tool.id === "video") connections.push({ id: nanoid(), fromNodeId: nodes[0].id, toNodeId: nodes[2].id });
            const id = useCanvasStore.getState().createProject(tool.title, workspaceId === "new" ? { workspaceTitle: title.trim() || tool.title } : { workspaceId });
            useCanvasStore.getState().updateProject(id, { nodes, connections, viewport: { x: 20, y: 40, k: tool.types.length > 2 ? 0.65 : 0.85 }, autoTitlePending: false });
            setSelected(null); router.push(`/canvas/${id}`);
        } catch (failure) { void message.error(failure instanceof Error ? failure.message : "创建画布失败"); }
        finally { creating.current = false; }
    };
    return <main className="h-full overflow-y-auto"><div className="mx-auto max-w-[1320px] px-5 py-7 sm:px-8 lg:px-10">
        <header><p className="mb-2 text-xs text-muted-foreground">选一个起点，直接进入画布</p><h1 className="text-3xl font-semibold tracking-tight">创作工具</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">为当前项目新建一张带节点和连线的画布。你可以调整参数、添加参考，再明确发起生成。</p></header>
        <section aria-label="画布创作起点" className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tools.map((tool) => <article className="flex flex-col rounded-2xl border border-border bg-card p-6" key={tool.id}><div className="mb-7 flex items-center justify-between"><tool.icon className="size-7 text-foreground" strokeWidth={1.4} /><span className="text-[11px] text-muted-foreground">{tool.tag}</span></div><h2 className="text-lg font-semibold">{tool.title}</h2><p className="mb-7 mt-3 flex-1 text-sm leading-7 text-muted-foreground">{tool.detail}</p><Button block disabled={!hydrated || ownerId !== userId} onClick={() => { setWorkspaceId("new"); setTitle(""); setSelected({ tool, version: sessionVersion }); }}>在画布中使用<ArrowRight className="size-3.5" /></Button></article>)}</section>
        <section className="mt-8 flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-muted/45 p-6"><div><h2 className="flex items-center gap-2 font-medium"><Layers3 className="size-4" />需要做完整短剧？</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">从分集剧本、资产设定、镜头生产一路到配音、字幕和成片。</p></div><Link className="inline-flex items-center gap-2 text-sm font-medium" href="/production">打开短剧制作<ArrowRight className="size-4" /></Link></section>
        <p className="mt-6 text-xs leading-6 text-muted-foreground">创建节点不消耗算力。模型、附件上限和费用以平台当前开放配置为准；3D 构图与素材整理可直接操作。</p>
        <Modal title={`使用${selected?.tool.title || "创作工具"}`} open={selected?.version === sessionVersion} onCancel={() => setSelected(null)} onOk={begin} okText="创建画布并打开" cancelText="取消" okButtonProps={{ disabled: !hydrated || ownerId !== userId }}>
            <p className="mb-4 text-sm leading-6 text-muted-foreground">将在所选项目中新建独立画布，已有节点与连线保留。创建后由你选择模型并确认生成。</p>
            <Select aria-label="创作工具所属项目" className="w-full" value={workspaceId} onChange={setWorkspaceId} options={[{ value: "new", label: "新建项目" }, ...roots.map((root) => ({ value: root.id, label: root.workspaceTitle || root.title }))]} />
            {workspaceId === "new" && <Input aria-label="新项目名称" className="mt-4" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} onPressEnter={begin} placeholder="新项目名称（可选）" />}
        </Modal>
    </div></main>;
}
