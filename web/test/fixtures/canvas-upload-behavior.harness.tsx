import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    IntersectionObserver: dom.IntersectionObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
        src = "";
        naturalWidth = 800;
        naturalHeight = 600;
        async decode() {}
    },
});
const createElement = document.createElement.bind(document);
document.createElement = ((name: string, options?: ElementCreationOptions) => {
    const element = createElement(name, options);
    if (name === "video") {
        Object.defineProperties(element, { videoWidth: { value: 800 }, videoHeight: { value: 600 } });
        queueMicrotask(() => element.dispatchEvent(new dom.Event("loadedmetadata")));
    }
    return element;
}) as typeof document.createElement;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const antd = await import("antd");
const imageStorage = await import("@/services/image-storage");
const fileStorage = await import("@/services/file-storage");
const resources = await import("@/services/api/resources");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CanvasNodeType } = await import("@/types/canvas");
const { canvasNodeToAsset } = await import("@/lib/canvas/canvas-node-asset");
const silent = () => {};
const persisted: CanvasNodeData[] = [];
const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: unknown) => void }>();
let deferUploads = false;
let failure: Error | undefined;
const upload = async (input: File) => {
    if (deferUploads) return new Promise<any>((resolve, reject) => pending.set(input.name, { resolve, reject }));
    if (failure) throw failure;
    return uploaded(input.name);
};
function uploaded(name: string) {
    return { url: `/api/resources/${encodeURIComponent(name)}/file`, storageKey: `resource:${name}`, width: 800, height: 600, bytes: 20, mimeType: "image/png" };
}
mock.module("antd", () => ({ ...antd, App: { ...antd.App, useApp: () => ({ message: { info: silent, error: silent, warning: silent, success: silent } }) } }));
mock.module("@/components/canvas/canvas-asset-tray", () => ({ CANVAS_IMAGE_ASSET_DND_TYPE: "canvas-asset" }));
mock.module("@/services/image-storage", () => ({ ...imageStorage, uploadImage: upload }));
mock.module("@/services/file-storage", () => ({ ...fileStorage, uploadMediaFile: upload }));
mock.module("@/services/api/resources", () => ({
    ...resources,
    uploadResourceFile: async (file: File) => {
        await upload(file);
        return { id: file.name };
    },
}));
mock.module("@/services/project-asset-sync", () => ({
    ensureCanvasNodeAsset: async ({ node }: { node: CanvasNodeData }) => {
        persisted.push(node);
        return { assetId: `asset:${node.id}`, syncPending: false };
    },
}));
const { useCanvasUpload } = await import("@/pages/canvas/use-canvas-upload");
const { useCanvasSelectionController } = await import("@/pages/canvas/use-canvas-selection-controller");
const { CanvasNode } = await import("@/components/canvas/canvas-node");
const { assetPickerItemsToInsertPayloads } = await import("@/components/canvas/asset-picker-modal");
let api: ReturnType<typeof useCanvasUpload>;
const nodesRef = { current: [] as CanvasNodeData[] };
const setNodes = (action: React.SetStateAction<CanvasNodeData[]>) => {
    nodesRef.current = typeof action === "function" ? action(nodesRef.current) : action;
};
function Harness() {
    api = useCanvasUpload({
        canvasId: "canvas",
        nodesRef,
        selectedNodeIdsRef: { current: new Set() },
        getCanvasCenter: () => ({ x: 0, y: 0 }),
        screenToCanvas: () => ({ x: 0, y: 0 }),
        setNodes,
        setSelectedNodeIds: silent,
        setSelectedConnectionId: silent,
        setContextMenu: silent,
        setDialogNodeId: silent,
    });
    return null;
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
beforeEach(async () => {
    setActiveUserScope("upload-behavior-test");
    nodesRef.current = [];
    persisted.length = 0;
    pending.clear();
    deferUploads = false;
    failure = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
        root!.render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <Harness />
            </QueryClientProvider>,
        ),
    );
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    container.remove();
});
afterAll(() => {
    mock.restore();
    dom.happyDOM.abort();
});
const options = { quiet: { nodeId: "upload" } };

test("audio upload display names omit the extension while all media retain the entire filename in metadata", async () => {
    for (const [name, type, title] of [
        ["镜头参考_非常长的原始文件名_包含空格 与多个.版本.v12.PNG", "image/png", "镜头参考_非常长的原始文件名_包含空格 与多个.版本.v12.PNG"],
        ["镜头原片.v2.mp4", "video/mp4", "镜头原片.v2.mp4"],
        ["配音.final.wav", "audio/wav", "配音.final"],
        ["剧情梗概.v2.md", "text/markdown", "剧情梗概.v2.md"],
    ]) {
        let id: string | null = null;
        await act(async () => {
            id = await api.createFileNode(new File(["actual script text"], name, { type }), { x: 0, y: 0 }, undefined, { quiet: { nodeId: name } });
        });
        const result = nodesRef.current.find((node) => node.id === id)!;
        expect(result.title).toBe(title);
        expect(result.metadata?.originalFileName).toBe(name);
        expect(result.metadata?.fileUpload).toBeUndefined();
        const asset = canvasNodeToAsset(result, { canvasId: "canvas", source: "canvas-upload" })!;
        expect(asset.title).toBe(title);
        expect(asset.metadata?.originalFileName).toBe(name);
    }
});

test("concurrent uploads complete in either order without crossing names or identities", async () => {
    deferUploads = true;
    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    await act(async () => {
        first = api.createFileNode(new File(["one"], "one.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, { quiet: { nodeId: "one" } });
        second = api.createFileNode(new File(["two"], "two.md", { type: "text/markdown" }), { x: 10, y: 0 }, undefined, { quiet: { nodeId: "two" } });
    });
    await act(async () => {
        pending.get("two.md")!.resolve(uploaded("two.md"));
        await second;
    });
    expect(nodesRef.current.find((node) => node.id === "one")?.metadata?.fileUpload).toBe("uploading");
    await act(async () => {
        pending.get("one.md")!.resolve(uploaded("one.md"));
        await first;
    });
    expect(nodesRef.current.map((node) => [node.id, node.title, node.metadata?.originalFileName])).toEqual([
        ["one", "one.md", "one.md"],
        ["two", "two.md", "two.md"],
    ]);
});

test("removing the placeholder cancels insertion when the upload later completes", async () => {
    deferUploads = true;
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["text"], "cancel.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, options);
    });
    nodesRef.current = [];
    let id: string | null = "unexpected";
    await act(async () => {
        pending.get("cancel.md")!.resolve(uploaded("cancel.md"));
        id = await task;
    });
    expect(id).toBeNull();
    expect(nodesRef.current).toEqual([]);
    expect(persisted).toEqual([]);
});

test("leaving the canvas while uploading cannot add assets after unmount", async () => {
    deferUploads = true;
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["text"], "leaving.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, options);
    });
    await act(async () => root!.unmount());
    root = undefined;
    pending.get("leaving.md")!.resolve(uploaded("leaving.md"));
    expect(await task).toBeNull();
    expect(persisted).toEqual([]);
});

test("an explicit rename during upload wins while original filename metadata remains intact", async () => {
    deferUploads = true;
    for (const [name, type, title] of [
        ["original.md", "text/markdown", "original.md"],
        ["配音.final.wav", "audio/wav", "配音.final"],
    ]) {
        nodesRef.current = [];
        let task!: Promise<string | null>;
        await act(async () => {
            task = api.createFileNode(new File(["file"], name, { type }), { x: 0, y: 0 }, undefined, options);
        });
        expect(nodesRef.current[0]).toMatchObject({ title, metadata: { originalFileName: name, fileUpload: "uploading" } });
        nodesRef.current = nodesRef.current.map((node) => ({ ...node, title: "User title" }));
        await act(async () => {
            pending.get(name)!.resolve(uploaded(name));
            await task;
        });
        expect(nodesRef.current[0]).toMatchObject({ title: "User title", metadata: { originalFileName: name } });
    }
});

test("account switching prevents a pending upload from publishing into another scope", async () => {
    deferUploads = true;
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["text"], "scope.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, options);
    });
    setActiveUserScope("another-upload-user");
    pending.get("scope.md")!.resolve(uploaded("scope.md"));
    expect(await task).toBeNull();
    expect(persisted).toEqual([]);
});

test("failed replacement restores old media; successful replacement takes the new filename", async () => {
    nodesRef.current = [{ id: "original", title: "old.txt", type: CanvasNodeType.Text, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: "old", originalFileName: "old.txt" } }];
    failure = new Error("rejected");
    await act(async () => {
        await api.createFileNode(new File(["new"], "new.txt", { type: "text/plain" }), { x: 0, y: 0 }, "original", options);
    });
    expect(nodesRef.current[0]).toMatchObject({ title: "old.txt", metadata: { content: "old", originalFileName: "old.txt" } });
    failure = undefined;
    await act(async () => {
        await api.createFileNode(new File(["new"], "new.txt", { type: "text/plain" }), { x: 0, y: 0 }, "original", options);
    });
    expect(nodesRef.current[0]).toMatchObject({ title: "new.txt", metadata: { content: "new", originalFileName: "new.txt" } });
});

test("replacing audio updates filename-derived titles and preserves custom or untraceable titles", async () => {
    for (const [title, originalFileName, expected] of [
        ["旧配音.final.wav", "旧配音.final.wav", "新配音.take2"],
        ["旧配音.final", "旧配音.final.wav", "新配音.take2"],
        ["第一幕旁白", "旧配音.final.wav", "第一幕旁白"],
        ["用户特意命名.wav", "旧配音.final.wav", "用户特意命名.wav"],
        ["来源不详的旧标题", undefined, "来源不详的旧标题"],
    ] as const) {
        nodesRef.current = [{ id: "original", title, type: CanvasNodeType.Audio, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { originalFileName, content: "old-audio" } }];
        await act(async () => {
            await api.createFileNode(new File(["audio"], "新配音.take2.MP3", { type: "audio/mpeg" }), { x: 0, y: 0 }, "original", options);
        });
        expect(nodesRef.current[0]).toMatchObject({ title: expected, metadata: { originalFileName: "新配音.take2.MP3" } });
        expect(canvasNodeToAsset(nodesRef.current[0], { canvasId: "canvas", source: "canvas-upload" })?.title).toBe(expected);
    }
});

test("renaming an audio node during replacement wins over the uploaded filename", async () => {
    deferUploads = true;
    nodesRef.current = [{ id: "original", title: "旧配音", type: CanvasNodeType.Audio, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { originalFileName: "旧配音.wav", content: "old-audio" } }];
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["audio"], "新配音.final.wav", { type: "audio/wav" }), { x: 0, y: 0 }, "original", options);
    });
    nodesRef.current = nodesRef.current.map((node) => ({ ...node, title: "用户修订的旁白" }));
    await act(async () => {
        pending.get("新配音.final.wav")!.resolve(uploaded("新配音.final.wav"));
        await task;
    });
    expect(nodesRef.current[0]).toMatchObject({ title: "用户修订的旁白", metadata: { originalFileName: "新配音.final.wav" } });
});

test("library import retains long titles for every media type and uploaded text filenames", async () => {
    const title = "素材原始名称_超出三十二字符不应截掉扩展名_包含多个.版本.final.png";
    const image = { kind: "image" as const, id: "image", title, coverUrl: "", tags: [], metadata: { originalFileName: title }, data: { dataUrl: "", storageKey: "resource:image", width: 800, height: 600 } };
    const payloads = [
        ...assetPickerItemsToInsertPayloads(["image"], [{ id: "image", title, asset: image as never }]),
        { kind: "text" as const, title: "script.v3.md", content: "正文不会成为标题", originalFileName: "script.v3.md" },
        { kind: "video" as const, title: "视频源片.v2.mp4", url: "video", width: 800, height: 600 },
        { kind: "audio" as const, title: "音频.wav", url: "audio" },
    ];
    await act(async () => {
        await api.handleAssetsInsert(payloads);
    });
    expect(nodesRef.current.map((node) => node.title)).toEqual(payloads.map((payload) => payload.title));
    expect(nodesRef.current[0].metadata?.originalFileName).toBe(title);
});

test("仅悬停已有视频的画面才请求播放，移开或按下鼠标时撤销悬停", async () => {
    const calls: boolean[] = [];
    const node: CanvasNodeData = {
        id: "video",
        type: CanvasNodeType.Video,
        title: "样片",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "/clip.mp4" },
    };
    await act(async () =>
        root!.render(
            <CanvasNode
                data={node}
                renderLOD="preview"
                scale={0.2}
                isSelected={false}
                isRelated={false}
                isFocusRelated={false}
                isConnectionTarget={false}
                showImageInfo={false}
                onMouseDown={silent}
                onHoverStart={silent}
                onHoverEnd={silent}
                onConnectStart={silent}
                onResize={silent}
                onContentChange={silent}
                onContextMenu={silent}
                onMediaHoverChange={(_, hovering) => calls.push(hovering)}
            />,
        ),
    );
    const cover = container.querySelector(".canvas-node-shell")!;
    const pointer = async (type: string, pointerType: string, buttons = 0) => act(async () => cover.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, pointerType, buttons })));

    await pointer("pointerover", "touch");
    await pointer("pointerover", "mouse", 1);
    expect(calls).toEqual([]);
    await pointer("pointerover", "mouse");
    await pointer("pointerout", "mouse");
    await pointer("pointerover", "mouse");
    await pointer("pointerdown", "mouse", 1);
    expect(calls).toEqual([true, false, true, false]);
});

test("缩小画布后单击视频画面播放，拖动节点不播放，静音预览可用键盘切到手动播放", async () => {
    const node: CanvasNodeData = {
        id: "video",
        type: CanvasNodeType.Video,
        title: "样片",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "/clip.mp4" },
    };
    const plays: string[] = [];
    function VideoCanvas({ mediaActive, mediaHoverPlayback }: { mediaActive: boolean; mediaHoverPlayback: boolean }) {
        const [nodes, setNodes] = React.useState([node]);
        const nodeList = React.useRef(nodes);
        nodeList.current = nodes;
        const canvas = React.useRef<HTMLDivElement>(null);
        const viewport = React.useRef({ x: 0, y: 0, k: 0.2 });
        const selection = React.useRef(new Set<string>());
        const historyPaused = React.useRef(false);
        const controller = useCanvasSelectionController({
            containerRef: canvas,
            nodesRef: nodeList,
            viewportRef: viewport,
            selectedNodeIdsRef: selection,
            historyPausedRef: historyPaused,
            screenToCanvas: (x, y) => ({ x: x / 0.2, y: y / 0.2 }),
            setNodes,
            setSelectedNodeIds: silent,
            setSelectedConnectionId: silent,
            cancelPendingConnectionCreate: silent,
            onCanvasSelectionStart: silent,
            onNodeInteractionStart: silent,
            onNodeClick: silent,
            onDeselect: silent,
        });
        return (
            <div ref={canvas}>
                <CanvasNode
                    data={nodes[0]}
                    renderLOD="preview"
                    scale={0.2}
                    dragOffset={controller.dragPreview ?? undefined}
                    mediaActive={mediaActive}
                    mediaHoverPlayback={mediaHoverPlayback}
                    isSelected={false}
                    isRelated={false}
                    isFocusRelated={false}
                    isConnectionTarget={false}
                    showImageInfo={false}
                    onMouseDown={controller.handleNodeMouseDown}
                    onHoverStart={silent}
                    onHoverEnd={silent}
                    onConnectStart={silent}
                    onResize={silent}
                    onContentChange={silent}
                    onContextMenu={silent}
                    onMediaPlayRequest={(id) => plays.push(id)}
                />
            </div>
        );
    }
    const render = (mediaActive: boolean, mediaHoverPlayback: boolean) => act(async () => root!.render(<VideoCanvas mediaActive={mediaActive} mediaHoverPlayback={mediaHoverPlayback} />));
    const selector = 'button[aria-label="播放 样片"]';
    await render(false, false);
    const button = container.querySelector<HTMLButtonElement>(selector)!;
    expect(button.textContent).toBe("");
    expect(container.querySelector("video")).toBeNull();
    const mouse = (target: EventTarget, type: string, clientX: number, shiftKey = false) => target.dispatchEvent(new dom.MouseEvent(type, { bubbles: true, clientX, clientY: 12, detail: 1, shiftKey }));
    await act(async () => {
        mouse(button, "mousedown", 8);
        mouse(window, "mousemove", 28);
        mouse(button, "mouseup", 28);
        mouse(button, "click", 28);
    });
    expect(plays).toEqual([]);
    expect(container.querySelector<HTMLElement>('[data-node-id="video"]')!.style.transform).toBe("translate(100px, 0px)");
    await act(async () => {
        mouse(button, "mousedown", 28, true);
        mouse(button, "mouseup", 28, true);
        mouse(button, "click", 28, true);
    });
    expect(plays).toEqual([]);
    await act(async () => mouse(button, "mousedown", 28));
    expect(plays).toEqual([]);
    await act(async () => {
        mouse(button, "mouseup", 28);
        mouse(button, "click", 28);
    });
    expect(plays).toEqual(["video"]);

    await render(true, true);
    expect(container.querySelector(selector) === button).toBe(true);
    button.focus();
    expect(document.activeElement === button).toBe(true);
    await act(async () => button.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(plays).toEqual(["video", "video"]);
    await render(true, false);
    expect(container.querySelector(selector)).toBeNull();
});
