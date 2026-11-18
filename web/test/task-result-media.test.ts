import { expect, test } from "bun:test";
import { taskResultMedia, taskResultResourceId, taskResultText } from "../src/pages/tasks/task-result-media";

test("历史入库定位当前结果的资源，不使用结果序号、参考图或 URL 查询参数", () => {
    const raw = JSON.stringify({ images: [{ dataUrl: "https://cdn.example.test/result.jpg", storageKey: "resource:result-a", posterUrl: "/api/resources/poster/file" }, { dataUrl: "/api/resources/result-b/file?variant=original" }] });
    const results = taskResultMedia(raw, "image");
    expect(results.map(taskResultResourceId)).toEqual(["result-a", "result-b"]);
    expect(taskResultResourceId({ url: "https://cdn.example.test/image.jpg?path=/api/resources/fake/file", kind: "image" })).toBe("");
});

test("历史详情识别无扩展名的本地媒体，不把封面和参考图当成结果", () => {
    const raw = JSON.stringify({ video: { url: "/api/resources/video/file?variant=playback", posterUrl: "/api/resources/cover/file" }, images: ["/api/resources/image/file"], referenceImage: "/api/resources/reference/file" });
    expect(taskResultMedia(raw, "video")).toEqual([
        { url: "/api/resources/video/file?variant=playback", kind: "video" },
        { url: "/api/resources/image/file", kind: "image" },
    ]);
});

test("无可预览详情时保留已有摘要，不把不可信路径当成媒体", () => {
    const fallback = { url: "/api/resources/media/file", kind: "video" as const };
    expect(taskResultMedia('{"url":"file:///tmp/result.mp4"}', "video", fallback)).toEqual([fallback]);
    expect(taskResultMedia('{"url":"//unknown.example/video.mp4"}', "video")).toEqual([]);
    expect(taskResultMedia('{"url":"/api/resources/../file"}', "video")).toEqual([]);
});

test("音频读取持久化结果、识别 MIME 和格式、去掉重复及参考项", () => {
    const main = { dataUrl: "/api/resources/voice-1/file", url: "/api/resources/voice-1/file", mimeType: "audio/mpeg" };
    const raw = JSON.stringify({
        audio: main,
        audios: [main, { url: "/api/resources/voice-2/file" }, { audioUrl: "https://media.example.test/voice.opus" }],
        referenceAudio: "/api/resources/input/file",
        metadata: { audioUrl: "/api/resources/metadata/file" },
    });
    expect(taskResultMedia(raw, "audio")).toEqual([
        { url: "/api/resources/voice-1/file", kind: "audio" },
        { url: "/api/resources/voice-2/file", kind: "audio" },
        { url: "https://media.example.test/voice.opus", kind: "audio" },
    ]);
    expect(taskResultMedia('{"output":{"url":"/api/resources/voice/file","mimeType":"audio/wav"}}', "audio")).toEqual([{ url: "/api/resources/voice/file", kind: "audio" }]);
    expect(taskResultMedia('{"audio":"javascript:alert(1)","coverUrl":"https://media.example.test/cover.png"}', "audio")).toEqual([]);
});

test("伴随音频不会取代原有视频预览或摘要回退", () => {
    const video = { url: "/api/resources/video/file", kind: "video" as const };
    expect(taskResultMedia('{"audio":"https://media.example.test/voice.mp3","video":{"url":"/api/resources/video/file"}}', "video")).toEqual([video]);
    expect(taskResultMedia('{"output":{"url":"/api/resources/voice/file","mimeType":"audio/wav"}}', "video", video)).toEqual([video]);
    const signedVideo = "https://media.example.test/video.mp4?label=track.mp3";
    expect(taskResultMedia(JSON.stringify({ url: signedVideo }), "video")).toEqual([{ url: signedVideo, kind: "video" }]);
});

test("文本正文优先正式结果，只在没有正文时使用草稿", () => {
    expect(taskResultText('{"text":"第一行\\n第二行","reasoning":"内部推理"}', "旧草稿")).toBe("第一行\n第二行");
    expect(taskResultText('{"content":"内容"}')).toBe("内容");
    expect(taskResultText('{"output":"输出"}')).toBe("输出");
    expect(taskResultText('"旧正文"')).toBe("旧正文");
    expect(taskResultText("旧版未封装正文")).toBe("旧版未封装正文");
    expect(taskResultText("[链接](https://example.test)\n第二行")).toBe("[链接](https://example.test)\n第二行");
    expect(taskResultText('{"text":" ","reasoning":"内部推理","prompt":"原提示词"}', "实时草稿")).toBe("实时草稿");
    expect(taskResultText('{"reasoning":"内部推理","prompt":"原提示词"}')).toBe("");
    expect(taskResultText('{"reasoning":"内部推理","prompt":"原提示词",')).toBe("");
    expect(taskResultText('{"reasoning":"内部推理","prompt":"原提示词",', "已保存正文草稿")).toBe("已保存正文草稿");
    expect(taskResultText('{"text":[{"type":"reasoning","text":"隐含推理"},{"content":"正文块"},{"text":"下一节"}]}')).toBe("正文块下一节");
    const storyboard = taskResultText('{"text":{"title":"章节","rows":[{"shotNumber":1,"plotDescription":"一镜","prompt":"不展示"}]}}');
    expect(JSON.parse(storyboard)).toEqual({ title: "章节", rows: [{ shotNumber: 1, plotDescription: "一镜" }] });
});
