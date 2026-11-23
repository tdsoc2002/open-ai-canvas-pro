import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSizePicker } from "@/components/image-size-picker";
import { AspectRatioGrid } from "@/components/aspect-ratio-grid";
import { imagePresetForRatio, imageSizeConfigWithPresets } from "@/lib/image-size-presets";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { WorkbenchStudio } from "@/pages/workbench/workbench-studio";
import { ChoiceChips, ComposerFooter, ComposerSection, CountStepper, PromptSection, ReferenceSection, videoRatioOptions } from "@/pages/workbench/workbench-composer";
import { WorkbenchGallery, type GalleryActions, type GalleryBatch } from "@/pages/workbench/workbench-gallery";
import type { GenerationTask } from "@/services/api/task-center";

describe("乐见生成工作台呈现合同", () => {
    for (const kind of ["image", "video"] as const) {
        test(`${kind}：真实展示组件仅组合一份控件插槽`, () => {
            const model = <button>选择模型</button>;
            const html = renderToStaticMarkup(
                <WorkbenchStudio
                    kind={kind}
                    parameters={<button>参数控件</button>}
                    references={<button>参考素材</button>}
                    prompt={<textarea aria-label="描述" />}
                    submit={<ComposerFooter kind={kind} count={1} model={model} compactSubmit busy={false} disabledReason="请填写描述" onSubmit={() => {}} />}
                    onPaste={() => {}}
                />,
            );
            const name = kind === "image" ? "图片" : "视频";
            expect(html).toContain(`aria-label="${name}生成工作区"`);
            for (const text of ["参数控件", "参考素材", "选择模型", "提交"]) expect(html.split(`>${text}<`).length - 1).toBe(1);
            expect(html).toContain(`<h1 class="sr-only">${name}创作</h1>`);
            expect(html).not.toContain("wb-studio-writing-head");
            expect(html).not.toContain("wb-studio-billing");
            expect(html.indexOf("选择模型")).toBeGreaterThan(html.indexOf('class="wb-studio-dock"'));
            expect(html.indexOf("选择模型")).toBeLessThan(html.indexOf(">提交<"));
            expect(html).toContain("disabled");
            expect(html.indexOf('class="wb-studio-parameters"')).toBeLessThan(html.indexOf('class="wb-studio-writing"'));
            expect(html.indexOf("参数控件")).toBeLessThan(html.indexOf("描述"));
            expect(html).toContain('</div></section><div class="wb-studio-dock">');
        });
    }

    test("使用创作历史时不渲染工作台作品入口", () => {
        const html = renderToStaticMarkup(<WorkbenchStudio kind="image" parameters={null} references={null} prompt={null} submit={<button>生成图片</button>} onPaste={() => {}} />);
        expect(html).not.toContain("查看作品");
        expect(html).toContain("生成图片");
    });

    test.each(["image", "video"] as const)("%s：当前出品场景在右侧参考素材之前，左侧只保留参数", (kind) => {
        const html = renderToStaticMarkup(
            <WorkbenchStudio kind={kind} parameters={<button>参数控件</button>} scene={{ name: "商品细节微距", onOpen: () => {} }} references={<button>商品素材</button>} prompt={<textarea />} submit={null} onPaste={() => {}} />,
        );
        expect(html.match(/<button[^>]*aria-haspopup="dialog"[^>]*>.*?<\/button>/)?.[0]).toContain("商品细节微距");
        expect(html.indexOf("</aside>")).toBeLessThan(html.indexOf("出品场景"));
        expect(html.indexOf("出品场景")).toBeLessThan(html.indexOf(">商品素材<"));
        expect(html).not.toContain("出品场景与模板");
    });

    test("桌面图片与视频工作台共用可用高度约束", () => {
        const css = readFileSync(new URL("../src/themes/joysee-minimal/workbench.css", import.meta.url), "utf8");
        const desktop = css.slice(css.indexOf("@media (min-width: 768px)"), css.indexOf("@media (max-width: 767px)"));
        expect(desktop).toMatch(/\.is-joysee-studio\s*\{[^}]*overflow:\s*hidden/);
        expect(desktop).toMatch(/\.is-joysee-studio\s*>\s*\.wb-studio-layout\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/);
        expect(desktop).toMatch(/\.wb-prompt-input\s*\{[^}]*overflow-y:\s*auto/);
    });

    test.each([
        [1280, "joysee-minimal", true],
        [390, "joysee-minimal", true],
        [1280, "classic", false],
    ] as const)("图片工作台参数布局（%ipx，%s）", async (width, skin, isJoysee) => {
        const window = new Window({ width, height: 900 });
        try {
            const { document } = window;
            document.documentElement.dataset.skin = skin;
            document.documentElement.style.setProperty("--user-surface-muted", "#f7f7f7");
            document.documentElement.style.setProperty("--control-selected-bg", "#e8e8e8");
            document.documentElement.style.setProperty("--space-1", "4px");
            document.documentElement.style.setProperty("--space-2", "8px");
            document.documentElement.style.setProperty("--space-3", "12px");
            document.documentElement.style.setProperty("--space-4", "16px");
            document.documentElement.style.setProperty("--space-6", "24px");
            document.documentElement.style.setProperty("--space-8", "32px");
            document.documentElement.style.setProperty("--space-10", "40px");
            document.documentElement.style.setProperty("--space-12", "48px");
            document.documentElement.style.setProperty("--space-20", "80px");
            for (const path of ["../src/components/image-size-picker.css", "../src/pages/workbench/workbench.css", "../src/themes/joysee-minimal/workbench.css"]) {
                const style = document.createElement("style");
                style.textContent = readFileSync(new URL(path, import.meta.url), "utf8");
                document.head.append(style);
            }
            const profile = defaultImageCapabilityConfig();
            const presets = ["16:9", "9:16", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "21:9", "9:21", "2:1", "1:2", "3:1", "1:3"].map((ratio) => imagePresetForRatio("2k", ratio));
            profile.size = imageSizeConfigWithPresets(profile, presets);
            document.body.innerHTML = renderToStaticMarkup(
                <div className="wb-shell is-joysee-studio" data-kind="image">
                    <div className="wb-studio-parameters">
                        <div className="wb-studio-parameter-scroll">
                            <ComposerSection title="生成参数">
                                <ImageSizePicker profile={profile} size={presets[0].size} onChange={() => {}} />
                                <ChoiceChips label="画质" value="low" options={[{ value: "low", label: "低" }]} wrap={isJoysee} onChange={() => {}} />
                            </ComposerSection>
                            <CountStepper kind="image" value={1} max={5} hint="最多 5 张" showAll={isJoysee} onChange={() => {}} />
                        </div>
                    </div>
                </div>,
            );
            const icons = [...document.querySelectorAll(".image-size-ratio-icon")];
            expect(icons).toHaveLength(15);
            for (const icon of icons) {
                const { display, width, height, borderTopWidth } = window.getComputedStyle(icon);
                expect(display).not.toBe("none");
                expect(borderTopWidth).toBe(isJoysee ? "1.5px" : "1px");
                if (isJoysee) expect(window.getComputedStyle(icon.parentElement!).fontWeight).toBe("500");
                const ratio = icon.nextElementSibling?.textContent;
                if (ratio === "16:9") expect(parseFloat(width)).toBeGreaterThan(parseFloat(height));
                if (ratio === "9:16") expect(parseFloat(width)).toBeLessThan(parseFloat(height));
                if (ratio === "1:1") expect(width).toBe(height);
            }
            const summary = document.querySelector(".image-size-output")!;
            expect(window.getComputedStyle(summary).display === "none").toBe(isJoysee);
            const ratios = window.getComputedStyle(document.querySelector(".image-size-ratios")!);
            expect(ratios.display).toBe("grid");
            const resolution = window.getComputedStyle(document.querySelector(".image-size-resolution")!);
            expect(resolution.display).toBe(isJoysee ? "grid" : "contents");
            const button = window.getComputedStyle(document.querySelector(".image-size-ratios button")!);
            if (isJoysee) {
                const styleFor = (selector: string) => window.getComputedStyle(document.querySelector(selector)!);
                expect(styleFor('.image-size-ratios button[aria-pressed="false"]').backgroundColor).toBe("#f7f7f7");
                expect(styleFor('.image-size-ratios button[aria-pressed="true"]').backgroundColor).toBe("#e8e8e8");
                expect(styleFor(".wb-section:has(> .wb-count) .wb-section-title").justifyContent).toBe("space-between");
                expect(styleFor(".wb-count").gridTemplateColumns).toBe(styleFor(".wb-choice-grid").gridTemplateColumns);
                expect(styleFor(".wb-count").gap).toBe(styleFor(".wb-choice-grid").gap);
                expect(ratios.gridTemplateColumns).toBe("repeat(auto-fill, minmax(min(100%, 48px), 1fr))");
                expect(ratios.alignContent).toBe("start");
                expect(ratios.gap).toBe("8px");
                expect(ratios.flexGrow).not.toBe("1");
                expect(button.minHeight).toBe("48px");
                expect(button.padding).toBe("8px");
                expect(button.display).toBe("grid");
                expect(button.gridTemplateRows).toBe("24px auto");
                expect(button.placeContent).toBe("center");
                expect(button.placeItems).toBe("center");
                expect(button.aspectRatio).not.toBe("1 / 1");
                expect(resolution.gridTemplateColumns).toBe("minmax(0, 1fr)");
                expect(styleFor(".image-size-tiers").gridTemplateColumns).toBe(styleFor(".wb-choice-grid").gridTemplateColumns);
                expect(styleFor(".wb-field").gridTemplateColumns).not.toBe("48px minmax(0, 1fr)");
                expect(styleFor(".wb-choice-grid").gridTemplateColumns).toBe("repeat(auto-fit, minmax(min(100%, 40px), 1fr))");
                if (width >= 768) {
                    expect(styleFor(".wb-studio-parameter-scroll").flexDirection).toBe("column");
                    expect(styleFor(".wb-studio-parameter-scroll").padding).toBe("16px 12px");
                    expect(styleFor(".wb-studio-parameter-scroll").overflowY).toBe("auto");
                    expect(styleFor('.wb-section[aria-label="生成参数"]').flexGrow).not.toBe("1");
                    expect(styleFor(".image-size-picker").flexGrow).not.toBe("1");
                }
            }
        } finally {
            await window.happyDOM.abort();
        }
    });

    test("只在现有主题分支接入，不改原生成与图库调用面", () => {
        const source = readFileSync(new URL("../src/pages/workbench/image-workbench-page.tsx", import.meta.url), "utf8");
        expect(source).toContain('useThemePack()?.workspaceStyle === "joysee"');
        expect(source).toContain("studioLayout ? (");
        expect(source).toContain("disabledReason={disabledReason}");
        expect(source).toContain("onSubmit={() => void submit()}");
        expect(source).toContain("actions={galleryActions}");
        expect(source).toContain("{modelContent}");
        expect(source).toContain("onChange={setMobileTab}");
        expect(source).toContain('if (showGallery) setMobileTab("gallery")');
        const component = readFileSync(new URL("../src/pages/workbench/workbench-studio.tsx", import.meta.url), "utf8");
        expect(component).not.toMatch(/\b(fetch|createGenerationTask|createWorkbenchTask)\(/);
        const css = readFileSync(new URL("../src/themes/joysee-minimal/workbench.css", import.meta.url), "utf8");
        expect(css).toContain('[data-mobile-tab="gallery"] .wb-studio-layout');
        expect(css).toContain('[data-mobile-tab="compose"] .wb-studio-results');
        expect(css).toContain("@media (min-width: 768px)");
        expect(css).toContain(".is-joysee-studio .wb-studio-results .wb-gallery");
        expect(css).toContain("margin-bottom: max(128px, env(safe-area-inset-bottom))");
        expect(css).not.toMatch(/var\(--control-height(?:-sm)?\)/);
    });
});

test("换行画质：所有档位直接点选并保留当前选中值", () => {
    const options = [
        { value: "low", label: "低" },
        { value: "medium", label: "中" },
        { value: "high", label: "高" },
        { value: "xhigh", label: "超高" },
        { value: "max", label: "最高" },
        ...Array.from({ length: 4 }, (_, index) => ({ value: `extra-${index}`, label: `额外档位 ${index + 1}` })),
    ];
    const render = (wrap: boolean) => renderToStaticMarkup(<ChoiceChips label="画质" value="max" options={options} wrap={wrap} onChange={() => {}} />);
    const html = render(true);
    expect(html).not.toContain('role="combobox"');
    expect(html.match(/role="radio"/g)).toHaveLength(9);
    expect(html).toMatch(/aria-checked="true"[^>]*><span>最高<\/span>/);
    expect(render(false)).toContain('role="combobox"');
});

test.each([5, 12])("图片数量上限为 %i 时可直接选到最后一档，不显示微调框", (max) => {
    const html = renderToStaticMarkup(<CountStepper kind="image" value={max} max={max} showAll onChange={() => {}} />);
    expect(html.match(/aria-pressed=/g)).toHaveLength(max);
    expect(html).toContain(`aria-pressed="true">${max}</button>`);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("wb-count-steps");
});

test("图片切换生成数量时只更新选中态，不改变标题提示", () => {
    const render = (value: number, hint: string) => renderToStaticMarkup(<CountStepper kind="image" value={value} max={5} hint={hint} showAll onChange={() => {}} />);
    const single = render(1, "最多 5 张");
    const batch = render(2, "模型单次最多 1 张，将拆成 2 个任务并行生成");
    const header = (html: string) => html.match(/<header.*?<\/header>/)?.[0];
    expect(header(single)).toContain("最多 5 张");
    expect(header(batch)).toBe(header(single));
    expect(batch).toContain('aria-pressed="true">2</button>');
});

test("视频生成数量保留原有微调入口", () => {
    const html = renderToStaticMarkup(<CountStepper kind="video" value={4} max={5} hint="并行提交 4 个任务，每条独立生成" onChange={() => {}} />);
    expect(html).toContain('aria-label="自定义数量（4 到 5 条）"');
    expect(html).toContain("并行提交 4 个任务，每条独立生成");
});

test("乐见视频上传入口精简，其余主题保留首尾帧提示", () => {
    const noop = () => {};
    const render = (compactUpload: boolean) =>
        renderToStaticMarkup(
            <ReferenceSection
                kind="video"
                tool={null}
                references={[]}
                referenceLimits={{ image: 3, video: 0, audio: 0 }}
                compactUpload={compactUpload}
                onPick={noop}
                onDropFiles={noop}
                onOpenLibrary={noop}
                onRemove={noop}
                onRoleChange={noop}
                onClear={noop}
            />,
        );
    const html = render(true);
    expect(html).toContain("上传参考素材");
    expect(html).not.toContain("图片可设为首帧或尾帧");
    expect(render(false)).toContain("图片可设为首帧或尾帧");
});

test("视频参考素材分别显示图片、视频、音频和总计的用量", () => {
    const noop = () => {};
    const references = (["image", "video", "image", "audio"] as const).map((kind, index) => ({
        id: String(index),
        name: `素材 ${index}`,
        kind,
        previewUrl: `/fixture-${index}`,
        progress: 100,
        uploading: false,
        role: "reference" as const,
    }));
    const render = (items: typeof references, maxTotalItems?: number) =>
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

test("共用宽高比网格保留视频自适应、全量可选值和用途提示", () => {
    const ratios = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "2:1", "1:2"];
    const options = videoRatioOptions(ratios);
    const compact = renderToStaticMarkup(<AspectRatioGrid options={options.map((option) => ({ ...option, key: option.value, title: option.caption, adaptive: option.value === "adaptive", selected: option.value === "adaptive", onSelect: () => {} }))} />);
    expect(compact).toContain('class="image-size-ratios" role="group" aria-label="宽高比"');
    expect(compact.match(/aria-pressed=/g)).toHaveLength(ratios.length);
    expect(compact).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?<span>自适应<\/span>/);
    expect(compact).toContain("image-size-ratio-icon");
    expect(compact).toContain("跟随素材");
    expect(compact).not.toContain("<small>");
    expect(renderToStaticMarkup(<ChoiceChips label="画幅" value="adaptive" options={options.slice(0, 3)} onChange={() => {}} />)).toContain("<small>跟随素材</small>");
});

test("画面描述保留编辑器和场景预设，不显示灵感词快捷选项", () => {
    const preset = { id: "preset", name: "标准单镜头", promptTemplate: "测试描述" };
    const tool = { id: "tool", kind: "video" as const, categoryId: "ecommerce", name: "商品广告", subtitle: "", description: "", sortOrder: 0, enabled: true, presets: [preset] };
    const html = renderToStaticMarkup(<PromptSection tool={tool} preset={preset} prompt="测试描述" maxChars={8000} editor={<textarea aria-label="画面描述编辑器" defaultValue="测试描述" />} onChoosePreset={() => {}} onClear={() => {}} />);
    expect(html).toContain("画面描述编辑器");
    expect(html).toContain("标准单镜头");
    expect(html).not.toContain("灵感词");
});

test("作品卡片显示真实阶段，只在供应商有生成进度时显示百分比", () => {
    const noop = () => {};
    const actions: GalleryActions = {
        openOutput: noop,
        download: noop,
        cancelTask: noop,
        retryTask: noop,
        reuse: noop,
        copyPrompt: noop,
        downloadAll: noop,
        cancelBatch: noop,
        retryFailed: noop,
        resume: noop,
        dismiss: noop,
        visible: noop,
        measure: noop,
    };
    const createdAt = "2026-01-01T00:00:00Z";
    const render = (status: Pick<GenerationTask, "status" | "stage" | "mediaStage" | "progress">) => {
        const task: GenerationTask = { id: "task", type: "video", prompt: "人物走过街道", attempts: 1, createdAt, updatedAt: createdAt, ...status };
        const batch: GalleryBatch = {
            key: "batch",
            createdAt,
            prompt: task.prompt,
            chips: [],
            tiles: [{ type: "active", key: task.id, task, slot: 0 }],
            tasks: [task],
            outputs: [],
            counts: { done: 0, active: 1, failed: 0, pending: 0, total: 1 },
            resumable: 0,
            submitting: false,
            localOnly: false,
        };
        return renderToStaticMarkup(
            <WorkbenchGallery
                kind="video"
                batches={[batch]}
                loading={false}
                filter="all"
                query=""
                busyTaskIds={new Set()}
                actions={actions}
                quickTools={[]}
                historyCapped={false}
                onFilterChange={noop}
                onQueryChange={noop}
                onRefresh={noop}
                onOpenLibrary={noop}
                onChooseTool={noop}
            />,
        );
    };

    const queued = render({ status: "queued", stage: "候车 · 前面 3 条", progress: 4 });
    expect(queued).toContain('role="status">候车 · 前面 3 条');
    expect(queued).not.toContain("wb-tile-progress");
    const generating = render({ status: "running", stage: "processing", progress: 1 });
    expect(generating).toContain('role="status">正在生成视频');
    expect(generating).toContain(">1%</small>");
    const saving = render({ status: "running", stage: "保存遇到问题，正在自动重试", mediaStage: "upload", progress: 98 });
    expect(saving).toContain('role="status">保存遇到问题，正在重试');
    expect(saving).not.toContain("wb-tile-progress");
    const uncertain = render({ status: "running", stage: "submission_unknown", progress: 4 });
    expect(uncertain).toContain('role="status">提交结果待确认');
    expect(uncertain).not.toContain("wb-tile-progress");
});

test.each([
    ["image", "提交"],
    ["video", "生成视频"],
] as const)("%s：底栏不重复显示数量，有积分预估时保留", (kind, buttonLabel) => {
    const render = (estimate: string) => renderToStaticMarkup(<ComposerFooter kind={kind} count={1} estimate={estimate} busy={false} onSubmit={() => {}} />);
    expect(render("")).toContain(`>${buttonLabel}<`);
    expect(render("")).not.toMatch(/1 [张条]|个任务/);
    expect(render("预计 12 积分")).toContain("预计 12 积分");
    expect(render("预计 12 积分")).not.toMatch(/1 [张条]|个任务/);
});

test("图片工作台不显示独立结算栏，仍在提交栏展示可用报价", () => {
    const source = readFileSync(new URL("../src/pages/workbench/image-workbench-page.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("parameterFooter");
    expect(source).toContain("estimate={estimateDisplay}");
    const html = renderToStaticMarkup(<ComposerFooter kind="image" count={1} busy={false} onSubmit={() => {}} />);
    expect(html).toContain(">提交<");
    expect(html).not.toContain("wb-estimate");
});

test("必填素材未上传时，仍在禁用的批量提交按钮旁展示火苗和积分数字", async () => {
    const window = new Window();
    try {
        const { document } = window;
        document.body.innerHTML = renderToStaticMarkup(<ComposerFooter kind="image" count={3} estimate={0.36} busy={false} disabledReason="请上传“商品原图”" onSubmit={() => {}} />);
        const footer = document.querySelector("footer")!;
        const estimate = footer.querySelector('[aria-live="polite"]')!;
        const button = footer.querySelector("button")!;
        expect(estimate.querySelector('.joysee-credit-mark[aria-hidden="true"] svg')).not.toBeNull();
        expect(estimate.querySelector("strong")?.textContent).toBe("0.36");
        expect(estimate.querySelector(".sr-only")?.textContent).toBe("预计消耗 0.36 积分");
        expect(button.textContent).toBe("提交");
        expect(button.disabled).toBe(true);
    } finally {
        await window.happyDOM.abort();
    }
});

test("零积分正常展示，报价状态不显示火苗", () => {
    const render = (estimate: number | string) => renderToStaticMarkup(<ComposerFooter kind="image" count={1} estimate={estimate} busy={false} onSubmit={() => {}} />);
    expect(render(0)).toContain('<strong aria-hidden="true">0</strong>');
    expect(render(0)).toContain("joysee-credit-mark");
    expect(render("报价暂不可用")).toContain("报价暂不可用");
    expect(render("报价暂不可用")).not.toContain("joysee-credit-mark");
});

test("乐见工作台的数值报价只在展示时向上取两位小数", () => {
    const render = (estimate: number, roundEstimateUp: boolean) => renderToStaticMarkup(<ComposerFooter kind="image" count={1} estimate={estimate} roundEstimateUp={roundEstimateUp} busy={false} onSubmit={() => {}} />);
    expect(render(1.231, true)).toContain('<strong aria-hidden="true">1.24</strong>');
    expect(render(0, true)).toContain('<strong aria-hidden="true">0.00</strong>');
    expect(render(1.231, false)).toContain('<strong aria-hidden="true">1.231</strong>');
});

test("乐见底栏的积分不带底色和外框，保留火苗和数字尺寸", async () => {
    const window = new Window();
    try {
        const { document } = window;
        document.documentElement.dataset.skin = "joysee-minimal";
        document.documentElement.style.setProperty("--space-5", "20px");
        document.documentElement.style.setProperty("--fs-caption", "12px");
        document.documentElement.style.setProperty("--muted", "#f7f7f7");
        for (const path of ["../src/styles/button-tokens.css", "../src/pages/workbench/workbench.css", "../src/themes/joysee-minimal/workspace.css", "../src/themes/joysee-minimal/workbench.css"]) {
            const style = document.createElement("style");
            style.textContent = readFileSync(new URL(path, import.meta.url), "utf8");
            document.head.append(style);
        }
        document.body.innerHTML = renderToStaticMarkup(
            <div className="app-user-workspace">
                <WorkbenchStudio kind="image" parameters={null} references={null} prompt={null} submit={<ComposerFooter kind="image" count={1} estimate={0.05} busy={false} onSubmit={() => {}} />} onPaste={() => {}} />
            </div>,
        );
        const styleFor = (selector: string) => window.getComputedStyle(document.querySelector(selector)!);
        expect(styleFor(".wb-estimate-amount").backgroundColor).toBe("");
        expect(styleFor(".wb-estimate-amount").borderTopWidth).toBe("");
        expect(styleFor(".wb-estimate-amount strong").fontSize).toBe("14px");
        expect(styleFor(".wb-estimate-mark").width).toBe("20px");
    } finally {
        await window.happyDOM.abort();
    }
});
