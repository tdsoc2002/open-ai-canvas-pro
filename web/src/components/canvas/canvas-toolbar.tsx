import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Switch } from "@/components/ui/base/switch";
import { Info, Palette } from "lucide-react";

import { FloatingDock } from "@/components/ui/aceternity/floating-dock";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { CanvasAppearanceControls } from "@/components/canvas/canvas-appearance-controls";
import { useCanvasOverlayLayer } from "@/components/canvas/canvas-overlay-layer";
import { CanvasCreateMenu, type CanvasCreateCommand } from "@/components/canvas/canvas-create-menu";
import { useCanvasCreateCommands } from "@/components/canvas/use-canvas-create-commands";
import { ToolbarSettingsModal } from "@/components/canvas/toolbars/toolbar-settings-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { canvasThemes, type CanvasBackgroundMode, type CanvasTheme } from "@/lib/canvas-theme";
import { defaultToolbarPrefs, readToolbarPrefs, resolveToolbarEntries, type ToolContext, type ToolbarHandlers, type ToolbarPrefs } from "@/lib/canvas/tool-registry";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useTranslation } from "react-i18next";
import type { CanvasNodeTypeId, CanvasToolMode, CanvasWorkspaceMode } from "@/types/canvas";
import "./canvas-bottom-toolbar.css";

export function CanvasToolbar({
    selectedCount,
    workspaceMode,
    canvasTool,
    onToolChange,
    isProjectLinked,
    canUndo,
    canRedo,
    appearance,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onChooseStyle,
    onAddScript,
    onAddFrame,
    onAddFolder,
    onAddDrawing,
    onAddExtensionNode,
    onAddWorkflow,
    onOpenPrevis,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onAppearanceChange,
    onSaveAppearanceDefault,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onOpenWorkspace,
    onOpenMyAssets,
    onOpenProjectCharacters,
    onOpenPoseLibrary,
    viewControls,
    vertical = false,
    compact = false,
}: {
    selectedCount: number;
    workspaceMode: CanvasWorkspaceMode;
    canvasTool: CanvasToolMode;
    onToolChange: (tool: CanvasToolMode) => void;
    isProjectLinked: boolean;
    canUndo: boolean;
    canRedo: boolean;
    appearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onChooseStyle: () => void;
    onAddScript: () => void;
    onAddFrame: () => void;
    onAddFolder: () => void;
    onAddDrawing: () => void;
    onAddExtensionNode: (type: CanvasNodeTypeId) => void;
    onAddWorkflow: () => void;
    onOpenPrevis: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onAppearanceChange: (appearance: CanvasAppearance) => void;
    onSaveAppearanceDefault: (appearance: CanvasAppearance) => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onOpenWorkspace?: () => void;
    onOpenMyAssets: () => void;
    onOpenProjectCharacters: () => void;
    onOpenPoseLibrary?: () => void;
    viewControls?: ReactNode;
    vertical?: boolean;
    /** 紧凑尺寸：短剧精修画布把视野留给节点。 */
    compact?: boolean;
}) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const { bringToFront, zIndex } = useCanvasOverlayLayer("main-toolbar", "var(--z-toolbar)");
    const colorTheme = useActiveTheme();
    const theme = canvasThemes[colorTheme];
    const [addOpen, setAddOpen] = useState(false);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [panelX, setPanelX] = useState("50%");
    const [prefs, setPrefs] = useState<ToolbarPrefs | null>(() => readToolbarPrefs("main"));

    useEffect(() => {
        if (addOpen || appearanceOpen) bringToFront();
    }, [addOpen, appearanceOpen, bringToFront]);

    // 设置面板关闭后重新读取偏好（用户可能调整了排序/显隐）
    useEffect(() => {
        if (!settingsOpen) setPrefs(readToolbarPrefs("main"));
    }, [settingsOpen]);

    const placePanel = (event: ReactMouseEvent<HTMLElement>, width: number) => {
        if (!vertical) setPanelX(getPanelX(rootRef.current, event.currentTarget, width));
    };
    const runAddAction = (action: () => void) => {
        action();
        setAddOpen(false);
    };

    // 点击外部关闭浮层面板
    useEffect(() => {
        if (!addOpen && !appearanceOpen) return;
        const closeFloatingPanels = (event: PointerEvent) => {
            const element = event.target instanceof Element ? event.target : null;
            if (event.target instanceof Node && rootRef.current?.contains(event.target) && !element?.closest(".joysee-canvas-dock-views")) return;
            if (element?.closest(".ant-color-picker,.ant-popover")) return;
            setAddOpen(false);
            setAppearanceOpen(false);
        };
        document.addEventListener("pointerdown", closeFloatingPanels, true);
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setAddOpen(false);
            setAppearanceOpen(false);
        };
        document.addEventListener("keydown", closeOnEscape, true);
        return () => {
            document.removeEventListener("pointerdown", closeFloatingPanels, true);
            document.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [addOpen, appearanceOpen]);

    // 构建 handlers（主工具栏只需要部分回调，其余用 no-op 占位满足类型）
    const handlers: ToolbarHandlers = {
        onToolChange,
        onDeselect,
        onUndo,
        onRedo,
        onClear,
        onAddText,
        onAddImage,
        onAddVideo,
        onAddAudio,
        onAddScript,
        onAddFrame,
        onAddFolder,
        onAddDrawing,
        onAddExtensionNode,
        onAddWorkflow,
        onChooseStyle,
        onOpenPrevis,
        onUpload,
        onOpenWorkspace,
        onOpenMyAssets,
        onOpenProjectCharacters,
        onOpenPoseLibrary,
        onBackgroundModeChange,
        onShowImageInfoChange,
        onToggleAddPanel: (event: ReactMouseEvent<HTMLElement>) => {
            placePanel(event, 420);
            setAppearanceOpen(false);
            setSettingsOpen(false);
            setAddOpen((value) => !value);
        },
        onToggleAppearancePanel: (event: ReactMouseEvent<HTMLElement>) => {
            placePanel(event, 296);
            setAddOpen(false);
            setSettingsOpen(false);
            setAppearanceOpen((value) => !value);
        },
        onToggleSettingsPanel: () => {
            setAddOpen(false);
            setAppearanceOpen(false);
            setSettingsOpen((value) => !value);
        },
        onDeleteSelected: onDelete,
        // 以下为多选/节点悬停工具栏回调，主工具栏不使用，用 no-op 占位
        onAlign: () => {},
        onArrange: () => {},
        onCreateStoryboard: () => {},
        onCreateReferenceGroup: () => {},
        onBatchConnect: () => {},
        onSendSelectionToAgent: () => {},
        onNodeInfo: () => {},
        onNodeDelete: () => {},
        onNodeRetry: () => {},
        onNodeEditText: () => {},
        onNodeDecreaseFont: () => {},
        onNodeIncreaseFont: () => {},
        onNodeToggleDialog: () => {},
        onNodeAnnotate: () => {},
        onNodeGenerateImage: () => {},
        onNodeUpload: () => {},
        onNodeDownload: () => {},
        onNodeSaveAsset: () => {},
        onNodeRegionEdit: () => {},
        onNodeImageEdit: () => {},
        onNodeRemoveBackground: () => {},
        onNodeEmotion: () => {},
        onNodePortraitTexture: () => {},
        onNodeCrop: () => {},
        onNodeSplit: () => {},
        onNodeUpscale: () => {},
        onNodeSuperResolve: () => {},
        onNodeAngle: () => {},
        onNodeViewImage: () => {},
        onNodeExtractVideoFrames: () => {},
        onNodeExtractAudioFromVideo: () => {},
        onNodeTrimVideoSegments: () => {},
        onNodeSubtitles: () => {},
        onNodeTimeline: () => {},
        onNodeReversePrompt: () => {},
        onNodeToggleFreeResize: () => {},
        onNodeToggleLocked: () => {},
        onNodeCopyPrompt: () => {},
    } as ToolbarHandlers;

    const ctx: ToolContext = {
        singleCanvasModeButton: Boolean(viewControls),
        selectedCount,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool,
        workspaceMode,
        isProjectLinked,
        canUndo,
        canRedo,
        extractingVideoFrames: false,
        extractingAudio: false,
        trimmingVideo: false,
        mergingVideos: false,
        addPanelOpen: addOpen,
        appearancePanelOpen: appearanceOpen,
        settingsPanelOpen: settingsOpen,
        handlers,
    };

    const items = resolveToolbarEntries("main", ctx, prefs ?? defaultToolbarPrefs("main"));

    // 中央空白起点与主工具栏共用同一份命令解析，避免素材类型和插件节点逐渐分叉。
    const createCommands = useCanvasCreateCommands(ctx, runAddAction);

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            className={`canvas-main-toolbar pointer-events-none absolute flex ${vertical ? "canvas-focus-tool-rail" : "inset-x-[var(--canvas-inset-x)] bottom-[var(--canvas-inset-y)] justify-center"} ${viewControls ? "has-view-controls" : ""}`}
            style={{ zIndex }}
            onPointerDownCapture={bringToFront}
            onFocusCapture={bringToFront}
            onWheel={vertical || viewControls ? (event) => event.stopPropagation() : undefined}
        >
            <AnimatePresence>{addOpen ? <AddNodeMenu x={panelX} vertical={vertical} theme={theme} commands={createCommands} /> : null}</AnimatePresence>

            {viewControls ? (
                <div className="canvas-floating-dock joysee-canvas-dock pointer-events-auto relative" style={canvasDockStyle(theme)}>
                    <FloatingDock items={items} variant="toolbar" size="compact" className="joysee-canvas-dock-group" />
                    <span className="joysee-canvas-dock-divider" aria-hidden />
                    {viewControls}
                </div>
            ) : (
                <FloatingDock
                    items={items}
                    variant="toolbar"
                    vertical={vertical}
                    size={compact || vertical ? "compact" : "default"}
                    className={`canvas-floating-dock pointer-events-auto relative ${vertical ? "canvas-focus-rail-dock" : "left-[var(--canvas-main-toolbar-shift,0px)] max-w-full"}`}
                    style={canvasDockStyle(theme)}
                />
            )}

            <AnimatePresence>
                {appearanceOpen ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="canvas-toolbar-popup pointer-events-auto absolute bottom-[var(--canvas-dock-popover-offset)] z-[var(--dock-z-popover)] w-[296px] max-w-full"
                        style={vertical ? undefined : { left: panelX || "50%", transformOrigin: "bottom center", x: "-50%" }}
                    >
                        <SpotlightSurface
                            role="region"
                            aria-label={t("canvasC.toolbar.appearance")}
                            spotlightColor={theme.toolbar.itemHover}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, transition: { duration: 0 } }}
                            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                            className="aceternity-floating-panel flex flex-col overflow-hidden rounded-[var(--panel-radius)] border p-2 backdrop-blur-2xl"
                            contentClassName="relative z-[1] min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar"
                            data-canvas-wheel-scroll
                            style={{
                                maxHeight: "var(--canvas-toolbar-popup-max-height, calc(100dvh - var(--canvas-inset-y) - var(--canvas-dock-popover-offset) - 12px))",
                                background: theme.spatial.elevated,
                                borderColor: theme.toolbar.border,
                                color: theme.toolbar.item,
                            }}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <PanelHeading icon={<Palette className="size-4" />} title={t("canvasC.toolbar.appearance")} theme={theme} />
                            <CanvasAppearanceControls
                                appearance={appearance}
                                backgroundMode={backgroundMode}
                                colorTheme={colorTheme}
                                theme={theme}
                                onAppearanceChange={onAppearanceChange}
                                onSaveAppearanceDefault={onSaveAppearanceDefault}
                                onBackgroundModeChange={onBackgroundModeChange}
                            />
                            <div className="mt-2 flex items-center justify-between gap-2 rounded-[var(--dock-item-radius-labeled)] border px-2 py-2" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                                <span className="inline-flex min-w-0 items-center gap-2 text-[var(--fs-caption)] font-semibold">
                                    <Info className="size-3" />
                                    {t("canvasC.toolbar.mediaInfo")}
                                </span>
                                <Switch size="sm" checked={showImageInfo} onChange={onShowImageInfoChange} />
                            </div>
                        </SpotlightSurface>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <ToolbarSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} toolbar="main" />
        </div>
    );
}

function AddNodeMenu({ x, vertical, theme, commands }: { x: string; vertical: boolean; theme: CanvasTheme; commands: CanvasCreateCommand[] }) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
            className="canvas-toolbar-popup pointer-events-auto absolute bottom-[var(--canvas-dock-popover-offset)] z-[var(--dock-z-popover)] w-[420px] max-w-full"
            style={vertical ? undefined : { left: x || "50%", transformOrigin: "bottom center", x: "-50%" }}
        >
            <SpotlightSurface
                spotlightColor={theme.toolbar.itemHover}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0 } }}
                transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                className="aceternity-floating-panel flex flex-col overflow-hidden rounded-[var(--panel-radius)] border p-2 backdrop-blur-2xl"
                contentClassName="relative z-[1] min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain thin-scrollbar"
                data-canvas-wheel-scroll
                style={{ maxHeight: "var(--canvas-toolbar-popup-max-height, calc(100dvh - var(--canvas-inset-y) - var(--canvas-dock-popover-offset) - 12px))", background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text }}
                onWheel={(event) => event.stopPropagation()}
            >
                <CanvasCreateMenu commands={commands} />
            </SpotlightSurface>
        </motion.div>
    );
}

function PanelHeading({ icon, title, theme }: { icon: ReactNode; title: string; theme: CanvasTheme }) {
    return (
        <div className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-[var(--dock-item-radius)] border opacity-75 [&_svg]:size-3.5" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                {icon}
            </span>
            <span className="text-xs font-semibold">{title}</span>
        </div>
    );
}

function getPanelX(root: HTMLDivElement | null, target: HTMLElement, panelWidth: number) {
    if (!root) return "50%";
    const rootBox = root.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const center = box.left - rootBox.left + box.width / 2;
    // CSS keeps the anchor in bounds when the Agent or viewport resizes an open panel.
    return `clamp(min(50%, ${panelWidth / 2}px), ${center}px, max(50%, calc(100% - ${panelWidth / 2}px)))`;
}
