"use client";

import { useState } from "react";
import { Button, Checkbox, Input, InputNumber, Modal, Select } from "antd";
import { Search } from "lucide-react";
import { ProductionReferencePreview } from "./production-reference-preview";
import type { CanvasProject } from "../../../../stores/use-canvas-store";
import { CanvasNodeType } from "../../../../types";
import { productionAssetLabels, type ProductionAsset, type ProductionDocument, type ProductionShot } from "../../../../lib/production-types";

const fieldClass = "flex min-w-0 flex-col gap-2 text-xs font-medium";

export function ProductionAssetEditor({ asset, document, canvases, busy, saveError, onSave, onClose }: {
    asset: ProductionAsset; document: ProductionDocument; canvases: CanvasProject[]; busy: boolean;
    saveError: string;
    onSave: (asset: ProductionAsset) => Promise<unknown>; onClose: () => void;
}) {
    const [draft, setDraft] = useState(asset);
    const [query, setQuery] = useState("");
    const [canvasId, setCanvasId] = useState("");
    const [error, setError] = useState("");
    const candidates = canvases.filter((canvas) => !canvasId || canvas.id === canvasId).flatMap((canvas) => canvas.nodes.filter((node) => [CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Panorama].includes(node.type) && node.title.toLowerCase().includes(query.toLowerCase())).map((node) => ({ canvas, node })));
    const variantOptions = document.assets.filter((item) => item.kind === draft.kind && item.id !== draft.id && !item.variantOf).map((item) => ({ value: item.id, label: item.title }));
    const save = async () => {
        if (!draft.title.trim()) { setError("请输入资产名称"); return; }
        if (await onSave({ ...draft, title: draft.title.trim() })) onClose();
    };
    return <Modal open title={document.assets.some((item) => item.id === asset.id) ? "编辑项目资产" : "新建项目资产"} width={780} onCancel={() => !busy && onClose()} onOk={() => void save()} okText="保存资产" cancelText="取消" confirmLoading={busy} cancelButtonProps={{ disabled: busy }} mask={{ closable: false }}>
        <div className="space-y-5 py-3">
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]"><label className={fieldClass}>资产类型<Select value={draft.kind} disabled={Boolean(asset.variantOf) || document.assets.some((item) => item.variantOf === asset.id) || busy} options={Object.entries(productionAssetLabels).map(([value, label]) => ({ value, label }))} onChange={(kind) => setDraft({ ...draft, kind, variantOf: "" })} /></label><label className={fieldClass}>名称<Input maxLength={100} value={draft.title} disabled={busy} placeholder="例如：林晚 · 雨夜便装" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label></div>
            <label className={fieldClass}>设定与使用说明<Input.TextArea rows={4} maxLength={20000} disabled={busy} value={draft.description} placeholder="记录外貌、服装、声音特点、场景氛围或风格约束，便于各镜头保持一致。" onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label className={fieldClass}>所属基础资产（可选）<Select allowClear disabled={busy || document.assets.some((item) => item.variantOf === asset.id)} value={draft.variantOf || undefined} options={variantOptions} placeholder="独立资产；选择后作为其服装、状态等变体" onChange={(variantOf) => setDraft({ ...draft, variantOf: variantOf || "" })} /></label>
            <div className="border-t border-border pt-5">
                <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">从画布关联参考</h3><span className="text-xs text-muted-foreground">已选 {draft.references.length} 个</span></div>
                <p className="mb-3 text-xs leading-6 text-muted-foreground">制作计划与关联画布保存到账号。这里关联已有节点，不复制素材文件；在生成时仍需确认实际参考和模型限制。</p>
                <div className="mb-3 flex flex-wrap gap-2"><Input prefix={<Search className="size-3.5 text-muted-foreground" />} className="min-w-40 flex-1" aria-label="搜索参考节点" placeholder="搜索节点名称" value={query} onChange={(event) => setQuery(event.target.value)} /><Select className="min-w-40" value={canvasId} options={[{ value: "", label: "本项目全部画布" }, ...canvases.map((canvas) => ({ value: canvas.id, label: canvas.title }))]} onChange={setCanvasId} /></div>
                <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {candidates.map(({ canvas, node }) => {
                        const selected = draft.references.some((ref) => ref.canvasId === canvas.id && ref.nodeId === node.id);
                        return <button type="button" key={`${canvas.id}:${node.id}`} disabled={busy || (!selected && draft.references.length >= 50)} aria-pressed={selected} onClick={() => setDraft({ ...draft, references: selected ? draft.references.filter((ref) => ref.canvasId !== canvas.id || ref.nodeId !== node.id) : [...draft.references, { canvasId: canvas.id, nodeId: node.id }] })} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-accent" : "border-border hover:bg-accent/50"}`}>
                            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted"><ProductionReferencePreview node={node} /></span><span className="min-w-0"><span className="block truncate text-xs font-medium">{node.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{canvas.title}</span></span>
                        </button>;
                    })}
                </div>
                {!candidates.length && <div className="rounded-xl bg-muted/50 p-6 text-center text-xs text-muted-foreground">没有匹配节点。可以先保存资产设定，稍后在画布添加参考再关联。</div>}
                {draft.references.some((ref) => !canvases.some((canvas) => canvas.id === ref.canvasId && canvas.nodes.some((node) => node.id === ref.nodeId))) && <div className="mt-3 flex items-center justify-between gap-3 text-xs text-destructive"><span>有参考节点已不存在，请移除失效关联后保存。</span><Button size="small" danger disabled={busy} onClick={() => setDraft({ ...draft, references: draft.references.filter((ref) => canvases.some((canvas) => canvas.id === ref.canvasId && canvas.nodes.some((node) => node.id === ref.nodeId))) })}>移除失效关联</Button></div>}
            </div>
            {(error || saveError) && <p className="text-xs text-destructive" role="alert">{error || saveError}</p>}
        </div>
    </Modal>;
}

export function ProductionShotEditor({ shot, document, onSave, onClose }: { shot: ProductionShot; document: ProductionDocument; onSave: (value: ProductionShot) => void; onClose: () => void }) {
    const [draft, setDraft] = useState(shot);
    const [error, setError] = useState("");
    const save = () => {
        if (!draft.title.trim()) { setError("请输入镜头名称"); return; }
        if (!Number.isInteger(draft.seconds) || draft.seconds < 1 || draft.seconds > 86400) { setError("计划时长请输入 1 至 86400 的整数秒"); return; }
        if (draft.status === "ready" && !draft.description.trim()) { setError("标记已规划前，请先补充镜头画面"); return; }
        onSave({ ...draft, title: draft.title.trim() }); onClose();
    };
    return <Modal open title="编辑镜头" width={740} onCancel={onClose} onOk={save} okText="保存镜头" cancelText="取消" mask={{ closable: false }}>
        <div className="space-y-4 py-3">
            <div className="grid gap-4 sm:grid-cols-2"><label className={fieldClass}>镜头名称<Input maxLength={100} value={draft.title} placeholder="例如：林晚走入雨巷" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label className={fieldClass}>所属场次<Select allowClear value={draft.sceneId || undefined} placeholder="未分场" options={document.scenes.filter((scene) => scene.episodeId === draft.episodeId).sort((a, b) => a.order - b.order).map((scene) => ({ value: scene.id, label: scene.title }))} onChange={(sceneId) => setDraft({ ...draft, sceneId: sceneId || "" })} /></label></div>
            <label className={fieldClass}>镜头画面<Input.TextArea rows={4} maxLength={20000} value={draft.description} placeholder="人物、动作、空间、构图、光线，以及这个镜头发生什么。" onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label className={fieldClass}>对白／旁白<Input.TextArea rows={2} maxLength={10000} value={draft.dialogue} placeholder="角色名：台词；无对白可留空" onChange={(event) => setDraft({ ...draft, dialogue: event.target.value })} /></label>
            <div className="grid gap-4 sm:grid-cols-[1fr_150px]"><label className={fieldClass}>景别与运镜<Input maxLength={1000} value={draft.camera} placeholder="例如：中景，缓慢推进，跟随人物" onChange={(event) => setDraft({ ...draft, camera: event.target.value })} /></label><label className={fieldClass}>计划时长（秒）<InputNumber min={1} max={86400} step={1} precision={0} className="w-full" value={draft.seconds} onChange={(seconds) => setDraft({ ...draft, seconds: seconds || 0 })} /></label></div>
            <p className="text-xs leading-5 text-muted-foreground">这是镜头计划时长，生成时仍须选择当前模型支持的时长。</p>
            <label className={fieldClass}>关联项目资产<Select mode="multiple" value={draft.assetIds} optionFilterProp="label" placeholder="角色、场景、道具、声音或风格" options={document.assets.map((asset) => ({ value: asset.id, label: `${productionAssetLabels[asset.kind]} · ${asset.title}` }))} onChange={(assetIds) => setDraft({ ...draft, assetIds })} /></label>
            <Checkbox checked={draft.status === "ready"} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? "ready" : "draft" })}>已规划，可以进入画布制作</Checkbox>
            {shot.canvasId && <p className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">此镜头已关联画布。修改计划不会覆盖画布中的提示词和生成结果；可在画布继续调整。</p>}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
    </Modal>;
}
