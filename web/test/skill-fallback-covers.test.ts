import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { getSkillFallbackCover } from "../src/pages/skills/skill-fallback-covers";

describe("技能库示意封面", () => {
    test("截图中已有配图的技能按 ID 取各自的图集单元", () => {
        expect(getSkillFallbackCover({ skillId: "14811816970508", sourceType: "builtin", tag: "drama", source: 3 })).toEqual({
            src: "/images/skill-covers/cinema.png",
            crop: { width: 1366, height: 1152, viewBox: "2 2 680 381" },
        });
        expect(getSkillFallbackCover({ skillId: "14811816981772", sourceType: "builtin", tag: "drama", source: 3 })?.crop?.viewBox).toBe("686 2 678 381");
    });

    test("独立封面优先于分类示意；两种图都随应用提供", () => {
        const individual = getSkillFallbackCover({ skillId: "yingce-image-editing", sourceType: "builtin", tag: "creative", source: 3 });
        const category = getSkillFallbackCover({ skillId: "unknown", sourceType: "builtin", tag: "ecommerce", source: 3 });
        expect(individual?.src).toBe("/images/skill-covers/yingce-image-editing.webp");
        expect(category?.src).toBe("/images/skill-covers/productvideo.webp");
        for (const cover of [individual, category]) expect(existsSync(new URL(`../public${cover?.src}`, import.meta.url))).toBe(true);
    });

    test("不会给用户上传或从 GitHub 安装的技能套用内置配图", () => {
        expect(getSkillFallbackCover({ skillId: "14811816970508", sourceType: "github", tag: "drama", source: 1 })).toBeUndefined();
    });
});
