import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://site.example.com/settings" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    location: dom.location,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { apiClient } = await import("../src/services/api/request");
const { useUserStore } = await import("../src/stores/use-user-store");
const { UserOSSSettingsForm } = await import("../src/components/layout/user-oss-settings-form");
const { default: SettingsPage } = await import("../src/pages/settings");
const { MemoryRouter, useLocation } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const originalAdapter = apiClient.defaults.adapter;
const originalUser = useUserStore.getState().user;
const originalFeatures = useUserStore.getState().features;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.setState({ user: originalUser, features: originalFeatures });
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function LocationProbe() {
    return <output data-location>{useLocation().search}</output>;
}

async function renderPolicy(allowed: boolean, settingsPage = false) {
    apiClient.defaults.adapter = async (config) => {
        if (config.method !== "get") throw new Error("Unexpected storage write");
        const data =
            config.url === "/settings/oss"
                ? { setting: { enabled: false, provider: "aliyun", allowUserS3: allowed, bucket: "", endpoint: "", region: "", accessKeyId: "", pathPrefix: "", cdnBaseUrl: "" } }
                : { enabled: false, channels: [], models: [], settings: { consumptionReportEnabled: false }, user: useUserStore.getState().user };
        return {
            config,
            status: 200,
            statusText: "OK",
            headers: {},
            data: { code: 0, data },
        };
    };
    useUserStore.setState({ user: { id: "storage-user", username: "storage-user", displayName: "Storage user", role: "user", status: "active" }, features: { ...originalFeatures, customChannelsEnabled: false } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () =>
        root!.render(
            <App>
                {settingsPage ? (
                    <MemoryRouter initialEntries={["/settings?section=storage"]}>
                        <QueryClientProvider client={client}>
                            <SettingsPage />
                            <LocationProbe />
                        </QueryClientProvider>
                    </MemoryRouter>
                ) : (
                    <UserOSSSettingsForm />
                )}
            </App>,
        ),
    );
    await act(async () => {
        await Promise.resolve();
    });
    if (settingsPage)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
}

test("a disabled personal-storage policy removes all provider configuration and write controls", async () => {
    await renderPolicy(false);
    expect(host.textContent).toContain("平台管理员尚未允许个人");
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).not.toContain("保存个人对象存储");
    expect(host.textContent).not.toContain("测试连接");
});

test("an enabled policy still allows configuring personal storage", async () => {
    await renderPolicy(true);
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("input")).not.toBeNull();
    expect(host.textContent).toContain("保存个人对象存储");
});

test("disabled storage has no menu or empty integrations group, and direct links return to profile", async () => {
    await renderPolicy(false, true);
    const nav = host.querySelector("nav[aria-label='配置分类']")!;
    expect(nav).not.toBeNull();
    expect(nav.textContent).not.toContain("我的对象存储");
    expect(nav.textContent).not.toContain("渠道与存储");
    expect(host.querySelector("[data-location]")?.textContent).toBe("?section=profile");
});

test("enabled storage keeps its menu, integrations group and direct link", async () => {
    await renderPolicy(true, true);
    const nav = host.querySelector("nav[aria-label='配置分类']")!;
    expect(nav.textContent).toContain("我的对象存储");
    expect(nav.textContent).toContain("渠道与存储");
    expect(host.querySelector("[data-location]")?.textContent).toBe("?section=storage");
});
