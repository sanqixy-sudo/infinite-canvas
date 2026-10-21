"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Modal } from "antd";
import { ArrowRight, ArrowUpRight, Clock3, FolderOpen, Image, Music2, Plus, Sparkles, Video } from "lucide-react";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasProjectPreview } from "./canvas/components/canvas-project-preview";
import { useCanvasActivityStore } from "./canvas/stores/use-canvas-activity-store";
import { useCanvasStore, type CanvasProject, workspaceRoot } from "./canvas/stores/use-canvas-store";

const tools = [
    { href: "/image", title: "图片创作", detail: "生成图片、修改与扩展画面", icon: Image },
    { href: "/video", title: "视频创作", detail: "从文字与参考画面生成视频", icon: Video },
    { href: "/music", title: "音频创作", detail: "生成配音与语音素材", icon: Music2 },
    { href: "/prompts", title: "提示词库", detail: "查找和收藏创作提示词", icon: Sparkles },
];

export default function IndexPage() {
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createCanvas = useCanvasStore((state) => state.createProject);
    const visits = useCanvasActivityStore((state) => state.visits);
    const [createOpen, setCreateOpen] = useState(false);
    const [title, setTitle] = useState("");
    const workspaces = useMemo(() => {
        const groups = new Map<string, CanvasProject[]>();
        for (const canvas of projects) {
            const id = canvas.workspaceId || canvas.id;
            const group = groups.get(id) || [];
            group.push(canvas);
            groups.set(id, group);
        }
        return projects.filter(workspaceRoot).map((root) => {
            const canvases = (groups.get(root.id) || [root]).toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
            return { root, canvases, latest: canvases[0].updatedAt, cover: canvases.find((canvas) => canvas.nodes.length > 0) || root };
        }).sort((a, b) => Date.parse(b.latest) - Date.parse(a.latest));
    }, [projects]);
    const ownerId = user?.id || "guest";
    const lastVisit = visits.find((visit) => visit.ownerId === ownerId && projects.some((canvas) => canvas.id === visit.canvasId));
    const recentCanvas = lastVisit ? projects.find((canvas) => canvas.id === lastVisit.canvasId) : undefined;
    const recentRoot = recentCanvas && projects.find((canvas) => canvas.id === (recentCanvas.workspaceId || recentCanvas.id));

    const create = () => {
        if (!hydrated) return;
        const id = createCanvas("画布 1", { workspaceTitle: title.trim() || `未命名项目 ${workspaces.length + 1}` });
        setCreateOpen(false);
        setTitle("");
        router.push(`/canvas/${id}`);
    };

    return <div className="h-full overflow-y-auto">
        <main className="mx-auto max-w-[1440px] px-5 pb-12 pt-7 md:px-9 lg:px-12">
            <div className="flex flex-wrap items-center justify-between gap-5">
                <div><p className="mb-2 text-xs text-muted-foreground">{user ? `${user.displayName || user.username}，开始今天的创作` : "你的创作，从这里开始"}</p><h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">小盟万能视频工作台</h1><p className="mt-2 text-xs tracking-wide text-muted-foreground">Xiaomeng All-in-One Video Workbench</p></div>
                <Button type="primary" size="large" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)} disabled={!hydrated}>新建项目</Button>
            </div>

            {hydrated && recentCanvas ? <section className="mt-7 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4 sm:flex-nowrap">
                <CanvasProjectPreview project={recentCanvas} className="w-28 shrink-0 rounded-lg sm:w-36" />
                <div className="min-w-0 flex-1"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" />继续创作</p><h2 className="mt-2 truncate text-base font-medium">{recentCanvas.title}</h2><p className="mt-1 truncate text-xs text-muted-foreground">{recentRoot?.workspaceTitle || recentRoot?.title} · 上次打开 {new Date(lastVisit!.openedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p></div>
                <Link href={`/canvas/${recentCanvas.id}`} className="inline-flex items-center gap-2 text-sm font-medium hover:underline">继续编辑 <ArrowRight className="size-4" /></Link>
            </section> : null}

            <section className="mt-8" aria-labelledby="recent-projects">
                <div className="mb-4 flex items-center justify-between gap-4"><h2 id="recent-projects" className="text-base font-semibold">最近项目</h2><Link href="/canvas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">全部项目 <ArrowRight className="size-3.5" /></Link></div>
                {!hydrated ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="正在读取项目">{[0, 1, 2].map((index) => <div key={index} className="h-56 animate-pulse rounded-xl bg-muted" />)}</div>
                    : workspaces.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{workspaces.slice(0, 6).map(({ root, canvases, cover, latest }) => <Link key={root.id} href={`/canvas/project/${root.id}`} className="group min-w-0 overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/35">
                        <CanvasProjectPreview project={cover} className="aspect-[2/1]" />
                        <div className="px-4 py-3.5"><div className="flex items-center justify-between gap-3"><h3 className="truncate text-sm font-medium">{root.workspaceTitle || root.title}</h3><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" /></div><div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{canvases.length} 张画布</span><time dateTime={latest}>{new Date(latest).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</time></div></div>
                    </Link>)}</div>
                        : <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-8 text-center"><FolderOpen className="mb-3 size-8 text-muted-foreground/65" /><h3 className="font-medium">创建你的第一个项目</h3><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">把脚本、分镜和视频制作放进同一个项目，用多张画布展开创作。</p><Button className="mt-5" onClick={() => setCreateOpen(true)} icon={<Plus className="size-4" />}>创建项目</Button></div>}
            </section>

            <section className="mt-9 border-t border-border pt-6" aria-labelledby="creation-tools"><div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 id="creation-tools" className="text-base font-semibold">创作工具</h2><p className="text-xs text-muted-foreground">也可以独立创作，再把结果加入素材库或画布</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tools.map(({ href, title, detail, icon: Icon }) => <Link key={href} href={href} className="group flex min-w-0 items-start gap-3 rounded-lg px-3 py-4 transition-colors hover:bg-muted"><Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div className="min-w-0"><h3 className="text-sm font-medium">{title}</h3><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{detail}</p></div></Link>)}</div></section>
            {!user ? <p className="mt-7 text-xs leading-5 text-muted-foreground">未登录的项目与素材保存在当前浏览器。<Link href="/login" className="ml-1 text-foreground underline underline-offset-4">登录账户</Link>后可使用账号同步及平台内置模型。</p> : null}
        </main>
        <Modal title="新建项目" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={create} okText="创建并打开画布" cancelText="取消" okButtonProps={{ disabled: !hydrated }}><p className="mb-4 text-sm text-muted-foreground">自动创建第一张空白画布，之后可以在项目内继续添加。创建项目不消耗算力点。</p><Input autoFocus maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} onPressEnter={create} placeholder="给这次创作起个名字" aria-label="项目名称" /></Modal>
    </div>;
}
