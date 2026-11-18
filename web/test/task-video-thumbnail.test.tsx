import { expect, test } from "bun:test";
import { Window } from "happy-dom";

test("任务视频封面失效时，仅在进入视口后回退到静止首帧，视频失效时保留占位", async () => {
    const dom = new Window({ url: "http://fixture.invalid/", settings: { disableJavaScriptEvaluation: true } });
    let enterViewport: (() => void) | undefined;
    const globals = {
        window: dom,
        document: dom.document,
        IS_REACT_ACT_ENVIRONMENT: true,
        IntersectionObserver: class {
            constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
                enterViewport = () => callback([{ isIntersecting: true }]);
            }
            observe() {}
            disconnect() {}
        },
    };
    const original = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    // 模拟允许原生显示，但不允许跨域画布取帧的媒体。
    dom.HTMLVideoElement.prototype.load = function () {
        if (this.crossOrigin === "anonymous" && this.hasAttribute("src")) this.dispatchEvent(new dom.Event("error"));
    };
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { TaskVideoThumbnail } = await import("@/pages/tasks/task-video-thumbnail");
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    const src = "http://storage.invalid/clip.mp4";

    try {
        await act(() => root.render(<TaskVideoThumbnail src={src} posterUrl="/missing-cover.jpg" />));
        expect(host.querySelector("img")?.getAttribute("src")).toBe("/missing-cover.jpg");
        expect(host.querySelector("video")).toBeNull();
        await act(() => {
            host.querySelector("img")!.dispatchEvent(new dom.Event("error"));
        });
        expect(host.querySelector("video")).toBeNull();
        expect(enterViewport).toBeDefined();
        await act(() => enterViewport?.());
        const video = host.querySelector("video")!;
        expect(video?.getAttribute("src")).toBe(src);
        expect(video?.hasAttribute("crossorigin")).toBe(false);
        expect(video?.hasAttribute("autoplay")).toBe(false);
        expect(video?.hasAttribute("controls")).toBe(false);
        expect(host.querySelector(".task-center-video-placeholder")).not.toBeNull();
        Object.defineProperty(video, "videoWidth", { value: 160 });
        await act(() => {
            video.dispatchEvent(new dom.Event("loadeddata"));
        });
        expect(video.getAttribute("data-ready")).toBe("true");
        expect(host.querySelector(".task-center-video-placeholder")).toBeNull();
        await act(() => {
            video.dispatchEvent(new dom.Event("error"));
        });
        expect(host.querySelector("video")).toBeNull();
        expect(host.querySelector(".task-center-video-placeholder")).not.toBeNull();
    } finally {
        await act(() => root.unmount());
        await dom.happyDOM.abort();
        for (const [key, descriptor] of original) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
