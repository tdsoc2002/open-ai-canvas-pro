import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "@/i18n";
import "@/themes/joysee-minimal";
import { WorkspaceSidebarNav } from "@/components/layout/workspace-sidebar-nav";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { JOYSEE_MINIMAL_SKIN } from "@/themes/joysee-minimal/skin";

function renderSidebar(path: string, collapsed: boolean, generationEnabled: boolean, joysee = true, signedIn = false) {
    const initialState = useUserStore.getInitialState();
    const { features, hydrated, user } = initialState;
    const initialAppearance = useAppearanceStore.getInitialState();
    const { appearance } = initialAppearance;
    initialState.features = { ...features, imageWorkbenchEnabled: generationEnabled, videoWorkbenchEnabled: generationEnabled, pluginCenterEnabled: true, teamsEnabled: false };
    initialState.hydrated = true;
    initialState.user = signedIn ? { id: "sidebar-user", username: "sidebar-user", displayName: "侧栏用户", role: "user", status: "active" } : null;
    if (joysee) initialAppearance.appearance = { ...appearance, skinId: JOYSEE_MINIMAL_SKIN.id, activeSkin: JOYSEE_MINIMAL_SKIN };
    const dom = new Window({ url: "https://site.example.com/" });
    const globals = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries({
        window: dom,
        document: dom.document,
        Element: dom.Element,
        HTMLElement: dom.HTMLElement,
        Node: dom.Node,
        getComputedStyle: dom.getComputedStyle.bind(dom),
    })) {
        globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    const queryClient = new QueryClient();
    try {
        const { document } = dom;
        document.body.innerHTML = renderToStaticMarkup(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[path]}>
                    <WorkspaceSidebarNav collapsed={collapsed} onNavigate={() => {}} onOpenSearch={() => {}} onExpand={() => {}} onCollapse={() => {}} />
                </MemoryRouter>
            </QueryClientProvider>,
        );
        return document;
    } finally {
        initialState.features = features;
        initialState.hydrated = hydrated;
        initialState.user = user;
        initialAppearance.appearance = appearance;
        queryClient.clear();
        for (const [name, descriptor] of globals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
}

test("乐见侧栏按约定的三组和入口顺序展示，路由和当前页标记不变", () => {
    const document = renderSidebar("/toolbox/video", false, true, true, true);
    const groups = [...document.querySelectorAll(".app-workspace-nav-group")];
    expect(groups.map((group) => group.getAttribute("data-nav-group-heading"))).toEqual(["创作", "生成", "资源"]);
    const links = groups.map((group) => [...group.querySelectorAll("a[data-nav-id]")].map((item) => [item.textContent, item.getAttribute("href")]));
    expect(links).toEqual([
        [
            ["工作台", "/"],
            ["画布库", "/canvas"],
            ["短剧项目", "/projects"],
        ],
        [
            ["图片生成", "/toolbox/image"],
            ["视频生成", "/toolbox/video"],
            ["生成记录", "/tasks"],
        ],
        [
            ["素材库", "/assets"],
            ["灵感库", "/inspirations"],
            ["技能库", "/skills"],
        ],
    ]);
    expect(document.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/toolbox/video");
});

test("展开侧栏时分组标题不是按钮，仅保留整栏收起按钮", () => {
    const document = renderSidebar("/", false, true);
    const groups = [...document.querySelectorAll(".app-workspace-nav-group")];
    expect(groups.map((group) => group.querySelector("h2")?.textContent)).toEqual(["创作", "生成", "资源"]);
    const toggles = [...document.querySelectorAll("button[aria-expanded]")];
    expect(toggles).toHaveLength(1);
    expect(toggles[0]?.classList.contains("app-workspace-sidebar-collapse-toggle")).toBe(true);
    expect(toggles[0]?.getAttribute("aria-expanded")).toBe("true");
});

test("禁用图片与视频生成时仍显示生成记录，客态收起后可展开及访问完整名称", () => {
    const document = renderSidebar("/", true, false);
    expect(document.querySelectorAll(".app-workspace-nav-group")).toHaveLength(3);
    expect(document.querySelector('[data-nav-id="plugins"]')).toBeNull();
    expect(document.querySelector('[data-nav-id="toolbox-image"]')).toBeNull();
    expect(document.querySelector('[data-nav-group-heading="生成"] [data-nav-id="tasks"]')?.getAttribute("href")).toBe("/tasks");
    expect(document.querySelector('[data-nav-id="canvas"]')?.getAttribute("aria-label")).toBe("画布库");
    expect(document.querySelector(".app-workspace-nav-group h2")).toBeNull();
    expect(document.querySelector(".app-workspace-sidebar-brand-row .app-workspace-sidebar-collapse-toggle")?.getAttribute("aria-expanded")).toBe("false");
});

test("游客侧栏在展开和收起时都不显示底部账户入口", () => {
    for (const collapsed of [false, true]) {
        const document = renderSidebar("/", collapsed, false);
        expect(document.querySelectorAll(".app-workspace-sidebar-footer")).toHaveLength(0);
        expect(document.querySelector('[data-nav-id="skills"]')).toBeNull();
    }
});
