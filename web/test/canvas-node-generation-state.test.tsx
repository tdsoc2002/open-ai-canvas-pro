import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { CanvasNode } from "../src/components/canvas/canvas-node";
import { applyGenerationTaskResultToNodes } from "../src/lib/canvas/canvas-generation-task-sync";
import type { CanvasNodeRenderLOD } from "../src/lib/canvas/canvas-node-lod";
import { generationTaskMetadata } from "../src/lib/canvas/canvas-project-generation";
import { canvasNodeCanResyncTask, canvasTaskBindingStatus } from "../src/lib/canvas/canvas-task-state";
import { subscribeTaskTicker } from "../src/lib/canvas/task-ticker";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const noop = () => {};
const createdAt = () => new Date(Date.now() - 103_000).toISOString();
// 服务端渲染读取的是共享时钟的快照，只有被订阅时才会走动；整套测试里该模块可能早已加载，
// 渲染前先让它走一下，否则“已用时”会按模块加载时刻计算，测试结果取决于前面跑了多久。
const refreshTaskTicker = () => subscribeTaskTicker(() => {})();

function renderNode(metadata: CanvasNodeData["metadata"], type: CanvasNodeData["type"] = CanvasNodeType.Image, renderNodeContent?: (node: CanvasNodeData) => ReactNode, renderLOD?: CanvasNodeRenderLOD) {
    refreshTaskTicker();
    return renderToStaticMarkup(
        <CanvasNode
            data={{ id: "node", type, title: "去掉水印", position: { x: 0, y: 0 }, width: 240, height: 420, metadata }}
            scale={1}
            renderLOD={renderLOD}
            isSelected={false}
            isRelated={false}
            isFocusRelated={false}
            isConnectionTarget={false}
            showImageInfo={false}
            onMouseDown={noop}
            onHoverStart={noop}
            onHoverEnd={noop}
            onConnectStart={noop}
            onResize={noop}
            onContentChange={noop}
            onContextMenu={noop}
            onOpenTaskDetails={noop}
            onRetry={noop}
            onReloadResource={noop}
            renderNodeContent={renderNodeContent}
        />,
    );
}

const occurrences = (markup: string, text: string) => markup.split(text).length - 1;

test("视频节点缩小时沿用未生成空态，并保留已有视频封面", () => {
    const full = renderNode({}, CanvasNodeType.Video);
    const emptyContent = full.match(/<div class="canvas-video-empty".*?<\/div>/)?.[0] ?? "";
    expect(emptyContent).toContain("lucide-play");
    for (const lod of ["preview", "shell"] as const) {
        const markup = renderNode({}, CanvasNodeType.Video, undefined, lod);
        expect(markup).toContain(`data-node-lod="${lod}"`);
        expect(markup).toContain(emptyContent);
        for (const status of ["loading", "error"] as const) {
            expect(renderNode({ status }, CanvasNodeType.Video, undefined, lod)).not.toContain("canvas-video-empty");
        }
    }
    const preview = renderNode({ content: "/video.mp4", previewContent: "/cover.jpg" }, CanvasNodeType.Video, undefined, "preview");
    expect(preview).toContain('<img alt="去掉水印 静态预览"');
});

describe("画布节点生成中", () => {
    test("视频节点准备生成时显示四叶草、阶段和耗时", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "正在准备参考素材", taskCreatedAt: createdAt() }, CanvasNodeType.Video);
        expect(markup).toContain('<span class="loading-clover" aria-hidden="true"><i></i><i></i><i></i><i></i></span>');
        expect(markup).not.toContain("canvas-gen-ring");
        expect(markup).toContain("准备生成");
        expect(markup).toContain("已用时");
        expect(markup).not.toContain("generation-phase-steps");
        expect(markup).not.toContain("查看详情");
        expect(markup).not.toContain("canvas-gen-backdrop");
    });

    test("视频重生成持续显示虚化旧封面，直到新视频与完成状态一起写入", async () => {
        const task = {
            id: "new-task",
            type: "canvas_video",
            status: "succeeded" as const,
            prompt: "新提示词",
            attempts: 1,
            createdAt: createdAt(),
            updatedAt: "",
            previewKind: "video" as const,
            previewPosterUrl: "/new.jpg",
            resultJson: JSON.stringify({ video: { dataUrl: "/new.mp4" } }),
        };
        const regenerating: CanvasNodeData = {
            id: "node",
            type: CanvasNodeType.Video,
            title: "镜头",
            position: { x: 0, y: 0 },
            width: 640,
            height: 360,
            metadata: { status: "loading", taskId: task.id, taskStatus: "running", content: "/old.mp4", previewContent: "/old.jpg" },
        };
        const observed = { ...regenerating, metadata: { ...regenerating.metadata, ...generationTaskMetadata(task), status: canvasTaskBindingStatus(regenerating, task) } };
        expect(observed.metadata.status).toBe("loading");
        for (const lod of ["full", "preview"] as const) {
            const markup = renderNode(observed.metadata, CanvasNodeType.Video, undefined, lod);
            expect(markup).toContain('<div class="canvas-gen-backdrop" aria-hidden="true"><img alt=""');
            expect(markup).toContain("正在载入视频");
            expect(markup).not.toContain("<video");
        }

        const {
            nodes: [committed],
        } = await applyGenerationTaskResultToNodes([observed], task, observed.id);
        expect(committed.metadata).toMatchObject({ status: "success", content: "/new.mp4", previewContent: "/new.jpg" });
        expect(canvasTaskBindingStatus(committed, task)).toBe("success");
        const markup = renderNode(committed.metadata, CanvasNodeType.Video);
        expect(markup).toContain('alt="去掉水印 静态预览"');
        expect(markup).not.toContain("canvas-gen-backdrop");
        expect(markup).not.toContain("loading-clover");
    });

    test("提交结果待确认时显示警告图标", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "submission_unknown" }, CanvasNodeType.Video);
        expect(markup).toContain("提交结果待确认");
        expect(markup).toContain("lucide-triangle-alert");
        expect(markup).not.toContain("loading-clover");
    });

    test("分镜自定义标题栏已有任务状态时不叠加外层徽章，缺少渲染器时仍显示通用状态", () => {
        for (const status of ["loading", "error"] as const) {
            const markup = renderNode({ status }, CanvasNodeType.Script, () => <div>分镜脚本任务状态</div>);
            expect(markup).toContain("分镜脚本任务状态");
            expect(markup).not.toContain("canvas-node-status-chip");
            expect(renderNode({ status }, CanvasNodeType.Script)).toContain(status === "loading" ? "canvas-gen" : "重新生成");
        }
    });

    test("保存阶段只说一次正在保存，不再重复后端阶段原文，也不叠加“生成中”徽章", () => {
        const markup = renderNode({ status: "loading", taskId: "3897c08303cb-task", taskStatus: "running", taskStage: "作品已生成，正在保存", taskMediaStage: "upload", taskCreatedAt: createdAt() });
        expect(markup).toContain('data-phase="saving"');
        expect(occurrences(markup, "正在保存图片")).toBe(1);
        expect(markup).not.toContain("作品已生成，正在保存");
        expect(markup).not.toContain("生成中");
        expect(markup).not.toContain("canvas-node-status-chip");
        expect(markup).toContain("已用时 1分");
        expect(markup).not.toContain("查看详情");
    });

    test("保存失败后自动重试时如实显示，不再显示成正常保存", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "作品已生成，保存遇到问题，正在自动恢复", taskMediaStage: "download", taskCreatedAt: createdAt() });
        expect(markup).toContain('data-saving="retrying"');
        expect(markup).toContain("保存遇到问题，正在重试");
        expect(markup).toContain("不会重新生成");
        expect(markup).not.toContain("正在存入素材库");
    });

    test("排队、提交和供应商英文阶段都翻译成用户能懂的阶段", () => {
        const queued = renderNode({ status: "loading", taskId: "task", taskStatus: "queued", taskStage: "等待队列调度", taskCreatedAt: createdAt() });
        expect(queued).toContain("排队中");
        expect(queued).not.toContain("轮到后自动开始");

        const waiting = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "上游排队中" }, CanvasNodeType.Video);
        expect(waiting).toContain("上游排队中");
        expect(waiting).not.toContain("轮到后自动开始");

        const syncing = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "等待上游任务同步" }, CanvasNodeType.Video);
        expect(syncing).toContain("正在同步创作进度");
        expect(syncing).not.toContain("正在生成视频");

        const submitting = renderNode({ status: "loading", taskStage: "正在准备生成任务", taskCreatedAt: createdAt() });
        expect(submitting).toContain("正在提交");
        expect(submitting).not.toContain("正在准备生成任务");
        expect(submitting).not.toContain("查看详情");

        const provider = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "provider_processing", taskCreatedAt: createdAt() });
        expect(provider).toContain("正在生成图片");
        expect(provider).not.toContain("provider_processing");
    });

    test("恢复监听留下的诊断在生成中节点上可见", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "上游生成中", taskCreatedAt: createdAt(), errorDetails: "任务恢复暂不可用，请到任务中心核对。" });
        expect(markup).toContain("canvas-gen-diagnostic");
        expect(markup).toContain("任务恢复暂不可用，请到任务中心核对。");
    });

    test("视频有真实进度时显示百分比并提示离开页面也会继续", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "上游生成中", taskProgress: 42, taskCreatedAt: createdAt() }, CanvasNodeType.Video);
        expect(markup).toContain("正在生成视频");
        expect(markup).toContain("42%");
        expect(markup).toContain("离开页面也会继续生成");
    });
});

describe("画布节点失败态按下一步动作分类", () => {
    test("轮询中断时任务仍在跑：只建议重新获取，不把等待中断说成生成失败", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "running", errorDetails: "网络异常。" });
        expect(markup).toContain("状态同步中断");
        expect(markup).toContain("重新获取");
        expect(markup).toContain("重新生成");
        expect(markup).not.toContain("生成失败");
    });

    test("结果已生成但回写失败：提示作品已生成，可重新获取", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "succeeded", resourceReloadAvailable: true, errorDetails: "结果已生成，应用结果失败：资源读取失败（503）" });
        expect(markup).toContain("作品载入失败");
        expect(markup).toContain("重新获取");
    });

    test("作品已生成但保存失败：重新保存，不重新生成", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "failed", taskMediaStage: "upload", taskCanRecoverMedia: true, errorDetails: "作品已生成，但保存未完成：上传 OSS" });
        expect(markup).toContain("作品保存未完成");
        expect(markup).toContain("重新保存");
        expect(markup).not.toContain("重新获取");
    });

    test("后端确认失败才建议重新生成", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "failed", errorDetails: "模型服务处理失败，请稍后重试或换用其他模型。" });
        expect(markup).toContain("生成失败");
        expect(markup).toContain("重新生成");
        expect(markup).not.toContain("重新获取");
    });

    test("可重新获取的判定只认后端没确认失败的任务", () => {
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "running" })).toBe(true);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "queued" })).toBe(true);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "succeeded", resourceReloadAvailable: true })).toBe(true);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "succeeded" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "failed" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskStatus: "running" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "running", taskStage: "submission_unknown" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "running", isBatchRoot: true })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "loading", taskId: "task", taskStatus: "running" })).toBe(false);
    });
});

describe("画布节点完成反馈", () => {
    test("刷新或重新挂载的已完成节点不重放完成徽章和出现动画", () => {
        const markup = renderNode({ status: "success", taskId: "task", taskStatus: "succeeded", content: "/image.png", storageKey: "resource:image" });
        expect(markup).not.toContain("canvas-node-status-chip");
        expect(markup).not.toContain("已完成");
        expect(markup).not.toContain("data-generation-reveal");
    });

    test("真实 DOM：生成中转为完成只播放一次完成反馈，窗口结束后自行撤掉", () => {
        const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-node-generation-reveal.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(output).toContain("0 fail");
        expect(result.exitCode, output).toBe(0);
    });
});
