import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("乐见真实画布编辑器组件合同", () => {
    test("乐见皮肤合并底部视图和编辑工具，其他皮肤及专注模式保留原布局", () => {
        const page = source("pages/canvas/project.tsx");
        expect(page).toContain('useThemePack()?.workspaceStyle === "joysee"');
        expect(page).toContain("const combineCanvasTools = joyseeEditor && !focusMode");
        expect(page).toContain("viewControls={combineCanvasTools ? canvasViewControls : undefined}");
        expect(page).toMatch(/canvas-workspace-zoom-controls[\s\S]+?\{!combineCanvasTools \? canvasViewControls : null\}[\s\S]+?onFollowAgentChange=\{setAgentFollowCamera\}/);
        expect(page).toContain("vertical={joyseeEditor && focusMode}");
        for (const callback of ["onScaleChange={setZoomScale}", "onFitContent={fitCanvasContent}", "onHideNodeConnectionsChange={setHideNodeConnections}"]) expect(page).toContain(callback);
        const toolbar = source("components/canvas/canvas-toolbar.tsx");
        expect(toolbar).toMatch(/joysee-canvas-dock pointer-events-auto[\s\S]+?<FloatingDock items=\{items\}[\s\S]+?joysee-canvas-dock-divider[\s\S]+?\{viewControls\}/);
        expect(toolbar).toContain("getPanelX(rootRef.current, event.currentTarget, width)");
    });

    test("精简顶栏不删除导入、搜索、专注及重命名入口", () => {
        const bar = source("pages/canvas/canvas-project-top-bar.tsx");
        for (const callback of ["onImportLibTV", "onImportTapNow", "onEnterFocusMode", "onOpenSearch", "onStartTitleEditing"]) expect(bar).toContain(callback);
        expect(bar).toContain("<WorkspaceAccountMenu showThemeSwitch={false} />");
        expect(source("components/layout/workspace-account-menu.tsx")).toContain("showThemeSwitch = true");
    });

    test("入口登记主题后重新套用已解析外观，专用样式不影响其他主题", () => {
        const entry = source("application.tsx");
        expect(entry.indexOf('import "@/themes/load"')).toBeLessThan(entry.indexOf("applyThemePackCanvas(useAppearanceStore.getState().appearance.skinId)"));
        expect(entry.indexOf("applyThemePackCanvas(useAppearanceStore.getState().appearance.skinId)")).toBeLessThan(entry.indexOf("createRoot(document"));
        const css = source("themes/joysee-minimal/canvas-editor.css");
        expect(css).toContain(':root[data-skin="joysee-minimal"] .joysee-canvas-editor');
        expect(css).toContain(".joysee-canvas-dock-divider");
    });
});
