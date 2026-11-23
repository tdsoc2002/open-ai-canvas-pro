import { preserveVideoSettings } from "@/lib/media-settings";
import { MediaSettingsNotice } from "@/components/media-settings-notice";
import { Scan } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Switch } from "@/components/ui/base/switch";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceRatio } from "@/lib/seedance-video";
import { isVolcengineArkVideoProtocol } from "@/lib/model-protocols";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { formatVideoResolutionLabel, isVideoResolutionMatch, normalizeVideoDuration, videoResolutionComparisonKey, VIDEO_DURATION_MIN } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor, resolveVideoRatioValue, resolveVideoResolutionValue, videoDurationOptions, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const optionGrid = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,64px),1fr))] gap-2";
const outputGrid = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,132px),1fr))] gap-2";

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoArkPrivateAssetUpload", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel(props: VideoSettingsPanelProps) {
    return (
        <>
            <MediaSettingsNotice config={props.config} capability="video" onChange={(field, value) => props.onConfigChange(field as Parameters<VideoSettingsPanelProps["onConfigChange"]>[0], value)} />
            <VideoSettingsControls {...props} />
        </>
    );
}

function VideoSettingsControls({ config, showTitle = true, className = "w-[292px] space-y-3", ...props }: VideoSettingsPanelProps) {
    const profile = modelCapabilityConfigFor(config, config.model).video!;
    const priceTiers = modelPriceTiers(config);
    const protocol = resolveModelRequestConfig(config, config.model).interfaceType;
    const panelProps = { ...props, config, profile, priceTiers, showTitle, className };
    if (protocol === "volcengine-jimeng-video") {
        return <JiMengVideoSettingsPanel {...panelProps} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel {...panelProps} />;
    }

    return <VideoProfileControls {...panelProps} protocol={protocol} />;
}

function VideoProfileControls({
    profile,
    config,
    protocol,
    priceTiers = [],
    theme,
    onConfigChange,
    showTitle,
    className,
}: Omit<VideoSettingsPanelProps, "config"> & {
    profile: VideoCapabilityConfig;
    config: Partial<Pick<AiConfig, "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark">>;
    protocol?: string;
    priceTiers?: ReturnType<typeof modelPriceTiers>;
}) {
    const { seconds, resolution, ratio } = preserveVideoSettings(profile, { seconds: config.videoSeconds, resolution: config.vquality, ratio: config.size }, protocol);
    const configuredResolutions = profile.resolutions.map((value) => ({ value, label: formatVideoResolutionLabel(value) }));
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                {configuredResolutions.length ? (
                    <SettingGroup title="分辨率">
                        <div className={optionGrid}>
                            {configuredResolutions.map((item) => (
                                <OptionPill
                                    key={item.value}
                                    selected={isVideoResolutionMatch(resolution, item.value)}
                                    disabled={!hasPriceTierForVideoSelection(priceTiers, item.value, Number(seconds))}
                                    theme={theme}
                                    onClick={() => onConfigChange("vquality", item.value)}
                                >
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                <VideoRatioOptions ratios={profile.ratios} selected={ratio} theme={theme} onChange={(value) => onConfigChange("size", value)} />
                <VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, resolution, value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                <VideoOutputSettings config={config} profile={profile} theme={theme} onConfigChange={onConfigChange} />
            </div>
        </ImageSettingsTheme>
    );
}

function JiMengVideoSettingsPanel({ config, profile, priceTiers, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig; priceTiers: ReturnType<typeof modelPriceTiers> }) {
    const { seconds, ratio } = preserveVideoSettings(profile, { seconds: config.videoSeconds, ratio: config.size });
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <VideoRatioOptions ratios={profile.ratios} selected={ratio} theme={theme} onChange={(value) => onConfigChange("size", value)} />
                <VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, "*", value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, profile, priceTiers, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig; priceTiers: ReturnType<typeof modelPriceTiers> }) {
    const model = modelOptionName(config.model || config.videoModel);
    const { resolution, ratio, seconds } = preserveVideoSettings(profile, { resolution: config.vquality, ratio: config.size, seconds: config.videoSeconds }, resolveModelRequestConfig(config, config.model || config.videoModel).interfaceType);
    const duration = Number(seconds);
    const useArkPrivateAssets = boolConfig(config.videoArkPrivateAssetUpload, true);
    const isArkSeedance = isVolcengineArkVideoProtocol(resolveModelRequestConfig(config, config.model).interfaceType);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率">
                    <div className={optionGrid}>
                        {profile.resolutions.map((value) => {
                            const item = { value, label: value.toUpperCase() };
                            const disabled = (item.value === "1080p" && isSeedanceFastModel(model)) || !hasPriceTierForVideoSelection(priceTiers, item.value, duration);
                            return (
                                <OptionPill key={item.value} selected={resolution === item.value} disabled={disabled} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            );
                        })}
                    </div>
                    {isSeedanceFastModel(model) ? <div className="text-[var(--fs-tiny)] leading-4 opacity-55">fast 模型自动使用 720P</div> : null}
                </SettingGroup>
                <VideoRatioOptions ratios={profile.ratios} selected={ratio} theme={theme} onChange={(value) => onConfigChange("size", value)} />
                <VideoDurationControl profile={profile} value={duration} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, resolution, value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                <VideoOutputSettings config={config} profile={profile} theme={theme} onConfigChange={onConfigChange} />
                {isArkSeedance ? (
                    <SettingGroup title="参考图">
                        <SwitchRow label="自动同步可信素材（确认拥有使用权）" checked={useArkPrivateAssets} theme={theme} onChange={(checked) => onConfigChange("videoArkPrivateAssetUpload", String(checked))} />
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function VideoOutputSettings({
    config,
    profile,
    theme,
    onConfigChange,
}: Pick<VideoSettingsPanelProps, "theme" | "onConfigChange"> & {
    config: Partial<Pick<AiConfig, "videoGenerateAudio" | "videoWatermark">>;
    profile: VideoCapabilityConfig;
}) {
    const { generateAudio, watermark } = profile;
    if (!generateAudio.supported && !watermark.supported) return null;

    return (
        <SettingGroup title="输出">
            <div className={`video-output-options ${outputGrid}`}>
                {generateAudio.supported ? <SwitchRow label="生成声音" checked={boolConfig(config.videoGenerateAudio, generateAudio.default)} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                {watermark.supported ? <SwitchRow label="添加水印" checked={boolConfig(config.videoWatermark, watermark.default)} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
            </div>
        </SettingGroup>
    );
}

export function videoResolutionLabel(value: string) {
    return value === "auto" ? "自动" : formatVideoResolutionLabel(value);
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    // The compact summary must mirror the selected value (for example 16:9),
    // while the settings panel can still use semantic labels such as 横屏.
    if (ratio === value) return ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    return `${normalizeVideoDuration(value)}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

function VideoRatioOptions({ ratios, selected, theme, onChange }: { ratios: readonly string[]; selected: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    if (!ratios.length) return null;
    return (
        <SettingGroup title="比例">
            <div className={optionGrid}>
                {ratios.map((value) => (
                    <OptionPill key={value} selected={selected === value} theme={theme} preview={<SizePreview value={value} />} onClick={() => onChange(value)}>
                        {value === "adaptive" || value === "auto" ? "自适应" : value}
                    </OptionPill>
                ))}
            </div>
        </SettingGroup>
    );
}

function OptionPill({ selected, disabled = false, theme, onClick, children, preview }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode; preview?: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className={`flex min-w-0 cursor-pointer items-center justify-center rounded-[var(--r-md)] border px-1 text-center text-[var(--fs-ui)] font-medium leading-tight [overflow-wrap:anywhere] aria-pressed:font-semibold enabled:hover:border-current! focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-35 ${preview ? "min-h-14 flex-col gap-1.5" : "min-h-9"}`}
            style={{
                background: selected ? theme.toolbar.activeBg : theme.toolbar.itemHover,
                color: theme.node.text,
                borderColor: selected ? theme.node.activeStroke : theme.node.edge,
                boxShadow: selected ? `inset 0 0 0 1px ${theme.node.activeStroke}` : undefined,
                outlineColor: theme.node.activeStroke,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {preview ? (
                <span className="grid h-5 shrink-0 place-items-center" aria-hidden="true">
                    {preview}
                </span>
            ) : null}
            <span className="min-w-0">{children}</span>
        </button>
    );
}

function SettingGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    const titleId = useId();
    return (
        <div role="group" aria-labelledby={titleId} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div id={titleId} className="text-[var(--fs-ui)] font-semibold">
                    {title}
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

function DurationInput({ value, min, max, theme, onChange }: { value: number; min: number; max?: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Math.min(max || Number.POSITIVE_INFINITY, Math.max(min, Math.floor(Number(input.value) || value || min)));
        input.value = String(next);
        onChange(next);
    };

    return (
        <label
            className="flex h-8 w-[4.5rem] shrink-0 items-center rounded-[var(--r-md)] border text-[var(--fs-ui)] focus-within:outline-2 focus-within:outline-offset-2"
            style={{ background: theme.toolbar.itemHover, borderColor: theme.node.edge, color: theme.node.text, outlineColor: theme.node.activeStroke }}
        >
            <input
                key={`${min}-${value}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                defaultValue={value}
                aria-label="视频时长（秒）"
                className="min-w-0 flex-1 bg-transparent pl-2 text-right font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="shrink-0 px-2 text-[var(--fs-caption)]" style={{ color: theme.node.muted }}>
                秒
            </span>
        </label>
    );
}

function VideoDurationControl({ profile, value, theme, disabled, onChange }: { profile: VideoCapabilityConfig; value: number; theme: CanvasTheme; disabled?: (value: number) => boolean; onChange: (value: number) => void }) {
    if (profile.duration.selection === "range") {
        const min = profile.duration.min || VIDEO_DURATION_MIN;
        const max = Math.max(min, profile.duration.max || min);
        const step = Math.max(1, profile.duration.step || 1);
        const normalized = normalizeDurationValue(value, profile.duration.default, min, max, step);
        return (
            <DurationRangeControl
                value={normalized}
                min={min}
                max={max}
                step={step}
                theme={theme}
                onChange={(next) => {
                    if (!disabled?.(next)) onChange(next);
                }}
            />
        );
    }

    const options = videoDurationOptions(profile);
    return (
        <SettingGroup title="时长">
            <div className={optionGrid}>
                {options.map((option) => (
                    <OptionPill key={option} selected={normalizedNumber(value) === option} disabled={disabled?.(option)} theme={theme} onClick={() => onChange(option)}>
                        {option}s
                    </OptionPill>
                ))}
            </div>
        </SettingGroup>
    );
}

function modelPriceTiers(config: AiConfig) {
    const channel = resolveModelChannel(config, config.model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(config.model));
    return cost?.logicalPriceTiers || [];
}

function hasPriceTierForVideoSelection(tiers: ReturnType<typeof modelPriceTiers>, resolution: string, seconds: number) {
    if (!tiers.length) return true;
    const normalizedResolution = normalizeTierResolution(resolution);
    return tiers.some((tier) => {
        const selector = tier.selector || {};
        const tierResolution = selector.vquality || tier.resolution;
        const tierSeconds = selector.videoSeconds ? Number(selector.videoSeconds) : tier.videoSeconds;
        return (tierResolution === "*" || !tierResolution || normalizeTierResolution(tierResolution) === normalizedResolution) && (!tierSeconds || tierSeconds === seconds);
    });
}

function normalizeTierResolution(value: string) {
    return videoResolutionComparisonKey(value);
}

function DurationRangeControl({ value, min, max, step, theme, onChange }: { value: number; min: number; max: number; step: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    return (
        <SettingGroup title="时长" action={<DurationInput value={value} min={min} max={max} theme={theme} onChange={onChange} />}>
            <div className="flex items-center rounded-[var(--r-md)] border px-2" style={{ background: theme.toolbar.itemHover, borderColor: theme.node.edge }}>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    aria-label="视频时长（秒）"
                    className="video-duration-range h-8 w-full min-w-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ accentColor: theme.accent.primary, outlineColor: theme.node.activeStroke }}
                    onChange={(event) => onChange(Number(event.target.value))}
                    onMouseDown={(event) => event.stopPropagation()}
                />
            </div>
            <div className="flex justify-between px-0.5 text-[var(--fs-caption)] tabular-nums" style={{ color: theme.node.muted }}>
                <span>{min}s</span>
                <span>{max}s</span>
            </div>
        </SettingGroup>
    );
}

function normalizeDurationValue(value: number, fallback: number, min: number, max: number, step: number) {
    const candidate = Number.isFinite(value) ? value : fallback;
    const clamped = Math.min(max, Math.max(min, Math.floor(candidate)));
    const maxStep = Math.max(0, Math.floor((max - min) / step));
    return min + Math.min(maxStep, Math.max(0, Math.round((clamped - min) / step))) * step;
}

function normalizedNumber(value: number) {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

function SizePreview({ value }: { value: string }) {
    const [width, height] = value.split(/[:x]/i).map(Number);
    if (!(width > 0 && height > 0)) return <Scan size={16} />;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(7, Math.round((width / longSide) * 16));
    const previewHeight = Math.max(7, Math.round((height / longSide) * 16));
    return <span className="shrink-0 rounded-[2px] border border-current" style={{ width: previewWidth, height: previewHeight }} />;
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div
            className="flex min-h-9 items-center justify-between gap-2 rounded-[var(--r-md)] border px-2 py-1"
            style={{
                background: `var(--video-output-row-bg, ${theme.toolbar.itemHover})`,
                borderColor: `var(--video-output-row-border, ${theme.node.edge})`,
            }}
        >
            <span className="min-w-0 text-[var(--fs-ui)] leading-tight">{label}</span>
            <span className="shrink-0" onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="sm" aria-label={label} checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}
