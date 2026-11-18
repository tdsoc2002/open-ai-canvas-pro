import { expect, test } from "bun:test";

test("默认模型行只保留选中高亮，价格使用独立的彩色标签", async () => {
    const [component, styles, workspace] = await Promise.all([
        Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/workspace-product.css", import.meta.url)).text(),
    ]);
    expect(component).not.toContain("previewedModel");
    expect(component).not.toContain("onMouseEnter");
    expect(styles).not.toMatch(/^\s*\.canvas-model-picker-(?:brand|option)(?:\[[^\]]*\])?:hover/m);
    expect(workspace).not.toContain(".canvas-model-picker-brand.is-active");
    expect(styles).toContain('.canvas-model-picker-brand[aria-pressed="true"]');
    expect(styles).toContain('.canvas-model-picker-option[aria-selected="true"]');
    expect(styles).toContain(".canvas-model-picker-option:focus-visible");
    const price = styles.match(/\.model-picker-price \{([^}]+)\}/)?.[1] || "";
    expect(price).toContain("color: var(--model-price-ink)");
    expect(price).toContain("font-weight: 600");
    expect(price).not.toContain("background:");
    expect(styles).toContain(".dark .model-picker-price");
    const badge = styles.match(/\.canvas-model-picker-option \.model-picker-price \{([^}]+)\}/)?.[1] || "";
    expect(badge).toContain("border-radius: var(--r-sm)");
    expect(badge).toContain("background: color-mix");
    expect(badge).toContain("padding: 2px 4px");
    expect(price).toContain("--model-price-ink: #946900");
    expect(component).toContain('<Coins className="model-picker-price-icon" aria-hidden="true" />');
    expect(styles).toContain("width: min(800px, calc(100vw - 24px))");
});

test("双栏打开已选模型所属目录，小源单列默认收起多渠道", async () => {
    const component = await Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text();
    const opening = component.match(/const setPickerOpen = \(nextOpen: boolean\) => \{([\s\S]*?)\n    \};/)?.[1] || "";
    expect(opening).toContain("compact ? undefined : optionGroups.find((group) => group.models.some((item) => item.models.includes(current)))");
    expect(opening).toContain("setActiveGroupKey(selectedGroup?.key ?? null)");
    expect(opening).not.toContain("setActiveGroupKey(null)");
});

test("选择模型后保留乐见价目交互，其他入口关闭菜单并还原焦点", async () => {
    const component = await Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text();
    const selection = component.match(/onClick=\{\(\) => \{\s*if \(!model\) return;([\s\S]*?)\}\}/)?.[1] || "";
    expect(selection).toContain("onChange(model)");
    expect(selection).toContain("if (!workbench) closePickerAndRestoreFocus()");
    expect(component).toMatch(/const closePickerAndRestoreFocus = \(\) => \{\s*setOpen\(false\);\s*window.requestAnimationFrame\(\(\) => triggerRef.current\?\.focus/);
    expect(component).toContain('event.key === "Escape"');
    expect(component).toContain('window.addEventListener("pointerdown", closeOnOutsidePointer, true)');
});

test("ModelPicker 样式独立加载，所有入口继承可用高度约束", async () => {
    const [application, globals, pickerStyles, component] = await Promise.all([
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text(),
        Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(),
    ]);

    expect(application).toContain('import "./styles/shared/model-picker.css";');
    expect(globals).not.toContain("canvas-model-picker");

    const menu = pickerStyles.match(/\.canvas-model-picker-menu\s*\{([^}]+)\}/)?.[1] || "";
    expect(menu).toMatch(/display:\s*flex\s*;/);
    expect(menu).toMatch(/flex-direction:\s*column\s*;/);
    const maxHeight = menu.match(/max-height:\s*([^;]+);/)?.[1] || "";
    expect(maxHeight).toContain("min(");
    expect(maxHeight).toContain("100dvh");
    expect(maxHeight).toContain("var(--canvas-model-picker-available-height)");
    expect(menu).toMatch(/overflow-y:\s*auto\s*;/);
    expect(component).toContain('"--canvas-model-picker-available-height": `${availableHeight}px`');

    // portal 和工作区覆盖只负责外观，不能重新取消共享菜单的高度或滚动限制。
    const overrides = [...pickerStyles.matchAll(/[^{}]*\.creation-model-picker-menu(?:\.is-(?:brand|model)-list)?\s*\{([^}]+)\}/g)];
    expect(overrides.length).toBeGreaterThan(0);
    for (const [, declarations] of overrides) {
        expect(declarations).not.toMatch(/(?:max-)?height\s*:/);
        expect(declarations).not.toMatch(/overflow(?:-y)?\s*:\s*visible/);
    }
});

test("模型和渠道分别滚动，外层双栏不被长列表撑高", async () => {
    const pickerStyles = await Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text();
    const modelList = pickerStyles.match(/\.canvas-model-picker-menu\.is-model-list\s*\{([^}]+)\}/)?.[1] || "";
    expect(modelList).toMatch(/overflow:\s*hidden\s*;/);

    const twoPane = pickerStyles.match(/\.canvas-model-picker-two-pane\s*\{([^}]+)\}/)?.[1] || "";
    expect(twoPane).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s*;/);
    expect(twoPane).toMatch(/min-height:\s*0\s*;/);
    expect(twoPane).toMatch(/overflow:\s*hidden\s*;/);
    expect(twoPane).not.toMatch(/align-items:\s*(?:start|flex-start)/);

    const brandRail = pickerStyles.match(/\.canvas-model-picker-menu\.is-model-list\s+\.canvas-model-picker-brand-rail\s*\{([^}]+)\}/)?.[1] || "";
    const modelPane = pickerStyles.match(/\.canvas-model-picker-model-pane\s*\{([^}]+)\}/)?.[1] || "";
    for (const pane of [brandRail, modelPane]) {
        expect(pane).toMatch(/min-height:\s*0\s*;/);
        expect(pane).toMatch(/overflow-x:\s*hidden\s*;/);
        expect(pane).toMatch(/overflow-y:\s*auto\s*;/);
    }
});

test("紧凑双栏中长模型名换行且空描述不占位", async () => {
    const [component, styles] = await Promise.all([Bun.file(new URL("../src/components/model-picker.tsx", import.meta.url)).text(), Bun.file(new URL("../src/styles/shared/model-picker.css", import.meta.url)).text()]);
    expect(component).toContain('const compactTwoPane = layout === "compact-two-pane"');
    expect(component).toContain('compactTwoPane && "is-compact-two-pane"');
    expect(styles).toMatch(/\.is-compact-two-pane[^{\n]* \.canvas-model-picker-option-name\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/\.is-compact-two-pane \.canvas-model-picker-description:empty\s*\{[^}]*display:\s*none/);
    expect(styles).toMatch(/\.is-compact-two-pane \.canvas-model-picker-option:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--control-selected-bg\)/);
});

test("创作首页和画布复用紧凑双栏，不影响对话或小源", async () => {
    const [creation, nodePanel, agent, styles] = await Promise.all([
        Bun.file(new URL("../src/pages/create/creation-workspace.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-panel-parts.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/create/creation-product.css", import.meta.url)).text(),
    ]);
    expect(creation).toContain('const isCreationHome = props.variant === "empty"');
    expect(creation).toContain('layout={isCreationHome ? "compact-two-pane" : undefined}');
    expect(nodePanel).toContain('layout="compact-two-pane"');
    expect(agent).toContain('layout="agent-compact"');
    expect(styles).not.toContain("minmax(0, 34%)");
});
