import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasVideoFrameKey } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/video-frames" });
for (const name of ["document", "navigator", "localStorage", "HTMLElement", "HTMLTextAreaElement", "SVGElement", "Element", "ShadowRoot", "Node", "NodeFilter", "MutationObserver", "ResizeObserver", "Event", "CustomEvent"] as const) {
    Object.defineProperty(globalThis, name, { value: dom[name], configurable: true, writable: true });
}
Object.assign(globalThis, {
    window: dom,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
});

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const { CanvasNodePromptPanel } = await import("@/components/canvas/canvas-node-prompt-panel");
const { CanvasVideoPromptTools } = await import("@/components/canvas/canvas-video-prompt-tools");
const { buildCanvasNodeMentionReferenceMap } = await import("@/lib/canvas/canvas-resource-references");
const { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { translate } = await import("@/i18n");
const { CanvasNodeType } = await import("@/types/canvas");

afterAll(() => dom.happyDOM.abort());

function mountPromptPanel() {
    const model = "seedance-2.0";
    const channel = createModelChannel({ id: "video-frames", interfaceType: "volcengine-ark-video", models: [model] });
    useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], videoModel: encodeChannelModel(channel.id, model) } });
    useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true, creditsEnabled: false } }));
    const target: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { videoReferenceMode: "frames", prompt: "镜头拉远" } };
    const image: CanvasNodeData = { ...target, id: "start", type: CanvasNodeType.Image, title: "山景", metadata: { content: "/start.png" } };
    const uploadTargets: Array<CanvasVideoFrameKey | undefined> = [];
    const noop = () => {};
    function Panel({ connected, frames, isRunning }: { connected: boolean; frames: boolean; isRunning: boolean }) {
        const [metadata, setMetadata] = useState(target.metadata);
        const node: CanvasNodeData = { ...target, metadata: { ...metadata, videoReferenceMode: frames ? "frames" : "text" } };
        const references = connected ? buildCanvasNodeMentionReferenceMap([image, node], [{ id: "ref", fromNodeId: image.id, toNodeId: node.id }]).get(node.id) : undefined;
        return (
            <CanvasNodePromptPanel
                projectId="video-frames"
                node={node}
                isRunning={isRunning}
                mentionReferences={references}
                onPromptChange={noop}
                onConfigChange={(_nodeId, patch) => setMetadata((current) => ({ ...current, ...patch }))}
                onGenerate={noop}
                onUploadVideoReference={async (_nodeId, _file, frame) => {
                    uploadTargets.push(frame);
                }}
            />
        );
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const render = (connected: boolean, frames = true, isRunning = false) =>
        act(async () =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <App>
                        <Panel connected={connected} frames={frames} isRunning={isRunning} />
                    </App>
                </QueryClientProvider>,
            ),
        );
    return {
        container,
        render,
        uploadTargets,
        dispose: async () => {
            await act(async () => root.unmount());
            queryClient.clear();
            container.remove();
        },
    };
}

test("首尾帧标签位于提示词上方的卡片顶部，可点击卡片选取连线图片或上传", async () => {
    const { container, render, uploadTargets, dispose } = mountPromptPanel();
    const firstFrame = translate("canvasC.videoPromptTools.startFrame");
    const lastFrame = translate("canvasC.videoPromptTools.endFrame");
    try {
        await render(false);
        const composer = container.querySelector(".canvas-node-composer")!;
        const shelf = composer.querySelector(".canvas-node-composer-editor .canvas-node-composer-references")!;
        const first = shelf.querySelector<HTMLButtonElement>(`button[title="${firstFrame}"]`)!;
        const last = shelf.querySelector<HTMLButtonElement>(`button[title="${lastFrame}"]`)!;
        expect(first.previousElementSibling?.textContent).toBe(firstFrame);
        expect(last.previousElementSibling?.textContent).toBe(lastFrame);
        expect(composer.textContent).not.toContain("请选择首帧图片");
        expect(composer.querySelector<HTMLButtonElement>(".canvas-node-generate-button")?.disabled).toBe(true);

        await act(async () => last.click());
        const uploadLabel = translate("canvasPage.batchReferences.uploadLabel");
        const upload = [...document.querySelectorAll("button")].find((button) => !composer.contains(button) && button.textContent === uploadLabel)!;
        expect(document.activeElement === upload).toBe(true);
        await act(async () => upload.click());
        const input = composer.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
        Object.defineProperty(input, "files", { value: [new dom.File(["image"], "end.png", { type: "image/png" })] });
        await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
        expect(uploadTargets).toEqual(["videoEndFrameNodeId"]);

        await render(true);
        await act(async () => first.click());
        const startImage = [...document.querySelectorAll("button")].find((button) => button.textContent?.endsWith(" · 山景"))!;
        await act(async () => startImage.click());
        expect(first.getAttribute("aria-label")).toContain(firstFrame);
        expect(first.querySelector("img")?.getAttribute("src")).toBe("/start.png");
        expect(shelf.querySelector('[data-reference-node-id="start"]')).toBeNull();
        expect(document.activeElement === first).toBe(true);

        await render(true, false);
        expect(composer.querySelector(`button[title="${firstFrame}"]`)).toBeNull();
        expect(composer.querySelector(`button[title="${lastFrame}"]`)).toBeNull();
        expect(composer.querySelector('[data-reference-node-id="start"]')).not.toBeNull();
    } finally {
        await dispose();
    }
});

test("连上参考图时默认全能参考并禁用文生，断开后恢复文生", async () => {
    const { container, render, dispose } = mountPromptPanel();
    const textMode = translate("canvasC.videoPromptTools.textMode");
    const allMode = translate("canvasC.videoPromptTools.allMode");
    try {
        await render(false, false);
        const modeControl = container.querySelector(".canvas-video-reference-mode")!;
        expect(modeControl.textContent).toContain(textMode);
        await render(true, false);
        expect(modeControl.textContent).toContain(allMode);

        const input = modeControl.querySelector('[role="combobox"]')!;
        await act(async () => input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true })));
        const textOption = [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.trim() === textMode);
        expect(textOption?.getAttribute("aria-disabled")).toBe("true");
        await render(false, false);
        expect(modeControl.textContent).toContain(textMode);
    } finally {
        await dispose();
    }
});

test("生成中的文生视频可展开查看模式，其他模式不可选", async () => {
    const { container, render, dispose } = mountPromptPanel();
    try {
        await render(false, false, true);
        const control = container.querySelector(".canvas-video-reference-mode")!;
        const input = control.querySelector('[role="combobox"]')!;
        await act(async () => control.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
        expect(input.getAttribute("aria-expanded")).toBe("true");
        const options = [...document.querySelectorAll('[role="option"]')];
        const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
        expect(selected?.textContent?.trim()).toBe(translate("canvasC.videoPromptTools.textMode"));
        expect(selected?.getAttribute("aria-disabled")).toBe("false");
        const alternatives = options.filter((option) => option !== selected);
        expect(alternatives.map((option) => option.getAttribute("aria-disabled"))).toEqual(["true", "true"]);
    } finally {
        await dispose();
    }
});

test.each([
    { name: "尾帧为空时移动缩略图", endFrame: undefined },
    { name: "尾帧已有图片时交换两张图", endFrame: "end" },
])("$name", async ({ endFrame }) => {
    const frameOptions = [
        { nodeId: "start", label: "图片1", title: "山景", previewUrl: "/start.png" },
        { nodeId: "end", label: "图片2", title: "海景", previewUrl: "/end.png" },
    ];
    function Frames() {
        const [metadata, setMetadata] = useState<CanvasNodeMetadata>({ videoStartFrameNodeId: "start", videoEndFrameNodeId: endFrame });
        return <CanvasVideoPromptTools thumbnailSlots frameOptions={frameOptions} metadata={metadata} onMetadataChange={(patch) => setMetadata((current) => ({ ...current, ...patch }))} />;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(<Frames />));
        const first = container.querySelector<HTMLButtonElement>(`button[title="${translate("canvasC.videoPromptTools.startFrame")}"]`)!;
        const last = container.querySelector<HTMLButtonElement>(`button[title="${translate("canvasC.videoPromptTools.endFrame")}"]`)!;
        const dataTransfer = new dom.DataTransfer();
        function dragEvent(target: Element, type: string) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
            return target.dispatchEvent(event);
        }

        expect(first.closest("[draggable='true']")).not.toBeNull();
        await act(async () => dragEvent(first.querySelector("img")!, "dragstart"));
        expect(dragEvent(first, "dragover")).toBe(true);
        expect(dragEvent(last, "dragover")).toBe(false);
        await act(async () => dragEvent(last, "drop"));

        expect(first.querySelector("img")?.getAttribute("src") ?? null).toBe(endFrame ? "/end.png" : null);
        expect(last.querySelector("img")?.getAttribute("src")).toBe("/start.png");
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
