import type { ThemeCanvasPatch, ThemePack } from "../types";

// 参考 LJCanvas 当前中性画布，仅覆盖目标已有字段，时间轴语义色保留。
export const JOYSEE_CANVAS_THEMES: Record<"light" | "dark", ThemeCanvasPatch> = {
    light: {
        canvas: {
            background: "#f5f5f5",
            dot: "rgba(0,0,0,.80)",
            line: "rgba(0,0,0,.80)",
            selectionFill: "rgba(17,17,17,.10)",
        },
        connection: {
            stroke: "#a3a3a3",
            beam: "#404040",
        },
        node: {
            label: "#737373",
            agentUserMessage: "#f2f2f2",
            fill: "#ffffff",
            panel: "#ffffff",
            stroke: "#e5e5e5",
            edge: "rgba(15,23,42,.16)",
            shadow: "none",
            hoverShadow: "none",
            activeStroke: "#1a1a1a",
            placeholder: "#a3a3a3",
            text: "#1a1a1a",
            muted: "#737373",
            faint: "#606060",
        },
        frame: {
            fill: "rgba(17,24,39,.025)",
            stroke: "rgba(17,24,39,.18)",
            activeFill: "rgba(17,17,17,.05)",
            activeStroke: "#171717",
            preview: "#ffffff",
        },
        toolbar: {
            panel: "#ffffff",
            border: "rgba(17,24,39,.10)",
            item: "#737373",
            itemHover: "rgba(17,24,39,.06)",
            activeBg: "rgba(17,24,39,.10)",
            activeText: "#1a1a1a",
        },
        spatial: {
            surface: "#ffffff",
            elevated: "#ffffff",
            dropzone: "rgba(248,250,252,.78)",
            glow: "transparent",
            glowStrong: "transparent",
            shadow: "rgba(15,23,42,.18)",
        },
        accent: {
            primary: "#171717",
            primarySoft: "rgba(17,17,17,.10)",
            onPrimary: "#ffffff",
            danger: "#f87171",
        },
    },
    dark: {
        canvas: {
            background: "#191919",
            dot: "rgba(255,255,255,.32)",
            line: "rgba(255,255,255,.32)",
            selectionFill: "rgba(255,255,255,.12)",
        },
        connection: {
            stroke: "#737373",
            beam: "#e5e5e5",
        },
        node: {
            label: "#a3a3a3",
            agentUserMessage: "#2a2a2a",
            fill: "#202020",
            panel: "#242424",
            stroke: "#303030",
            edge: "rgba(255,255,255,.18)",
            shadow: "none",
            hoverShadow: "none",
            activeStroke: "#f5f5f5",
            placeholder: "#737373",
            text: "#f5f5f5",
            muted: "#a3a3a3",
            faint: "#b0b0b0",
        },
        frame: {
            fill: "rgba(255,255,255,.025)",
            stroke: "rgba(190,198,210,.15)",
            activeFill: "rgba(255,255,255,.08)",
            activeStroke: "#f5f5f5",
            preview: "#2a2a2a",
        },
        toolbar: {
            panel: "#242424",
            border: "rgba(255,255,255,.1)",
            item: "#d4d4d4",
            itemHover: "rgba(255,255,255,.07)",
            activeBg: "rgba(255,255,255,.10)",
            activeText: "#f5f6f8",
        },
        spatial: {
            surface: "#202020",
            elevated: "#242424",
            dropzone: "rgba(8,8,8,.9)",
            glow: "transparent",
            glowStrong: "transparent",
            shadow: "rgba(0,0,0,.6)",
        },
        accent: {
            primary: "#f5f5f5",
            primarySoft: "rgba(255,255,255,.11)",
            onPrimary: "#131313",
            danger: "#fb7185",
        },
    },
};

export const JOYSEE_CANVAS_PRESETS = {
    light: { label: "乐见浅色", values: { baseTheme: "light", backgroundColor: "#F5F5F5", backgroundBrightness: 0, gridColor: "#000000", gridOpacity: 24 } },
    dark: { label: "乐见深色", previousBackgroundColor: "#121212", values: { baseTheme: "dark", backgroundColor: "#191919", backgroundBrightness: 0, gridColor: "#FFFFFF", gridOpacity: 32 } },
} satisfies NonNullable<NonNullable<ThemePack["canvas"]>["presets"]>;
