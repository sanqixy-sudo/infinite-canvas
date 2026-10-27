"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Alert, Button, Card, Empty, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography } from "antd";
import { RefreshCw, Save } from "lucide-react";
import { fetchGatewayConfig, saveGatewayConfig, syncGatewayModels, type GatewayConfig, type GatewayPolicy } from "@/services/api/model-gateway";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore } from "@/stores/use-config-store";
import type { GatewaySaleTier, GatewayPriceTier } from "@/lib/model-gateway";

const emptyPolicy = (model: string): GatewayPolicy => ({ model, enabled: false, mode: "multiplier", multiplier: 1, creditsPerYuan: 1, withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0, tiers: [], displayName: "", badge: "", remark: "" });

async function validateServiceAddress(value: string, httpsOnly = false) {
    const raw = value?.trim();
    if (!raw) return;
    try {
        const url = new URL(raw);
        if (/^https?:\/\//i.test(raw) && (httpsOnly ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol)) && url.hostname && !url.username && !url.password && !url.search && !url.hash && !raw.includes("\\") && !raw.split("://")[1].split(/[/?#]/)[0].includes("@")) return;
    } catch { /* Invalid URLs are reported through the form rule below. */ }
    throw new Error(httpsOnly ? "请输入不含账号、查询参数或片段的完整 HTTPS 地址" : "请输入不含账号、查询参数或片段的完整 HTTP(S) 地址，支持 Docker 服务名");
}

export default function ModelGatewayPage() {
    const token = useUserStore((state) => state.token);
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<Pick<GatewayConfig, "enabled" | "baseUrl" | "apiKey" | "mediaBaseUrl">>();
    const [policies, setPolicies] = useState<GatewayPolicy[]>([]);
    const [busy, setBusy] = useState<"save" | "sync" | null>(null);
    const [dirty, setDirty] = useState(false);
    const query = useQuery({ queryKey: ["model-gateway", token], queryFn: () => fetchGatewayConfig(token), enabled: Boolean(token), refetchOnWindowFocus: false });
    useEffect(() => { form.resetFields(); setPolicies([]); setDirty(false); setBusy(null); }, [token, form]);
    useEffect(() => {
        if (!query.data) return;
        form.setFieldsValue({ enabled: query.data.enabled, baseUrl: query.data.baseUrl, apiKey: "", mediaBaseUrl: query.data.mediaBaseUrl });
        setPolicies(query.data.models || []);
        setDirty(false);
    }, [query.data, form]);
    const patch = (model: string, changes: Partial<GatewayPolicy>) => {
        setPolicies((current) => {
            const existing = current.find((item) => item.model === model);
            return existing ? current.map((item) => item.model === model ? { ...item, ...changes } : item) : [...current, { ...emptyPolicy(model), ...changes }];
        });
        setDirty(true);
    };
    const save = async (sync = false) => {
        const requestToken = token;
        try {
            const values = await form.validateFields();
            if (!query.data || useUserStore.getState().token !== requestToken) return;
            setBusy(sync ? "sync" : "save");
            const saved = await saveGatewayConfig(token, { ...query.data, ...values, apiKey: values.apiKey || "", models: policies });
            if (useUserStore.getState().token !== requestToken) return;
            queryClient.setQueryData(["model-gateway", token], saved);
            if (sync) {
                const synced = await syncGatewayModels(token);
                if (useUserStore.getState().token !== requestToken) return;
                queryClient.setQueryData(["model-gateway", token], synced);
            }
            await useConfigStore.getState().loadPublicSettings();
            message.success(sync ? "模型已同步，新模型默认未发布，请设置售价后发布" : "中间件与模型发布设置已保存");
        } catch (error) {
            if (useUserStore.getState().token === requestToken && !(error && typeof error === "object" && "errorFields" in error)) message.error(error instanceof Error ? error.message : "操作失败");
        } finally { if (useUserStore.getState().token === requestToken) setBusy(null); }
    };
    return <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><Typography.Title level={3}>模型中间件</Typography.Title><Typography.Paragraph type="secondary">同步模型能力与原价，在这里设置用户售价和展示信息。新任务使用发布后的规则，已提交任务保留原价格。</Typography.Paragraph></div><Button type="primary" icon={<Save size={16} />} loading={busy === "save"} disabled={!!busy || !query.data} onClick={() => void save()}>保存并发布{dirty ? "修改" : ""}</Button></div>
        {query.error ? <Alert type="error" showIcon title={query.error instanceof Error ? query.error.message : "配置读取失败"} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}
        <Card title="连接设置" loading={query.isLoading}>
            <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
                <div className="grid gap-x-6 md:grid-cols-2">
                    <Form.Item name="baseUrl" label="中间件地址" rules={[{ required: true, whitespace: true, message: "请输入中间件地址" }, { validator: (_, value: string) => validateServiceAddress(value) }]} extra="由画布服务器访问，支持 Docker 内部服务名。"><Input placeholder="http://xiaomeng-model-gateway:8088" autoComplete="off" /></Form.Item>
                    <Form.Item name="apiKey" label="中间件接入密钥" extra={query.data?.hasApiKey ? "已保存密钥；留空保留现有密钥。密钥仅保存在服务器。" : "填写中间件的服务密钥，不是供应商密钥。"}><Input.Password placeholder={query.data?.hasApiKey ? "已配置，留空保留" : "请输入服务密钥"} autoComplete="new-password" /></Form.Item>
                    <Form.Item name="mediaBaseUrl" label="任务素材访问地址" rules={[{ required: true, whitespace: true, message: "请输入供应商可访问的画布站点地址" }, { validator: (_, value: string) => validateServiceAddress(value, true) }]} extra="仅支持供应商可公开访问的 HTTPS 域名，用于临时素材签名链接。"><Input placeholder="https://canvas.example.com" /></Form.Item>
                    <Form.Item name="enabled" label="启用中间件" valuePropName="checked" extra="关闭后不接受新任务，已提交的任务继续查询与结算。"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
                </div>
            </Form>
            <Button icon={<RefreshCw size={15} />} loading={busy === "sync"} disabled={!!busy || !query.data} onClick={() => void save(true)}>保存连接并同步模型</Button>
        </Card>
        {!query.isLoading && !query.data?.catalog?.length ? <Card><Empty description="尚未同步模型。先填写连接信息，再同步模型目录。" /></Card> : null}
        {(query.data?.catalog || []).map((model) => {
            const policy = policies.find((item) => item.model === model.id) || emptyPolicy(model.id);
            const specs = model.variants?.length ? model.variants : [{ id: "", name: "默认规格", capabilities: model.capabilities, pricing: model.pricing }];
            const priceKeys = ["withoutVideoCreditsPerMillion", "withVideoCreditsPerMillion", "withoutVideoInputCreditsPerMillion", "withoutVideoOutputCreditsPerMillion", "withVideoInputCreditsPerMillion", "withVideoOutputCreditsPerMillion", "withoutVideoCredits", "withVideoCredits"] as const;
            const saleTiers: GatewaySaleTier[] = specs.flatMap((spec) => spec.pricing.tiers.map((tier) => {
                const fixed = policy.tiers?.find((item) => (item.variantId || "") === spec.id && item.resolution === tier.resolution);
                const result: GatewaySaleTier = { variantId: spec.id || undefined, resolution: tier.resolution, withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0 };
                for (const key of priceKeys) {
                    const source = key.replace("CreditsPerMillion", "Cents").replace("Credits", "Cents") as Exclude<keyof GatewayPriceTier, "resolution">;
                    result[key] = policy.mode === "fixed" ? fixed?.[key] ?? 0 : (tier[source] ?? 0) / 100 * policy.multiplier * policy.creditsPerYuan;
                }
                return result;
            }));
            return <Card key={model.id} title={<div className="min-w-0 py-2"><div>{model.name}</div><Typography.Text type="secondary" className="!text-xs !font-normal break-all">{model.id} · {model.revision}</Typography.Text></div>} extra={<Space><Tag>{policy.enabled ? "已选发布" : "未发布"}</Tag><Switch aria-label={`发布 ${model.name}`} checked={policy.enabled} onChange={(enabled) => patch(model.id, { enabled })} /></Space>}>
                <div className="mb-5 flex flex-wrap gap-2"><Tag>{model.group}</Tag><Tag>{specs.length} 个可用规格</Tag><Tag>{model.capabilities.resolutions.join(" / ")}</Tag></div>
                <Typography.Paragraph type="secondary">每个规格独立绑定渠道与上游型号。报价由所选规格、参考素材和时长确定；倍率只影响用户售价。同步规则变更后需重新核对并发布。</Typography.Paragraph>
                <Form layout="vertical">
                    <div className="grid gap-x-5 md:grid-cols-3">
                        <Form.Item label="售价方式"><Select value={policy.mode} options={[{ value: "multiplier", label: "按原价倍率" }, { value: "fixed", label: "固定算力单价" }]} onChange={(mode) => patch(model.id, { mode, ...(mode === "fixed" ? { tiers: saleTiers } : {}) })} /></Form.Item>
                        {policy.mode === "multiplier" ? <><Form.Item label="售价倍率" extra="0.8 为八折，1.2 为加价 20%。"><InputNumber className="!w-full" min={0.0001} precision={4} value={policy.multiplier} onChange={(value) => patch(model.id, { multiplier: value ?? 1 })} /></Form.Item><Form.Item label="每元对应算力"><InputNumber className="!w-full" min={0.01} precision={4} value={policy.creditsPerYuan} onChange={(value) => patch(model.id, { creditsPerYuan: value ?? 1 })} /></Form.Item></> : null}
                    </div>
                    <div className="mb-6 space-y-5">{specs.map((spec) => {
                        const unit = spec.pricing.unit === "token" ? "百万 Token" : spec.pricing.unit === "second" ? "秒" : "次";
                        const split = spec.pricing.unit === "token" && spec.pricing.tokenMode === "input_output_tokens";
                        return <div key={spec.id} className="space-y-3 rounded-lg border border-border p-4">
                            <Typography.Text strong>{spec.name}</Typography.Text><Typography.Paragraph type="secondary">{spec.capabilities.resolutions.join(" / ")} · {spec.capabilities.ratios.join(" / ")} · {spec.capabilities.minDuration}～{spec.capabilities.maxDuration} 秒 · 图 {spec.capabilities.maxImages} / 视频 {spec.capabilities.maxVideos} / 音频 {spec.capabilities.maxAudios}</Typography.Paragraph>
                            {spec.pricing.tiers.map((tier) => {
                                const saleTier = saleTiers.find((item) => (item.variantId || "") === spec.id && item.resolution === tier.resolution)!;
                                return <div key={tier.resolution} className="grid gap-4 md:grid-cols-[70px_1fr_1fr]"><Typography.Text>{tier.resolution}</Typography.Text>{(["withoutVideo", "withVideo"] as const).map((kind) => <div key={kind} className="space-y-2"><Typography.Text strong>{kind === "withoutVideo" ? "无视频参考" : "带视频参考"}</Typography.Text>{(split ? ["Input", "Output"] as const : [""] as const).map((part) => {
                                    const key = (spec.pricing.unit === "token" ? `${kind}${part}CreditsPerMillion` : `${kind}Credits`) as typeof priceKeys[number];
                                    const cents = tier[`${kind}${part}Cents`];
                                    const label = part === "Input" ? "输入" : part === "Output" ? "输出" : "单价";
                                    return <div key={part}><Typography.Paragraph type="secondary" className="!mb-1">{label} · 原价 ¥{(cents ?? 0) / 100} / {unit}</Typography.Paragraph>{policy.mode === "fixed" ? <InputNumber aria-label={`${spec.name} ${tier.resolution} ${kind} ${label}`} className="!w-full" min={0.0001} precision={4} addonAfter={`算力 / ${unit}`} value={saleTier[key]} onChange={(value) => patch(model.id, { tiers: saleTiers.map((item) => item === saleTier ? { ...item, [key]: value ?? 0 } : item) })} /> : <Typography.Text>用户单价 {Number((saleTier[key] ?? 0).toFixed(4))} 算力 / {unit}</Typography.Text>}</div>;
                                })}</div>)}</div>;
                            })}
                            <Typography.Text type="secondary">{spec.pricing.unit === "token" ? split ? `预扣输入 ${spec.pricing.reserveInputTokens.toLocaleString()}、输出 ${spec.pricing.reserveOutputTokens.toLocaleString()} Token；完成后按实际分项结算。` : `预扣 ${spec.pricing.reserveTokens.toLocaleString()} Token；完成后按实际总量结算。` : spec.pricing.unit === "call" ? "成功任务计 1 次。" : spec.pricing.quantitySource === "response_duration" ? "按请求秒数预扣，按实际返回时长结算。" : "按请求时长计费。"}</Typography.Text>
                        </div>;
                    })}</div>
                    <div className="grid gap-x-5 md:grid-cols-2"><Form.Item label="展示名称"><Input maxLength={100} value={policy.displayName} placeholder={model.name} onChange={(event) => patch(model.id, { displayName: event.target.value })} /></Form.Item><Form.Item label="宣传标签" extra="仅展示文案，不参与实际计费。"><Input maxLength={24} value={policy.badge} placeholder="例如：新品、官方5折" onChange={(event) => patch(model.id, { badge: event.target.value })} /></Form.Item></div>
                    <Form.Item label="模型备注"><Input.TextArea value={policy.remark} maxLength={300} showCount autoSize={{ minRows: 2, maxRows: 4 }} placeholder="用途、效果特点或排队提示" onChange={(event) => patch(model.id, { remark: event.target.value })} /></Form.Item>
                </Form>
                <Typography.Text type="secondary">确认规则后发布；计费缺少所需实际用量时保留结果、等待结算，不把未知用量计作 0。</Typography.Text>
            </Card>;
        })}
    </div>;
}
