"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Select } from "antd";
import { Sparkles } from "lucide-react";
import { ModelPicker } from "@/components/model-picker";
import { requestCreditCost } from "@/constant/credits";
import { readImageMeta } from "@/lib/image-utils";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { redrawPrompt, redrawReferenceError, redrawSizeOptions } from "../utils/canvas-image-redraw";

export type CanvasImageRedrawPayload = { model: string; channelId: string; size: string; quality: string; prompt: string; credits: number };

export function CanvasNodeRedrawDialog({ dataUrl, config, onClose, onConfirm }: {
    dataUrl: string; config: AiConfig; onClose: () => void; onConfirm: (payload: CanvasImageRedrawPayload) => Promise<void>;
}) {
    const [model, setModel] = useState(config.model);
    const [channelId, setChannelId] = useState(config.imageChannelId || config.activeChannelId);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [target, setTarget] = useState("auto");
    const [instructions, setInstructions] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const submittingRef = useRef(false);
    const costs = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const ready = useConfigStore((state) => state.isAiConfigReady);
    const nextConfig = { ...config, model, imageModel: model, activeChannelId: channelId, imageChannelId: channelId, count: "1" };
    const options = redrawSizeOptions(model, image?.width || 0, image?.height || 0);
    const size = options.find((item) => item.value === target) || options[0];
    const credits = requestCreditCost({ channelMode: config.channelMode, model, modelCosts: costs, count: 1 });
    const referenceError = redrawReferenceError(model);
    const available = ready(nextConfig, model) && Boolean(config.publicChannels.some((channel) => channel.id === channelId && channel.enabled !== false && channel.models?.includes(model)));

    useEffect(() => {
        let active = true;
        setImage(null);
        setError("");
        setConfirmed(false);
        void readImageMeta(dataUrl).then((value) => { if (active) setImage(value); }).catch(() => { if (active) setError("原图读取失败，请先检查素材"); });
        return () => { active = false; };
    }, [dataUrl]);
    useEffect(() => { setConfirmed(false); }, [model, channelId, target, instructions, credits]);
    const submit = async () => {
        if (submittingRef.current || !confirmed || !available || referenceError || credits === null || !image) return;
        submittingRef.current = true;
        setSubmitting(true);
        setError("");
        try { await onConfirm({ model, channelId, size: size.size, quality: size.quality, prompt: redrawPrompt(instructions), credits }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试"); setConfirmed(false); }
        finally { submittingRef.current = false; setSubmitting(false); }
    };

    return <Modal open title="AI 高清重绘" width={860} centered onCancel={() => !submitting && onClose()} footer={null} mask={{ closable: false }}>
        <div className="grid gap-6 py-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,1fr)]">
            <div className="flex min-h-48 flex-col rounded-xl border border-border bg-muted/30 p-4"><div className="grid min-h-40 flex-1 place-items-center"><img src={dataUrl} alt="高清重绘参考原图" className="max-h-80 max-w-full object-contain" /></div><p className="mt-4 text-xs text-muted-foreground">原图 · {image ? `${image.width} × ${image.height} px` : "读取中"}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">结果生成在独立节点，保留原图。重绘可能改变细节，请核对后再采用。</p></div>
            <div className="space-y-4"><p className="text-sm leading-7 text-muted-foreground">使用平台图片模型参考原图重新生成，改善清晰度与质感。原始尺寸不代表模型的输出尺寸。</p>
                <div className="space-y-2"><span className="text-xs font-medium">图片模型</span><ModelPicker config={nextConfig} value={model} channelId={channelId} capability="image" fullWidth onChange={(value, channel) => { setModel(value); setChannelId(channel || ""); setTarget("auto"); }} /></div>
                <label className="block space-y-2"><span className="text-xs font-medium">输出规格</span><Select aria-label="高清重绘输出规格" className="w-full" value={size.value} options={options} onChange={setTarget} /></label>
                <p className="text-xs leading-5 text-muted-foreground">仅显示当前适配器已有的规格；其他模型按默认尺寸输出，不承诺无损放大或固定倍数。</p>
                <label className="block space-y-2"><span className="text-xs font-medium">补充要求（可选）</span><Input.TextArea rows={3} maxLength={2000} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="例如：保留脸部特征，增强衣料纹理" /></label>
                {!available ? <Alert type="info" title="暂无可用的已开放模型，请管理员配置后再使用" /> : referenceError ? <Alert type="warning" title={referenceError} /> : credits === null ? <Alert type="warning" title="当前模型未配置可用价格，暂不能提交" /> : <div className="rounded-xl bg-muted/40 p-3 text-sm">本次生成 1 张 · 预计 {credits.toLocaleString()} 算力点<p className="mt-1 text-xs text-muted-foreground">按普通图片任务服务端规则扣费，以实际流水为准。</p></div>}
                {error && <Alert type="error" showIcon title={error} />}
                <Checkbox checked={confirmed} disabled={!available || Boolean(referenceError) || credits === null || submitting} onChange={(event) => setConfirmed(event.target.checked)}>我已确认模型、规格与本次预计费用</Checkbox>
                <div className="flex justify-end gap-2"><Button disabled={submitting} onClick={onClose}>取消</Button><Button type="primary" loading={submitting} disabled={!confirmed || !available || Boolean(referenceError) || credits === null || !image} icon={<Sparkles className="size-4" />} onClick={() => void submit()}>确认并重绘</Button></div>
            </div>
        </div>
    </Modal>;
}
