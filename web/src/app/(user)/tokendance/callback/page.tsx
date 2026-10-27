"use client";

import { Button, Result, Spin } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { TokenDanceOAuthState } from "@/lib/tokendance-oauth";
import { fetchCurrentUser } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export default function TokenDanceCallbackPage() {
    const router = useRouter();
    const started = useRef(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        void (async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const code = params.get("code");
                const flow = params.get("flow");
                const storageKey = flow ? `tokendance:oauth:${flow}` : "";
                const raw = storageKey ? sessionStorage.getItem(storageKey) : null;

                if (!code || !flow || !raw) throw new Error("授权信息已失效，请重新登录");

                const state = JSON.parse(raw) as TokenDanceOAuthState;
                if (!state.verifier || (state.target !== "local" && state.target !== "admin")) {
                    throw new Error("授权信息不完整，请重新登录");
                }
                if (state.target !== "admin") {
                    sessionStorage.removeItem(storageKey);
                    throw new Error("个人模型渠道授权已停用，请使用平台云端模型");
                }
                if (!state.draft || typeof state.draft !== "object") throw new Error("后台渠道信息不完整，请重新登录");
                const accountToken = useUserStore.getState().token;
                if (!accountToken) throw new Error("请先登录管理员账号后配置平台渠道");
                const currentUser = await fetchCurrentUser(accountToken);
                if (currentUser.role !== "admin" || useUserStore.getState().token !== accountToken) throw new Error("仅管理员可以配置平台模型渠道");

                const returnTo = typeof state.returnTo === "string"
                    ? state.returnTo.replace(/[\t\n\r]/g, "")
                    : "/";
                const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/\\")
                    ? returnTo
                    : "/";

                const response = await fetch("https://tokendance.space/portal/api/v1/auth/keys", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        code,
                        code_verifier: state.verifier,
                        code_challenge_method: "S256",
                    }),
                });
                const data = await response.json().catch(() => ({})) as {
                    key?: string;
                    message?: string;
                    error?: string;
                };

                if (!response.ok || typeof data.key !== "string" || !data.key.trim()) {
                    throw new Error(data.message || data.error || "TokenDance 授权失败");
                }

                const key = data.key.trim();

                if (useUserStore.getState().token !== accountToken) throw new Error("登录状态已变化，请重新登录");
                sessionStorage.setItem(`tokendance:oauth-result:${flow}`, JSON.stringify({
                    key,
                    draft: state.draft,
                    editingChannelIndex: state.editingChannelIndex,
                }));
                sessionStorage.removeItem(storageKey);
                const returnUrl = new URL(safeReturnTo, window.location.origin);
                returnUrl.searchParams.set("tokendance_oauth", flow);
                router.replace(`${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : "TokenDance 授权失败");
            }
        })();
    }, [router]);

    return (
        <main className="flex h-full items-center justify-center p-6">
            {error ? (
                <Result
                    status="error"
                    title="TokenDance 授权失败"
                    subTitle={error}
                    extra={<Button href="/">返回首页</Button>}
                />
            ) : (
                <Spin size="large" tip="正在完成 TokenDance 授权……" />
            )}
        </main>
    );
}
