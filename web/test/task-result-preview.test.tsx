import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { GenerationTask } from "@/services/api/task-center";

const task: GenerationTask = {
    id: "result-preview-test",
    type: "canvas_audio",
    prompt: "不要显示这个提示词",
    status: "succeeded",
    attempts: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
};

test("真实详情预览组件：音频控件、多结果切换、停播、失败与文本正文", async () => {
    const dom = new Window({ url: "http://fixture.invalid/" });
    const globals = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true };
    const original = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { TaskResultPreview } = await import("@/pages/tasks/task-result-preview");
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    const render = (kind: "audio" | "text", data: Partial<GenerationTask> = {}) => act(() => root.render(<TaskResultPreview key={kind} task={{ ...task, ...data }} kind={kind} title={task.prompt} loading={false} onPreview={() => {}} />));

    try {
        const first = "data:audio/wav;base64,AAAA";
        const second = "data:audio/wav;base64,AAAB";
        await render("audio", { resultJson: JSON.stringify({ audios: [first, second] }) });
        expect(host.querySelectorAll("audio")).toHaveLength(1);
        const player = host.querySelector("audio")!;
        expect(player.hasAttribute("controls")).toBe(true);
        expect(player.hasAttribute("autoplay")).toBe(false);
        expect(player.getAttribute("preload")).toBe("metadata");
        expect(player.getAttribute("controlslist")).toBe("nodownload");
        expect(player.getAttribute("src")).toBe(first);
        let paused = false;
        Object.defineProperty(player, "paused", { value: false });
        Object.defineProperty(player, "pause", {
            value: () => {
                paused = true;
            },
        });

        await act(() => host.querySelectorAll("button")[1].click());
        expect(paused).toBe(true);
        expect(host.querySelectorAll("audio")).toHaveLength(1);
        const next = host.querySelector("audio")!;
        expect(next.getAttribute("src")).toBe(second);
        expect(host.querySelectorAll("button")[1].getAttribute("aria-pressed")).toBe("true");

        await act(() => {
            next.dispatchEvent(new dom.Event("error"));
        });
        expect(host.querySelector("audio")).toBeNull();
        expect(host.querySelector('[role="status"]')?.textContent).toBe("这段音频暂时无法播放");
        await render("audio");
        expect(host.textContent).toContain("没有可播放的音频结果");

        await render("text", { type: "canvas_text", resultJson: '{"text":"第一行\\n<img src=x onerror=y>","reasoning":"不要显示这个推理"}' });
        const reader = host.querySelector(".task-detail-text-result");
        expect(reader?.getAttribute("tabindex")).toBe("0");
        expect(reader?.querySelector("pre")?.textContent).toBe("第一行\n<img src=x onerror=y>");
        expect(reader?.querySelector("img")).toBeNull();
        expect(reader?.textContent).not.toContain("不要显示");
        await render("text", { type: "canvas_text" });
        expect(host.textContent).toContain("暂无文本正文");
    } finally {
        await act(() => root.unmount());
        await dom.happyDOM.abort();
        for (const [key, descriptor] of original) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
