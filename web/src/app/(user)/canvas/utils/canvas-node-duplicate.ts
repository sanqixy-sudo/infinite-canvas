import { nanoid } from "nanoid";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "../types";
import { getGenerationResourceNodes } from "./canvas-resource-references";

/** Retained media keeps its storage identity; a copy never owns the source task. */
export function clearCanvasExecutionMetadata(metadata: CanvasNodeMetadata | undefined): CanvasNodeMetadata | undefined {
    if (!metadata) return undefined;
    const next = structuredClone(metadata);
    const executionFields = [
        "clientTaskId", "taskBackend", "imageTaskId", "imageTaskResultId", "audioTaskId", "audioTaskResultId",
        "videoTaskId", "teamApprovalId", "videoTaskStatus", "videoTaskVideoId", "videoTaskTranslation", "billingStatus", "tokenMode",
        "actualTokens", "actualInputTokens", "actualOutputTokens", "reservedCredits", "settledCredits",
        "startedAt", "progress", "errorDetails", "accountSaveError",
    ] as const satisfies readonly (keyof CanvasNodeMetadata)[];
    for (const key of executionFields) delete next[key];
    next.status = next.content ? "success" : "idle";
    if (!next.content) delete next.durationMs;
    return next;
}

/** Groups and image batches are copied together, including collapsed children. */
export function collectCanvasSelection(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds: Iterable<string>) {
    const ids = new Set(selectedIds);
    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const node of nodes) {
            const parentSelected = (node.metadata?.groupId && ids.has(node.metadata.groupId))
                || (node.metadata?.batchRootId && ids.has(node.metadata.batchRootId));
            if (parentSelected && !ids.has(node.id)) { ids.add(node.id); expanded = true; }
            if (ids.has(node.id) && node.metadata?.isBatchRoot) {
                for (const childId of node.metadata.batchChildIds || []) {
                    if (!ids.has(childId)) { ids.add(childId); expanded = true; }
                }
            }
        }
    }
    return structuredClone({
        nodes: nodes.filter((node) => ids.has(node.id)),
        connections: connections.filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)),
    });
}

type CloneCanvasOptions = {
    offset?: Position;
    preserveIncoming?: boolean;
    idFactory?: (sourceId: string) => string;
};

export function cloneCanvasSelection(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds: Iterable<string>, options: CloneCanvasOptions = {}) {
    const selection = collectCanvasSelection(nodes, connections, selectedIds);
    const makeId = options.idFactory || (() => nanoid());
    const idMap = new Map(selection.nodes.map((node) => [node.id, makeId(node.id)]));
    const availableIds = new Set(nodes.map((node) => node.id));
    const offset = options.offset || { x: 36, y: 36 };
    const copiedConnections = connections.flatMap((edge): CanvasConnection[] => {
        const toNodeId = idMap.get(edge.toNodeId);
        const fromNodeId = idMap.get(edge.fromNodeId) || (options.preserveIncoming && availableIds.has(edge.fromNodeId) ? edge.fromNodeId : undefined);
        return fromNodeId && toNodeId ? [{ ...edge, id: makeId(edge.id), fromNodeId, toNodeId }] : [];
    });
    const copiedNodes = selection.nodes.map((node): CanvasNodeData => {
        const metadata = clearCanvasExecutionMetadata(node.metadata);
        if (metadata) {
            metadata.groupId = metadata.groupId ? idMap.get(metadata.groupId) : undefined;
            metadata.batchRootId = metadata.batchRootId ? idMap.get(metadata.batchRootId) : undefined;
            metadata.batchChildIds = metadata.batchChildIds?.flatMap((id) => idMap.has(id) ? [idMap.get(id)!] : []);
            metadata.primaryImageId = metadata.primaryImageId ? idMap.get(metadata.primaryImageId) : undefined;
            if (metadata.isBatchRoot && !metadata.batchChildIds?.length) {
                delete metadata.isBatchRoot;
                delete metadata.batchChildIds;
                delete metadata.primaryImageId;
                delete metadata.imageBatchExpanded;
                delete metadata.batchUsesReferenceImages;
            }
        }
        return {
            ...node,
            id: idMap.get(node.id)!,
            title: node.title.endsWith(" 副本") ? node.title : `${node.title} 副本`,
            position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
            metadata,
        };
    });
    const combinedNodes = [...nodes, ...copiedNodes];
    const combinedConnections = [...connections, ...copiedConnections];
    for (const node of copiedNodes) {
        const metadata = node.metadata;
        if (!metadata) continue;
        const inputs = getGenerationResourceNodes(node.id, combinedNodes, combinedConnections);
        const inputIds = new Set(inputs.map((input) => input.id));
        const referenceId = (id?: string) => {
            const nextId = id ? idMap.get(id) || id : undefined;
            return nextId && inputIds.has(nextId) ? nextId : undefined;
        };
        metadata.firstFrameNodeId = referenceId(metadata.firstFrameNodeId);
        metadata.lastFrameNodeId = referenceId(metadata.lastFrameNodeId);
        metadata.referenceAudioNodeId = referenceId(metadata.referenceAudioNodeId);
        metadata.mimoVoiceCloneAudioNodeId = referenceId(metadata.mimoVoiceCloneAudioNodeId);
        metadata.klingImageNodeIds = metadata.klingImageNodeIds?.flatMap((id) => referenceId(id) ? [referenceId(id)!] : []);
        metadata.klingMultiPrompt = metadata.klingMultiPrompt?.flatMap((item) => {
            const textNodeId = referenceId(item.textNodeId);
            return textNodeId ? [{ ...item, textNodeId }] : [];
        });
        metadata.klingElementList = metadata.klingElementList?.flatMap((item) => {
            const nodeIds = item.nodeIds?.flatMap((id) => referenceId(id) ? [referenceId(id)!] : []) || [];
            return nodeIds.length ? [{ ...item, nodeIds }] : [];
        });
        const rewriteMentions = (text?: string) => text?.replace(/@\[node:([^\]]+)\]/g, (_, id: string) => {
            const nextId = referenceId(id);
            return nextId ? `@[node:${nextId}]` : "";
        });
        metadata.prompt = rewriteMentions(metadata.prompt);
        metadata.composerContent = rewriteMentions(metadata.composerContent);
        if (node.type === CanvasNodeType.Config) metadata.content = rewriteMentions(metadata.content);
        const inputUrls = new Set(inputs.map((input) => input.metadata?.content).filter(Boolean));
        metadata.references = metadata.references?.filter((url) => inputUrls.has(url));
    }
    return { nodes: copiedNodes, connections: copiedConnections, idMap };
}
