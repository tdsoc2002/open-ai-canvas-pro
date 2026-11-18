import { describe, expect, test } from "bun:test";
import { zhCN as canvasBZh } from "../src/i18n/messages/areas/canvasB/zh-CN";
import { readFileSync } from "node:fs";

import { formatAbsoluteDateTime, formatRelativeTime } from "../src/lib/relative-time";
import { skillAccent, skillAccentNames, skillGlyph } from "../src/pages/skills/skill-catalog";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/styles/workspace-product.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("relative time", () => {
    const now = Date.parse("2026-10-24T12:00:00+08:00");
    test("formats recent times relatively and older ones as dates", () => {
        expect(formatRelativeTime(now - 20_000, now)).toBe("刚刚");
        expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
        expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
        expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2 天前");
        expect(formatRelativeTime(now - 30 * 86_400_000, now)).not.toContain("前");
        expect(formatRelativeTime("", now)).toBe("时间未知");
        expect(formatAbsoluteDateTime("not-a-date")).toBe("时间未知");
    });
});

describe("skill identity", () => {
    test("glyph uses the first grapheme of the name", () => {
        expect(skillGlyph("分镜大师")).toBe("分");
        expect(skillGlyph("  storyboard")).toBe("S");
        expect(skillGlyph("")).toBe("技");
    });
    test("accent is fixed for built-in categories and stable for custom ones", () => {
        expect(skillAccent("drama")).toBe("blue");
        expect(skillAccent("custom-root")).toBe(skillAccent("custom-root"));
        expect(skillAccentNames).toContain(skillAccent("custom-root"));
        for (const name of skillAccentNames) expect(css).toContain(`.skill-tile[data-accent="${name}"]`);
    });
});

describe("canvas library card", () => {
    const card = read("../src/components/canvas/canvas-folder-card.tsx");
    const page = read("../src/pages/canvas/index.tsx");
    test("footer shows project ownership (or free canvas) with relative update time", () => {
        expect(card).toContain("formatRelativeTime(project.updatedAt)");
        expect(card).toContain("title={updatedTitle}");
        expect(card).toContain('{projectName || t("canvasB.folderCard.freeCanvas")}');
        expect(canvasBZh.folderCard.freeCanvas).toBe("自由画布");
        expect(card).toContain("canvas-collection-badge");
        expect(page).toContain('projectName={project.projectId ? projectNames.get(project.projectId) || "未同步项目" : undefined}');
        expect(page).not.toContain("已加载全部");
        expect(page).toContain('aria-label="正在加载更多画布"');
    });
    test("page keeps an accessible heading and unifies browsing and actions in one toolbar", () => {
        expect(page).toContain('<h1 className="sr-only">我的画布</h1>');
        expect(page).not.toContain("<PageHeader");
        expect(page).not.toContain("app-projects-header-meta");
        const toolbar = page.slice(page.indexOf("<CollectionToolbar"), page.indexOf("</CollectionToolbar>"));
        for (const label of ["搜索画布", "按所属项目筛选", "画布排序", "新建画布", "导入", "创作历史"]) expect(toolbar).toContain(label);
        expect(page).not.toContain("删除当前已加载画布");
        expect(page).not.toContain("更多画布操作");
    });
    test("grid caps at five columns and cover uses one 16:9 preview with video support", () => {
        expect(card).toContain("}} quiet");
        expect(card).not.toContain("mosaic");
        expect(css).toMatch(/\.canvas-collection-grid \{[^}]*calc\(\(100% - 4 \* var\(--canvas-card-gap-x\)\) \/ 5\)/);
        expect(css).toMatch(/\.canvas-collection-preview \{[^}]*aspect-ratio: 16 \/ 9;/);
        expect(read("../src/components/canvas/canvas-project-card.tsx")).toContain("<ProjectPreviewVideoFrame media={media} fallback={fallback} />");
        expect(card.indexOf("canvas-collection-body")).toBeGreaterThan(card.indexOf("canvas-collection-preview"));
    });
    test("secondary actions are revealed on hover/focus and always visible without hover", () => {
        expect(card).toContain("canvas-collection-rename");
        expect(css).toMatch(/\.canvas-collection-card:is\(:hover, :focus-within\) :is\(\.canvas-collection-select, \.canvas-collection-rename, \.canvas-collection-actions\)/);
        expect(css).toMatch(/@media \(hover: none\) \{ :is\(\.canvas-collection-select, \.canvas-collection-rename, \.canvas-collection-actions\) \{ opacity: 1; \} \}/);
    });
});

describe("skills library", () => {
    const page = read("../src/pages/skills/index.tsx");
    test("技能范围与分类在顶部，卡片结果区不再有左侧栏", () => {
        expect(page).toContain('className="skills-library-header"');
        expect(page).not.toContain('className="skills-rail"');
        expect(page).toContain('ariaLabel="我的技能范围"');
        expect(page).toContain('ariaLabel={isLibraryScope ? "我的技能分类" : "技能分类"}');
        expect(page).toContain("管理分类");
        expect(page).toContain("按行业推荐");
        expect(page).toContain('className="skills-results"');
        expect(page).not.toContain("SegmentedControl");
        expect(page).not.toContain("SkillCurationBrowser");
        expect(page).not.toContain("skills-tabs");
    });
    test("cards label their stats and keep add as a compact toggle", () => {
        expect(page).toContain("人加入");
        expect(page).toContain("aria-pressed={skill.isAdded}");
        expect(page).toContain("aria-pressed={skill.isLike}");
        expect(page).toContain("/skills/${encodeURIComponent(skill.skillId)}/edit");
        expect(css).toMatch(/\.skill-tile:is\(:hover, :focus-within\) \.skill-tile-actions/);
        expect(css).toMatch(/\.skill-tile-name-text \{[^}]*-webkit-line-clamp: 2;/);
        expect(css).toMatch(/\.skill-tile-description \{[^}]*-webkit-line-clamp: 2;/);
    });
});
