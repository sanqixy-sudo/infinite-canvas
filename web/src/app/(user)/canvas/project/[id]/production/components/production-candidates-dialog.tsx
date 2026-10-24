"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Input, Modal, Select } from "antd";
import { Check, Film, ImageIcon, LocateFixed, Play, Plus, Search, Trash2, X } from "lucide-react";
import { resolveMediaUrl } from "@/services/file-storage";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, workspaceCanvases } from "../../../../stores/use-canvas-store";
import type { ProductionCandidate, ProductionShot } from "../../../../lib/production-types";
import { isProductionCandidateValid } from "../../../../utils/production-candidates";
import { CanvasNodeType, type CanvasNodeData } from "../../../../types";
import { ProductionReferencePreview } from "./production-reference-preview";

function CandidateVideo({ candidate }: { candidate: ProductionCandidate }) {
    const token = useUserStore((state) => state.token);
    const version = useUserStore((state) => state.sessionVersion);
    const [requested, setRequested] = useState(false);
    const [result, setResult] = useState<{ candidate: ProductionCandidate; token: string; version: number; url: string; error: string } | null>(null);
    const current = result?.candidate === candidate && result.token === token && result.version === version ? result : null;
    useEffect(() => {
        if (!requested) return;
        let active = true;
        void resolveMediaUrl(candidate.storageKey, candidate.content).then((url) => {
            if (active) setResult({ candidate, token, version, url, error: url ? "" : "视频文件暂不可用，请在原画布检查" });
        }).catch(() => { if (active) setResult({ candidate, token, version, url: "", error: "视频加载失败，请在原画布检查" }); });
        return () => { active = false; };
    }, [requested, candidate, token, version]);
    if (current?.url) return <video controls playsInline preload="metadata" src={current.url} className="size-full object-contain" aria-label={candidate.title} onError={() => setResult((value) => value?.candidate === candidate && value.token === token && value.version === version ? { ...value, url: "", error: "视频无法播放，请在原画布检查格式或文件" } : value)} />;
    return <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground"><Film className="size-6" />{current?.error ? <span>{current.error}</span> : requested ? <span>正在加载视频…</span> : <Button size="small" type="text" icon={<Play className="size-3.5" />} onClick={() => setRequested(true)}>预览视频</Button>}</div>;
}

export function ProductionCandidatesDialog({ shot, workspaceId, busy, error, onAdd, onEdit, onClose }: {
    shot: ProductionShot; workspaceId: string; busy: boolean; error: string;
    onAdd: (canvasId: string, nodeId: string) => Promise<unknown>; onEdit: (update: (current: ProductionShot) => ProductionShot) => void; onClose: () => void;
}) {
    const { modal } = App.useApp();
    const router = useRouter();
    const projects = useCanvasStore((state) => state.projects);
    const canvases = workspaceCanvases(projects, workspaceId);
    const [canvasId, setCanvasId] = useState(shot.canvasId || "");
    const [query, setQuery] = useState("");
    const [kind, setKind] = useState("all");
    const [showPicker, setShowPicker] = useState(!shot.candidates.length);
    const alreadyCandidateNodes = new Set(shot.candidates.map((candidate) => `${candidate.canvasId}:${candidate.nodeId}`));
    const sources = canvases.filter((canvas) => !canvasId || canvas.id === canvasId).flatMap((canvas) => canvas.nodes.filter((node) => {
        const metadata = node.metadata;
        return (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video)
            && (kind === "all" || node.type === kind) && node.title.toLowerCase().includes(query.toLowerCase())
            && !alreadyCandidateNodes.has(`${canvas.id}:${node.id}`) && !["loading", "stopping", "error"].includes(metadata?.status || "")
            && Boolean(metadata?.storageKey || /^https?:\/\//i.test(metadata?.content || ""));
    }).map((node) => ({ canvas, node })));
    const select = (candidate: ProductionCandidate) => onEdit((current) => ({ ...current, [candidate.kind === "image" ? "selectedImageCandidateId" : "selectedVideoCandidateId"]: candidate.id }));
    const unselect = (candidate: ProductionCandidate) => onEdit((current) => ({ ...current, [candidate.kind === "image" ? "selectedImageCandidateId" : "selectedVideoCandidateId"]: "" }));
    const remove = (candidate: ProductionCandidate) => modal.confirm({ title: `移除候选“${candidate.title}”？`, content: "仅移除本镜头的候选记录；如果已采用，也会撤销采用。候选副本、原画布节点和素材文件均保留。保存计划后同步到账号。", okText: "移除候选记录", cancelText: "保留", okButtonProps: { danger: true }, onOk: () => onEdit((current) => ({ ...current, candidates: current.candidates.filter((item) => item.id !== candidate.id), selectedImageCandidateId: current.selectedImageCandidateId === candidate.id ? "" : current.selectedImageCandidateId, selectedVideoCandidateId: current.selectedVideoCandidateId === candidate.id ? "" : current.selectedVideoCandidateId })) });
    return <Modal open title={`${shot.title} · 候选与采用`} width={1040} footer={<Button onClick={onClose} disabled={busy}>完成，返回制作计划</Button>} onCancel={() => !busy && onClose()} mask={{ closable: false }}>
        <div className="space-y-5 py-3">
            <p className="text-xs leading-6 text-muted-foreground">将实际图片或视频结果保存为独立候选节点，不复制文件、不发起生成。添加候选会同时保存当前计划；图片和视频各可采用一个版本，采用、撤销及移除记录后请保存制作计划。</p>
            {shot.candidates.some((candidate) => !candidate.storageKey) && <p className="text-xs leading-6 text-muted-foreground">部分候选使用外链，文件有效期取决于原地址。需要长期保留时，请先将文件存入素材库、放入画布，再保存为候选。</p>}
            {error && <Alert showIcon type="error" title={error} description="失败后保留本机草稿；已有候选无需重复添加，可返回制作计划重试保存。" />}
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">已保存 {shot.candidates.length} / 20 个候选</h3><Button size="small" icon={showPicker ? <X className="size-3.5" /> : <Plus className="size-3.5" />} disabled={busy} onClick={() => setShowPicker(!showPicker)}>{showPicker ? "收起结果选择" : "从画布选择结果"}</Button></div>
            {showPicker && <section className="rounded-xl border border-border bg-muted/30 p-4"><div className="mb-3 flex flex-wrap gap-2"><Input prefix={<Search className="size-3.5" />} className="min-w-40 flex-1" aria-label="搜索画布结果" placeholder="搜索结果节点名称" value={query} onChange={(event) => setQuery(event.target.value)} /><Select className="min-w-40" aria-label="选择来源画布" value={canvasId} options={[{ value: "", label: "本项目全部画布" }, ...canvases.map((canvas) => ({ value: canvas.id, label: canvas.title }))]} onChange={setCanvasId} /><Select className="min-w-28" aria-label="候选类型" value={kind} options={[{ value: "all", label: "图片与视频" }, { value: "image", label: "图片" }, { value: "video", label: "视频" }]} onChange={setKind} /></div>
                <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{sources.map(({ canvas, node }) => <div key={`${canvas.id}:${node.id}`} className="flex min-w-0 items-center gap-3 rounded-xl bg-card p-3"><div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted"><ProductionReferencePreview node={node} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{node.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{canvas.title}</p><Button className="!px-0" type="link" size="small" disabled={busy || shot.candidates.length >= 20} onClick={() => void onAdd(canvas.id, node.id)}>保存为候选</Button></div></div>)}</div>
                {!sources.length && <p className="py-6 text-center text-xs text-muted-foreground">没有可选结果。先在画布生成或导入图片／视频；仅有临时地址的文件请先保存到素材存储。</p>}
            </section>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shot.candidates.map((candidate) => {
                const valid = isProductionCandidateValid(candidate, canvases);
                const selected = (candidate.kind === "image" ? shot.selectedImageCandidateId : shot.selectedVideoCandidateId) === candidate.id;
                const previewNode: CanvasNodeData = { id: candidate.nodeId, title: candidate.title, type: candidate.kind === "image" ? CanvasNodeType.Image : CanvasNodeType.Video, width: 1, height: 1, position: { x: 0, y: 0 }, metadata: { content: candidate.content, storageKey: candidate.storageKey } };
                return <article key={candidate.id} className={`overflow-hidden rounded-xl border ${selected ? "border-primary" : "border-border"}`}><div className="flex h-40 items-center justify-center bg-muted/40">{candidate.kind === "image" ? <ProductionReferencePreview node={previewNode} /> : <CandidateVideo candidate={candidate} />}</div><div className="space-y-3 p-4"><div className="flex items-start gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{candidate.title}</span>{candidate.kind === "image" ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" /> : <Film className="size-4 shrink-0 text-muted-foreground" />}</div><p className="text-xs text-muted-foreground">{selected ? "已采用" : "待选候选"} · {canvases.find((canvas) => canvas.id === candidate.canvasId)?.title || "原画布已不可用"}</p>{!valid && <p className="text-xs leading-5 text-destructive">候选副本已失效或内容被修改，请重新保存候选后采用。</p>}<div className="flex flex-wrap gap-1">{selected ? <Button size="small" disabled={busy} onClick={() => unselect(candidate)}>撤销采用</Button> : <Button size="small" type="primary" disabled={busy || !valid} icon={<Check className="size-3.5" />} onClick={() => select(candidate)}>采用{candidate.kind === "image" ? "图片" : "视频"}</Button>}<Button size="small" type="text" aria-label={`定位${candidate.title}`} icon={<LocateFixed className="size-3.5" />} disabled={busy || !valid} onClick={() => router.push(`/canvas/${candidate.canvasId}?focusNodeId=${encodeURIComponent(candidate.nodeId)}`)} /><Button size="small" type="text" danger aria-label={`移除${candidate.title}`} icon={<Trash2 className="size-3.5" />} disabled={busy} onClick={() => remove(candidate)} /></div></div></article>;
            })}</div>
            {!shot.candidates.length && <div className="py-5 text-center text-xs leading-6 text-muted-foreground">先从画布选择已经完成的结果，再保存为候选。重生成原节点不会覆盖已保存的候选。</div>}
        </div>
    </Modal>;
}
