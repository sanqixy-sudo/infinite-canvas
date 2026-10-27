"use client";

import { Modal } from "antd";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { getNodeBounds } from "../utils/canvas-group";

export function CanvasLayoutPreview({ nodes, connections, onApply, onClose }: {
    nodes: CanvasNodeData[]; connections: CanvasConnection[]; onApply: () => void; onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const visibleNodes = nodes.filter((node) => {
        const root = byId.get(node.metadata?.batchRootId || "");
        return !root?.metadata?.isBatchRoot || root.metadata.imageBatchExpanded;
    });
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const bounds = getNodeBounds(visibleNodes.length ? visibleNodes : nodes);
    return <Modal title="整理布局预览" open centered width={880} okText="应用布局" cancelText="取消" onOk={onApply} onCancel={onClose}>
        <p className="mb-4 text-sm" style={{ color: theme.node.muted }}>沿连线整理节点；组合整体移动，保留原有尺寸和内容。确认后可用撤销恢复。</p>
        <svg role="img" aria-label="整理后的画布布局预览" className="h-[min(55vh,480px)] w-full rounded-xl" style={{ background: theme.canvas.background }} viewBox={`${bounds.left - 40} ${bounds.top - 40} ${Math.max(1, bounds.right - bounds.left + 80)} ${Math.max(1, bounds.bottom - bounds.top + 80)}`}>
            {visibleNodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => <rect key={node.id} x={node.position.x} y={node.position.y} width={node.width} height={node.height} rx={12} fill={theme.node.fill} stroke={theme.node.stroke} />)}
            {connections.map((edge) => {
                if (!visibleIds.has(edge.fromNodeId) || !visibleIds.has(edge.toNodeId)) return null;
                const from = byId.get(edge.fromNodeId), to = byId.get(edge.toNodeId);
                return from && to ? <line key={edge.id} x1={from.position.x + from.width} y1={from.position.y + from.height / 2} x2={to.position.x} y2={to.position.y + to.height / 2} stroke={theme.node.muted} strokeWidth={2} /> : null;
            })}
            {visibleNodes.filter((node) => node.type !== CanvasNodeType.Group).map((node) => <g key={node.id}>
                <rect x={node.position.x} y={node.position.y} width={node.width} height={node.height} rx={10} fill={theme.node.panel} stroke={theme.node.stroke} strokeWidth={2} />
                <text x={node.position.x + node.width / 2} y={node.position.y + node.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(22, node.width / 9)} fill={theme.node.text}>{node.title.slice(0, 12)}</text>
            </g>)}
        </svg>
    </Modal>;
}
