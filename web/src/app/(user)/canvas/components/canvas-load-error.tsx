"use client";

import Link from "next/link";
import { useCanvasStore } from "../stores/use-canvas-store";

export function CanvasLoadError() {
    const error = useCanvasStore((state) => state.loadError);
    const retry = useCanvasStore((state) => state.retryLoad);
    return <main className="flex h-full min-h-64 items-center justify-center bg-background px-6 text-center text-sm text-foreground"><div role="alert"><p>{error}</p><p className="mt-2 text-xs text-muted-foreground">原有文件和缓存均保留。</p><div className="mt-6 flex justify-center gap-6"><button type="button" onClick={retry} className="min-h-10 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">重新读取</button><Link href="/workspace" className="flex min-h-10 items-center text-muted-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">返回工作台</Link></div></div></main>;
}
