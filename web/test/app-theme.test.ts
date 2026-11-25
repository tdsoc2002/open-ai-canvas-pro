import { describe, expect, test } from "bun:test";

import { getAntThemeConfig, getWorkspaceAntThemeConfig } from "../src/lib/app-theme";
import { cloneSkinDefinition } from "../src/lib/skin-themes";
import { JOYSEE_MINIMAL_SKIN } from "../src/themes/joysee-minimal/skin";
import { getIsolatedAdminAntTheme } from "../src/pages/admin/theme/admin-ant-theme";

describe("shared action colors and focus feedback", () => {
    for (const dark of [false, true]) {
        test(`Joysee solid tokens remain monochrome beneath the button fill adapter in ${dark ? "dark" : "light"} mode`, () => {
            const product = getAntThemeConfig(dark);
            const admin = getIsolatedAdminAntTheme(dark);
            expect(product.components?.Button?.colorPrimary).toBe(dark ? "#f5f5f5" : "#1a1a1a");
            expect(admin.components?.Button?.colorPrimary).toBe(product.components?.Button?.colorPrimary);
            expect(admin.components?.Button?.primaryColor).toBe(product.components?.Button?.primaryColor);
        });

        test(`custom primary action states reach product and admin in ${dark ? "dark" : "light"} mode`, () => {
            const skin = cloneSkinDefinition(JOYSEE_MINIMAL_SKIN);
            Object.assign(skin.tokens[dark ? "dark" : "light"], {
                primary: "#123456",
                primaryHover: "#234567",
                primaryActive: "#345678",
                primaryForeground: "#abcdef",
            });
            for (const theme of [getAntThemeConfig(dark, skin), getIsolatedAdminAntTheme(dark, skin)]) {
                expect(theme.components?.Button).toMatchObject({
                    colorPrimary: "#123456",
                    colorPrimaryHover: "#234567",
                    colorPrimaryActive: "#345678",
                    primaryColor: "#abcdef",
                });
                expect(theme.token?.controlOutlineWidth).toBe(0);
                expect(theme.components?.Input?.activeShadow).toBe("none");
                expect(theme.components?.InputNumber?.activeShadow).toBe("none");
                expect(theme.components?.DatePicker?.activeShadow).toBe("none");
                expect(theme.components?.Select?.activeOutlineColor).toBe("transparent");
            }
        });
    }

    test("workspace density overrides inherit action colors and shadow-free focus", () => {
        const theme = getWorkspaceAntThemeConfig();
        expect(theme.components?.Button?.colorPrimary).toBeUndefined();
        expect(theme.components?.Button?.primaryColor).toBeUndefined();
        expect(theme.components?.Input?.activeShadow).toBe("none");
    });
});
