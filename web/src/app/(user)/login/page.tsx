"use client";

import { Button, Form, Input, Segmented } from "antd";
import { ArrowLeft, ArrowRight, Clapperboard, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand/brand-mark";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { safeLoginRedirect } from "@/lib/auth-navigation";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

import styles from "./login.module.css";

type LoginFormValues = { username: string; password: string; confirmPassword?: string };

export default function LoginPage() {
    return (
        <Suspense fallback={<main className="flex min-h-dvh items-center justify-center gap-3 bg-background text-muted-foreground" aria-busy="true"><BrandMark className="size-8" /><span className="text-sm">正在打开登录页…</span></main>}>
            <LoginContent />
        </Suspense>
    );
}

function LoginContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [form] = Form.useForm<LoginFormValues>();
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const loginWithToken = useUserStore((state) => state.loginWithToken);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const isLoading = useUserStore((state) => state.isLoading);
    const authError = useUserStore((state) => state.authError);
    const linuxDoEnabled = useConfigStore((state) => state.publicSettings?.auth?.linuxDo?.enabled === true);
    const allowRegister = useConfigStore((state) => state.publicSettings?.auth?.allowRegister !== false);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const [mode, setMode] = useState<"login" | "register">("login");
    // 回调值仅在内存保留，清理地址栏不会中断正在进行的 token 校验。
    const [callback] = useState(() => ({ token: searchParams.get("token") || "", error: (searchParams.get("error") || "").slice(0, 500) }));
    const [callbackStatus, setCallbackStatus] = useState<"idle" | "pending" | "failed" | "done">(callback.error ? "failed" : callback.token ? "pending" : "idle");
    const [formError, setFormError] = useState(callback.error ? `授权登录未完成：${callback.error}` : "");
    const [hasInteracted, setHasInteracted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const mounted = useRef(false);
    const submitInProgress = useRef(false);
    const navigationStarted = useRef(false);
    const redirect = safeLoginRedirect(searchParams.get("redirect"));
    const busy = submitting || isLoading || callbackStatus === "pending";
    const errorText = formError || (!hasInteracted ? authError : "");

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const finishLogin = useCallback(() => {
        if (navigationStarted.current) return;
        navigationStarted.current = true;
        router.replace(redirect);
    }, [redirect, router]);

    useEffect(() => {
        if (!callback.token && !callback.error) return;
        const cleanUrl = new URL(window.location.href);
        for (const key of ["token", "error", "code", "state", "access_token", "refresh_token"]) cleanUrl.searchParams.delete(key);
        window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
        if (callback.error) return;
        let cancelled = false;
        setCallbackStatus("pending");
        void loginWithToken(callback.token).then(() => {
            if (cancelled) return;
            setCallbackStatus("done");
            finishLogin();
        }).catch((error: unknown) => {
            if (cancelled) return;
            setCallbackStatus("failed");
            setFormError(`授权登录未完成：${error instanceof Error ? error.message : "请重新登录"}`);
        });
        return () => { cancelled = true; };
    }, [callback, finishLogin, loginWithToken]);

    useEffect(() => {
        if (callbackStatus !== "idle" || busy || errorText || !isReady || !token || !user?.id || user.role === "guest") return;
        finishLogin();
    }, [busy, callbackStatus, errorText, finishLogin, isReady, token, user]);

    useEffect(() => {
        if (!allowRegister && mode === "register") setMode("login");
    }, [allowRegister, mode]);

    const submit = async (values: LoginFormValues) => {
        if (submitInProgress.current || busy) return;
        if (mode === "register" && !allowRegister) { setFormError("当前未开放注册，请使用已有账号登录"); return; }
        if (mode === "register" && values.password !== values.confirmPassword) { setFormError("两次输入的密码不一致"); return; }
        submitInProgress.current = true;
        setSubmitting(true);
        setHasInteracted(true);
        setFormError("");
        try {
            await (mode === "register" ? register : login)({ username: values.username.trim(), password: values.password });
            if (mounted.current) finishLogin();
        } catch (error) {
            if (mounted.current) setFormError(error instanceof Error ? error.message : "暂时无法登录，请重试");
        } finally {
            submitInProgress.current = false;
            if (mounted.current) setSubmitting(false);
        }
    };

    const changeMode = (next: string | number) => {
        if (busy) return;
        setMode(next === "register" ? "register" : "login");
        setHasInteracted(true);
        setFormError("");
        form.setFields([{ name: "password", errors: [] }, { name: "confirmPassword", value: undefined, errors: [] }]);
    };

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <Link href="/" aria-label="小盟视频工作台首页" className={styles.brand}>
                    <BrandMark className="size-7 shrink-0 sm:size-8" />
                    <span className="truncate text-[14px] font-semibold sm:text-[15px]">小盟视频工作台</span>
                </Link>
                <nav aria-label="登录页导航" className="flex shrink-0 items-center gap-1 sm:gap-3">
                    <Link href="/" aria-label="返回首页" className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        <ArrowLeft className="size-4" aria-hidden="true" /><span className={styles.returnLabel}>返回首页</span>
                    </Link>
                    <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px]" />
                </nav>
            </header>

            <div className={styles.content}>
                <aside className={styles.introduction} aria-label="创作工作台介绍">
                    <p className={styles.mobileIntro}>让下一个灵感，在画布里成为作品。</p>
                    <div className={styles.brandScene}>
                        <img src="/showcase/film-city.webp" width={800} height={800} alt="城市暮色中，一位创作者望向江岸灯火" className={styles.sceneImage} />
                        <div className={styles.sceneShade} />
                        <div className={styles.sceneContent}>
                            <div>
                                <p className={styles.sceneEyebrow}><span />为每一个想表达的你</p>
                                <h1 className={styles.sceneTitle}>下一部作品，<br />从一个灵感开始。</h1>
                                <p className={styles.sceneDescription}>把故事、镜头与素材连接起来，<br />在同一张画布里，展开你的表达。</p>
                            </div>
                            <div>
                                <div className={styles.referenceFrame}>
                                    <div className={styles.referenceImage}>
                                        <img src="/showcase/storyboard-city.webp" width={800} height={500} alt="通向城市夜景的石阶分镜参考" loading="lazy" />
                                        <span>01</span>
                                    </div>
                                    <div className={styles.referenceText}>
                                        <p><Clapperboard className="size-3.5" strokeWidth={1.5} aria-hidden="true" />从分镜，到画面</p>
                                        <span>给每一段创作，留出展开的空间。</span>
                                    </div>
                                </div>
                                <div className={styles.sceneFooter}><span>项目 / 画布 / 素材</span><span>创作画面示意</span></div>
                            </div>
                        </div>
                    </div>
                </aside>

                <section aria-labelledby="login-heading" className={styles.formSection}>
                    <div className={styles.formContent}>
                    <div className={styles.formHeading}>
                        <p className={styles.formEyebrow}>{mode === "register" ? "准备好，开始创作" : "回到你的创作空间"}</p>
                        <h2 id="login-heading">{mode === "register" ? "创建账号" : "欢迎回来"}</h2>
                        <p className={styles.formDescription}>{mode === "register" ? "为下一个灵感，留一个开始的地方。" : "登录账号，继续你的下一部作品。"}</p>
                    </div>

                    {allowRegister ? <Segmented aria-label="登录或注册" block className={styles.modeSwitcher} value={mode} disabled={busy} onChange={changeMode} options={[{ label: "登录", value: "login" }, { label: "注册", value: "register" }]} /> : null}
                    {errorText ? <div role="alert" className="mb-5 break-words rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-[13px] leading-6 text-destructive">{errorText}</div> : null}
                    {callbackStatus === "pending" || isLoading && !submitting ? <div role="status" className="mb-5 flex items-center gap-2 text-[13px] text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{callbackStatus === "pending" ? "正在完成授权登录…" : "正在验证登录状态…"}</div> : null}

                    <Form<LoginFormValues>
                        form={form}
                        name="xiaomeng-account"
                        className={styles.form}
                        layout="vertical"
                        size="large"
                        requiredMark={false}
                        disabled={busy}
                        onFinish={(values) => void submit(values)}
                        onValuesChange={() => { setHasInteracted(true); setFormError(""); }}
                        scrollToFirstError={{ focus: true }}
                    >
                        <Form.Item name="username" label="用户名" rules={[{ required: true, whitespace: true, message: "请输入用户名" }]}>
                            <Input prefix={<UserRound className="mr-1 size-4 text-muted-foreground" aria-hidden="true" />} className="h-12" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="输入你的用户名" />
                        </Form.Item>
                        <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                            <Input.Password prefix={<LockKeyhole className="mr-1 size-4 text-muted-foreground" aria-hidden="true" />} className="h-12" autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "register" ? "设置账号密码" : "输入你的密码"} />
                        </Form.Item>
                        {mode === "register" ? (
                            <Form.Item name="confirmPassword" label="确认密码" dependencies={["password"]} rules={[{ required: true, message: "请再次输入密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")); } })]}>
                                <Input.Password prefix={<LockKeyhole className="mr-1 size-4 text-muted-foreground" aria-hidden="true" />} className="h-12" autoComplete="new-password" placeholder="再次输入密码" />
                            </Form.Item>
                        ) : null}
                        <Button block type="primary" htmlType="submit" loading={submitting || callbackStatus === "pending"} disabled={busy} className={`${styles.submitButton} mt-2 !h-12 !text-[14px] !font-medium`}>
                            {mode === "register" ? "注册并进入工作台" : "进入工作台"}<ArrowRight className="ml-1 size-4" aria-hidden="true" />
                        </Button>
                        {linuxDoEnabled ? (
                            <div className="mt-5">
                                <div className="mb-4 flex items-center gap-4 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />或使用其他方式<span className="h-px flex-1 bg-border" /></div>
                                <Button block disabled={busy} href={`/api/auth/linux-do/authorize?redirect=${encodeURIComponent(redirect)}`} className={`${styles.oauthButton} !h-12 !text-[13px]`} icon={<img src="/icons/linuxdo.svg" alt="" width={18} height={18} />}>使用 LinuxDo 登录</Button>
                            </div>
                        ) : null}
                    </Form>
                    <p className={styles.formFootnote}>{allowRegister ? "项目与素材按账号管理，让每次创作都能继续。" : "当前未开放注册，请使用已有账号登录。"}</p>
                    </div>
                </section>
            </div>
        </main>
    );
}
