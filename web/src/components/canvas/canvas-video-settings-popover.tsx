import { preserveVideoSettings } from "@/lib/media-settings";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { boolConfig } from "@/lib/seedance-video";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CanvasSettingsPopover, type CanvasSettingsPlacement } from "./canvas-settings-popover";

type VideoPopoverProps = { config: AiConfig; onConfigChange: (key: keyof AiConfig, value: string) => void; buttonClassName?: string; placement?: CanvasSettingsPlacement };

export function CanvasVideoSettingsPopover({ config, onConfigChange, ...popover }: VideoPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const profile = modelCapabilityConfigFor(config, config.model).video;
    const selected = profile ? preserveVideoSettings(profile, { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality }, resolveModelRequestConfig(config, config.model).interfaceType) : undefined;
    const label = t("canvasC.videoSettings.label");
    const supportsAudio = profile?.generateAudio.supported === true;
    const audioEnabled = boolConfig(config.videoGenerateAudio, profile?.generateAudio.default ?? false);
    const AudioIcon = audioEnabled ? Volume2 : VolumeX;
    const triggerStatus = supportsAudio
        ? {
              icon: <AudioIcon className="size-3.5" />,
              label: `${t("library.tasks.params.audio")} · ${t(audioEnabled ? "library.tasks.params.enabled" : "library.tasks.params.disabled")}`,
          }
        : undefined;
    const parts: string[] = [];
    if (profile?.resolutions.length && selected) parts.push(videoResolutionLabel(selected.resolution));
    if (profile?.ratios.length && selected) parts.push(videoSizeLabel(selected.ratio));
    parts.push(videoSecondsLabel(selected?.seconds || config.videoSeconds));
    return (
        <CanvasSettingsPopover {...popover} label={label} summary={parts.join(" · ")} triggerStatus={triggerStatus}>
            <VideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} className="canvas-video-settings space-y-4" />
        </CanvasSettingsPopover>
    );
}
