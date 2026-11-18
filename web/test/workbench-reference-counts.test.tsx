import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceSection, type WorkbenchReference } from "@/pages/workbench/workbench-composer";

test("视频参考素材分别显示图片、视频、音频和总计的用量", () => {
    const noop = () => {};
    const references: WorkbenchReference[] = (["image", "video", "image", "audio"] as const).map((kind, index) => ({
        id: String(index),
        name: `素材 ${index}`,
        kind,
        previewUrl: `/fixture-${index}`,
        progress: 100,
        uploading: false,
        role: "reference",
    }));
    const render = (items: WorkbenchReference[], maxTotalItems?: number) =>
        renderToStaticMarkup(
            <ReferenceSection
                kind="video"
                tool={null}
                references={items}
                referenceLimits={{ image: 9, video: 4, audio: 2 }}
                maxTotalItems={maxTotalItems}
                onPick={noop}
                onDropFiles={noop}
                onOpenLibrary={noop}
                onRemove={noop}
                onRoleChange={noop}
                onClear={noop}
            />,
        );
    expect(render([])).toContain("图片 0/9 · 视频 0/4 · 音频 0/2 · 总计 0/15");
    expect(render(references, 10)).toContain("图片 2/9 · 视频 1/4 · 音频 1/2 · 总计 4/10");
});
