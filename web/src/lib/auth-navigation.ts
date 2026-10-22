const origin = "https://app.invalid";

export function safeLoginRedirect(value?: string | null, fallback = "/workspace"): string {
    if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
    try {
        const url = new URL(value, origin);
        const decoded = decodeURIComponent(url.pathname);
        if (url.origin !== origin || decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
        const pathname = new URL(decoded, origin).pathname.replace(/\/+$/, "") || "/";
        if (pathname === "/login" || pathname.startsWith("/login/") || pathname === "/admin/login") return fallback;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch { return fallback; }
}

export function loginHrefForPath(value?: string | null) {
    return `/login?redirect=${encodeURIComponent(safeLoginRedirect(value))}`;
}
