import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Hand, MousePointer2 } from "lucide-react";

import { FloatingDock } from "@/components/ui/aceternity/floating-dock";
import { resolveMainToolbarLayout, resolveToolbarEntries, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";

const CANVAS_MODE_TOOL_ID = "tool-canvas-mode";

function createMainContext(canvasTool: "move" | "box-select" = "box-select"): ToolContext {
    return {
        selectedCount: 0,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool,
        workspaceMode: "professional",
        isProjectLinked: false,
        canUndo: false,
        canRedo: false,
        extractingVideoFrames: false,
        extractingAudio: false,
        trimmingVideo: false,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        handlers: {} as ToolbarHandlers,
    };
}

describe("canvas toolbar mode switch", () => {
    test("keeps the same toolbar slots when canvas selection changes", () => {
        const empty = resolveToolbarEntries("main", createMainContext());
        const selected = resolveToolbarEntries("main", { ...createMainContext(), selectedCount: 3 });
        expect(selected.map((entry) => entry.id)).toEqual(empty.map((entry) => entry.id));
        expect(selected.some((entry) => entry.id === "tool-delete")).toBe(false);
    });

    test.each(["default", "compact"] as const)("renders %s canvas modes as an icon-only segmented switch", (size) => {
        const entries = resolveToolbarEntries("main", createMainContext());
        const modeSwitch = entries.find((entry) => entry.kind === "switch");
        if (!modeSwitch) throw new Error("Missing canvas mode switch");
        const html = renderToStaticMarkup(<FloatingDock size={size} items={[modeSwitch]} />);

        expect(html).toContain(`data-dock-size="${size}"`);
        expect(html).toContain(size === "compact" ? "--dock-item-size:28px" : "--dock-item-size:32px");
        expect(html.match(/aceternity-dock-switch-thumb/g)).toHaveLength(1);
        expect(html).toContain("absolute inset-0 rounded-[var(--dock-item-radius)]");
        expect(html).toContain("grid shrink-0 place-items-center");
        expect(html).not.toContain("is-labeled");
        expect(html).not.toContain("选择</span>");
        expect(html).not.toContain("移动</span>");
        expect(html).toContain('aria-label="区域选择"');
        expect(html).toContain('aria-label="抓手工具"');
    });

    test("renders grab and box-select as one dock switch", () => {
        const entries = resolveToolbarEntries("main", createMainContext("box-select"));
        const modeSwitch = entries.find((entry) => entry.kind === "switch" && entry.id === CANVAS_MODE_TOOL_ID);

        expect(modeSwitch?.kind).toBe("switch");
        if (modeSwitch?.kind !== "switch") return;
        expect(modeSwitch.value).toBe("box-select");
        expect(modeSwitch.options.map((option) => option.value)).toEqual(["box-select", "move"]);
        expect(entries.some((entry) => entry.id === "tool-move" || entry.id === "tool-box-select")).toBe(false);
    });

    test("reflects the active canvas tool on the switch", () => {
        const entries = resolveToolbarEntries("main", createMainContext("move"));
        const modeSwitch = entries.find((entry) => entry.kind === "switch");
        expect(modeSwitch?.kind === "switch" && modeSwitch.value).toBe("move");
    });

    test.each([
        ["box-select", MousePointer2, false],
        ["move", Hand, true],
    ] as const)("renders %s as one toggle button in the combined dock", (canvasTool, Icon, pressed) => {
        const entries = resolveToolbarEntries("main", { ...createMainContext(canvasTool), singleCanvasModeButton: true });
        const mode = entries.find((entry) => entry.id === CANVAS_MODE_TOOL_ID);
        expect(mode?.kind).toBe("command");
        if (!mode) throw new Error("Missing canvas mode button");
        const html = renderToStaticMarkup(<FloatingDock items={[mode]} />);

        expect(html.match(/<button\b/g)).toHaveLength(1);
        expect(html).toContain('aria-label="抓手工具"');
        expect(html).toContain(`aria-pressed="${pressed}"`);
        expect(html).toContain(renderToStaticMarkup(<Icon />));
    });

    test("keeps undo, redo and workspace available in the main dock", () => {
        const entries = resolveToolbarEntries("main", { ...createMainContext(), singleCanvasModeButton: true, canUndo: true, canRedo: true });
        expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tool-undo", disabled: false }), expect.objectContaining({ id: "tool-redo", disabled: false }), expect.objectContaining({ id: "tool-workspace" })]));
    });

    test.each([false, true])("places canvas appearance in the dock and leaves no rail menu entries (compact: %s)", (compact) => {
        const context = { ...createMainContext(), singleCanvasModeButton: true, selectedCount: 2 };
        const { dock, more, destructive } = resolveMainToolbarLayout(context, { rail: true, compact });

        expect(dock.map(({ id }) => id)).toEqual([CANVAS_MODE_TOOL_ID, "tool-style"]);
        expect(more).toHaveLength(0);
        expect(destructive).toHaveLength(0);
    });

    test("hides rarely used arrange tools from the selection toolbar by default", () => {
        const entries = resolveToolbarEntries("selection", createMainContext());
        expect(entries.some((entry) => entry.id === "selection-align-left")).toBe(true);
        expect(entries.some((entry) => entry.id === "selection-distribute-x")).toBe(true);
        expect(entries.some((entry) => entry.id === "selection-batch-connect")).toBe(true);
        expect(entries.some((entry) => entry.id === "selection-arrange-grid")).toBe(false);
        expect(entries.some((entry) => entry.id === "selection-arrange-row")).toBe(false);
        expect(entries.some((entry) => entry.id === "selection-arrange-column")).toBe(false);
        expect(entries.some((entry) => entry.id === "selection-arrange-flow")).toBe(false);
        expect(entries.some((entry) => entry.id === "selection-create-reference-group")).toBe(false);
    });

    test("renders the pill switch with an active circular thumb", () => {
        const html = renderToStaticMarkup(
            <FloatingDock
                items={[
                    {
                        kind: "switch",
                        id: CANVAS_MODE_TOOL_ID,
                        label: "抓手 / 框选",
                        value: "box-select",
                        options: [
                            { id: "box-select", label: "区域选择", icon: <MousePointer2 />, value: "box-select" },
                            { id: "move", label: "抓手工具", icon: <Hand />, value: "move" },
                        ],
                        onChange: () => {},
                    },
                ]}
            />,
        );

        expect(html).toContain('role="radiogroup"');
        expect(html).toContain("aceternity-dock-switch");
        expect(html).toContain("aceternity-dock-switch-thumb");
        expect(html).toContain('aria-label="区域选择"');
        expect(html).toContain('aria-label="抓手工具"');
        expect(html).toContain('aria-checked="true"');
        expect(html).toContain('aria-checked="false"');
    });
});
