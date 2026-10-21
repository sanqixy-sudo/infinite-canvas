"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { StyleProvider } from "@ant-design/cssinjs";
import { ProConfigProvider } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { getAntThemeConfig } from "@/lib/app-theme";
import { ACCOUNT_WALLET_REFRESH_EVENT } from "@/lib/account-wallet-events";
import { useThemeStore } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    useEffect(() => {
        const refreshWallet = () => { void queryClient.invalidateQueries({ queryKey: ["account-wallet"] }); };
        window.addEventListener(ACCOUNT_WALLET_REFRESH_EVENT, refreshWallet);
        return () => window.removeEventListener(ACCOUNT_WALLET_REFRESH_EVENT, refreshWallet);
    }, []);

    return (
        <StyleProvider layer>
            <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
                <ProConfigProvider dark={dark}>
                    <App>
                        <QueryClientProvider client={queryClient}>
                            <ClientRootInit>{children}</ClientRootInit>
                        </QueryClientProvider>
                    </App>
                </ProConfigProvider>
            </ConfigProvider>
        </StyleProvider>
    );
}
