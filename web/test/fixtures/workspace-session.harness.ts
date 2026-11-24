import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const space = process.env.TEST_WORKSPACE || "";
const dom = new Window({ url: `http://localhost${space ? `/teams/${space}` : ""}/create` });
Object.assign(globalThis, { window: dom, document: dom.document, CustomEvent: dom.CustomEvent });
const { getActiveUserScope, setActiveUserScope, scopedStorageKey } = await import("@/lib/user-scope");
const { createGenerationTask } = await import("@/services/api/task-center");
const { runBackendGenerationTaskBatch } = await import("@/services/api/generation-task");
const { createModelChannel, defaultConfig, encodeChannelModel } = await import("@/stores/use-config-store");
const { apiClient, http } = await import("@/services/api/request");
afterAll(() => dom.happyDOM.abort());

test("content stays in its workspace; charging confirmation and replay use the authenticated account", async () => {
    setActiveUserScope("member");
    const scope = space ? `member:team:${space}` : "member";
    expect(getActiveUserScope()).toBe(scope);
    expect(scopedStorageKey("canvas")).toBe(`canvas:user:${scope}`);
    const prefix = space ? `/teams/${space}/workspace` : "";
    const paths: string[] = [];
    const submitted: { idempotencyKey: string; maxChargeMicrocredits: number }[] = [];
    apiClient.defaults.adapter = async (config) => {
        expect(config.headers.get("X-Canvas-Expected-User")).toBe("member");
        const path = config.url!;
        paths.push(path);
        let data: unknown = [];
        if (path === `${prefix}/tasks/quote`) data = { maxChargeMicrocredits: 500 };
        if (path === `${prefix}/tasks`) {
            submitted.push(JSON.parse(String(config.data)));
            if (submitted.length === 1) throw Object.assign(new Error("No response"), { isAxiosError: true, code: "ERR_NETWORK" });
            data = { id: "same-task", type: "canvas_text", status: "queued" };
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
    };
    await http.get("/assets");
    expect(paths).toEqual([`${prefix}/assets`]);
    if (!space) return;
    await expect(http.post("/projects", {})).rejects.toThrow();
    const input = { type: "canvas_text", operation: "text", prompt: "第一幕", input: { mode: "text", metadata: { messageId: "message-a" } } };
    dom.confirm = () => false;
    await expect(createGenerationTask(input)).rejects.toMatchObject({ name: "AbortError" });
    expect(paths).toEqual([`${prefix}/assets`, `${prefix}/tasks/quote`]);
    dom.confirm = () => true;
    await expect(createGenerationTask(input)).rejects.toThrow();
    expect((await createGenerationTask(input)).id).toBe("same-task");
    expect(submitted.map((body) => [body.idempotencyKey, body.maxChargeMicrocredits])).toEqual([
        ["message-a", 500],
        ["message-a", 500],
    ]);
    expect(paths.filter((path) => !path.startsWith(`${prefix}/`))).toBeEmpty();
});

test.skipIf(!space)("团队多图复用一次最高费用确认并逐张提交", async () => {
    setActiveUserScope("member");
    const paths: string[] = [];
    const requested: { maxChargeMicrocredits: number; idempotencyKey: string; input: { mode: string; metadata: { batchIndex: number; batchCount: number } } }[] = [];
    const messages: string[] = [];
    dom.confirm = (message) => {
        messages.push(message);
        return true;
    };
    apiClient.defaults.adapter = async (config) => {
        paths.push(config.url!);
        let data: unknown = { maxChargeMicrocredits: 50_000 };
        if (config.url?.endsWith("/tasks")) {
            const input = JSON.parse(String(config.data));
            requested.push(input);
            data = { id: input.idempotencyKey, type: "canvas_image", status: "queued" };
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
    };
    const channel = createModelChannel({ id: "system-images", scope: "system", interfaceType: "openai-images", models: ["gpt-image-1"] });
    const model = encodeChannelModel(channel.id, "gpt-image-1");
    const result = await runBackendGenerationTaskBatch(
        { mode: "image", prompt: "团队图片", count: 2, config: { ...defaultConfig, channels: [channel], model, count: "1" }, metadata: { messageId: "media-message" } },
        {
            createId: () => "fallback",
            createTask: createGenerationTask,
            waitTask: async (id) => ({
                id,
                type: "canvas_image",
                prompt: "团队图片",
                status: "succeeded",
                attempts: 1,
                createdAt: "",
                updatedAt: "",
                resultJson: '{"mode":"image","images":[{"dataUrl":"https://example.test/art.png"}]}',
            }),
        },
    );
    const prefix = `/teams/${space}/workspace`;
    expect(paths).toEqual([`${prefix}/tasks/quote`, `${prefix}/tasks`, `${prefix}/tasks`]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("0.1 积分");
    expect(requested.map(({ idempotencyKey, maxChargeMicrocredits, input }) => [idempotencyKey, maxChargeMicrocredits, input.mode, input.metadata.batchIndex, input.metadata.batchCount])).toEqual([
        ["media-message:batch:0", 50_000, "image", 0, 2],
        ["media-message:batch:1", 50_000, "image", 1, 2],
    ]);
    expect(result.every((entry) => entry.status === "fulfilled")).toBe(true);
});
