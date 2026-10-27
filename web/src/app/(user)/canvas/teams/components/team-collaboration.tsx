"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Pagination, Popconfirm, Select, Spin, Tabs } from "antd";
import { FileText, FolderOpen, Plus, RefreshCw } from "lucide-react";
import localforage from "localforage";
import * as api from "@/services/api/teams";
import { ApiError } from "@/services/api/request";
import { fetchAccountStorageFiles, type StorageFileReferences } from "@/services/api/storage";
import { getProduction } from "@/services/api/production";
import { useCanvasStore } from "../../stores/use-canvas-store";
import { useTeamSession } from "../use-team-session";
import TeamProjectEditor from "./team-project-editor";

export default function TeamCollaboration({ teamId }: { teamId: string }) {
    const { token, userId, scope, current } = useTeamSession();
    const projects = useCanvasStore((state) => state.projects), ownerId = useCanvasStore((state) => state.ownerId), hydrated = useCanvasStore((state) => state.hydrated);
    const [team, setTeam] = useState<api.TeamDetail | null>(null), [shared, setShared] = useState<api.TeamList<api.TeamProject>>({ items: [], total: 0 }), [assets, setAssets] = useState<api.TeamList<api.TeamAsset>>({ items: [], total: 0 }), [audits, setAudits] = useState<api.TeamList<api.TeamAudit>>({ items: [], total: 0 });
    const [tab, setTab] = useState("projects"), [page, setPage] = useState(1), [reload, setReload] = useState(0), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [mode, setMode] = useState<"project" | "asset" | "transfer" | null>(null), [projectId, setProjectId] = useState(""), [workspaceId, setWorkspaceId] = useState(""), [editAllowed, setEditAllowed] = useState(false);
    const [files, setFiles] = useState<{ items: StorageFileReferences[]; total: number }>({ items: [], total: 0 }), [filePage, setFilePage] = useState(1), [fileType, setFileType] = useState<"image" | "video" | "audio">("image"), [objectId, setObjectId] = useState(""), [title, setTitle] = useState("");
    const [target, setTarget] = useState(""), [confirmation, setConfirmation] = useState("");
    const alive = useRef(true), lock = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        let active = true; setLoading(true);
        const load = async () => {
            try {
                const detail = await api.getTeam(token, teamId);
                const data = tab === "projects" ? await api.getTeamProjects(token, teamId, page) : tab === "assets" ? await api.getTeamAssets(token, teamId, page) : tab === "audit" && detail.myRole !== "member" ? await api.getTeamAudits(token, teamId, page) : null;
                if (!active || !current()) return; setTeam(detail);
                if (data) { const last = Math.max(1, Math.ceil(data.total / 20)); if (page > last) { setPage(last); return; } if (tab === "projects") setShared(data as api.TeamList<api.TeamProject>); else if (tab === "assets") setAssets(data as api.TeamList<api.TeamAsset>); else setAudits(data as api.TeamList<api.TeamAudit>); }
            } catch (failure) { if (active && current()) { setError(failure instanceof Error ? failure.message : "读取失败"); setTeam(null); setProjectId(""); setAssets({ items: [], total: 0 }); } }
            finally { if (active && current()) setLoading(false); }
        };
        void load(); const timer = setInterval(() => { if (!lock.current) void load(); }, 30000);
        return () => { active = false; clearInterval(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, teamId, tab, page, reload]);
    useEffect(() => {
        let active = true; if (mode !== "asset") return;
        setFiles({ items: [], total: 0 });
        void fetchAccountStorageFiles(token, { page: filePage, pageSize: 20, type: fileType }).then((value) => { if (active && current()) setFiles(value); }).catch((failure) => { if (active && current()) setError(failure instanceof Error ? failure.message : "文件读取失败"); });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, mode, filePage, fileType]);
    const act = async (action: () => Promise<unknown>, done?: () => void) => {
        if (lock.current || !current()) return; lock.current = true; setBusy(true); setError("");
        try { await action(); if (current() && alive.current) { done?.(); setReload((value) => value + 1); } }
        catch (failure) { if (current() && alive.current) { setError(failure instanceof Error ? failure.message : "操作失败"); if (failure instanceof ApiError && [401, 403].includes(failure.status)) { setTeam(null); setProjectId(""); setAssets({ items: [], total: 0 }); } } }
        finally { if (current() && alive.current) { lock.current = false; setBusy(false); } }
    };
    const shareProject = () => void act(async () => {
        const [doc, draft] = await Promise.all([getProduction(token, workspaceId), localforage.getItem<{ dirty: boolean }>(`production-draft:${userId}:${workspaceId}`)]);
        if (!current()) return;
        if (!doc) throw new Error("请先在个人项目中创建并保存制作计划"); if (draft?.dirty) throw new Error("此项目有本机未保存修改，请先保存制作计划再共享");
        await api.shareTeamProject(token, teamId, { workspaceId, revision: doc.revision, editAllowed });
    }, () => setMode(null));
    const open = (next: typeof mode) => { setMode(next); setError(""); setWorkspaceId(""); setEditAllowed(false); setObjectId(""); setTitle(""); setTarget(""); setConfirmation(""); };
    const manager = team?.myRole === "owner" || team?.myRole === "admin";
    const ownProjects = hydrated && ownerId === userId ? projects.filter((item) => !item.workspaceId) : [];
    const empty = (text: string) => <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</p>;
    const pager = (total: number) => <Pagination size="small" current={page} total={total} pageSize={20} showSizeChanger={false} disabled={busy || loading} onChange={setPage} />;
    return <section className="space-y-4 border-b border-border pb-6">
        {error && <Alert showIcon type="error" title={error} />}
        <Tabs activeKey={tab} onChange={(value) => { setTab(value); setPage(1); setError(""); }} tabBarExtraContent={<Button type="text" aria-label="刷新团队协作" disabled={busy || loading} icon={<RefreshCw className="size-4" />} onClick={() => setReload((value) => value + 1)} />} items={[
            { key: "projects", label: "共享项目", children: <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-6 text-muted-foreground">共同维护剧本、场次与镜头计划。版本检查防止覆盖伙伴修改。</p><Button disabled={busy || !team} icon={<Plus className="size-4" />} onClick={() => open("project")}>共享我的项目</Button></div>{loading ? <Spin /> : !team ? empty("团队权限不可用，请刷新") : shared.items.length ? <div className="grid gap-4 md:grid-cols-2">{shared.items.map((item) => <article key={item.id} className="space-y-4 rounded-xl border border-border p-4"><FileText className="size-5 text-muted-foreground" /><h4 className="truncate font-medium">{item.title}</h4><p className="text-xs text-muted-foreground">{item.editAllowed ? "成员可编辑制作计划" : "成员只读"} · {team.members.find((member) => member.userId === item.ownerUserId)?.displayName || "项目拥有者"}</p><div className="flex flex-wrap gap-2"><Button onClick={() => setProjectId(item.id)}>打开协作计划</Button>{(manager || item.ownerUserId === userId) && <><Button disabled={busy} onClick={() => void act(() => api.setTeamProjectEditing(token, item.id, !item.editAllowed))}>{item.editAllowed ? "设为只读" : "允许成员编辑"}</Button><Popconfirm title="撤销此项目共享？" description="成员无法继续查看、编辑或申请生成。个人制作计划保留。" onConfirm={() => act(() => api.revokeTeamProject(token, item.id))}><Button danger disabled={busy}>撤销</Button></Popconfirm></>}</div></article>)}</div> : empty("共享第一份制作计划，让伙伴参与剧本与拆镜。")}{pager(shared.total)}</div> },
            { key: "assets", label: "共享素材", children: <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-6 text-muted-foreground">只共享你选中的账号文件。团队不会看到个人素材库中的其他文件。</p><Button disabled={busy || !team} icon={<FolderOpen className="size-4" />} onClick={() => open("asset")}>选择我的素材</Button></div>{loading ? <Spin /> : team && assets.items.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{assets.items.map((item) => <article key={item.id} className="space-y-3 rounded-xl border border-border p-3"><div className="flex min-h-32 items-center justify-center overflow-hidden rounded-lg bg-muted/40">{item.kind === "image" ? <img src={api.teamAssetMediaUrl(item.id)} alt={item.title} loading="lazy" className="h-40 w-full object-contain" onError={() => { setAssets((value) => ({ ...value, items: value.items.filter((asset) => asset.id !== item.id) })); }} /> : item.kind === "video" ? <video src={api.teamAssetMediaUrl(item.id)} controls preload="metadata" className="max-h-40 w-full" /> : <audio src={api.teamAssetMediaUrl(item.id)} controls preload="none" className="w-full" />}</div><h4 className="truncate text-sm font-medium">{item.title}</h4><div className="flex justify-between gap-2"><a className="text-xs underline" href={api.teamAssetMediaUrl(item.id)} target="_blank" rel="noreferrer">打开素材</a>{(manager || item.ownerUserId === userId) && <Popconfirm title="撤销素材共享？" description="原文件保留，已经下载的副本无法收回。" onConfirm={() => act(() => api.revokeTeamAsset(token, item.id))}><Button size="small" danger disabled={busy}>撤销</Button></Popconfirm>}</div></article>)}</div> : empty("尚未共享素材。")}{pager(assets.total)}</div> },
            ...(manager ? [{ key: "audit", label: "操作记录", children: <div className="space-y-4">{loading ? <Spin /> : audits.items.length ? <div className="divide-y divide-border">{audits.items.map((item) => <div key={item.id} className="py-3"><p className="text-sm">{item.summary}</p><p className="mt-1 text-xs text-muted-foreground">{team?.members.find((member) => member.userId === item.actorId)?.displayName || "历史成员"} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p></div>)}</div> : empty("暂无操作记录")}{pager(audits.total)}</div> }] : []),
            ...(team?.myRole === "owner" ? [{ key: "permissions", label: "权限与所有权", children: <div className="space-y-5"><p className="text-xs leading-6 text-muted-foreground">所有者、管理员与对应项目拥有者可查看相关团队成本。可单独授权普通成员查看；个人账户完整账单仍私有。</p>{team.members.filter((member) => member.role === "member").map((member) => <div key={member.userId} className="flex items-center justify-between gap-4 border-b border-border py-3"><span className="text-sm">{member.displayName || "成员"}</span><Checkbox disabled={busy} checked={member.canViewCosts} onChange={(event) => void act(() => api.setTeamCostPermission(token, teamId, member.userId, event.target.checked))}>查看团队成本</Checkbox></div>)}<Button danger disabled={busy || team.members.length < 2} onClick={() => open("transfer")}>转移团队所有权</Button><p className="text-xs text-muted-foreground">只转移团队管理权。个人项目所有权、文件与钱包不转移。</p></div> }] : []),
        ]} />
        <Modal open={Boolean(projectId)} title="共享制作计划" width={1120} styles={{ body: { maxHeight: "76vh", overflowY: "auto" } }} footer={null} mask={{ closable: false }} onCancel={() => setProjectId("")}>{projectId && <TeamProjectEditor key={`${scope}:${projectId}`} projectId={projectId} />}</Modal>
        <Modal open={Boolean(mode)} title={mode === "project" ? "共享我的制作计划" : mode === "asset" ? "共享指定素材" : "转移团队所有权"} styles={{ body: { maxHeight: "65vh", overflowY: "auto" } }} width={650} closable={!busy} mask={{ closable: false }} onCancel={() => !busy && setMode(null)} footer={<div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setMode(null)}>取消</Button><Button type="primary" danger={mode === "transfer"} loading={busy} disabled={mode === "project" ? !workspaceId : mode === "asset" ? !objectId || !title.trim() : !target || confirmation !== `转移团队所有权：${team?.name}`} onClick={() => { if (mode === "project") shareProject(); else if (mode === "asset") void act(() => api.shareTeamAsset(token, teamId, objectId, title), () => setMode(null)); else void act(() => api.transferTeamOwner(token, teamId, target, confirmation), () => setMode(null)); }}>{mode === "transfer" ? "确认转移所有权" : "确认共享"}</Button></div>}>
            <div className="space-y-5 py-3">{error && <Alert type="error" title={error} />}{mode === "project" ? <><p className="text-sm leading-7">共享整个已保存制作计划的剧本、场次、镜头和资产文字设定给当前与之后加入的成员。私人画布、原始文件、候选结果与剪辑轨道不会公开。一个个人项目同时只能共享到一个团队。</p><Select aria-label="选择我的项目" className="w-full" value={workspaceId || undefined} placeholder="选择已保存制作计划的项目" disabled={busy} options={ownProjects.map((item) => ({ value: item.id, label: item.workspaceTitle || item.title }))} onChange={setWorkspaceId} /><Checkbox disabled={busy} checked={editAllowed} onChange={(event) => setEditAllowed(event.target.checked)}>允许团队成员编辑剧本与制作计划</Checkbox></> : mode === "asset" ? <><p className="text-sm leading-7">选择一份已上传到账号的图片、视频或音频；浏览器本地素材需要先上传至账号。撤销共享后，新请求会被拒绝。</p><Select aria-label="素材类型" value={fileType} disabled={busy} options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }, { value: "audio", label: "音频" }]} onChange={(value) => { setFileType(value); setFilePage(1); setObjectId(""); }} /><div className="space-y-2">{files.items.map(({ file }) => <button type="button" key={file.id} disabled={busy || file.deletePending} className={`flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left text-sm ${objectId === file.id ? "border-foreground bg-muted" : "border-border"}`} onClick={() => { setObjectId(file.id); setTitle(file.name.slice(0, 180)); }}><span className="truncate">{file.name}</span><span className="shrink-0 text-xs text-muted-foreground">{Math.ceil(file.bytes / 1024)} KB</span></button>)}</div><Pagination simple current={filePage} total={files.total} pageSize={20} showSizeChanger={false} disabled={busy} onChange={setFilePage} /><Input aria-label="共享素材名称" placeholder="共享素材名称" value={title} maxLength={180} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></> : <><Alert type="warning" showIcon title="转移完成后，你将成为管理员，无法自行撤回所有权。" /><Select aria-label="新团队所有者" className="w-full" value={target || undefined} placeholder="选择当前团队成员" disabled={busy} options={team?.members.filter((member) => member.userId !== userId).map((member) => ({ value: member.userId, label: member.displayName || member.userId }))} onChange={setTarget} /><p className="text-xs leading-6 text-muted-foreground">请输入：转移团队所有权：{team?.name}</p><Input aria-label="转移确认文字" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /><p className="text-xs leading-6 text-muted-foreground">个人项目、文件与钱包保持各自所有。已发起任务的费用仍由原确认付款者承担。</p></>}</div>
        </Modal>
    </section>;
}
