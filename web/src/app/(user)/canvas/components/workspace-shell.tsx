"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "antd";
import { ArrowUpRight, Boxes, Clapperboard, FolderOpen, House, Images, LibraryBig, Menu, Settings2, Sparkles, UserRound } from "lucide-react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const navigation = [
    { label: "创作空间", links: [
        { href: "/", label: "工作台", icon: House },
        { href: "/canvas", label: "我的项目", icon: FolderOpen },
        { href: "/assets", label: "我的素材", icon: Images },
    ] },
    { label: "灵感与资源", links: [
        { href: "/asset-library", label: "公共素材库", icon: LibraryBig },
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
        <Link href="/" onClick={() => setMenuOpen(false)} className="flex h-[100px] shrink-0 items-center gap-3.5 px-6">
            <span className="flex size-10 items-center justify-center rounded-[13px] bg-primary text-primary-foreground"><Clapperboard className="size-[21px]" strokeWidth={1.7} /></span>
            <span className="min-w-0"><strong className="block truncate text-[15px] font-semibold tracking-tight">小盟视频工作台</strong><small className="mt-1 block text-[9px] font-medium tracking-[0.2em] text-muted-foreground">XIAOMENG STUDIO</small></span>
        </Link>
        <nav className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 pt-2" aria-label="工作台导航">
            {navigation.map((group) => <div key={group.label}>
                <p className="mb-3 px-3 text-[10px] font-medium tracking-wider text-muted-foreground/80">{group.label}</p>
                <div className="grid gap-1.5">{group.links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} aria-current={active(href) ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", active(href) ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}><Icon className="size-[18px] shrink-0" strokeWidth={active(href) ? 2 : 1.6} />{label}{active(href) ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}</Link>)}</div>
            </div>)}
        </nav>
        <div className="shrink-0 space-y-1 px-4 pb-4 pt-8">
            <Link href="/models" onClick={() => setMenuOpen(false)} aria-current={active("/models") ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-xl px-3.5 text-[13px] transition-colors", active("/models") ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Boxes className="size-4" />模型与价格<ArrowUpRight className="ml-auto size-3.5 opacity-60" /></Link>
            {user ? <Link href="/account" onClick={() => setMenuOpen(false)} aria-current={active("/account") ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-xl px-3.5 text-[13px]", active("/account") ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><UserRound className="size-4" />账户与用量</Link> : null}
            <button type="button" onClick={() => { setMenuOpen(false); openConfig(false); }} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3.5 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"><Settings2 className="size-4" />创作设置</button>
            <div className="!mt-5 border-t border-sidebar-border px-3 pt-4"><p className="truncate text-xs font-medium">{user ? user.displayName || user.username : "访客工作空间"}</p><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{user ? "在画布中，连接每一个灵感" : "项目与素材保存在当前浏览器"}</p></div>
        </div>
    </>;

    return <div className="flex h-full min-h-0 bg-background text-foreground">
        <aside className="hidden w-[240px] shrink-0 flex-col border-r border-sidebar-border/80 bg-sidebar lg:flex">{menu}</aside>
        <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-[72px] shrink-0 items-center justify-between gap-3 px-4 sm:px-8 lg:px-10">
                <div className="flex min-w-0 items-center gap-2"><button type="button" aria-label="打开导航菜单" onClick={() => setMenuOpen(true)} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted lg:hidden"><Menu className="size-5" /></button><span className="hidden text-xs text-muted-foreground sm:inline">个人工作空间</span><span className="mx-1 hidden text-xs text-border sm:inline">/</span><span className="truncate text-xs font-medium">{pageTitle}</span></div>
                <div className="flex shrink-0 items-center gap-3"><span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:inline-flex"><span className="size-1.5 rounded-full bg-primary/70" />{user ? "已登录" : "访客模式"}</span><span className="hidden h-4 w-px bg-border md:block" /><UserStatusActions showConfig={false} /></div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
        <Drawer title="工作台导航" placement="left" width={272} open={menuOpen} onClose={() => setMenuOpen(false)} styles={{ body: { display: "flex", flexDirection: "column", padding: 0 } }}><div className="flex h-full flex-col bg-sidebar text-foreground">{menu}</div></Drawer>
    </div>;
}
