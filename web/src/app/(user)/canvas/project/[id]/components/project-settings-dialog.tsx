"use client";

import { useState } from "react";
import { App, Button, Input, Modal, Pagination } from "antd";
import { Check, ImageIcon, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ModelPicker } from "@/components/model-picker";
import { useEffectiveConfig, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasProjectPreview } from "../../../components/canvas-project-preview";
import { useCanvasStore } from "../../../stores/use-canvas-store";
import { normalizeWorkspaceSettings, projectModelLabels, resolveWorkspaceCover, validProjectModel, workspaceCoverCandidates, type WorkspaceSettings } from "../../../utils/workspace-settings";

export function ProjectSettingsDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const projects = useCanvasStore((state) => state.projects);
    const root = projects.find((item) => item.id === workspaceId && !item.workspaceId);
    const [ownerId] = useState(() => useUserStore.getState().user?.id);
    const [draft, setDraft] = useState<WorkspaceSettings>(() => normalizeWorkspaceSettings(root?.workspaceSettings));
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const candidates = workspaceCoverCandidates(projects, workspaceId).filter(({ canvas, node }) => `${canvas.title} ${node.title}`.toLowerCase().includes(search.trim().toLowerCase()));
    const cover = resolveWorkspaceCover(projects, workspaceId, draft.cover);
    const invalidModels = (Object.keys(projectModelLabels) as ModelCapability[]).filter((key) => draft.defaultModels?.[key] && !validProjectModel(config, key, draft.defaultModels[key]));
    const currentPage = Math.min(page, Math.max(1, Math.ceil(candidates.length / 9)));
    const save = () => {
        if (ownerId !== useUserStore.getState().user?.id || !root) { void message.error("账号或项目已变化，请重新打开项目设置"); return; }
        if (invalidModels.length) { void message.warning("请重新选择不可用的默认模型，或恢复为当前创作设置"); return; }
        const settings = { ...draft, cover: cover ? draft.cover : undefined };
        if (!useCanvasStore.getState().updateWorkspaceSettings(workspaceId, settings)) { void message.error("未保存，请确认项目与封面仍然存在并重试"); return; }
        void message.success("项目设置已更新，默认模型用于后续新节点");
        onClose();
    };
    return <Modal open title={<span className="flex items-center gap-2"><SlidersHorizontal className="size-4" />项目设置</span>} width={760} onCancel={onClose} onOk={save} okText="保存设置" cancelText="取消" styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}>
        <section className="pb-6 pt-3">
            <h3 className="text-sm font-semibold">新节点默认模型</h3>
            <p className="mb-4 mt-1.5 text-xs leading-6 text-muted-foreground">这个项目的所有画布共用。仅应用到后续新建的节点，已有节点和执行中的任务保持原模型。分辨率、比例与素材上限仍由所选渠道决定。</p>
            <div className="grid gap-4 sm:grid-cols-2">{(Object.keys(projectModelLabels) as ModelCapability[]).map((capability) => {
                const selection = draft.defaultModels?.[capability];
                const valid = validProjectModel(config, capability, selection);
                return <div key={capability} className="min-w-0 rounded-xl border border-border p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-medium">{projectModelLabels[capability]}模型</span>{selection ? <Button size="small" type="text" icon={<RotateCcw className="size-3" />} onClick={() => setDraft((value) => ({ ...value, defaultModels: { ...value.defaultModels, [capability]: undefined } }))}>恢复默认</Button> : <span className="text-[11px] text-muted-foreground">沿用创作设置</span>}</div>
                    <ModelPicker config={config} capability={capability} value={valid ? selection?.model : undefined} channelId={valid ? selection?.channelId : undefined} placeholder={selection ? "重新选择可用模型" : "沿用当前创作设置"} fullWidth onChange={(model, channelId) => { if (channelId) setDraft((value) => ({ ...value, defaultModels: { ...value.defaultModels, [capability]: { model, channelId } } })); }} />
                    {selection && !valid ? <p role="status" className="mt-2 text-xs text-destructive">原模型「{selection.model}」或渠道已不可用，请重选或恢复默认。</p> : null}
                </div>;
            })}</div>
        </section>
        <section className="border-t border-border py-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="size-4" />项目封面</h3><p className="mt-1.5 text-xs leading-6 text-muted-foreground">选择本项目的图片或图片候选，只保存引用，不复制文件。</p></div><Button size="small" disabled={!draft.cover} onClick={() => setDraft((value) => ({ ...value, cover: undefined }))}>自动选取封面</Button></div>
            <p className="my-3 text-xs text-muted-foreground">{draft.cover ? cover ? `已选：${cover.canvas.title} / ${cover.node.title}` : "原封面图片已移除，将自动选取现有内容。" : "自动选取项目中的真实图片；没有图片时展示视频或文字预览。"}</p>
            <Input allowClear value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索画布或图片名称" aria-label="搜索封面图片" />
            {candidates.length ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{candidates.slice((currentPage - 1) * 9, currentPage * 9).map(({ canvas, node }) => {
                const selected = draft.cover?.canvasId === canvas.id && draft.cover.nodeId === node.id;
                return <button type="button" key={`${canvas.id}:${node.id}`} aria-pressed={selected} onClick={() => setDraft((value) => ({ ...value, cover: { canvasId: canvas.id, nodeId: node.id } }))} className={`overflow-hidden rounded-xl border text-left transition focus-visible:outline-2 focus-visible:outline-ring ${selected ? "border-primary bg-accent" : "border-border hover:border-primary/40"}`}>
                    <div className="relative"><CanvasProjectPreview project={{ ...canvas, nodes: [node] }} />{selected ? <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="size-3" /></span> : null}</div><div className="px-3 py-2"><p className="truncate text-xs font-medium">{node.title || "未命名图片"}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{canvas.title}</p></div>
                </button>;
            })}</div> : <p className="py-8 text-center text-xs text-muted-foreground">{search ? "没有匹配图片，换一个名称试试" : "项目中还没有图片。在画布上传或生成图片后，即可选择封面。"}</p>}
            {candidates.length > 9 ? <Pagination className="mt-4" align="end" size="small" current={currentPage} pageSize={9} total={candidates.length} showSizeChanger={false} onChange={setPage} /> : null}
        </section>
    </Modal>;
}
