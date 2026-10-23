"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Modal, theme } from "antd";
import { Check, ChevronDown, Cpu, Search } from "lucide-react";

import { useAutoDLWorkflowNames } from "@/hooks/use-autodl-workflow";
import { isWorkflowProtocol } from "@/lib/model-channel";
import { GatewayModelPrice } from "@/components/gateway-model-price";
import type { PublishedGatewayModel } from "@/lib/model-gateway";
import { cn } from "@/lib/utils";
import type { WorkflowRef } from "@/lib/workflow-channel";
import { filterModelsByCapability, useConfigStore, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    channelId?: string;
    capability?: ModelCapability;
    onChange: (model: string, channelId?: string) => void;
    workflowRef?: WorkflowRef;
    onWorkflowChange?: (ref?: WorkflowRef) => void;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

type PickerBase = { key: string; channelId?: string; channelName: string; protocol?: string; baseUrl?: string; displayName?: string; badge?: string; remark?: string; gateway?: PublishedGatewayModel };
type PickerOption = (PickerBase & { model: string }) | (PickerBase & { model: ""; workflowRef: WorkflowRef; label: string });

export function ModelPicker({ config, value, channelId, capability, onChange, workflowRef, onWorkflowChange, className, fullWidth = false, placeholder = "选择模型" }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [group, setGroup] = useState("");
    const [draftKey, setDraftKey] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const { token: colors } = theme.useToken();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const userReady = useUserStore((state) => state.isReady);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const settingsLoading = useConfigStore((state) => state.isPublicSettingsLoading);
    const cloudAvailable = Boolean(token && user && (user.role === "admin" || publicSettings?.modelChannel.allowUserRemoteChannel === true));
    const workflowEnabled = Boolean(onWorkflowChange && capability && capability !== "text");
    const channelOptions = useMemo<PickerOption[]>(() => {
        if (!cloudAvailable || config.channelMode !== "remote") return [];
        const channels = config.publicChannels.filter((channel) => channel.enabled !== false).map((channel) => ({ id: channel.id, protocol: channel.protocol, name: channel.name || "云端模型", baseUrl: channel.baseUrl, models: channel.models, modelCapabilities: channel.modelCapabilities, gatewayModels: channel.gatewayModels, workflows: channel.workflows || [] }));
        const filtered = channels.filter((channel) => !isWorkflowProtocol(channel.protocol || "")).flatMap((channel) => filterModelsByCapability(channel.models ?? [], capability, channel.protocol || "", channel.modelCapabilities).filter((model) => config.models.includes(model)).map((model) => {
            const gateway = channel.gatewayModels?.find((item) => item.id === model);
            return { key: `${channel.id}::${model}`, channelId: channel.id, channelName: gateway?.group || channel.name, protocol: channel.protocol, baseUrl: channel.baseUrl, model, displayName: gateway?.displayName || gateway?.name, badge: gateway?.badge, remark: gateway?.remark, gateway };
        }));
        if (!workflowEnabled || !token) return filtered;
        return [...filtered, ...channels.flatMap((channel) => isWorkflowProtocol(channel.protocol || "") ? channel.workflows.filter((entry) => entry.enabled && entry.capability === capability && entry.provider === channel.protocol).map((entry) => {
            const ref: WorkflowRef = { scope: "system", channelId: channel.id || "", kind: entry.kind, workflowId: entry.workflowId };
            return { key: `workflow:${JSON.stringify([ref.scope, ref.channelId, ref.kind, ref.workflowId])}`, channelId: channel.id, channelName: channel.name, protocol: channel.protocol, baseUrl: channel.baseUrl, model: "", workflowRef: ref, label: entry.title || entry.workflowId };
        }) : [])];
    }, [capability, cloudAvailable, config, token, workflowEnabled]);
    const modelLabel = useAutoDLWorkflowNames(channelOptions);
    const currentOption = useMemo<PickerOption | undefined>(() => {
        if (workflowRef && workflowEnabled) return channelOptions.find((item) => "workflowRef" in item && item.key === `workflow:${JSON.stringify([workflowRef.scope, workflowRef.channelId, workflowRef.kind, workflowRef.workflowId])}`);
        if (!value) return undefined;
        return channelOptions.find((item) => item.model === value && item.channelId === channelId) || channelOptions.find((item) => item.model === value);
    }, [channelId, channelOptions, value, workflowEnabled, workflowRef]);
    const options = channelOptions;
    const current = currentOption ? ("label" in currentOption ? currentOption.label : currentOption.model) : "";
    const currentValue = current && currentOption ? currentOption.key : "";
    const optionLabel = (option: PickerOption) => "workflowRef" in option ? `工作流 · ${option.label}` : option.displayName || modelLabel(option.model, option);
    const groups = [...new Set(options.map((option) => option.channelName))];
    const activeGroup = groups.includes(group) ? group : "";
    const filteredOptions = options.filter((option) => (!activeGroup || option.channelName === activeGroup) && `${optionLabel(option)} ${option.model} ${option.channelName} ${option.badge || ""} ${option.remark || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
    const draftOption = options.find((option) => option.key === draftKey);
    const capabilityLabel = capability ? { text: "文本", image: "图片", video: "视频", audio: "音频" }[capability] : "";
    const emptyMessage = !userReady ? "正在加载云端模型" : !token || !user ? "登录后使用云端模型" : settingsLoading ? "正在加载云端模型" : !publicSettings ? "云端模型配置不可用，请稍后重试" : !cloudAvailable ? "云端模型暂未开放" : "暂无可用云端模型，请联系管理员";
    const missingSelection = workflowRef && workflowEnabled ? "工作流不可用，请重新选择云端模型" : value ? "模型不可用，请重新选择" : placeholder;

	useEffect(() => {
		if (workflowRef && workflowEnabled) {
			const workflowOptionsReady = publicSettings !== null;
			if (token && userReady && workflowOptionsReady && !currentOption && channelOptions.some((item) => !("workflowRef" in item))) {
				onWorkflowChange?.(undefined);
            }
            return;
        }
        if (value && currentOption?.channelId && !("workflowRef" in currentOption) && channelId !== currentOption.channelId) onChange(value, currentOption.channelId);
	}, [channelId, channelOptions, currentOption, onChange, onWorkflowChange, publicSettings, token, userReady, value, workflowEnabled, workflowRef]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    const applySelection = () => {
        if (!draftOption) return;
        if ("workflowRef" in draftOption) onWorkflowChange?.(draftOption.workflowRef);
        else { onChange(draftOption.model, draftOption.channelId); if (workflowRef) onWorkflowChange?.(undefined); }
        setOpen(false);
    };

    return (
        <>
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={(event) => {
                    event.stopPropagation();
                    window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    setDraftKey(currentValue);
                    setQuery("");
                    setGroup("");
                    setOpen(true);
                }}
                className={cn(
                    "canvas-composer-model-picker flex h-8 w-fit max-w-full items-center gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current || (options.length ? missingSelection : emptyMessage)}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{currentOption?.displayName || modelLabel(current, currentOption) || (options.length ? missingSelection : emptyMessage)}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
            </button>
            <Modal
                title={`选择${capabilityLabel}模型`}
                open={open}
                onCancel={() => setOpen(false)}
                centered
                width={880}
                zIndex={1200}
                destroyOnHidden
                focusable={{ trap: true, focusTriggerAfterClose: true }}
                afterOpenChange={(visible) => { if (visible) searchRef.current?.focus(); }}
                styles={{ body: { maxHeight: "min(65dvh, 620px)", overflowY: "auto" }, footer: { marginTop: 20 } }}
                modalRender={(modal) => <div data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>{modal}</div>}
                footer={<div className="flex flex-wrap items-center justify-between gap-3 text-left">
                    <span className="min-w-0 text-xs" style={{ color: colors.colorTextSecondary }}>{draftOption ? `${optionLabel(draftOption)} · ${draftOption.channelName}` : "选择适合这次创作的模型"}</span>
                    <div className="ml-auto flex shrink-0 gap-2"><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" disabled={!draftOption} onClick={applySelection}>使用此模型</Button></div>
                </div>}
            >
                <p className="mb-5 mt-1 text-xs leading-5" style={{ color: colors.colorTextSecondary }}>按分组查看模型、参考素材上限与价格。</p>
                <label className="mb-4 flex items-center gap-2 rounded-xl border px-3 py-2.5 focus-within:outline-2 focus-within:outline-ring" style={{ borderColor: colors.colorBorder, background: colors.colorFillQuaternary }}>
                    <Search className="size-4 shrink-0" style={{ color: colors.colorTextSecondary }} />
                    <input ref={searchRef} type="search" aria-label="搜索模型" placeholder="搜索模型、分组或特点" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                </label>
                {groups.length > 0 ? <div className="mb-5 flex flex-wrap gap-2" aria-label="模型分组">
                    {["", ...groups].map((name) => <button type="button" key={name} aria-pressed={activeGroup === name} onClick={() => setGroup(name)} className="rounded-lg px-3 py-2 text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" style={{ background: activeGroup === name ? colors.colorFillSecondary : undefined, color: activeGroup === name ? colors.colorText : colors.colorTextSecondary }}>{name || "全部"}<span className="ml-2 opacity-60">{name ? options.filter((option) => option.channelName === name).length : options.length}</span></button>)}
                </div> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                    {filteredOptions.map((option) => {
                        const caps = option.gateway?.capabilities;
                        const selected = option.key === draftKey;
                        const portraitOnly = caps?.resolutions.length === 1 && caps.resolutions[0] === "720p" && caps.ratios.length === 1 && caps.ratios[0] === "9:16";
                        return <button type="button" key={option.key} aria-pressed={selected} onClick={() => setDraftKey(option.key)} className="flex min-w-0 flex-col rounded-2xl border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" style={{ borderColor: selected ? colors.colorText : colors.colorBorderSecondary, background: selected ? colors.colorFillQuaternary : undefined }}>
                            <span className="mb-3 flex w-full items-center gap-2"><ModelIcon model={option.model} /><span className="min-w-0 flex-1 truncate text-base font-semibold" title={optionLabel(option)}>{optionLabel(option)}</span>{selected ? <Check className="size-4 shrink-0" /> : null}</span>
                            <span className="mb-4 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: colors.colorTextSecondary }}><span>{option.channelName}</span>{option.badge ? <span className="rounded border px-1.5 py-0.5" style={{ borderColor: colors.colorBorder }}>{option.badge}</span> : null}{option.key === currentValue ? <span>当前使用</span> : null}</span>
                            {caps && !option.gateway?.variants?.length ? <span className="mb-4 block space-y-2 text-xs leading-5">
                                <span className="block font-medium">{portraitOnly ? "720 × 1280 · 固定竖屏 9:16" : `${caps.resolutions.join(" / ")} · ${caps.ratios.map((ratio) => ratio === "adaptive" ? "自适应" : ratio).join(" / ")}`}</span>
                                <span className="block" style={{ color: colors.colorTextSecondary }}>{caps.minDuration}–{caps.maxDuration} 秒 · 参考上限：图片 {caps.maxImages} / 视频 {caps.maxVideos} / 音频 {caps.maxAudios}</span>
                                {caps.maxTotal > 0 ? <span className="block" style={{ color: colors.colorTextSecondary }}>参考素材合计最多 {caps.maxTotal} 个</span> : null}
                            </span> : null}
                            {option.remark ? <span className="mb-4 block text-xs leading-5" style={{ color: colors.colorTextSecondary }}>{option.remark}</span> : null}
                            {option.gateway ? <span className="mt-auto block w-full border-t pt-3" style={{ borderColor: colors.colorBorderSecondary }}><GatewayModelPrice model={option.gateway} /></span> : null}
                        </button>;
                    })}
                </div>
                {!filteredOptions.length ? <div className="py-14 text-center text-sm" role="status" style={{ color: colors.colorTextSecondary }}><Cpu className="mx-auto mb-3 size-7 opacity-50" />{options.length ? "没有找到匹配的模型，试试其他名称或分组" : emptyMessage}</div> : null}
            </Modal>
        </>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(model);
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
