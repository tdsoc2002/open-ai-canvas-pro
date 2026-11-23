import { workspacePath } from "@/lib/workspace-routes";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { Clapperboard, CloudDownload, CopyPlus, Eraser, Focus, FolderKanban, Home, LayoutGrid, Workflow, LoaderCircle, Menu, PanelsLeftBottom, Pencil, Plus, Redo2, Save, Search, Share2, Trash2, Undo2, Upload } from "lucide-react";
import { Button, Dropdown } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { WorkspaceCreditGiftMark } from "@/components/layout/workspace-credit-gift-mark";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasContextSummary } from "@/lib/canvas/canvas-context-summary";
import type { CanvasShortDramaProgress } from "@/lib/canvas/canvas-short-drama";
import { canvasThemes, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { useThemePack } from "@/themes/use-theme-pack";

export type CanvasProjectView = "canvas" | "assets";

type CanvasAuxiliaryCommands = {
    onImportLibTV: () => void;
    onImportTapNow: () => void;
    onEnterFocusMode: () => void;
    shortDramaGuide?: { progress: CanvasShortDramaProgress; collapsed: boolean; onToggle: () => void };
};

type CanvasProjectMenuProps = CanvasAuxiliaryCommands & {
    inRail: boolean;
    onOpenAssets?: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onClearCanvas?: () => void;
    onSave: () => void | Promise<void>;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onOpenSearch: () => void;
};

type CanvasProjectHeadingProps = {
    menu?: ReactNode;
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    syncIcon?: ReactNode;
    onOpenSearch: () => void;
    /** kind=drama 表示关联的是自动制作短剧，链接回短剧制作台。 */
    projectContext?: CanvasContextSummary & { projectId: string; projectName: string; kind?: "drama" };
};

type CanvasTopBarProps = Pick<CanvasProjectHeadingProps, "onOpenSearch"> &
    CanvasAuxiliaryCommands & {
        projectHeading?: ReactNode;
        viewSwitch?: ReactNode;
        onShare?: () => void;
        onThemeChange: (theme: CanvasColorTheme) => void;
        collaborationControlRef?: Ref<HTMLDivElement>;
    };

export function CanvasProjectMenu({
    inRail,
    onOpenAssets,
    canUndo,
    canRedo,
    onCreateProject,
    onDeleteProject,
    onClearCanvas,
    onSave,
    onImportImage,
    onUndo,
    onRedo,
    onOpenSearch,
    onImportLibTV,
    onImportTapNow,
    onEnterFocusMode,
    shortDramaGuide,
}: CanvasProjectMenuProps) {
    const joysee = useThemePack()?.workspaceStyle === "joysee";
    const theme = canvasThemes[useCanvasThemeStore((state) => state.theme)];
    const logoConfigured = useAppearanceStore((state) => state.appearance.logoConfigured);

    return (
        <CanvasTopBarTooltip label="打开画布菜单">
            <Dropdown
                trigger={["click"]}
                menu={{
                    items: [
                        { key: "home", icon: <Home className="size-4" />, label: <Link to={workspacePath("/")}>主页</Link> },
                        { key: "projects", icon: <LayoutGrid className="size-4" />, label: <Link to={workspacePath("/canvas")}>画布</Link> },
                        ...(onOpenAssets ? [{ key: "view", icon: <PanelsLeftBottom className="size-4" />, label: "切换到资产视图", onClick: onOpenAssets }] : []),
                        { type: "divider" },
                        { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                        { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                        { key: "save", icon: <Save className="size-4" />, label: <MenuLabel text="保存" shortcut="⌘ S" />, onClick: () => void onSave() },
                        { type: "divider" },
                        { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                        ...(joysee
                            ? [
                                  {
                                      key: "import-canvas",
                                      icon: <CloudDownload className="size-4" />,
                                      label: "导入第三方画布",
                                      children: [
                                          { key: "libtv", icon: <CopyPlus className="size-4" />, label: "导入 LibTV 画布", onClick: onImportLibTV },
                                          { key: "tapnow", icon: <CloudDownload className="size-4" />, label: "导入 TapNow 画布", onClick: onImportTapNow },
                                      ],
                                  },
                                  { key: "focus", icon: <Focus className="size-4" />, label: "进入专注模式", onClick: onEnterFocusMode },
                                  ...(shortDramaGuide ? [{ key: "drama-guide", icon: <Clapperboard className="size-4" />, label: shortDramaGuide.collapsed ? "展开短剧流程" : "收起短剧流程", onClick: shortDramaGuide.onToggle }] : []),
                              ]
                            : []),
                        { key: "search", icon: <Search className="size-4" />, label: <MenuLabel text="搜索节点" shortcut="⌘ F" />, onClick: onOpenSearch },
                        { type: "divider" },
                        { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                        { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                        ...(onClearCanvas ? [{ type: "divider" as const }, { key: "clear", danger: true, icon: <Eraser className="size-4" />, label: "清空画布", onClick: onClearCanvas }] : []),
                    ],
                }}
            >
                <button type="button" className="canvas-project-menu-trigger canvas-topbar-action grid size-9 place-items-center rounded-full" style={{ color: theme.node.text }} aria-label="打开画布菜单" aria-haspopup="menu">
                    {inRail ? (
                        <BrandLogoFrame
                            className={`app-workspace-brand-mark grid shrink-0 place-items-center${logoConfigured ? "" : " is-builtin"}`}
                            logoClassName="size-5 object-contain"
                            fallback={<span className="app-workspace-brand-glyph" aria-hidden />}
                        />
                    ) : (
                        <Menu className="size-5" />
                    )}
                </button>
            </Dropdown>
        </CanvasTopBarTooltip>
    );
}

export function CanvasProjectHeading({ menu, title, titleDraft, isTitleEditing, onTitleDraftChange, onStartTitleEditing, onFinishTitleEditing, onCancelTitleEditing, syncIcon, onOpenSearch, projectContext }: CanvasProjectHeadingProps) {
    const theme = canvasThemes[useCanvasThemeStore((state) => state.theme)];
    const titleRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <header className="canvas-topbar-cluster canvas-topbar-project-cluster pointer-events-auto flex min-w-0 items-center gap-2 justify-self-start" style={{ color: theme.node.text, "--dock-command-hover": theme.toolbar.itemHover } as CSSProperties}>
            {menu}

            <div ref={titleRef} className="canvas-topbar-title-block flex min-w-0 flex-auto flex-col items-start overflow-hidden">
                {isTitleEditing ? (
                    <input
                        autoFocus
                        size={canvasTitleInputSize(titleDraft)}
                        value={titleDraft}
                        onChange={(event) => onTitleDraftChange(event.target.value)}
                        onBlur={onFinishTitleEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") onFinishTitleEditing();
                            if (event.key === "Escape") onCancelTitleEditing();
                        }}
                        className="h-8 w-auto min-w-12 max-w-[min(280px,42vw)] appearance-none border-0 bg-transparent p-0 text-left text-base font-semibold tracking-normal outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                        style={{ color: theme.node.text, caretColor: theme.accent.primary, border: 0, boxShadow: "none", outline: "none" }}
                        aria-label="画布名称"
                    />
                ) : (
                    <div className="canvas-topbar-title-row flex min-w-0 items-center gap-0.5">
                        <button type="button" className="min-w-0 flex-1 truncate text-left text-base font-semibold tracking-normal transition-opacity hover:opacity-75" onClick={onStartTitleEditing} title="点击修改画布名称">
                            {title}
                        </button>
                        <CanvasTopBarTooltip label="重命名画布">
                            <button
                                type="button"
                                className="canvas-topbar-action grid size-7 shrink-0 place-items-center rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2"
                                style={{ color: theme.node.text }}
                                onClick={onStartTitleEditing}
                                aria-label="重命名画布"
                            >
                                <Pencil className="size-3.5" />
                            </button>
                        </CanvasTopBarTooltip>
                    </div>
                )}
                {projectContext && !isTitleEditing ? (
                    <div className="canvas-topbar-project-context mt-0.5 flex w-full min-w-0 items-center gap-2 overflow-hidden text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                        <Link
                            to={`/projects/${encodeURIComponent(projectContext.projectId)}`}
                            className="inline-flex min-w-0 items-center gap-1 hover:underline"
                            title={projectContext.kind === "drama" ? `打开短剧制作台：${projectContext.projectName}` : `返回项目：${projectContext.projectName}`}
                        >
                            {projectContext.kind === "drama" ? <Clapperboard className="size-3 shrink-0" /> : <FolderKanban className="size-3 shrink-0" />}
                            <span className="max-w-[120px] truncate">{projectContext.projectName}</span>
                        </Link>
                        <span aria-hidden>·</span>
                        <button type="button" className="min-w-0 truncate hover:underline" onClick={onOpenSearch} title="搜索并定位章节或镜头">
                            {projectContext.chapterLabel || `${projectContext.nodeCount} 个节点`}
                            {projectContext.shotLabel ? ` · ${projectContext.shotLabel}` : ""}
                            {projectContext.selectedCount ? ` · 已选 ${projectContext.selectedCount}` : ""}
                        </button>
                    </div>
                ) : null}
            </div>
            {syncIcon}
        </header>
    );
}

export function CanvasTopBar({ projectHeading, viewSwitch, onOpenSearch, onImportLibTV, onImportTapNow, onShare, onThemeChange, onEnterFocusMode, shortDramaGuide, collaborationControlRef }: CanvasTopBarProps) {
    const joysee = useThemePack()?.workspaceStyle === "joysee";
    const colorTheme = useCanvasThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = canvasDockStyle(theme, theme.node.text);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits, refreshing } = useWalletBalance(user?.id, creditsEnabled);
    const [importMenuOpen, setImportMenuOpen] = useState(false);

    return (
        <>
            <div className="canvas-topbar pointer-events-none absolute inset-x-0 top-0 z-[var(--z-toolbar)] grid h-[var(--canvas-topbar-h)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-4 sm:px-5">
                {projectHeading}

                {viewSwitch}

                <div className="canvas-topbar-cluster canvas-topbar-tools-cluster pointer-events-auto col-start-3 row-start-1 flex items-center gap-2 justify-self-end" style={dockStyle}>
                    {collaborationControlRef ? <div ref={collaborationControlRef} className="canvas-topbar-presence shrink-0 empty:hidden" /> : null}
                    {!joysee ? (
                        <>
                            <CanvasTopBarTooltip label="搜索画布节点">
                                <Button
                                    type="text"
                                    className="canvas-topbar-action !hidden !h-10 !w-10 !min-w-10 !rounded-xl !p-0 lg:!inline-flex"
                                    style={{ color: theme.node.text }}
                                    icon={<Search className="size-4" />}
                                    onClick={onOpenSearch}
                                    aria-label="搜索画布节点"
                                />
                            </CanvasTopBarTooltip>
                            <CanvasTopBarTooltip label="导入第三方画布" suppressed={importMenuOpen}>
                                <Dropdown
                                    trigger={["click"]}
                                    placement="bottomRight"
                                    onOpenChange={setImportMenuOpen}
                                    menu={{
                                        items: [
                                            { key: "libtv", icon: <CopyPlus className="size-4" />, label: "导入 LibTV 画布", onClick: onImportLibTV },
                                            { key: "tapnow", icon: <CloudDownload className="size-4" />, label: "导入 TapNow 画布", onClick: onImportTapNow },
                                        ],
                                    }}
                                >
                                    <Button
                                        type="text"
                                        className="canvas-topbar-action canvas-topbar-import-button !h-10 !rounded-xl !px-2 !font-medium"
                                        style={{ color: theme.node.text }}
                                        icon={<CloudDownload className="size-4" />}
                                        aria-label="导入第三方画布"
                                    >
                                        <span className="hidden lg:inline">导入画布</span>
                                    </Button>
                                </Dropdown>
                            </CanvasTopBarTooltip>
                        </>
                    ) : null}
                    {user && creditsEnabled ? (
                        <CanvasTopBarTooltip label="打开积分中心">
                            <button
                                type="button"
                                className="canvas-topbar-action canvas-topbar-wallet inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium tabular-nums"
                                style={{ color: theme.node.text }}
                                aria-label="打开积分中心"
                                onClick={() => openWorkspaceWallet()}
                            >
                                {refreshing && availableMicrocredits === null ? <LoaderCircle className="size-3.5 animate-spin opacity-60" style={{ color: theme.accent.primary }} /> : <WorkspaceCreditGiftMark className="is-compact" />}
                                <span>{availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}</span>
                            </button>
                        </CanvasTopBarTooltip>
                    ) : null}
                    {!joysee ? (
                        <>
                            <CanvasTopBarTooltip label="进入专注模式（Shift + Ctrl/Cmd + F）">
                                <Button type="text" className="canvas-topbar-action !h-10 !w-10 !min-w-10 !rounded-xl !p-0" style={{ color: theme.node.text }} icon={<Focus className="size-4" />} onClick={onEnterFocusMode} aria-label="进入专注模式" />
                            </CanvasTopBarTooltip>
                            {shortDramaGuide ? (
                                <CanvasTopBarTooltip label={shortDramaGuide.collapsed ? "展开短剧流程" : "收起短剧流程"}>
                                    <Button
                                        type="text"
                                        className="canvas-topbar-action !h-10 !rounded-xl !px-2 !font-medium"
                                        style={{ color: theme.node.text, background: shortDramaGuide.collapsed ? undefined : theme.toolbar.activeBg }}
                                        icon={<Clapperboard className="size-4" />}
                                        onClick={shortDramaGuide.onToggle}
                                        aria-label="短剧流程"
                                        aria-pressed={!shortDramaGuide.collapsed}
                                    >
                                        <span className="tabular-nums">{shortDramaGuide.progress.completedCount}/5</span>
                                    </Button>
                                </CanvasTopBarTooltip>
                            ) : null}
                        </>
                    ) : null}
                    {onShare && (
                        <CanvasTopBarTooltip label="分享画布">
                            <Button type="text" className="canvas-topbar-action !h-10 !w-10 !min-w-10 !rounded-xl !p-0" style={{ color: theme.node.text }} icon={<Share2 className="size-4" />} onClick={onShare} aria-label="分享画布" />
                        </CanvasTopBarTooltip>
                    )}
                    {joysee ? <WorkspaceAccountMenu themePreference={{ theme: colorTheme, onChange: onThemeChange }} /> : null}
                </div>
            </div>
        </>
    );
}

export function CanvasViewSwitch({ view, onChange, theme, inToolbar }: { view: CanvasProjectView; onChange: (view: CanvasProjectView) => void; theme: CanvasTheme; inToolbar: boolean }) {
    const items: Array<{ value: CanvasProjectView; label: string; icon: ReactNode }> = [
        { value: "canvas", label: "画布", icon: <Workflow /> },
        { value: "assets", label: "资产", icon: <PanelsLeftBottom /> },
    ];
    const visibleItems = inToolbar ? items.filter((item) => item.value !== view) : items;
    const style = {
        ...canvasDockStyle(theme, theme.node.text),
        "--view-switch-idle": theme.node.muted,
        "--view-switch-hover": theme.node.text,
        "--view-switch-active-bg": theme.node.text,
        "--view-switch-active-fg": theme.canvas.background,
    } as CSSProperties;
    return (
        <div
            role={inToolbar ? undefined : "group"}
            aria-label={inToolbar ? undefined : "画布视图"}
            className={`canvas-view-switch pointer-events-auto items-center ${inToolbar ? "flex" : "canvas-topbar-cluster col-start-2 row-start-1 hidden justify-self-center xl:flex"}`}
            style={style}
        >
            {visibleItems.map((item) => {
                const label = `${item.label}视图`;
                const selected = view === item.value;
                const actionLabel = `切换到${label}`;
                return (
                    <CanvasTopBarTooltip key={item.value} label={selected ? `当前：${label}` : actionLabel} placement={inToolbar ? "top" : "bottom"}>
                        {/* 未分层的 `button { color: inherit }` 会压过 @layer 里的颜色规则，颜色走行内变量，由样式表按状态切换。 */}
                        <button
                            type="button"
                            className="canvas-view-switch-option"
                            style={{ color: "var(--view-switch-color)" }}
                            aria-label={inToolbar ? actionLabel : label}
                            aria-pressed={inToolbar ? undefined : selected}
                            onClick={() => onChange(item.value)}
                        >
                            {item.icon}
                        </button>
                    </CanvasTopBarTooltip>
                );
            })}
        </div>
    );
}

// 顶栏是 --z-toolbar 上的绝对定位浮层，会为子元素建立层叠上下文。行内绝对定位的提示
// 无论 z-index 多高都无法越过它，会被顶栏下方 --z-panel-floating 的生成任务面板盖住，
// 因此提示必须走 portal 的浮层层级。
// 提示向下弹出会盖住顶栏下方的节点工具栏：离开立即消失，且提示本身不接收指针，避免截获下方按钮的点击。
// suppressed 用于对应菜单展开期间不再显示提示。
function CanvasTopBarTooltip({ label, suppressed = false, placement = "bottom", children }: { label: string; suppressed?: boolean; placement?: "top" | "bottom"; children: ReactNode }) {
    return (
        <Tooltip title={suppressed ? null : label} placement={placement} mouseLeaveDelay={0} styles={{ root: { pointerEvents: "none" } }}>
            <span className="relative inline-flex">{children}</span>
        </Tooltip>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function canvasTitleInputSize(value: string) {
    const visualLength = Array.from(value || "画布名称").reduce((length, character) => length + (character.codePointAt(0)! > 0xff ? 2 : 1), 0);
    return Math.min(30, Math.max(5, visualLength));
}
