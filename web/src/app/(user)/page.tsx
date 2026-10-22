"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, FolderOpen, ImageIcon, Layers3, MousePointer2, Play, Plus, Sparkles, Tag } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { loginHrefForPath } from "@/lib/auth-navigation";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import CreationShowcase from "./components/creation-showcase";
import LandingFaq from "./components/landing-faq";
import styles from "./landing.module.css";

export default function HomePage() {
    const user = useUserStore((state) => state.user);
    const ready = useUserStore((state) => state.isReady);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const startHref = ready && user ? "/workspace" : loginHrefForPath("/workspace");

    return <div className={`${styles.page} h-full overflow-y-auto scroll-smooth bg-background text-foreground motion-reduce:scroll-auto`}>
        <div id="home-top" aria-hidden="true" />
        <a href="#main-content" className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4">跳到主要内容</a>
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-md">
            <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between gap-3 px-5 sm:h-20 sm:px-9 lg:px-12">
            <a href="#home-top" aria-label="返回首页顶部" className="flex min-w-0 items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                <BrandMark className="size-8 shrink-0 sm:size-9" />
                <span><strong className="block whitespace-nowrap text-sm font-semibold tracking-tight sm:text-[15px]">小盟视频工作台</strong><span className="mt-0.5 block text-[8px] tracking-[0.22em] text-muted-foreground">XIAOMENG STUDIO</span></span>
            </a>
            <nav aria-label="首页导航" className="hidden items-center gap-4 whitespace-nowrap text-[13px] text-muted-foreground md:flex xl:gap-8">{[{ href: "#home-top", title: "产品概览" }, { href: "#capabilities", title: "创作空间" }, { href: "#creation", title: "功能演示" }, { href: "#workflow", title: "工作流程" }, { href: "#questions", title: "常见问题" }].map((item) => <a key={item.href} href={item.href} className="py-2 transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{item.title}</a>)}</nav>
            <div className="flex shrink-0 items-center gap-1 sm:gap-4">
                <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground [&_svg]:size-4" aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
                <Link href={startHref} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-xs sm:px-4 font-medium transition hover:border-foreground/40 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{ready && user ? "进入工作台" : "登录"}<ArrowUpRight className="hidden size-3.5 sm:block" /></Link>
            </div>
            </div>
        </header>

        <main id="main-content" className="mx-auto max-w-[1440px] scroll-mt-24 px-5 sm:scroll-mt-28 sm:px-9 lg:px-12">
            <section className={styles.hero} aria-labelledby="home-title">
                <div className={styles.intro}>
                    <p className="inline-flex items-center gap-2.5 text-xs font-medium tracking-wide text-muted-foreground"><span className="size-1.5 rounded-full bg-foreground" />无限画布 · AI 影像创作空间</p>
                    <h1 id="home-title" className={styles.title}>让灵感相连，<br /><span className="text-muted-foreground">让故事成片。</span></h1>
                    <p className="mt-6 max-w-[360px] text-[15px] leading-[1.9] text-muted-foreground sm:mt-7 sm:text-base">从一句想法到一组镜头，<br />把文字、画面与视频连接在同一张画布。<br />让每次创作，都有迹可循。</p>
                    <div className="mt-8 flex flex-wrap items-center gap-5 sm:mt-9">
                        <Link href={startHref} className="group inline-flex min-h-12 items-center gap-8 rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">进入创作空间<ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" /></Link>
                        <a href="#creation" className="inline-flex min-h-12 items-center gap-2 text-[13px] text-muted-foreground transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><span className="flex size-7 items-center justify-center rounded-full border border-border"><Play className="ml-0.5 size-3" /></span>看看如何创作</a>
                    </div>
                    <div className="mt-9 flex items-center gap-3 text-xs text-muted-foreground"><span className="flex size-8 items-center justify-center rounded-lg border border-border"><Layers3 className="size-4" strokeWidth={1.4} /></span><span>一个项目，多张画布。<br /><span className="mt-1 block text-[11px] opacity-80">属于你的创作工作室</span></span></div>
                </div>
                <figure className={`${styles.preview} min-w-0`} aria-label="从灵感脚本到分镜与影像的画布流程示意">
                    <div className="mb-3 flex items-center justify-between px-1 text-[10px] tracking-[0.12em] text-muted-foreground"><span>灵感，由此展开</span><span className="font-mono tracking-[0.18em]">THE CREATIVE CANVAS</span></div>
                    <div className={styles.frame}>
                        <div className="flex h-12 items-center justify-between gap-3 border-b border-border/70 px-4 sm:px-5"><span className="flex items-center gap-2 text-xs font-medium"><FolderOpen className="size-3.5 text-muted-foreground" />城市来信<span className="ml-1 hidden rounded border border-border px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground sm:inline">创作示意</span></span><span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="size-1 rounded-full bg-current" />无限画布</span></div>
                        <div className={styles.canvas}>
                            <svg className="pointer-events-none absolute inset-0 size-full text-muted-foreground/60" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M49 24H51Q55 24 55 32V48H58M49 71H51Q55 71 55 63V52Q55 48 58 48" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></svg>
                            <div className="relative flex min-w-0 flex-col gap-4 sm:gap-5">
                                <div className="relative"><span className={`${styles.port} -right-[3px] top-1/2`} aria-hidden="true" /><div className={`${styles.node} p-3 sm:p-3.5`}><div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span className="font-serif text-sm italic">T</span>灵感脚本<span className="ml-auto font-mono opacity-60">01</span></div><p className="!mb-0 text-xs font-medium leading-[1.8] sm:text-[14px]">日落之后，<br />城市开始讲故事。</p></div></div>
                                <div className="relative"><span className={`${styles.port} -right-[3px] top-1/2`} aria-hidden="true" /><div className={styles.node}><div className="flex items-center justify-between px-3 py-2.5 text-[10px] text-muted-foreground"><span>分镜参考</span><span className="font-mono opacity-60">02</span></div><div className="mx-1.5 aspect-[1.6] overflow-hidden rounded-md"><img src="/showcase/storyboard-city.webp" alt="" width={800} height={500} decoding="async" className="block size-full object-cover" /></div><p className="!mb-0 px-3 py-2.5 text-[9px] leading-4 text-muted-foreground">远景 · 暮色里的城市</p></div></div>
                            </div>
                            <div className="relative mt-6 min-w-0"><span className={`${styles.port} -left-[3px] top-1/2`} aria-hidden="true" /><div className={styles.node}><div className="flex items-center gap-1.5 px-3 py-2.5 text-[10px] text-muted-foreground"><Play className="size-3" />影像片段<span className="ml-auto font-mono opacity-60">03</span></div><div className="relative mx-1.5 aspect-[.82] overflow-hidden rounded-md sm:aspect-[.86]"><img src="/showcase/film-city.webp" alt="" width={800} height={800} decoding="async" className="block size-full object-cover object-[45%_center]" /><span className="absolute inset-0 flex items-center justify-center" aria-hidden="true"><span className="flex size-9 items-center justify-center rounded-full border border-white/40 bg-black/20 text-white backdrop-blur-sm sm:size-11"><Play className="ml-0.5 size-4" fill="currentColor" /></span></span></div><div className="flex items-center justify-between px-3 py-3 text-[9px] text-muted-foreground"><span>城市来信 / 镜头 01</span><span>预览帧</span></div></div></div>
                        </div>
                        <div className="flex items-center justify-between border-t border-border/70 px-4 py-3 text-[10px] text-muted-foreground sm:px-5"><span className="flex items-center gap-2"><span className="flex items-center gap-1"><Plus className="size-3" />节点</span><span className="mx-1 h-3 w-px bg-border" /><Layers3 className="size-3" />画布 01</span><span className="flex items-center gap-1.5"><MousePointer2 className="size-3" />继续你的故事</span></div>
                    </div>
                    <figcaption className="mt-4 flex items-center justify-between gap-3 text-[10px] leading-5 text-muted-foreground"><span className="inline-flex items-center gap-2"><span className="h-px w-5 bg-border" />从灵感，到画面，再到故事</span><span>创作流程示意</span></figcaption>
                </figure>
            </section>

            <section id="capabilities" aria-label="你的创作空间" className={styles.benefits}>
                {[
                    { Icon: Layers3, title: "让创作，沿着项目展开", text: "一个项目组织多张画布，灵感、分镜与不同版本各有位置。" },
                    { Icon: Sparkles, title: "让模型，融入创作过程", text: "在画布中选用平台开放的模型，连接文字、图像与视频。" },
                    { Icon: FolderOpen, title: "让素材，成为下一次起点", text: "多级目录与标签整理素材，按你的偏好保存在浏览器或账号素材库。" },
                ].map(({ Icon, title, text }) => <div key={title} className="flex items-start gap-4"><Icon className="mt-1 size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.4} /><div><h2 className="text-sm font-medium sm:text-[15px]">{title}</h2><p className="mt-2 max-w-[310px] text-xs leading-[1.9] text-muted-foreground">{text}</p></div></div>)}
            </section>

            <CreationShowcase />

            <section id="workflow" aria-labelledby="workflow-title" className={styles.workflow}>
                <div className="mb-9 flex flex-wrap items-end justify-between gap-5 sm:mb-12"><div><p className={styles.eyebrow}>从灵感到作品 · 创作路径</p><h2 id="workflow-title" className={styles.sectionTitle}>创作的每一步，<br className="sm:hidden" />都在同一个空间。</h2></div><Link href={startHref} className="inline-flex min-h-10 items-center gap-3 text-sm font-medium underline decoration-border underline-offset-8 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring">开始第一张画布<ArrowUpRight className="size-4" /></Link></div>
                <ol className={styles.workflowSteps}>
                    <li>
                        <div className={styles.stepVisual} aria-label="一个项目组织多张画布的示意">
                            <div className={styles.projectStack}>
                                <div className={styles.projectName}><FolderOpen size={18} strokeWidth={1.5} /><span>我的第一部作品</span><span className="ml-auto font-mono text-[10px] text-muted-foreground">PROJECT</span></div>
                                <div className={styles.canvasBranch}><span><Layers3 size={15} />灵感与脚本</span><span><Layers3 size={15} />分镜与画面</span></div>
                            </div>
                            <span className={styles.visualCaption}>一个项目，多张画布</span>
                        </div>
                        <div className={styles.stepCopy}><span>01</span><div><h3>给灵感一个位置</h3><p>用项目收拢想法，用多张画布展开场景、章节和不同的创作方向。</p></div></div>
                    </li>
                    <li>
                        <div className={styles.stepVisual} aria-label="文字和图像节点相连的示意">
                            <div className={styles.nodePath}><span className={styles.textTile}><span className="font-serif text-lg italic">T</span><span>日落之后，<br />故事才刚刚开始。</span></span><span className={styles.pathLine} aria-hidden="true"><ArrowRight size={13} /></span><div className={styles.imageTile}><img src="/showcase/storyboard-city.webp" width={800} height={500} alt="" loading="lazy" /><span><ImageIcon size={12} />城市分镜</span></div></div>
                            <span className={styles.visualCaption}>文字、图像、视频在此相连</span>
                        </div>
                        <div className={styles.stepCopy}><span>02</span><div><h3>把想法连接成画面</h3><p>添加文字与参考素材，选择平台开放的模型，在画布里推敲每个镜头。</p></div></div>
                    </li>
                    <li>
                        <div className={styles.stepVisual} aria-label="素材目录与标签的示意">
                            <div className={styles.libraryPreview}><div className="flex items-center gap-2 text-xs"><FolderOpen size={14} />城市影像<span className="ml-auto text-muted-foreground">素材收藏</span></div><div className={styles.libraryImages}><img src="/showcase/storyboard-city.webp" width={800} height={500} alt="" loading="lazy" /><img src="/showcase/film-city.webp" width={800} height={800} alt="" loading="lazy" /></div><span className="flex items-center gap-2 text-[10px] text-muted-foreground"><Tag size={11} />城市 / 暮色 / 故事</span></div>
                            <span className={styles.visualCaption}>好素材，带进下一次创作</span>
                        </div>
                        <div className={styles.stepCopy}><span>03</span><div><h3>让好结果积累下来</h3><p>用文件夹与标签整理素材，按偏好保存在当前浏览器或账号素材库。</p></div></div>
                    </li>
                </ol>
                <p className="!mb-0 mt-5 text-right text-[11px] text-muted-foreground">创作结构示意 · 影像用于展示</p>
            </section>

            <LandingFaq />

            <section className={styles.closing} aria-labelledby="closing-title">
                <img src="/showcase/storyboard-city.webp" width={800} height={500} alt="" loading="lazy" className={styles.closingImage} />
                <div className={styles.closingCopy}><span className="mb-7 flex items-center gap-3 text-[10px] tracking-[.18em] text-white/70"><BrandMark className="size-6" />XIAOMENG STUDIO</span><h2 id="closing-title">故事还未开始。<br />画布，已经准备好了。</h2><p>给下一次灵感，留一个可以展开的空间。</p><Link href={startHref} className="group mt-7 inline-flex min-h-12 items-center gap-8 rounded-xl bg-white px-6 text-sm font-medium text-neutral-950 transition hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">开始创作<ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" /></Link></div>
                <div className={styles.closingFootnote}><span>项目 · 画布 · 素材</span><span>为你的下一部作品而来</span></div>
            </section>
        </main>
        <footer className="border-t border-border"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-7 text-[10px] text-muted-foreground sm:px-9 lg:px-12"><span className="flex items-center gap-2"><BrandMark className="size-4" />小盟视频工作台</span><span className="text-[8px] tracking-[0.16em]">XIAOMENG STUDIO · MADE FOR YOUR NEXT IDEA</span></div></footer>
    </div>;
}

