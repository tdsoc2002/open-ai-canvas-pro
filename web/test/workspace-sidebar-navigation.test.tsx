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

test("左栏按约定的四组和入口顺序展示，路由和当前页标记不变", () => {
    const document = renderSidebar("/toolbox/video", false, true);
    const groups = [...document.querySelectorAll(".app-workspace-nav-group")];
    expect(groups.map((group) => group.getAttribute("data-nav-group-heading"))).toEqual(["创作", "生成工具", "任务与素材", "灵感与技能"]);
    const links = groups.map((group) => [...group.querySelectorAll("a[data-nav-id]")].map((item) => [item.textContent, item.getAttribute("href")]));
    expect(links).toEqual([
        [
            ["首页", "/"],
            ["画布", "/canvas"],
            ["短剧项目", "/projects"],
        ],
        [
            ["图片生成", "/toolbox/image"],
            ["视频生成", "/toolbox/video"],
        ],
        [
            ["生成任务", "/tasks"],
            ["素材库", "/assets"],
        ],
        [
            ["灵感库", "/inspirations"],
            ["技能库", "/skills"],
        ],
    ]);
    expect(document.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/toolbox/video");
});

test("展开侧栏时分组标题不是按钮，仅保留整栏收起按钮", () => {
    const document = renderSidebar("/", false, true);
    const groups = [...document.querySelectorAll(".app-workspace-nav-group")];
    expect(groups.map((group) => group.querySelector("h2")?.textContent)).toEqual(["创作", "生成工具", "任务与素材", "灵感与技能"]);
    const toggles = [...document.querySelectorAll("button[aria-expanded]")];
    expect(toggles).toHaveLength(1);
    expect(toggles[0]?.classList.contains("app-workspace-sidebar-collapse-toggle")).toBe(true);
    expect(toggles[0]?.getAttribute("aria-expanded")).toBe("true");
});

test("禁用生成工具时没有空分组，客态收起后仍可展开及访问完整名称", () => {
    const document = renderSidebar("/", true, false);
    expect(document.querySelectorAll(".app-workspace-nav-group")).toHaveLength(3);
    expect(document.querySelector('[data-nav-id="plugins"]')).toBeNull();
    expect(document.querySelector('[data-nav-id="toolbox-image"]')).toBeNull();
    expect(document.querySelector('[data-nav-id="canvas"]')?.getAttribute("aria-label")).toBe("画布");
    expect(document.querySelector(".app-workspace-nav-group h2")).toBeNull();
    expect(document.querySelector(".app-workspace-sidebar-brand-row .app-workspace-sidebar-collapse-toggle")?.getAttribute("aria-expanded")).toBe("false");
});

test("游客侧栏在展开和收起时都不显示底部账户入口", () => {
    for (const collapsed of [false, true]) {
        const document = renderSidebar("/", collapsed, false);
        expect(document.querySelectorAll(".app-workspace-sidebar-footer")).toHaveLength(0);
    }
});
