import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import snapshot from "./fixtures/nano-banana-2-model-capability.json";
import type { ModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { CanvasNodeData } from "../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ImageSettingsPanel } = await import("../src/components/image-settings-panel");
const { VideoSettingsPanel, videoResolutionLabel } = await import("../src/components/video-settings-panel");
const { defaultConfig, createModelChannel, encodeChannelModel, useConfigStore } = await import("../src/stores/use-config-store");
const { useUserStore } = await import("../src/stores/use-user-store");
const { CanvasConfigNodePanel } = await import("../src/components/canvas/canvas-config-node-panel");
const { CanvasVideoSettingsPopover } = await import("../src/components/canvas/canvas-video-settings-popover");
const { CanvasNodeType } = await import("../src/types/canvas");
const { defaultModelCapabilityConfig } = await import("../src/lib/model-capabilities");
const { projectImageParameters } = await import("../src/lib/image-parameters");
const { canvasThemes } = await import("../src/lib/canvas-theme");
const { mediaSettingIssues } = await import("../src/lib/media-settings");
const { backendProviderConfig } = await import("../src/services/api/generation-task");
const { translate } = await import("../src/i18n");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

test("独立配置节点重开 high 旧值时显示可用生成入口，提交仍使用目标能力", async () => {
    const channel = createModelChannel({
        id: "target",
        scope: "system",
        models: ["nano-banana-2"],
        modelCosts: [{ model: "nano-banana-2", capability: "image", protocol: "change2pro-image", capabilityConfig: structuredClone(snapshot) as ModelCapabilityConfig, unitPriceMicrocredits: 0 }],
    });
    const config = { ...defaultConfig, channels: [channel], model: "target::nano-banana-2", imageModel: "target::nano-banana-2", imageModels: ["target::nano-banana-2"], quality: "high", imageResolution: "2K", size: "9:16" };
    const previousConfig = useConfigStore.getState().config;
    const previousFeatures = useUserStore.getState().features;
    useConfigStore.setState({ config });
    useUserStore.setState({ features: { ...previousFeatures, customChannelsEnabled: true } });
    const node: CanvasNodeData = {
        id: "config-node",
        type: CanvasNodeType.Config,
        title: "独立配置",
        position: { x: 0, y: 0 },
        width: 300,
        height: 300,
        metadata: { generationMode: "image", workflowProvider: "model", model: config.model, quality: "high", imageResolution: "2K", size: "9:16", composerContent: "原提示词" },
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let generated = "";
    try {
        await act(async () =>
            root.render(
                <CanvasConfigNodePanel
                    node={node}
                    isRunning={false}
                    inputSummary={{ textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 }}
                    onConfigChange={() => {}}
                    onGenerate={(id) => {
                        generated = id;
                    }}
                    onComposerToggle={() => {}}
                />,
            ),
        );
        expect(host.textContent).not.toContain("待调整");
        const generate = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("开始生成"))!;
        expect(generate.disabled).toBe(false);
        await act(async () => generate.click());
        expect(generated).toBe(node.id);
        expect(backendProviderConfig(config, "image").quality).toBeUndefined();
    } finally {
        await act(async () => root.unmount());
        host.remove();
        useConfigStore.setState({ config: previousConfig });
        useUserStore.setState({ features: previousFeatures });
    }
});

for (const protocol of ["grok-image", "agnes-image"] as const) {
    test(`${protocol} 图片面板恢复旧 quality=1k，选中 1K 且不要求用户重置`, async () => {
        const capabilityConfig = defaultModelCapabilityConfig(protocol);
        const channel = createModelChannel({ id: "legacy", scope: "system", interfaceType: protocol, models: ["B"], modelCosts: [{ model: "B", capability: "image", capabilityConfig, unitPriceMicrocredits: 0 }] });
        const config = { ...defaultConfig, channels: [channel], model: "legacy::B", size: "16:9", quality: "1k", imageResolution: "auto", count: "1", transparentBackground: "false", imageParameters: "{}" };
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () => root.render(<ImageSettingsPanel config={config} theme={canvasThemes.light} onConfigChange={() => {}} bypassPriceGuard />));
            expect(host.querySelector('[role="alert"]')).toBeNull();
            const selected = [...host.querySelectorAll('button[aria-pressed="true"]')].map((button) => button.textContent);
            expect(selected).toContain("1K");
            expect(selected).not.toContain("2K");
            expect(backendProviderConfig(config, "image").imageResolution).toBe("1k");
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
}

test("真实图片设置面板自动移除旧扩展，保留兼容种子并允许提交", async () => {
    const image = projectImageParameters(defaultModelCapabilityConfig().image!, [
        { name: "size", label: "尺寸", type: "string", values: ["1:1", "16:9"], default: "1:1" },
        { name: "seed", label: "种子", type: "integer", min: 0, max: 100, default: 1 },
    ]);
    const channel = createModelChannel({ id: "image", scope: "system", interfaceType: "openai-image", models: ["B"], modelCosts: [{ model: "B", capability: "image", capabilityConfig: { version: 1, image }, unitPriceMicrocredits: 0 }] });
    let config = {
        ...defaultConfig,
        channels: [channel],
        model: encodeChannelModel("image", "B"),
        size: "16:9",
        quality: "auto",
        imageResolution: "auto",
        count: "1",
        transparentBackground: "false",
        imageParameters: '{"seed":42,"old_style":"film"}',
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = () =>
        root.render(
            <ImageSettingsPanel
                config={config}
                theme={canvasThemes.dark}
                onConfigChange={(field, value) => {
                    config = { ...config, [field]: value };
                    render();
                }}
            />,
        );
    try {
        await act(async () => render());
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(backendProviderConfig(config, "image").imageParameters).toMatchObject({ seed: 42 });
        expect(backendProviderConfig(config, "image").imageParameters).not.toHaveProperty("old_style");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("画布视频规格与声音状态共用设置按钮，声音在弹窗里切换", async () => {
    const withAudio = defaultModelCapabilityConfig();
    withAudio.video!.generateAudio = { supported: true, default: true };
    const silent = defaultModelCapabilityConfig();
    silent.video!.generateAudio = { supported: false, default: false };
    const channel = createModelChannel({
        id: "video-sound",
        scope: "system",
        interfaceType: "newapi-channel-2",
        models: ["with-audio", "silent"],
        modelCosts: [
            { model: "with-audio", capability: "video", capabilityConfig: withAudio, unitPriceMicrocredits: 0 },
            { model: "silent", capability: "video", capabilityConfig: silent, unitPriceMicrocredits: 0 },
        ],
    });
    let config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "with-audio"), videoGenerateAudio: "" };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = () =>
        root.render(
            <CanvasVideoSettingsPopover
                config={config}
                onConfigChange={(field, value) => {
                    config = { ...config, [field]: value };
                    render();
                }}
            />,
        );
    const audioLabel = translate("library.tasks.params.audio");
    try {
        await act(async () => render());
        const settingsTrigger = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
        expect(host.querySelectorAll("button")).toHaveLength(1);
        expect(settingsTrigger.getAttribute("aria-label")).toContain(`${audioLabel} · ${translate("library.tasks.params.enabled")}`);
        const speaker = settingsTrigger.querySelector<HTMLElement>("[data-trigger-status]")!;
        await act(async () => speaker.click());
        expect(settingsTrigger.getAttribute("aria-expanded")).toBe("true");
        expect(config.videoGenerateAudio).toBe("");
        const panelToggle = document.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="生成声音"]');
        expect(panelToggle?.getAttribute("aria-checked")).toBe("true");
        expect(document.querySelector('button[role="switch"][aria-label="添加水印"]')).toBeNull();
        await act(async () => panelToggle!.click());
        expect(config.videoGenerateAudio).toBe("false");
        expect(settingsTrigger.getAttribute("aria-label")).toContain(`${audioLabel} · ${translate("library.tasks.params.disabled")}`);

        config = { ...config, model: encodeChannelModel(channel.id, "silent") };
        await act(async () => render());
        expect(settingsTrigger.querySelector("[data-trigger-status]")).toBeNull();
        expect(document.querySelector('button[role="switch"][aria-label="生成声音"]')).toBeNull();
        expect(host.querySelectorAll("button")).toHaveLength(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("真实视频设置面板自动适配时长与分辨率，不发送不支持的音频", async () => {
    const capabilityConfig = defaultModelCapabilityConfig();
    capabilityConfig.video = {
        ...capabilityConfig.video!,
        duration: { selection: "enum", values: [5, 10], default: 5 },
        ratios: ["16:9", "9:16"],
        defaultRatio: "16:9",
        resolutions: ["4k", "1440p", "1080p", "480p", "720p"],
        defaultResolution: "720p",
        generateAudio: { supported: false, default: false },
        watermark: { supported: false, default: false },
    };
    const channel = createModelChannel({ id: "video", scope: "system", interfaceType: "newapi-channel-2", models: ["B"], modelCosts: [{ model: "B", capability: "video", capabilityConfig, unitPriceMicrocredits: 0 }] });
    let config = { ...defaultConfig, channels: [channel], model: encodeChannelModel("video", "B"), size: "9:16", videoSeconds: "12", vquality: "2K", videoGenerateAudio: "true", videoWatermark: "false" };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = () =>
        root.render(
            <VideoSettingsPanel
                config={config}
                theme={canvasThemes.light}
                onConfigChange={(field, value) => {
                    config = { ...config, [field]: value };
                    render();
                }}
            />,
        );
    try {
        await act(async () => render());
        const resolutionButtons = () => [...host.querySelectorAll('[role="group"]')].find((group) => group.firstElementChild?.textContent === "分辨率")!.querySelectorAll("button");
        const resolutionLabels = () => Array.from(resolutionButtons(), (button) => button.textContent);
        expect(resolutionLabels()).toEqual(["480P", "720P", "1080P", "2K", "4K"]);
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(mediaSettingIssues(config, "video")).toEqual([]);
        expect(host.querySelector('button[role="switch"][aria-label="生成声音"]')).toBeNull();
        expect(host.querySelector('button[role="switch"][aria-label="添加水印"]')).toBeNull();
        expect(host.textContent).not.toContain("输出");
        expect(backendProviderConfig(config, "video")).toMatchObject({ size: "9:16", videoSeconds: "5", vquality: "720p", videoGenerateAudio: undefined });
        await act(async () => resolutionButtons()[4].click());
        expect(config.vquality).toBe("4k");
        config = { ...config, vquality: "auto" };
        await act(async () => render());
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.textContent).not.toContain("W");
        expect(host.querySelector('button[aria-pressed="true"]')?.textContent).not.toContain("720");
        expect(videoResolutionLabel("auto")).toBe("自动");
        expect(backendProviderConfig(config, "video").vquality).toBe("auto");
        // Seedance 面板按模型名分流；实际 newapi-channel-2 仍允许 auto 省略。
        const seedanceModel = "seedance-2.0";
        config = { ...config, model: encodeChannelModel("video", seedanceModel), channels: [{ ...channel, models: [seedanceModel], modelCosts: [{ ...channel.modelCosts![0], model: seedanceModel }] }] };
        await act(async () => render());
        expect(resolutionLabels()).toEqual(["480P", "720P", "1080P", "1440P", "4K"]);
        const seedanceResolution = [...host.querySelectorAll("button")].find((button) => button.textContent === "720P")!;
        expect(seedanceResolution).toBeDefined();
        expect(seedanceResolution.getAttribute("aria-pressed")).toBe("false");
        expect(backendProviderConfig(config, "video").vquality).toBe("auto");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
