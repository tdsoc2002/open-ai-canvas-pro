import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ModelPriceTier } from "@/lib/model-pricing";

test("乐见工作台去掉调用统计，价格明细不选中渠道，其他入口保留原展示", async () => {
    const dom = new Window({ url: "http://fixture.invalid/" });
    const globals = {
        window: dom,
        document: dom.document,
        Element: dom.Element,
        HTMLElement: dom.HTMLElement,
        SVGElement: dom.SVGElement,
        Node: dom.Node,
        ShadowRoot: dom.ShadowRoot,
        MutationObserver: dom.MutationObserver,
        ResizeObserver: dom.ResizeObserver,
        CustomEvent: dom.CustomEvent,
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const original = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ModelPicker } = await import("@/components/model-picker");
    const { defaultConfig, encodeChannelModel } = await import("@/stores/use-config-store");
    const { useUserStore } = await import("@/stores/use-user-store");

    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    const initialFeatures = useUserStore.getState().features;
    const tier = (quality: string, imageResolution: string, price: number): ModelPriceTier => ({
        selector: { quality, imageResolution },
        resolution: "*",
        videoSeconds: 0,
        billingMode: "fixed_request",
        unitPriceMicrocredits: price,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
    });
    const config = {
        ...defaultConfig,
        channels: [
            {
                id: "image-test",
                name: "测试渠道",
                baseUrl: "",
                apiKey: "",
                apiFormat: defaultConfig.apiFormat,
                scope: "system" as const,
                models: ["gpt-image-2"],
                modelCosts: [
                    {
                        model: "gpt-image-2",
                        displayName: "腾讯 Image 2",
                        channelLabel: "渠道 A",
                        capability: "image" as const,
                        billingMode: "fixed_request" as const,
                        unitPriceMicrocredits: 50_000,
                        pricePolicy: "channel" as const,
                        logicalPriceTiers: [
                            tier("high", "4k", 5_340_000),
                            tier("high", "1k", 1_580_000),
                            tier("low", "2k", 90_000),
                            tier("low", "1k", 50_000),
                            tier("medium", "2k", 800_000),
                            tier("medium", "2k", 800_000),
                            tier("high", "2k", 3_210_000),
                            tier("medium", "1k", 400_000),
                            tier("low", "4k", 150_000),
                            tier("low", "4k", 160_000),
                            { ...tier("medium", "4k", 1_200_000), selector: { quality: "medium", imageResolution: "4k", size: "1:1" } },
                        ],
                        availability: { dataState: "ready" as const, recentResults: [true], sampleCount24h: 1, trend7d: [], rate24h: 1, computedAt: "" },
                    },
                ],
            },
        ],
    };
    const value = encodeChannelModel("image-test", "gpt-image-2");
    const changes: string[] = [];
    const render = async (joysee: boolean) => {
        await act(() =>
            root.render(<ModelPicker key={String(joysee)} config={config} value={value} capability="image" layout={joysee ? "joysee-workbench" : undefined} showSelectedPrice={false} showOptionPrices onChange={(next) => changes.push(next)} />),
        );
        await act(() => host.querySelector("button")!.click());
    };

    try {
        useUserStore.setState({ features: { ...initialFeatures, creditsEnabled: true } });
        await render(false);
        expect(host.querySelector("button")?.textContent).toContain("腾讯 Image 2 · 渠道 A");
        expect(dom.document.querySelector(".model-picker-availability-label")?.textContent).toBe("1/1");
        await render(true);
        expect(host.querySelector("button")?.textContent).toBe("GPT Image 2");
        expect(host.querySelector("button")?.getAttribute("title")).toBe("GPT Image 2");
        expect(dom.document.querySelector(".canvas-model-picker-brand-rail .canvas-model-picker-brand strong")?.textContent).toBe("GPT Image 2");
        expect(dom.document.querySelectorAll(".model-picker-availability-track").length).toBe(0);
        expect(dom.document.querySelectorAll(".canvas-model-picker-option-logo").length).toBe(0);
        const option = dom.document.querySelector<HTMLButtonElement>(".canvas-model-picker-option")!;
        expect(option.textContent).toContain("渠道 A");
        expect(option.textContent).toContain("已选");
        expect(option.textContent).toContain("0.05-5.34");
        const help = dom.document.querySelector<HTMLButtonElement>('button[aria-label="查看渠道 A的积分价目"]')!;
        expect(option.contains(help)).toBe(false);
        await act(() => help.click());
        const matrix = dom.document.querySelector('table[aria-label="画质与分辨率积分单价"]');
        expect([...(matrix?.querySelectorAll("thead th") ?? [])].map((cell) => cell.textContent)).toEqual(["画质", "1K", "2K", "4K"]);
        const rows = [...matrix!.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));
        expect(rows).toEqual([
            ["低", "0.05 积分", "0.09 积分", "价格配置冲突"],
            ["中", "0.40 积分", "0.80 积分", "—"],
            ["高", "1.58 积分", "3.21 积分", "5.34 积分"],
        ]);
        expect(dom.document.querySelector('table[aria-label="积分价目"] tbody')?.textContent).toBe("画质 中 / 分辨率 4K / 1:11.20 积分");
        expect(changes).toEqual([]);
        const details = dom.document.querySelector(".wb-model-tariff-details")!;
        await act(() => details.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(help.getAttribute("aria-expanded")).toBe("false");
        expect(dom.document.activeElement === help).toBe(true);
        await act(() => option.click());
        expect(changes).toEqual([value]);
        await act(() => useUserStore.setState({ features: { ...initialFeatures, creditsEnabled: false } }));
        expect(dom.document.querySelectorAll(".wb-model-tariff-help, .wb-model-tariff").length).toBe(0);
    } finally {
        await act(() => root.unmount());
        useUserStore.setState({ features: initialFeatures });
        await dom.happyDOM.abort();
        for (const [key, descriptor] of original) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
