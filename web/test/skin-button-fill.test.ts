import { describe, expect, test } from "bun:test";
import { applySkinTheme, cloneSkinDefinition, getSkinButtonAppearance, isSkinButtonFill, normalizeSkinDefinition } from "../src/lib/skin-themes";
import { JOYSEE_MINIMAL_SKIN } from "../src/themes/joysee-minimal/skin";

describe("theme primary button fills", () => {
    test("Joysee primary is a solid ink fill in both modes without changing selection colors", () => {
        expect(getSkinButtonAppearance(JOYSEE_MINIMAL_SKIN, "light")).toEqual({ background: "#1a1a1a", hover: "#303030", active: "#0a0a0a", foreground: "#ffffff" });
        expect(getSkinButtonAppearance(JOYSEE_MINIMAL_SKIN, "dark")).toEqual({ background: "#f5f5f5", hover: "#e5e5e5", active: "#d4d4d4", foreground: "#1a1a1a" });
        for (const mode of ["light", "dark"] as const) {
            expect(JOYSEE_MINIMAL_SKIN.tokens.buttons[mode].mode).toBe("solid");
            expect(JSON.stringify(JOYSEE_MINIMAL_SKIN.tokens.buttons[mode])).not.toMatch(/#6554df|#386fbc/i);
        }
        expect(JOYSEE_MINIMAL_SKIN.tokens.light.selected).toBe("#f2f2f2");
    });

    test("Joysee replaces stale button variables", () => {
        const values = new Map<string, string>();
        const doc = {
            documentElement: {
                dataset: {},
                style: {
                    removeProperty: (key: string) => values.delete(key),
                    setProperty: (key: string, value: string) => values.set(key, value),
                },
            },
        } as unknown as Document;
        values.set("--button-primary-bg", "stale");
        applySkinTheme(JOYSEE_MINIMAL_SKIN, "dark", doc);
        expect(values.get("--button-primary-bg")).toBe("#f5f5f5");
    });

    test("copies have independent fills and switching to solid clears every gradient state", () => {
        const skin = cloneSkinDefinition(JOYSEE_MINIMAL_SKIN);
        skin.tokens.buttons.light.mode = "gradient";
        skin.tokens.buttons.light.angle = 45;
        skin.tokens.buttons.light.start = "#123456";
        expect(JOYSEE_MINIMAL_SKIN.tokens.buttons.light.angle).toBe(180);
        expect(JOYSEE_MINIMAL_SKIN.tokens.buttons.light.mode).toBe("solid");
        expect(skin.tokens.buttons.dark.angle).toBe(180);
        expect(getSkinButtonAppearance(skin, "light").background).toBe("linear-gradient(45deg, #123456, #18181b)");
        const values = new Map<string, string>();
        const doc = {
            documentElement: {
                dataset: {},
                style: {
                    removeProperty: (key: string) => values.delete(key),
                    setProperty: (key: string, value: string) => values.set(key, value),
                },
            },
        } as unknown as Document;
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("linear-gradient(45deg, #123456, #18181b)");
        skin.tokens.buttons.light.mode = "solid";
        Object.assign(skin.tokens.light, { primary: "#123456", primaryHover: "#234567", primaryActive: "#345678", primaryForeground: "#ffffff" });
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("#123456");
        expect(values.get("--button-primary-hover-bg")).toBe("#234567");
        expect(values.get("--button-primary-active-bg")).toBe("#345678");
        applySkinTheme(JOYSEE_MINIMAL_SKIN, "dark", doc);
        expect(values.get("--background")).toBe("#121212");
        expect(values.get("--button-primary-fg")).toBe("#1a1a1a");
    });

    test("legacy themes without fills fall back to solid primary actions", () => {
        const legacy = JSON.parse(JSON.stringify(JOYSEE_MINIMAL_SKIN));
        delete legacy.tokens.buttons;
        const normalized = normalizeSkinDefinition(legacy);
        expect(normalized.tokens.buttons.light.mode).toBe("solid");
        expect(normalized.tokens.buttons.dark.mode).toBe("solid");
    });

    test("invalid modes, angles and CSS injection cannot become runtime gradients", () => {
        for (const patch of [{ mode: "url(x)" }, { angle: 361 }, { angle: -1 }, { angle: 1.5 }, { angle: NaN }, { start: "red; background:url(x)" }, { foreground: "white" }]) {
            const skin = cloneSkinDefinition(JOYSEE_MINIMAL_SKIN);
            Object.assign(skin.tokens.buttons.light, { mode: "gradient" }, patch);
            expect(isSkinButtonFill(skin.tokens.buttons.light)).toBe(false);
            expect(getSkinButtonAppearance(normalizeSkinDefinition(skin), "light").background).toBe(skin.tokens.light.primary);
        }
    });
});
