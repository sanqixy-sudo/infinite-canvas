"use client";

import { useEffect, useState } from "react";
import { FileText, Film, ImageIcon, Music2 } from "lucide-react";
import { resolveImageUrl } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "../../../../types";

export function ProductionReferencePreview({ node, className = "" }: { node: CanvasNodeData; className?: string }) {
    const token = useUserStore((state) => state.token);
    const version = useUserStore((state) => state.sessionVersion);
    const image = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama;
    const content = node.metadata?.content || "", storageKey = node.metadata?.storageKey;
    const [preview, setPreview] = useState<{ node: CanvasNodeData; token: string; version: number; url: string } | null>(null);
    const url = preview?.node === node && preview.token === token && preview.version === version ? preview.url : "";
    useEffect(() => {
        let active = true;
        if (image) void resolveImageUrl(storageKey, content)
            .then((url) => { if (active) setPreview({ node, token, version, url }); })
            .catch(() => { if (active) setPreview({ node, token, version, url: "" }); });
        return () => { active = false; };
    }, [node, image, storageKey, content, token, version]);
    const Icon = node.type === CanvasNodeType.Text ? FileText : node.type === CanvasNodeType.Audio ? Music2 : node.type === CanvasNodeType.Video ? Film : ImageIcon;
    return <span className={`flex size-full items-center justify-center overflow-hidden text-muted-foreground ${className}`}>
        {image && url ? <img src={url} alt={node.title} loading="lazy" className="size-full object-contain" onError={() => setPreview((value) => value?.node === node && value.token === token && value.version === version ? { ...value, url: "" } : value)} /> : <Icon className="size-5" aria-label={image ? "图片预览暂不可用" : node.title} />}
    </span>;
}
