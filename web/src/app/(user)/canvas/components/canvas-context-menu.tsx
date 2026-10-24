"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BetweenHorizontalStart, FolderPlus, GalleryHorizontal, GalleryHorizontalEnd, Plus, Link2, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState } from "../types";
import { isCanvasImageNodeType } from "../utils/canvas-panorama";
import { useCanvasAssetSaveState } from "../hooks/use-canvas-asset-save-state";
import type { VideoFramePosition } from "../utils/canvas-video-frame";

export function CanvasNodeContextMenu({ menu, node, saving, onSaveAsset, canCaptureVideoFrame, onClose, onCaptureVideoFrame, onDuplicate, onDuplicateWithReferences, onDelete }: { menu: ContextMenuState; node: CanvasNodeData | null; saving: boolean; onSaveAsset: () => void; canCaptureVideoFrame: boolean; onClose: () => void; onCaptureVideoFrame: (position: VideoFramePosition) => void; onDuplicate: () => void; onDuplicateWithReferences: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x: menu.x, y: menu.y });
    useLayoutEffect(() => {
        const fit = () => {
            const rect = menuRef.current?.getBoundingClientRect();
            if (rect) setPosition({ x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)) });
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [menu.x, menu.y]);
    const storage = useCanvasAssetSaveState(node, saving);
    const canSave = Boolean(node?.metadata?.content && (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio || isCanvasImageNodeType(node.type)));

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="fixed z-[80] max-h-[calc(100dvh-16px)] min-w-44 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border py-1 shadow-2xl"
            style={{ left: position.x, top: position.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {canSave ? <><p className="px-3 py-2 text-[10px]" style={{ color: theme.node.muted }} title={storage.detail}>{storage.label}</p><MenuButton icon={<FolderPlus className="size-4" />} label={storage.saved ? "已存入账号素材库" : "存入账号素材库"} onClick={onSaveAsset} disabled={saving || storage.saved} /><div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} /></> : null}
            {canCaptureVideoFrame ? (
                <>
                    <MenuButton icon={<BetweenHorizontalStart className="size-4" />} label="截取首帧" onClick={() => onCaptureVideoFrame("first")} />
                    <MenuButton icon={<GalleryHorizontalEnd className="size-4" />} label="截取尾帧" onClick={() => onCaptureVideoFrame("last")} />
                    <MenuButton icon={<GalleryHorizontal className="size-4" />} label="截取当前帧" onClick={() => onCaptureVideoFrame("current")} />
                    <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                </>
            ) : null}
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label="复制" onClick={onDuplicate} /> : null}
            {menu.type === "node" ? <MenuButton icon={<Link2 className="size-4" />} label="保留参考创建副本" onClick={onDuplicateWithReferences} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false, disabled = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" disabled={disabled} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
