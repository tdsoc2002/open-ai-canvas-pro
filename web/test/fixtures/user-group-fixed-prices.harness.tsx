import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { UserGroupFormValues } from "@/pages/admin/user-groups/user-group-form";
import type { UserGroup } from "@/services/api/user-groups";

test("分组专属单价可录入、编辑回读和删除", async () => {
    const dom = new Window({ url: "http://localhost/" });
    const globals = {
        window: dom,
        document: dom.document,
        navigator: dom.navigator,
        HTMLElement: dom.HTMLElement,
        SVGElement: dom.SVGElement,
        Element: dom.Element,
        Node: dom.Node,
        Event: dom.Event,
        ShadowRoot: dom.ShadowRoot,
        ResizeObserver: dom.ResizeObserver,
        MutationObserver: dom.MutationObserver,
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { Form } = await import("antd");
    const { UserGroupFixedPrices } = await import("@/pages/admin/user-groups/user-group-fixed-prices");
    const { emptyUserGroupForm, userGroupFormValues, userGroupInput } = await import("@/pages/admin/user-groups/user-group-form");
    const query = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    query.setQueryData(["admin", "group-price-channel-models"], { models: [] });
    const logicalKey = ["admin", "group-price-logical-models"];
    const timedModel = { id: "audio", code: "test-audio", name: "按秒模型", capability: "audio", pricePolicy: "unified", billingMode: "per_second" };
    query.setQueryData(logicalKey, {
        models: [{ id: "model", code: "test-model", name: "测试模型", capability: "text", pricePolicy: "unified", billingMode: "fixed_request" }, timedModel],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let readForm!: () => UserGroupFormValues;
    let validate!: () => Promise<UserGroupFormValues>;

    function Editor({ saved }: { saved?: UserGroup }) {
        const [form] = Form.useForm<UserGroupFormValues>();
        readForm = () => form.getFieldsValue(true);
        validate = () => form.validateFields();
        return (
            <Form form={form} initialValues={saved ? userGroupFormValues(saved) : emptyUserGroupForm()}>
                <UserGroupFixedPrices open form={form} />
            </Form>
        );
    }

    const render = (saved?: UserGroup) =>
        act(async () =>
            root.render(
                <QueryClientProvider client={query}>
                    <Editor key={saved ? "saved" : "new"} saved={saved} />
                </QueryClientProvider>,
            ),
        );

    async function selectModel(name: string) {
        await act(async () => {
            const select = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
            select.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true }));
        });
        const option = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((item) => item.textContent?.includes(name));
        expect(option).toBeDefined();
        await act(async () => option!.click());
    }

    try {
        await render();
        await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
        await selectModel("测试模型");
        const input = host.querySelector<HTMLInputElement>('[role="spinbutton"]')!;
        expect(input).not.toBeNull();
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, "3.5");
            input.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        await act(async () => {
            await validate();
        });
        const saved = userGroupInput(readForm());
        expect(saved.modelOverrides[0]?.fixedPrice?.unitPriceMicrocredits).toBe(3_500_000);
        const group = { id: "vip", ...saved, isDefault: false, userCount: 1, createdAt: "", updatedAt: "" };
        await render(group);
        expect(Number(host.querySelector<HTMLInputElement>('[role="spinbutton"]')?.value)).toBe(3.5);
        await selectModel("按秒模型");
        expect(host.textContent).toContain("积分/秒");
        expect(host.querySelector<HTMLInputElement>('[role="spinbutton"]')?.value).toBe("");
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除这条专属单价"]')!.click());
        expect(userGroupInput(readForm()).modelOverrides).toEqual([]);

        await render();
        query.setQueryData(logicalKey, { models: [timedModel] });
        await render(group);
        expect(host.textContent).toContain("价格档已失效");
        await act(async () => {
            await validate();
        });
        expect(userGroupInput(readForm()).modelOverrides).toEqual(saved.modelOverrides);
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除这条专属单价"]')!.click());
        expect(userGroupInput(readForm()).modelOverrides).toEqual([]);
    } finally {
        await act(async () => root.unmount());
        query.clear();
        dom.happyDOM.abort();
        for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    }
});
