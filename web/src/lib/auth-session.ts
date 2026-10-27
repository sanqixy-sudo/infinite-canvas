import { useUserStore } from "@/stores/use-user-store";

let mediaSessionQueue: Promise<void> = Promise.resolve();

// 所有 Cookie 写入串行，旧请求完成后再建立新会话，避免晚到响应覆盖新账号。
export function syncStorageReadSession(token: string, version: number) {
    const request = mediaSessionQueue.catch(() => undefined).then(async () => {
        const current = useUserStore.getState();
        if (token && (current.token !== token || current.sessionVersion !== version)) return;
        const response = await fetch("/api/files/session", { method: token ? "POST" : "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (token && !response.ok) throw new Error("无法建立媒体读取会话，请重新连接");
    });
    mediaSessionQueue = request;
    return request;
}

export function observeAuthenticatedFetch() {
    const previous = window.fetch;
    const observed: typeof window.fetch = async (input, init) => {
        const request = input instanceof Request ? input : null;
        const headers = new Headers(init?.headers || request?.headers);
        const token = headers.get("Authorization")?.replace(/^Bearer /, "") || "";
        const version = useUserStore.getState().sessionVersion;
        const url = new URL(request?.url || String(input), window.location.origin);
        const response = await previous.call(window, input, init);
        const current = useUserStore.getState();
        if (response.status === 401 && token && url.origin === window.location.origin && url.pathname.startsWith("/api/") && current.token === token && current.sessionVersion === version) current.clearSession();
        return response;
    };
    window.fetch = observed;
    return () => { if (window.fetch === observed) window.fetch = previous; };
}
