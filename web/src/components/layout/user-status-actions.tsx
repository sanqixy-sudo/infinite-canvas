"use client";

import type { CSSProperties, RefObject } from "react";
import { Avatar, Dropdown, Tooltip } from "antd";
import { CirclePlus, HardDrive, Keyboard, LogOut, Settings2, Shield, UserRound, Wallet } from "lucide-react";
import type { ItemType } from "antd/es/menu/interface";
import Link from "next/link";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { CreditSymbol } from "@/constant/credits";
import { useAccountWallet } from "@/hooks/use-account-wallet";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    accountOpen?: boolean;
    onAccountOpenChange?: (open: boolean) => void;
    accountRef?: RefObject<HTMLDivElement | null>;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, accountOpen, onAccountOpenChange, accountRef, getPopupContainer }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const wallet = useAccountWallet();
    const logout = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const userName = user?.displayName || user?.username || "";
    const credits = wallet.data?.credits ?? (wallet.isPending ? user?.credits : undefined);
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarText = (userName.trim()[0] || "U").toUpperCase();
    const naturalIconClass = "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted/60 hover:text-foreground [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const avatarStyle: CSSProperties | undefined = variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text, background: "transparent" } : undefined;
    const menuItems: ItemType[] = [
        { key: "user", disabled: true, label: <span className="block max-w-[200px] truncate font-medium text-current">{userName}</span> },
        { key: "account", icon: <UserRound className="size-4" />, label: <Link href="/account">个人中心</Link> },
        { key: "wallet", icon: <Wallet className="size-4" />, label: <Link href="/account#wallet">我的钱包</Link> },
        { key: "recharge", icon: <CirclePlus className="size-4" />, label: <Link href="/account/recharge?kind=credits">算力充值</Link> },
        { key: "storage", icon: <HardDrive className="size-4" />, label: <Link href="/account/recharge?kind=storage">空间扩容</Link> },
        ...(user?.role === "admin" ? [{ key: "admin", icon: <Shield className="size-4" />, label: <Link href="/admin">管理后台</Link> }] : []),
        ...(onOpenShortcuts ? [{ key: "shortcuts", icon: <Keyboard className="size-4" />, label: "快捷键", onClick: onOpenShortcuts }] : []),
        { type: "divider" },
        { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: logout },
    ];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            {user ? (
                <Tooltip title="查看算力点余额与流水" placement="bottom">
                    <Link href="/account#wallet" aria-label={credits === undefined ? "余额暂不可用，查看我的钱包" : `算力点 ${credits}，查看我的钱包`} className="flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium tabular-nums opacity-75 transition hover:opacity-100" style={iconStyle}>
                        <CreditSymbol className="text-sm leading-none" />
                        <span>{credits === undefined ? "—" : credits.toLocaleString()}</span>
                    </Link>
                </Tooltip>
            ) : null}
            {!user && onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {!user ? (
                <Link href="/login" className="px-2 text-[13px] font-medium text-foreground underline-offset-4 transition hover:text-primary hover:underline" style={iconStyle}>
                    登录
                </Link>
            ) : null}
            {user ? (
                <div ref={accountRef}>
                    <Dropdown open={accountOpen} onOpenChange={onAccountOpenChange} trigger={["click"]} placement="bottomRight" getPopupContainer={getPopupContainer} styles={{ root: { minWidth: 150 } }} menu={{ items: menuItems }}>
                        <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-[0] leading-[0] transition" aria-label="账户菜单">
                            <Avatar
                                size={24}
                                src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined}
                                alt={userName}
                                className="!flex !items-center !justify-center border border-border bg-accent text-[11px] font-semibold text-accent-foreground transition hover:border-primary"
                                style={avatarStyle}
                            >
                                {avatarText}
                            </Avatar>
                        </button>
                    </Dropdown>
                </div>
            ) : null}
        </div>
    );
}
