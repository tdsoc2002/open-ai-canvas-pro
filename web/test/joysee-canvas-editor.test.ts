import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("乐见真实画布编辑器组件合同", () => {
    test("只在乐见分支合并真实编辑与视图工具，保留默认工具布局", () => {
        const page = source("pages/canvas/project.tsx");
        expect(page).toContain('useThemePack()?.workspaceStyle === "joysee"');
        expect(page).toContain("viewControls={joyseeEditor && !focusMode ? canvasViewControls : undefined}");
        expect(page).toMatch(/!focusMode && !joyseeEditor[\s\S]+?\{canvasViewControls\}\s*<\/CanvasOverlayLayerContainer>/);
        expect(page).not.toContain("CanvasAgentHud");
        for (const callback of ["onScaleChange={setZoomScale}", "onFitContent={fitCanvasContent}", "onHideNodeConnectionsChange={setHideNodeConnections}"]) expect(page).toContain(callback);
        expect(source("components/canvas/canvas-zoom-controls.tsx")).toContain("if (embedded) return;");
        expect(source("components/canvas/canvas-toolbar.tsx")).toContain("getPanelX(rootRef.current, event.currentTarget, width)");
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
