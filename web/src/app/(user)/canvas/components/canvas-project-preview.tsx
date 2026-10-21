"use client";

import { useEffect, useState } from "react";
import { Layers3, Music2, Quote, Video } from "lucide-react";
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

    return <div className={cn("relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted/40 text-muted-foreground", className)} style={!url ? { backgroundImage: "radial-gradient(var(--border) 0.8px, transparent 0.8px)", backgroundSize: "16px 16px" } : undefined}>
        {url ? video
            ? <video src={url} muted playsInline preload="metadata" className="size-full object-cover" aria-label={`${project.title}视频预览`} onError={() => setPreview({ node: media, token, url: "" })} />
            : <img src={url} alt={`${project.title}内容预览`} loading="lazy" className="size-full object-cover" onError={() => setPreview({ node: media, token, url: "" })} />
            : text ? <div className="mx-6 max-w-[85%] rounded-lg border border-border/70 bg-card px-5 py-4"><Quote className="mb-2 size-4 text-primary/50" /><p className="line-clamp-3 whitespace-pre-wrap text-left text-xs leading-6 text-foreground/75">{text}</p></div>
                : <div className="flex flex-col items-center gap-3.5">
                    <div className="relative flex size-[66px] items-center justify-center rounded-xl border border-primary/15 bg-card text-primary/65">
                        <span aria-hidden="true" className="absolute -left-3 -top-2 h-14 w-12 -rotate-12 rounded-lg border border-primary/10 bg-card/70" />
                        {hasAudio ? <Music2 className="relative size-6" strokeWidth={1.3} /> : video ? <Video className="relative size-6" strokeWidth={1.3} /> : <Layers3 className="relative size-6" strokeWidth={1.3} />}
                    </div>
                    <span className="text-[10px] tracking-wide text-muted-foreground">{media ? "内容预览暂不可用" : project.nodes.length ? "画布内容" : "空白画布 · 等待一个灵感"}</span>
                </div>}
        {url && video ? <span className="absolute bottom-3 right-3 rounded bg-background/90 p-1.5 text-foreground"><Video className="size-3.5" /></span> : null}
    </div>;
}
