import { describe, expect, test } from "bun:test";

import { filterWorkbenchTools, workbenchTaskSnapshot } from "../src/pages/workbench/image-workbench-page";
import { workbenchImageQuoteRequest } from "../src/pages/workbench/workbench-input";
import { workbenchSceneLibraryTools } from "../src/pages/workbench/workbench-presets";
import { createModelChannel, defaultConfig } from "@/stores/use-config-store";
import type { GenerationTask } from "@/services/api/task-center";
import type { WorkbenchTool } from "@/services/api/workbench";

const tools: WorkbenchTool[] = [
    { id: "face", kind: "image", categoryId: "people", name: "脸部三视图", subtitle: "生成正脸、侧脸", description: "角色参考", sortOrder: 0, enabled: true, supportedModes: ["image"], presets: [] },
    { id: "product", kind: "image", categoryId: "product", name: "商品白底图", subtitle: "生成商品图", description: "电商产品", sortOrder: 1, enabled: true, supportedModes: ["image"], presets: [] },
];

describe("workbenchTaskSnapshot", () => {
    test("restores video settings and reference identity from safe task details", () => {
        const task = {
            inputJson: JSON.stringify({
                metadata: {
                    source: "workbench",
                    workbenchKind: "video",
                    workbenchToolId: "tool-video",
                    workbenchPresetId: "preset-video",
                    workbench: {
                        kind: "video",
                        parameters: { seconds: 8, ratio: "16:9", resolution: "1080p", generateAudio: true, watermark: false },
                        references: [{ resourceId: "resource-1", kind: "image", role: "first_frame", slotKey: "subject" }],
                    },
                },
            }),
        } as GenerationTask;

        expect(workbenchTaskSnapshot(task)).toEqual({
            kind: "video",
            toolId: "tool-video",
            presetId: "preset-video",
            parameters: { seconds: 8, ratio: "16:9", resolution: "1080p", generateAudio: true, watermark: false },
            references: [{ resourceId: "resource-1", kind: "image", role: "first_frame", slotKey: "subject" }],
        });
    });

    test("does not treat a task-list summary as loaded restore data", () => {
        expect(workbenchTaskSnapshot({ id: "summary" } as GenerationTask)).toBeNull();
    });
});

describe("filterWorkbenchTools", () => {
    test("combines category and case-insensitive text search", () => {
        expect(filterWorkbenchTools(tools, "people", "侧脸").map((tool) => tool.id)).toEqual(["face"]);
        expect(filterWorkbenchTools(tools, "people", "商品")).toEqual([]);
    });

    test("searches tool description and returns all tools for blank query", () => {
        expect(filterWorkbenchTools(tools, "all", "电商").map((tool) => tool.id)).toEqual(["product"]);
        expect(filterWorkbenchTools(tools, "all", "  ")).toHaveLength(2);
    });
});

test("场景库优先展示常用场景，不重复或丢失其他场景", () => {
    const ordered = workbenchSceneLibraryTools(tools, [tools[1]]);
    expect(ordered.map((tool) => tool.id)).toEqual(["product", "face"]);
    expect(filterWorkbenchTools(ordered, "people", "").map((tool) => tool.id)).toEqual(["face"]);
    expect(workbenchSceneLibraryTools(tools)).toBe(tools);
});

test("系统图片报价使用提交规格；缺商品原图时按必填素材预估图生图", () => {
    const channel = createModelChannel({
        id: "tencent",
        scope: "system",
        models: ["image-2"],
        modelCosts: [{ model: "image-2", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 120_000 }],
    });
    const model = "tencent::image-2";
    const config = { ...defaultConfig, channels: [channel], model, size: "16:9", quality: "high", count: "1", transparentBackground: "true" };
    const slots = [
        { key: "product", name: "商品原图", required: true, minCount: 1, maxCount: 4, mediaTypes: ["image" as const] },
        { key: "detail", name: "细节参考图", required: false, minCount: 0, maxCount: 4, mediaTypes: ["image" as const] },
    ];
    const options = { size: "1:1", imageResolution: "1k", quality: "low", count: 2 };

    expect(workbenchImageQuoteRequest(config, model, options, slots, [])).toEqual({
        channelId: "tencent",
        modelKey: "image-2",
        intent: { capability: "image", operation: "image_to_image", inputs: { image: 1, video: 0, audio: 0 }, options },
    });
    const references = [
        { kind: "image", slotKey: "product", resourceId: "original" },
        { kind: "image", slotKey: "detail", resourceId: "reference" },
        { kind: "image", slotKey: "detail", uploading: true },
    ];
    expect(workbenchImageQuoteRequest(config, model, options, slots, references)?.intent.inputs?.image).toBe(2);
    expect(workbenchImageQuoteRequest(config, model, options, [], [])?.intent.operation).toBe("text_to_image");
    expect(workbenchImageQuoteRequest({ ...config, channels: [{ ...channel, scope: "user" }] }, model, options, slots, references)).toBeUndefined();
});
