"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "antd";
import { ArrowUpRight, Boxes, Clapperboard, FolderOpen, HardDrive, House, Images, LibraryBig, Menu, Settings2, Sparkles, UserRound, Wallet } from "lucide-react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAccountWallet } from "@/hooks/use-account-wallet";
import { cn } from "@/lib/utils";
import { formatCredits, formatStorageBytes } from "@/lib/wallet-display";
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
    const wallet = useAccountWallet();
    const openConfig = useConfigStore((state) => state.openConfigDialog);
    const [menuOpen, setMenuOpen] = useState(false);
    const active = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    const pageTitle = navigation.flatMap((group) => group.links).find((link) => active(link.href))?.label || (pathname.startsWith("/account/storage") ? "存储设置" : pathname.startsWith("/account/recharge") ? "我的钱包" : pathname === "/account" ? "个人中心" : pathname === "/models" ? "模型与价格" : "小盟视频工作台");
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
            {user ? <Link href="/account" onClick={() => setMenuOpen(false)} aria-current={active("/account") ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-xl px-3.5 text-[13px]", active("/account") ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><UserRound className="size-4" />个人中心</Link> : null}
            <button type="button" onClick={() => { setMenuOpen(false); openConfig(false); }} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3.5 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"><Settings2 className="size-4" />创作设置</button>
            <section aria-label={user ? "账号余额与空间" : "访客工作空间"} className="!mt-5 rounded-xl border border-sidebar-border bg-background/40 p-3.5">
                <p className="truncate text-xs font-medium">{user ? user.displayName || user.username : "访客工作空间"}</p>
                {user ? <>
                    <div className="mt-4 space-y-3 text-[11px]"><Link href="/account#wallet" onClick={() => setMenuOpen(false)} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-muted-foreground"><Wallet className="size-3.5" />算力点</span><strong className="font-medium tabular-nums">{wallet.data ? formatCredits(wallet.data.credits) : wallet.isPending ? "读取中" : "暂不可用"}</strong></Link><Link href="/account#wallet" onClick={() => setMenuOpen(false)} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-muted-foreground"><HardDrive className="size-3.5" />个人空间</span><strong className="font-medium tabular-nums">{wallet.data ? `${formatStorageBytes(wallet.data.storage.usedBytes)} / ${formatStorageBytes(wallet.data.storage.limitBytes)}` : wallet.isPending ? "读取中" : "暂不可用"}</strong></Link></div>
                    {wallet.data?.storage.overLimit ? <p className="mt-2 text-[10px] text-destructive">空间已超限，请清理或扩容</p> : null}
                    <div className="mt-4 grid grid-cols-2 gap-2"><Link href="/account/recharge?kind=credits" onClick={() => setMenuOpen(false)} className="flex min-h-9 items-center justify-center rounded-lg bg-primary px-2 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90">算力充值</Link><Link href="/account/recharge?kind=storage" onClick={() => setMenuOpen(false)} className="flex min-h-9 items-center justify-center rounded-lg border border-border px-2 text-[11px] transition hover:bg-muted">空间扩容</Link></div>
                </> : <><p className="mt-2 text-[11px] leading-5 text-muted-foreground">项目与素材保存在当前浏览器。登录后使用平台模型与账号空间。</p><Link href="/login" onClick={() => setMenuOpen(false)} className="mt-3 flex min-h-9 items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground transition hover:bg-primary/90">登录开通</Link></>}
            </section>
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
