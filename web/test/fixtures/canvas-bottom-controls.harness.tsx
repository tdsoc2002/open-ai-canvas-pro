import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";

const dom = new Window({ url: "http://localhost/" });
const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
    elements = new Set<Element>();
    constructor(readonly callback: () => void) {
        observers.add(this);
    }
    observe(element: Element) {
        this.elements.add(element);
    }
    unobserve(element: Element) {
        this.elements.delete(element);
    }
    disconnect() {
        this.elements.clear();
        observers.delete(this);
    }
}
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement,
    ShadowRoot: dom.ShadowRoot,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: TestResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasZoomControls } = await import("../../src/components/canvas/canvas-zoom-controls");
const { CanvasAgentHud } = await import("../../src/components/canvas/canvas-agent-hud");
const { CanvasToolbar } = await import("../../src/components/canvas/canvas-toolbar");
const { clearToolbarPrefs, defaultToolbarPrefs, persistToolbarPrefs } = await import("../../src/lib/canvas/tool-registry");
afterAll(() => dom.happyDOM.abort());

// happy-dom does not compile Tailwind; supply the inset used by the measured layout.
const insetStyle = document.createElement("style");
insetStyle.textContent = ".canvas-main-toolbar { left: 12px; }";
document.head.append(insetStyle);

const noop = () => {};
const rect = (left: number, top: number, width: number, height: number) => new dom.DOMRect(left, top, width, height);

test("真实缩放组件按完整外壳避让，变宽后换行，收窄后回到同排", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let controlsWidth = 400;
    const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
    const originalOffsetParent = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "offsetParent");
    dom.HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.tagName === "MAIN") return rect(0, 0, 1000, 800);
        if (this.classList.contains("canvas-workspace-zoom-controls")) return rect(20, 720, controlsWidth, 32);
        if (this.classList.contains("canvas-main-toolbar")) return rect(0, 740, 1000, 44);
        if (this.parentElement?.classList.contains("canvas-main-toolbar")) return rect(300, 740, 400, 44);
        if (this.parentElement?.classList.contains("canvas-workspace-zoom-controls")) return rect(20, 720, controlsWidth, 28);
        return originalRect.call(this);
    };
    Object.defineProperty(dom.HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get() {
            return this.closest("main");
        },
    });
    try {
        await act(async () =>
            root.render(
                <main>
                    <div className="canvas-main-toolbar" style={{ left: 16 }}>
                        <div className="canvas-floating-dock" />
                    </div>
                    <div className="canvas-workspace-zoom-controls">
                        <CanvasZoomControls scale={1} onScaleChange={noop} onFitContent={noop} isMiniMapOpen={false} onToggleMiniMap={noop} onOpenShortcuts={noop} />
                        <CanvasAgentHud nodeCount={3} connectionCount={2} followAgent={false} onFollowAgentChange={noop} />
                    </div>
                </main>,
            ),
        );
        const shell = host.querySelector<HTMLElement>(".canvas-workspace-zoom-controls")!;
        const toolbar = host.querySelector<HTMLElement>(".canvas-main-toolbar")!;
        expect(shell.querySelector(".canvas-agent-hud")).not.toBeNull();
        expect(shell.querySelector('button[aria-label="缩小画布"]')).not.toBeNull();
        expect(shell.querySelector('button[aria-label="放大画布"]')).not.toBeNull();
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("136px");
        expect(300 + 136).toBeGreaterThanOrEqual(20 + controlsWidth + 16);
        expect(shell.style.bottom).toBe("22px");
        const observer = [...observers].find((item) => item.elements.has(shell));
        expect(observer).toBeDefined();

        controlsWidth = 600;
        await act(async () => observer!.callback());
        expect(shell.style.bottom).toBe("76px");
        expect(shell.dataset.bottomLayout).toBe("stacked");
        expect(shell.style.maxWidth).toBe("980px");
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-max-width")).toBe("980px");

        controlsWidth = 300;
        await act(async () => observer!.callback());
        expect(shell.style.bottom).toBe("22px");
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("36px");
        await act(async () => root.unmount());
        expect(observer!.elements.size).toBe(0);
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("");
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-max-width")).toBe("");
        expect(shell.style.maxWidth).toBe("");
        expect(shell.style.bottom).toBe("");
    } finally {
        await act(async () => root.unmount());
        dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
        if (originalOffsetParent) Object.defineProperty(dom.HTMLElement.prototype, "offsetParent", originalOffsetParent);
        else Reflect.deleteProperty(dom.HTMLElement.prototype, "offsetParent");
        host.remove();
    }
});

test("内嵌视图控件不启动独立工具条避让，缩放和视图命令仍可用", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let zoom = 1;
    let fitCount = 0;
    let hideConnections = false;
    try {
        await act(async () =>
            root.render(
                <main>
                    <div className="canvas-workspace-zoom-controls">
                        <div className="canvas-main-toolbar">
                            <div className="canvas-floating-dock joysee-canvas-dock">
                                <CanvasZoomControls
                                    embedded
                                    scale={1}
                                    onScaleChange={(scale) => (zoom = scale)}
                                    onFitContent={() => fitCount++}
                                    onHideNodeConnectionsChange={(value) => (hideConnections = value)}
                                    isMiniMapOpen={false}
                                    onToggleMiniMap={noop}
                                    onOpenShortcuts={noop}
                                />
                            </div>
                        </div>
                    </div>
                </main>,
            ),
        );
        expect(observers.size).toBe(0);
        const click = async (label: string) => {
            const button = host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`);
            expect(button).not.toBeNull();
            await act(async () => button!.click());
        };
        expect(host.querySelector('button[aria-label="缩小画布"], button[aria-label="放大画布"]')).toBeNull();
        await click("精确缩放");
        expect(host.querySelector('button[aria-label="精确缩放"]')?.getAttribute("aria-expanded")).toBe("true");
        const half = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "50%");
        expect(half).toBeDefined();
        await act(async () => half!.click());
        await click("适应画布");
        await click("设置隐藏节点连线");
        expect(zoom).toBe(0.5);
        expect(fitCount).toBe(1);
        expect(hideConnections).toBe(true);
        expect(host.querySelector<HTMLInputElement>('input[aria-label="精确缩放画布"]')?.value).toBe("50");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
