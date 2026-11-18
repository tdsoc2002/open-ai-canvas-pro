import { describe, expect, test } from "bun:test";
import { taskGenerationParameters } from "../src/pages/tasks/task-generation-parameters";

describe("创作历史的当次参数", () => {
    test("区分关闭、自动与未记录", () => {
        expect(taskGenerationParameters('{"generationParameters":{"vquality":"480","size":"16:9","videoSeconds":"-1","videoGenerateAudio":false}}', "video")).toEqual({
            resolution: "480p",
            ratio: "16:9",
            duration: "auto",
            audio: false,
        });
        expect(taskGenerationParameters('{"generationParameters":{"size":"16:9","videoSeconds":2}}', "video")).toEqual({
            resolution: undefined,
            ratio: "16:9",
            duration: 2,
            audio: undefined,
        });
    });

    test("像素尺寸化简比例，已记录比例优先，画质不当成分辨率", () => {
        expect(taskGenerationParameters('{"generationParameters":{"size":"1536×1024","quality":"high"}}', "image")).toEqual({ resolution: "1536 × 1024", ratio: "3:2", extras: [{ key: "quality", value: "high" }] });
        expect(taskGenerationParameters('{"generationParameters":{"size":"2k","aspect_ratio":"9:16"}}', "image")).toEqual({ resolution: "2K", ratio: "9:16" });
        expect(taskGenerationParameters('{"generationParameters":{"size":"1824x1024"}}', "image").ratio).toBe("16:9");
        expect(taskGenerationParameters('{"generationParameters":{"size":"1001x1000"}}', "image").ratio).toBe("1001:1000");
    });

    test("从旧工作台快照读取，不从当前配置或错误数据猜测", () => {
        expect(taskGenerationParameters('{"workbench":{"kind":"video","parameters":{"ratio":"1:1","resolution":"720p","seconds":4,"generateAudio":true}}}', "video")).toEqual({
            resolution: "720p",
            ratio: "1:1",
            duration: 4,
            audio: true,
        });
        expect(taskGenerationParameters('{"config":{"size":"16:9","videoGenerateAudio":true}}', "video").audio).toBeUndefined();
        expect(taskGenerationParameters("not-json", "video")).toEqual({});
        expect(taskGenerationParameters('{"generationParametersUnavailable":true}', "video")).toEqual({ unavailable: true });
    });

    test("扩展字段只显示实际记录值，关闭和零压缩值保留", () => {
        expect(taskGenerationParameters('{"generationParameters":{"count":3,"outputFormat":"webp","transparentBackground":false,"outputCompression":0,"referenceImages":2,"referenceVideos":0}}', "image").extras).toEqual([
            { key: "count", value: 3 },
            { key: "outputFormat", value: "WEBP" },
            { key: "transparentBackground", value: false },
            { key: "outputCompression", value: 0 },
            { key: "referenceImages", value: 2 },
        ]);
        expect(taskGenerationParameters('{"generationParameters":{"videoWatermark":false,"referenceVideos":1}}', "video").extras).toEqual([
            { key: "watermark", value: false },
            { key: "referenceVideos", value: 1 },
        ]);
        expect(taskGenerationParameters('{"generationParameters":{"audioVoice":"alloy","audioSpeed":1.35},"config":{"audioFormat":"mp3"}}', "audio").extras).toEqual([
            { key: "voice", value: "Alloy" },
            { key: "audioSpeed", value: 1.35 },
        ]);
        expect(taskGenerationParameters('{"generationParameters":{"thinking":false}}', "text").extras).toEqual([{ key: "thinking", value: false }]);
        expect(taskGenerationParameters('{"generationParameters":{},"textOptions":{"thinking":true}}', "text").extras).toBeUndefined();
        expect(taskGenerationParameters('{"generationParameters":{"count":100}}', "image").extras).toEqual([{ key: "count", value: 100 }]);
    });
});
