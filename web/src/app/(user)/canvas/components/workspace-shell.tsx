"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "antd";
import { Boxes, Clapperboard, FolderOpen, House, Images, Image, Menu, Music2, Settings2, Sparkles, UserRound, Video } from "lucide-react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const navigation = [
    { label: "创作空间", links: [
        { href: "/", label: "工作台", icon: House },
        { href: "/canvas", label: "我的项目", icon: FolderOpen },
        { href: "/assets", label: "我的素材", icon: Images },
        { href: "/asset-library", label: "公共素材库", icon: Images },
    ] },
    { label: "创作工具", links: [
        { href: "/image", label: "图片创作", icon: Image },
        { href: "/video", label: "视频创作", icon: Video },
        { href: "/music", label: "音频创作", icon: Music2 },
        { href: "/prompts", label: "提示词库", icon: Sparkles },
    ] },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const user = useUserStore((state) => state.user);
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const [menuOpen, setMenuOpen] = useState(false);
    const active = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    const pageTitle = navigation.flatMap((group) => group.links).find((link) => active(link.href))?.label || (pathname === "/account" ? "账户与用量" : pathname === "/models" ? "模型与价格" : "小盟视频工作台");
    const menu = <>
        <Link href="/" onClick={() => setMenuOpen(false)} className="flex h-[76px] shrink-0 items-center gap-3 px-5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background"><Clapperboard className="size-[19px]" /></span>
            <span className="min-w-0"><strong className="block truncate text-sm tracking-tight">小盟视频工作台</strong><small className="mt-0.5 block text-[9px] font-medium tracking-[0.16em] text-muted-foreground">XIAOMENG STUDIO</small></span>
        </Link>
        <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="工作台导航">
            {navigation.map((group) => <div key={group.label}>
                <p className="mb-2 px-3 text-[11px] font-medium text-muted-foreground">{group.label}</p>
                <div className="grid gap-1">{group.links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} aria-current={active(href) ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors", active(href) ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-4 shrink-0" />{label}</Link>)}</div>
            </div>)}
        </nav>
        <div className="shrink-0 border-t border-border px-3 py-3">
            <Link href="/models" onClick={() => setMenuOpen(false)} aria-current={active("/models") ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm", active("/models") ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Boxes className="size-4" />模型与价格</Link>
            {user ? <Link href="/account" onClick={() => setMenuOpen(false)} aria-current={active("/account") ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm", active("/account") ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><UserRound className="size-4" />账户与用量</Link> : null}
            <button type="button" onClick={() => { setMenuOpen(false); openConfig(false); }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"><Settings2 className="size-4" />创作设置</button>
            <p className="truncate px-3 pb-1 pt-3 text-[11px] text-muted-foreground">{user ? `当前账号 · ${user.displayName || user.username}` : "访客空间 · 内容保存在当前浏览器"}</p>
        </div>
    </>;

    return <div className="flex h-full min-h-0 bg-background text-foreground">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card lg:flex">{menu}</aside>
        <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-8">
                <div className="flex min-w-0 items-center gap-2"><button type="button" aria-label="打开导航菜单" onClick={() => setMenuOpen(true)} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"><Menu className="size-5" /></button><span className="truncate text-sm font-medium">{pageTitle}</span></div>
                <div className="flex shrink-0 items-center gap-3">{user ? <Link href="/account" className="text-xs text-muted-foreground transition hover:text-foreground" title="查看算力点余额与用量"><span className="hidden sm:inline">算力点 </span><span className="font-medium tabular-nums text-foreground">{(user.credits ?? 0).toLocaleString()}</span><span className="ml-1">点</span></Link> : null}<UserStatusActions showConfig={false} /></div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
        <Drawer title="工作台导航" placement="left" width={256} open={menuOpen} onClose={() => setMenuOpen(false)} styles={{ body: { display: "flex", flexDirection: "column", padding: 0 } }}><div className="flex h-full flex-col bg-card text-foreground">{menu}</div></Drawer>
    </div>;
}
