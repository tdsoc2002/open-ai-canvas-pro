import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { ModelRequirements } from "../../src/lib/model-selection";
import type { ModelRequestIntent } from "../../src/services/api/logical-models";

const dom = new Window({ url: "http://localhost/" });
Object.defineProperty(dom.Element.prototype, "animate", { configurable: true, value: undefined });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App, ConfigProvider } = await import("antd");
const { ModelPicker } = await import("../../src/components/model-picker");
const { CreationComposer } = await import("../../src/pages/create/creation-workspace");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { modelQuoteRequest } = await import("../../src/lib/model-pricing");
const { createModelChannel, defaultConfig, normalizeConfigSnapshot } = await import("../../src/stores/use-config-store");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { apiClient } = await import("../../src/services/api/request");
const noop = () => {};
afterAll(() => dom.happyDOM.abort());

const profile = defaultModelCapabilityConfig("openai-video", "sora-2");
const channel = createModelChannel({
    id: "guest-catalog",
    scope: "system",
    models: ["sora-2"],
    modelCosts: [
        {
            model: "sora-2",
            modelKey: "sora-2",
            channelId: "guest-catalog",
            displayName: "游客可见视频模型",
            channelLabel: "游客可见视频模型",
            capability: "video",
            protocol: "openai-video",
            capabilityConfig: profile,
            billingMode: "fixed_request",
            unitPriceMicrocredits: 1000000,
            logicalPriceTiers: [{ selector: {}, billingMode: "fixed_request", unitPriceMicrocredits: 1000000, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0 }],
        },
    ],
});
const model = "guest-catalog::sora-2";
const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model, videoModel: model } }).config;

for (const component of ["picker", "composer"] as const) {
    test(`${component} 游客不报价，登录后恢复报价`, async () => {
        const originalAdapter = apiClient.defaults.adapter;
        const requests: string[] = [];
        apiClient.defaults.adapter = async (request) => {
            requests.push(request.url!);
            return { config: request, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { quote: { amountMicrocredits: 2000000, estimated: false } } } };
        };
        useUserStore.setState({ user: null, hydrated: true });
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const props: ComponentProps<typeof CreationComposer> = {
            variant: "empty",
            mode: "video",
            prompt: "测试",
            setPrompt: noop,
            busy: false,
            generationActive: false,
            referenceReplacementBusy: false,
            attachments: [],
            maxReferences: 0,
            references: [],
            onRemoveAttachment: noop,
            onClearAttachments: noop,
            onClearComposer: noop,
            onReorderAttachments: noop,
            onReplaceAttachment: noop,
            onReplaceReferenceFiles: noop,
            onOpenLibrary: noop,
            onModeChange: noop,
            model,
            modelRequirements: { capability: "video" },
            videoProfile: profile.video!,
            imageProfile: defaultModelCapabilityConfig("openai-image").image!,
            config,
            onModelChange: noop,
            ratio: config.videoRatio,
            setRatio: noop,
            seconds: config.videoSeconds,
            setSeconds: noop,
            quality: config.quality,
            setQuality: noop,
            imageResolution: config.imageResolution,
            setImageResolution: noop,
            setImageParameters: noop,
            setTransparentBackground: noop,
            videoQuality: config.videoQuality,
            setVideoQuality: noop,
            count: "1",
            setCount: noop,
            textStreaming: false,
            setTextStreaming: noop,
            textThinkingLevels: [],
            textThinkingLevel: "",
            textThinkingRequest: "auto",
            setTextThinkingLevel: noop,
            promptOptimizerProvider: null,
            composerFocusRef: createRef<HTMLTextAreaElement>(),
            onPromptFocus: noop,
            onSubmit: noop,
        };
        try {
            expect(modelQuoteRequest(config, model, "video")).toBeDefined();
            await act(async () =>
                root.render(
                    <MemoryRouter>
                        <ConfigProvider theme={{ token: { motion: false } }}>
                            <App>{component === "picker" ? <ModelPicker config={config} value={model} capability="video" onChange={noop} /> : <CreationComposer {...props} />}</App>
                        </ConfigProvider>
                    </MemoryRouter>,
                ),
            );
            expect(host.querySelector(".canvas-model-picker-trigger-text")?.textContent).toBe("游客可见视频模型");
            expect(requests).toEqual([]);
            if (component === "composer") expect(host.querySelector('button[aria-label^="预估"]')).not.toBeNull();
            await act(async () => useUserStore.setState({ user: { id: "member", username: "member", displayName: "会员", role: "user", status: "active" } }));
            expect(requests.length).toBeGreaterThan(0);
            expect(requests.every((url) => url === "/model-catalog/quote")).toBe(true);
            const count = requests.length;
            await act(async () => useUserStore.setState({ user: null }));
            expect(requests).toHaveLength(count);
            expect(host.querySelector(".canvas-model-picker-trigger-text")?.textContent).toBe("游客可见视频模型");
            if (component === "composer") expect(host.querySelector('button[aria-label^="预估"]')).not.toBeNull();
        } finally {
            await act(async () => root.unmount());
            apiClient.defaults.adapter = originalAdapter;
            host.remove();
        }
    });
}

test("Seedance 渠道用当前生成参数和参考视频时长报价", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const queryClient = new QueryClient();
    const seedance = "doubao-seedance-2-5-260628";
    const protocol = "volcengine-ark-seedance-25";
    const seedanceProfile = defaultModelCapabilityConfig(protocol, seedance);
    seedanceProfile.video!.resolutions = ["480p", "720p"];
    seedanceProfile.video!.generateAudio.supported = true;
    const seedanceChannel = createModelChannel({
        id: "seedance-catalog",
        scope: "system",
        models: [seedance],
        modelCosts: [
            {
                model: seedance,
                protocol,
                displayName: "Seedance 2.5",
                capability: "video",
                capabilityConfig: seedanceProfile,
                billingMode: "token",
                unitPriceMicrocredits: 0,
                inputTokenPriceMicrocredits: 0,
                outputTokenPriceMicrocredits: 32_000_000,
                cachedTokenPriceMicrocredits: 0,
            },
        ],
    });
    const pickerConfig = normalizeConfigSnapshot({ config: { ...config, channels: [channel, seedanceChannel] } }).config;
    const originalAdapter = apiClient.defaults.adapter;
    const requests: Array<{ channelId: string; modelKey: string; intent: ModelRequestIntent }> = [];
    apiClient.defaults.adapter = async (request) => {
        expect(request.url).toBe("/model-catalog/quote");
        const body = JSON.parse(request.data) as (typeof requests)[number];
        requests.push(body);
        const withReference = Boolean(body.intent.inputs?.video);
        const quote = { billingMode: "token", estimated: true, amountMicrocredits: withReference ? 8_500_000 : 2_250_000, videoUnitPriceMicrocredits: withReference ? 1_060_000 : 450_000 };
        return { config: request, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { quote } } };
    };
    const { user, features } = useUserStore.getState();
    useUserStore.setState({ user: null, features: { ...features, creditsEnabled: true } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (requirements: ModelRequirements) =>
        act(() =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <ModelPicker config={pickerConfig} value={model} capability="video" onChange={noop} requirements={requirements} showSelectedPrice={false} showOptionPrices catalogSource="provided" />
                </QueryClientProvider>,
            ),
        );
    const tariffs = () => Array.from(document.querySelectorAll(".canvas-model-picker-option-price .model-picker-tariff"), (node) => node.textContent);
    const input = { textCount: 1, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 };
    try {
        await render({ input, options: { size: "16:9", vquality: "480p", videoSeconds: 5, videoGenerateAudio: false } });
        await act(() => host.querySelector("button")!.click());
        const seedanceGroup = [...document.querySelectorAll<HTMLButtonElement>(".canvas-model-picker-brand")].find((button) => button.textContent?.includes("Seedance 2.5"))!;
        await act(() => seedanceGroup.click());
        expect(tariffs()[0]).toContain("/M Token");
        expect(requests).toHaveLength(0);

        await act(() => useUserStore.setState({ user: { id: "member", username: "member", displayName: "会员", role: "user", status: "active" } }));
        await act(async () => void (await Bun.sleep(20)));
        expect(tariffs()).toEqual(["480P 0.45/秒", "720P 0.45/秒"]);
        expect(requests).toHaveLength(2);
        expect(requests.find(({ intent }) => intent.options?.vquality === "480p")).toMatchObject({
            channelId: seedanceChannel.id,
            modelKey: seedance,
            intent: { operation: "text_to_video", options: { size: "16:9", videoSeconds: 5, videoGenerateAudio: false } },
        });

        await render({ input: { ...input, videoCount: 1, videoDurationsMs: [3000] }, options: { size: "9:16", vquality: "720p", videoSeconds: 8, videoGenerateAudio: true } });
        await act(async () => void (await Bun.sleep(20)));
        expect(tariffs()).toEqual(["480P 1.06/秒", "720P 1.06/秒"]);
        expect(requests).toHaveLength(4);
        expect(requests.find(({ intent }) => intent.operation === "reference_to_video" && intent.options?.vquality === "720p")?.intent).toMatchObject({
            operation: "reference_to_video",
            inputs: { video: 1 },
            referenceVideoDurationsMs: [3000],
            options: { size: "9:16", videoSeconds: 8, videoGenerateAudio: true },
        });

        await act(() => useUserStore.setState({ user: null }));
        expect(tariffs()[0]).toContain("/M Token");
        expect(requests).toHaveLength(4);
    } finally {
        await act(() => root.unmount());
        queryClient.clear();
        useUserStore.setState({ user, features });
        apiClient.defaults.adapter = originalAdapter;
        host.remove();
    }
});
