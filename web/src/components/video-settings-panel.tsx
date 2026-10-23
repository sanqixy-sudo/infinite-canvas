"use client";

import { type CSSProperties, type ReactNode } from "react";
import { Input, Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { useAutoDLWorkflow } from "@/hooks/use-autodl-workflow";
import { isAutoDLConfig, normalizeAutoDLDuration } from "@/lib/autodl";
import { gatewayInputError, gatewayModel, gatewayParameters, gatewayReferenceMode, gatewayVariants, type GatewayInput } from "@/lib/model-gateway";
import { boolConfig, isSeedanceFastOrMiniModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { COGVIDEOX3_DURATIONS, isCogVideoX3Model, modelKey, normalizeCogVideoX3Duration, supportsVideoAudioGeneration } from "@/lib/video-model-capabilities";
import { grokVideoModeOptions, isAPIMartKlingV26Config, isAPIMartKlingV3Config, isKIEGrokVideoModel, isKIEKlingV3Config, klingV26DurationOptions, klingV26ModeOptions, klingV26RatioLabels, klingV26RatioOptions, klingV3DurationOptions, klingV3ModeOptions, normalizeKlingV26Duration, normalizeKlingV26Ratio, normalizeKlingV3Duration } from "@/services/api/protocols/kling-models";
import { type AiConfig } from "@/stores/use-config-store";

export { isAPIMartKlingV26Config, isAPIMartKlingV3Config, isAPIMartKlingMotionControlConfig, isKIEKlingV3Config, kieKlingOmniVariant, isKIEKlingMotionControlConfig, isKIEGrokVideoModel } from "@/services/api/protocols/kling-models";

export const videoResolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
    { value: "1080", label: "1080p" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
];
const resolutionButtonOptions = videoResolutionOptions.slice(0, 2);

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];

type VideoSettingsPanelProps = {
    config: AiConfig;
    modelName?: string;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoMode" | "videoNegativePrompt" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    hideNegativePrompt?: boolean;
    visualOnly?: boolean;
    referenceInputs?: Array<Pick<GatewayInput, "kind" | "role">>;
};

export function VideoSettingsPanel({ config, modelName, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", hideNegativePrompt = false, visualOnly = false, referenceInputs }: VideoSettingsPanelProps) {
    const model = modelName || config.model || config.videoModel;
    const autodl = isAutoDLConfig(config, model);
    const { data: workflow } = useAutoDLWorkflow(config, model);
    const gateway = gatewayModel(config, model);
    if (gateway) {
        const parameters = gatewayParameters(config);
        const mode = referenceInputs ? gatewayReferenceMode(referenceInputs) : undefined;
        const scoped = gatewayVariants(gateway, {}, mode);
        const candidates = gatewayVariants(gateway, { resolution: parameters.resolution, ratio: parameters.ratio, generateAudio: parameters.generateAudio }, mode);
        const matching = gatewayVariants(gateway, parameters, mode);
        const caps = matching.length === 1 ? matching[0].capabilities : gateway.capabilities;
        const resolutions = gateway.variants?.length ? [...new Set(scoped.flatMap((v) => v.capabilities.resolutions))] : caps.resolutions;
        const ratios = gateway.variants?.length ? [...new Set(gatewayVariants(gateway, { resolution: parameters.resolution }, mode).flatMap((v) => v.capabilities.ratios))] : caps.ratios;
        const audioSpecs = gatewayVariants(gateway, { resolution: parameters.resolution, ratio: parameters.ratio, duration: parameters.duration }, mode);
        const fixedAudio = audioSpecs.length && audioSpecs.every((v) => v.generateAudio !== undefined && v.generateAudio === audioSpecs[0].generateAudio) ? audioSpecs[0].generateAudio : undefined;
        const durationCaps = candidates.length ? { minDuration: Math.min(...candidates.map((v) => v.capabilities.minDuration)), maxDuration: Math.max(...candidates.map((v) => v.capabilities.maxDuration)) } : caps;
        const changeSpec = (resolution: string, ratio?: string) => {
            const possible = gatewayVariants(gateway, { resolution, ...(ratio ? { ratio } : {}) }, mode);
            const chosen = possible.find((v) => v.capabilities.ratios.includes(ratio || parameters.ratio) && (v.generateAudio === undefined || v.generateAudio === parameters.generateAudio)) || possible[0];
            onConfigChange("vquality", resolution);
            if (chosen) {
                onConfigChange("size", chosen.capabilities.ratios.includes(ratio || parameters.ratio) ? ratio || parameters.ratio : chosen.capabilities.ratios[0]);
                onConfigChange("videoSeconds", String(Math.max(chosen.capabilities.minDuration, Math.min(chosen.capabilities.maxDuration, parameters.duration || chosen.capabilities.minDuration))));
                if (chosen.generateAudio !== undefined) onConfigChange("videoGenerateAudio", String(chosen.generateAudio));
            } else if (ratio) onConfigChange("size", ratio);
        };
        const fixedPortrait = gateway.capabilities.resolutions.length === 1 && gateway.capabilities.resolutions[0] === "720p" && gateway.capabilities.ratios.length === 1 && gateway.capabilities.ratios[0] === "9:16";
        const invalid = referenceInputs ? gatewayInputError(gateway, referenceInputs, parameters) : gateway.variants?.length ? matching.length ? "" : "当前参数没有可用规格，请重新选择" : gatewayInputError(gateway, [], parameters);
        return <ImageSettingsTheme theme={theme}><div className={className}>
            {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
            {gateway.remark ? <div className="text-xs leading-5" style={{ color: theme.node.muted }}>{gateway.remark}</div> : null}
            {fixedPortrait ? <SettingGroup title="画面规格" color={theme.node.muted}><div className="text-sm font-medium">720 × 1280 · 9:16 竖屏</div><div className="mt-1 text-xs" style={{ color: theme.node.muted }}>当前渠道固定规格</div></SettingGroup> : <><SettingGroup title="分辨率" color={theme.node.muted}><div className="grid grid-cols-3 gap-2">{resolutions.map((value) => <OptionPill key={value} selected={parameters.resolution === value} theme={theme} onClick={() => changeSpec(value)}>{value}</OptionPill>)}</div></SettingGroup>
            <SettingGroup title="画面比例" color={theme.node.muted}><div className="grid grid-cols-3 gap-2">{ratios.map((value) => <OptionPill key={value} selected={parameters.ratio === value} theme={theme} onClick={() => changeSpec(parameters.resolution, value)}>{value === "adaptive" ? "自适应" : value}</OptionPill>)}</div></SettingGroup></>}
            {!visualOnly ? <><SettingGroup title={`时长 · ${durationCaps.minDuration}～${durationCaps.maxDuration} 秒`} color={theme.node.muted}><NumberInput value={config.videoSeconds} min={durationCaps.minDuration} max={durationCaps.maxDuration} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} /></SettingGroup>{fixedAudio === undefined ? <AudioGenerationSetting checked={parameters.generateAudio} theme={theme} onChange={(value) => onConfigChange("videoGenerateAudio", String(value))} /> : <SettingGroup title="生成音频" color={theme.node.muted}><button type="button" onClick={() => onConfigChange("videoGenerateAudio", String(fixedAudio))} className="text-sm">此规格固定{fixedAudio ? "带音频" : "不带音频"}{parameters.generateAudio !== fixedAudio ? " · 点击应用" : ""}</button></SettingGroup>}{caps.watermark === false ? parameters.watermark ? <button type="button" className="text-xs" onClick={() => onConfigChange("videoWatermark", "false")}>此规格不支持水印 · 点击关闭</button> : null : <SwitchRow label="添加水印" checked={parameters.watermark} theme={theme} onChange={(value) => onConfigChange("videoWatermark", String(value))} />}</> : null}
            {gateway.variants?.length ? <div className="text-xs leading-5" style={{ color: theme.node.muted }}>{matching.length === 1 ? `当前规格：${matching[0].name}` : "连接素材并选择参数后确定具体规格"}{candidates.length > 1 ? ` · 可用时长 ${candidates.map((v) => `${v.capabilities.minDuration}–${v.capabilities.maxDuration}`).join(" / ")} 秒` : ""}</div> : null}
            <div className="text-xs leading-5" style={{ color: theme.node.muted }}>{gateway.variants?.length && matching.length !== 1 ? "按具体规格限制；目录最大值：" : "最多 "} {caps.maxImages} 张图片、{caps.maxVideos} 段视频、{caps.maxAudios} 段音频{caps.maxTotal > 0 ? `，共 ${caps.maxTotal} 个素材` : ""}。首尾帧与普通参考素材分别使用。</div>
            {invalid ? <div role="alert" className="rounded-lg border p-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>{invalid}</div> : null}
        </div></ImageSettingsTheme>;
    }
    if (isAPIMartKlingV26Config(config, modelName || config.model || config.videoModel) || isAPIMartKlingV3Config(config, modelName || config.model || config.videoModel) || isKIEKlingV3Config(config, modelName || config.model || config.videoModel)) {
        return <KlingV26VideoSettingsPanel config={config} modelName={modelName} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} hideNegativePrompt={hideNegativePrompt} visualOnly={visualOnly} />;
    }
    if (!autodl && (isSeedanceVideoConfig(config) || model.toLowerCase().includes("sd2"))) {
        return <SeedanceVideoSettingsPanel config={config} modelName={modelName} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} visualOnly={visualOnly} />;
    }

    const grokMode = config.videoMode === "fun" || config.videoMode === "spicy" ? config.videoMode : "normal";
    const cogVideoX3 = isCogVideoX3Model(model);
    const seconds = autodl ? config.videoSeconds ?? "" : cogVideoX3 ? normalizeCogVideoX3Duration(config.videoSeconds) : config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const audioGenerationEnabled = supportsVideoAudioGeneration(model);
    const generateAudio = boolConfig(config.videoGenerateAudio, false);
    const updateResolution = (value: string) => {
        const nextResolution = normalizeVideoResolutionValue(value);
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", videoSizeForResolution(nextResolution, config.size));
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        const pixels = width * height;
        const nearestResolution = ["480", "720", "1080", "2k", "4k"].reduce((nearest, candidate) => {
            const [candidateWidth, candidateHeight] = seedancePixelLabel(candidate, "16:9").split("x").map(Number);
            const [nearestWidth, nearestHeight] = seedancePixelLabel(nearest, "16:9").split("x").map(Number);
            return Math.abs(candidateWidth * candidateHeight - pixels) < Math.abs(nearestWidth * nearestHeight - pixels)
                ? candidate
                : nearest;
        });
        onConfigChange("size", `${width}x${height}`);
        onConfigChange("vquality", nearestResolution);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                {!visualOnly && isKIEGrokVideoModel(config, model) ? (
                    <SettingGroup title="模式选择" color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {grokVideoModeOptions.map((item) => (
                                <OptionPill key={item.value} selected={grokMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                    {item.title}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionButtonOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => updateResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={updateResolution} />
                    </div>
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{
                                    borderColor: normalizeSeedanceRatio(config.size) === item.value
                                        ? theme.node.text
                                        : theme.node.stroke,
                                    color: theme.node.text,
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() =>
                                    onConfigChange(
                                        "size",
                                        item.value === "adaptive"
                                            ? "auto"
                                            : seedancePixelLabel(resolution, item.value),
                                    )
                                }
                            >
                                <SizePreview
                                    width={ratioPreview(item.value).width}
                                    height={ratioPreview(item.value).height}
                                    color={theme.node.text}
                                />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">
                                    {item.value === "adaptive"
                                        ? "adaptive"
                                        : seedancePixelLabel(resolution, item.value)}
                                </span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                {!visualOnly ? (
                    <>
                        <SettingGroup title="秒数" color={theme.node.muted}>
                            <div className="grid grid-cols-3 gap-2.5">
                                {(cogVideoX3 ? COGVIDEOX3_DURATIONS : secondOptions).map((value) => (
                                    <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                        {value}s
                                    </OptionPill>
                                ))}
                                {cogVideoX3 ? null : <NumberInput value={seconds} min={1} max={30} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} onBlur={autodl ? (value) => onConfigChange("videoSeconds", normalizeAutoDLDuration(value, workflow)) : undefined} />}
                            </div>
                        </SettingGroup>
                        {audioGenerationEnabled ? <AudioGenerationSetting checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function KlingV26VideoSettingsPanel({ config, modelName, onConfigChange, theme, showTitle, className, hideNegativePrompt, visualOnly }: VideoSettingsPanelProps) {
    const isV3 = isAPIMartKlingV3Config(config, modelName || config.model || config.videoModel) || isKIEKlingV3Config(config, modelName || config.model || config.videoModel);
    const mode = isV3 && config.videoMode === "4k" ? "4k" : config.videoMode === "pro" ? "pro" : "std";
    const ratio = normalizeKlingV26Ratio(config.size);
    const duration = isV3 ? normalizeKlingV3Duration(config.videoSeconds) : normalizeKlingV26Duration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                {hideNegativePrompt || visualOnly ? null : (
                    <SettingGroup title="负面提示词" color={theme.node.muted}>
                        <Input.TextArea
                            value={config.videoNegativePrompt || ""}
                            placeholder="描述不希望出现在视频中的内容"
                            autoSize={{ minRows: 3, maxRows: 6 }}
                            className="rounded-xl placeholder:!text-[var(--canvas-placeholder)] placeholder:!opacity-55"
                            style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text, "--canvas-placeholder": theme.node.placeholder } as CSSProperties}
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => onConfigChange("videoNegativePrompt", event.target.value)}
                        />
                    </SettingGroup>
                )}
                <SettingGroup title="模式选择" color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${isV3 ? "grid-cols-3" : "grid-cols-2"}`}>
                        {(isV3 ? klingV3ModeOptions : klingV26ModeOptions).map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-full border bg-transparent px-2 text-sm leading-4 transition hover:opacity-80"
                                style={{ borderColor: mode === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("videoMode", item.value)}
                            >
                                <span>{item.title}</span>
                                <span>{item.desc}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {klingV26RatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{klingV26RatioLabels[item.value]}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                {!visualOnly ? (
                    <>
                        <SettingGroup title="时长" color={theme.node.muted}>
                            <div className={`grid gap-2.5 ${isV3 ? "grid-cols-3" : "grid-cols-2"}`}>
                                {(isV3 ? klingV3DurationOptions : klingV26DurationOptions).map((value) => (
                                    <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                        {value}s
                                    </OptionPill>
                                ))}
                                {isV3 ? <NumberInput value={config.videoSeconds} min={3} max={15} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} /> : null}
                            </div>
                        </SettingGroup>
                        <AudioGenerationSetting checked={generateAudio} hint={isV3 ? undefined : "仅专业模式，仅一张参考图可用"} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, modelName, onConfigChange, theme, showTitle, className, visualOnly }: VideoSettingsPanelProps) {
    const model = modelName || config.model || config.videoModel;
    const modelId = modelKey(model);
    const seedance20 = (modelId.includes("seedance-2-0") || modelId.includes("seedance2-0") || modelId === "bytedance-seedance-2") && !isSeedanceFastOrMiniModel(model);
    const resolution = seedance20 ? normalizeVideoResolutionValue(config.vquality) : normalizeSeedanceResolution(config.vquality, model);
    const ratio = normalizeSeedanceRatio(config.size);
    const maxSeconds = (modelId.includes("seedance-2-5") || modelId.includes("seedance2-5") || modelId.includes("sd2-5")) ? 30 : 15;
    const duration = normalizeSeedanceDuration(config.videoSeconds, maxSeconds);
    const watermark = boolConfig(config.videoWatermark, false);
    const audioGenerationEnabled = supportsVideoAudioGeneration(model);
    const generateAudio = boolConfig(config.videoGenerateAudio, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {(seedance20 ? resolutionButtonOptions : seedanceResolutionOptions).map((item) => {
                            const disabled = item.value === "1080p" && isSeedanceFastOrMiniModel(model);
                            return (
                                <OptionPill key={item.value} selected={resolution === item.value} disabled={disabled} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            );
                        })}
                        {seedance20 ? <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} /> : null}
                    </div>
                    {isSeedanceFastOrMiniModel(model) ? <div className="text-[11px] leading-4 opacity-55">fast / mini 模型不支持 1080p，会自动使用 720p。</div> : null}
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                {!visualOnly ? (
                    <>
                        <SettingGroup title="时长" color={theme.node.muted}>
                            <div className="grid grid-cols-4 gap-2.5">
                                {seedanceDurationOptions.filter((value) => value <= maxSeconds).map((value) => (
                                    <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                        {value === -1 ? "智能" : `${value}s`}
                                    </OptionPill>
                                ))}
                            </div>
                            <NumberInput value={config.videoSeconds} min={-1} max={maxSeconds} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                        </SettingGroup>
                        {audioGenerationEnabled ? <AudioGenerationSetting checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                        <SettingGroup title="输出" color={theme.node.muted}>
                            <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                                <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                            </div>
                        </SettingGroup>
                    </>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    const resolution = normalizeVideoResolutionValue(value);
    return resolution.toLowerCase().endsWith("k") ? resolution : `${resolution}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const presetRatio = seedanceRatioOptions.find((item) =>
        item.value !== "adaptive" && videoResolutionOptions.some((resolution) => seedancePixelLabel(resolution.value, item.value) === value),
    );
    if (presetRatio) return presetRatio.label;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

export function videoSizeForResolution(resolution: string, size: string) {
    const ratio = normalizeSeedanceRatio(size);
    if (ratio === "adaptive") return "auto";
    const normalizedResolution = normalizeVideoResolutionValue(resolution);
    if (!videoResolutionOptions.some((item) => item.value === normalizedResolution.toLowerCase())) return normalizeVideoSizeValue(size);
    return seedancePixelLabel(normalizedResolution, ratio);
}

export function videoSizeOptions(resolution: string) {
    const normalizedResolution = normalizeVideoResolutionValue(resolution);
    return seedanceRatioOptions.map((item) => {
        const value = item.value === "adaptive" ? "auto" : seedancePixelLabel(normalizedResolution, item.value);
        return { value, label: value };
    });
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="text" className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            {/^\d{3,}$/.test(value.trim()) ? (
                <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                    p
                </span>
            ) : null}
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange, onBlur }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void; onBlur?: (value: string) => void }) {
    return <input type="number" min={min} max={max} className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }} value={value} onChange={(event) => onChange(event.target.value)} onBlur={(event) => onBlur?.(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function AudioGenerationSetting({ checked, hint, theme, onChange }: { checked: boolean; hint?: string; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <SettingGroup title="音频生成" color={theme.node.muted}>
            <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                <SwitchRow label="是否生成与视频同步的AI音频" checked={checked} theme={theme} onChange={onChange} />
                {hint ? <div className="text-[11px] leading-4 opacity-55">{hint}</div> : null}
            </div>
        </SettingGroup>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}

