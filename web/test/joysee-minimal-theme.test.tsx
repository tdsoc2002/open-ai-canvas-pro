import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_APPEARANCE_PRESETS } from "@/lib/canvas/canvas-appearance";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN, normalizeSkinDefinition } from "@/lib/skin-themes";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { applyThemePackCanvas } from "@/themes/apply";
import { themePackFor } from "@/themes/registry";
import { joyseeMinimalTheme } from "@/themes/joysee-minimal";
import { JoyseeAgentOrb, JoyseeCreditMark } from "@/themes/joysee-minimal/marks";
import { JOYSEE_MINIMAL_SKIN, JOYSEE_MINIMAL_SKIN_ID } from "@/themes/joysee-minimal/skin";

function luminance(hex: string) {
    const [r, g, b] = hex
        .slice(1)
        .match(/../g)!
        .map((channel) => {
            const value = parseInt(channel, 16) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function over(color: string, background: string) {
    const rgba = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    if (!rgba) return color;
    const alpha = Number(rgba[4]);
    return (
        "#" +
        [1, 2, 3]
            .map((channel) =>
                Math.round(Number(rgba[channel]) * alpha + parseInt(background.slice(channel * 2 - 1, channel * 2 + 1), 16) * (1 - alpha))
                    .toString(16)
                    .padStart(2, "0"),
            )
            .join("")
    );
}

function contrast(first: string, second: string, background = "#ffffff") {
    const a = luminance(over(first, background));
    const b = luminance(over(second, background));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("乐见极简主题合同", () => {
    afterEach(() => applyThemePackCanvas("classic"));

    test("独立登记并保持皮肤校验合同，不改默认皮肤或品牌文案", () => {
        expect(themePackFor(JOYSEE_MINIMAL_SKIN_ID)).toBe(joyseeMinimalTheme);
        expect(normalizeSkinDefinition(JOYSEE_MINIMAL_SKIN)).toEqual(JOYSEE_MINIMAL_SKIN);
        expect(JOYSEE_MINIMAL_SKIN.tokens.light).not.toBe(DEFAULT_CLASSIC_SKIN.tokens.light);
        expect(JOYSEE_MINIMAL_SKIN.id).not.toBe(DEFAULT_CLASSIC_SKIN.id);
        expect(joyseeMinimalTheme.creationLayout).toBe("compact");
        expect(joyseeMinimalTheme.workspaceStyle).toBe("joysee");
        expect(joyseeMinimalTheme.copy?.homeHeading).toBe("今天，想创作什么？");
    });

    test("工作区控件统一为参考尺寸，未启用主题仍保留原配置", () => {
        const reference = getWorkspaceAntThemeConfig("joysee");
        const original = getWorkspaceAntThemeConfig();
        expect(reference.token?.controlHeight).toBe(40);
        expect(reference.token?.controlHeightSM).toBe(32);
        expect(reference.token?.fontSize).toBe(14);
        expect(original.token?.controlHeight).toBe(34);
        expect(original.token?.controlHeightSM).toBe(28);
        const css = readFileSync(new URL("../src/themes/joysee-minimal/workspace.css", import.meta.url), "utf8");
        expect(css).toContain("--button-height-sm: 32px");
        const productCss = readFileSync(new URL("../src/styles/workspace-product.css", import.meta.url), "utf8");
        expect(productCss).toMatch(/\.canvas-collection-preview \{[^}]*aspect-ratio: 16 \/ 9;/);
        expect(css).not.toMatch(/var\(--control-height(?:-sm)?\)/);
    });

    for (const mode of ["light", "dark"] as const) {
        test(`${mode}：当前 LJCanvas 中性底色与真实消费者对比度`, () => {
            const colors = JOYSEE_MINIMAL_SKIN.tokens[mode];
            expect(colors.primary).toBe(mode === "light" ? "#1a1a1a" : "#f5f5f5");
            for (const key of ["canvas", "surfaceSubtle", "selected", "primary", "controlFocus", "switchChecked"] as const) {
                const [r, g, b] = colors[key]
                    .slice(1)
                    .match(/../g)!
                    .map((value) => parseInt(value, 16));
                expect(r).toBe(g);
                expect(g).toBe(b);
            }
            for (const bg of [colors.primary, colors.primaryHover, colors.primaryActive]) expect(contrast(bg, colors.primaryForeground)).toBeGreaterThanOrEqual(4.5);
            for (const bg of [colors.selected, colors.selectedHover, colors.selectedActive]) expect(contrast(bg, colors.selectedForeground)).toBeGreaterThanOrEqual(4.5);
            // 灵感描述读取 muted，不会跟随 selectedForeground；须覆盖真实悬停与按下底色。
            for (const bg of [colors.surface, colors.selected, colors.selectedHover, colors.selectedActive]) expect(contrast(bg, colors.textMuted)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colors.switchChecked, colors.switchCheckedHandle)).toBeGreaterThanOrEqual(3);
            expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(mode === "light" ? "#564f9f" : "#b5abf0", colors.canvas)).toBeGreaterThanOrEqual(4.5);
            expect(colors.overlay).toMatch(/^#[0-9a-f]{6}$/i);
        });
    }

    test("真实画布主题和预设可重复套用、切换还原，保留时间轴语义色", () => {
        applyThemePackCanvas("classic");
        const before = structuredClone(canvasThemes);
        const presets = structuredClone(CANVAS_APPEARANCE_PRESETS);
        applyThemePackCanvas(JOYSEE_MINIMAL_SKIN_ID);
        applyThemePackCanvas(JOYSEE_MINIMAL_SKIN_ID);
        expect(canvasThemes.light.canvas.background).toBe("#f5f5f5");
        expect(canvasThemes.dark.toolbar.panel).toBe("#2a2a2a");
        expect(canvasThemes.light.timeline).toEqual(before.light.timeline);
        expect(canvasThemes.dark.timeline).toEqual(before.dark.timeline);
        // 文本编辑器用 accent.primary，右键菜单用 node.text，并非都读 toolbar.activeText。
        for (const mode of ["light", "dark"] as const) {
            const { toolbar, accent, node } = canvasThemes[mode];
            expect(contrast(toolbar.activeBg, accent.primary, toolbar.panel)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(toolbar.activeBg, node.text, toolbar.panel)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(toolbar.activeBg, toolbar.activeText, toolbar.panel)).toBeGreaterThanOrEqual(4.5);
            // 画布菜单分组、快捷键和箭头使用 faint；不能只检查菜单主文字。
            for (const bg of [toolbar.panel, toolbar.itemHover, toolbar.activeBg, canvasThemes[mode].spatial.elevated]) expect(contrast(bg, node.faint, toolbar.panel)).toBeGreaterThanOrEqual(4.5);
        }
        expect(CANVAS_APPEARANCE_PRESETS.find((item) => item.id === "light")?.values.backgroundColor).toBe("#F5F5F5");
        applyThemePackCanvas("classic");
        expect(canvasThemes).toEqual(before);
        expect(CANVAS_APPEARANCE_PRESETS).toEqual(presets);
    });

    for (const mode of ["light", "dark"] as const) {
        test(`${mode}：当前主题真实样式级联与首页结构合同`, async () => {
            const window = new Window({ settings: { disableCSSFileLoading: true } });
            const document = window.document;
            const css = readFileSync(new URL("../src/themes/joysee-minimal/theme.css", import.meta.url), "utf8");
            const style = document.createElement("style");
            style.textContent = css;
            document.head.append(style);
            document.documentElement.classList.toggle("dark", mode === "dark");
            applySkinTheme(JOYSEE_MINIMAL_SKIN, mode, document as unknown as Document);
            document.body.innerHTML = renderToStaticMarkup(
                <div className="app-user-workspace">
                    <aside className="app-workspace-sidebar">
                        <div className="app-workspace-sidebar-nav" />
                    </aside>
                    <div className="creation-launchpad">
                        <header className="creation-start-heading">
                            <h1>今天，想创作什么？</h1>
                        </header>
                        <div className="creation-composer-shell">
                            <div className="creation-chat-composer">
                                <div className="creation-chat-dock" />
                            </div>
                        </div>
                        <footer className="creation-launchpad-footer" />
                    </div>
                    <article className="inspiration-card" />
                </div>,
            );
            const computed = (selector: string) => window.getComputedStyle(document.querySelector(selector)!);
            expect(computed(".creation-start-heading").textAlign).toBe("center");
            expect(computed(".creation-start-heading").alignItems).toBe("center");
            expect(computed(".creation-start-heading h1").color).toBe(JOYSEE_MINIMAL_SKIN.tokens[mode].text);
            expect(computed(".creation-chat-dock").borderTopWidth).toBe("0px");
            expect(computed(".creation-launchpad-footer").justifyContent).toBe("flex-end");
            expect(computed(".app-workspace-sidebar-nav").backgroundColor).toBe(mode === "light" ? "#f4f4f5" : "#171717");
            expect(computed(".inspiration-card").borderTopWidth).toBe("1px");
            const source = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");
            const composer = readFileSync(new URL("../src/pages/create/creation-workspace.tsx", import.meta.url), "utf8");
            expect(source).toContain('themePack?.creationLayout === "compact"');
            expect(source).toContain("<CreationModeMenu");
            expect(composer).toContain("{props.modeControl}");
            expect(composer).toContain('aria-haspopup="menu"');
            // 此处仅验证 CSS 与接入合同，真实模式切换、明暗和窄屏另在 3010 验收。
            await window.happyDOM.abort();
        });
    }

    test("所有样式选择器受主题 ID 限定，不增加全局 AntD 覆盖或隐藏焦点", () => {
        const css = ["theme.css", "workspace.css", "workbench.css"].map((file) => readFileSync(new URL(`../src/themes/joysee-minimal/${file}`, import.meta.url), "utf8")).join("\n");
        const window = new Window();
        const style = window.document.createElement("style");
        style.textContent = css;
        window.document.head.append(style);
        type Rule = { selectorText?: string; cssRules?: ArrayLike<Rule> };
        const selectors: string[] = [];
        const collect = (rules: ArrayLike<Rule>) => {
            for (const rule of Array.from(rules)) {
                if (rule.selectorText) selectors.push(...rule.selectorText.split(", ").filter((value) => value.startsWith(":root")));
                if (rule.selectorText) expect(rule.selectorText).toStartWith(':root[data-skin="joysee-minimal"]');
                if (rule.cssRules) collect(rule.cssRules);
            }
        };
        collect(style.sheet!.cssRules);
        expect(selectors.length).toBeGreaterThan(10);
        expect(css).toContain("prefers-reduced-motion: reduce");
        expect(css).toContain("--joysee-control-height: var(--button-height-lg)");
        expect(css).toContain("--joysee-control-height-sm: 32px");
        expect(css).not.toMatch(/var\(--control-height(?:-sm)?\)/);
        expect(css).toContain("animation: none");
        expect(css).not.toMatch(/outline\s*:\s*(?:none|0)/);
        expect(css).not.toContain(".ant-");
        window.happyDOM.abort();
    });

    test("真实助手组件区分三态，积分标记不包含渐变和外部资源", () => {
        for (const state of ["idle", "work", "done"] as const) {
            const markup = renderToStaticMarkup(<JoyseeAgentOrb size={32} state={state} />);
            expect(markup).toContain(`data-state="${state}"`);
            expect(markup).toContain('width="32"');
            expect(markup).toContain('aria-hidden="true"');
            expect(markup.includes('stroke-dasharray="68 40"')).toBe(state === "work");
        }
        const credit = renderToStaticMarkup(<JoyseeCreditMark />);
        expect(credit).toContain("joysee-credit-mark");
        expect(credit).not.toMatch(/gradient|https?:|<img/);
    });
});
