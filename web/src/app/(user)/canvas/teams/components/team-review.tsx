"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Pagination, Popconfirm, Spin } from "antd";
import { ArrowLeft, Clapperboard, MessageSquare, RefreshCw } from "lucide-react";
import localforage from "localforage";
import { ApiError } from "@/services/api/request";
import { addReviewComment, deleteReviewComment, getReviewComments, getTeamReview, revokeTeamReview, type ReviewComment, type TeamList, type TeamReviewDetail } from "@/services/api/teams";
import { useTeamSession } from "../use-team-session";

export default function TeamReview({ id, onBack }: { id: string; onBack: () => void }) {
    const { token, userId, ready, scope, current } = useTeamSession();
    const [snapshot, setSnapshot] = useState<{ key: string; value: TeamReviewDetail } | null>(null);
    const [shotId, setShotId] = useState("");
    const [comments, setComments] = useState<{ key: string; value: TeamList<ReviewComment> } | null>(null);
    const [page, setPage] = useState(1), [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [drafts, setDrafts] = useState<Record<string, string>>({}), [draftReady, setDraftReady] = useState(false);
    const lock = useRef(false), writes = useRef<Promise<unknown>>(Promise.resolve());
    const key = `${scope}:${id}`, commentKey = `${key}:${shotId}:${page}`, storageKey = `team-review-comments:${userId}:${id}`;
    const value = ready && snapshot?.key === key ? snapshot.value : null;
    const shot = value?.shots.find((item) => item.id === shotId);
    const commentList = comments?.key === commentKey ? comments.value : null;
    const text = drafts[shotId] || "";
    const failureMessage = (failure: unknown) => {
        if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setSnapshot(null); setComments(null); }
        setError(failure instanceof Error ? failure.message : "操作失败，意见草稿已保留");
    };
    const mediaUnavailable = () => { setSnapshot(null); setComments(null); setError("审片媒体暂不可用或权限已变化，请刷新确认当前分享状态。"); };
    const saveDrafts = (next: Record<string, string>) => {
        setDrafts(next);
        writes.current = writes.current.catch(() => undefined).then(() => localforage.setItem(storageKey, next));
        void writes.current.catch(() => { if (current()) setError("意见草稿未能保存到浏览器，请保持页面打开。"); });
    };
    useEffect(() => {
        let active = true; setDraftReady(false); setDrafts({});
        void localforage.getItem<Record<string, string>>(storageKey).then((saved) => {
            if (active && current()) setDrafts(Object.fromEntries(Object.entries(saved || {}).filter(([id, body]) => id.length <= 128 && typeof body === "string" && body.length <= 2000)));
        }).catch(() => { if (active && current()) setError("本机意见草稿暂不可用，请及时提交意见。"); }).finally(() => { if (active && current()) setDraftReady(true); });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey, scope]);
    useEffect(() => {
        let active = true, timer: ReturnType<typeof setTimeout> | undefined;
        const load = async () => {
            if (!ready || !current()) return;
            try {
                const result = await getTeamReview(token, id);
                if (active && current()) { setSnapshot({ key, value: result }); setShotId((selected) => result.shots.some((item) => item.id === selected) ? selected : result.shots[0]?.id || ""); setError(""); }
            } catch (failure) { if (active && current()) { setSnapshot(null); setError(failure instanceof Error ? failure.message : "审片读取失败"); } }
            if (active && current()) timer = setTimeout(load, 30000);
        };
        void load(); return () => { active = false; if (timer) clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, ready, reload]);
    useEffect(() => {
        let active = true;
        if (shot && ready) void getReviewComments(token, id, shot.id, page).then((result) => {
            if (!active || !current()) return;
            const last = Math.max(1, Math.ceil(result.total / 20));
            if (page > last) setPage(last); else setComments({ key: commentKey, value: result });
        }).catch((failure) => { if (active && current()) { setComments(null); failureMessage(failure); } });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [commentKey, Boolean(shot), reload]);
    const act = async (action: () => Promise<unknown>, done?: () => void) => {
        if (lock.current || !current()) return; lock.current = true; setBusy(true); setError("");
        try { await action(); if (current()) { done?.(); setReload((n) => n + 1); } }
        catch (failure) { if (current()) failureMessage(failure); }
        finally { if (current()) { lock.current = false; setBusy(false); } }
    };
    return <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><Button icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={busy}>返回团队</Button><div className="flex gap-2"><Button icon={<RefreshCw className="size-4" />} onClick={() => setReload((n) => n + 1)} disabled={busy}>刷新</Button>{value?.canRevoke && <Popconfirm title="撤销此审片分享？" description="成员将无法再读取此版本和评论，个人计划与文件保留。" onConfirm={() => act(() => revokeTeamReview(token, id), onBack)}><Button danger disabled={busy}>撤销分享</Button></Popconfirm>}</div></div>
        {error && <Alert type="error" showIcon title={error} />}
        {!value ? <div className="py-20 text-center text-sm text-muted-foreground">{error ? "审片暂不可用，请返回团队或刷新。" : <Spin />}</div> : <>
            <header><p className="text-xs text-muted-foreground">只读审片 · 制作计划版本 {value.sourceRevision}</p><h1 className="mt-2 text-2xl font-semibold">{value.title}</h1><p className="mt-2 text-xs leading-6 text-muted-foreground">这是发布时的镜头与采用结果快照。意见只记录在此审片版本，不会改动画布或发起生成。</p></header>
            <div className="grid items-start gap-6 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
                <nav aria-label="选择审片镜头" className="max-h-48 space-y-4 xl:max-h-[65vh] overflow-y-auto rounded-xl border border-border p-3">{value.episodes.map((episode) => <div key={episode.id}><h2 className="px-2 py-2 text-xs font-semibold text-muted-foreground">{episode.title}</h2>{value.shots.filter((item) => item.episodeId === episode.id).map((item) => <button key={item.id} type="button" disabled={busy} aria-current={shotId === item.id ? "true" : undefined} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors ${shotId === item.id ? "bg-muted font-medium" : "hover:bg-muted/50"}`} onClick={() => { setShotId(item.id); setPage(1); }}><Clapperboard className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="text-xs text-muted-foreground">{item.seconds}s</span></button>)}</div>)}</nav>
                {shot && <><article className="min-w-0 space-y-4"><div className="overflow-hidden rounded-xl border border-border bg-muted/30">{shot.videoUrl ? <video key={shot.videoUrl} src={shot.videoUrl} onError={mediaUnavailable} controls preload="metadata" className="max-h-[56vh] w-full object-contain" /> : shot.imageUrl ? <img src={shot.imageUrl} onError={mediaUnavailable} alt={shot.title} className="max-h-[56vh] w-full object-contain" /> : <div className="flex min-h-56 items-center justify-center gap-3 p-8 text-sm text-muted-foreground"><Clapperboard className="size-6" />尚未分享可预览的采用结果</div>}</div>{shot.videoUrl && shot.imageUrl && <details><summary className="cursor-pointer text-xs text-muted-foreground">查看采用图片</summary><img src={shot.imageUrl} onError={mediaUnavailable} alt={`${shot.title}采用图片`} className="mt-3 max-h-72 rounded-lg object-contain" /></details>}{shot.unavailableMedia && <Alert type="warning" title="部分采用结果未保存为账号文件，本版仅分享文字。发布者保存文件后可重新发布。" />}
                    <div><h2 className="text-lg font-semibold">{shot.title}</h2><p className="mt-1 text-xs text-muted-foreground">{shot.sceneTitle || "未分场"} · {shot.seconds} 秒</p><p className="mt-4 whitespace-pre-wrap text-sm leading-7">{shot.description}</p>{shot.dialogue && <p className="mt-4 whitespace-pre-wrap border-l-2 border-border pl-4 text-sm leading-7">{shot.dialogue}</p>}{shot.camera && <p className="mt-3 text-xs leading-6 text-muted-foreground">景别／运镜：{shot.camera}</p>}</div>
                    {value.episodes.find((item) => item.id === shot.episodeId)?.script && <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm">本集剧本（发布者已共享）</summary><pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-7">{value.episodes.find((item) => item.id === shot.episodeId)?.script}</pre></details>}
                </article><aside className="space-y-4 rounded-xl border border-border p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-4" />镜头意见 <span className="text-muted-foreground">{commentList?.total || 0}</span></h2><Input.TextArea aria-label="本镜头审片意见" rows={4} maxLength={2000} showCount value={text} disabled={busy || !draftReady} placeholder="记录画面、表演、节奏或对白的修改建议…" onChange={(event) => saveDrafts({ ...drafts, [shotId]: event.target.value })} /><Button className="!mt-6" block type="primary" disabled={!text.trim() || !draftReady} loading={busy} onClick={() => void act(() => addReviewComment(token, id, shotId, text), () => { saveDrafts({ ...drafts, [shotId]: "" }); setPage(1); })}>提交意见</Button><div className="space-y-4 border-t border-border pt-4">{commentList?.items.map((comment) => <article key={comment.id} className="border-b border-border pb-4"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{comment.authorName || "团队成员"}</span>{(comment.authorId === userId || value.canRevoke) && <Popconfirm title="删除这条意见？" onConfirm={() => act(() => deleteReviewComment(token, id, comment.id))}><Button size="small" type="text" disabled={busy}>删除</Button></Popconfirm>}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{comment.body}</p><p className="mt-2 text-[11px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString("zh-CN")}</p></article>)}</div>{!commentList?.total && <p className="py-4 text-center text-xs text-muted-foreground">还没有镜头意见</p>}<Pagination simple size="small" current={page} total={commentList?.total || 0} pageSize={20} showSizeChanger={false} disabled={busy} onChange={setPage} /></aside></>}
            </div>
        </>}
    </section>;
}
