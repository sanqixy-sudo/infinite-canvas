"use client";

import { AuditOutlined, FileTextOutlined, HomeOutlined, LogoutOutlined, PictureOutlined, SettingOutlined, ToolOutlined, TransactionOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Typography, theme } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { adminLayoutStyle } from "@/lib/app-theme";
import { loginHrefForPath } from "@/lib/auth-navigation";
import { useUserStore } from "@/stores/use-user-store";

const adminMenus = [
    { key: "/admin/model-gateway", icon: <ToolOutlined />, label: "模型中间件" },
    { key: "/admin/commerce", icon: <TransactionOutlined />, label: "充值与空间" },
    { key: "/admin/users", icon: <UserOutlined />, label: "用户管理" },
    { key: "/admin/credit-logs", icon: <TransactionOutlined />, label: "算力点日志" },
    { key: "/admin/ai-logs", icon: <AuditOutlined />, label: "AI 日志" },
    { key: "/admin/prompts", icon: <FileTextOutlined />, label: "提示词管理" },
    { key: "/admin/skills", icon: <ToolOutlined />, label: "Skill 管理" },
    { key: "/admin/assets", icon: <PictureOutlined />, label: "素材库" },
    { key: "/admin/settings", icon: <SettingOutlined />, label: "系统设置" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const { token: antToken } = theme.useToken();
    const router = useRouter();
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const isLoading = useUserStore((state) => state.isLoading);
    const authError = useUserStore((state) => state.authError);
    const logout = useUserStore((state) => state.clearSession);
    const activeKey = pathname.startsWith("/admin/model-gateway") ? "/admin/model-gateway" : pathname.startsWith("/admin/commerce") ? "/admin/commerce" : pathname.startsWith("/admin/settings")
        ? "/admin/settings"
        : pathname.startsWith("/admin/assets")
          ? "/admin/assets"
          : pathname.startsWith("/admin/skills")
            ? "/admin/skills"
            : pathname.startsWith("/admin/prompts")
              ? "/admin/prompts"
              : pathname.startsWith("/admin/ai-logs")
                ? "/admin/ai-logs"
                : pathname.startsWith("/admin/credit-logs")
                  ? "/admin/credit-logs"
                  : pathname.startsWith("/admin/users")
                    ? "/admin/users"
                    : "";
    const pageTitle = pathname.startsWith("/admin/model-gateway") ? "模型中间件" : pathname.startsWith("/admin/commerce") ? "充值与存储空间" : pathname.startsWith("/admin/settings") ? "系统设置" : pathname.startsWith("/admin/assets") ? "素材库管理" : pathname.startsWith("/admin/skills") ? "Skill 管理" : pathname.startsWith("/admin/prompts") ? "提示词管理" : pathname.startsWith("/admin/ai-logs") ? "AI 日志" : pathname.startsWith("/admin/credit-logs") ? "算力点日志" : "用户管理";

    useEffect(() => {
        if (!isReady || isLoading || (token && authError)) return;
        if (!token) {
            router.replace(loginHrefForPath(`${window.location.pathname}${window.location.search}${window.location.hash}`));
            return;
        }
        if (user?.role !== "admin") {
            router.replace("/workspace");
        }
    }, [isReady, isLoading, authError, pathname, router, token, user?.role]);

    if (!isReady || authError || !token || user?.role !== "admin") {
        return (
            <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
                <div role={authError && token ? "alert" : "status"} style={{ color: antToken.colorTextSecondary, textAlign: "center" }}>{authError && token ? <><p>暂时无法确认登录状态，请重试。</p><Button type="link" onClick={() => void useUserStore.getState().hydrateUser()}>重新连接</Button></> : "正在确认登录状态…"}</div>
            </div>
        );
    }

    return (
        <Layout hasSider style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgLayout }}>
            <Layout.Sider width={adminLayoutStyle.siderWidth} style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgContainer, borderRight: `1px solid ${antToken.colorBorder}` }}>
                <Flex align="center" gap={12} style={{ height: adminLayoutStyle.brandHeight, padding: "0 20px", borderBottom: `1px solid ${antToken.colorBorderSecondary}` }}>
                    <BrandMark width={30} height={30} style={{ flexShrink: 0, color: antToken.colorText }} />
                    <Typography.Text strong style={{ fontSize: 18, letterSpacing: 0 }}>
                        小盟视频工作台
                    </Typography.Text>
                </Flex>
                <Menu
                    mode="inline"
                    selectedKeys={[activeKey]}
                    style={adminLayoutStyle.menu}
                    items={adminMenus.map((item) => ({
                        ...item,
                        label: (
                            <Link href={item.key} style={{ color: "inherit" }}>
                                {item.label}
                            </Link>
                        ),
                        style: adminLayoutStyle.menuItem,
                    }))}
                />
                <Flex vertical gap={8} style={{ position: "absolute", bottom: 0, insetInline: 0, padding: 12, borderTop: `1px solid ${antToken.colorBorder}`, background: antToken.colorBgContainer }}>
                    <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer">
                        前往画布
                    </Button>
                    <Button block icon={<LogoutOutlined />} onClick={logout}>
                        退出登录
                    </Button>
                </Flex>
            </Layout.Sider>
            <Layout style={{ background: antToken.colorBgLayout }}>
                <Layout.Header
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: adminLayoutStyle.headerHeight, padding: "0 24px", background: antToken.colorBgContainer, borderBottom: `1px solid ${antToken.colorBorder}` }}
                >
                    <Typography.Title level={5} style={{ margin: 0 }}>
                        {pageTitle}
                    </Typography.Title>
                    <Flex align="center" gap={4}>
                        <UserStatusActions showConfig={false} />
                    </Flex>
                </Layout.Header>
                <Layout.Content style={{ minHeight: 0, overflow: "auto" }}>{children}</Layout.Content>
            </Layout>
        </Layout>
    );
}
