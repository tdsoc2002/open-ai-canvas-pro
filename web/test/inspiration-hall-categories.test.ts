import { describe, expect, test } from "bun:test";

import type { CreationInspiration } from "../src/lib/inspirations/catalog";
import { inspirationHallCategoryOf } from "../src/lib/inspirations/hall-categories";

const item: CreationInspiration = { mode: "image", title: "海边日记", description: "", image: "", prompt: "" };

describe("灵感大厅创作方向", () => {
    test("标题和标签优先于上游分类", () => {
        expect(inspirationHallCategoryOf({ ...item, title: "动画角色设定", category: "电商主图" })).toBe("animation");
        expect(inspirationHallCategoryOf({ ...item, title: "样片", tags: ["portrait"] })).toBe("portrait");
    });

    test("文本归入故事文案；未识别的内容按类型归类", () => {
        expect(inspirationHallCategoryOf({ ...item, mode: "text", title: "电商广告脚本" })).toBe("writing");
        expect(inspirationHallCategoryOf({ ...item, mode: "video", title: "片段" })).toBe("film");
        expect(inspirationHallCategoryOf({ ...item, title: "样片" })).toBe("lifestyle");
    });
});
