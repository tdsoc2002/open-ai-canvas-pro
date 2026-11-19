import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasAssetView } from "@/components/canvas/canvas-asset-view";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const nodes: CanvasNodeData[] = [
    {
        id: "document",
        type: CanvasNodeType.Text,
        title: "决策确认单",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { textFormat: "markdown", content: "# 确认事项\n\n> 核对 **宣传片素材** 和 [制作规格](https://example.invalid/spec)。" },
    },
    {
        id: "image",
        type: CanvasNodeType.Image,
        title: "参考图片",
        position: { x: 400, y: 0 },
        width: 320,
        height: 240,
        metadata: { content: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" },
    },
];

test("画布资产默认显示混合分类，不显示目录树，Markdown 卡片只读可读摘要", () => {
    const { document } = new Window();
    const noop = () => {};
    document.body.innerHTML = renderToStaticMarkup(<CanvasAssetView nodes={nodes} onLocate={noop} onRename={noop} onPromoteVersion={noop} onDownloadMedia={noop} onUpload={noop} />);

    expect(document.querySelector("[role='tree']")).toBeNull();
    expect(document.querySelector("[role='group'] button[aria-pressed='true']")?.textContent).toBe("全部");
    const cards = Array.from(document.querySelectorAll("ul > li > button"));
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("确认事项 核对 宣传片素材 和 制作规格。");
    expect(cards[0]?.textContent).not.toContain("**");
    expect(cards[0]?.querySelector("a")).toBeNull();
    expect(cards[1]?.textContent).toContain("参考图片");
});
