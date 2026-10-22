"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, FolderOpen, Layers3, MousePointer2, Play, Plus, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { loginHrefForPath } from "@/lib/auth-navigation";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import CreationShowcase from "./components/creation-showcase";
import styles from "./landing.module.css";

const questions = [
    { title: "如何开始第一部作品？", text: "登录后进入工作台，新建项目即可打开第一张画布。你可以添加文字、导入参考素材，再选择平台开放的模型开始创作。" },
    { title: "需要自己配置模型密钥吗？", text: "无需在浏览器填写供应商密钥。模型由平台统一配置，可用能力与使用方式以工作台实际开放清单为准。" },
    { title: "我的素材保存在哪里？", text: "在个人中心的“存储设置”选择默认保存位置：当前浏览器，或账号素材库。保存在当前浏览器的文件只在该浏览器可用；账号素材库使用平台配置的存储空间。" },
    { title: "创作和存储如何查看用量？", text: "登录后可在工作台查看算力余额与个人空间，在钱包查看记录、申请充值或扩容。实际套餐和模型计费以平台开放配置为准。" },
];

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
            <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between gap-3 px-5 sm:h-24 sm:px-9 lg:px-12">
            <a href="#home-top" aria-label="返回首页顶部" className="flex min-w-0 items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                <BrandMark className="size-8 shrink-0 sm:size-9" />
                <span><strong className="block whitespace-nowrap text-sm font-semibold tracking-tight sm:text-[15px]">小盟视频工作台</strong><span className="mt-0.5 block text-[8px] tracking-[0.22em] text-muted-foreground">XIAOMENG STUDIO</span></span>
            </a>
            <nav aria-label="首页导航" className="hidden items-center gap-8 text-[13px] text-muted-foreground md:flex"><a href="#creation" className="py-2 transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">创作方式</a><a href="#workflow" className="py-2 transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">工作流程</a><a href="#questions" className="py-2 transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">常见问题</a></nav>
            <div className="flex shrink-0 items-center gap-1 sm:gap-4">
                <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground [&_svg]:size-4" aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
                <Link href={startHref} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-xs font-medium transition hover:border-foreground/40 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{ready && user ? "进入工作台" : "登录"}<ArrowUpRight className="hidden size-3.5 sm:block" /></Link>
            </div>
            </div>
        </header>

        <main id="main-content" className="mx-auto max-w-[1280px] scroll-mt-24 px-5 sm:scroll-mt-28 sm:px-9 lg:px-12">
            <section className="relative grid items-center gap-10 pb-14 pt-9 sm:pb-16 sm:pt-10 lg:grid-cols-[1fr_1.08fr] lg:gap-12 lg:pb-16 lg:pt-8">
                <div className={styles.intro}>
                    <p className="mb-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px w-7 bg-foreground/50" />为每一个想表达的你</p>
                    <h1 className="text-[clamp(2.25rem,4.45vw,4rem)] font-semibold leading-[1.25] tracking-[-0.015em]">打开画布。<br /><span className="text-muted-foreground">展开你的</span><br />下一部作品。</h1>
                    <p className="mt-6 max-w-[360px] text-sm leading-7 text-muted-foreground sm:text-[15px]">从一个想法，到一组镜头。<br />在无限画布里连接文字、图像与视频，<br className="hidden sm:block" />让创作的每一步，都在同一个空间发生。</p>
                    <div className="mt-7 flex flex-wrap items-center gap-5">
                        <Link href={startHref} className="group inline-flex min-h-12 items-center gap-8 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">开始使用<ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" /></Link>
                        <a href="#workflow" className="inline-flex min-h-12 items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">向下了解创作流程<ArrowDown className="size-3.5" /></a>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">一个项目 · 多张画布 · 你的创作空间</p>
                </div>
                <figure className={`${styles.preview} mx-auto w-full min-w-0 max-w-[580px] lg:max-w-none`} aria-label="从灵感脚本到分镜与影像的画布流程示意">
                    <div className="mb-3 flex items-center justify-between px-1 text-xs text-muted-foreground"><span>灵感，由此展开</span><span className="flex items-center gap-1.5"><span className="size-1 rounded-full bg-foreground/60" />创作流程示意</span></div>
                    <div className={`relative isolate overflow-hidden rounded-[24px] border border-border/80 bg-card ${styles.frame}`}>
                        <div className="flex h-10 items-center gap-1.5 border-b border-border/70 px-4"><span className="size-1.5 rounded-full bg-foreground/35" /><span className="size-1.5 rounded-full bg-foreground/20" /><span className="size-1.5 rounded-full bg-foreground/10" /><span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"><FolderOpen className="size-3" />我的第一部作品</span></div>
                        <div className={`relative grid w-full grid-cols-[.95fr_1.05fr] items-start gap-x-[7%] gap-y-5 px-[5%] pb-14 pt-6 sm:gap-y-6 sm:pt-8 ${styles.canvas}`}>
                            <svg className="pointer-events-none absolute inset-0 size-full text-muted-foreground/50" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M44 24H46Q48 24 48 30V44Q48 49 52 49M44 70H46Q48 70 48 64V54Q48 49 52 49" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></svg>
                            <div className={`relative col-start-1 row-start-1 rounded-xl border border-border bg-background p-3 sm:p-4 ${styles.node}`}>
                                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="text-sm font-serif italic">T</span>灵感脚本</div>
                                <p className="text-xs font-medium leading-6 sm:text-sm">日落之后，<br />城市开始讲故事。</p>
                            </div>
                            <div className={`relative col-start-1 row-start-2 overflow-hidden rounded-xl border border-border bg-background ${styles.node}`} style={{ animationDelay: "100ms" }}>
                                <div className="px-3 py-2.5 text-[11px] text-muted-foreground">分镜参考</div><div className="mx-2 mb-2 aspect-[1.6] overflow-hidden rounded-md"><StoryFrame /></div>
                            </div>
                            <div className={`relative col-start-2 row-span-2 row-start-1 self-center overflow-hidden rounded-xl border border-foreground/25 bg-background ${styles.node}`} style={{ animationDelay: "200ms" }}>
                                <div className="flex items-center gap-1.5 px-3 py-2.5 text-[11px] text-muted-foreground"><Play className="size-3" />影像片段</div><div className="relative mx-2 aspect-[1.05] overflow-hidden rounded-md"><StoryFrame close /><span className="absolute inset-0 flex items-center justify-center"><span className="flex size-9 items-center justify-center rounded-full border border-white/30 bg-black/20 text-white backdrop-blur-sm"><Play className="ml-0.5 size-3.5" fill="currentColor" /></span></span></div><div className="mx-3 mb-3 mt-2.5 flex h-2 gap-0.5">{[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <span key={value} className="flex-1 rounded-[1px] bg-foreground/15" style={{ opacity: 0.5 + value / 16 }} />)}</div>
                            </div>
                            <span className="absolute bottom-4 right-4 inline-flex items-center gap-1 text-[11px] text-muted-foreground"><MousePointer2 className="size-3.5 fill-foreground text-background" />继续你的故事</span>
                            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-muted-foreground"><Plus className="size-3" /><span className="h-3 w-px bg-border" /><Layers3 className="size-3" /></div>
                        </div>
                    </div>
                    <figcaption className="mt-4 text-right text-xs leading-5 text-muted-foreground">把分散的想法，连接成完整的表达</figcaption>
                </figure>
            </section>

            <CreationShowcase />

            <section id="workflow" aria-labelledby="workflow-title" className="scroll-mt-24 grid gap-10 rounded-[24px] border border-border bg-card px-6 py-9 sm:scroll-mt-28 sm:px-10 sm:py-12 lg:grid-cols-[0.9fr_1.2fr] lg:gap-20">
                <div><span className="mb-6 inline-flex size-10 items-center justify-center rounded-xl border border-border"><Sparkles className="size-4" strokeWidth={1.4} /></span><h2 id="workflow-title" className="text-3xl font-medium leading-[1.35] tracking-tight">从第一步开始，<br />进入创作状态。</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">先打开一个项目，再放进一个想法。<br />让画布陪你把它一点点展开。</p><Link href={startHref} className="mt-7 inline-flex min-h-10 items-center gap-7 text-xs font-medium underline decoration-border underline-offset-8 transition hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring">打开我的创作空间<ArrowUpRight className="size-4" /></Link></div>
                <ol className="divide-y divide-border">{[{ title: "建立项目", text: "给作品起个名字，按章节或场景管理多张画布。" }, { title: "连接灵感", text: "导入参考素材，添加文字与生成节点，在画布上组织思路。" }, { title: "沉淀作品", text: "将常用素材归入目录、打上标签，为下一次创作留好起点。" }].map(({ title, text }, index) => <li key={title} className="flex gap-5 py-6 first:pt-0 last:pb-0 sm:gap-8"><span className="pt-1 font-mono text-[10px] text-muted-foreground">0{index + 1}</span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{text}</p></div><Check className="ml-auto mt-1 size-3.5 shrink-0 text-muted-foreground" /></li>)}</ol>
            </section>

            <section id="questions" aria-labelledby="questions-title" className="grid scroll-mt-24 gap-8 py-16 sm:scroll-mt-28 sm:py-24 lg:grid-cols-[0.7fr_1fr] lg:gap-24"><div><p className="mb-4 text-xs text-muted-foreground">开始之前</p><h2 id="questions-title" className="text-3xl font-medium tracking-tight">你可能想了解</h2></div><div className="divide-y divide-border border-y border-border">{questions.map((question) => <details key={question.title} className="group"><summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">{question.title}<ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary><p className="max-w-xl pb-6 pr-8 text-sm leading-7 text-muted-foreground">{question.text}</p></details>)}</div></section>

            <section className="flex flex-col items-start justify-between gap-7 border-t border-border py-12 sm:flex-row sm:items-center sm:py-16"><div><p className="mb-3 text-xs text-muted-foreground">留白，是为了下一次创作。</p><h2 className="text-[27px] font-medium tracking-tight sm:text-[32px]">你的下一部作品，从这里开始。</h2></div><Link href={startHref} className="inline-flex min-h-12 shrink-0 items-center gap-8 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">开始使用<ArrowRight className="size-4" /></Link></section>
        </main>
        <footer className="border-t border-border"><div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-5 py-7 text-[10px] text-muted-foreground sm:px-9 lg:px-12"><span className="flex items-center gap-2"><BrandMark className="size-4" />小盟视频工作台</span><span className="text-[8px] tracking-[0.16em]">XIAOMENG STUDIO · MADE FOR YOUR NEXT IDEA</span></div></footer>
    </div>;
}

function StoryFrame({ close = false }: { close?: boolean }) {
    return <svg viewBox={close ? "90 25 380 320" : "0 0 560 420"} preserveAspectRatio="xMidYMid slice" className="size-full" aria-hidden="true">
        <rect width="560" height="420" fill="#202124" /><circle cx="410" cy="95" r="51" fill="#cacaca" /><path d="M0 180 90 130 175 180 250 100 315 157 345 137 420 180 470 155 560 202V420H0Z" fill="#5c5e62" /><path d="M0 260 64 240V170H124V245H160V214H215V288H257V196H286V170H301V196H327V283H366V238H415V276H448V209H481V258H528V225H560V420H0Z" fill="#343639" /><path d="M0 350 60 308H100V270H140V318H190V288H240V342H284V260H333V316H386V286H424V340H470V295H520V310H560V420H0Z" fill="#17181b" /><path d="M208 420 288 304H302L375 420Z" fill="#77797b" /><path d="M279 420 298 312H301L314 420Z" fill="#b7b7b7" />{[80, 100, 175, 193, 270, 290, 310, 382, 400, 460, 515].map((x, index) => <rect key={x} x={x} y={236 + index % 3 * 28} width="3" height="7" rx="1" fill="#d5d5d5" opacity="0.65" />)}<path d="M0 393H560" stroke="#e5e5e5" strokeOpacity=".1" />
    </svg>;
}
