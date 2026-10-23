"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, InputNumber, Popconfirm, Select, Spin, Tabs } from "antd";
import { Plus, RefreshCw, Save } from "lucide-react";
import localforage from "localforage";
import * as api from "@/services/api/teams";
import { ApiError } from "@/services/api/request";
import { useTeamSession } from "../use-team-session";
import TeamGenerationPanel from "./team-generation-panel";

type Draft = { plan: api.TeamPlan; dirty: boolean };
export default function TeamProjectEditor({ projectId }: { projectId: string }) {
    const { token, userId, scope, current } = useTeamSession();
    const [detail, setDetail] = useState<api.TeamProjectDetail | null>(null), [plan, setPlan] = useState<api.TeamPlan | null>(null);
    const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [warning, setWarning] = useState("");
    const [episodeId, setEpisodeId] = useState(""), [shotId, setShotId] = useState("");
    const alive = useRef(true), lock = useRef(false), writes = useRef(Promise.resolve());
    const key = `team-plan-draft:${userId}:${projectId}`;
    const load = async (discard = false) => {
        if (!current() || lock.current) return; lock.current = true; setBusy(true); setError("");
        try {
            await writes.current;
            const [value, draft] = await Promise.all([api.getTeamProject(token, projectId), localforage.getItem<Draft>(key)]);
            if (!current() || !alive.current) return;
            const restore = !discard && draft?.dirty && value.canEdit;
            setDetail(value); setPlan(restore ? draft.plan : value.plan); setDirty(Boolean(restore));
            setEpisodeId((restore ? draft.plan : value.plan).episodes[0]?.id || ""); setShotId("");
            setWarning(restore && draft.plan.revision !== value.plan.revision ? "草稿基于旧版本。请先复制需要保留的内容，再重新加载最新版本；旧版本无法覆盖团队更新。" : restore ? "已恢复本机未提交草稿。" : "");
            if (discard) await localforage.removeItem(key);
        } catch (failure) { if (current() && alive.current) { setError(failure instanceof Error ? failure.message : "读取失败"); if (failure instanceof ApiError && [401, 403].includes(failure.status)) { setDetail(null); setPlan(null); } } }
        finally { if (current() && alive.current) { lock.current = false; setBusy(false); } }
    };
    useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; /* identity is remounted by parent */
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, projectId]);
    useEffect(() => {
        const timer = setInterval(() => { if (!current() || lock.current) return; void api.getTeamProject(token, projectId).then((value) => { if (!current() || !alive.current) return; setDetail(value); if (plan && value.plan.revision !== plan.revision) setWarning("团队计划有新版本。请保留本机修改后重新加载，保存时会检查版本。"); }).catch((failure) => { if (current() && alive.current && failure instanceof ApiError && [401, 403].includes(failure.status)) { setDetail(null); setPlan(null); setError("共享或成员权限已撤销。"); } }); }, 30000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, projectId, plan?.revision]);
    const change = (next: api.TeamPlan) => {
        if (!current() || !detail?.canEdit || lock.current) return; setPlan(next); setDirty(true);
        writes.current = writes.current.catch(() => undefined).then(async () => { await localforage.setItem(key, { plan: next, dirty: true }); }).catch(() => { if (current() && alive.current) setWarning("本机草稿保存失败，请保留当前页面并尽快保存到团队。"); });
    };
    const save = async () => {
        if (!plan || !current() || lock.current || !detail?.canEdit) return; lock.current = true; setBusy(true); setError("");
        try {
            const saved = await api.saveTeamProject(token, projectId, plan);
            if (!current() || !alive.current) return; setPlan(saved); setDirty(false); setWarning(""); setDetail((value) => value ? { ...value, plan: saved } : value);
            await writes.current;
            try { await localforage.removeItem(key); } catch { if (current() && alive.current) setWarning("团队已保存，但本机旧草稿未清除。重新打开后请加载最新版本，勿重复提交旧稿。"); }
        } catch (failure) { if (current() && alive.current) { setError(failure instanceof Error ? failure.message : "保存失败，草稿已保留"); if (failure instanceof ApiError && [401, 403].includes(failure.status)) { setDetail(null); setPlan(null); } } }
        finally { if (current() && alive.current) { lock.current = false; setBusy(false); } }
    };
    if (!detail || !plan) return <div className="space-y-4 py-5">{error ? <Alert type="error" title={error} /> : <Spin />}</div>;
    const episode = plan.episodes.find((item) => item.id === episodeId);
    const shots = plan.shots.filter((item) => item.episodeId === episodeId).sort((a, b) => a.order - b.order);
    const shot = shots.find((item) => item.id === shotId) || shots[0];
    const disabled = busy || !detail.canEdit;
    const updateShot = (patch: Partial<api.TeamPlan["shots"][number]>) => shot && change({ ...plan, shots: plan.shots.map((item) => item.id === shot.id ? { ...item, ...patch } : item) });
    const field = (label: string, value: string, update: (value: string) => void, rows = 3) => <label className="block space-y-2 text-xs text-muted-foreground"><span>{label}</span><Input.TextArea value={value} rows={rows} disabled={disabled} onChange={(event) => update(event.target.value)} /></label>;
    return <div className="space-y-4">
        <p className="text-xs leading-6 text-muted-foreground">编辑当前共享制作计划，保存后所有成员和项目拥有者会看到同一版本。个人画布节点、候选结果、剪辑轨道保留在拥有者账号。已有内容删除与镜头跨集移动由拥有者处理。</p>
        {error && <Alert type="error" showIcon title={error} />}{warning && <Alert type="warning" showIcon title={warning} />}
        <Tabs items={[{ key: "plan", label: "制作计划", children: <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">版本 {plan.revision} · {dirty ? "本机草稿未提交" : "已保存"} · {detail.canEdit ? "可编辑" : "只读"}</span><div className="flex gap-2"><Popconfirm disabled={!dirty} title="丢弃本机草稿并加载最新版本？" onConfirm={() => load(true)}><Button disabled={busy} icon={<RefreshCw className="size-4" />} onClick={() => { if (!dirty) void load(true); }}>重新加载</Button></Popconfirm><Button type="primary" loading={busy} disabled={!dirty || !detail.canEdit} icon={<Save className="size-4" />} onClick={() => void save()}>保存到团队</Button></div></div>
            <Input aria-label="共享计划名称" value={plan.title} disabled={disabled} maxLength={180} onChange={(event) => change({ ...plan, title: event.target.value })} />
            <details><summary className="cursor-pointer text-sm">项目梗概与风格</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{field("项目梗概", plan.synopsis, (synopsis) => change({ ...plan, synopsis }))}{field("风格说明", plan.styleGuide, (styleGuide) => change({ ...plan, styleGuide }))}</div></details>
            <div className="flex flex-wrap gap-2"><Select aria-label="分集" className="min-w-48 flex-1" value={episodeId || undefined} options={plan.episodes.map((item) => ({ value: item.id, label: item.title }))} onChange={(id) => { setEpisodeId(id); setShotId(""); }} /><Button disabled={disabled || plan.episodes.length >= 100} icon={<Plus className="size-4" />} onClick={() => { const id = `episode-${crypto.randomUUID()}`; change({ ...plan, episodes: [...plan.episodes, { id, title: `第 ${plan.episodes.length + 1} 集`, script: "", order: plan.episodes.length }] }); setEpisodeId(id); }}>新增分集</Button></div>
            {episode && <><Input aria-label="分集名称" value={episode.title} disabled={disabled} maxLength={180} onChange={(event) => change({ ...plan, episodes: plan.episodes.map((item) => item.id === episode.id ? { ...item, title: event.target.value } : item) })} />{field("分集剧本", episode.script, (script) => change({ ...plan, episodes: plan.episodes.map((item) => item.id === episode.id ? { ...item, script } : item) }), 7)}
                <details><summary className="cursor-pointer text-sm">场次 · {plan.scenes.filter((item) => item.episodeId === episode.id).length}</summary><div className="mt-4 space-y-4">{plan.scenes.filter((item) => item.episodeId === episode.id).map((scene) => <div className="space-y-2 rounded-xl border border-border p-3" key={scene.id}><Input aria-label="场次名称" value={scene.title} disabled={disabled} maxLength={180} onChange={(event) => change({ ...plan, scenes: plan.scenes.map((item) => item.id === scene.id ? { ...item, title: event.target.value } : item) })} /><Input.TextArea aria-label="场次描述" value={scene.description} disabled={disabled} onChange={(event) => change({ ...plan, scenes: plan.scenes.map((item) => item.id === scene.id ? { ...item, description: event.target.value } : item) })} /></div>)}<Button disabled={disabled || plan.scenes.length >= 500} onClick={() => change({ ...plan, scenes: [...plan.scenes, { id: `scene-${crypto.randomUUID()}`, episodeId: episode.id, title: "新场次", description: "", order: plan.scenes.length }] })}>新增场次</Button></div></details>
                <div className="grid gap-5 md:grid-cols-[190px_minmax(0,1fr)]"><aside className="max-h-[500px] space-y-2 overflow-y-auto">{shots.map((item, index) => <button type="button" key={item.id} className={`block w-full rounded-lg px-3 py-3 text-left text-sm ${shot?.id === item.id ? "bg-muted" : "hover:bg-muted/50"}`} onClick={() => setShotId(item.id)}>{index + 1}. {item.title}</button>)}<Button block disabled={disabled || plan.shots.length >= 500} onClick={() => { const id = `shot-${crypto.randomUUID()}`; change({ ...plan, shots: [...plan.shots, { id, episodeId: episode.id, sceneId: "", order: shots.length, title: "新镜头", description: "", dialogue: "", camera: "", seconds: 5, assetIds: [], status: "draft" }] }); setShotId(id); }}>新增镜头</Button></aside>{shot ? <div className="space-y-4"><Input aria-label="镜头名称" value={shot.title} maxLength={180} disabled={disabled} onChange={(event) => updateShot({ title: event.target.value })} />{field("画面描述", shot.description, (description) => updateShot({ description }))}{field("对白", shot.dialogue, (dialogue) => updateShot({ dialogue }))}{field("景别与运镜", shot.camera, (camera) => updateShot({ camera }), 2)}<div className="grid gap-3 sm:grid-cols-3"><label className="space-y-2 text-xs"><span className="block">时长（秒）</span><InputNumber min={1} max={86400} precision={0} disabled={disabled} value={shot.seconds} onChange={(value) => updateShot({ seconds: value || 1 })} /></label><label className="space-y-2 text-xs"><span className="block">状态</span><Select className="w-full" disabled={disabled} value={shot.status} options={[{ value: "draft", label: "草稿" }, { value: "ready", label: "已就绪" }]} onChange={(status) => updateShot({ status })} /></label><label className="space-y-2 text-xs"><span className="block">所属场次</span><Select className="w-full" allowClear disabled={disabled} value={shot.sceneId || undefined} options={plan.scenes.filter((item) => item.episodeId === episode.id).map((item) => ({ value: item.id, label: item.title }))} onChange={(sceneId) => updateShot({ sceneId: sceneId || "" })} /></label></div><Select className="w-full" mode="multiple" aria-label="镜头角色与资产" placeholder="引用角色或资产" disabled={disabled} value={shot.assetIds} options={plan.assets.map((item) => ({ value: item.id, label: item.title }))} onChange={(assetIds) => updateShot({ assetIds })} /></div> : <p className="py-8 text-sm text-muted-foreground">新增镜头开始拆镜。</p>}</div></>}
            <details><summary className="cursor-pointer text-sm">角色与资产设定 · {plan.assets.length}</summary><div className="mt-4 space-y-4">{plan.assets.map((asset) => <div key={asset.id} className="space-y-3 rounded-xl border border-border p-4"><div className="flex gap-2"><Select disabled={disabled} value={asset.kind} options={[{ value: "character", label: "角色" }, { value: "scene", label: "场景" }, { value: "prop", label: "道具" }, { value: "voice", label: "声音" }, { value: "style", label: "风格" }]} onChange={(kind) => change({ ...plan, assets: plan.assets.map((item) => item.id === asset.id ? { ...item, kind } : item) })} /><Input aria-label="资产名称" value={asset.title} disabled={disabled} maxLength={180} onChange={(event) => change({ ...plan, assets: plan.assets.map((item) => item.id === asset.id ? { ...item, title: event.target.value } : item) })} /></div><Input.TextArea aria-label="资产设定" value={asset.description} disabled={disabled} onChange={(event) => change({ ...plan, assets: plan.assets.map((item) => item.id === asset.id ? { ...item, description: event.target.value } : item) })} /></div>)}<Button disabled={disabled || plan.assets.length >= 200} onClick={() => change({ ...plan, assets: [...plan.assets, { id: `asset-${crypto.randomUUID()}`, kind: "character", title: "新角色", description: "", variantOf: "" }] })}>新增资产设定</Button></div></details>
        </div> }, { key: "generation", label: "生成审批与费用", children: <TeamGenerationPanel projectId={projectId} /> }]} />
    </div>;
}
