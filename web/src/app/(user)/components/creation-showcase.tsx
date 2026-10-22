"use client";

import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

const demos = [
    { id: "director", title: "3D 导演台", text: "用空间中的位置与视角，推敲画面构图。" },
    { id: "camera-timeline", title: "运镜时间轴", text: "沿时间组织镜头，预览画面的运动变化。" },
    { id: "canvas-agent", title: "画布 Agent", text: "在画布上下文中，展开对话与创作步骤。" },
    { id: "panorama", title: "全景创作", text: "在全景视野里，探索不同的取景方向。" },
] as const;

export default function CreationShowcase() {
    const frameRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [active, setActive] = useState(0);
    const [hasEntered, setHasEntered] = useState(false);
    const [inView, setInView] = useState(false);
    const [pageVisible, setPageVisible] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(true);
    const [intent, setIntent] = useState<"auto" | "play" | "pause">("auto");
    const [playing, setPlaying] = useState(false);
    const [failed, setFailed] = useState(false);
    const [playbackBlocked, setPlaybackBlocked] = useState(false);
    const [playAttempt, setPlayAttempt] = useState(0);
    const demo = demos[active];
    const wantsPlayback = intent === "play" || intent === "auto" && !reducedMotion;

    useEffect(() => {
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        const updateMotion = () => setReducedMotion(preference.matches);
        const updateVisibility = () => setPageVisible(!document.hidden);
        updateMotion();
        updateVisibility();
        preference.addEventListener("change", updateMotion);
        document.addEventListener("visibilitychange", updateVisibility);
        return () => {
            preference.removeEventListener("change", updateMotion);
            document.removeEventListener("visibilitychange", updateVisibility);
        };
    }, []);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        if (!("IntersectionObserver" in window)) {
            setHasEntered(true);
            setInView(true);
            return;
        }
        const observer = new IntersectionObserver(([entry]) => {
            setInView(entry.isIntersecting && entry.intersectionRatio >= 0.25);
            if (entry.isIntersecting) setHasEntered(true);
        }, { threshold: 0.25 });
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        let cancelled = false;
        if (!hasEntered || !inView || !pageVisible || !wantsPlayback || failed) {
            video.pause();
            return;
        }
        void video.play().catch((error: unknown) => {
            if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
                setPlaying(false);
                setPlaybackBlocked(true);
            }
        });
        return () => {
            cancelled = true;
            video.pause();
        };
    }, [active, failed, hasEntered, inView, pageVisible, playAttempt, wantsPlayback]);

    const selectDemo = (index: number) => {
        const next = (index + demos.length) % demos.length;
        if (next === active) return;
        videoRef.current?.pause();
        setActive(next);
        setPlaying(false);
        setFailed(false);
        setPlaybackBlocked(false);
    };

    const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let next: number;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % demos.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + demos.length - 1) % demos.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = demos.length - 1;
        else return;
        event.preventDefault();
        selectDemo(next);
        buttonRefs.current[next]?.focus();
    };

    const togglePlayback = () => {
        if (playing) {
            setIntent("pause");
            videoRef.current?.pause();
        } else {
            setHasEntered(true);
            setPlaybackBlocked(false);
            setIntent("play");
            setPlayAttempt((attempt) => attempt + 1);
        }
    };

    const retry = () => {
        setFailed(false);
        setPlaybackBlocked(false);
        setIntent("play");
        videoRef.current?.load();
    };

    return (
        <section aria-labelledby="creation-title" className="py-14 sm:py-20">
            <div id="creation" className="mb-8 flex flex-wrap items-end justify-between gap-4 sm:mb-10">
                <div>
                    <p className="mb-4 flex items-center gap-3 text-xs text-muted-foreground"><span aria-hidden="true" className="h-px w-6 bg-foreground/35" />功能演示</p>
                    <h2 id="creation-title" className="text-[28px] font-medium leading-[1.4] tracking-[-0.01em] sm:text-[36px]">在画布里，完成更多创作</h2>
                </div>
                <p className="max-w-[310px] text-sm leading-7 text-muted-foreground">从构图、运镜到创作辅助，<br className="hidden sm:block" />看看灵感如何在画布上展开。</p>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-8">
                <figure className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
                    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-3 sm:px-4">
                        <div className="flex min-w-0 items-center gap-2.5 text-[11px] sm:text-xs">
                            <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded bg-muted"><span className="size-2.5 rounded-[2px] border border-foreground/50" /></span>
                            <span className="shrink-0 text-muted-foreground">小盟创作画布</span>
                            <span aria-hidden="true" className="text-muted-foreground/50">/</span>
                            <span className="truncate font-medium">{demo.title}</span>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground"><span aria-hidden="true" className={`size-1 rounded-full ${playing ? "bg-foreground" : "bg-muted-foreground/50"}`} />{playing ? "播放中" : "功能演示"}</span>
                    </div>
                    <div ref={frameRef} className="relative aspect-video overflow-hidden bg-muted/40" id="creation-demo-player">
                        <video
                            ref={videoRef}
                            src={hasEntered ? `/showcase/${demo.id}.mp4` : undefined}
                            poster={`/showcase/${demo.id}.jpg`}
                            preload="none"
                            muted
                            playsInline
                            disablePictureInPicture
                            className="size-full object-contain"
                            aria-label={`${demo.title}功能演示，无音频`}
                            onPlay={() => { setPlaying(true); setPlaybackBlocked(false); }}
                            onPause={() => setPlaying(false)}
                            onEnded={() => {
                                setPlaying(false);
                                if (!reducedMotion && intent !== "pause" && inView && pageVisible) selectDemo(active + 1);
                            }}
                            onError={() => { setFailed(true); setPlaying(false); }}
                        />
                        {failed ? (
                            <div role="alert" className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 sm:inset-x-5 sm:bottom-5">
                                <p className="text-[13px] leading-6">演示暂时无法加载，请重试。</p>
                                <button type="button" onClick={retry} className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><RotateCcw className="size-4" aria-hidden="true" />重新加载</button>
                            </div>
                        ) : null}
                    </div>
                    <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-2 py-2 sm:px-3">
                        <button type="button" onClick={togglePlayback} disabled={failed} aria-label={playing ? "暂停功能演示" : "播放功能演示"} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-[13px] font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none">
                            {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}{playing ? "暂停演示" : "播放演示"}
                        </button>
                        <div className="flex items-center gap-1">
                            <span className="mr-2 font-mono text-xs text-muted-foreground" aria-label={`第${active + 1}段，共${demos.length}段`}>0{active + 1} / 0{demos.length}</span>
                            <button type="button" aria-label="上一个功能演示" onClick={() => selectDemo(active - 1)} className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"><ArrowLeft className="size-4" aria-hidden="true" /></button>
                            <button type="button" aria-label="下一个功能演示" onClick={() => selectDemo(active + 1)} className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"><ArrowRight className="size-4" aria-hidden="true" /></button>
                        </div>
                    </figcaption>
                </figure>

                <div className="min-w-0">
                    <div className="mb-3 flex items-center justify-between px-1 text-[11px] text-muted-foreground"><span>选择创作方式</span><span className="tabular-nums">{demos.length} 段演示</span></div>
                    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-1 lg:gap-2" role="group" aria-label="选择功能演示">
                    {demos.map((item, index) => (
                        <button
                            key={item.id}
                            ref={(element) => { buttonRefs.current[index] = element; }}
                            type="button"
                            aria-pressed={active === index}
                            aria-controls="creation-demo-player"
                            onClick={() => selectDemo(index)}
                            onKeyDown={(event) => selectWithKeyboard(event, index)}
                            className={`group relative grid min-w-0 items-center gap-3 overflow-hidden rounded-lg border p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none lg:grid-cols-[96px_minmax(0,1fr)] lg:p-3 ${active === index ? "border-foreground/20 bg-muted/60" : "border-transparent bg-transparent hover:border-border/70 hover:bg-muted/35"}`}
                        >
                            <span aria-hidden="true" className={`absolute inset-y-3 left-0 w-0.5 rounded-full bg-foreground transition-opacity motion-reduce:transition-none ${active === index ? "opacity-100" : "opacity-0"}`} />
                            <span aria-hidden="true" className="relative block aspect-video w-full overflow-hidden rounded-[5px] bg-muted lg:h-[54px] lg:w-24">
                                <img src={`/showcase/${item.id}.jpg`} width={160} height={90} loading="lazy" decoding="async" alt="" className={`size-full object-cover transition-opacity motion-reduce:transition-none ${active === index ? "opacity-100" : "opacity-75 group-hover:opacity-100"}`} />
                                <span className="absolute bottom-1 right-1 rounded-sm bg-background/85 px-1 font-mono text-[9px] leading-4 text-foreground">0{index + 1}</span>
                            </span>
                            <span className="min-w-0"><span className="flex items-center justify-between gap-2 text-[13px] font-medium sm:text-sm">{item.title}<ArrowRight aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground transition-opacity motion-reduce:transition-none ${active === index ? "opacity-100" : "opacity-0 group-hover:opacity-70"}`} /></span><span className="mt-1 block text-[11px] leading-5 text-muted-foreground sm:text-xs">{item.text}</span></span>
                        </button>
                    ))}
                    </div>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-between gap-x-6 gap-y-1 text-xs leading-6 text-muted-foreground">
                <p>{playbackBlocked ? "点击“播放演示”继续观看。" : reducedMotion ? playing ? "当前片段播放结束后暂停，你可以手动选择其他演示。" : "已按减少动态效果偏好暂停，点击播放即可观看。" : intent === "pause" ? "演示已暂停，你可以随时继续。" : "当前片段播放结束后，将继续下一段演示。"}</p>
                <p>演示内容供体验参考，实际能力以工作台开放配置为准。</p>
            </div>
        </section>
    );
}
