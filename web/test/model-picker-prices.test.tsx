import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPickerOption, ModelPicker } from "../src/components/model-picker";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { modelQuoteRequest, requestCreditCost } from "../src/lib/model-pricing";
import type { ModelRequirements } from "../src/lib/model-selection";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type ModelCapability } from "../src/stores/use-config-store";

function fixture(capability: ModelCapability = "video") {
    const channel = createModelChannel({
        id: "comfy",
        name: "Comfy",
        scope: "system",
        models: ["h3-multi"],
        modelCosts: [
            {
                model: "h3-multi",
                displayName: "MiniMax H3",
                channelLabel: "多图一致性",
                capability,
                pricePolicy: "channel",
                billingMode: "per_second",
                unitPriceMicrocredits: 100_000,
                logicalPriceTiers: [480, 720].map((resolution, index) => ({
                    selector: { vquality: resolution + "p", videoSeconds: "6" },
                    resolution: resolution + "p",
                    videoSeconds: 6,
                    billingMode: "per_second",
                    unitPriceMicrocredits: (index + 1) * 100_000,
                    inputTokenPriceMicrocredits: 0,
                    outputTokenPriceMicrocredits: 0,
                    cachedTokenPriceMicrocredits: 0,
                })),
            },
        ],
    });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "comfy::h3-multi", videoModel: "comfy::h3-multi" } }).config;
}

const requirements: ModelRequirements = { capability: "video", videoSeconds: "5", options: { vquality: "1080p" } };

test("各生成类型的模型按钮默认显示选中渠道，Logo 使用 20px", () => {
    const triggerText = (markup: string) => markup.match(/class="canvas-model-picker-trigger-text[^"]*">([^<]*)</)?.[1];

    for (const capability of ["video", "image", "text", "audio"] as const) {
        const config = fixture(capability);
        const cost = config.channels[0].modelCosts![0];
        const render = () => renderToStaticMarkup(<ModelPicker config={config} value={config.model} capability={capability} showConfiguredModelName showSelectedPrice={false} onChange={() => {}} />);

        cost.displayName = "Seedance 2.5 Flash";
        cost.channelLabel = "腾讯 VOD 直连";
        const selected = render();
        expect(selected).toMatch(/class="canvas-model-picker-trigger-icon"><(?:img|svg)[^>]* width="20" height="20"/);
        if (capability === "video") expect(selected).toMatch(/src="\/model-icons\/seedance-(light|dark)\.png"/);
        expect(selected).toContain('title="腾讯 VOD 直连"');
        expect(triggerText(selected)).toBe("腾讯 VOD 直连");

        cost.displayName = "Wan 3.0 Prime";
        cost.channelLabel = "";
        const fallback = render();
        if (capability === "video") expect(fallback).toMatch(/src="\/model-icons\/wan-(light|dark)\.png"/);
        expect(triggerText(fallback)).toBe("h3-multi");
    }
});

test("candidate rows show their configured prices instead of applying the previous model's specifications", () => {
    const config = fixture();
    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);
    expect(markup).toContain("480P <strong>0.10</strong>");
    expect(markup).toContain('720P <strong>0.20</strong><span class="model-picker-tariff-unit"> 积分/秒</span>');
    expect(markup).not.toContain("当前规格无报价");
});

test("Seedance menu shows the unit rate for each supported resolution with the same reference inputs", () => {
    const config = fixture();
    const cost = config.channels[0].modelCosts![0];
    cost.displayName = "Seedance 2.0 Fast";
    cost.capabilityConfig = defaultModelCapabilityConfig("tencent-vod-vs", "2.0-fast");
    cost.capabilityConfig.video!.resolutions = ["720P", "480P", "720p"];
    const selected = { capability: "video", input: { videoCount: 1, videoDurationsMs: [8064] }, options: { vquality: "720p", videoSeconds: "15", size: "16:9" } } satisfies ModelRequirements;
    const request = modelQuoteRequest(config, config.model, "video", selected)!;
    expect(request.intent.referenceVideoDurationsMs).toEqual([8064]);
    const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false } } });
    for (const [vquality, amountMicrocredits, videoUnitPriceMicrocredits] of [
        ["480p", 5_610_000, 211_376],
        ["720p", 12_060_000, 475_200],
    ] as const) {
        const variant = { ...request, intent: { ...request.intent, options: { ...request.intent.options, vquality } } };
        client.setQueryData(["model-picker-quote", "quote-user", variant], { quote: { amountMicrocredits, videoUnitPriceMicrocredits, estimated: true, billingMode: "token" } });
    }
    const markup = renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <ModelPickerOption config={config} model={config.model} capability="video" showPrice quoteUserId="quote-user" requirements={selected} owner="test-picker" onSelect={() => {}} />
        </QueryClientProvider>,
    );
    const firstQuote = '<span>480P <strong>0.21</strong><span class="model-picker-tariff-unit">/秒</span></span>';
    const secondQuote = '<span>720P <strong>0.48</strong><span class="model-picker-tariff-unit">/秒</span></span>';
    expect(markup).toContain(firstQuote);
    expect(markup).toContain(secondQuote);
    expect(markup.split(secondQuote)).toHaveLength(2);
    expect(markup.indexOf(firstQuote)).toBeLessThan(markup.indexOf(secondQuote));
    expect(markup).toContain('title="0.21 积分/秒"');
    expect(markup).not.toContain("12.06");
});

test("video Token badges use compact units while retaining exact rates and full pricing descriptions", () => {
    for (const [rates, expected] of [
        [[0], "0 /M Token"],
        [[1], "0.000001 /M Token"],
        [[21_980_000], "21.98 /M Token"],
        [[24_750_000, 48_510_000], "24.75-48.51 /M Token"],
    ] as const) {
        const config = fixture();
        const cost = config.channels[0].modelCosts![0];
        cost.billingMode = "token";
        cost.referenceVideoBilling = true;
        cost.capabilityConfig = defaultModelCapabilityConfig();
        cost.capabilityConfig.video!.references.maxVideos = 3;
        cost.logicalPriceTiers = rates.map((rate) => ({
            selector: {},
            resolution: "*",
            videoSeconds: 0,
            billingMode: "token",
            unitPriceMicrocredits: 0,
            inputTokenPriceMicrocredits: 0,
            outputTokenPriceMicrocredits: rate,
            cachedTokenPriceMicrocredits: 0,
            referenceVideoOutputTokenPriceMicrocredits: 50_000_000,
        }));
        const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);
        const visibleText = markup.replace(/<[^>]*>/g, "");
        expect(visibleText).toContain(expected);
        expect(visibleText).not.toContain("百万视频 Token");
        expect(visibleText).not.toContain("参考视频另计费");
        expect(markup).toContain('title="系统规格价格：');
        expect(markup).toContain("积分/百万视频 Token");
        expect(markup).toContain("优先按有效上游用量结算");
    }
});

test("model rows omit reference video billing labels while keeping prices and reference limits", () => {
    for (const billed of [true, false]) {
        const config = fixture();
        const cost = config.channels[0].modelCosts![0];
        cost.referenceVideoBilling = billed;
        cost.capabilityConfig = defaultModelCapabilityConfig();
        cost.capabilityConfig.video!.references.maxVideos = 3;
        for (const tier of cost.logicalPriceTiers!) tier.referenceVideoUnitPriceMicrocredits = billed ? 2_000_000 : 0;
        const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);
        expect(markup).not.toContain("参考视频另计费");
        expect(markup).not.toContain("参考视频不计费");
        expect(markup).toContain("model-picker-tariff-help");
        expect(markup).toContain("480P <strong>0.10</strong>");
        expect(markup).toContain("720P <strong>0.20</strong>");
        expect(markup).toContain("视×3");
    }
});

test("unified video Token pricing uses the same compact label and full unit explanation", () => {
    const config = fixture();
    const cost = config.channels[0].modelCosts![0];
    cost.pricePolicy = "unified";
    cost.billingMode = "token";
    cost.outputTokenPriceMicrocredits = 35_240_000;
    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);
    expect(markup.replace(/<[^>]*>/g, "")).toContain("35.24 /M Token");
    expect(markup).toContain('title="35.24 积分/百万视频 Token；');
});

test("unified image usage pricing estimates from usage instead of appearing free", () => {
    const config = fixture();
    const cost = config.channels[0].modelCosts![0];
    cost.capability = "image";
    cost.pricePolicy = "unified";
    cost.billingMode = "image_usage";
    cost.unitPriceMicrocredits = 0;
    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="image" showPrice owner="test-picker" onSelect={() => {}} />);
    expect(markup).toContain("按图片输入张数及实际输出像素计费");
    expect(markup).not.toContain("积分/次");
});

test("candidate rows do not disguise missing prices as zero", () => {
    const config = fixture();
    config.channels[0].modelCosts![0].logicalPriceTiers = [];
    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);
    expect(markup).toContain("未配置");
    expect(markup).not.toContain("0 积分");
});

test("model rows preserve multiple promotional labels and colors without altering prices", () => {
    const config = fixture();
    config.channels[0].modelCosts![0].tags = [
        { text: "限时特价", color: "purple" },
        { text: "官方1折", color: "gold" },
    ];
    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);
    expect(markup).toContain('data-color="purple">限时特价');
    expect(markup).toContain('data-color="gold">官方1折');
    expect(markup).toContain("480P <strong>0.10</strong>");
    expect(markup).toContain("720P <strong>0.20</strong>");
    config.channels[0].modelCosts![0].tags = [];
    const withoutTags = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" owner="test-picker" onSelect={() => {}} />);
    expect(withoutTags).not.toContain("限时特价");
    expect(withoutTags).not.toContain("官方1折");
});

test("video capability tag is derived from limits and precedes editable model tags", () => {
    const config = fixture();
    const cost = config.channels[0].modelCosts![0];
    cost.capabilityConfig = defaultModelCapabilityConfig();
    Object.assign(cost.capabilityConfig.video!.references, { maxImages: 30, maxVideos: 10, maxAudios: 10 });
    cost.tags = [
        { text: "限时特价", color: "purple" },
        { text: "按次收费", color: "blue" },
    ];

    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);

    expect(markup).toContain('data-color="green">图×30 · 视×10 · 音×10');
    expect(markup.indexOf("图×30 · 视×10 · 音×10")).toBeLessThan(markup.indexOf("限时特价"));
    expect(markup.indexOf("限时特价")).toBeLessThan(markup.indexOf("按次收费"));
});

test("video capability tag omits zero limits while preserving editable model tags", () => {
    const config = fixture();
    const cost = config.channels[0].modelCosts![0];
    cost.capabilityConfig = defaultModelCapabilityConfig();
    Object.assign(cost.capabilityConfig.video!.references, { maxImages: 0, maxVideos: 0, maxAudios: 0 });
    cost.tags = [{ text: "按次收费", color: "blue" }];

    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="video" showPrice owner="test-picker" onSelect={() => {}} />);

    expect(markup).not.toContain("图×");
    expect(markup).not.toContain("视×");
    expect(markup).not.toContain("音×");
    expect(markup).toContain('data-color="blue">按次收费');
});

test("the selected model and request estimate still require an exact specification match", () => {
    const config = fixture();
    const render = (value: ModelRequirements) => renderToStaticMarkup(<ModelPicker config={config} value={config.model} capability="video" requirements={value} onChange={() => {}} />);
    expect(render(requirements)).toContain("当前规格无报价");
    const cost = (value: ModelRequirements) => requestCreditCost({ channelMode: "remote", modelCosts: config.channels[0].modelCosts, model: "h3-multi", capability: "video", config, requirements: value, seconds: "6" });
    expect(cost(requirements)).toBeNull();
    const matching = { ...requirements, videoSeconds: "6", options: { vquality: "720p" } };
    expect(render(matching)).toContain("<strong>0.20</strong> 积分/秒");
    expect(render(matching)).not.toContain("当前规格无报价");
    expect(cost(matching)).toBeCloseTo(1.2);
});

function textFixture() {
    const channel = createModelChannel({
        id: "qwen",
        name: "Qwen",
        scope: "system",
        models: ["qwen3.8-max"],
        modelCosts: [{ model: "qwen3.8-max", displayName: "Qwen3.8-Max-0902", capability: "text", billingMode: "per_request", unitPriceMicrocredits: 10_000 }],
    });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "qwen::qwen3.8-max", textModel: "qwen::qwen3.8-max" } }).config;
}

test("text models show how many images and videos they can read, like video reference limits", () => {
    const config = textFixture();
    const cost = config.channels[0].modelCosts![0];
    cost.capabilityConfig = defaultModelCapabilityConfig();
    Object.assign(cost.capabilityConfig.text!.references, { maxImages: 9, maxVideos: 3 });
    cost.tags = [{ text: "按次收费", color: "blue" }];
    const markup = renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="text" showPrice owner="test-picker" onSelect={() => {}} />);
    expect(markup).toContain('data-color="green">图×9 · 视×3');
    expect(markup).not.toContain("音×");
    expect(markup.indexOf("图×9 · 视×3")).toBeLessThan(markup.indexOf("按次收费"));
});

test("text models without video understanding only show the image limit, and none when vision is off", () => {
    const config = textFixture();
    const cost = config.channels[0].modelCosts![0];
    cost.capabilityConfig = defaultModelCapabilityConfig();
    Object.assign(cost.capabilityConfig.text!.references, { maxImages: 9, maxVideos: 0 });
    const render = () => renderToStaticMarkup(<ModelPickerOption config={config} model={config.model} capability="text" showPrice={false} owner="test-picker" onSelect={() => {}} />);
    expect(render()).toContain('data-color="green">图×9<');
    expect(render()).not.toContain("视×");
    Object.assign(cost.capabilityConfig.text!.references, { maxImages: 0, maxVideos: 0 });
    expect(render()).not.toContain("图×");
});
