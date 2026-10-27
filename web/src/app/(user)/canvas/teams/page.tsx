"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Checkbox, Input, Modal, Pagination, Popconfirm, Select, Spin } from "antd";
import { Clapperboard, Copy, Plus, RefreshCw, Share2, Users } from "lucide-react";
import localforage from "localforage";
import * as api from "@/services/api/teams";
import { getProduction } from "@/services/api/production";
import { ApiError } from "@/services/api/request";
import { useCopyText } from "@/hooks/use-copy-text";
import { useCanvasStore } from "../stores/use-canvas-store";
import type { ProductionDocument } from "../lib/production-types";
import { useTeamSession } from "./use-team-session";
import TeamReview from "./components/team-review";
import TeamCollaboration from "./components/team-collaboration";

const roles = { owner: "所有者", admin: "管理员", member: "成员" };
type TeamState = { key: string; detail: api.TeamDetail; reviews: api.TeamList<api.TeamReview>; invites: api.TeamInvite[] };

export default function TeamsPage() {
    const { token, userId, ready, scope, current } = useTeamSession();
    const copy = useCopyText();
    const projects = useCanvasStore((state) => state.projects);
    const ownerId = useCanvasStore((state) => state.ownerId);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [teams, setTeams] = useState<{ scope: string; value: api.TeamList<api.Team> } | null>(null);
    const [teamId, setTeamId] = useState(""), [teamPage, setTeamPage] = useState(1), [reviewPage, setReviewPage] = useState(1);
    const [renderScope, setRenderScope] = useState(scope);
    const [state, setState] = useState<TeamState | null>(null), [reviewId, setReviewId] = useState("");
    const [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [mode, setMode] = useState<"create" | "join" | "rename" | "publish" | null>(null), [name, setName] = useState("");
    const [invite, setInvite] = useState<(api.TeamInvite & { code: string }) | null>(null);
    const [workspaceId, setWorkspaceId] = useState(""), [episodeIds, setEpisodeIds] = useState<string[]>([]), [includeScript, setIncludeScript] = useState(false);
    const [plan, setPlan] = useState<{ key: string; value: ProductionDocument | null; dirty: boolean } | null>(null), [planLoading, setPlanLoading] = useState(false);
    const lock = useRef(false), activePlan = useRef("");
    const teamKey = `${scope}:${teamId}:${reviewPage}`, planKey = `${scope}:${workspaceId}`;
    activePlan.current = planKey;
    const team = ready && state?.key === teamKey ? state : null;
    const choices = hydrated && ownerId === userId ? projects.filter((item) => !item.workspaceId) : [];
    const currentPlan = plan?.key === planKey ? plan : null;
    const manager = team?.detail.myRole === "owner" || team?.detail.myRole === "admin";
    const teamList = ready && teams?.scope === scope ? teams.value : null;
    useEffect(() => { setTeamId(""); setTeamPage(1); setReviewPage(1); setState(null); setReviewId(""); setMode(null); setInvite(null); setError(""); setBusy(false); lock.current = false; setRenderScope(scope); }, [scope]);
    useEffect(() => {
        let active = true;
        if (ready) void api.getTeams(token, teamPage).then((result) => {
            if (!active || !current()) return;
            const last = Math.max(1, Math.ceil(result.total / 20));
            if (teamPage > last) setTeamPage(last); else { setTeams({ scope, value: result }); setTeamId((selected) => selected || result.items[0]?.id || ""); }
        }).catch((failure) => { if (active && current()) { setTeams(null); setError(failure instanceof Error ? failure.message : "团队读取失败"); } });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, ready, teamPage, reload]);
    useEffect(() => {
        let active = true, timer: ReturnType<typeof setTimeout> | undefined;
        const load = async () => {
            if (!teamId || !ready || !current()) return;
            try {
                const detail = await api.getTeam(token, teamId);
                if (!active || !current()) return;
                const [reviews, invites] = await Promise.all([api.getTeamReviews(token, teamId, reviewPage), detail.myRole !== "member" ? api.getTeamInvites(token, teamId) : Promise.resolve([])]);
                if (!active || !current()) return;
                const last = Math.max(1, Math.ceil(reviews.total / 20));
                if (reviewPage > last) setReviewPage(last); else setState({ key: teamKey, detail, reviews, invites });
            } catch (failure) { if (active && current()) { setState(null); setInvite(null); setError(failure instanceof Error ? failure.message : "团队权限可能已变化，请刷新"); } }
            if (active && current()) timer = setTimeout(load, 30000);
        };
        void load(); return () => { active = false; if (timer) clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teamKey, ready, reload]);
    useEffect(() => {
        let active = true; setPlan(null); setEpisodeIds([]); setPlanLoading(false);
        if (mode === "publish" && workspaceId && current()) {
            setPlanLoading(true);
            void Promise.all([getProduction(token, workspaceId), localforage.getItem<{ dirty: boolean }>(`production-draft:${userId}:${workspaceId}`)]).then(([value, draft]) => {
                if (active && current()) { setPlan({ key: planKey, value, dirty: Boolean(draft?.dirty) }); setEpisodeIds(value?.episodes.map((item) => item.id) || []); }
            }).catch((failure) => { if (active && current()) setError(failure instanceof Error ? failure.message : "读取计划失败，请回制作计划保存后重试"); }).finally(() => { if (active && current()) setPlanLoading(false); });
        }
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planKey, mode]);
    const act = async (action: () => Promise<unknown>, done?: (value: unknown) => void) => {
        if (!current() || lock.current) return; lock.current = true; setBusy(true); setError("");
        try { const result = await action(); if (current()) { done?.(result); setReload((n) => n + 1); } }
        catch (failure) { if (current()) { if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setState(null); setInvite(null); } setError(failure instanceof Error ? failure.message : "操作未完成，请重试"); } }
        finally { if (current()) { lock.current = false; setBusy(false); } }
    };
    const open = (next: typeof mode) => { setError(""); setMode(next); setName(next === "rename" ? team?.detail.name || "" : ""); if (next === "publish") { setWorkspaceId(""); setIncludeScript(false); } };
    const submit = () => {
        if (mode === "publish") {
            const doc = currentPlan?.value;
            if (!currentPlan || !doc || currentPlan.dirty || !episodeIds.length) return;
            const submittedPlan = planKey;
            void act(async () => {
                const draft = await localforage.getItem<{ dirty: boolean }>(`production-draft:${userId}:${workspaceId}`);
                if (!current() || activePlan.current !== submittedPlan) throw new Error("账号或所选项目已变化，请重新确认");
                if (draft?.dirty) throw new Error("项目有本机未保存修改，请先保存制作计划，再重新读取发布");
                return api.publishTeamReview(token, teamId, { workspaceId, revision: doc.revision, episodeIds, includeScript });
            }, (result) => { setMode(null); setReviewId((result as api.TeamReview).id); });
        } else if (mode === "create") void act(() => api.createTeam(token, name), (result) => { setTeamId((result as api.Team).id); setReviewPage(1); setMode(null); });
        else if (mode === "join") void act(() => api.joinTeam(token, name), (result) => { setTeamId((result as { teamId: string }).teamId); setReviewPage(1); setMode(null); });
        else if (mode === "rename") void act(() => api.renameTeam(token, teamId, name), () => setMode(null));
    };
    if (!ready) return <div className="p-8 text-sm text-muted-foreground">登录后可使用团队审片空间。</div>;
    if (renderScope !== scope) return <div className="p-8 text-sm text-muted-foreground">正在切换账号…</div>;
    return <div className="mx-auto h-full w-full max-w-[1600px] space-y-7 overflow-y-auto px-5 py-7 sm:px-8">
        {reviewId ? <TeamReview key={`${scope}:${reviewId}`} id={reviewId} onBack={() => { setReviewId(""); setReload((n) => n + 1); }} /> : <>
            <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-3 text-2xl font-semibold"><Users className="size-6" />团队协作</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">与伙伴共同维护制作计划、共享指定素材、审批生成并审片。个人画布、文件与钱包独立管理。</p></div><div className="flex flex-wrap gap-2"><Button disabled={busy} icon={<RefreshCw className="size-4" />} onClick={() => setReload((n) => n + 1)}>刷新</Button><Button disabled={busy} onClick={() => open("join")}>邀请码加入</Button><Button type="primary" disabled={busy} icon={<Plus className="size-4" />} onClick={() => open("create")}>创建团队</Button></div></header>
            {error && <Alert type="error" showIcon title={error} />}
            <div className="grid items-start gap-7 lg:grid-cols-[230px_minmax(0,1fr)]">
                <aside className="space-y-3"><p className="text-xs text-muted-foreground">我的团队 · {teamList?.total || 0}</p>{teamList?.items.map((item) => <button key={item.id} type="button" disabled={busy} className={`w-full rounded-xl px-4 py-4 text-left text-sm transition-colors ${teamId === item.id ? "bg-muted font-medium" : "hover:bg-muted/50"}`} onClick={() => { setTeamId(item.id); setReviewPage(1); setInvite(null); setError(""); }}><span className="block truncate">{item.name}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{item.ownerId === userId ? "我创建的团队" : "我加入的团队"}</span></button>)}{teamList?.total === 0 && <p className="rounded-xl border border-dashed border-border p-5 text-xs leading-6 text-muted-foreground">创建一个团队，或使用伙伴提供的一次性邀请码加入。</p>}<Pagination simple hideOnSinglePage size="small" current={teamPage} total={teamList?.total || 0} pageSize={20} showSizeChanger={false} disabled={busy} onChange={setTeamPage} /></aside>
                {team ? <main className="min-w-0 space-y-7"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5"><div><h2 className="text-xl font-semibold">{team.detail.name}</h2><p className="mt-2 text-xs text-muted-foreground">{team.detail.members.length} 位成员 · 我的角色：{roles[team.detail.myRole]}</p></div><div className="flex gap-2">{manager && <Button disabled={busy} onClick={() => open("rename")}>团队设置</Button>}<Button type="primary" icon={<Share2 className="size-4" />} disabled={busy} onClick={() => open("publish")}>分享我的制作快照</Button></div></div>
                    <TeamCollaboration key={`${scope}:${teamId}`} teamId={teamId} />
                    <section className="space-y-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">审片版本</h3><span className="text-xs text-muted-foreground">{team.reviews.total} 份</span></div>{team.reviews.items.length ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{team.reviews.items.map((item) => <button type="button" key={item.id} className="rounded-xl border border-border p-5 text-left transition-colors hover:bg-muted/40" onClick={() => setReviewId(item.id)}><Clapperboard className="mb-5 size-6 text-muted-foreground" /><h4 className="truncate text-base font-semibold">{item.title}</h4><p className="mt-2 text-xs text-muted-foreground">制作计划版本 {item.sourceRevision} · {team.detail.members.find((member) => member.userId === item.publisherId)?.displayName || "团队成员"}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("zh-CN")}</p><span className="mt-5 inline-block text-xs">打开审片 →</span></button>)}</div> : <div className="rounded-xl border border-dashed border-border p-10 text-center"><Clapperboard className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 text-sm">分享第一份镜头快照</p><p className="mt-2 text-xs leading-6 text-muted-foreground">先在个人项目里保存制作计划并采用结果，再邀请团队一起审片。</p></div>}<Pagination size="small" current={reviewPage} total={team.reviews.total} pageSize={20} showSizeChanger={false} disabled={busy} onChange={setReviewPage} /></section>
                    <details className="border-t border-border pt-5"><summary className="cursor-pointer text-sm font-semibold">团队成员与邀请</summary><div className="mt-5 space-y-5">{manager && <div className="space-y-3 rounded-xl bg-muted/40 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-6 text-muted-foreground">邀请码 24 小时有效，每个码只能供一名新成员加入。新成员默认可审片和发布自己的快照。</p><Button disabled={busy} onClick={() => void act(() => api.createTeamInvite(token, teamId), (result) => setInvite(result as api.TeamInvite & { code: string }))}>生成邀请码</Button></div>{invite && <div className="flex gap-2"><Input aria-label="新生成的一次性邀请码" value={invite.code} readOnly /><Button aria-label="复制一次性邀请码" icon={<Copy className="size-4" />} onClick={() => copy(invite.code, "邀请码已复制")} /></div>}<p className="text-xs text-muted-foreground">邀请码只在生成时显示，请复制后自行发送给伙伴。</p>{team.invites.filter((item) => !item.usedAt && !item.revokedAt && Date.parse(item.expiresAt) > Date.now()).map((item) => <div key={item.id} className="flex items-center justify-between gap-2 text-xs"><span>待使用 · 到期 {new Date(item.expiresAt).toLocaleString("zh-CN")}</span><Button type="text" size="small" disabled={busy} onClick={() => void act(() => api.revokeTeamInvite(token, teamId, item.id), () => { if (invite?.id === item.id) setInvite(null); })}>撤销邀请</Button></div>)}</div>}
                        <div className="divide-y divide-border">{team.detail.members.map((member) => <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm">{member.displayName || "团队成员"}{member.userId === userId ? "（我）" : ""}</p><p className="mt-1 text-xs text-muted-foreground">{roles[member.role]}</p></div><div className="flex gap-2">{team.detail.myRole === "owner" && member.role !== "owner" && <Select aria-label={`调整${member.displayName}的角色`} value={member.role} disabled={busy} options={[{ value: "admin", label: "管理员" }, { value: "member", label: "成员" }]} onChange={(role) => void act(() => api.updateTeamMember(token, teamId, member.userId, role))} />}{member.role !== "owner" && (member.userId === userId || team.detail.myRole === "owner" || (team.detail.myRole === "admin" && member.role === "member")) && <Popconfirm title={member.userId === userId ? "退出团队？" : "移除此成员？"} description="该成员发出的邀请、项目、素材和审片共享将撤销；个人项目和原文件保留。" onConfirm={() => act(() => api.removeTeamMember(token, teamId, member.userId), () => { if (member.userId === userId) { setTeamId(""); setState(null); } })}><Button danger size="small" disabled={busy}>{member.userId === userId ? "退出" : "移除"}</Button></Popconfirm>}</div></div>)}</div>
                        {team.detail.myRole === "owner" && <Popconfirm title="解散团队审片空间？" description="所有邀请与分享立即失效，个人项目和素材保留。此操作无法撤销。" onConfirm={() => act(() => api.deleteTeam(token, teamId), () => { setTeamId(""); setState(null); })}><Button danger disabled={busy}>解散团队</Button></Popconfirm>}
                    </div></details>
                    <p className="border-t border-border pt-5 text-xs leading-6 text-muted-foreground">团队成员可查看主动共享的项目与素材、共同维护制作计划、发表评论。生成申请由项目拥有者确认付款，个人钱包独立。撤销后新请求立即拒绝；已经观看或保存的内容无法收回。</p>
                </main> : <div className="py-20 text-center text-sm text-muted-foreground">{teamId ? error ? "团队暂不可用，请重新选择或刷新。" : <Spin /> : "选择团队，开始一起审片。"}</div>}
            </div>
        </>}
        <Modal open={Boolean(mode)} title={mode === "publish" ? "分享制作快照" : mode === "join" ? "使用邀请码加入" : mode === "rename" ? "修改团队名称" : "创建团队审片空间"} width={600} styles={{ body: { maxHeight: "65vh", overflowY: "auto" } }} onCancel={() => !busy && setMode(null)} closable={!busy} mask={{ closable: false }} footer={<div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setMode(null)}>取消</Button><Button type="primary" loading={busy} disabled={mode === "publish" ? planLoading || !currentPlan?.value || currentPlan.dirty || !episodeIds.length : !name.trim()} onClick={submit}>{mode === "publish" ? "确认发布只读快照" : mode === "join" ? "加入团队" : "保存"}</Button></div>}>
            <div className="space-y-5 py-3">{error && <Alert type="error" showIcon title={error} />}{mode === "publish" ? <><p className="text-sm leading-7">将已保存的所选分集镜头文字与已采用的账号文件分享给「{team?.detail.name}」当前及之后加入的成员。后续修改需发布新版本，评论保留在对应审片版本。</p><Select aria-label="选择自己的制作项目" className="w-full" showSearch={{ optionFilterProp: "label" }} placeholder="选择我的项目" value={workspaceId || undefined} disabled={busy} options={choices.map((item) => ({ value: item.id, label: item.workspaceTitle || item.title }))} onChange={setWorkspaceId} />{planLoading ? <Spin /> : currentPlan && (currentPlan.value ? <><p className="text-xs text-muted-foreground">账号已保存版本：{currentPlan.value.revision} · {currentPlan.value.shots.length} 个镜头</p>{currentPlan.dirty && <Alert type="warning" title="本机有未保存修改，请先保存制作计划再重新打开分享。" />}<Select mode="multiple" aria-label="选择要分享的分集" className="w-full" value={episodeIds} disabled={busy} options={currentPlan.value.episodes.map((item) => ({ value: item.id, label: item.title }))} onChange={setEpisodeIds} /><Checkbox checked={includeScript} disabled={busy} onChange={(event) => setIncludeScript(event.target.checked)}>同时分享所选分集的完整剧本</Checkbox><p className="text-xs leading-6 text-muted-foreground">只包含已采用的图片／视频，不包含未采用候选、资产参考、画布节点、模型参数、价格与账单。仅外链或浏览器文件不会自动上传，快照中会提示媒体暂不可用。</p><Link href={`/canvas/project/${encodeURIComponent(workspaceId)}/production`} className="inline-block text-sm underline">前往制作计划检查与保存</Link></> : <p className="text-sm text-muted-foreground">这个项目还没有账号制作计划，请先在制作计划页面创建并保存。</p>)}</> : <><label className="block text-sm">{mode === "join" ? "一次性邀请码" : "团队名称"}<Input className="mt-2" autoFocus value={name} maxLength={mode === "join" ? 64 : 180} disabled={busy} onChange={(event) => setName(event.target.value)} onPressEnter={submit} placeholder={mode === "join" ? "粘贴伙伴发给你的邀请码" : "例如：短剧创作组"} /></label><p className="text-xs leading-6 text-muted-foreground">{mode === "join" ? "加入后可查看团队主动分享的审片版本并留下镜头意见，不会共享你的个人项目或算力。" : "团队支持制作计划协作、素材共享与审片，个人画布和余额保持独立。"}</p></>}</div>
        </Modal>
    </div>;
}
