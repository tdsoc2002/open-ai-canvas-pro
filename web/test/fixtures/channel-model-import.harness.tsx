import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ChannelModel } from "../../src/services/api/wallet";

const dom = new Window({ url: "http://localhost/admin/channels" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    HTMLInputElement: dom.HTMLInputElement,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { ChannelModelManager } = await import("../../src/pages/admin/components/channel-model-manager");
const { apiClient } = await import("../../src/services/api/request");

afterAll(() => dom.happyDOM.abort());

const existingModel: ChannelModel = {
    id: "existing",
    channelId: "test",
    modelKey: "existing",
    providerModelKey: "existing",
    displayName: "现有模型",
    icon: "",
    capability: "image",
    billingMode: "fixed_request",
    unitPriceMicrocredits: 2,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    cacheWriteTokenPriceMicrocredits: 0,
    priceConfigured: true,
    enabled: true,
    priceVersion: 1,
    priceTiers: [],
    createdAt: "",
    updatedAt: "",
};

function button(label: string): HTMLButtonElement {
    const element = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.replace(/\s+/g, "") === label);
    expect(element).toBeDefined();
    return element!;
}

function checkbox(id: string): HTMLInputElement {
    const control = [...document.querySelectorAll<HTMLInputElement>(".admin-model-import-modal input[type=checkbox]")].find((input) => input.value === id);
    expect(control).toBeDefined();
    return control!;
}

async function preview(upstream: { models: string[]; catalog?: Array<Record<string, string>> }, check: (requests: unknown[]) => Promise<void>) {
    const adapter = apiClient.defaults.adapter;
    const requests: unknown[] = [];
    apiClient.defaults.adapter = async (config) => {
        let data: unknown;
        switch (config.url) {
            case "/plugins/catalog":
                data = { providers: [] };
                break;
            case "/admin/channels/test/models":
                data = { models: [existingModel] };
                break;
            case "/admin/channels/test/catalog-status":
                data = { models: [], stale: false };
                break;
            case "/admin/channels/test/models/fetch":
                data = { ...upstream, readAt: "2026-01-01T00:00:00Z", firstRead: false, added: upstream.models.filter((name) => name !== "existing"), retained: upstream.models.filter((name) => name === "existing"), missing: [] };
                break;
            case "/admin/channels/test/models/import":
                requests.push(JSON.parse(config.data));
                data = { models: ["models/Unseen-V7"], added: 1 };
                break;
            default:
                throw new Error(`非预期请求：${config.url}`);
        }
        return { config, data: { code: 0, data, msg: "ok" }, headers: {}, status: 200, statusText: "OK" };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <App>
                    <ChannelModelManager channel={{ id: "test", name: "测试渠道", baseUrl: "https://example.com/v1", apiFormat: "openai", apiKey: "", models: [] }} onChanged={() => {}} />
                </App>,
            ),
        );
        await act(async () => button("读取模型").click());
        expect(button("确认导入")).toBeDefined();
        expect(requests).toEqual([]);
        await check(requests);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.defaults.adapter = adapter;
    }
}

test("目录预览显示能力与不可用原因，只提交新选中的可用模型与指纹", async () => {
    await preview(
        {
            models: ["existing", "models/Unseen-V7", "unsupported", "unverified"],
            catalog: [
                { id: "existing", capability: "image", protocol: "tack2ai-image", fingerprint: "fp-existing" },
                { id: "models/Unseen-V7", capability: "video", protocol: "tack2ai-video", fingerprint: "fp-video" },
                { id: "unsupported", unavailableReason: "目录声明了暂不支持的协议" },
                { id: "unverified", capability: "text", protocol: "tack2ai-chat" },
            ],
        },
        async (requests) => {
            expect(checkbox("existing").checked).toBe(true);
            expect(checkbox("models/Unseen-V7").checked).toBe(false);
            expect(button("确认导入").disabled).toBe(true);
            expect(checkbox("models/Unseen-V7").closest("label")?.textContent).toContain("新增");
            expect(checkbox("models/Unseen-V7").closest("label")?.textContent).toContain("视频 · tack2ai-video");
            expect(checkbox("unsupported").closest("label")?.textContent).toContain("目录声明了暂不支持的协议");
            expect(checkbox("unsupported").disabled).toBe(true);
            expect(checkbox("unverified").disabled).toBe(true);

            await act(async () => button("全选").click());
            expect(checkbox("unsupported").checked).toBe(false);
            expect(checkbox("unverified").checked).toBe(false);
            expect(checkbox("models/Unseen-V7").checked).toBe(true);
            await act(async () => button("确认导入").click());
            expect(requests).toEqual([{ models: ["models/Unseen-V7"], catalogFingerprints: { "models/Unseen-V7": "fp-video" } }]);
        },
    );
});

test("只有不可导入条目时仍显示原因，不能全选或提交", async () => {
    await preview({ models: [], catalog: [{ id: "unsupported", unavailableReason: "目录能力冲突" }] }, async (requests) => {
        expect(checkbox("unsupported").closest("label")?.textContent).toContain("目录能力冲突");
        expect(button("全选").disabled).toBe(true);
        expect(button("确认导入").disabled).toBe(true);
        expect(requests).toEqual([]);
    });
});

test("旧渠道仍默认勾选现有模型并按原请求体导入", async () => {
    await preview({ models: ["existing", "models/Unseen-V7"] }, async (requests) => {
        const dialog = button("确认导入").closest('[role="dialog"]');
        expect(checkbox("existing").checked).toBe(true);
        expect(checkbox("models/Unseen-V7").checked).toBe(false);
        expect(dialog?.textContent).toContain("所选模型均已存在");
        await act(async () => button("取消全选").click());
        expect(dialog?.textContent).toContain("未选择模型");
        expect(dialog?.textContent).not.toContain("所选模型均已存在");
        await act(async () => checkbox("existing").click());
        await act(async () => checkbox("models/Unseen-V7").click());
        expect(dialog?.textContent).toContain("将导入 1 个新模型");
        await act(async () => button("确认导入").click());
        expect(requests).toEqual([{ models: ["existing", "models/Unseen-V7"] }]);
    });
});
