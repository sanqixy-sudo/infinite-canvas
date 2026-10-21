"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, FolderOpen, House, Image, Music2, Sparkles, Video } from "lucide-react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";

const links = [
    { href: "/", label: "工作台", icon: House },
    { href: "/canvas", label: "我的项目", icon: FolderOpen },
    { href: "/image", label: "图片创作", icon: Image },
    { href: "/video", label: "视频创作", icon: Video },
    { href: "/music", label: "音乐创作", icon: Music2 },
    { href: "/prompts", label: "提示词库", icon: Sparkles },
] as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();

    return (
        <div className="flex h-full min-h-0 bg-background text-foreground">
            <aside className="hidden w-[216px] shrink-0 flex-col border-r border-border bg-card lg:flex">
                <Link href="/" className="flex items-center gap-3 border-b border-border px-6 py-6">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background"><Clapperboard className="size-5" /></span>
                    <span className="min-w-0"><strong className="block truncate text-[15px] tracking-tight">小盟视频工作台</strong><small className="mt-0.5 block text-[10px] font-medium tracking-[0.18em] text-muted-foreground">XIAOMENG STUDIO</small></span>
                </Link>
                <div className="px-4 pt-7 text-[10px] font-semibold tracking-[0.22em] text-muted-foreground">创作空间 / SPACE</div>
                <nav className="mt-3 grid gap-1 px-3" aria-label="工作台导航">
                    {links.map(({ href, label, icon: Icon }) => {
                        const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
                        return <Link key={href} href={href} className={cn("flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-4" />{label}</Link>;
                    })}
                </nav>
                <div className="mt-auto border-t border-border px-6 py-5 text-xs leading-5 text-muted-foreground">从一个项目出发，<br />让每张画布都有归处。</div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur md:px-9">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="text-sm font-semibold lg:hidden">小盟视频工作台</Link>
                        <span className="hidden text-xs font-medium tracking-[0.16em] text-muted-foreground lg:block">YOUR CREATIVE SPACE</span>
                    </div>
                    <div className="flex items-center gap-4"><Link href="/assets" className="hidden text-xs text-muted-foreground transition hover:text-foreground sm:block">我的素材 ↗</Link><UserStatusActions /></div>
                </header>
                <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2 lg:hidden" aria-label="移动端工作台导航">
                    {links.slice(0, 4).map(({ href, label }) => <Link key={href} href={href} className={cn("shrink-0 rounded-md px-3 py-1.5 text-xs", pathname === href ? "bg-foreground text-background" : "text-muted-foreground")}>{label}</Link>)}
                </nav>
                <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(var(--border)_0.7px,transparent_0.7px)] [background-size:24px_24px]">{children}</div>
            </div>
        </div>
    );
}
