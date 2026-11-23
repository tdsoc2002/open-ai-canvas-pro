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
        expect(toolbar).toMatch(/joysee-canvas-dock pointer-events-auto[\s\S]+?<FloatingDock ref=\{dockRef\} items=\{dockItems\}[\s\S]+?joysee-canvas-dock-divider[\s\S]+?\{viewControls\}/);
        expect(toolbar).toContain("getPanelX(rootRef.current, panelAnchor.current, width)");
    });

    test("精简顶栏不删除导入、搜索、专注及重命名入口", () => {
        const bar = source("pages/canvas/canvas-project-top-bar.tsx");
        for (const callback of ["onImportLibTV", "onImportTapNow", "onEnterFocusMode", "onOpenSearch", "onStartTitleEditing"]) expect(bar).toContain(callback);
    });

    test("账户菜单里的主题切换行使用当前画布主题并复用画布外观更新", () => {
        expect(source("pages/canvas/canvas-project-top-bar.tsx")).toContain("<WorkspaceAccountMenu themePreference={{ theme: colorTheme, onChange: onThemeChange }} />");
        expect(source("pages/canvas/project.tsx")).toContain("applyCanvasAppearance(switchCanvasAppearanceTheme(canvasAppearance, theme))");
        const menu = source("components/layout/workspace-account-menu.tsx");
        expect(menu).toContain("themePreference?.theme ?? workspaceTheme");
        expect(menu).toContain("themePreference?.onChange ?? setWorkspaceTheme");
        expect(menu).toContain('<label className="workspace-account-menu-row">');
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
