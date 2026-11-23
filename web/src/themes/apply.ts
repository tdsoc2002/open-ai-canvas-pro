import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_APPEARANCE_PRESETS, type CanvasAppearancePreset } from "@/lib/canvas/canvas-appearance";

import { themePackFor } from "./registry";
import type { ThemeCanvasPatch } from "./types";

// 外观提交（commitPublicAppearance）时调用：按当前皮肤套用主题包的画布配色，并写入品牌名变量。

let upstream: { themes: ThemeCanvasPatch; presets: Map<string, Omit<CanvasAppearancePreset, "id">> } | undefined;

function assignDeep(target: ThemeCanvasPatch, patch: ThemeCanvasPatch) {
    for (const [key, value] of Object.entries(patch)) {
        if (typeof value === "string") target[key] = value;
        else if (target[key] && typeof target[key] === "object") assignDeep(target[key] as ThemeCanvasPatch, value);
    }
}

function restoreUpstream() {
    if (!upstream) return;
    assignDeep(canvasThemes as unknown as ThemeCanvasPatch, upstream.themes);
    for (const preset of CANVAS_APPEARANCE_PRESETS) {
        const original = upstream.presets.get(preset.id);
        if (original) Object.assign(preset, { label: original.label, values: original.values });
        delete preset.previousBackgroundColor;
    }
}

/**
 * 画布配色和画布外观预设写死在上游代码里，皮肤数据改不到：启用带画布配色的主题包时就地替换，
 * 切到其他皮肤时还原上游原值。主题包可指定旧预设的原始底色，供读取快照时映射。
 */
export function applyThemePackCanvas(skinId: string) {
    const canvas = themePackFor(skinId)?.canvas;
    restoreUpstream();
    if (!canvas) {
        upstream = undefined;
        return;
    }
    const themes = canvasThemes as unknown as ThemeCanvasPatch;
    upstream ??= {
        themes: structuredClone(themes),
        presets: new Map(CANVAS_APPEARANCE_PRESETS.map((preset) => [preset.id, { label: preset.label, values: preset.values }])),
    };
    assignDeep(themes, canvas.themes);
    for (const preset of CANVAS_APPEARANCE_PRESETS) {
        if (preset.id !== "light" && preset.id !== "dark") continue;
        const override = canvas.presets?.[preset.id];
        if (override) Object.assign(preset, override, { values: { ...override.values } });
    }
}

/** 主题样式里要显示品牌名的地方（例如印章）读这两个变量：完整品牌名，以及取前两个字的印章字。 */
export function applyThemeBrandVariables(brandName: string, targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document) {
    if (!targetDocument) return;
    const name = brandName.trim();
    const seal = Array.from(name).slice(0, 2).join("");
    const root = targetDocument.documentElement;
    root.style.setProperty("--theme-brand-name", JSON.stringify(name));
    root.style.setProperty("--theme-brand-seal", JSON.stringify(seal));
}
