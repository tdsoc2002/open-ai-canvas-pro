import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/remake" });
for (const name of ["document", "navigator", "localStorage", "HTMLElement", "SVGElement", "Element", "ShadowRoot", "Node", "NodeFilter", "MutationObserver", "ResizeObserver", "Event", "CustomEvent"] as const) {
    Object.defineProperty(globalThis, name, { value: dom[name], configurable: true, writable: true });
}
Object.assign(globalThis, { window: dom, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const { CanvasNodePromptPanel } = await import("@/components/canvas/canvas-node-prompt-panel");
const { buildVideoRemakeDraft } = await import("@/lib/canvas/canvas-video-remake");
const { buildCanvasNodeMentionReferenceMap } = await import("@/lib/canvas/canvas-resource-references");
const { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
await import("@/themes/load");
const quoteApi = await import("@/services/api/logical-models");
const { CanvasNodeType } = await import("@/types/canvas");

afterAll(() => dom.happyDOM.abort());

test("空图片位可从实际生成面板补图，补图后仍需手动提交", async () => {
    const model = "doubao-seedance-2-0-260128";
    const channel = createModelChannel({
        id: "panel",
        scope: "system",
        interfaceType: "volcengine-ark-video",
        models: [model],
        modelCosts: [{ model, capability: "video", protocol: "volcengine-ark-video", billingMode: "per_second", unitPriceMicrocredits: 1 }],
    });
    const config = { ...defaultConfig, channels: [channel], videoModel: encodeChannelModel(channel.id, model) };
    useConfigStore.setState({ config });
    useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true, creditsEnabled: false } }));
    const source: CanvasNodeData = { id: "clip", type: CanvasNodeType.Video, title: "样片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "clip.mp4", durationMs: 6000 } };
    const draft = buildVideoRemakeDraft(source.id, [source], [], config);
    const submissions: string[] = [];
    let genericUploads = 0;
    function Panel({ durationMs, hasImageSlot }: { durationMs: number; hasImageSlot: boolean }) {
        const [imageUploaded, setImageUploaded] = useState(false);
        const nodes = draft.nodes
            .filter((node) => hasImageSlot || node.type !== CanvasNodeType.Image)
            .map((node) => {
                if (node.id === source.id) return { ...node, metadata: { ...node.metadata, durationMs } };
                if (node.type === CanvasNodeType.Image && imageUploaded) return { ...node, metadata: { content: "portrait.png" } };
                return node;
            });
        return (
            <CanvasNodePromptPanel
                projectId="remake"
                node={draft.target}
                isRunning={false}
                mentionReferences={buildCanvasNodeMentionReferenceMap(nodes, draft.connections).get(draft.target.id)}
                onPromptChange={() => {}}
                onConfigChange={() => {}}
                onGenerate={(_id, _mode, prompt) => submissions.push(prompt)}
                onUploadVideoReference={async () => {
                    genericUploads += 1;
                }}
                onUploadRemakeImage={hasImageSlot ? () => setImageUploaded(true) : undefined}
            />
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const quote = spyOn(quoteApi, "quoteModel").mockResolvedValue({ quote: { logicalModelId: "", billingMode: "per_second", quantity: 6, amountMicrocredits: 16_390_000, estimated: true } });
    const renderPanel = (durationMs: number, hasImageSlot = true) =>
        act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <App>
                        <Panel durationMs={durationMs} hasImageSlot={hasImageSlot} />
                    </App>
                </QueryClientProvider>,
            ),
        );
    try {
        await renderPanel(16000);
        const submit = host.querySelector<HTMLButtonElement>(".canvas-node-generate-button")!;
        expect(submit.textContent).toBe("提交");
        expect(submit.previousElementSibling).toBeNull();
        expect(submit.disabled).toBe(true);
        await act(async () => useUserStore.setState((state) => ({ features: { ...state.features, creditsEnabled: true } })));
        const cost = submit.previousElementSibling;
        expect(cost?.querySelector(".joysee-credit-mark.is-compact svg")).toBeTruthy();
        expect(cost?.textContent).toBe("16.39 积分");
        expect(cost?.getAttribute("title")).toContain("预计消耗 16.39 积分");
        expect(submit.textContent).toBe("提交");
        expect(host.textContent).toContain("缺少参考图片");
        const uploads = [...host.querySelectorAll("button")].filter((button) => button.textContent.trim() === "上传参考图");
        expect(uploads).toHaveLength(1);
        await act(async () => uploads[0].click());
        expect(genericUploads).toBe(0);
        expect(host.textContent).not.toContain("缺少参考图片");
        expect(host.textContent).toContain("参考片段");
        expect(submit.disabled).toBe(true);
        await renderPanel(6000);
        expect(submit.disabled).toBe(false);
        expect(submissions).toEqual([]);
        await act(async () => submit.click());
        expect(submissions).toEqual([draft.target.metadata?.composerContent]);

        await renderPanel(6000, false);
        expect(host.textContent).toContain("缺少参考图片");
        expect(host.querySelector(".canvas-node-composer-header-tools")?.textContent).toContain("上传参考图");
    } finally {
        await act(async () => root.unmount());
        quote.mockRestore();
        client.clear();
        host.remove();
    }
});
