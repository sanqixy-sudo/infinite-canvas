"use client";

import { useEffect, useState } from "react";
import { Layers3, Music2, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";

export function CanvasProjectPreview({ project, className }: { project: CanvasProject; className?: string }) {
    const token = useUserStore((state) => state.token);
    const media = project.nodes.find((node) => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama) && (node.metadata?.content || node.metadata?.storageKey))
        || project.nodes.find((node) => node.type === CanvasNodeType.Video && (node.metadata?.content || node.metadata?.storageKey));
    const content = media?.metadata?.content || "";
    const storageKey = media?.metadata?.storageKey;
    const video = media?.type === CanvasNodeType.Video;
    const [preview, setPreview] = useState<{ node?: CanvasNodeData; token: string; url: string }>({ token: "", url: "" });
    const url = preview.node === media && preview.token === token ? preview.url : "";
    const text = project.nodes.find((node) => node.type === CanvasNodeType.Text && node.metadata?.content)?.metadata?.content;
    const hasAudio = project.nodes.some((node) => node.type === CanvasNodeType.Audio);

    useEffect(() => {
        let active = true;
        if (media) void (video ? resolveMediaUrl(storageKey, content) : resolveImageUrl(storageKey, content))
            .then((url) => { if (active) setPreview({ node: media, token, url }); })
            .catch(() => { if (active) setPreview({ node: media, token, url: "" }); });
        return () => { active = false; };
    }, [content, media, storageKey, token, video]);

    return <div className={cn("relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-muted/60 text-muted-foreground", className)}>
        {url ? video
            ? <video src={url} muted playsInline preload="metadata" className="size-full object-cover" aria-label={`${project.title}视频预览`} onError={() => setPreview({ node: media, token, url: "" })} />
            : <img src={url} alt={`${project.title}内容预览`} loading="lazy" className="size-full object-cover" onError={() => setPreview({ node: media, token, url: "" })} />
            : text ? <p className="line-clamp-4 max-w-[80%] whitespace-pre-wrap text-left text-sm leading-6 text-foreground/65">{text}</p>
                : <div className="flex flex-col items-center gap-2">{hasAudio ? <Music2 className="size-7 opacity-50" /> : video ? <Video className="size-7 opacity-50" /> : <Layers3 className="size-7 opacity-40" />}<span className="text-xs">{media ? "内容预览暂不可用" : project.nodes.length ? "画布内容" : "空白画布"}</span></div>}
        {url && video ? <span className="absolute bottom-3 right-3 rounded bg-background/90 p-1.5 text-foreground"><Video className="size-3.5" /></span> : null}
    </div>;
}
