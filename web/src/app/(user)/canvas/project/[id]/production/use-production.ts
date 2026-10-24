"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { createProduction, deleteProduction, getProduction, saveProduction } from "@/services/api/production";
import { saveCanvasProject } from "@/services/api/canvas-tasks";
import { resolveImageUrl } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, workspaceCanvases } from "../../../stores/use-canvas-store";
import type { ProductionDocument } from "../../../lib/production-types";
import { assertProductionCanvasSaved, buildProductionShotCanvas, productionShotText } from "../../../utils/production-canvas";
import { CanvasNodeType } from "../../../types";
import { buildProductionCandidate } from "../../../utils/production-candidates";
import { appendProductionBreakdown, type ProductionBreakdownDraft } from "../../../utils/production-breakdown";
import { bindImportedProduction } from "../../../utils/canvas-transfer";

type Draft = { document: ProductionDocument; dirty: boolean };
const documentCanvasIds = (value: ProductionDocument) => [...value.assets.flatMap((asset) => asset.references.map((ref) => ref.canvasId)), ...value.shots.flatMap((shot) => [shot.canvasId, ...shot.candidates.map((candidate) => candidate.canvasId)])].filter(Boolean);

export function useProduction(workspaceId: string) {
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id || "");
    const sessionVersion = useUserStore((state) => state.sessionVersion);
    const userReady = useUserStore((state) => state.isReady);
    const authError = useUserStore((state) => state.authError);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const ownerId = useCanvasStore((state) => state.ownerId);
    const projects = useCanvasStore((state) => state.projects);
    const root = projects.find((item) => item.id === workspaceId && !item.workspaceId);
    const canvases = workspaceCanvases(projects, workspaceId);
    const [document, setDocument] = useState<ProductionDocument | null>(null);
    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [reload, setReload] = useState(0);
    const currentDocument = useRef<ProductionDocument | null>(null);
    const documentScope = useRef("");
    const busyRef = useRef(false);
    const writes = useRef<Promise<unknown>>(Promise.resolve());
    const key = `production-draft:${userId}:${workspaceId}`;
    const scope = `${key}:${sessionVersion}`;
    const activeScope = useRef(scope);
    const mounted = useRef(false);
    activeScope.current = scope;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const sessionCurrent = useCallback(() => {
        const state = useUserStore.getState();
        return mounted.current && activeScope.current === scope && state.isReady && !state.authError && state.user?.role !== "guest" && state.token === token && state.user?.id === userId && state.sessionVersion === sessionVersion && useCanvasStore.getState().hydrated && useCanvasStore.getState().ownerId === userId;
    }, [token, userId, sessionVersion, scope]);
    const assertSession = () => { if (!sessionCurrent()) throw new Error("登录状态已变化，请重新打开制作计划"); };
    const cache = useCallback((value: Draft) => {
        const write = writes.current.catch(() => undefined).then(() => localforage.setItem(key, value));
        writes.current = write;
        return write;
    }, [key]);
    const apply = (value: ProductionDocument, changed: boolean) => {
        documentScope.current = scope;
        currentDocument.current = value;
        setDocument(value); setDirty(changed);
        void cache({ document: value, dirty: changed }).catch(() => {
            if (sessionCurrent()) setError("浏览器草稿保存失败，请先导出完整项目 ZIP 备份并重试账号保存，避免刷新丢失编辑。");
        });
    };

    useEffect(() => {
        documentScope.current = scope; currentDocument.current = null; setDocument(null); setDirty(false); setLoading(true); setError(""); setNotice("");
        busyRef.current = false; setBusy(false);
        if (!token || !userId || !userReady || authError || !hydrated || ownerId !== userId) return;
        let active = true;
        void (async () => {
            let draft: Draft | null = null;
            try { draft = await localforage.getItem<Draft>(key); } catch { if (active && sessionCurrent()) setError("浏览器草稿暂不可用，编辑后请及时保存到账号。"); }
            if (!active || !sessionCurrent()) return;
            try {
                const remote = await getProduction(token, workspaceId);
                if (!active || !sessionCurrent()) return;
                const local = draft?.dirty && draft.document.workspaceId === workspaceId ? draft.document : null;
                const value = local || remote;
                currentDocument.current = value; setDocument(value); setDirty(Boolean(local));
                if (local) setNotice(!local.id ? "已恢复未完成导入的制作草稿，点击“保存计划”继续保存；无需重新导入项目包。" : remote && remote.revision !== local.revision ? "已恢复本机草稿，但账号版本已变化。保存可能冲突；请先导出完整项目 ZIP 备份，再决定是否重新读取账号版本。" : "已恢复上次未保存的本机草稿，请检查后保存到账号。");
            } catch (failure) {
                if (!active || !sessionCurrent()) return;
                if (draft?.document.workspaceId === workspaceId) { currentDocument.current = draft.document; setDocument(draft.document); setDirty(draft.dirty); }
                setError(failure instanceof Error ? failure.message : "读取制作计划失败，已保留本机草稿");
            } finally { if (active && sessionCurrent()) setLoading(false); }
        })();
        return () => { active = false; };
    }, [token, userId, sessionVersion, userReady, authError, hydrated, ownerId, key, workspaceId, reload, sessionCurrent]);

    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    const edit = (update: (value: ProductionDocument) => ProductionDocument) => {
        if (!sessionCurrent() || documentScope.current !== scope || busyRef.current || !currentDocument.current) return false;
        try {
            const next = update(currentDocument.current);
            if (next.episodes.length > 100 || next.scenes.length > 500 || next.shots.length > 500 || next.assets.length > 200) throw new Error("每份制作计划最多 100 集、500 个场次、500 个镜头和 200 个资产。");
            apply(next, true); setError("");
            return true;
        } catch (failure) { setError(failure instanceof Error ? failure.message : "计划更新失败，已有内容已保留"); return false; }
    };
    const run = async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
        if (!sessionCurrent() || busyRef.current) return;
        busyRef.current = true; setBusy(true); setError("");
        try { assertSession(); const result = await operation(); assertSession(); return result; }
        catch (failure) { if (sessionCurrent()) setError(failure instanceof Error ? failure.message : "操作失败，编辑内容已保留"); return undefined; }
        finally { if (sessionCurrent()) { busyRef.current = false; setBusy(false); } }
    };
    const syncCanvases = async (ids: string[]) => {
        const all = useCanvasStore.getState().projects;
        const selected = [workspaceId, ...ids.filter((id) => id !== workspaceId)];
        for (const id of new Set(selected)) {
            assertSession();
            const canvas = all.find((item) => item.id === id && (id === workspaceId || item.workspaceId === workspaceId));
            if (!canvas) throw new Error("关联画布已不存在，请重新选择");
            const saved = await saveCanvasProject(token, canvas); assertSession();
            assertProductionCanvasSaved(canvas, saved);
        }
        for (const id of new Set(selected)) {
            const sent = all.find((canvas) => canvas.id === id)!;
            const current = useCanvasStore.getState().projects.find((canvas) => canvas.id === id);
            if (!current) throw new Error("关联画布已不存在，请重新选择");
            assertProductionCanvasSaved(sent, current);
        }
    };
    const saveDocument = async (value: ProductionDocument, sync = true) => {
        const ids = documentCanvasIds(value);
        if (sync) await syncCanvases(ids);
        let next = value;
        if (!next.id) {
            assertSession();
            const created = await createProduction(token, workspaceId, next.title); assertSession();
            next = bindImportedProduction(next, created);
            await cache({ document: next, dirty: true }); assertSession();
            apply(next, true);
        }
        const saved = await saveProduction(token, next);
        assertSession(); apply(saved, false); setNotice("制作计划已保存到账号。");
        return saved;
    };
    const save = () => run(async () => {
        if (!currentDocument.current) return;
        return saveDocument(currentDocument.current);
    });
    const applyBreakdown = (draft: ProductionBreakdownDraft) => run(async () => {
        if (!currentDocument.current) return false;
        const next = appendProductionBreakdown(currentDocument.current, draft);
        await cache({ document: next, dirty: true }); assertSession();
        apply(next, true);
        setNotice("已将所选拆镜追加到本机制作草稿，请检查后保存计划到账号。");
        return true;
    });
    const create = () => run(async () => {
        if (!root) throw new Error("项目不存在或尚未载入");
        await syncCanvases([]);
        const value = await createProduction(token, workspaceId, root.workspaceTitle || root.title);
        assertSession(); apply(value, false);
        return value;
    });
    const commitAsset = (asset: ProductionDocument["assets"][number]) => run(async () => {
        if (currentDocument.current && !currentDocument.current.assets.some((item) => item.id === asset.id) && currentDocument.current.assets.length >= 200) throw new Error("每份制作计划最多 200 个资产");
        if (asset.references.length > 50) throw new Error("每个资产最多关联 50 个参考节点");
        if (asset.references.some((ref) => !useCanvasStore.getState().projects.some((canvas) => canvas.id === ref.canvasId && canvas.nodes.some((node) => node.id === ref.nodeId)))) throw new Error("参考节点已不存在，请移除失效关联后保存");
        await syncCanvases(asset.references.map((ref) => ref.canvasId));
        const value = currentDocument.current;
        if (!value) return;
        apply({ ...value, assets: value.assets.some((item) => item.id === asset.id) ? value.assets.map((item) => item.id === asset.id ? asset : item) : [...value.assets, asset] }, true);
        setNotice("资产设定已加入本机草稿，点击“保存计划”同步到账号。");
        return true;
    });
    const placeShot = (shotId: string, canvasId: string, rebuild = false) => run(async () => {
        const value = currentDocument.current;
        const shot = value?.shots.find((item) => item.id === shotId);
        if (!value || !shot) return;
        const store = useCanvasStore.getState();
        const previous = store.projects.find((canvas) => canvas.id === shot.canvasId);
        const bound = Boolean(shot.canvasId || shot.textNodeId || shot.imageNodeId || shot.videoNodeId);
        const intact = previous && [shot.textNodeId, shot.imageNodeId, shot.videoNodeId].every((id) => id && previous.nodes.some((node) => node.id === id));
        if (bound && intact) { await saveDocument(value); return { canvasId: shot.canvasId, nodeId: shot.textNodeId }; }
        if (bound && !rebuild) throw new Error("原镜头节点已缺失，请选择“重新建立镜头节点”确认；现有节点和文件会保留。");
        const canvas = store.projects.find((item) => item.id === canvasId && (item.id === workspaceId || item.workspaceId === workspaceId));
        if (!canvas) throw new Error("请选择本项目中的画布");
        await syncCanvases([canvasId, ...documentCanvasIds(value)]);
        const selectedReferences = new Set(value.assets.filter((asset) => shot.assetIds.includes(asset.id)).flatMap((asset) => asset.references.map((ref) => `${ref.canvasId}:${ref.nodeId}`)));
        const sourceCanvases = useCanvasStore.getState().projects;
        const resolvedCanvases = await Promise.all(sourceCanvases.map(async (source) => ({
            ...source,
            nodes: await Promise.all(source.nodes.map(async (node) => {
                if (!selectedReferences.has(`${source.id}:${node.id}`) || ![CanvasNodeType.Image, CanvasNodeType.Panorama].includes(node.type)) return node;
                const fallback = node.metadata?.content || "";
                let content = "";
                try { content = await resolveImageUrl(node.metadata?.storageKey, node.metadata?.storageKey && fallback.startsWith("blob:") ? "" : fallback); }
                catch { /* Report the specific reference below; do not silently omit it. */ }
                if (!content) throw new Error(`参考图片“${node.title}”暂时无法读取文件，请先打开原画布检查素材或重新上传，再放入镜头。`);
                return { ...node, metadata: { ...node.metadata, content } };
            })),
        })));
        assertSession();
        for (const source of sourceCanvases.filter((item) => item.id === canvasId || item.nodes.some((node) => selectedReferences.has(`${item.id}:${node.id}`)))) {
            const latest = useCanvasStore.getState().projects.find((item) => item.id === source.id);
            if (!latest) throw new Error("参考画布已不存在，请重新选择");
            assertProductionCanvasSaved(source, latest);
        }
        const built = buildProductionShotCanvas(value, shot, resolvedCanvases.find((item) => item.id === canvasId)!, resolvedCanvases);
        const next = { ...value, shots: value.shots.map((item) => item.id === shotId ? built.shot : item) };
        await cache({ document: next, dirty: true }); assertSession();
        const beforeWrite = useCanvasStore.getState().projects.find((item) => item.id === canvasId);
        try {
            if (!beforeWrite) throw new Error("目标画布已不存在，请重新选择");
            assertProductionCanvasSaved(sourceCanvases.find((item) => item.id === canvasId)!, beforeWrite);
        } catch (failure) {
            await cache({ document: value, dirty: true });
            throw failure;
        }
        apply(next, true);
        store.updateProject(canvasId, { nodes: built.nodes, connections: built.connections });
        await syncCanvases([canvasId]);
        await saveDocument(next, false);
        return { canvasId, nodeId: built.shot.textNodeId };
    });
    const addCandidate = (shotId: string, sourceCanvasId: string, sourceNodeId: string) => run(async () => {
        const value = currentDocument.current;
        const shot = value?.shots.find((item) => item.id === shotId);
        if (!value || !shot) return;
        if (shot.candidates.length >= 20) throw new Error("每个镜头最多保存 20 个候选，请先整理现有候选");
        if (value.shots.reduce((sum, item) => sum + item.candidates.length, 0) >= 1000) throw new Error("每份制作计划最多保存 1000 个候选");
        await syncCanvases([sourceCanvasId, ...documentCanvasIds(value)]);
        const source = useCanvasStore.getState().projects.find((item) => item.id === sourceCanvasId && (item.id === workspaceId || item.workspaceId === workspaceId));
        if (!source) throw new Error("请选择本项目内的画布结果");
        const built = buildProductionCandidate(shot, source, sourceNodeId);
        const next = { ...value, shots: value.shots.map((item) => item.id === shotId ? { ...item, candidates: [...item.candidates, built.candidate] } : item) };
        await cache({ document: next, dirty: true }); assertSession();
        const beforeWrite = useCanvasStore.getState().projects.find((item) => item.id === sourceCanvasId);
        try {
            if (!beforeWrite) throw new Error("候选来源画布已不存在，请重新选择");
            assertProductionCanvasSaved(source, beforeWrite);
        } catch (failure) {
            await cache({ document: value, dirty: true });
            throw failure;
        }
        apply(next, true);
        useCanvasStore.getState().updateProject(sourceCanvasId, { nodes: built.nodes });
        await syncCanvases([sourceCanvasId]);
        await saveDocument(next, false);
        setNotice("候选已保存。副本保留相同素材文件，后续重生成不会覆盖这个候选。");
        return true;
    });
    const syncShotText = (shotId: string, previous: string, replacement: string) => run(async () => {
        const value = currentDocument.current;
        const shot = value?.shots.find((item) => item.id === shotId);
        if (!value || !shot || productionShotText(value, shot) !== replacement) throw new Error("计划内容已变化，请重新预览同步内容");
        await syncCanvases([shot.canvasId]);
        const canvas = useCanvasStore.getState().projects.find((item) => item.id === shot.canvasId);
        const node = canvas?.nodes.find((item) => item.id === shot.textNodeId);
        if (!canvas || !node || node.type !== CanvasNodeType.Text) throw new Error("镜头说明节点已缺失，请先重新建立镜头节点");
        if ((node.metadata?.content || "") !== previous) throw new Error("画布说明已被修改，请重新预览差异后同步");
        await saveDocument(value);
        const latest = useCanvasStore.getState().projects.find((item) => item.id === canvas.id);
        if (!latest) throw new Error("画布已不存在");
        assertProductionCanvasSaved(canvas, latest);
        useCanvasStore.getState().updateProject(canvas.id, { nodes: canvas.nodes.map((item) => item.id === node.id ? { ...item, title: `${shot.title} · 说明`, metadata: { ...item.metadata, content: replacement } } : item) });
        await syncCanvases([canvas.id]);
        setNotice("镜头说明已同步。图片、视频和各生成节点的提示词保持当前编辑内容。");
        return true;
    });
    const discardDraft = () => run(async () => {
        // Read first: failed network must not discard the recoverable local draft.
        const remote = await getProduction(token, workspaceId); assertSession();
        await writes.current.catch(() => undefined);
        await localforage.removeItem(key); assertSession();
        currentDocument.current = remote; setDocument(remote); setDirty(false); setNotice("已读取账号最新版本。");
    });
    const remove = () => run(async () => {
        const value = currentDocument.current;
        if (!value) return;
        if (value.id) await deleteProduction(token, value.id, value.revision);
        else {
            const remote = await getProduction(token, workspaceId); assertSession();
            if (remote) {
                const created = bindImportedProduction(value, remote);
                await deleteProduction(token, created.id, created.revision);
            }
        }
        assertSession();
        await writes.current.catch(() => undefined);
        await localforage.removeItem(key); assertSession();
        currentDocument.current = null; setDocument(null); setDirty(false);
        return true;
    });
    return { document: documentScope.current === scope && document?.workspaceId === workspaceId ? document : null, dirty, loading, busy, error, notice, root, canvases, edit, create, save, applyBreakdown, commitAsset, placeShot, addCandidate, syncShotText, discardDraft, remove, isCurrent: sessionCurrent, retry: () => setReload((value) => value + 1) };
}
