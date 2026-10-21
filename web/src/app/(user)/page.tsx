"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Modal } from "antd";
import { ArrowRight, ArrowUpRight, Clapperboard, Clock3, FolderOpen, Image, Layers3, Plus, ScanLine } from "lucide-react";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasProjectPreview } from "./canvas/components/canvas-project-preview";
import { useCanvasActivityStore } from "./canvas/stores/use-canvas-activity-store";
import { useCanvasStore, type CanvasProject, workspaceRoot } from "./canvas/stores/use-canvas-store";

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
        <main className="mx-auto max-w-[1320px] px-5 pb-10 pt-6 sm:px-8 lg:px-10">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div><p className="mb-2 text-[11px] font-medium tracking-[0.15em] text-primary">灵感无限 · 创作有序</p><h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">小盟万能视频工作台</h1><p className="mt-2 text-[10px] tracking-[0.12em] text-muted-foreground">XIAOMENG ALL-IN-ONE VIDEO WORKBENCH</p></div>
                {hydrated && workspaces.length ? <p className="max-w-full truncate pb-1 text-xs text-muted-foreground sm:max-w-64">{user ? `${user.displayName || user.username}，欢迎回来` : "欢迎回到你的创作空间"}</p> : null}
            </div>

            <section className="relative grid overflow-hidden rounded-[24px] border border-border/70 bg-card lg:grid-cols-[1.12fr_1fr]" aria-label={recentCanvas ? "继续创作" : "开始创作"}>
                <div className="relative z-10 flex min-w-0 flex-col items-start px-6 py-8 sm:px-8 sm:py-9">
                    <p className="mb-4 inline-flex items-center gap-2 text-[11px] font-medium text-primary">{recentCanvas ? <Clock3 className="size-3.5" /> : <span className="size-1.5 rounded-full bg-primary" />}{recentCanvas ? "继续上次的灵感" : "每个好故事，都从这里开始"}</p>
                    <h2 className="max-w-full text-[25px] font-semibold leading-[1.4] tracking-tight [overflow-wrap:anywhere] sm:text-[29px]">{recentCanvas ? recentRoot?.workspaceTitle || recentRoot?.title : <>给灵感，<br />一张无限画布。</>}</h2>
                    <p className="mt-3 max-w-full text-[13px] leading-6 text-muted-foreground [overflow-wrap:anywhere] sm:max-w-md">{recentCanvas ? <>{recentCanvas.title} · 上次打开 {new Date(lastVisit!.openedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}<br />回到画布，让未完成的想法继续生长。</> : "从脚本、分镜到影像，把素材和生成连接在一起。在一个项目里，自由展开多张画布。"}</p>
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        {recentCanvas ? <><Link href={`/canvas/${recentCanvas.id}`} className="inline-flex h-10 items-center gap-3 rounded-xl bg-primary px-5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">继续编辑<ArrowUpRight className="size-4" /></Link><Button type="text" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)} disabled={!hydrated}>新建项目</Button></> : <Button type="primary" size="large" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)} disabled={!hydrated}>新建创作项目</Button>}
                    </div>
                </div>
                {recentCanvas ? <div className="relative hidden min-h-[280px] min-w-0 items-center justify-center overflow-hidden bg-accent/45 p-8 lg:flex"><div className="w-full max-w-[360px] -rotate-3 overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-primary/5"><div className="flex h-7 items-center gap-1 border-b border-border bg-card px-3"><span className="size-1 shrink-0 rounded-full bg-primary/50" /><span className="size-1 shrink-0 rounded-full bg-primary/25" /><span className="ml-auto max-w-[85%] truncate text-[8px] text-muted-foreground">{recentCanvas.title}</span></div><CanvasProjectPreview project={recentCanvas} className="aspect-[16/10]" /></div></div>
                    : <div aria-hidden="true" className="relative hidden min-h-[280px] items-center justify-center overflow-hidden bg-accent/45 lg:flex">
                        <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(var(--primary) 0.6px, transparent 0.6px)", backgroundSize: "18px 18px", maskImage: "radial-gradient(ellipse at center, black, transparent 72%)" }} />
                        <div className="relative h-[200px] w-[330px]">
                            <div className="absolute left-[45px] top-[104px] h-px w-[210px] -rotate-[14deg] bg-primary/30" />
                            <div className="absolute left-1 top-[70px] w-[116px] -rotate-[8deg] rounded-xl border border-border bg-card p-3.5 shadow-sm"><p className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground"><ScanLine className="size-3" />灵感脚本</p><div className="mt-3 h-1 w-16 rounded-full bg-primary/25" /><div className="mt-2 h-1 w-12 rounded-full bg-muted-foreground/15" /><div className="mt-2 h-1 w-16 rounded-full bg-muted-foreground/15" /></div>
                            <div className="absolute left-[110px] top-3 w-[126px] rotate-[5deg] rounded-xl border border-border bg-card p-2.5 shadow-sm"><div className="flex h-[72px] items-center justify-center rounded-lg bg-accent text-primary"><Image className="size-7" strokeWidth={1} /></div><p className="mt-2 text-[9px] text-muted-foreground">每一帧，都是想象的开始</p></div>
                            <div className="absolute bottom-1 right-0 w-[126px] rotate-[4deg] rounded-xl border border-primary/20 bg-card p-3 shadow-sm"><Clapperboard className="size-5 text-primary" strokeWidth={1.5} /><p className="mt-2 text-[10px] font-medium">连接灵感，创作成片</p><div className="mt-2 flex gap-1">{[1, 2, 3, 4].map((item) => <span key={item} className="h-3 w-5 rounded-sm bg-primary/15" />)}</div></div>
                        </div>
                    </div>}
            </section>

            <section className="mt-9" aria-labelledby="recent-projects">
                <div className="mb-5 flex items-center justify-between gap-4"><div className="flex items-center gap-2.5"><h2 id="recent-projects" className="text-[16px] font-semibold">最近项目</h2>{hydrated && workspaces.length > 0 ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{workspaces.length}</span> : null}</div><Link href="/canvas" className="inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-primary">查看全部 <ArrowRight className="size-3.5" /></Link></div>
                {!hydrated ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="正在读取项目">{[0, 1, 2].map((index) => <div key={index} className="h-56 animate-pulse rounded-2xl bg-muted/60" />)}</div>
                    : workspaces.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{workspaces.slice(0, 6).map(({ root, canvases, cover, latest }) => <Link key={root.id} href={`/canvas/project/${root.id}`} className="group min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card transition duration-200 hover:border-primary/35 hover:shadow-md hover:shadow-primary/5 motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        <CanvasProjectPreview project={cover} className="aspect-[16/10]" />
                        <div className="px-4 py-4"><div className="flex items-center justify-between gap-3"><h3 className="truncate text-[15px] font-medium transition-colors group-hover:text-primary">{root.workspaceTitle || root.title}</h3><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/60" /></div><div className="mt-2.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Layers3 className="size-3" />{canvases.length} 张画布</span><time dateTime={latest}>{new Date(latest).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })} 更新</time></div></div>
                    </Link>)}</div>
                        : <div className="flex items-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 px-5 py-7 sm:px-7"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted/80 text-muted-foreground"><FolderOpen className="size-5" strokeWidth={1.5} /></span><div><h3 className="text-[13px] font-medium">为下一部作品，留一个位置</h3><p className="mt-1.5 text-xs leading-5 text-muted-foreground">创建项目后，你的画布与创作进度会整理在这里。</p></div></div>}
            </section>

            {!user ? <p className="mt-7 flex flex-wrap items-center gap-x-1 text-[11px] leading-5 text-muted-foreground">访客项目保存在当前浏览器。<Link href="/login" className="text-primary underline-offset-4 hover:underline">登录账户</Link>可使用账号同步与平台模型。</p> : null}
        </main>
        <Modal title="新建项目" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={create} okText="创建并打开画布" cancelText="取消" okButtonProps={{ disabled: !hydrated }}><p className="mb-4 text-sm text-muted-foreground">自动创建第一张空白画布，之后可以在项目内继续添加。创建项目不消耗算力点。</p><Input autoFocus maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} onPressEnter={create} placeholder="给这次创作起个名字" aria-label="项目名称" /></Modal>
    </div>;
}
