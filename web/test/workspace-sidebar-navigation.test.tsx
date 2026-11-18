import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import "@/i18n";
import "@/themes/joysee-minimal";
import { WorkspaceSidebarNav } from "@/components/layout/workspace-sidebar-nav";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { JOYSEE_MINIMAL_SKIN } from "@/themes/joysee-minimal/skin";

function renderSidebar(path: string, collapsed: boolean, generationEnabled: boolean, joysee = true) {
    const initialState = useUserStore.getInitialState();
    const { features } = initialState;
    const initialAppearance = useAppearanceStore.getInitialState();
    const { appearance } = initialAppearance;
    initialState.features = { ...features, imageWorkbenchEnabled: generationEnabled, videoWorkbenchEnabled: generationEnabled, pluginCenterEnabled: true };
    if (joysee) initialAppearance.appearance = { ...appearance, skinId: JOYSEE_MINIMAL_SKIN.id, activeSkin: JOYSEE_MINIMAL_SKIN };
    try {
        const { document } = new Window();
        document.body.innerHTML = renderToStaticMarkup(
            <MemoryRouter initialEntries={[path]}>
                <WorkspaceSidebarNav collapsed={collapsed} onNavigate={() => {}} onOpenSearch={() => {}} onExpand={() => {}} onCollapse={() => {}} />
            </MemoryRouter>,
        );
        return document;
    } finally {
        initialState.features = features;
        initialAppearance.appearance = appearance;
    }
}

test("创作、生成、内容和资源各自成组，当前链接标记为当前页", () => {
    const document = renderSidebar("/toolbox/video", false, true);
    const groups = [...document.querySelectorAll(".app-workspace-nav-group")];
    expect(groups.map((group) => group.getAttribute("data-nav-group-heading"))).toEqual(["创作空间", "生成工具", "我的内容", "创作资源"]);
    const ids = groups.map((group) => [...group.querySelectorAll("[data-nav-id]")].map((item) => item.getAttribute("data-nav-id")));
    expect(ids).toEqual([
        ["home", "projects", "canvas"],
        ["toolbox-image", "toolbox-video"],
        ["assets", "tasks"],
        ["skills", "inspirations"],
    ]);
    expect(document.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/toolbox/video");
});

test("经典皮肤保留创作区素材入口，灵感页仍可从导航进入", () => {
    const document = renderSidebar("/", false, true, false);
    const groups = [...document.querySelectorAll(".app-workspace-nav-group")];
    expect(groups[0]?.querySelector('[data-nav-id="assets"]')?.getAttribute("href")).toBe("/assets");
    expect(document.querySelector('[data-nav-id="inspirations"]')?.getAttribute("href")).toBe("/inspirations");
    expect(document.querySelector('[data-nav-id="plugins"]')).toBeNull();
});

test("禁用生成工具时没有空分组，客态收起后仍可展开及访问完整名称", () => {
    const document = renderSidebar("/", true, false);
    expect(document.querySelectorAll(".app-workspace-nav-group")).toHaveLength(3);
    expect(document.querySelector('[data-nav-id="plugins"]')).toBeNull();
    expect(document.querySelector('[data-nav-id="toolbox-image"]')).toBeNull();
    expect(document.querySelector('[data-nav-id="canvas"]')?.getAttribute("aria-label")).toBe("自由画布");
    expect(document.querySelector(".app-workspace-sidebar-brand-row .app-workspace-sidebar-collapse-toggle")?.getAttribute("aria-expanded")).toBe("false");
});

test("游客侧栏在展开和收起时都不显示底部账户入口", () => {
    for (const collapsed of [false, true]) {
        const document = renderSidebar("/", collapsed, false);
        expect(document.querySelectorAll(".app-workspace-sidebar-footer")).toHaveLength(0);
    }
});
